<?php

class WPGraphQL_Event_Emitter {

    /**
     * Emit a standardized subscription event.
     * 
     * This method serves as the central event emitter that creates standardized
     * event payloads and handles the distribution to relevant subscription streams.
     * 
     * @param string $node_type The type of node (e.g., 'post', 'user', 'comment').
     * @param string $action    The action performed (CREATE, UPDATE, DELETE).
     * @param int    $node_id   The ID of the affected node.
     * @param array  $context   Additional context data for the event.
     * @param array  $metadata  Optional metadata about the event.
     */
    public static function emit( $node_type, $action, $node_id, $context = [], $metadata = [] ) {
        
        // Validate required parameters
        if ( empty( $node_type ) || empty( $action ) || empty( $node_id ) ) {
            error_log( 'WPGraphQL Subscriptions: Invalid event emission - missing required parameters' );
            return;
        }
        
        // Standardize the action to uppercase
        $action = strtoupper( $action );
        
        // Validate action type
        $valid_actions = [ 'CREATE', 'UPDATE', 'DELETE' ];
        if ( ! in_array( $action, $valid_actions, true ) ) {
            error_log( "WPGraphQL Subscriptions: Invalid action '{$action}'. Must be one of: " . implode( ', ', $valid_actions ) );
            return;
        }
        
        // Create the standardized event payload
        $event_payload = [
            'node_type' => $node_type,
            'action' => $action,
            'node_id' => $node_id,
            'context' => $context,
            'metadata' => array_merge( [
                'timestamp' => time(),
                'event_id' => uniqid( "{$node_type}_{$action}_", true ),
                'user_id' => get_current_user_id(),
            ], $metadata ),
        ];
        
        // Determine the subscription event type based on node type and action
        $subscription_event_type = self::get_subscription_event_type( $node_type, $action );
        
        // Log the event for debugging
        error_log( 
            sprintf( 
                'WPGraphQL Subscriptions: Emitted %s event for %s #%d', 
                $subscription_event_type,
                $node_type,
                $node_id 
            ) 
        );
        
        // Debug: Log the complete event payload structure
        error_log( 'WPGraphQL-SSE: Event payload structure: ' . json_encode([
            'node_type' => $event_payload['node_type'],
            'action' => $event_payload['action'], 
            'node_id' => $event_payload['node_id'],
            'context_keys' => array_keys( $event_payload['context'] ),
            'has_post' => isset( $event_payload['context']['post'] ),
            'post_id_from_context' => isset( $event_payload['context']['post'] ) ? $event_payload['context']['post']->ID : 'missing'
        ]));
        
        // Process the event for active subscriptions
        // self::process_event_for_subscriptions( $subscription_event_type, $event_payload );
        
        /**
         * Action hook to allow other plugins to listen for subscription events.
         * 
         * @param string $subscription_event_type The subscription event type (e.g., 'postUpdated').
         * @param array  $event_payload           The complete standardized event payload.
         */
        do_action( 'graphql_subscription_event', $subscription_event_type, $event_payload );
    }

        /**
     * Get the subscription event type based on node type and action.
     * 
     * This method maps internal node types and actions to GraphQL subscription
     * event types that clients will listen for.
     * 
     * @param string $node_type The internal node type.
     * @param string $action    The action performed.
     * @return string The subscription event type.
     */
    private static function get_subscription_event_type( $node_type, $action ) {
        
        // Map actions to subscription event suffixes
        $action_map = [
            'CREATE' => 'Created',
            'UPDATE' => 'Updated', 
            'DELETE' => 'Deleted',
        ];
        
        // Build the subscription event type (e.g., postUpdated, userCreated)
        $event_suffix = $action_map[ $action ] ?? 'Changed';
        return $node_type . $event_suffix;
    }

}