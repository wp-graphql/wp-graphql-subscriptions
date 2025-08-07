<?php

class WPGraphQL_Subscriptions_Stream {
    
    /**
     * The connection ID for this stream.
     *
     * @var string
     */
    private $connection_id;
    
    /**
     * Event queue instance
     * 
     * @var WPGraphQL_Event_Queue
     */
    private $event_queue;
    
    /**
     * Last check timestamp for events
     * 
     * @var float
     */
    private $last_check_time;

    /**
     * Constructor for the Stream class.
     *
     * @param string $connection_id The unique identifier for this connection stream.
     */
    public function __construct( string $connection_id ) {
        $this->connection_id = $connection_id;
        $this->event_queue = WPGraphQL_Event_Queue::get_instance();
        $this->last_check_time = microtime(true);
        
        if ( ! $this->connection_id ) {
            return;
        }

        // Close the session to prevent blocking other requests.
        if ( session_status() === PHP_SESSION_ACTIVE ) {
            session_write_close();
        }

        $this->stream();
    }

    /**
     * In single connection mode, the stream is generic and doesn't need to load
     * any specific subscription data. It just delivers events for its connection ID.
     * This method is kept for clarity but is no longer strictly necessary.
     */
    private function get_connection_data() {
        // In the future, this could be used to validate the connection ID
        // or load connection-specific settings. For now, we just log.
        error_log( "WPGraphQL Subscriptions DEBUG: Starting stream for connection {$this->connection_id}" );
        return ['id' => $this->connection_id];
    }
    
    /**
     * Send a subscription event to the client using GraphQL over SSE protocol.
     * 
     * Emits 'next' events containing GraphQL ExecutionResult-compatible data
     * according to the GraphQL over SSE specification for single connection mode.
     * The event data will include the operationId for client-side routing.
     * 
     * @param array $event The event data containing type, data, and timestamp.
     * @return bool True if the event was sent successfully.
     * 
     * @see https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md
     */
    private function send_subscription_event( $event ) {
        
        try {
            error_log( "WPGraphQL Subscriptions DEBUG: Stream attempting to send event: " . wp_json_encode( array_keys( $event ) ) );
            
            if ( empty( $event['type'] ) || empty( $event['data'] ) ) {
                error_log( "WPGraphQL Subscriptions DEBUG: Stream event missing type or data" );
                return false;
            }
            
            // Convert internal event data to GraphQL ExecutionResult format
            $execution_result = $this->convert_to_execution_result( $event );
            
            // Emit 'next' event as per GraphQL over SSE protocol
            echo "event: next\n";
            echo "data: " . wp_json_encode( $execution_result ) . "\n\n";
            
            error_log( "WPGraphQL Subscriptions DEBUG: Stream successfully sent 'next' event for {$event['type']}" );
            
            return true;
            
        } catch ( \Exception $e ) {
            error_log( "WPGraphQL Subscriptions ERROR: Stream failed to send event: " . $e->getMessage() );
            return false;
        } catch ( \Error $e ) {
            error_log( "WPGraphQL Subscriptions ERROR: Stream fatal error sending event: " . $e->getMessage() );
            return false;
        }
    }
    
    /**
     * Convert internal event data to GraphQL ExecutionResult format for single connection mode.
     *
     * @param array $event The internal event data.
     * @return array GraphQL ExecutionResult-compatible array including the operationId.
     */
    private function convert_to_execution_result( $event ) {
        
        $event_data = $event['data'];
        $subscription_field = $this->get_subscription_field_from_event( $event );
        
        // Create GraphQL-compliant response structure
        $payload = [
            'data' => [
                $subscription_field => [
                    'id' => $event_data['node_id'],
                    'node_type' => $event_data['node_type'],
                    'action' => $event_data['action'],
                    'context' => $event_data['context'],
                    'metadata' => $event_data['metadata']
                ]
            ]
        ];
        
        // For now, return simple payload - in future this could include operationId
        return $payload;
    }
    
