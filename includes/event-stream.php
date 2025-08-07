<?php
// This is a POC for SSE transport of events.
// NOTE that this does not seem to scale well and is not recommended for production. 
// There's a chance that it could be optimized to scale, but right now it's not recommended.

add_action( 'template_redirect', function() {
    
    // If the gql_subscription query param is present, start the stream.
    if ( isset( $_GET['gql_subscription'] ) ) {
        new WPGraphQL_Subscriptions_Stream( sanitize_text_field( $_GET['gql_subscription'] ) );
        exit;
    }

});

// Updated event handler to use database queue instead of transients
add_action( 'graphql_subscription_event', function( $event_type, $payload ) {
    
    // Get the event queue instance
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    
    // Extract node_id from payload for indexing
    $node_id = isset( $payload['node_id'] ) ? (int) $payload['node_id'] : null;
    
    // Add event to database queue
    $event_id = $event_queue->add_event( $event_type, $node_id, $payload );
    
    if ( $event_id ) {
        error_log( "WPGraphQL Subscriptions: Event {$event_type} queued with ID {$event_id}" );
    } else {
        error_log( "WPGraphQL Subscriptions: Failed to queue event {$event_type}" );
    }

}, 10, 2 );