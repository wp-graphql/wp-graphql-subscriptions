# Development Guide

## Getting Started

### Prerequisites

- WordPress 5.0+
- PHP 7.4+
- WPGraphQL 1.0+
- Local development environment (Local by Flywheel, MAMP, etc.)

### Development Setup

1. **Clone the repository**
   ```bash
   cd wp-content/plugins/
   git clone <repository-url> wp-graphql-subscriptions
   ```

2. **Install WPGraphQL** (if not already installed)
   ```bash
   wp plugin install wp-graphql --activate
   ```

3. **Activate the plugin**
   ```bash
   wp plugin activate wp-graphql-subscriptions
   ```

4. **Verify installation**
   ```bash
   wp wpgraphql subscription stats
   ```

### PHP-FPM Configuration for Development

For testing multiple concurrent connections, update your PHP-FPM pool settings:

```ini
; In Local by Flywheel: ~/Local Sites/{site}/conf/php/{version}/pool.d/www.conf
pm = dynamic
pm.max_children = 20        ; Increase from default 2
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 8
```

## Project Structure

```
wp-graphql-subscriptions/
├── wp-graphql-subscriptions.php    # Main plugin file
├── includes/
│   ├── class-wpgraphql-event-emitter.php      # ✅ Core event system
│   ├── class-wpgraphql-event-queue.php        # ✅ Database queue
│   ├── class-wpgraphql-subscriptions-stream.php # ✅ SSE handler
│   ├── class-wpgraphql-subscription-manager.php # Plugin coordinator
│   ├── event-stream.php                       # ✅ SSE routing
│   ├── events.php                            # ✅ WordPress hooks
│   ├── plugin-init.php                       # ✅ Initialization
│   ├── schema.php                            # ✅ GraphQL schema
│   └── transport-webhook.php                 # Webhook transport (optional)
└── docs/                                     # Documentation
```

**Legend**: ✅ = Recently updated/core to current functionality

## Current Development State

### ✅ Completed Features

1. **Database Event Queue** (`class-wpgraphql-event-queue.php`)
   - Multi-process safe event storage
   - Time-based event retrieval
   - Automatic cleanup system
   - Statistics and monitoring

2. **SSE Transport** (`class-wpgraphql-subscriptions-stream.php`)
   - Long-running HTTP connections
   - Session handling to prevent blocking
   - Heartbeat and ping mechanisms
   - Client disconnection detection

3. **Event Emission** (`class-wpgraphql-event-emitter.php`)
   - Standardized event format
   - WordPress hook integration
   - Event validation and enrichment

4. **WordPress Integration** (`events.php`, `event-stream.php`)
   - Post update tracking
   - URL routing for SSE endpoint
   - Admin interface hooks

### 🚧 In Progress / Next Priority

1. **Subscription Filtering**
   - Parse GraphQL subscription documents
   - Store subscription parameters
   - Filter events based on subscription arguments

2. **Authentication & Authorization**
   - User permission checks for subscriptions
   - Session-based authentication for SSE endpoints

3. **Enhanced Error Handling**
   - Better client error reporting
   - Graceful degradation on failures

## Testing

### Manual Testing Setup

1. **Start multiple SSE streams**:
   ```bash
   # Terminal 1
   curl -N "http://yoursite.local/?gql_subscription=stream1"
   
   # Terminal 2  
   curl -N "http://yoursite.local/?gql_subscription=stream2"
   ```

2. **Trigger events**:
   ```bash
   # Update a post via WP-CLI
   wp post update 1 --post_title="Updated Title"
   
   # Or use the test command
   wp wpgraphql subscription test-event --type=postUpdated --node-id=1
   ```

3. **Monitor the database**:
   ```sql
   SELECT * FROM wp_wpgraphql_subscription_events ORDER BY created_at DESC LIMIT 10;
   ```

### JavaScript Testing

```html
<!DOCTYPE html>
<html>
<head><title>Subscription Test</title></head>
<body>
    <div id="events"></div>
    <script>
        const eventSource = new EventSource('/?gql_subscription=test123');
        const events = document.getElementById('events');
        
        eventSource.onmessage = function(event) {
            const div = document.createElement('div');
            div.textContent = `${new Date().toLocaleTimeString()}: ${event.data}`;
            events.appendChild(div);
        };
        
        eventSource.addEventListener('next', function(event) {
            const div = document.createElement('div');
            div.innerHTML = `<strong>GraphQL Event:</strong> ${event.data}`;
            events.appendChild(div);
        });
    </script>
</body>
</html>
```

