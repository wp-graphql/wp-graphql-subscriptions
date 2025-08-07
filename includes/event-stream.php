<?php
// GraphQL-SSE Protocol Implementation
// Implements the GraphQL over Server-Sent Events Protocol as specified in:
// https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md

add_action( 'template_redirect', function() {
    
    // Handle GraphQL-SSE protocol endpoints
    $request_uri = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
    
    // Check if this is a GraphQL-SSE endpoint
    if ( $request_uri === '/graphql/stream' || $request_uri === '/wp-json/graphql/v1/stream' ) {
        
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
function handle_sse_connection() {
    
    // Check for reservation token
    $token = get_reservation_token();
    
    if ( ! $token ) {
        http_response_code( 400 );
        echo json_encode( ['error' => 'Missing reservation token'] );
        exit;
    }
    
    // Validate reservation token
    if ( ! validate_reservation_token( $token ) ) {
        http_response_code( 401 );
        echo json_encode( ['error' => 'Invalid reservation token'] );
        exit;
    }
    
    // Start SSE stream with the token as connection ID
    new WPGraphQL_Subscriptions_Stream( $token );
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
function handle_single_connection_mode() {
    
    // Check for reservation token
    $token = get_reservation_token();
    
    if ( ! $token ) {
        http_response_code( 400 );
        echo json_encode( ['error' => 'Missing reservation token'] );
        exit;
    }
    
    // Validate reservation token
    if ( ! validate_reservation_token( $token ) ) {
        http_response_code( 401 );
        echo json_encode( ['error' => 'Invalid reservation token'] );
        exit;
    }
    
    // Parse GraphQL request
    $request_data = get_graphql_request_data();
    
    if ( ! $request_data ) {
        http_response_code( 400 );
        echo json_encode( ['error' => 'Invalid GraphQL request'] );
        exit;
    }
    
    // Get operation ID
    $operation_id = $request_data['extensions']['operationId'] ?? null;
    
    if ( ! $operation_id ) {
        http_response_code( 400 );
        echo json_encode( ['error' => 'Missing operationId in extensions' ] );
        exit;
    }
    
    // Execute GraphQL operation
    $result = execute_graphql_operation( $request_data );
    
    if ( $result['errors'] ?? false ) {
        // Return errors directly for validation issues
        http_response_code( 400 );
        echo json_encode( $result );
        exit;
    }
    
    // Queue operation result for SSE stream
    queue_operation_result( $token, $operation_id, $result );
    
    // Return 202 Accepted
    http_response_code( 202 );
    echo json_encode( ['operationId' => $operation_id] );
    exit;
}

/**
 * Handle reservation requests for single connection mode
 */
function handle_reservation_request() {
    
    // Generate reservation token
    $token = wp_generate_uuid4();
    
    // Store reservation (you might want to use a more persistent storage)
    set_transient( 'graphql_sse_reservation_' . $token, time(), 300 ); // 5 minute expiry
    
    http_response_code( 201 );
    echo $token;
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
    
    // Check header first
    $token = $_SERVER['HTTP_X_GRAPHQL_EVENT_STREAM_TOKEN'] ?? null;
    
    // Fallback to query parameter
    if ( ! $token ) {
        $token = $_GET['token'] ?? null;
    }
    
    return $token ? sanitize_text_field( $token ) : null;
}

/**
 * Validate reservation token
 */
function validate_reservation_token( $token ) {
    
    $reservation = get_transient( 'graphql_sse_reservation_' . $token );
    return $reservation !== false;
}

/**
 * Get GraphQL request data from POST body
 */
function get_graphql_request_data() {
    
    $input = file_get_contents( 'php://input' );
    
    if ( empty( $input ) ) {
        return null;
    }
    
    $data = json_decode( $input, true );
    
    if ( json_last_error() !== JSON_ERROR_NONE ) {
        return null;
    }
    
    // Validate required fields
    if ( empty( $data['query'] ) ) {
        return null;
    }
    
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
    
    // For now, return a mock subscription result
    // In a real implementation, this would:
    // 1. Parse the GraphQL document
    // 2. Validate the subscription
    // 3. Register the subscription for event matching
    // 4. Return initial result or validation errors
    
    return [
        'data' => [
            'subscription' => [
                'id' => 'mock_subscription_' . uniqid(),
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
    
    if ( ob_get_level() ) {
        ob_flush();
    }
    flush();
}

/**
 * Send SSE headers
 */
function send_sse_headers(): void {
    
    if ( headers_sent() ) {
        throw new \RuntimeException( 'Headers already sent' );
    }
    
    header( 'Content-Type: text/event-stream' );
    header( 'Cache-Control: no-cache' );
    header( 'Connection: keep-alive' );
    header( 'X-Accel-Buffering: no' );
    
    // Disable output buffering
    ini_set( 'output_buffering', 0 );
    ini_set( 'implicit_flush', 1 );
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