# API Reference

## GraphQL Schema

### RootSubscription Type

The main entry point for all GraphQL subscriptions.

```graphql
type RootSubscription {
  postUpdated(id: ID): Post
}
```

#### `postUpdated`

Subscribe to post update events.

**Arguments:**
- `id` (ID) - The ID of the post to subscribe to

**Returns:** `Post` - The updated post object

**Example:**
```graphql
subscription PostUpdates($postId: ID!) {
  postUpdated(id: $postId) {
    id
    title
    content
    modifiedOn
    author {
      node {
        name
      }
    }
  }
}
```

## SSE Endpoints

### Stream Endpoint

**URL:** `GET /?gql_subscription={connection_id}`

**Parameters:**
- `gql_subscription` (string) - Unique connection identifier

**Headers:**
- `Accept: text/event-stream`

**Response:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`  
- `Connection: keep-alive`

**Events:**

#### `connected`
Sent when stream connection is established.
```
event: connected
data: {"connection_id": "stream1", "pid": 1234}
```

#### `next`  
GraphQL subscription result data.
```
event: next
data: {"data": {"postUpdated": {"id": 123, "title": "Updated Post"}}}
```

#### `heartbeat`
Regular keepalive signal (every second).
```
event: heartbeat  
data: {"time": "2025-08-07T18:22:23Z", "pid": 1234}
```

#### `ping`
Extended keepalive signal (every 30 seconds).
```
event: ping
data: {"time": "2025-08-07T18:22:23Z", "connection_id": "stream1", "pid": 1234}
```

## PHP Classes

### WPGraphQL_Event_Emitter

Central event emission system for subscription events.

#### `emit()`

```php
WPGraphQL_Event_Emitter::emit(
    string $node_type,
    string $action,
    int $node_id,
    array $context = [],
    array $metadata = []
)
```

**Parameters:**
- `$node_type` (string) - Type of node ('post', 'user', 'comment')
- `$action` (string) - Action performed ('CREATE', 'UPDATE', 'DELETE')  
- `$node_id` (int) - ID of the affected node
- `$context` (array) - Additional context data
- `$metadata` (array) - Event metadata

**Example:**
```php
WPGraphQL_Event_Emitter::emit(
    'post',
    'UPDATE', 
    123,
    ['post' => $post_object, 'post_type' => 'post'],
    ['hook' => 'wp_insert_post', 'user_id' => 1]
);
```

### WPGraphQL_Event_Queue

Database-backed event queue for reliable multi-process event handling.

#### `get_instance()`

```php
$queue = WPGraphQL_Event_Queue::get_instance();
```

Returns singleton instance of the event queue.

#### `add_event()`

```php
$event_id = $queue->add_event(
    string $subscription_type,
    int|null $node_id,
    array $event_data
);
```

**Parameters:**
- `$subscription_type` (string) - Subscription event type ('postUpdated')
- `$node_id` (int|null) - Node ID for indexing
- `$event_data` (array) - Complete event payload

**Returns:** `int|false` - Event ID on success, false on failure

#### `get_events_since()`

```php
$events = $queue->get_events_since(
    float $since_timestamp,
    string|null $subscription_type = null
);
```

**Parameters:**
- `$since_timestamp` (float) - Unix timestamp to get events since
- `$subscription_type` (string|null) - Optional filter by subscription type

**Returns:** `array` - Array of event data

#### `cleanup_old_events()`

```php
$count = $queue->cleanup_old_events(int $hours = 24);
```

**Parameters:**
- `$hours` (int) - Hours old events must be to get cleaned up

**Returns:** `int` - Number of events cleaned up

#### `get_queue_stats()`

```php
$stats = $queue->get_queue_stats();
```

**Returns:** `array` - Queue statistics
```php
[
    'total_events' => 150,
    'recent_events' => 5,
    'oldest_event' => '2025-08-07 10:00:00',
    'newest_event' => '2025-08-07 18:22:23'
]
```

### WPGraphQL_Subscriptions_Stream

SSE endpoint handler for long-running subscription connections.

#### `__construct()`

```php
new WPGraphQL_Subscriptions_Stream(string $connection_id);
```

**Parameters:**
- `$connection_id` (string) - Unique connection identifier

Automatically starts the SSE stream and blocks until client disconnects.

## WordPress Hooks

### Actions

#### `graphql_subscription_event`

Fired when a subscription event is emitted.

```php
do_action('graphql_subscription_event', string $event_type, array $payload);
```

**Parameters:**
- `$event_type` (string) - Subscription event type
- `$payload` (array) - Complete event data

**Example:**
```php
add_action('graphql_subscription_event', function($event_type, $payload) {
    if ($event_type === 'postUpdated') {
        // Custom handling for post updates
    }
}, 10, 2);
```

#### `wpgraphql_cleanup_events`

Cron hook for cleaning up old events (runs hourly).

```php
add_action('wpgraphql_cleanup_events', function() {
    // Custom cleanup logic
});
```

## WP-CLI Commands

### `wp wpgraphql subscription stats`

Display event queue statistics.

```bash
wp wpgraphql subscription stats
```

**Output:**
```
WPGraphQL Subscription Queue Statistics:
=====================================
Total Events: 150
Recent Events: 5
Oldest Event: 2025-08-07 10:00:00
Newest Event: 2025-08-07 18:22:23
```

### `wp wpgraphql subscription cleanup`

Clean up old processed events.

```bash
wp wpgraphql subscription cleanup [--hours=<hours>]
```

**Options:**
- `--hours=<hours>` - Hours old events must be to get cleaned up (default: 24)

**Example:**
```bash
wp wpgraphql subscription cleanup --hours=6
```

### `wp wpgraphql subscription test-event`

Emit a test subscription event.

```bash
wp wpgraphql subscription test-event [--type=<type>] [--node-id=<id>]
```

**Options:**
- `--type=<type>` - Event type to emit (default: postUpdated)
- `--node-id=<id>` - Node ID for the event (default: 1)

**Example:**
```bash
wp wpgraphql subscription test-event --type=postCreated --node-id=123
```

### `wp wpgraphql subscription create-table`

Create the subscription events database table.

```bash
wp wpgraphql subscription create-table
```

### `wp wpgraphql subscription drop-table`

Drop the subscription events table (⚠️ **destructive**).

```bash
wp wpgraphql subscription drop-table [--yes]
```

**Options:**
- `--yes` - Skip confirmation prompt

## Database Schema

### Table: `wp_wpgraphql_subscription_events`

```sql
CREATE TABLE wp_wpgraphql_subscription_events (
    id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
    subscription_type varchar(50) NOT NULL,
    node_id bigint(20) unsigned NULL,
    event_data longtext NOT NULL,
    created_at datetime NOT NULL,
    processed_at datetime NULL,
    PRIMARY KEY (id),
    KEY idx_subscription_type (subscription_type),
    KEY idx_created_at (created_at), 
    KEY idx_processed (processed_at),
    KEY idx_node_id (node_id),
    KEY idx_type_created (subscription_type, created_at),
    KEY idx_unprocessed (processed_at, created_at)
);
```

**Columns:**
- `id` - Auto-incrementing event ID
- `subscription_type` - Type of subscription event ('postUpdated', etc.)
- `node_id` - ID of affected WordPress object (post ID, user ID, etc.)
- `event_data` - JSON-encoded complete event payload
- `created_at` - Event creation timestamp
- `processed_at` - Processing timestamp (currently unused)

## JavaScript Client Example

### Basic EventSource Connection

```javascript
class WPGraphQLSubscriptionClient {
    constructor(connectionId) {
        this.connectionId = connectionId;
        this.eventSource = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
    }
    
