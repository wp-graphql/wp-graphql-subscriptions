<?php
// GraphQL-SSE Protocol Implementation
// Implements the GraphQL over Server-Sent Events Protocol as specified in:
// https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md

add_action( 'template_redirect', function() {
    
    // Check if this is a GraphQL-SSE endpoint request
    if ( get_query_var( 'graphql_sse_endpoint' ) ) {
        
        $method = $_SERVER['REQUEST_METHOD'];
        
        switch ( $method ) {
            case 'GET':
                // Single connection mode - establish SSE connection
                handle_sse_connection();
                break;
                
            case 'POST':
                // Execute GraphQL operation (distinct connections mode or single connection mode)
                handle_graphql_operation();
                break;
                
            case 'PUT':
                // Make reservation for single connection mode
                handle_reservation_request();
                break;
                
            case 'DELETE':
                // Stop streaming operation in single connection mode
                handle_stop_operation();
                break;
                
            default:
                http_response_code( 405 );
                header( 'Allow: GET, POST, PUT, DELETE' );
                exit;
        }
        
        exit;
    }

});

/**
 * Handle SSE connection establishment (single connection mode)
 */
function handle_sse_connection(): void {
    
    try {
        // Check for reservation token
        $token = get_reservation_token();
        
        if ( ! $token ) {
            send_error_response( 400, 'Missing reservation token' );
            return;
        }
        
        // Validate reservation token
        if ( ! validate_reservation_token( $token ) ) {
            send_error_response( 401, 'Invalid or expired reservation token' );
            return;
        }
        
        log_graphql_sse( 'info', 'Starting SSE connection', [ 'token' => substr( $token, 0, 8 ) . '...' ] );
        
        // Start SSE stream with the token as connection ID
        new WPGraphQL_Subscriptions_Stream( $token );
        
        // Explicitly exit to prevent WordPress from continuing processing
        exit;
        
    } catch ( \Exception $e ) {
        log_graphql_sse( 'error', 'SSE connection failed: ' . $e->getMessage() );
        
        if ( ! headers_sent() ) {
            send_error_response( 500, 'Failed to establish SSE connection' );
        }
    }
}

/**
 * Handle GraphQL operation execution
 */
function handle_graphql_operation() {
    
    // Check Content-Type for distinct connections mode
    $content_type = $_SERVER['CONTENT_TYPE'] ?? '';
    
    if ( strpos( $content_type, 'text/event-stream' ) !== false ) {
        // Distinct connections mode - execute and stream directly
        handle_distinct_connection_mode();
        return;
    }
    
    // Single connection mode - execute and queue for SSE stream
    handle_single_connection_mode();
}

/**
 * Handle distinct connections mode
 */
function handle_distinct_connection_mode(): void {
    
    try {
        // Parse GraphQL request
        $request_data = get_graphql_request_data();
        
        if ( ! $request_data ) {
            send_error_response( 400, 'Invalid GraphQL request' );
            return;
        }
        
        // Set SSE headers
        send_sse_headers();
        
        // Execute GraphQL operation
        $result = execute_graphql_operation( $request_data );
        
        // Send result through SSE
        send_sse_event( 'next', $result );
        send_sse_event( 'complete' );
        
        log_graphql_sse( 'info', 'Distinct connection mode completed', [
            'has_errors' => ! empty( $result['errors'] )
        ]);
        
    } catch ( \Exception $e ) {
        log_graphql_sse( 'error', 'Distinct connection mode error: ' . $e->getMessage() );
        
        if ( ! headers_sent() ) {
            send_error_response( 500, 'Internal server error' );
        } else {
            send_sse_event( 'next', [
                'errors' => [
                    [
                        'message' => 'Internal server error',
                        'extensions' => [ 'code' => 'INTERNAL_ERROR' ]
                    ]
                ]
            ]);
            send_sse_event( 'complete' );
        }
    }
}

/**
 * Handle single connection mode
 */