    /**
     * Extract subscription field name from event type.
     * 
     * @param array $event The event data.
     * @return string The subscription field name.
     */
    private function get_subscription_field_from_event( $event ) {
        
        // For now, map event types to subscription field names
        // This could be enhanced to read from subscription document
        $type_mapping = [
            'postUpdated' => 'postUpdated',
            'postCreated' => 'postCreated',
            'postDeleted' => 'postDeleted',
        ];
        
        return $type_mapping[ $event['type'] ] ?? $event['type'];
    }

    /**
     * Send a ping event to keep the connection alive.
     */
    private function send_ping() {
        echo "event: ping\n";
        $current_time = gmdate( DATE_ATOM );
        $process_id = getmypid();
        echo 'data: {"time": "' . $current_time . '", "connection_id": "' . $this->connection_id . '", "pid": "' . $process_id . '"}' . "\n\n";
    }

    /**
     * Clean up subscription data when the stream is closed.
     * In single connection mode, we don't clean up individual subscriptions here,
     * as the client manages their lifecycle via HTTP requests. We just log the closure.
     */
    private function cleanup_subscription() {
        error_log( "WPGraphQL Subscriptions DEBUG: Stream connection closed for {$this->connection_id}" );
    }

    /**
     * Start the Server-Sent Events stream.
     * 
     * This method initializes an event stream that will continuously check for
     * queued subscription events and send them to the client. It maintains a
     * persistent connection using Server-Sent Events (SSE) protocol.
     */
    public function stream() {

        // Set up Server-Sent Events headers
        if ( ! headers_sent() ) {
            ini_set( 'output_buffering', 0 );
            ini_set( 'implicit_flush', 1 );
            header( 'Content-Type: text/event-stream' );
            header( 'Cache-Control: no-cache' );
            header( 'Connection: keep-alive' );
            header( "X-Accel-Buffering: no" );
        }

        // Ensure session is closed
        if (session_id()) {
            session_write_close();
        }
        
        $process_id = getmypid();
        $ping_counter = 0;
        
        error_log("WPGraphQL Subscriptions: Starting SSE stream for connection {$this->connection_id} on process {$process_id}");
        
        // Send initial connection confirmation
        echo "event: connected\n";
        echo 'data: {"connection_id": "' . $this->connection_id . '", "pid": "' . $process_id . '"}' . "\n\n";
        flush();
        
        while (connection_status() === CONNECTION_NORMAL) {
            
            // Check for new events using database queue
            $this->process_queued_events();
            
            // Send ping every 30 seconds to keep connection alive
            $ping_counter++;
            if ($ping_counter >= 30) {
                $this->send_ping();
                $ping_counter = 0;
            } else {
                // Send heartbeat every second
                echo "event: heartbeat\n";
                echo 'data: {"time": "' . date(DATE_ISO8601) . '", "pid": "' . $process_id . '"}' . "\n\n";
            }
            
            // Flush output
            if (ob_get_level()) {
                ob_end_flush();
            }
            flush();

            // Check if client disconnected
            if (connection_aborted()) {
                error_log("WPGraphQL Subscriptions: Client disconnected from stream {$this->connection_id}");
                break;
            }

            sleep(1);
        }
        
        // Cleanup when stream ends
        $this->cleanup_subscription();
    }

    /**
     * Process any queued events for this subscription stream using database queue.
     * 
     * Checks the database for events since the last check and sends them to the client.
     * 
     * @return bool True if events were processed, false otherwise.
     */
    private function process_queued_events() {
        
        try {
            // Get events from database since last check
            $events = $this->event_queue->get_events_since($this->last_check_time);
            
            if (empty($events)) {
                return false;
            }
            
            error_log("WPGraphQL Subscriptions DEBUG: Found " . count($events) . " events to process");
            
            $processed_count = 0;
            
            // Process each event
            foreach ($events as $event) {
                error_log("WPGraphQL Subscriptions DEBUG: Processing event: " . wp_json_encode($event));
                
                if ($this->send_subscription_event($event)) {
                    $processed_count++;
                }
            }
            
            // Update last check time
            $this->last_check_time = microtime(true);
            
            if ($processed_count > 0) {
                error_log("WPGraphQL Subscriptions DEBUG: Successfully processed {$processed_count} events");
                return true;
            }
            
        } catch (Exception $e) {
            error_log("WPGraphQL Subscriptions ERROR: Failed to process queued events: " . $e->getMessage());
        }
        
        return false;
    }
}