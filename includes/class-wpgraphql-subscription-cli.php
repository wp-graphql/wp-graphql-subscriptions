<?php
/**
 * WP-CLI Commands for WPGraphQL Subscriptions
 */

if (!class_exists('WP_CLI')) {
    return;
}

class WPGraphQL_Subscription_CLI extends WP_CLI_Command {
    
    /**
     * Show subscription queue statistics
     * 
     * ## EXAMPLES
     * 
     *     wp wpgraphql subscription stats
     */
    public function stats($args, $assoc_args) {
        $event_queue = WPGraphQL_Event_Queue::get_instance();
        $stats = $event_queue->get_queue_stats();
        
        WP_CLI::line('WPGraphQL Subscription Queue Statistics:');
        WP_CLI::line('=====================================');
        WP_CLI::line('Total Events: ' . $stats['total_events']);
        WP_CLI::line('Unprocessed Events: ' . $stats['unprocessed_events']);
        WP_CLI::line('Processed Events: ' . $stats['processed_events']);
        WP_CLI::line('Oldest Event: ' . ($stats['oldest_event'] ?: 'None'));
        WP_CLI::line('Newest Event: ' . ($stats['newest_event'] ?: 'None'));
    }
    
    /**
     * Clean up old processed events
     * 
     * ## OPTIONS
     * 
     * [--hours=<hours>]
     * : Number of hours old events must be to get cleaned up. Default: 24
     * 
     * ## EXAMPLES
     * 
     *     wp wpgraphql subscription cleanup
     *     wp wpgraphql subscription cleanup --hours=6
     */
    public function cleanup($args, $assoc_args) {
        $hours = isset($assoc_args['hours']) ? (int) $assoc_args['hours'] : 24;
        
        $event_queue = WPGraphQL_Event_Queue::get_instance();
        $cleaned = $event_queue->cleanup_old_events($hours);
        
        WP_CLI::success("Cleaned up {$cleaned} events older than {$hours} hours.");
    }
    
    /**
     * Create the subscription events table
     * 
     * ## EXAMPLES
     * 
     *     wp wpgraphql subscription create-table
     */
    public function create_table($args, $assoc_args) {
        $event_queue = WPGraphQL_Event_Queue::get_instance();
        
        if ($event_queue->create_table()) {
            WP_CLI::success('Subscription events table created successfully.');
        } else {
            WP_CLI::error('Failed to create subscription events table.');
        }
    }
    
    /**
     * Drop the subscription events table (WARNING: This deletes all data!)
     * 
     * [--yes]
     * : Skip confirmation prompt
     * 
     * ## EXAMPLES
     * 
     *     wp wpgraphql subscription drop-table --yes
     */
    public function drop_table($args, $assoc_args) {
        if (!isset($assoc_args['yes'])) {
            WP_CLI::confirm('This will permanently delete all subscription event data. Are you sure?');
        }
        
        $event_queue = WPGraphQL_Event_Queue::get_instance();
        
        if ($event_queue->drop_table()) {
            WP_CLI::success('Subscription events table dropped successfully.');
        } else {
            WP_CLI::error('Failed to drop subscription events table.');
        }
    }
    
    /**
     * Test event emission
     * 
     * ## OPTIONS
     * 
     * [--type=<type>]
     * : Event type to emit. Default: postUpdated
     * 
     * [--node-id=<id>]
     * : Node ID for the event. Default: 1
     * 
     * ## EXAMPLES
     * 
     *     wp wpgraphql subscription test-event
     *     wp wpgraphql subscription test-event --type=postCreated --node-id=123
     */
    public function test_event($args, $assoc_args) {
        $event_type = isset($assoc_args['type']) ? $assoc_args['type'] : 'postUpdated';
        $node_id = isset($assoc_args['node-id']) ? (int) $assoc_args['node-id'] : 1;
        
        // Create test payload
        $payload = [
            'node_type' => 'post',
            'action' => 'UPDATE',
            'node_id' => $node_id,
            'context' => [
                'post_type' => 'post',
                'test' => true
            ],
            'metadata' => [
                'timestamp' => time(),
                'event_id' => 'test_' . uniqid(),
                'user_id' => 0,
                'hook' => 'wp_cli_test'
            ]
        ];
        
        // Emit the event
        WPGraphQL_Event_Emitter::emit('post', 'UPDATE', $node_id, $payload['context'], $payload['metadata']);
        
        WP_CLI::success("Test event '{$event_type}' emitted for node {$node_id}");
    }
}

// Register the CLI commands
WP_CLI::add_command('wpgraphql subscription', 'WPGraphQL_Subscription_CLI');