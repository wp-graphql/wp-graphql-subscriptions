<?php
/**
 * Simple endpoint test script
 * 
 * This script helps debug the GraphQL-SSE endpoint routing
 * Place this in your WordPress root and access via: yourdomain.com/test-endpoint.php
 */

// Include WordPress
require_once('./wp-load.php');

echo "<h1>GraphQL-SSE Endpoint Test</h1>";

// Test if rewrite rules are working
echo "<h2>Rewrite Rules Test</h2>";

$rewrite_rules = get_option('rewrite_rules');
$found_graphql_sse = false;

if ($rewrite_rules) {
    foreach ($rewrite_rules as $pattern => $replacement) {
        if (strpos($pattern, 'graphql') !== false || strpos($replacement, 'graphql_sse_endpoint') !== false) {
            echo "<p><strong>Pattern:</strong> {$pattern} <strong>→</strong> {$replacement}</p>";
            $found_graphql_sse = true;
        }
    }
}

if (!$found_graphql_sse) {
    echo "<p style='color: red;'><strong>❌ No GraphQL-SSE rewrite rules found!</strong></p>";
    echo "<p>Try deactivating and reactivating the plugin to flush rewrite rules.</p>";
} else {
    echo "<p style='color: green;'><strong>✅ GraphQL-SSE rewrite rules found!</strong></p>";
}

// Test endpoint URLs
echo "<h2>Endpoint Test</h2>";

$test_urls = [
    home_url('/graphql/stream'),
    home_url('/wp-json/graphql/v1/stream')
];

foreach ($test_urls as $url) {
    echo "<h3>Testing: {$url}</h3>";
    
    // Test PUT request (reservation)
    $response = wp_remote_request($url, [
        'method' => 'PUT',
        'timeout' => 10,
        'headers' => [
            'Content-Type' => 'application/json'
        ]
    ]);
    
    if (is_wp_error($response)) {
        echo "<p style='color: red;'><strong>❌ PUT Request Failed:</strong> " . $response->get_error_message() . "</p>";
    } else {
        $status = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        
        if ($status === 201) {
            echo "<p style='color: green;'><strong>✅ PUT Request Success:</strong> Status {$status}</p>";
            echo "<p><strong>Response:</strong> " . esc_html($body) . "</p>";
        } else {
            echo "<p style='color: orange;'><strong>⚠️ PUT Request Status:</strong> {$status}</p>";
            echo "<p><strong>Response:</strong> " . esc_html($body) . "</p>";
        }
    }
}

// Test query var detection
echo "<h2>Query Var Test</h2>";

// Simulate the query var
global $wp_query;
$wp_query->set('graphql_sse_endpoint', '1');

$query_var = get_query_var('graphql_sse_endpoint');

if ($query_var) {
    echo "<p style='color: green;'><strong>✅ Query var 'graphql_sse_endpoint' is working!</strong></p>";
} else {
    echo "<p style='color: red;'><strong>❌ Query var 'graphql_sse_endpoint' not found!</strong></p>";
}

// Test if our functions exist
echo "<h2>Function Test</h2>";

$functions_to_test = [
    'handle_sse_connection',
    'handle_graphql_operation', 
    'handle_reservation_request',
    'handle_stop_operation',
    'get_reservation_token',
    'validate_reservation_token'
];

foreach ($functions_to_test as $function) {
    if (function_exists($function)) {
        echo "<p style='color: green;'><strong>✅ Function '{$function}' exists</strong></p>";
    } else {
        echo "<p style='color: red;'><strong>❌ Function '{$function}' missing!</strong></p>";
    }
}

echo "<h2>Manual Test Links</h2>";
echo "<p>Try these URLs manually in your browser:</p>";
echo "<ul>";
foreach ($test_urls as $url) {
    echo "<li><a href='{$url}' target='_blank'>{$url}</a> (Should show GraphQL-SSE response, not 404)</li>";
}
echo "</ul>";

echo "<p><em>Note: DELETE this file after testing for security!</em></p>";
?>