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

        // Disable WordPress shutdown actions that might interfere
        remove_all_actions( 'shutdown' );
        
        // Set unlimited execution time for long-running streams
        set_time_limit( 0 );
        ignore_user_abort( false ); // We want to detect disconnects
        
        // Debug: Log before starting stream
        error_log("WPGraphQL-SSE: About to start stream for connection {$connection_id}");
        
        // Start the stream immediately
        $this->stream();
        
        // Debug: This should never be reached if stream() runs correctly
        error_log("WPGraphQL-SSE: WARNING - Code after stream() was reached! Stream may have exited early.");
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
        
        // Note: Validation is already done in event-stream.php before creating this stream
        // Skip re-validation here to avoid delays and function scope issues
        
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
            
            // Handle WordPress subscription events (global events like postUpdated)
            if ( empty( $event['operation_id'] ) ) {
                return $this->handle_wordpress_subscription_event( $event );
            }
            
            // Handle specific operation events
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
        
        // Note: We don't send complete events automatically since subscriptions
        // are long-running operations that complete when the connection closes
        
        return true;
    }
    
    /**
     * Handle WordPress subscription events (global events without operation IDs)
     * 
     * @param array $event The WordPress event data
     * @return bool True if event was handled successfully
     */
    private function handle_wordpress_subscription_event( array $event ): bool {
        
        $event_type = $event['type'];
        $node_id = $event['node_id'] ?? null;
        
        $this->log_debug( "Processing WordPress subscription event: {$event_type}", [
            'node_id' => $node_id
        ]);
        
        // Get connection manager and find matching subscriptions
        $connection_manager = WPGraphQL_Connection_Manager::get_instance();
        $connection = $connection_manager->get_connection( $this->connection_id );
        
        if ( ! $connection ) {
            $this->log_warning( "No connection found for token: {$this->connection_id}" );
            return false;
        }
        
        $sent_events = 0;
        
        // Check all registered subscriptions for matches
        foreach ( $connection->get_subscriptions() as $operation_id => $subscription_data ) {
            if ( $connection->matches_event( $operation_id, $event_type, $node_id ) ) {
                
                $this->log_debug( "Subscription {$operation_id} matches event {$event_type}" );
                
                // Execute the stored subscription with event data
                $root_value = $this->prepare_root_value_for_event( $event );
                $execution_result = $connection->execute_subscription( $operation_id, $root_value );
                
                if ( $execution_result ) {
                    // Send the event as a 'next' event with the real operation ID
                    $this->send_next_event( $operation_id, [
                        'data' => $execution_result,
                        'extensions' => [
                            'subscription' => [
                                'event_type' => $event_type,
                                'node_id' => $node_id,
                                'timestamp' => microtime( true )
                            ]
                        ]
                    ]);
                    
                    $sent_events++;
                }
            }
        }
        
        if ( $sent_events > 0 ) {
            $this->log_info( "Sent {$sent_events} subscription events for {$event_type}" );
        } else {
            $this->log_debug( "No matching subscriptions found for event {$event_type}" );
        }
        
        return $sent_events > 0;
    }
    
    /**
     * Prepare root value for GraphQL execution from WordPress event
     * 
     * @param array $event The WordPress event data
     * @return array Root value for GraphQL execution
     */
    private function prepare_root_value_for_event( array $event ): array {
        $root_value = [];
        
        // Extract post data if available
        if ( isset( $event['data']['context']['post'] ) ) {
            $post_data = $event['data']['context']['post'];
            
            // If it's an array (from database JSON), reconstruct WP_Post object
            if ( is_array( $post_data ) && isset( $post_data['ID'] ) ) {
                $post = get_post( $post_data['ID'] );
                if ( $post ) {
                    $root_value['postUpdated'] = $post;
                }
            } elseif ( $post_data instanceof WP_Post ) {
                $root_value['postUpdated'] = $post_data;
            }
        }
        
        return $root_value;
    }
    

    
    /**
     * Execute the GraphQL subscription resolver manually
     * 
     * @param string $event_type The subscription field name (e.g., 'postUpdated')
     * @param mixed $post_data The WP_Post object or data
     * @param array $args The subscription arguments (e.g., ['id' => 394])
     * @return mixed The resolved data from the GraphQL field resolver
     */
    private function execute_subscription_resolver( string $event_type, $post_data, array $args = [] ) {
        
        try {
            // Check if WPGraphQL is available and initialized
            if ( ! class_exists( '\WPGraphQL' ) ) {
                $this->log_error( "WPGraphQL class not found" );
                return null;
            }
            
            // Get the WPGraphQL type registry
            $type_registry = \WPGraphQL::get_type_registry();
            
            if ( ! $type_registry ) {
                $this->log_error( "WPGraphQL type registry not available" );
                return null;
            }
            
            // Get the RootSubscription type
            $subscription_type = $type_registry->get_type( 'RootSubscription' );
            
            if ( ! $subscription_type ) {
                $this->log_error( "RootSubscription type not found in registry" );
                return null;
            }
            
            // Get the field configuration
            $fields = $subscription_type->getFields();
            
            if ( ! isset( $fields[ $event_type ] ) ) {
                $this->log_error( "Field '{$event_type}' not found in RootSubscription" );
                return null;
            }
            
            $field = $fields[ $event_type ];
            $resolver = $field->resolveFn;
            
            if ( ! $resolver || ! is_callable( $resolver ) ) {
                $this->log_error( "No resolver found for field '{$event_type}'" );
                return null;
            }
            
            // Prepare the root data for the resolver
            $root = [ $event_type => $post_data ];
            
            // Create a basic GraphQL context
            $context = \WPGraphQL::get_app_context();
            
            // Create a mock ResolveInfo (simplified)
            $info = new \GraphQL\Type\Definition\ResolveInfo(
                $event_type,
                [],
                $subscription_type,
                [],
                null,
                null,
                [],
                null
            );
            
            // Execute the resolver
            $this->log_debug( "Executing resolver for '{$event_type}'", [
                'args' => $args,
                'post_id' => is_object( $post_data ) && isset( $post_data->ID ) ? $post_data->ID : 'unknown'
            ]);
            $resolved = $resolver( $root, $args, $context, $info );
            
            $this->log_debug( "Resolver executed successfully", [
                'result_type' => is_object( $resolved ) ? get_class( $resolved ) : gettype( $resolved ),
                'has_data' => $resolved !== null
            ]);
            
            return $resolved;
            
        } catch ( \Exception $e ) {
            $this->log_error( "Error executing resolver for '{$event_type}': " . $e->getMessage() );
            return null;
        }
    }
    

    
    /**
     * Execute a GraphQL subscription query through WPGraphQL's execution engine
     * 
     * @param string $query The GraphQL subscription query
     * @param mixed $post_data The WP_Post object to provide as context
     * @return mixed The resolved data from GraphQL execution
     */
    private function execute_graphql_subscription( string $query, $post_data ) {
        
        try {
            if ( empty( $query ) ) {
                $this->log_error( "Empty GraphQL query provided" );
                return null;
            }
            
            $this->log_debug( "Executing GraphQL subscription", [
                'query_length' => strlen( $query ),
                'post_id' => is_object( $post_data ) && isset( $post_data->ID ) ? $post_data->ID : 'unknown'
            ]);
            
            // Create a custom root value that includes our post data
            $root_value = [
                'postUpdated' => $post_data
            ];
            
            // Execute the GraphQL query
            $this->log_debug( "About to execute GraphQL query", [
                'query' => $query,
                'root_value_keys' => array_keys( $root_value )
            ]);
            
            $result = graphql( [
                'query' => $query,
                'context' => \WPGraphQL::get_app_context(),
                'root_value' => $root_value
            ] );
            
            $this->log_debug( "GraphQL execution completed", [
                'has_result' => ! empty( $result ),
                'has_errors' => ! empty( $result['errors'] ),
                'has_data' => ! empty( $result['data'] ),
                'result_keys' => is_array( $result ) ? array_keys( $result ) : 'not_array'
            ]);
            
            if ( ! empty( $result['errors'] ) ) {
                $this->log_error( "GraphQL execution errors", [
                    'errors' => $result['errors']
                ]);
                return null;
            }
            
            // Extract the subscription field data
            $subscription_data = $result['data'] ?? [];
            $this->log_debug( "GraphQL execution successful", [
                'has_data' => ! empty( $subscription_data ),
                'data_keys' => array_keys( $subscription_data )
            ]);
            
            // Return the specific subscription field result
            foreach ( $subscription_data as $field_name => $field_data ) {
                return $field_data; // Return the first (and should be only) subscription field
            }
            
            return null;
            
        } catch ( \Exception $e ) {
            $this->log_error( "Error executing GraphQL subscription: " . $e->getMessage(), [
                'exception_type' => get_class( $e ),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);
            return null;
        } catch ( \Error $e ) {
            $this->log_error( "Fatal error executing GraphQL subscription: " . $e->getMessage(), [
                'error_type' => get_class( $e ),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => $e->getTraceAsString()
            ]);
            return null;
        }
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
        error_log("WPGraphQL-SSE: Sending SSE event: {$event_type}");
        
        try {
            echo "event: {$event_type}\n";
            
            if ( $data !== null ) {
                // Use reliable JSON encoding
                $json_data = function_exists( 'wp_json_encode' ) 
                    ? wp_json_encode( $data ) 
                    : json_encode( $data );
                    
                echo "data: " . $json_data . "\n";
            } else {
                echo "data: \n"; // Empty data field for complete events
            }
            
            echo "\n";
            
            // Aggressively flush all output buffers
            $this->force_flush();
            
        } catch ( \Exception $e ) {
            // Send error event if JSON encoding fails
            echo "event: error\n";
            echo "data: " . json_encode( [ 'message' => 'JSON encoding error: ' . $e->getMessage() ] ) . "\n\n";
            $this->force_flush();
        }
    }
    
    /**
     * Force flush all output buffers immediately
     */
    private function force_flush(): void {
        error_log("WPGraphQL-SSE: force_flush() called");
        
        // Flush all output buffer levels
        $buffer_levels = ob_get_level();
        error_log("WPGraphQL-SSE: Found {$buffer_levels} output buffer levels");
        
        while ( ob_get_level() ) {
            ob_end_flush();
        }
        
        // Force PHP to flush
        flush();
        error_log("WPGraphQL-SSE: PHP flush() called");
        
        // DON'T use fastcgi_finish_request() for streaming - it closes the connection!
        // This was likely the cause of the stream termination
        /*
        if ( function_exists( 'fastcgi_finish_request' ) ) {
            fastcgi_finish_request();
        }
        */
        
        error_log("WPGraphQL-SSE: force_flush() completed");
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
        
        try {
            $log_entry = [
                'timestamp' => gmdate( 'Y-m-d H:i:s' ),
                'level' => strtoupper( $level ),
                'connection_id' => $this->connection_id,
                'message' => $message
            ];
            
            if ( ! empty( $context ) ) {
                $log_entry['context'] = $context;
            }
            
            // Use json_encode instead of wp_json_encode for reliability
            $json_data = function_exists( 'wp_json_encode' ) 
                ? wp_json_encode( $log_entry ) 
                : json_encode( $log_entry );
                
            error_log( 'WPGraphQL-SSE: ' . $json_data );
            
        } catch ( \Exception $e ) {
            // Fallback to simple logging if JSON encoding fails
            error_log( "WPGraphQL-SSE: [{$level}] {$message} (connection: {$this->connection_id})" );
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
     * Send a keepalive comment to maintain the connection
     * Uses SSE comments to stay protocol compliant
     */
    private function send_keepalive(): void {
        echo ": keepalive " . gmdate( DATE_ATOM ) . "\n\n";
        
        // Use aggressive flushing
        $this->force_flush();
    }

    /**
     * Clean up connection resources
     */
    private function cleanup_connection(): void {
        $this->log_info( "GraphQL-SSE connection closed", [
            'duration' => microtime( true ) - $this->last_check_time
        ]);
        
        // Clean up connection in connection manager
        $connection_manager = WPGraphQL_Connection_Manager::get_instance();
        $connection_manager->remove_connection( $this->connection_id );
        
        $this->log_debug( "Connection cleaned up from connection manager" );
    }

    /**
     * Start the GraphQL-SSE stream
     * 
     * Initializes and maintains a Server-Sent Events stream according to the GraphQL-SSE protocol
     */
    public function stream(): void {
        error_log("WPGraphQL-SSE: stream() method called for connection {$this->connection_id}");
        
        try {
            error_log("WPGraphQL-SSE: Inside stream() try block");
            
            // Validate connection before starting
            $connection_meta = $this->validate_connection();
            error_log("WPGraphQL-SSE: Connection validated");
            
            // Set up SSE headers
            $this->setup_sse_headers();
            error_log("WPGraphQL-SSE: Headers set up");
            
            // Initialize stream state
            $keepalive_counter = 0;
            $start_time = microtime( true );
            error_log("WPGraphQL-SSE: Stream state initialized");
            
            // Send connection established comment
            echo ": GraphQL-SSE connection established for {$this->connection_id}\n\n";
            $this->force_flush();
            error_log("WPGraphQL-SSE: Initial message sent and flushed");
            
            // Send a test event to verify the connection works
            error_log("WPGraphQL-SSE: About to send test event");
            
            try {
                echo "event: test\n";
                error_log("WPGraphQL-SSE: Test event header sent");
                
                $test_data = [ 'message' => 'Connection test successful', 'timestamp' => time() ];
                $json_data = json_encode( $test_data );
                error_log("WPGraphQL-SSE: JSON encoded: " . $json_data);
                
                echo "data: " . $json_data . "\n\n";
                error_log("WPGraphQL-SSE: Test event data sent");
                
                $this->force_flush();
                error_log("WPGraphQL-SSE: Test event sent and flushed");
                
            } catch ( \Exception $e ) {
                error_log("WPGraphQL-SSE: Exception in test event: " . $e->getMessage());
                throw $e;
            } catch ( \Error $e ) {
                error_log("WPGraphQL-SSE: Fatal error in test event: " . $e->getMessage());
                throw $e;
            }
            
            $this->log_info( "GraphQL-SSE stream started" );
            error_log("WPGraphQL-SSE: About to enter main loop");
            
            // Send a heartbeat every few seconds to keep connection alive
            $loop_counter = 0;
            
            // Main event loop - simplified for debugging
            while ( true ) {
                
                $loop_counter++;
                
                // Send a simple message every iteration to test connection
                echo ": debug loop {$loop_counter} at " . date( 'H:i:s' ) . "\n\n";
                $this->force_flush();
                
                // Log every 10 iterations
                if ( $loop_counter % 10 === 0 ) {
                    $this->log_debug( "Stream still running", [ 
                        'iteration' => $loop_counter,
                        'conn_status' => connection_status(),
                        'conn_aborted' => connection_aborted() ? 'yes' : 'no'
                    ]);
                }
                
                // Check connection status
                $conn_status = connection_status();
                if ( $conn_status !== CONNECTION_NORMAL ) {
                    $this->log_info( "Connection status changed", [ 'status' => $conn_status, 'iteration' => $loop_counter ] );
                    break;
                }
                
                // Check for client disconnect
                if ( connection_aborted() ) {
                    $this->log_info( "Client disconnected from stream", [ 'iteration' => $loop_counter ] );
                    break;
                }
                
                // Process queued events
                $events_processed = $this->process_queued_events();
                
                // Sleep for 1 second between checks
                sleep( 1 );
            }
            
            $this->log_info( "Stream loop ended", [ 
                'total_iterations' => $loop_counter,
                'connection_status' => connection_status(),
                'connection_aborted' => connection_aborted() ? 'yes' : 'no',
                'duration_seconds' => $loop_counter
            ]);
            
        } catch ( \Exception $e ) {
            $this->log_error( "Stream exception: " . $e->getMessage(), [
                'exception_type' => get_class( $e ),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            
            // Send error to client if possible
            if ( connection_status() === CONNECTION_NORMAL ) {
                echo ": error " . $e->getMessage() . "\n\n";
                $this->force_flush();
            }
            
        } catch ( \Error $e ) {
            $this->log_error( "Stream fatal error: " . $e->getMessage(), [
                'error_type' => get_class( $e ),
                'file' => $e->getFile(),
                'line' => $e->getLine()
            ]);
            
            // Send error to client if possible
            if ( connection_status() === CONNECTION_NORMAL ) {
                echo ": fatal_error " . $e->getMessage() . "\n\n";
                $this->force_flush();
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
        
        // Aggressively disable ALL output buffering
        while ( ob_get_level() ) {
            ob_end_clean();
        }
        
        // Disable output buffering completely
        ini_set( 'output_buffering', 'off' );
        ini_set( 'implicit_flush', 1 );
        
        // Set SSE headers
        header( 'Content-Type: text/event-stream' );
        header( 'Cache-Control: no-cache' );
        header( 'Connection: keep-alive' );
        header( 'X-Accel-Buffering: no' ); // Disable nginx buffering
        
        // Additional headers to prevent buffering
        header( 'X-Accel-Buffering: no' );
        header( 'Access-Control-Allow-Origin: *' );
        header( 'Access-Control-Allow-Headers: Cache-Control' );
        
        // Ensure session is closed to prevent blocking
        if ( session_id() ) {
            session_write_close();
        }
        
        // Force immediate output
        if ( function_exists( 'apache_setenv' ) ) {
            apache_setenv( 'no-gzip', 1 );
        }
        
        $this->log_debug( 'SSE headers configured, output buffering disabled' );
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
            
            $this->log_debug( "Processing events", [ 
                'count' => count( $events ),
                'event_types' => array_map( function( $event ) {
                    return $event['event_type'] ?? 'unknown';
                }, $events )
            ] );
            
            $processed_count = 0;
            
            // Process each event
            foreach ( $events as $event ) {
                $this->log_debug( "About to process individual event", [
                    'event_type' => $event['event_type'] ?? 'unknown',
                    'has_data' => ! empty( $event['data'] )
                ]);
                
                try {
                    if ( $this->process_event( $event ) ) {
                    $processed_count++;
                        $this->log_debug( "Successfully processed event", [
                            'event_type' => $event['event_type'] ?? 'unknown'
                        ]);
                    } else {
                        $this->log_debug( "Event processing returned false", [
                            'event_type' => $event['event_type'] ?? 'unknown'
                        ]);
                    }
                } catch ( \Exception $e ) {
                    $this->log_error( "Error processing event: " . $e->getMessage(), [
                        'event_type' => $event['event_type'] ?? 'unknown',
                        'exception_type' => get_class( $e ),
                        'file' => $e->getFile(),
                        'line' => $e->getLine()
                    ]);
                } catch ( \Error $e ) {
                    $this->log_error( "Fatal error processing event: " . $e->getMessage(), [
                        'event_type' => $event['event_type'] ?? 'unknown',
                        'error_type' => get_class( $e ),
                        'file' => $e->getFile(),
                        'line' => $e->getLine()
                    ]);
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