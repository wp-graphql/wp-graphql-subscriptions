<?php
/**
 * Examples of how other plugins can consume the universal WordPress event bus
 * 
 * The WPGraphQL_Event_Emitter creates generic events that any plugin can use.
 * This file shows practical examples of different consumers.
 */

// ============================================================================
// Example 1: WPGraphQL Smart Cache Integration
// ============================================================================

/**
 * Hook into WordPress events to purge Varnish cache intelligently
 */
add_action( 'wpgraphql_generic_event', function( $node_type, $action, $event_payload ) {
    
    // Only handle post updates for cache purging
    if ( $node_type !== 'post' || $action !== 'UPDATE' ) {
        return;
    }
    
    $post_id = $event_payload['node_id'];
    $post = $event_payload['context']['post'] ?? null;
    
    if ( ! $post ) {
        return;
    }
    
    // Purge specific cache tags
    $cache_tags = [
        "post:{$post_id}",
        "post_type:{$post->post_type}",
        "author:{$post->post_author}",
    ];
    
    // Add category cache tags
    $categories = get_the_category( $post_id );
    foreach ( $categories as $category ) {
        $cache_tags[] = "category:{$category->term_id}";
    }
    
    // Purge Varnish cache
    foreach ( $cache_tags as $tag ) {
        wp_remote_request( 'http://varnish:6081/', [
            'method' => 'PURGE',
            'headers' => [
                'X-Cache-Tags' => $tag,
            ],
        ] );
    }
    
    error_log( "WPGraphQL Smart Cache: Purged " . count( $cache_tags ) . " cache tags for post {$post_id}" );
    
}, 10, 3 );

// ============================================================================
// Example 2: Debug Webhook Integration
// ============================================================================

/**
 * Send all WordPress events to webhook.site for debugging
 */
add_action( 'wpgraphql_generic_event', function( $node_type, $action, $event_payload ) {
    
    // Only send events in development
    if ( ! defined( 'WP_DEBUG' ) || ! WP_DEBUG ) {
        return;
    }
    
    // Your webhook.site URL
    $webhook_url = 'https://webhook.site/your-unique-id';
    
    // Prepare debug payload
    $debug_payload = [
        'timestamp' => current_time( 'c' ),
        'event' => "{$node_type}.{$action}",
        'node_id' => $event_payload['node_id'],
        'context_keys' => array_keys( $event_payload['context'] ),
        'metadata' => $event_payload['metadata'],
        'site_url' => home_url(),
    ];
    
    // Send to webhook.site
    wp_remote_post( $webhook_url, [
        'headers' => [
            'Content-Type' => 'application/json',
        ],
        'body' => wp_json_encode( $debug_payload ),
        'timeout' => 5,
        'blocking' => false, // Don't block WordPress execution
    ] );
    
}, 10, 3 );

// ============================================================================
// Example 3: Analytics Integration
// ============================================================================

/**
 * Track content changes for analytics dashboard
 */
add_action( 'wpgraphql_generic_event', function( $node_type, $action, $event_payload ) {
    
    // Track various content events
    $tracked_events = [
        'post.CREATE' => 'content_published',
        'post.UPDATE' => 'content_updated',
        'comment.CREATE' => 'comment_added',
        'user.CREATE' => 'user_registered',
    ];
    
    $event_key = "{$node_type}.{$action}";
    
    if ( ! isset( $tracked_events[ $event_key ] ) ) {
        return;
    }
    
    $analytics_event = $tracked_events[ $event_key ];
    
    // Prepare analytics data
    $analytics_data = [
        'event' => $analytics_event,
        'node_type' => $node_type,
        'node_id' => $event_payload['node_id'],
        'user_id' => $event_payload['metadata']['user_id'] ?? 0,
        'timestamp' => $event_payload['metadata']['timestamp'],
    ];
    
    // Add specific data based on node type
    if ( $node_type === 'post' && isset( $event_payload['context']['post'] ) ) {
        $post = $event_payload['context']['post'];
        $analytics_data['post_type'] = $post->post_type;
        $analytics_data['post_status'] = $post->post_status;
        $analytics_data['word_count'] = str_word_count( strip_tags( $post->post_content ) );
    }
    
    // Store in custom analytics table
    global $wpdb;
    $wpdb->insert(
        $wpdb->prefix . 'content_analytics',
        $analytics_data,
        [ '%s', '%s', '%d', '%d', '%d' ]
    );
    
    error_log( "Content Analytics: Tracked {$analytics_event} for {$node_type} #{$event_payload['node_id']}" );
    
}, 10, 3 );

