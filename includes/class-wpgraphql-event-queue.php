<?php
/**
 * WPGraphQL Event Queue Database Implementation
 * 
 * Manages subscription events using a custom database table for reliable
 * cross-process event handling in Server-Sent Events streams.
 */

class WPGraphQL_Event_Queue {
    
    /**
     * Database table name for storing events
     * @var string
     */
    private $table_name;
    
    /**
     * Singleton instance
     * @var WPGraphQL_Event_Queue|null
     */
    private static $instance = null;
    
    /**
     * Constructor
     */
    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'wpgraphql_subscription_events';
    }
    
    /**
     * Get singleton instance
     * @return WPGraphQL_Event_Queue
     */
    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    /**
     * Create the events table
     * Call this on plugin activation
     */
    public function create_table() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        
        $sql = "CREATE TABLE {$this->table_name} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            subscription_type varchar(50) NOT NULL,
            node_id bigint(20) unsigned NULL,
            event_data longtext NOT NULL,
            created_at datetime NOT NULL,
            processed_at datetime NULL,
            PRIMARY KEY (id),
            KEY idx_subscription_type (subscription_type),
            KEY idx_created_at (created_at),
            KEY idx_processed (processed_at),
            KEY idx_node_id (node_id),
            KEY idx_type_created (subscription_type, created_at),
            KEY idx_unprocessed (processed_at, created_at)
        ) $charset_collate;";
        
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
        
        // Verify table was created
        $table_exists = $wpdb->get_var("SHOW TABLES LIKE '{$this->table_name}'");
        if ($table_exists !== $this->table_name) {
            error_log("WPGraphQL Subscriptions: Failed to create events table");
            return false;
        }
        
        error_log("WPGraphQL Subscriptions: Events table created successfully");
        return true;
    }
    
    /**
     * Add an event to the queue
     * 
     * @param string $subscription_type The subscription event type (e.g., 'postUpdated')
     * @param int|null $node_id The ID of the affected node
     * @param array $event_data The complete event payload
     * @return int|false The event ID if successful, false on failure
     */
    public function add_event($subscription_type, $node_id, $event_data) {
        global $wpdb;
        
        $result = $wpdb->insert(
            $this->table_name,
            [
                'subscription_type' => $subscription_type,
                'node_id' => $node_id,
                'event_data' => wp_json_encode($event_data),
                'created_at' => current_time('mysql', true)
            ],
            ['%s', '%d', '%s', '%s']
        );
        
        if ($result === false) {
            error_log("WPGraphQL Subscriptions: Failed to add event to queue: " . $wpdb->last_error);
            return false;
        }
        
        $event_id = $wpdb->insert_id;
        error_log("WPGraphQL Subscriptions: Added event #{$event_id} ({$subscription_type}) to queue");
        
        return $event_id;
    }
    
    /**
     * Get events since a timestamp (without marking as processed)
     * 
     * @param float $since_timestamp Unix timestamp to get events since
     * @param string|null $subscription_type Optional filter by subscription type
     * @return array Array of event data
     */
    public function get_events_since($since_timestamp, $subscription_type = null) {
        global $wpdb;
        
        $sql = "SELECT id, subscription_type, node_id, event_data, created_at 
                FROM {$this->table_name} 
                WHERE created_at > %s";
        
        // Fix float to int precision loss by using floor()
        $params = [date('Y-m-d H:i:s', (int) floor($since_timestamp))];
        
        if ($subscription_type) {
            $sql .= " AND subscription_type = %s";
            $params[] = $subscription_type;
        }
        
        $sql .= " ORDER BY created_at ASC LIMIT 50"; // Limit to prevent overwhelming
        
        $events = $wpdb->get_results($wpdb->prepare($sql, $params));
        
        if (empty($events)) {
            return [];
        }
        
        $processed_events = [];
        
        foreach ($events as $event) {
            $processed_events[] = [
                'id' => $event->id,
                'type' => $event->subscription_type,
                'node_id' => $event->node_id,
                'data' => json_decode($event->event_data, true),
                'created_at' => $event->created_at
            ];
        }
        
        error_log("WPGraphQL Subscriptions: Retrieved " . count($processed_events) . " events from queue since " . date('Y-m-d H:i:s', (int) floor($since_timestamp)));
        
        return $processed_events;
    }
    
    /**
     * Get events for a specific subscription type and node ID
     * 
     * @param string $subscription_type The subscription type to filter by
     * @param int $node_id The node ID to filter by
     * @param float $since_timestamp Optional timestamp to get events since
     * @return array Array of matching events
     */
    public function get_events_for_subscription($subscription_type, $node_id, $since_timestamp = 0) {
        global $wpdb;
        
        $sql = "SELECT id, subscription_type, node_id, event_data, created_at 
                FROM {$this->table_name} 
                WHERE processed_at IS NULL 
                AND subscription_type = %s 
                AND node_id = %d";
        
        $params = [$subscription_type, $node_id];
        
        if ($since_timestamp > 0) {
            $sql .= " AND created_at > %s";
            $params[] = date('Y-m-d H:i:s', (int) floor($since_timestamp));
        }
        
        $sql .= " ORDER BY created_at ASC LIMIT 20";
        
        $events = $wpdb->get_results($wpdb->prepare($sql, $params));
        
        if (empty($events)) {
            return [];
        }
        
        $processed_events = [];
        $event_ids = [];
        
        foreach ($events as $event) {
            $event_ids[] = $event->id;
            $processed_events[] = [
                'id' => $event->id,
                'type' => $event->subscription_type,
                'node_id' => $event->node_id,
                'data' => json_decode($event->event_data, true),
                'created_at' => $event->created_at
            ];
        }
        
        // Mark as processed
        $this->mark_events_processed($event_ids);
        
        return $processed_events;
    }
    
    /**
     * Mark events as processed
     * 
     * @param array $event_ids Array of event IDs to mark as processed
     * @return bool Success status
     */
    private function mark_events_processed($event_ids) {
        global $wpdb;
        
        if (empty($event_ids)) {
            return true;
        }
        
        $placeholders = implode(',', array_fill(0, count($event_ids), '%d'));
        $sql = "UPDATE {$this->table_name} 
                SET processed_at = %s 
                WHERE id IN ({$placeholders})";
        
        $params = array_merge([current_time('mysql', true)], $event_ids);
        
        $result = $wpdb->query($wpdb->prepare($sql, $params));
        
        if ($result === false) {
            error_log("WPGraphQL Subscriptions: Failed to mark events as processed: " . $wpdb->last_error);
            return false;
        }
        
        error_log("WPGraphQL Subscriptions: Marked " . count($event_ids) . " events as processed");
        return true;
    }
    
    /**
     * Clean up old events (both processed and unprocessed)
     * 
     * @param int $hours Number of hours old to clean up (default 24)
     * @return int Number of events cleaned up
     */
    public function cleanup_old_events($hours = 24) {
        global $wpdb;
        
        $cutoff_time = date('Y-m-d H:i:s', time() - ($hours * 3600));
        
        $result = $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$this->table_name} 
                 WHERE created_at < %s",
                $cutoff_time
            )
        );
        
        if ($result === false) {
            error_log("WPGraphQL Subscriptions: Failed to cleanup old events: " . $wpdb->last_error);
            return 0;
        }
        
        error_log("WPGraphQL Subscriptions: Cleaned up {$result} old events");
        return (int) $result;
    }
    
    /**
     * Get queue statistics
     * 
     * @return array Statistics about the event queue
     */
    public function get_queue_stats() {
        global $wpdb;
        
        $stats = $wpdb->get_row(
            "SELECT 
                COUNT(*) as total_events,
                COUNT(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 END) as recent_events,
                MIN(created_at) as oldest_event,
                MAX(created_at) as newest_event
             FROM {$this->table_name}",
            ARRAY_A
        );
        
        return $stats ?: [
            'total_events' => 0,
            'recent_events' => 0,
            'oldest_event' => null,
            'newest_event' => null
        ];
    }
    
    /**
     * Drop the events table
     * Use with caution - this will delete all event data
     */
    public function drop_table() {
        global $wpdb;
        
        $result = $wpdb->query("DROP TABLE IF EXISTS {$this->table_name}");
        
        if ($result === false) {
            error_log("WPGraphQL Subscriptions: Failed to drop events table: " . $wpdb->last_error);
            return false;
        }
        
        error_log("WPGraphQL Subscriptions: Events table dropped successfully");
        return true;
    }
}