# Channel Mapping Strategy

## Overview

This document defines how GraphQL subscription arguments map to Redis pub/sub channels using a simplified single-argument constraint to ensure predictability and maintainability.

## Core Requirements

1. **Predictable**: Channel names must be deterministic from subscription arguments
2. **Simple**: Support 0 or 1 arguments maximum (Phase 1 constraint)
3. **Efficient**: Minimize Redis memory usage and lookup complexity
4. **Filterable**: Use broad channels with server-side filtering for complex logic

## Phase 1 Approach: Dual Channel Publishing

To support both specific and global subscriptions, WordPress publishes each event to **two channels**:

1. **Specific Channel**: `{subscriptionName}.{nodeId}` - for targeted subscriptions like `postUpdated(id: "123")`
2. **Global Channel**: `{subscriptionName}` - for broad subscriptions like `postUpdated()` 

This allows:
- `postUpdated(id: "123")` → subscribes to `"postUpdated.123"`
- `postUpdated()` → subscribes to `"postUpdated"` (receives ALL post updates)

Complex filtering happens in WPGraphQL resolvers using server-side filtering.

## Channel Naming Convention

### Base Pattern (Single Argument Constraint)
```
{subscriptionName}[.{argumentValue}]
```

### Mapping Rules

#### 1. No Arguments (Global Subscriptions)
Use subscription name only:
```javascript
postCreated() → "postCreated"
userRegistered() → "userRegistered"
commentCreated() → "commentCreated"
```

#### 2. Single ID Argument
Append the ID value directly:
```javascript
postUpdated(id: "123") → "postUpdated.123"
userUpdated(id: "456") → "userUpdated.456"
commentUpdated(id: "789") → "commentUpdated.789"
```

#### 3. Complex Filtering (Future Phase)
For complex filtering needs, use broad channels + server-side filtering:
```javascript
// Client subscription with complex args
postUpdated(where: {authorId: 123, status: "PUBLISH"})

// Maps to broad channel
→ "postUpdated"

// WPGraphQL resolver filters using root_value + subscription args
```

## Implementation Details

### Channel Builder Class (Simplified)
```typescript
class ChannelBuilder {
  static build(subscriptionName: string, args: Record<string, any>): string {
    // No arguments - use subscription name only
    if (!args || Object.keys(args).length === 0) {
      return subscriptionName;
    }

    // Validate single argument constraint
    const argKeys = Object.keys(args);
    if (argKeys.length > 1) {
      throw new Error(`Subscription ${subscriptionName} has ${argKeys.length} arguments. Only 0 or 1 argument is supported.`);
    }

    // Single argument - append value directly
    const argValue = args[argKeys[0]];
    return `${subscriptionName}.${String(argValue)}`;
  }

  static validateSubscriptionArgs(subscriptionName: string, args: Record<string, any>): void {
    const argCount = Object.keys(args || {}).length;
    if (argCount > 1) {
      throw new Error(`Subscription ${subscriptionName} violates single-argument constraint (has ${argCount} arguments)`);
    }
  }
}
```

## WordPress Event Emission

### WordPress Action Hook Pattern
```php
// Use existing WPGraphQL_Event_Emitter system
WPGraphQL_Event_Emitter::emit(
    $node_type,       // 'post', 'user', 'comment', etc.
    $action,          // 'CREATE', 'UPDATE', 'DELETE'
    $node_id,         // The resource ID
    $context,         // Context data (e.g., post object)
    $metadata         // Event metadata
);

// This automatically triggers the standardized action hook:
// do_action('graphql_subscription_event', $subscription_event_type, $event_payload);

// Event routing handlers (configurable)
add_action('graphql_subscription_event', 'wp_graphql_route_to_redis', 10, 2);
add_action('graphql_subscription_event', 'wp_graphql_route_to_webhook', 10, 2);

function wp_graphql_route_to_redis(string $subscription_name, array $payload): void {
    if (!defined('WPGRAPHQL_REDIS_ENABLED') || !WPGRAPHQL_REDIS_ENABLED) {
        return;
    }
    
    // For Phase 1: Publish to both specific ID channel and global channel
    // This allows both postUpdated(id: "123") and postUpdated() subscriptions
    if (isset($payload['node_id'])) {
        // Specific channel: postUpdated.123
        wp_graphql_redis_publish("{$subscription_name}.{$payload['node_id']}", $payload);
    }
    
    // Global channel: postUpdated  
    wp_graphql_redis_publish($subscription_name, $payload);
}

function wp_graphql_route_to_webhook(string $subscription_name, array $payload): void {
    if (!defined('WPGRAPHQL_YOGA_WEBHOOK_URL')) {
        return;
    }
    
    wp_remote_post(WPGRAPHQL_YOGA_WEBHOOK_URL, [
        'body' => wp_json_encode([
            'channel' => $subscription_name,
            'payload' => $payload
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
}
```

## Event Publishing Examples

