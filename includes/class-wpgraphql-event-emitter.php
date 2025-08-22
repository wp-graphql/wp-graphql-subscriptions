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
        
        // Log the event for debugging
        error_log( 
            sprintf( 
                'WPGraphQL Subscriptions: Emitted %s.%s event for node #%d', 
                $node_type,
                $action,
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
        
        /**
         * Generic action hook for any plugin to listen for WordPress events.
         * The payload is completely generic and schema-agnostic.
         * 
         * @param string $node_type The WordPress node type (post, comment, user, etc.)
         * @param string $action The action performed (CREATE, UPDATE, DELETE)
         * @param array  $event_payload The complete standardized event payload
         */
        do_action( 'wpgraphql_generic_event', $node_type, $action, $event_payload );
    }




}