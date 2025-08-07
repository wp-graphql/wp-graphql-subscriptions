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