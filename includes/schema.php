<?php
/**
 * Register Root Subscription type and fields.
 */
add_action( 'graphql_register_types', function() {
    register_graphql_object_type(
        'RootSubscription',
        [
            'description' => __( 'Root subscription type. Entry point for all subscriptions.', 'wpgraphql-subscriptions' ),
            'fields'      => [], // Fields are added via register_graphql_field().
        ]
    );

    register_graphql_field( 'RootSubscription', 'postUpdated', [
        'description' => __( 'Subscription for post updates.', 'wpgraphql-subscriptions' ),
        'type'        => 'Post',
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the post to subscribe to.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'resolve' => function( $root, $args, $context, $info ) {
            // This resolver is called when the subscription is executed
            // For subscriptions, the actual data comes from the SSE stream events
            
            // Debug logging
            error_log( 'WPGraphQL-SSE: postUpdated resolver called' );
            error_log( 'WPGraphQL-SSE: Args: ' . json_encode( $args ) );
            error_log( 'WPGraphQL-SSE: Root type: ' . gettype( $root ) );
            if ( is_array( $root ) ) {
                error_log( 'WPGraphQL-SSE: Root keys: ' . implode( ', ', array_keys( $root ) ) );
            } else {
                error_log( 'WPGraphQL-SSE: Root is not an array, it is: ' . ( is_null( $root ) ? 'null' : gettype( $root ) ) );
            }
            
            // Get the requested post ID from subscription arguments
            $requested_id = isset( $args['id'] ) ? absint( $args['id'] ) : null;
            error_log( "WPGraphQL-SSE: Requested ID: {$requested_id}" );
            
            // If we have event data from the subscription, extract the post data
            if ( isset( $root['postUpdated'] ) ) {
                $event_data = $root['postUpdated'];
                error_log( 'WPGraphQL-SSE: Found postUpdated event in root' );
                error_log( 'WPGraphQL-SSE: Event data type: ' . ( is_object( $event_data ) ? get_class( $event_data ) : gettype( $event_data ) ) );
                error_log( 'WPGraphQL-SSE: Event data keys: ' . ( is_array( $event_data ) ? implode( ', ', array_keys( $event_data ) ) : 'not array' ) );
                
                // Extract post data from the standardized event format
                $post_data = null;
                if ( is_array( $event_data ) && isset( $event_data['post'] ) ) {
                    // Standard event format: { id, action, timestamp, post: { ... }, post_type }
                    $post_data = $event_data['post'];
                    error_log( 'WPGraphQL-SSE: Using post data from event.post' );
                } elseif ( is_array( $event_data ) && isset( $event_data['ID'] ) ) {
                    // Direct post data format
                    $post_data = $event_data;
                    error_log( 'WPGraphQL-SSE: Using event data directly as post data' );
                } elseif ( is_object( $event_data ) && isset( $event_data->ID ) ) {
                    // WP_Post object directly
                    $post_data = $event_data;
                    error_log( 'WPGraphQL-SSE: Using WP_Post object directly' );
                }
                
                if ( $post_data ) {
                    // Convert array to WP_Post object if needed
                    if ( is_array( $post_data ) && isset( $post_data['ID'] ) ) {
                        $post = get_post( $post_data['ID'] );
                        if ( $post && ! is_wp_error( $post ) ) {
                            $post_data = $post;
                        }
                    }
                    
                    // If we have a WP_Post object, check if it matches the requested ID
                    if ( is_object( $post_data ) && isset( $post_data->ID ) ) {
                        error_log( "WPGraphQL-SSE: WP_Post object found, ID: {$post_data->ID}" );
                        
                        // Filter: only return if this post matches the subscribed ID
                        if ( $requested_id && $post_data->ID != $requested_id ) {
                            error_log( "WPGraphQL-SSE: Post ID {$post_data->ID} does not match requested ID {$requested_id}, filtering out" );
                            return null;
                        }
                        
                        error_log( "WPGraphQL-SSE: Post ID matches, returning WPGraphQL Model" );
                        return new \WPGraphQL\Model\Post( $post_data );
                    }
                }
                
                error_log( 'WPGraphQL-SSE: Event data found but could not extract valid post data' );
            } else {
                error_log( 'WPGraphQL-SSE: No postUpdated event data found in root' );
            }
            
            // For initial subscription setup, return null
            error_log( 'WPGraphQL-SSE: Returning null from resolver' );
            return null;
        }
    ]);
});

/**
 * Add the Subscription type to the schema.
 */
add_filter( 'graphql_schema_config', function( $config, $type_registry ) {
    $subscription_root = $type_registry->get_type( 'RootSubscription' );
    if ( $subscription_root ) {
        $config->setSubscription( $subscription_root );
    }
    return $config;
}, 10, 2 );