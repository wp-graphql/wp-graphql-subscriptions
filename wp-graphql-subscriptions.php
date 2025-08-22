<?php
/**
 * Plugin Name: WPGraphQL Subscriptions
 * Description: (EXPERIMENTAL) Subscriptions for WPGraphQL
 * Author: WPGraphQL
 * Author URI: https://www.wpgraphql.com
 * Version: 0.3.0
 * Text Domain: wp-graphql-subscriptions
 * Domain Path: /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Transport Events
require_once __DIR__ . '/includes/transport-webhook.php';

// Subscription Security (token validation for sidecar)
error_log('WPGraphQL Subscriptions: About to load subscription-security.php');
require_once __DIR__ . '/includes/subscription-security.php';
error_log('WPGraphQL Subscriptions: Finished loading subscription-security.php');

// Include the Subscription Manager class.
require_once __DIR__ . '/includes/class-wpgraphql-subscription-manager.php';

// Include the Stream class.
require_once __DIR__ . '/includes/class-wpgraphql-subscriptions-stream.php';

// Include the Event Emitter class.
require_once __DIR__ . '/includes/class-wpgraphql-event-emitter.php';

// Include the Event Queue class.
require_once __DIR__ . '/includes/class-wpgraphql-event-queue.php';

// Include the Subscription Registration API.
require_once __DIR__ . '/includes/subscription-registration.php';

// Include the GraphQL subscription channel mapper.
require_once __DIR__ . '/includes/class-wpgraphql-subscription-channel-mapper.php';

// Include the Subscription Storage interface.
require_once __DIR__ . '/includes/interface-wpgraphql-subscription-storage.php';

// Include the Database Storage implementation.
require_once __DIR__ . '/includes/class-wpgraphql-subscription-database-storage.php';

// Include the Subscription Connection class.
require_once __DIR__ . '/includes/class-wpgraphql-subscription-connection.php';

// Include the Connection Manager class.
require_once __DIR__ . '/includes/class-wpgraphql-connection-manager.php';

// Include the Event Stream class.
require_once __DIR__ . '/includes/event-stream.php';

// Modify the WPGraphQL Schema to include the Subscription type.
require_once __DIR__ . '/includes/schema.php';

// Track and Emit Events
require_once __DIR__ . '/includes/events.php';

new WPGraphQL_Subscription_Manager();  

/**
 * Initialize plugin on plugins_loaded
 */
add_action('plugins_loaded', function() {
    // Ensure tables exist on every page load (for development)
    // In production, you'd only do this on activation
    
    // Event queue table
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    global $wpdb;
    $events_table = $wpdb->prefix . 'wpgraphql_subscription_events';
    $events_table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$events_table}'") === $events_table;
    
    if (!$events_table_exists) {
        error_log('WPGraphQL Subscriptions: Events table does not exist, creating...');
        $event_queue->create_table();
    }
    
    // Subscription storage tables
    $storage = new WPGraphQL_Subscription_Database_Storage();
    $connections_table = $wpdb->prefix . 'wpgraphql_subscription_connections';
    $subscriptions_table = $wpdb->prefix . 'wpgraphql_subscription_documents';
    
    $connections_exists = $wpdb->get_var("SHOW TABLES LIKE '{$connections_table}'") === $connections_table;
    $subscriptions_exists = $wpdb->get_var("SHOW TABLES LIKE '{$subscriptions_table}'") === $subscriptions_table;
    
    if (!$connections_exists || !$subscriptions_exists) {
        error_log('WPGraphQL Subscriptions: Subscription storage tables do not exist, creating...');
        $storage->create_tables();
    }
});

/**
 * Schedule cleanup of expired connections
 */
add_action('init', function() {
    if (!wp_next_scheduled('wpgraphql_subscription_cleanup')) {
        wp_schedule_event(time(), 'hourly', 'wpgraphql_subscription_cleanup');
    }
});

add_action('wpgraphql_subscription_cleanup', function() {
    $connection_manager = WPGraphQL_Connection_Manager::get_instance();
    $cleaned = $connection_manager->cleanup_stale_connections();
    if ($cleaned > 0) {
        error_log("WPGraphQL Subscriptions: Scheduled cleanup removed {$cleaned} expired connections");
    }
});

/**
 * Initialize the GraphQL subscription channel mapper
 */
add_action('init', function() {
    WPGraphQL_Subscription_Channel_Mapper::init();
});

/**
 * Add GraphQL-SSE endpoint rewrite rules
 */
add_action('init', function() {
    // Add rewrite rules for GraphQL-SSE endpoint - handle both with and without trailing slash
    add_rewrite_rule(
        '^graphql/stream$',
        'index.php?graphql_sse_endpoint=1',
        'top'
    );
    
    add_rewrite_rule(
        '^graphql/stream/$',
        'index.php?graphql_sse_endpoint=1',
        'top'
    );
    
    // Add rewrite rules for WP JSON API style endpoint (alternative)
    add_rewrite_rule(
        '^wp-json/graphql/v1/stream$', 
        'index.php?graphql_sse_endpoint=1',
        'top'
    );
    
    add_rewrite_rule(
        '^wp-json/graphql/v1/stream/$', 
        'index.php?graphql_sse_endpoint=1',
        'top'
    );
});

/**
 * Add query vars for GraphQL-SSE endpoint
 */