### WordPress Post Update (Existing Implementation)
```php
// When a post is updated - using existing WPGraphQL_Event_Emitter
add_action('post_updated', function($post_id, $post_after, $post_before) {
    // Skip auto-saves and revisions
    if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
        return;
    }
    
    // Use existing event emitter system
    WPGraphQL_Event_Emitter::emit(
        'post',                    // node_type
        'UPDATE',                  // action
        $post_id,                  // node_id
        [                          // context
            'post' => $post_after,
            'post_type' => $post_after->post_type,
        ],
        [                          // metadata
            'hook' => 'post_updated',
        ]
    );
    
    // This automatically triggers:
    // do_action('graphql_subscription_event', 'postUpdated', $event_payload);
    // 
    // Event handlers will publish to appropriate channels:
    // - "postUpdated.123" (for postUpdated(id: "123") subscriptions)  
    // - "postUpdated" (for postUpdated() global subscriptions)
}, 10, 3);
```

## Channel Pattern Examples (Phase 1: Single Argument Only)

### Valid Subscription Patterns

```javascript
// Specific resource updates (single ID argument)
postUpdated(id: "cG9zdDoxMjM=") → "postUpdated.cG9zdDoxMjM="
userUpdated(id: "dXNlcjo0NTY=") → "userUpdated.dXNlcjo0NTY="
commentUpdated(id: "Y29tbWVudDo3ODk=") → "commentUpdated.Y29tbWVudDo3ODk="

// Global subscriptions (no arguments)
postCreated() → "postCreated"
postDeleted() → "postDeleted"
userLoggedIn() → "userLoggedIn"
commentCreated() → "commentCreated"

// Single non-ID arguments (if needed)
postsByStatus(status: "PUBLISH") → "postsByStatus.PUBLISH"
usersByRole(role: "AUTHOR") → "usersByRole.AUTHOR"
```

### Invalid Patterns (Phase 1 Constraint)

```javascript
// ❌ Multiple arguments - NOT SUPPORTED in Phase 1
postUpdated(id: "123", status: "PUBLISH") // ERROR: Too many arguments

// ❌ Complex object arguments - NOT SUPPORTED in Phase 1  
commentCreated(where: {postId: "123"}) // ERROR: Complex argument

// ❌ These would need to use broad channels + server-side filtering
postUpdated(where: {authorId: 123, status: "PUBLISH"}) // Use postUpdated() instead
```

### WordPress Hook Integration (Phase 1 Simplified)

```php
// Post events - publish to both specific and global channels
add_action('wp_insert_post', function($post_id, $post, $update) {
    $payload = [
        'node_type' => 'post',
        'node_id' => $post_id,
        'action' => $update ? 'UPDATE' : 'CREATE',
        'context' => ['post' => $post],
        'timestamp' => time()
    ];
    
    if ($update) {
        // Publish to specific post channel: postUpdated.123
        wp_graphql_emit_subscription_event('postUpdated', $payload);
    } else {
        // Publish to global creation channel: postCreated
        wp_graphql_emit_subscription_event('postCreated', $payload);
    }
}, 10, 3);

// Comment events - only global for Phase 1
add_action('wp_insert_comment', function($comment_id, $comment) {
    $payload = [
        'node_type' => 'comment',
        'node_id' => $comment_id,
        'action' => 'CREATE',
        'context' => [
            'comment' => $comment,
            'post_id' => $comment->comment_post_ID
        ],
        'timestamp' => time()
    ];
    
    // Global comment creation: commentCreated
    wp_graphql_emit_subscription_event('commentCreated', $payload);
    
    // Specific comment updates would be: commentUpdated.{comment_id}
}, 10, 2);
```

## Performance Considerations

### Channel Explosion Prevention
- Hash complex objects to fixed-length strings
- Limit argument depth for hashing
- Monitor Redis memory usage for channel patterns

### Optimization Strategies
- Use Redis key expiration for unused channels
- Implement channel cleanup for inactive subscriptions
- Consider channel pattern wildcards for broad subscriptions

### Memory Management
- Set TTL on Redis channels (e.g., 1 hour)
- Clean up channels when last subscriber disconnects
- Monitor channel count and implement alerts

## Error Handling

### Invalid Arguments
- Log warnings for unsupported argument types
- Fall back to hashing for unknown complex types
- Provide clear error messages for debugging

### Channel Conflicts
- Use subscription name prefix to avoid conflicts
- Implement channel validation during subscription creation
- Add debugging tools for channel inspection

## Debugging Tools

### Channel Inspector
```typescript
class ChannelInspector {
  static explainChannel(subscriptionName: string, args: any): ChannelExplanation {
    const channel = ChannelBuilder.build(subscriptionName, args);
    
    return {
      channel,
      subscriptionName,
      arguments: args,
      mappings: this.explainMappings(args),
      redisPattern: `PSUBSCRIBE ${channel}*`
    };
  }
}
```

### WordPress Debug Helper
```php
function wp_graphql_debug_channel(string $subscription_name, array $args): void {
    $channel = wp_graphql_build_channel_name($subscription_name, $args);
    error_log("WPGraphQL Subscription Channel: {$channel}");
    error_log("Arguments: " . json_encode($args));
}
```
