<?php
/**
 * Example: Custom Subscriptions using the Registration API
 * 
 * This file demonstrates how easy it is to add new subscription types
 * using the register_graphql_subscription() API.
 */

// This would typically be in a theme's functions.php or a plugin file

add_action( 'graphql_register_types', function() {
    
    // Example 1: Subscribe to WooCommerce order status changes
    if ( class_exists( 'WooCommerce' ) ) {
        register_graphql_subscription( 'orderStatusChanged', [
            'description' => __( 'Subscription for order status changes.', 'wpgraphql-subscriptions' ),
            'type'        => 'Order', // Assumes WooCommerce GraphQL types are available
            'args'        => [
                'orderId' => [
                    'type'        => 'ID',
                    'description' => __( 'The ID of the order to subscribe to.', 'wpgraphql-subscriptions' ),
                ],
            ],
            'data_extractors' => [
                function( $event_data ) {
                    // Custom extractor for WooCommerce orders
                    if ( is_array( $event_data ) && isset( $event_data['order'] ) ) {
                        $order = $event_data['order'];
                        if ( $order instanceof WC_Order ) {
                            return new \WPGraphQL\WooCommerce\Model\Order( $order );
                        }
                    }
                    return null;
                }
            ],
            'filter_callback' => function( $order_model, $args ) {
                if ( ! isset( $args['orderId'] ) ) {
                    return true;
                }
                return $order_model->ID === absint( $args['orderId'] );
            },
        ]);
    }
    
    // Example 2: Subscribe to custom post type updates
    register_graphql_subscription( 'productUpdated', [
        'description' => __( 'Subscription for product updates.', 'wpgraphql-subscriptions' ),
        'type'        => 'Product', // Custom post type
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the product to subscribe to.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'data_extractors' => [
            // Reuse the standard post extractor since products are posts
            [ 'WPGraphQL_Subscription_Data_Extractors', 'extract_post_data' ],
        ],
        'filter_callback' => function( $post_model, $args ) {
            // Filter by ID and ensure it's a product post type
            if ( isset( $args['id'] ) && $post_model->ID !== absint( $args['id'] ) ) {
                return false;
            }
            return $post_model->post_type === 'product';
        },
    ]);
    
    // Example 3: Subscribe to media uploads
    register_graphql_subscription( 'mediaUploaded', [
        'description' => __( 'Subscription for new media uploads.', 'wpgraphql-subscriptions' ),
        'type'        => 'MediaItem',
        'args'        => [
            'mimeType' => [
                'type'        => 'String',
                'description' => __( 'Filter by MIME type (e.g., "image/jpeg").', 'wpgraphql-subscriptions' ),
            ],
        ],
        'event_key'       => 'mediaCreated', // Event emitted as 'mediaCreated'
        'data_extractors' => [
            function( $event_data ) {
                // Media items are attachments (posts)
                if ( is_array( $event_data ) && isset( $event_data['post'] ) ) {
                    $post = $event_data['post'];
                    if ( $post && $post->post_type === 'attachment' ) {
                        return new \WPGraphQL\Model\Post( $post );
                    }
                }
                return null;
            }
        ],
        'filter_callback' => function( $media_model, $args ) {
            if ( isset( $args['mimeType'] ) ) {
                return $media_model->post_mime_type === $args['mimeType'];
            }
            return true;
        },
    ]);
    
    // Example 4: Subscribe to taxonomy term updates
    register_graphql_subscription( 'categoryUpdated', [
        'description' => __( 'Subscription for category updates.', 'wpgraphql-subscriptions' ),
        'type'        => 'Category',
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the category to subscribe to.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'data_extractors' => [
            function( $event_data ) {
                // Custom extractor for taxonomy terms
                if ( is_array( $event_data ) && isset( $event_data['term'] ) ) {
                    $term = $event_data['term'];
                    if ( $term instanceof WP_Term && $term->taxonomy === 'category' ) {
                        return new \WPGraphQL\Model\Term( $term );
                    }
                }
                return null;
            }
        ],
        'filter_callback' => [ 'WPGraphQL_Subscription_Filters', 'filter_term_by_id' ], // Would need to be implemented
    ]);
    
    // Example 5: Subscribe to user login events
    register_graphql_subscription( 'userLoggedIn', [
        'description' => __( 'Subscription for user login events.', 'wpgraphql-subscriptions' ),
        'type'        => 'User',
        'args'        => [
            'role' => [
                'type'        => 'String',
                'description' => __( 'Filter by user role.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'event_key'       => 'userLogin', // Different event key
        'data_extractors' => [
            [ 'WPGraphQL_Subscription_Data_Extractors', 'extract_user_data' ],
        ],
        'filter_callback' => function( $user_model, $args ) {
            if ( isset( $args['role'] ) ) {
                return in_array( $args['role'], $user_model->roles ?? [] );
            }
            return true;
        },
    ]);
});

/**
 * Example: Hook into WordPress events to emit custom subscription events
 */

// Emit events for the custom subscriptions above
add_action( 'woocommerce_order_status_changed', function( $order_id, $old_status, $new_status ) {
    if ( class_exists( 'WPGraphQL_Event_Emitter' ) ) {
        WPGraphQL_Event_Emitter::emit(
            'order',
            'UPDATE',
            $order_id,
            [
                'order' => wc_get_order( $order_id ),
                'old_status' => $old_status,
                'new_status' => $new_status,
            ],
            [
                'hook' => 'woocommerce_order_status_changed',
            ]
        );
    }
}, 10, 3 );

add_action( 'wp_login', function( $user_login, $user ) {
    if ( class_exists( 'WPGraphQL_Event_Emitter' ) ) {
        WPGraphQL_Event_Emitter::emit(
            'user',
            'LOGIN', // Custom action type
            $user->ID,
            [
                'user' => $user,
                'login_time' => current_time( 'mysql' ),
            ],
            [
                'hook' => 'wp_login',
            ]
        );
    }
}, 10, 2 );

add_action( 'add_attachment', function( $attachment_id ) {
    if ( class_exists( 'WPGraphQL_Event_Emitter' ) ) {
        $attachment = get_post( $attachment_id );
        WPGraphQL_Event_Emitter::emit(
            'media',
            'CREATE',
            $attachment_id,
            [
                'post' => $attachment,
                'file_url' => wp_get_attachment_url( $attachment_id ),
                'metadata' => wp_get_attachment_metadata( $attachment_id ),
            ],
            [
                'hook' => 'add_attachment',
            ]
        );
    }
});

/**
 * Example GraphQL queries that would work with these subscriptions:
 * 
 * # WooCommerce order updates
 * subscription OrderStatusChanged($orderId: ID!) {
 *   orderStatusChanged(orderId: $orderId) {
 *     id
 *     status
 *     total
 *     customer { name email }
 *   }
 * }
 * 
 * # Product updates  
 * subscription ProductUpdated($id: ID!) {
 *   productUpdated(id: $id) {
 *     id
 *     title
 *     price
 *     stockQuantity
 *   }
 * }
 * 
 * # Media uploads
 * subscription MediaUploaded($mimeType: String) {
 *   mediaUploaded(mimeType: $mimeType) {
 *     id
 *     title
 *     sourceUrl
 *     mimeType
 *   }
 * }
 * 
 * # User logins by role
 * subscription UserLoggedIn($role: String) {
 *   userLoggedIn(role: $role) {
 *     id
 *     name
 *     email
 *     roles
 *   }
 * }
 */