add_filter('query_vars', function($vars) {
    $vars[] = 'graphql_sse_endpoint';
    return $vars;
});

/**
 * Handle GraphQL-SSE endpoint requests
 */
add_action('parse_request', function($wp) {
    if (array_key_exists('graphql_sse_endpoint', $wp->query_vars)) {
        // This is a GraphQL-SSE endpoint request
        // The actual handling is done in event-stream.php via template_redirect
        return;
    }
});

/**
 * Prevent WordPress from redirecting GraphQL-SSE endpoints to add trailing slashes
 */
add_filter('redirect_canonical', function($redirect_url, $requested_url) {
    // Check if this is a GraphQL-SSE endpoint request
    if (strpos($requested_url, '/graphql/stream') !== false || 
        strpos($requested_url, '/wp-json/graphql/v1/stream') !== false) {
        // Don't redirect - handle as-is
        return false;
    }
    return $redirect_url;
}, 10, 2);

/**
 * Plugin activation hook - create database table and flush rewrite rules
 */
function wpgraphql_subscriptions_activate() {
    error_log('WPGraphQL Subscriptions: Plugin activated, creating table...');
    
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    $success = $event_queue->create_table();
    
    if ($success) {
        error_log('WPGraphQL Subscriptions: Table created successfully on activation');
    } else {
        error_log('WPGraphQL Subscriptions: Failed to create table on activation');
    }
    
    // Schedule cleanup cron job
    if (!wp_next_scheduled('wpgraphql_cleanup_events')) {
        wp_schedule_event(time(), 'hourly', 'wpgraphql_cleanup_events');
        error_log('WPGraphQL Subscriptions: Scheduled cleanup cron job');
    }
    
    // Flush rewrite rules to ensure our endpoint is recognized
    flush_rewrite_rules();
    error_log('WPGraphQL Subscriptions: Flushed rewrite rules');
}

/**
 * Plugin deactivation hook - cleanup
 */
function wpgraphql_subscriptions_deactivate() {
    // Clear scheduled cleanup
    wp_clear_scheduled_hook('wpgraphql_cleanup_events');
    
    // Flush rewrite rules to clean up our endpoints
    flush_rewrite_rules();
    
    error_log('WPGraphQL Subscriptions: Plugin deactivated, cleared scheduled tasks and rewrite rules');
}

// Register activation and deactivation hooks
register_activation_hook(__FILE__, 'wpgraphql_subscriptions_activate');
register_deactivation_hook(__FILE__, 'wpgraphql_subscriptions_deactivate');

/**
 * Cleanup cron job - runs hourly to remove old events
 */
add_action('wpgraphql_cleanup_events', function() {
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    $cleaned = $event_queue->cleanup_old_events(1); // Clean up events older than 1 hour (more aggressive)
    
    if ($cleaned > 0) {
        error_log("WPGraphQL Subscriptions: Cleaned up {$cleaned} old events");
    }
});

/**
 * Add admin page to view queue statistics (only in debug mode)
 */
add_action('admin_menu', function() {
    if (class_exists('WPGraphQL') && WPGraphQL::debug()) {
        add_submenu_page(
            'graphql-tools',
            'Subscription Queue',
            'Subscription Queue',
            'manage_options',
            'wpgraphql-subscription-queue',
            'wpgraphql_subscription_queue_page'
        );
    }
});

/**
 * Admin page callback to show queue statistics
 */
function wpgraphql_subscription_queue_page() {
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    $stats = $event_queue->get_queue_stats();
    
    echo '<div class="wrap">';
    echo '<h1>WPGraphQL Subscription Queue</h1>';
    echo '<div class="card">';
    echo '<h2>Queue Statistics</h2>';
    echo '<table class="wp-list-table widefat fixed striped">';
    echo '<tr><td><strong>Total Events:</strong></td><td>' . $stats['total_events'] . '</td></tr>';
    echo '<tr><td><strong>Recent Events (1 hour):</strong></td><td>' . $stats['recent_events'] . '</td></tr>';
    echo '<tr><td><strong>Oldest Event:</strong></td><td>' . ($stats['oldest_event'] ?: 'None') . '</td></tr>';
    echo '<tr><td><strong>Newest Event:</strong></td><td>' . ($stats['newest_event'] ?: 'None') . '</td></tr>';
    echo '</table>';
    echo '</div>';
    
    // Manual cleanup button
    if (isset($_POST['cleanup_events'])) {
        check_admin_referer('wpgraphql_cleanup_events');
        $cleaned = $event_queue->cleanup_old_events(1); // Clean up events older than 1 hour
        echo '<div class="notice notice-success"><p>Cleaned up ' . $cleaned . ' old events.</p></div>';
    }
    
    echo '<div class="card">';
    echo '<h2>Manual Cleanup</h2>';
    echo '<form method="post">';
    wp_nonce_field('wpgraphql_cleanup_events');
    echo '<p><input type="submit" name="cleanup_events" class="button button-secondary" value="Clean Up Old Events" /></p>';
    echo '<p class="description">This will remove events older than 1 hour.</p>';
    echo '</form>';
    echo '</div>';
    
    echo '</div>';
}

/**
 * Add WP-CLI commands (if WP-CLI is available)
 */
if (defined('WP_CLI') && WP_CLI) {
    require_once __DIR__ . '/includes/class-wpgraphql-subscription-cli.php';
}