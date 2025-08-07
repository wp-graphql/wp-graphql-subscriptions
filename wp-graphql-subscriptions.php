<?php
/**
 * Plugin Name: WPGraphQL Subscriptions
 * Description: (EXPERIMENTAL) Subscriptions for WPGraphQL
 * Author: WPGraphQL
 * Author URI: https://www.wpgraphql.com
 * Version: 0.1.0
 * Text Domain: wp-graphql-subscriptions
 * Domain Path: /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Transport Events
require_once __DIR__ . '/includes/transport-webhook.php';

// Include the Subscription Manager class.
require_once __DIR__ . '/includes/class-wpgraphql-subscription-manager.php';

// Include the Stream class.
require_once __DIR__ . '/includes/class-wpgraphql-subscriptions-stream.php';

// Include the Event Emitter class.
require_once __DIR__ . '/includes/class-wpgraphql-event-emitter.php';

// Include the Event Queue class.
require_once __DIR__ . '/includes/class-wpgraphql-event-queue.php';

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
    // Ensure table exists on every page load (for development)
    // In production, you'd only do this on activation
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    
    // Check if table exists
    global $wpdb;
    $table_name = $wpdb->prefix . 'wpgraphql_subscription_events';
    $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$table_name}'") === $table_name;
    
    if (!$table_exists) {
        error_log('WPGraphQL Subscriptions: Table does not exist, creating...');
        $event_queue->create_table();
    }
});

/**
 * Plugin activation hook - create database table
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
}

/**
 * Plugin deactivation hook - cleanup
 */
function wpgraphql_subscriptions_deactivate() {
    // Clear scheduled cleanup
    wp_clear_scheduled_hook('wpgraphql_cleanup_events');
    error_log('WPGraphQL Subscriptions: Plugin deactivated, cleared scheduled tasks');
}

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