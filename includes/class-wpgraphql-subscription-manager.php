<?php

class WPGraphQL_Subscription_Manager {

    public function __construct() {

        // Register post types and taxonomies to track subscriptions.
        add_action( 'init', [ $this, 'register_post_types' ] );
        add_action( 'init', [ $this, 'register_taxonomies' ] );

        add_action( 'graphql_subscription_event', [ $this, 'handle_subscription_event' ], 10, 2 );

    }

    public function register_post_types() {
        register_post_type( 'gql_subscription', [
            'labels' => [
                'name' => 'GraphQL Subscriptions',
                'singular_name' => 'GraphQL Subscription',
            ],
            'public' => false,
            'show_ui' => class_exists( 'WPGraphQL' ) && WPGraphQL::debug() ? true : false,
            'show_in_menu' => class_exists( 'WPGraphQL' ) && WPGraphQL::debug() ? true : false,
            'show_in_admin_bar' => false,
            'show_in_rest' => false,
            'has_archive' => false,
            'rewrite' => false,
            'taxonomies' => [ 'gql_subscription_type' ],
        ] );
    }

    public function register_taxonomies() {
        register_taxonomy( 'gql_subscription_type', 'gql_subscription', [
            'labels' => [
                'name' => 'GraphQL Subscription Types',
                'singular_name' => 'GraphQL Subscription Type',
            ],
            'public' => false,
            'show_ui' => class_exists( 'WPGraphQL' ) && WPGraphQL::debug() ? true : false,
            'show_in_menu' => class_exists( 'WPGraphQL' ) && WPGraphQL::debug() ? true : false,
            'show_in_admin_bar' => false,
            'show_in_rest' => false,
            'has_archive' => false,
            'rewrite' => false,
        ] );
    }

    public function handle_subscription_event( $event_type, $payload ) {
        error_log( 'subscription event ' . $event_type );
        error_log( json_encode( $payload ) );

        // get all active subscriptions for the event type
        $subscriptions = get_posts( [
            'post_type' => 'gql_subscription',
            'tax_query' => [
                [
                    'taxonomy' => 'gql_subscription_type',
                    'field' => 'slug',
                    'terms' => $event_type,
                ],
            ],
        ] );

        error_log( 'subscriptions ' . json_encode( $subscriptions ) );

        // send the event to each subscription
    }
}