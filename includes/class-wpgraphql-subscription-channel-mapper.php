<?php

/**
 * Maps generic WordPress events to GraphQL subscription channels.
 * 
 * This class serves as the bridge between generic WordPress events
 * and the opinionated WPGraphQL Subscription Server (SSE-2) channel format.
 * 
 * It listens for generic WordPress events and translates them into
 * SSE-2 compatible channel structures for webhook delivery.
 */
class WPGraphQL_Subscription_Channel_Mapper {

    /**
     * Initialize the channel mapper.
     */
    public static function init() {
        // Listen for generic WordPress events
        add_action( 'wpgraphql_generic_event', [ __CLASS__, 'handle_generic_event' ], 10, 3 );
    }

    /**
     * Handle generic WordPress events and map them to GraphQL subscription channels.
     * 
     * @param string $node_type The WordPress node type (post, comment, user, etc.)
     * @param string $action The action performed (CREATE, UPDATE, DELETE)
     * @param array $event_payload The complete event payload
     */
    public static function handle_generic_event( $node_type, $action, $event_payload ) {
        
        // Get the subscription event type for this WordPress event
        $subscription_type = self::get_subscription_event_type( $node_type, $action );
        
        if ( ! $subscription_type ) {
            error_log( "WPGraphQL Subscription Mapper: No subscription mapping for {$node_type}.{$action}" );
            return;
        }
        
        // Calculate channels for this subscription type
        $channels = self::calculate_channels_for_event( 
            $subscription_type, 
            $event_payload['node_id'], 
            $event_payload['context'] 
        );
        
        // Create the SSE-2 compatible payload
        $sse_payload = $event_payload;
        $sse_payload['channels'] = $channels;
        
        error_log( 
            sprintf( 
                'WPGraphQL Subscription Mapper: Mapped %s.%s → %s with %d channels', 
                $node_type,
                $action,
                $subscription_type,
                count( $channels )
            ) 
        );
        
        // Emit the GraphQL-specific subscription event (backwards compatibility)
        do_action( 'graphql_subscription_event', $subscription_type, $sse_payload );
    }

    /**
     * Get the GraphQL subscription event type based on WordPress node type and action.
     * 
     * This method contains the opinionated mapping between WordPress events
     * and GraphQL subscription names.
     * 
     * @param string $node_type The WordPress node type
     * @param string $action The action performed
     * @return string|null The GraphQL subscription event type or null if not mapped
     */
    private static function get_subscription_event_type( $node_type, $action ) {
        
        // Define the mapping between WordPress events and GraphQL subscriptions
        $event_map = [
            'post' => [
                'CREATE' => 'postCreated',
                'UPDATE' => 'postUpdated',
                'DELETE' => 'postDeleted',
            ],
            'comment' => [
                'CREATE' => 'commentAdded', // Special case: use "Added" instead of "Created"
                'UPDATE' => 'commentUpdated',
                'DELETE' => 'commentDeleted',
            ],
            'user' => [
                'CREATE' => 'userCreated',
                'UPDATE' => 'userUpdated',
                'DELETE' => 'userDeleted',
            ],
        ];
        
        // Allow plugins to modify the mapping
        $event_map = apply_filters( 'wpgraphql_subscription_event_map', $event_map );
        
        return $event_map[ $node_type ][ $action ] ?? null;
    }

    /**
     * Calculate Redis channels for a subscription event.
     * 
     * This method determines which Redis channels should receive this event
     * based on the subscription type and event context.
     * 
     * @param string $subscription_type The GraphQL subscription type (e.g., postUpdated, commentAdded)
     * @param int $node_id The ID of the affected node
     * @param array $context Additional context data
     * @return array Array of Redis channel names
     */
    private static function calculate_channels_for_event( $subscription_type, $node_id, $context ) {
        $channels = [];
        
        // Channel prefix (matches SSE-2 ChannelBuilder)
        $prefix = 'wpgraphql:';
        
        // Always add the global channel for this subscription type
        $channels[] = $prefix . $subscription_type;
        
        // Add specific channels based on the subscription type and context
        if ( strpos( $subscription_type, 'comment' ) === 0 && isset( $context['post_id'] ) ) {
            // Comment subscriptions: route by the post they belong to (nodeId argument)
            $channels[] = $prefix . $subscription_type . '.' . $context['post_id'];
        } else {
            // Default: route by the node_id itself (id argument)
            $channels[] = $prefix . $subscription_type . '.' . $node_id;
        }
        
        // Allow plugins to modify channels
        $channels = apply_filters( 'wpgraphql_subscription_event_channels', $channels, $subscription_type, $node_id, $context );
        
        return array_unique( $channels );
    }
}