    connect() {
        const url = `/?gql_subscription=${this.connectionId}`;
        this.eventSource = new EventSource(url);
        
        this.eventSource.addEventListener('connected', (event) => {
            console.log('Connected:', JSON.parse(event.data));
            this.reconnectDelay = 1000; // Reset reconnect delay
        });
        
        this.eventSource.addEventListener('next', (event) => {
            const result = JSON.parse(event.data);
            this.handleSubscriptionData(result);
        });
        
        this.eventSource.addEventListener('error', () => {
            console.log('Connection error, reconnecting...');
            this.eventSource.close();
            
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay);
            
            // Exponential backoff
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
        });
    }
    
    handleSubscriptionData(result) {
        // Override this method to handle subscription data
        console.log('Subscription result:', result);
    }
    
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
}

// Usage
const client = new WPGraphQLSubscriptionClient('my-connection-id');
client.handleSubscriptionData = function(result) {
    if (result.data && result.data.postUpdated) {
        console.log('Post updated:', result.data.postUpdated);
    }
};
client.connect();
```

### Error Handling

```javascript
eventSource.addEventListener('error', function(event) {
    switch(eventSource.readyState) {
        case EventSource.CONNECTING:
            console.log('Reconnecting to stream...');
            break;
        case EventSource.CLOSED:
            console.log('Stream connection closed');
            break;
        default:
            console.log('Stream error:', event);
    }
});
```

## Event Data Format

### Standard Event Payload

```json
{
  "node_type": "post",
  "action": "UPDATE", 
  "node_id": 123,
  "context": {
    "post": {...},
    "post_type": "post"
  },
  "metadata": {
    "timestamp": 1691421743,
    "event_id": "post_UPDATE_64d1234567890",
    "user_id": 1,
    "hook": "wp_insert_post"
  }
}
```

### GraphQL Subscription Result

```json
{
  "data": {
    "postUpdated": {
      "id": "123",
      "title": "Updated Post Title",
      "content": "Updated post content...",
      "modifiedOn": "2025-08-07T18:22:23+00:00"
    }
  }
}
```

## Configuration

### PHP Settings

```php
// wp-config.php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('GRAPHQL_DEBUG', true); // Shows admin interfaces
```

### Server Settings

#### Nginx
```nginx
location ~ \.php$ {
    fastcgi_buffering off;
    fastcgi_read_timeout 300s;
    # ... other PHP-FPM settings
}
```

#### PHP-FPM
```ini
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 8
pm.max_requests = 500
```