## Debugging

### Enable Debug Logging

Add to `wp-config.php`:
```php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('GRAPHQL_DEBUG', true);
```

### Key Debug Points

1. **Event Emission** - Check if events are being created:
   ```php
   // In events.php
   error_log('Event emitted: ' . $event_type . ' for node ' . $node_id);
   ```

2. **Database Queue** - Verify events are stored:
   ```bash
   wp db query "SELECT COUNT(*) FROM wp_wpgraphql_subscription_events"
   ```

3. **SSE Stream** - Monitor stream activity:
   ```php
   // In stream class
   error_log('Stream processing events for connection: ' . $this->connection_id);
   ```

### Common Issues

#### "Table doesn't exist" Error
```bash
# Fix with WP-CLI
wp wpgraphql subscription create-table

# Or check manually
wp db query "SHOW TABLES LIKE 'wp_wpgraphql_subscription_events'"
```

#### Multiple connections freeze WordPress admin
- Check PHP-FPM `pm.max_children` setting
- Monitor active processes: `ps aux | grep php-fpm`

#### Events not appearing in streams
1. Verify events are stored in database
2. Check stream polling logic
3. Ensure proper timestamp handling

## Code Standards

### PHP Style

- Follow WordPress coding standards
- Use meaningful variable names
- Add PHPDoc blocks for all methods
- Error handling with `error_log()` for debugging

```php
/**
 * Add an event to the queue
 * 
 * @param string $subscription_type The subscription event type
 * @param int|null $node_id The ID of the affected node  
 * @param array $event_data The complete event payload
 * @return int|false The event ID if successful, false on failure
 */
public function add_event($subscription_type, $node_id, $event_data) {
    // Implementation...
}
```

### Database Queries

- Always use `$wpdb->prepare()` for dynamic queries
- Add proper error handling
- Use indexes for performance

```php
$events = $wpdb->get_results($wpdb->prepare(
    "SELECT * FROM {$this->table_name} WHERE created_at > %s",
    date('Y-m-d H:i:s', $timestamp)
));

if ($wpdb->last_error) {
    error_log('Database error: ' . $wpdb->last_error);
    return false;
}
```

## Architecture Decisions

### Why Database Queue Instead of Transients?

**Problem**: Transients use object cache which is process-isolated in PHP-FPM environments.

**Solution**: Database provides shared state across all PHP processes.

**Trade-offs**:
- ✅ Reliable multi-process operation
- ✅ Persistent event storage
- ❌ Slightly higher database load
- ❌ Requires cleanup mechanism

### Why SSE Instead of WebSockets?

**Advantages**:
- HTTP-compatible (works through proxies/firewalls)  
- Automatic browser reconnection
- Simpler implementation
- No additional server processes required

**Limitations**:
- One-way communication only
- Higher per-connection overhead than WebSockets
- Limited by PHP-FPM process pool

## Next Development Priorities

### 1. Subscription Parameter Filtering

**Goal**: Support subscription arguments like `postUpdated(id: 123)`

**Implementation Plan**:
1. Parse GraphQL subscription documents on registration
2. Store subscription parameters in database/taxonomy
3. Filter events during retrieval based on parameters
4. Update SSE handler to match events to subscriptions

**Files to Modify**:
- `class-wpgraphql-subscription-manager.php` - Add subscription parsing
- `class-wpgraphql-event-queue.php` - Add parameter-based filtering
- `schema.php` - Enhance subscription field definitions

### 2. Authentication Integration

**Goal**: Secure SSE endpoints with WordPress user authentication

**Implementation Plan**:
1. Add authentication check to SSE endpoint
2. Pass user context to event filtering
3. Implement permission-based event access
4. Add rate limiting per user

### 3. Production Optimizations

**Goal**: Prepare for higher-traffic scenarios

**Areas**:
- Connection pooling and management
- Event batching for high-frequency updates  
- Redis integration for event queue
- Horizontal scaling documentation

## Contributing Guidelines

1. **Create feature branches** from `main`
2. **Test thoroughly** with multiple concurrent connections
3. **Add documentation** for new features
4. **Update this development guide** with architectural changes
5. **Use WP-CLI commands** for testing and validation

## Resources

- [WPGraphQL Documentation](https://www.wpgraphql.com/)
- [GraphQL Subscriptions Spec](https://github.com/graphql/graphql-spec/blob/main/rfcs/Subscriptions.md)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [GraphQL over SSE Protocol](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md)