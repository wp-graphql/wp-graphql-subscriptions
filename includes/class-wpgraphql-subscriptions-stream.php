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
     * Constructor for the GraphQL-SSE Stream
     *
     * @param string $connection_id The reservation token/connection ID
     * @throws InvalidArgumentException If connection_id is empty
     */
    public function __construct( string $connection_id ) {
        
        if ( empty( $connection_id ) ) {
            throw new InvalidArgumentException( 'Connection ID cannot be empty' );
        }
        
        $this->connection_id = $connection_id;
        $this->event_queue = WPGraphQL_Event_Queue::get_instance();
        $this->last_check_time = microtime( true );

        // Start the stream immediately
        $this->stream();
    }

    /**
     * Validate and initialize the connection
     * 
     * @return array Connection metadata
     * @throws InvalidArgumentException If connection is invalid
     */
    private function validate_connection() {
        
        if ( empty( $this->connection_id ) ) {
            throw new InvalidArgumentException( 'Connection ID cannot be empty' );
        }
        
        // Validate reservation token exists and is not expired
        if ( ! validate_reservation_token( $this->connection_id ) ) {
            throw new InvalidArgumentException( 'Invalid or expired reservation token' );
        }
        
        $this->log_info( "Starting GraphQL-SSE stream for connection {$this->connection_id}" );
        
        return [
            'id' => $this->connection_id,
            'started_at' => microtime( true ),
            'protocol' => 'GraphQL-SSE'
        ];
    }
    
    /**
     * Process and send GraphQL-SSE events
     * 
     * @param array $event The event data
     * @return bool True if the event was sent successfully
     */
    private function process_event( array $event ): bool {
        
        if ( ! $this->validate_event( $event ) ) {
            return false;
        }
        
        try {
            // Handle GraphQL operation results (single connection mode)
            if ( $event['type'] === 'graphql_operation_result' ) {
                return $this->send_operation_result( $event );
            }
            
            // Handle subscription events - these should have operation IDs
            if ( empty( $event['operation_id'] ) ) {
                $this->log_warning( "Event missing operation_id, skipping: " . $event['type'] );
                return false;
            }
            
            $execution_result = $this->convert_to_execution_result( $event );
            $this->send_next_event( $event['operation_id'], $execution_result );
            
            $this->log_debug( "Sent GraphQL-SSE event for operation {$event['operation_id']}" );
            return true;
            
        } catch ( \Exception $e ) {
            $this->log_error( "Failed to process event: " . $e->getMessage() );
            return false;
        }
    }
    
    /**
     * Validate event data structure
     * 
     * @param array $event
     * @return bool
     */
    private function validate_event( array $event ): bool {
        
        if ( empty( $event['type'] ) ) {
            $this->log_warning( "Event missing required 'type' field" );
            return false;
        }
        
        if ( empty( $event['data'] ) ) {
            $this->log_warning( "Event missing required 'data' field" );
            return false;
        }
        
        return true;
    }
    
    /**
     * Send GraphQL operation result for single connection mode
     * 
     * @param array $event The operation result event
     * @return bool True if sent successfully
     */
    private function send_operation_result( array $event ): bool {
        
        $event_data = $event['data'];
        
        // Check if this operation result is for our connection
        if ( $event_data['token'] !== $this->connection_id ) {
            return false; // Not for this connection
        }
        
        $operation_id = $event_data['operation_id'];
        $result = $event_data['result'];
        
        // Send 'next' event with operation ID
        $this->send_next_event( $operation_id, $result );
        
        // For non-subscription operations, immediately send complete
        if ( ! $this->is_subscription_operation( $operation_id ) ) {
            $this->send_complete_event( $operation_id );
        }
        
        return true;
    }
    
    /**
     * Send 'next' event according to GraphQL-SSE protocol
     * 
     * @param string $operation_id The operation ID
     * @param array $payload The GraphQL execution result
     */
    private function send_next_event( string $operation_id, array $payload ): void {
        
        $message = [
            'id' => $operation_id,
            'payload' => $payload
        ];
        
        $this->send_sse_event( 'next', $message );
    }
    
    /**
     * Send 'complete' event for an operation
     * 
     * @param string $operation_id The operation ID
     */
    private function send_complete_event( string $operation_id ): void {
        
        $message = [
            'id' => $operation_id
        ];
        
        $this->send_sse_event( 'complete', $message );
    }
    
    /**
     * Send SSE event according to GraphQL-SSE protocol
     * 
     * @param string $event_type The event type ('next', 'complete')
     * @param array|null $data The event data
     */
    private function send_sse_event( string $event_type, ?array $data = null ): void {
        
        echo "event: {$event_type}\n";
        
        if ( $data !== null ) {
            echo "data: " . wp_json_encode( $data ) . "\n";
        } else {
            echo "data: \n"; // Empty data field for complete events
        }
        
        echo "\n";
        
        if ( ob_get_level() ) {
            ob_flush();
        }
        flush();
    }
    
    /**
     * Check if an operation is a subscription
     * 
     * @param string $operation_id The operation ID
     * @return bool True if it's a subscription
     */
    private function is_subscription_operation( string $operation_id ): bool {
        
        // For now, assume all operations are subscriptions
        // In a real implementation, you would check the operation type from stored operation data
        return true;
    }
    
    /**
     * Structured logging methods
     */
    private function log_info( string $message, array $context = [] ): void {
        $this->log( 'info', $message, $context );
    }
    
    private function log_warning( string $message, array $context = [] ): void {
        $this->log( 'warning', $message, $context );
    }
    
    private function log_error( string $message, array $context = [] ): void {
        $this->log( 'error', $message, $context );
    }
    
    private function log_debug( string $message, array $context = [] ): void {
        $this->log( 'debug', $message, $context );
    }
    
    /**
     * Central logging method
     * 
     * @param string $level
     * @param string $message
     * @param array $context
     */
    private function log( string $level, string $message, array $context = [] ): void {
        
        $log_entry = [
            'timestamp' => gmdate( 'Y-m-d H:i:s' ),
            'level' => strtoupper( $level ),
            'connection_id' => $this->connection_id,
            'message' => $message
        ];
        
        if ( ! empty( $context ) ) {
            $log_entry['context'] = $context;
        }
        
        error_log( 'WPGraphQL-SSE: ' . wp_json_encode( $log_entry ) );
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
     * Send a keepalive comment to maintain the connection
     * Uses SSE comments to stay protocol compliant
     */
    private function send_keepalive(): void {
        echo ": keepalive " . gmdate( DATE_ATOM ) . "\n\n";
        
        if ( ob_get_level() ) {
            ob_flush();
        }
        flush();
    }

    /**
     * Clean up connection resources
     */
    private function cleanup_connection(): void {
        $this->log_info( "GraphQL-SSE connection closed", [
            'duration' => microtime( true ) - $this->last_check_time
        ]);
        
        // Clean up reservation token
        delete_transient( 'graphql_sse_reservation_' . $this->connection_id );
    }

    /**
     * Start the GraphQL-SSE stream
     * 
     * Initializes and maintains a Server-Sent Events stream according to the GraphQL-SSE protocol
     */
    public function stream(): void {
        
        try {
            // Validate connection before starting
            $connection_meta = $this->validate_connection();
            
            // Set up SSE headers
            $this->setup_sse_headers();
            
            // Initialize stream state
            $keepalive_counter = 0;
            $start_time = microtime( true );
            
            // Send connection established comment
            echo ": GraphQL-SSE connection established for {$this->connection_id}\n\n";
            flush();
            
            $this->log_info( "GraphQL-SSE stream started" );
            
            // Main event loop
            while ( connection_status() === CONNECTION_NORMAL ) {
                
                // Process queued events
                $events_processed = $this->process_queued_events();
                
                // Send keepalive every 30 seconds
                $keepalive_counter++;
                if ( $keepalive_counter >= 30 ) {
                    $this->send_keepalive();
                    $keepalive_counter = 0;
                }
                
                // Check for client disconnect
                if ( connection_aborted() ) {
                    $this->log_info( "Client disconnected from stream" );
                    break;
                }
                
                // Sleep for 1 second between checks
                sleep( 1 );
            }
            
        } catch ( \Exception $e ) {
            $this->log_error( "Stream error: " . $e->getMessage() );
            
            // Send error to client if possible
            if ( connection_status() === CONNECTION_NORMAL ) {
                echo ": error " . $e->getMessage() . "\n\n";
                flush();
            }
            
        } finally {
            // Always cleanup
            $this->cleanup_connection();
        }
    }
    
    /**
     * Set up Server-Sent Events headers
     */
    private function setup_sse_headers(): void {
        
        if ( headers_sent() ) {
            throw new \RuntimeException( 'Headers already sent, cannot establish SSE connection' );
        }
        
        // Disable output buffering for real-time streaming
        ini_set( 'output_buffering', 0 );
        ini_set( 'implicit_flush', 1 );
        
        // Set SSE headers
        header( 'Content-Type: text/event-stream' );
        header( 'Cache-Control: no-cache' );
        header( 'Connection: keep-alive' );
        header( 'X-Accel-Buffering: no' );
        
        // Ensure session is closed to prevent blocking
        if ( session_id() ) {
            session_write_close();
        }
    }

    /**
     * Process queued events from the database
     * 
     * @return int Number of events processed
     */
    private function process_queued_events(): int {
        
        try {
            // Get events from database since last check
            $events = $this->event_queue->get_events_since( $this->last_check_time );
            
            if ( empty( $events ) ) {
                return 0;
            }
            
            $this->log_debug( "Processing events", [ 'count' => count( $events ) ] );
            
            $processed_count = 0;
            
            // Process each event
            foreach ( $events as $event ) {
                if ( $this->process_event( $event ) ) {
                    $processed_count++;
                }
            }
            
            // Update last check time
            $this->last_check_time = microtime( true );
            
            if ( $processed_count > 0 ) {
                $this->log_info( "Processed events", [ 'count' => $processed_count ] );
            }
            
            return $processed_count;
            
        } catch ( \Exception $e ) {
            $this->log_error( "Failed to process queued events: " . $e->getMessage() );
            return 0;
        }
    }
}