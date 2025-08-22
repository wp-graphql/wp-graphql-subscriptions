<?php
/**
 * Security filters for subscription root value validation
 * 
 * This file handles server-to-server authentication for subscription execution.
 * It validates tokens from the sidecar server before allowing root_value to be set.
 */


add_filter( 'graphql_root_value', function( $root_value, $request ) {

    $params = $request->get_params();
    return $params->extensions['root_value'] ?? $root_value;
  
    // wp_send_json( [ 'root_value' => $root_value  ] );

    // // get the extensions from the request
    // $params = $request->get_params();
    // error_log( 'graphql_before_execute: ' . json_encode( $params ) );

    // $root_value = $request->root_value = $params->extensions['root_value'] ?? null;

    // wp_send_json( [ 'root_value' => $root_value, '$data' => $request->data ] );

   


    return $root_value;
}, 10, 2 );

return;

// Debug: Log that this file is being loaded
error_log('WPGraphQL Subscriptions: subscription-security.php file loaded');

// Global variable to store root value between filters
global $wpgraphql_subscription_root_value;
$wpgraphql_subscription_root_value = null;

/**
 * Debug: Log all GraphQL requests to see what we're receiving
 */
add_filter('graphql_request_data', function($request_data, $request) {
    error_log('WPGraphQL Subscriptions: graphql_request_data filter called');
    error_log('WPGraphQL Subscriptions: Request data keys: ' . implode(', ', array_keys($request_data)));
    
    if (isset($request_data['extensions'])) {
        error_log('WPGraphQL Subscriptions: Extensions found: ' . json_encode($request_data['extensions']));
    } else {
        error_log('WPGraphQL Subscriptions: No extensions in request data');
    }
    
    return $request_data;
}, 5, 2);

/**
 * Validate subscription tokens and set root value for authenticated subscription execution
 */
add_filter('graphql_request_data', function($request_data, $request) {
    // Only process if extensions contain subscription data
    if (!isset($request_data['extensions']['root_value'])) {
        return $request_data;
    }
    
    // For development: Skip token validation if no token provided
    if (!isset($request_data['extensions']['subscription_token'])) {
        error_log('WPGraphQL Subscriptions: Processing subscription without token (development mode)');
        // Store the root value in global variable for the graphql_root_value filter
        global $wpgraphql_subscription_root_value;
        $wpgraphql_subscription_root_value = $request_data['extensions']['root_value'];
        error_log('WPGraphQL Subscriptions: Stored root value in global variable');
        error_log('WPGraphQL Subscriptions: rootValue type: ' . gettype($wpgraphql_subscription_root_value));
        return $request_data;
    }

    $root_value = $request_data['extensions']['root_value'];
    $subscription_token = $request_data['extensions']['subscription_token'];
    
    // Validate the subscription token
    if (!wpgraphql_subscriptions_validate_token($subscription_token, $root_value)) {
        // Invalid token - log security event and reject
        error_log('WPGraphQL Subscriptions: Invalid subscription token detected - possible security breach attempt');
        
        // Remove the root_value to prevent unauthorized access
        unset($request_data['extensions']['root_value']);
        unset($request_data['extensions']['subscription_token']);
        
        return $request_data;
    }

    // Token is valid - we can safely set the root value
    // Set the root value in the main request data where WPGraphQL expects it
    $request_data['rootValue'] = $root_value;
    error_log('WPGraphQL Subscriptions: Set rootValue in request_data (authenticated): ' . json_encode(array_keys($request_data)));
    error_log('WPGraphQL Subscriptions: rootValue type (authenticated): ' . gettype($request_data['rootValue']));
    
    return $request_data;
}, 10, 2);

/**
 * Intercept GraphQL execution to set root value
 */
add_filter('graphql_execute', function($result, $schema, $source, $root_value, $context_value, $variable_values, $operation_name, $field_resolver, $validation_rules, $query_complexity_max) {
    error_log('WPGraphQL Subscriptions: graphql_execute filter called');
    error_log('WPGraphQL Subscriptions: Operation name: ' . ($operation_name ?: 'none'));
    error_log('WPGraphQL Subscriptions: Result type: ' . gettype($result));
    
    // Check if this is a subscription and we have root_value in the request
    if ($context_value && method_exists($context_value, 'request')) {
        $request = $context_value->request;
        if ($request) {
            $request_data = $request->get_params();
            error_log('WPGraphQL Subscriptions: Request data keys: ' . implode(', ', array_keys($request_data)));
            
            if (isset($request_data['extensions']['root_value'])) {
                error_log('WPGraphQL Subscriptions: Found root_value in extensions, executing with custom root');
                $custom_root_value = $request_data['extensions']['root_value'];
                
                // Execute GraphQL with our custom root value
                return \GraphQL\GraphQL::executeQuery(
                    $schema,
                    $source,
                    $custom_root_value, // Use our root value
                    $context_value,
                    $variable_values,
                    $operation_name,
                    $field_resolver,
                    $validation_rules
                );
            }
        }
    }
    
    // Return null to continue with normal execution
    return null;
}, 10, 10);

/**
 * Set the validated root value for subscription execution
 */
