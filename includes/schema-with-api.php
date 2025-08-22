<?php
/**
 * Register Root Subscription type and fields using the registration API.
 */

// Include the registration API
require_once __DIR__ . '/subscription-registration.php';

add_action( 'graphql_register_types', function() {
    register_graphql_object_type(
        'RootSubscription',
        [
            'description' => __( 'Root subscription type. Entry point for all subscriptions.', 'wpgraphql-subscriptions' ),
            'fields'      => [], // Fields are added via register_graphql_subscription().
        ]
    );

    // Register postUpdated subscription using the API
    register_graphql_subscription( 'postUpdated', [
        'description' => __( 'Subscription for post updates.', 'wpgraphql-subscriptions' ),
        'type'        => 'Post',
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the post to subscribe to.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'data_extractors' => [
            [ 'WPGraphQL_Subscription_Data_Extractors', 'extract_post_data' ],
        ],
        'filter_callback' => [ 'WPGraphQL_Subscription_Filters', 'filter_post_by_id' ],
    ]);

    // Register commentCreated subscription using the API
    register_graphql_subscription( 'commentCreated', [
        'description' => __( 'Subscription for new comments on a specific node (post, page, custom post type, etc).', 'wpgraphql-subscriptions' ),
        'type'        => 'Comment',
        'args'        => [
            'nodeId' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the node to subscribe to comments for.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'data_extractors' => [
            [ 'WPGraphQL_Subscription_Data_Extractors', 'extract_comment_data' ],
        ],
        'filter_callback' => [ 'WPGraphQL_Subscription_Filters', 'filter_comment_by_node_id' ],
    ]);
    
    // Example: Register a userUpdated subscription (not connected to events yet)
    register_graphql_subscription( 'userUpdated', [
        'description' => __( 'Subscription for user profile updates.', 'wpgraphql-subscriptions' ),
        'type'        => 'User',
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __( 'The ID of the user to subscribe to.', 'wpgraphql-subscriptions' ),
            ],
        ],
        'data_extractors' => [
            [ 'WPGraphQL_Subscription_Data_Extractors', 'extract_user_data' ],
        ],
        'filter_callback' => [ 'WPGraphQL_Subscription_Filters', 'filter_user_by_id' ],
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