function handle_single_connection_mode(): void {
    
    try {
        log_graphql_sse( 'debug', 'Single connection mode handler started' );
        
        // Check for reservation token
        $token = get_reservation_token();
        log_graphql_sse( 'debug', 'Token extracted', [ 'token' => $token ? substr( $token, 0, 8 ) . '...' : 'null' ] );
        
        if ( ! $token ) {
            log_graphql_sse( 'error', 'Missing reservation token in single connection mode' );
            send_error_response( 400, 'Missing reservation token' );
            return;
        }
        
        // Validate reservation token
        if ( ! validate_reservation_token( $token ) ) {
            send_error_response( 401, 'Invalid or expired reservation token' );
            return;
        }
        
        // Parse GraphQL request
        $request_data = get_graphql_request_data();
        log_graphql_sse( 'debug', 'GraphQL request parsed', [ 
            'has_data' => $request_data ? 'yes' : 'no',
            'query_length' => $request_data ? strlen( $request_data['query'] ?? '' ) : 0
        ]);
        
        if ( ! $request_data ) {
            log_graphql_sse( 'error', 'Invalid GraphQL request data' );
            send_error_response( 400, 'Invalid GraphQL request', [
                'details' => 'Request body must contain valid JSON with a GraphQL query'
            ]);
            return;
        }
        
        // Get operation ID
        $operation_id = $request_data['extensions']['operationId'] ?? null;
        
        if ( ! $operation_id ) {
            send_error_response( 400, 'Missing operationId in extensions', [
                'details' => 'Single connection mode requires an operationId in the extensions field'
            ]);
            return;
        }
        
        log_graphql_sse( 'info', 'Executing GraphQL operation', [
            'operation_id' => $operation_id,
            'token' => substr( $token, 0, 8 ) . '...'
        ]);
        
        // Set response code early to prevent WordPress from overriding it
        // Use status_header() for WordPress compatibility
        status_header( 202 );
        header( 'Content-Type: application/json' );
        
        // Also set PHP response code as backup
        http_response_code( 202 );
        
        // Execute GraphQL operation
        $result = execute_graphql_operation( $request_data );
        
        log_graphql_sse( 'debug', 'GraphQL operation result', [
            'has_errors' => isset( $result['errors'] ) ? 'yes' : 'no',
            'has_data' => isset( $result['data'] ) ? 'yes' : 'no'
        ]);
        
        if ( $result['errors'] ?? false ) {
            // Return errors directly for validation issues
            log_graphql_sse( 'warning', 'GraphQL operation has errors', [
                'operation_id' => $operation_id,
                'errors' => $result['errors']
            ]);
            
            status_header( 400 );
            header( 'Content-Type: application/json' );
            echo wp_json_encode( $result );
            exit;
        }
        
        // Store the subscription in the connection manager
        $connection_manager = WPGraphQL_Connection_Manager::get_instance();
        $connection = $connection_manager->get_connection( $token );
        
        if ( $connection ) {
            $connection->register_subscription( $operation_id, $request_data['query'], $request_data['variables'] ?? [] );
            
            log_graphql_sse( 'info', 'Subscription registered successfully', [
                'operation_id' => $operation_id,
                'token' => substr( $token, 0, 8 ) . '...'
            ]);
            
            // Send subscription confirmation via SSE immediately
            // This needs to be sent to all active SSE connections for this token
            send_subscription_confirmation( $token, $operation_id, $request_data['query'] );
        }
        
        // Send response (202 status already set above)
        echo wp_json_encode( [
            'operationId' => $operation_id,
            'status' => 'accepted',
            'message' => 'Operation queued for execution'
        ]);
        
        // Exit to prevent WordPress from overriding our response
        exit;
        
    } catch ( \Exception $e ) {
        log_graphql_sse( 'error', 'Single connection mode error: ' . $e->getMessage() );
        send_error_response( 500, 'Internal server error' );
    }
}

/**
 * Handle reservation requests for single connection mode
 */
function handle_reservation_request() {
    
    // Generate reservation token
    $token = wp_generate_uuid4();
    
    // Register the connection with our connection manager
    $connection_manager = WPGraphQL_Connection_Manager::get_instance();
    $connection = $connection_manager->get_connection( $token );
    
    log_graphql_sse( 'info', 'Reservation created', [
        'token' => substr( $token, 0, 8 ) . '...',
        'connection_count' => $connection_manager->get_connection_count()
    ]);
    
    http_response_code( 201 );
    header( 'Content-Type: application/json' );
    echo json_encode( ['token' => $token] );
    exit;
}

/**
 * Handle stop operation requests
 */
function handle_stop_operation() {
    
    $token = get_reservation_token();
    $operation_id = $_GET['operationId'] ?? null;
    
    if ( ! $token || ! $operation_id ) {
        http_response_code( 400 );
        echo json_encode( ['error' => 'Missing token or operationId'] );
        exit;
    }
    
    // Stop the operation (implementation depends on your needs)
    stop_streaming_operation( $token, $operation_id );
    
    http_response_code( 200 );
    echo json_encode( ['stopped' => $operation_id] );
    exit;
}

/**
 * Get reservation token from request
 */
function get_reservation_token() {
    
    // Check custom header first (preferred method)
    $token = $_SERVER['HTTP_X_GRAPHQL_EVENT_STREAM_TOKEN'] ?? null;
    
    // Fallback to query parameter (for SSE connections)
    if ( ! $token ) {
        $token = $_GET['token'] ?? null;
    }
    
    return $token ? sanitize_text_field( $token ) : null;
}

