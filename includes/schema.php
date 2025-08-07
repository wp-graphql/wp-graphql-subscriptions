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
            error_log( 'WPGraphQL-SSE: Root keys: ' . implode( ', ', array_keys( $root ) ) );
            
            // Get the requested post ID from subscription arguments
            $requested_id = isset( $args['id'] ) ? absint( $args['id'] ) : null;
            error_log( "WPGraphQL-SSE: Requested ID: {$requested_id}" );
            
            // If we have post data from the subscription event, return it
            if ( isset( $root['postUpdated'] ) ) {
                $post_data = $root['postUpdated'];
                error_log( 'WPGraphQL-SSE: Found postUpdated in root' );
                error_log( 'WPGraphQL-SSE: Post data type: ' . ( is_object( $post_data ) ? get_class( $post_data ) : gettype( $post_data ) ) );
                
                // If we have a WP_Post object directly, check if it matches the requested ID
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
                
                // If we have a post ID array, load the WP_Post and check ID
                if ( isset( $post_data['id'] ) ) {
                    error_log( "WPGraphQL-SSE: Post data array found, ID: {$post_data['id']}" );
                    $post = get_post( $post_data['id'] );
                    if ( $post && ! is_wp_error( $post ) ) {
                        // Filter: only return if this post matches the subscribed ID
                        if ( $requested_id && $post->ID != $requested_id ) {
                            error_log( "WPGraphQL-SSE: Post ID {$post->ID} does not match requested ID {$requested_id}, filtering out" );
                            return null;
                        }
                        
                        error_log( "WPGraphQL-SSE: Post ID matches, returning WPGraphQL Model from loaded post" );
                        return new \WPGraphQL\Model\Post( $post );
                    }
                }
                
                error_log( 'WPGraphQL-SSE: Post data found but could not process it' );
            } else {
                error_log( 'WPGraphQL-SSE: No postUpdated data found in root' );
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