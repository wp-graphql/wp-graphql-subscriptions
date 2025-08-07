<?php
/**
 * WPGraphQL Subscription Connection
 * 
 * Represents a single client connection and its registered subscription documents
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WPGraphQL_Subscription_Connection {
    
    /**
     * Connection token
     */
    private $token;
    
    /**
     * Storage backend
     */
    private $storage;
    
    /**
     * Constructor
     */
    public function __construct( $token, $storage ) {
        $this->token = $token;
        $this->storage = $storage;
    }
    
    /**
     * Register a subscription document
     */
    public function register_subscription( $operation_id, $query, $variables = [] ) {
        try {
            // Parse the GraphQL document to validate it's a subscription
            $document = \GraphQL\Language\Parser::parse( $query );
            
            $operation_definition = null;
            foreach ( $document->definitions as $definition ) {
                if ( $definition instanceof \GraphQL\Language\AST\OperationDefinitionNode ) {
                    if ( $definition->operation === 'subscription' ) {
                        $operation_definition = $definition;
                        break;
                    }
                }
            }
            
            if ( ! $operation_definition ) {
                throw new \Exception( 'Document must contain a subscription operation' );
            }
            
            // Store in database
            return $this->storage->store_subscription( $this->token, $operation_id, $query, $variables );
            
        } catch ( \Exception $e ) {
            error_log( "WPGraphQL Subscriptions: Failed to register subscription {$operation_id}: " . $e->getMessage() );
            return false;
        }
    }
    
    /**
     * Get all subscriptions for this connection
     */
    public function get_subscriptions() {
        return $this->storage->get_subscriptions( $this->token );
    }
    
    /**
     * Get a specific subscription
     */
    public function get_subscription( $operation_id ) {
        return $this->storage->get_subscription( $this->token, $operation_id );
    }
    
    /**
     * Remove a subscription
     */
    public function remove_subscription( $operation_id ) {
        return $this->storage->remove_subscription( $this->token, $operation_id );
    }
    
    /**
     * Get subscription count for this connection
     */
    public function get_subscription_count() {
        return count( $this->get_subscriptions() );
    }
    
    /**
     * Check if subscription matches an event
     */
    public function matches_event( $operation_id, $event_type, $node_id = null ) {
        $subscription = $this->get_subscription( $operation_id );
        if ( ! $subscription ) {
            error_log( "WPGraphQL Subscriptions: No subscription found for operation_id: {$operation_id}" );
            return false;
        }
        
        // Debug logging for subscription matching
        error_log( "WPGraphQL Subscriptions: Checking subscription {$operation_id} for event {$event_type} with node_id {$node_id}" );
        
        try {
            // Parse the stored query to check field names
            $document = \GraphQL\Language\Parser::parse( $subscription['query'] );
            
            // Find the subscription operation
            $operation_definition = null;
            foreach ( $document->definitions as $definition ) {
                if ( $definition instanceof \GraphQL\Language\AST\OperationDefinitionNode ) {
                    if ( $definition->operation === 'subscription' ) {
                        $operation_definition = $definition;
                        break;
                    }
                }
            }
            
            if ( ! $operation_definition ) {
                return false;
            }
            
            // Check field selections
            foreach ( $operation_definition->selectionSet->selections as $selection ) {
                if ( $selection instanceof \GraphQL\Language\AST\FieldNode ) {
                    $field_name = $selection->name->value;
                    error_log( "WPGraphQL Subscriptions: Found field '{$field_name}' in subscription {$operation_id}" );
                    
                    // Map event types to GraphQL fields
                    $event_to_field_map = [
                        'postUpdated' => 'postUpdated'
                    ];
                    
                    if ( isset( $event_to_field_map[ $event_type ] ) && 
                         $event_to_field_map[ $event_type ] === $field_name ) {
                        
                        // Check if there's an ID argument filter
                        if ( $node_id && $selection->arguments ) {
                            foreach ( $selection->arguments as $argument ) {
                                if ( $argument->name->value === 'id' && 
                                     $argument->value instanceof \GraphQL\Language\AST\StringValueNode ) {
                                    $matches = $argument->value->value == $node_id;
                                    error_log( "WPGraphQL Subscriptions: ID filter check - subscription wants {$argument->value->value}, event has {$node_id}, matches: " . ( $matches ? 'yes' : 'no' ) );
                                    return $matches;
                                }
                            }
                        }
                        
                        error_log( "WPGraphQL Subscriptions: Field {$field_name} matches event {$event_type}, no ID filter needed" );
                        return true;
                    }
                }
            }
            
        } catch ( \Exception $e ) {
            error_log( "WPGraphQL Subscriptions: Error parsing subscription for matching: " . $e->getMessage() );
            return false;
        }
        
        return false;
    }
    
    /**
     * Execute a subscription with given root value
     */
    public function execute_subscription( $operation_id, $root_value ) {
        $subscription = $this->get_subscription( $operation_id );
        if ( ! $subscription ) {
            return null;
        }
        
        try {
            // Execute through WPGraphQL
            $result = graphql( [
                'query' => $subscription['query'],
                'variables' => $subscription['variables'],
                'context' => \WPGraphQL::get_app_context(),
                'root_value' => $root_value
            ] );
            
            if ( ! empty( $result['errors'] ) ) {
                error_log( "WPGraphQL Subscriptions: GraphQL execution errors for {$operation_id}: " . wp_json_encode( $result['errors'] ) );
                return null;
            }
            
            return $result['data'] ?? null;
            
        } catch ( \Exception $e ) {
            error_log( "WPGraphQL Subscriptions: Error executing subscription {$operation_id}: " . $e->getMessage() );
            return null;
        }
    }
    
    /**
     * Get connection token
     */
    public function get_token() {
        return $this->token;
    }
    
    /**
     * Cleanup connection
     */
    public function cleanup() {
        return $this->storage->remove_connection( $this->token );
    }
}