/**
 * Validate reservation token
 */
function validate_reservation_token( $token ) {
    
    // With connection manager, tokens are valid if they exist in active connections
    // or if they can be created (for new connections)
    $connection_manager = WPGraphQL_Connection_Manager::get_instance();
    
    // Always return true - connection manager handles creation/validation
    // This allows for more flexible connection lifecycle management
    return ! empty( $token );
}

/**
 * Get GraphQL request data from POST body
 */
function get_graphql_request_data(): ?array {
    
    $input = file_get_contents( 'php://input' );
    
    if ( empty( $input ) ) {
        log_graphql_sse( 'warning', 'Empty request body received' );
        return null;
    }
    
    $data = json_decode( $input, true );
    
    if ( json_last_error() !== JSON_ERROR_NONE ) {
        log_graphql_sse( 'warning', 'Invalid JSON in request body', [
            'json_error' => json_last_error_msg(),
            'body_preview' => substr( $input, 0, 100 )
        ]);
        return null;
    }
    
    // Validate required fields
    if ( empty( $data['query'] ) ) {
        log_graphql_sse( 'warning', 'Missing query field in request', [
            'received_fields' => array_keys( $data )
        ]);
        return null;
    }
    
    log_graphql_sse( 'debug', 'GraphQL request parsed successfully', [
        'has_query' => ! empty( $data['query'] ),
        'has_variables' => ! empty( $data['variables'] ),
        'has_extensions' => ! empty( $data['extensions'] )
    ]);
    
    return $data;
}

/**
 * Execute GraphQL operation
 * 
 * @param array $request_data The GraphQL request data
 * @return array GraphQL execution result
 * @throws Exception If execution fails
 */
function execute_graphql_operation( array $request_data ): array {
    
    // Validate required fields
    if ( empty( $request_data['query'] ) ) {
        return [
            'errors' => [
                [
                    'message' => 'GraphQL query is required',
                    'extensions' => [
                        'code' => 'GRAPHQL_VALIDATION_FAILED'
                    ]
                ]
            ]
        ];
    }
    
    // Basic query type detection
    $query = trim( $request_data['query'] );
    $is_subscription = stripos( $query, 'subscription' ) === 0;
    
    log_graphql_sse( 'debug', 'Query type detection', [
        'query_start' => substr( $query, 0, 20 ) . '...',
        'is_subscription' => $is_subscription ? 'yes' : 'no'
    ]);
    
    if ( ! $is_subscription ) {
        return [
            'errors' => [
                [
                    'message' => 'Only subscription operations are supported on this endpoint',
                    'extensions' => [
                        'code' => 'OPERATION_NOT_SUPPORTED'
                    ]
                ]
            ]
        ];
    }
    
    // Get connection token from headers or query params
    $token = get_reservation_token();
    if ( ! $token ) {
        return [
            'errors' => [
                [
                    'message' => 'X-GraphQL-Event-Stream-Token header is required',
                    'extensions' => [
                        'code' => 'MISSING_TOKEN'
                    ]
                ]
            ]
        ];
    }
    
    // Get operation ID from extensions
    $operation_id = $request_data['extensions']['operationId'] ?? 'subscription_' . uniqid();
    $variables = $request_data['variables'] ?? [];
    
    // Get connection manager and register subscription
    $connection_manager = WPGraphQL_Connection_Manager::get_instance();
    $connection = $connection_manager->get_connection( $token );
    
    $success = $connection->register_subscription( $operation_id, $query, $variables );
    
    if ( ! $success ) {
        return [
            'errors' => [
                [
                    'message' => 'Failed to register subscription',
                    'extensions' => [
                        'code' => 'SUBSCRIPTION_REGISTRATION_FAILED'
                    ]
                ]
            ]
        ];
    }
    
    log_graphql_sse( 'info', 'Subscription registered', [
        'operation_id' => $operation_id,
        'token' => substr( $token, 0, 8 ) . '...',
        'has_variables' => ! empty( $variables )
    ]);
    
    // Return success response
    return [
        'data' => [
            'subscription' => [
                'id' => $operation_id,
                'status' => 'active',
                'query' => $query
            ]
        ]
    ];
}

/**
 * Queue operation result for SSE stream
 */
function queue_operation_result( $token, $operation_id, $result ) {
    
    // Get the event queue instance
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    
    // Add operation result to queue with token and operation ID
    $event_queue->add_event( 'graphql_operation_result', null, [
        'token' => $token,
        'operation_id' => $operation_id,
        'result' => $result
    ]);
}

/**
 * Send subscription confirmation via SSE
 */
