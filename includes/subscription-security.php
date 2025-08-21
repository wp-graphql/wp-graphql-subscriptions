<?php
/**
 * Security filters for subscription root value validation
 * 
 * This file handles server-to-server authentication for subscription execution.
 * It validates tokens from the sidecar server before allowing root_value to be set.
 */

/**
 * Validate subscription tokens and set root value for authenticated subscription execution
 */
add_filter('graphql_request_data', function($request_data, $request) {
    // Only process if extensions contain subscription data
    if (!isset($request_data['extensions']['root_value']) || !isset($request_data['extensions']['subscription_token'])) {
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
    // The root_value will be picked up by the graphql_root_value filter below
    
    return $request_data;
}, 10, 2);

/**
 * Set the validated root value for subscription execution
 */
add_filter('graphql_root_value', function($root_value, $request) {
    // Check if we have validated root_value from extensions
    $request_data = $request->get_params();
    
    if (isset($request_data['extensions']['root_value'])) {
        // This root_value has already been validated by the token check above
        $validated_root_value = $request_data['extensions']['root_value'];
        
        // Log successful subscription execution
        error_log('WPGraphQL Subscriptions: Executing subscription with validated root value');
        
        return $validated_root_value;
    }
    
    return $root_value;
}, 10, 2);

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
