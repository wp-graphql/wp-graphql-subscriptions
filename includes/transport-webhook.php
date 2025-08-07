<?php

// Send subscription events to a webhook. 
// Ideally this would be more granular and allow for different subscriptions to be sent to different webhooks (i.e. a single webhook per subscription)
// For now, this is a simple proof of concept that sends all events to a single webhook.
add_action( 'graphql_subscription_event', function( $event_type, $payload ) {
    
    wp_remote_post( 
        'https://webhook.site/ca82a28f-485e-4f53-a716-3dcac8d303ea',
        [
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => json_encode( $payload ),
        ]
    );
    
}, 10, 2 );