function send_subscription_confirmation( $token, $operation_id, $query ) {
    
    // Add subscription confirmation to event queue so SSE stream can pick it up
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    
    $confirmation_data = [
        'token' => $token,
        'operation_id' => $operation_id,
        'subscription_confirmation' => [
            'id' => $operation_id,
            'status' => 'active',
            'query' => $query
        ]
    ];
    
    // Add event - use operation_id as node_id so it gets the operation_id field at root level
    $event_id = $event_queue->add_event( 'subscription_confirmation', $operation_id, $confirmation_data );
    
    log_graphql_sse( 'info', 'Subscription confirmation queued', [
        'operation_id' => $operation_id,
        'token' => substr( $token, 0, 8 ) . '...',
        'event_id' => $event_id,
        'confirmation_data_keys' => array_keys( $confirmation_data )
    ]);
}

/**
 * Stop streaming operation
 */
function stop_streaming_operation( $token, $operation_id ) {
    
    // Implementation depends on your specific needs
    // You might want to mark the operation as stopped in the database
    error_log( "WPGraphQL Subscriptions: Stopping operation {$operation_id} for token {$token}" );
}

/**
 * Send SSE event
 */
function send_sse_event( string $event, ?array $data = null ): void {
    
    echo "event: {$event}\n";
    
    if ( $data !== null ) {
        echo "data: " . wp_json_encode( $data ) . "\n";
    } else {
        echo "data: \n"; // Empty data field for complete events
    }
    
    echo "\n";
    
    // Aggressively flush all output buffers
    while ( ob_get_level() ) {
        ob_end_flush();
    }
    
    flush();
    
    // Force web server flush if possible
    if ( function_exists( 'fastcgi_finish_request' ) ) {
        fastcgi_finish_request();
    }
}

/**
 * Send SSE headers
 */
function send_sse_headers(): void {
    
    if ( headers_sent() ) {
        throw new \RuntimeException( 'Headers already sent' );
    }
    
    // Aggressively disable ALL output buffering
    while ( ob_get_level() ) {
        ob_end_clean();
    }
    
    // Disable output buffering completely
    ini_set( 'output_buffering', 'off' );
    ini_set( 'implicit_flush', 1 );
    
    header( 'Content-Type: text/event-stream' );
    header( 'Cache-Control: no-cache' );
    header( 'Connection: keep-alive' );
    header( 'X-Accel-Buffering: no' );
    
    // Additional headers to prevent buffering
    header( 'Access-Control-Allow-Origin: *' );
    header( 'Access-Control-Allow-Headers: Cache-Control' );
    
    // Force immediate output
    if ( function_exists( 'apache_setenv' ) ) {
        apache_setenv( 'no-gzip', 1 );
    }
}

/**
 * Send error response
 */
function send_error_response( int $status_code, string $message, array $details = [] ): void {
    
    http_response_code( $status_code );
    header( 'Content-Type: application/json' );
    
    $response = [
        'error' => $message,
        'status' => $status_code
    ];
    
    if ( ! empty( $details ) ) {
        $response['details'] = $details;
    }
    
    echo wp_json_encode( $response );
    exit;
}

/**
 * Structured logging for GraphQL-SSE
 */
function log_graphql_sse( string $level, string $message, array $context = [] ): void {
    
    $log_entry = [
        'timestamp' => gmdate( 'Y-m-d H:i:s' ),
        'level' => strtoupper( $level ),
        'component' => 'GraphQL-SSE',
        'message' => $message
    ];
    
    if ( ! empty( $context ) ) {
        $log_entry['context'] = $context;
    }
    
    error_log( 'WPGraphQL-SSE: ' . wp_json_encode( $log_entry ) );
}

// Updated event handler to use database queue instead of transients
add_action( 'graphql_subscription_event', function( $event_type, $payload ) {
    
    // Debug: Log what we're receiving from the Event Emitter
    error_log( "WPGraphQL-SSE: Received subscription event - Type: {$event_type}" );
    error_log( "WPGraphQL-SSE: Event payload keys: " . implode( ', ', array_keys( $payload ) ) );
    error_log( "WPGraphQL-SSE: Node ID: " . ( $payload['node_id'] ?? 'missing' ) );
    
    // Get the event queue instance
    $event_queue = WPGraphQL_Event_Queue::get_instance();
    
    // Extract node_id from payload for indexing
    $node_id = isset( $payload['node_id'] ) ? (int) $payload['node_id'] : null;
    
    // Add event to database queue
    $event_id = $event_queue->add_event( $event_type, $node_id, $payload );
    
    if ( $event_id ) {
        error_log( "WPGraphQL Subscriptions: Event {$event_type} queued with ID {$event_id}" );
    } else {
        error_log( "WPGraphQL Subscriptions: Failed to queue event {$event_type}" );
    }

}, 10, 2 );