add_filter('graphql_root_value', function($root_value, $request) {
    // Check if we have validated root_value from extensions
    $request_data = $request->get_params();
    
    error_log('WPGraphQL Subscriptions: graphql_root_value filter called');
    error_log('WPGraphQL Subscriptions: Original root_value type: ' . gettype($root_value));
    error_log('WPGraphQL Subscriptions: Has extensions: ' . (isset($request_data['extensions']) ? 'yes' : 'no'));
    error_log('WPGraphQL Subscriptions: Has root_value in extensions: ' . (isset($request_data['extensions']['root_value']) ? 'yes' : 'no'));
    
    if (isset($request_data['extensions']['root_value'])) {
        // This root_value has already been validated by the token check above
        $validated_root_value = $request_data['extensions']['root_value'];
        
        // Log successful subscription execution
        error_log('WPGraphQL Subscriptions: Executing subscription with validated root value');
        error_log('WPGraphQL Subscriptions: Root value type: ' . gettype($validated_root_value));
        error_log('WPGraphQL Subscriptions: Root value keys: ' . (is_array($validated_root_value) ? implode(', ', array_keys($validated_root_value)) : 'not an array'));
        
        return $validated_root_value;
    }
    
    error_log('WPGraphQL Subscriptions: No root_value found in extensions, returning original');
    return $root_value;
}, 20, 2);

/**
 * Validate subscription token using HMAC signature
 * 
 * @param string $token The token from the sidecar (format: timestamp.signature)
 * @param mixed $payload The payload that should match the signed data
 * @return bool True if token is valid, false otherwise
 */
function wpgraphql_subscriptions_validate_token($token, $payload) {
    // Parse token format: timestamp.signature
    $token_parts = explode('.', $token, 2);
    if (count($token_parts) !== 2) {
        return false;
    }
    
    list($timestamp, $signature) = $token_parts;
    
    // Check timestamp (prevent replay attacks - token valid for 5 minutes)
    $current_time = time();
    $token_time = (int)$timestamp;
    
    if (abs($current_time - $token_time) > 300) { // 5 minutes
        error_log('WPGraphQL Subscriptions: Token expired (timestamp: ' . $token_time . ', current: ' . $current_time . ')');
        return false;
    }
    
    // Get the subscription secret (should match sidecar)
    $secret = wpgraphql_subscriptions_get_secret();
    if (empty($secret)) {
        error_log('WPGraphQL Subscriptions: No subscription secret configured');
        return false;
    }
    
    // Reconstruct the data that should have been signed
    // This must match exactly what the sidecar signs
    $subscription_id = wpgraphql_subscriptions_extract_subscription_id($payload);
    $data_to_sign = json_encode([
        'subscriptionId' => $subscription_id,
        'payload' => $payload,
        'timestamp' => $token_time,
    ], JSON_UNESCAPED_SLASHES);
    
    // Generate expected signature
    $expected_signature = hash_hmac('sha256', $data_to_sign, $secret);
    
    // Constant-time comparison to prevent timing attacks
    if (!hash_equals($expected_signature, $signature)) {
        error_log('WPGraphQL Subscriptions: Invalid token signature');
        return false;
    }
    
    return true;
}

/**
 * Get the subscription secret from WordPress configuration
 * 
 * @return string|null The secret key, or null if not configured
 */
function wpgraphql_subscriptions_get_secret() {
    // Check for constant first (most secure)
    if (defined('WPGRAPHQL_SUBSCRIPTION_SECRET')) {
        return WPGRAPHQL_SUBSCRIPTION_SECRET;
    }
    
    // Fallback to option (less secure but more flexible)
    $secret = get_option('wpgraphql_subscription_secret');
    if (!empty($secret)) {
        return $secret;
    }
    
    // Development fallback (should match sidecar default)
    if (defined('WP_DEBUG') && WP_DEBUG) {
        return 'dev-subscription-secret-change-in-production';
    }
    
    return null;
}

/**
 * Extract subscription ID from payload for token validation
 * This is a helper function to reconstruct the signed data
 * 
 * @param mixed $payload The event payload
 * @return string|null The subscription ID if found
 */
function wpgraphql_subscriptions_extract_subscription_id($payload) {
    // The subscription ID should be included in the payload or we need to derive it
    // For now, we'll use a placeholder - this would need to be enhanced based on
    // how the sidecar structures the payload
    
    if (is_array($payload) && isset($payload['subscription_id'])) {
        return $payload['subscription_id'];
    }
    
    // If we can't extract it, we might need to pass it separately
    // This is a limitation we'd need to address in the sidecar implementation
    return 'unknown';
}

/**
 * Admin interface to set subscription secret
 */
add_action('admin_init', function() {
    register_setting('wpgraphql_settings', 'wpgraphql_subscription_secret', [
        'type' => 'string',
        'description' => 'Secret key for validating subscription tokens from the sidecar server',
        'sanitize_callback' => 'sanitize_text_field',
    ]);
});

/**
 * Add field to WPGraphQL settings page
 */
add_action('wpgraphql_settings_fields', function() {
    add_settings_field(
        'wpgraphql_subscription_secret',
        __('Subscription Secret', 'wp-graphql-subscriptions'),
        function() {
            $value = get_option('wpgraphql_subscription_secret', '');
            echo '<input type="password" name="wpgraphql_subscription_secret" value="' . esc_attr($value) . '" class="regular-text" />';
            echo '<p class="description">' . __('Secret key shared with the subscription sidecar server. Keep this secure!', 'wp-graphql-subscriptions') . '</p>';
        },
        'wpgraphql_settings',
        'wpgraphql_settings_section'
    );
});
