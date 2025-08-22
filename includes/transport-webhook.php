<?php

// Send subscription events to a webhook. 
// Ideally this would be more granular and allow for different subscriptions to be sent to different webhooks (i.e. a single webhook per subscription)
// For now, this is a simple proof of concept that sends all events to a single webhook.
add_action( 'graphql_subscription_event', function( $event_type, $payload ) {
    
    // Send to the SSE-2 sidecar server
    $response = wp_remote_post( 
        'http://localhost:4000/webhook',
        [
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => json_encode( $payload ),
            'timeout' => 5, // 5 second timeout
        ]
    );
    
    // Log the response for debugging
    if ( is_wp_error( $response ) ) {
        error_log( 'WPGraphQL Subscriptions: Failed to send webhook - ' . $response->get_error_message() );
    } else {
        $response_code = wp_remote_retrieve_response_code( $response );
        $response_body = wp_remote_retrieve_body( $response );
        error_log( "WPGraphQL Subscriptions: Webhook sent - HTTP {$response_code}: {$response_body}" );
    }
    
}, 10, 2 );