<?php
/**
 * Debug script for GraphQL-SSE issues
 * 
 * This helps identify exactly where the delay and failures are occurring
 */

// Include WordPress
require_once('./wp-load.php');

echo "<h1>GraphQL-SSE Debug</h1>";

// Test 1: Reservation Creation
echo "<h2>1. Test Reservation Creation</h2>";

$start_time = microtime(true);
$response = wp_remote_request(home_url('/graphql/stream'), [
    'method' => 'PUT',
    'timeout' => 10
]);
$reservation_time = microtime(true) - $start_time;

if (is_wp_error($response)) {
    echo "<p style='color: red;'>❌ Reservation failed: " . $response->get_error_message() . "</p>";
    exit;
} else {
    $status = wp_remote_retrieve_response_code($response);
    $token = wp_remote_retrieve_body($response);
    echo "<p style='color: green;'>✅ Reservation successful (took {$reservation_time}s)</p>";
    echo "<p><strong>Token:</strong> " . esc_html($token) . "</p>";
}

// Test 2: Token Validation
echo "<h2>2. Test Token Validation</h2>";

$start_time = microtime(true);
$validation_result = get_transient('graphql_sse_reservation_' . $token);
$validation_time = microtime(true) - $start_time;

if ($validation_result !== false) {
    echo "<p style='color: green;'>✅ Token validation successful (took {$validation_time}s)</p>";
} else {
    echo "<p style='color: red;'>❌ Token validation failed (took {$validation_time}s)</p>";
}

// Test 3: GraphQL Operation (without SSE connection)
echo "<h2>3. Test GraphQL Operation</h2>";

$graphql_payload = [
    'query' => 'subscription { postUpdated { id title status } }',
    'extensions' => [
        'operationId' => 'debug-test-001'
    ]
];

$start_time = microtime(true);
$response = wp_remote_request(home_url('/graphql/stream'), [
    'method' => 'POST',
    'headers' => [
        'Content-Type' => 'application/json',
        'X-GraphQL-Event-Stream-Token' => $token
    ],
    'body' => wp_json_encode($graphql_payload),
    'timeout' => 10
]);
$operation_time = microtime(true) - $start_time;

if (is_wp_error($response)) {
    echo "<p style='color: red;'>❌ GraphQL operation failed: " . $response->get_error_message() . "</p>";
} else {
    $status = wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    
    if ($status === 202) {
        echo "<p style='color: green;'>✅ GraphQL operation accepted (took {$operation_time}s)</p>";
        echo "<p><strong>Response:</strong> " . esc_html($body) . "</p>";
    } else {
        echo "<p style='color: orange;'>⚠️ GraphQL operation status {$status} (took {$operation_time}s)</p>";
        echo "<p><strong>Response:</strong> " . esc_html($body) . "</p>";
    }
}

// Test 4: Check Event Queue
echo "<h2>4. Test Event Queue</h2>";

$event_queue = WPGraphQL_Event_Queue::get_instance();
$stats = $event_queue->get_queue_stats();

echo "<p><strong>Total events in queue:</strong> {$stats['total_events']}</p>";
echo "<p><strong>Recent events:</strong> {$stats['recent_events']}</p>";

// Test 5: SSE Connection (with timeout)
echo "<h2>5. Test SSE Connection (10s timeout)</h2>";

$sse_url = home_url('/graphql/stream?token=' . urlencode($token));
echo "<p><strong>SSE URL:</strong> <a href='{$sse_url}' target='_blank'>{$sse_url}</a></p>";

// Use cURL for SSE test with timeout
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $sse_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 10); // 10 second timeout
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) {
    static $received_data = '';
    $received_data .= $data;
    
    // Stop after receiving some data or after 5 seconds
    if (strlen($received_data) > 100) {
        echo "<p style='color: green;'>✅ SSE connection working! Received data:</p>";
        echo "<pre>" . esc_html(substr($received_data, 0, 200)) . "...</pre>";
        return 0; // Stop reading
    }
    
    return strlen($data);
});

$start_time = microtime(true);
$result = curl_exec($ch);
$sse_time = microtime(true) - $start_time;
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    echo "<p style='color: red;'>❌ SSE connection failed: {$error} (took {$sse_time}s)</p>";
} else {
    echo "<p style='color: green;'>✅ SSE connection completed (took {$sse_time}s)</p>";
}

echo "<p><em>Delete this file after debugging!</em></p>";
?>