// ============================================================================
// Example 4: Zapier Integration
// ============================================================================

/**
 * Send WordPress events to Zapier webhooks for automation
 */
add_action( 'wpgraphql_generic_event', function( $node_type, $action, $event_payload ) {
    
    // Only trigger on specific high-value events
    $zapier_events = [
        'post.CREATE' => get_option( 'zapier_webhook_post_published' ),
        'comment.CREATE' => get_option( 'zapier_webhook_comment_added' ),
        'user.CREATE' => get_option( 'zapier_webhook_user_registered' ),
    ];
    
    $event_key = "{$node_type}.{$action}";
    $webhook_url = $zapier_events[ $event_key ] ?? null;
    
    if ( ! $webhook_url ) {
        return;
    }
    
    // Prepare Zapier-friendly payload
    $zapier_payload = [
        'event_type' => $event_key,
        'site_name' => get_bloginfo( 'name' ),
        'site_url' => home_url(),
        'node_id' => $event_payload['node_id'],
        'timestamp' => $event_payload['metadata']['timestamp'],
        'user_id' => $event_payload['metadata']['user_id'] ?? 0,
    ];
    
    // Add node-specific data
    if ( $node_type === 'post' && isset( $event_payload['context']['post'] ) ) {
        $post = $event_payload['context']['post'];
        $zapier_payload['post_title'] = $post->post_title;
        $zapier_payload['post_url'] = get_permalink( $post->ID );
        $zapier_payload['post_type'] = $post->post_type;
        $zapier_payload['post_excerpt'] = wp_trim_words( $post->post_content, 50 );
    }
    
    // Send to Zapier
    wp_remote_post( $webhook_url, [
        'headers' => [
            'Content-Type' => 'application/json',
        ],
        'body' => wp_json_encode( $zapier_payload ),
        'timeout' => 10,
        'blocking' => false, // Don't block WordPress
    ] );
    
    error_log( "Zapier Integration: Sent {$event_key} to webhook for node #{$event_payload['node_id']}" );
    
}, 10, 3 );

// ============================================================================
// Example 5: Custom Notification System
// ============================================================================

/**
 * Send email notifications for important content events
 */
add_action( 'wpgraphql_generic_event', function( $node_type, $action, $event_payload ) {
    
    // Only send notifications for post publications
    if ( $node_type !== 'post' || $action !== 'CREATE' ) {
        return;
    }
    
    $post = $event_payload['context']['post'] ?? null;
    
    if ( ! $post || $post->post_status !== 'publish' ) {
        return;
    }
    
    // Get notification subscribers
    $subscribers = get_option( 'content_notification_emails', [] );
    
    if ( empty( $subscribers ) ) {
        return;
    }
    
    // Prepare email
    $subject = sprintf( '[%s] New Post Published: %s', get_bloginfo( 'name' ), $post->post_title );
    $message = sprintf(
        "A new post has been published on %s:\n\n" .
        "Title: %s\n" .
        "URL: %s\n" .
        "Author: %s\n" .
        "Published: %s\n\n" .
        "Excerpt:\n%s",
        get_bloginfo( 'name' ),
        $post->post_title,
        get_permalink( $post->ID ),
        get_the_author_meta( 'display_name', $post->post_author ),
        get_the_date( 'F j, Y \a\t g:i a', $post->ID ),
        wp_trim_words( $post->post_content, 100 )
    );
    
    // Send to all subscribers
    foreach ( $subscribers as $email ) {
        wp_mail( $email, $subject, $message );
    }
    
    error_log( "Notification System: Sent new post alerts to " . count( $subscribers ) . " subscribers" );
    
}, 10, 3 );
