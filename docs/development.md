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
   
   This should show database tables are created and ready:
   - `wp_wpgraphql_subscription_events` (Event queue)
   - `wp_wpgraphql_subscription_connections` (Connection tokens)  
   - `wp_wpgraphql_subscription_documents` (Subscription documents)

5. **Test GraphQL-SSE Protocol**
   
   Open the test client at `/wp-content/plugins/wp-graphql-subscriptions/test-graphql-sse.html` in your browser and:
   - Click "Make Reservation (PUT)" - should show success
   - Click "Execute GraphQL Operation (POST)" - should show "Operation accepted"  
   - Click "Establish SSE Connection (GET)" - should show connection and test event
   - Update a WordPress post - should show real-time `postUpdated` data

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
│   ├── interface-wpgraphql-subscription-storage.php # ✅ Storage interface
│   ├── class-wpgraphql-subscription-database-storage.php # ✅ Database storage
│   ├── class-wpgraphql-subscription-connection.php # ✅ Connection management
│   ├── class-wpgraphql-connection-manager.php # ✅ Connection manager
│   ├── class-wpgraphql-subscription-cli.php   # ✅ WP-CLI commands
│   ├── event-stream.php                       # ✅ GraphQL-SSE routing
│   ├── events.php                            # ✅ WordPress hooks
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

4. **Subscription Storage System** (Storage classes)
   - Cross-process subscription document persistence
   - Swappable storage backends (Database, Redis, etc.)
   - Connection lifecycle management with automatic expiry
   - Database tables for connections and subscription documents

5. **WordPress Integration** (`events.php`, `event-stream.php`)
   - Post update tracking
   - GraphQL-SSE protocol routing
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

## Production Deployment & Scaling

### Pre-Production Checklist

#### Database Optimization
```sql
-- Add performance indexes (run once)
CREATE INDEX idx_events_created_at ON wp_wpgraphql_subscription_events(created_at);
CREATE INDEX idx_connections_expires ON wp_wpgraphql_subscription_connections(expires_at);
CREATE INDEX idx_docs_token ON wp_wpgraphql_subscription_documents(connection_token);

-- Monitor table sizes
SELECT 
    table_name,
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)',
    table_rows AS 'Rows'
FROM information_schema.tables 
WHERE table_name LIKE '%wpgraphql_subscription%';
```

#### Server Configuration
```ini
# PHP-FPM optimizations
pm = dynamic
pm.max_children = 50          # Increase for more concurrent SSE connections
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 15
pm.max_requests = 200         # Restart workers to prevent memory leaks
request_terminate_timeout = 300s  # Allow long-running SSE connections
```

```nginx
# Nginx optimizations for SSE
location ~ \.php$ {
    fastcgi_buffering off;           # Critical for SSE
    fastcgi_read_timeout 300s;       # Match PHP timeout
    fastcgi_send_timeout 300s;
    client_max_body_size 1M;
    
    # Proxy settings if using reverse proxy
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
}
```

### Scaling Strategy by Traffic Level

#### Stage 1: Small Production (< 10 concurrent connections)
```php
// wp-config.php optimizations
define('WP_DEBUG', false);                    // Disable debug logging
define('WP_CACHE', true);                     // Enable object caching
define('AUTOMATIC_UPDATER_DISABLED', true);   // Prevent update interruptions

// Optimize cleanup frequency
add_action('init', function() {
    wp_clear_scheduled_hook('wpgraphql_subscription_cleanup');
    wp_schedule_event(time(), 'every_30_minutes', 'wpgraphql_subscription_cleanup');
});
```

#### Stage 2: Medium Production (10-50 concurrent connections)
```php
// Enhanced cleanup and monitoring
add_filter('wpgraphql_subscription_event_retention_hours', function() {
    return 2; // Reduce retention from 24 hours to 2 hours
});

// Add performance monitoring
add_action('wpgraphql_subscription_cleanup', function() {
    // Log performance metrics
    global $wpdb;
    $event_count = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}wpgraphql_subscription_events");
    $connection_count = $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}wpgraphql_subscription_connections");
    
    error_log("WPGraphQL Subscriptions Stats: {$event_count} events, {$connection_count} connections");
    
    if ($event_count > 10000) {
        error_log("WARNING: High event count detected. Consider Redis migration.");
    }
});
```

#### Stage 3: Large Production (50+ concurrent connections)
```php
// Migrate to Redis storage
add_filter('wpgraphql_subscription_storage', function() {
    if (defined('REDIS_HOST') && class_exists('Redis')) {
        return new WPGraphQL_Subscription_Redis_Storage([
            'host' => REDIS_HOST,
            'port' => REDIS_PORT ?: 6379,
            'password' => REDIS_PASSWORD ?? null,
            'database' => REDIS_DB ?: 0,
            'prefix' => 'wpgql_sub:',
            'ttl' => 3600 // 1 hour default TTL
        ]);
    }
    
    // Fallback to optimized database storage
    return new WPGraphQL_Subscription_Database_Storage();
});

// Monitor Redis performance
add_action('wp_loaded', function() {
    if (defined('WP_CLI') && WP_CLI) {
        WP_CLI::add_command('wpgraphql subscription redis-stats', function() {
            $storage = apply_filters('wpgraphql_subscription_storage', null);
            if ($storage instanceof WPGraphQL_Subscription_Redis_Storage) {
                $info = $storage->get_redis_info();
                WP_CLI::line("Redis Memory Usage: " . $info['used_memory_human']);
                WP_CLI::line("Connected Clients: " . $info['connected_clients']);
                WP_CLI::line("Total Keys: " . $info['db0']['keys'] ?? 0);
            }
        });
    }
});
```

### Performance Monitoring

#### Key Metrics to Track
```php
// Custom monitoring hooks
add_action('wpgraphql_subscription_event_processed', function($event, $processing_time) {
    if ($processing_time > 100) { // Log slow processing (>100ms)
        error_log("Slow subscription processing: {$processing_time}ms for event {$event['event_type']}");
    }
}, 10, 2);

add_action('wpgraphql_subscription_connection_created', function($token) {
    // Track connection creation rate
    wp_cache_incr('wpgql_connections_created_' . date('H'), 1, 'wpgql_stats');
});
```

#### Database Performance Queries
```sql
-- Monitor slow queries
SELECT * FROM mysql.slow_log 
WHERE sql_text LIKE '%wpgraphql_subscription%' 
ORDER BY start_time DESC LIMIT 10;

-- Check table locks
SHOW ENGINE INNODB STATUS\G

-- Monitor connection usage
SHOW PROCESSLIST;
```

### Troubleshooting Production Issues

#### High Database Load
```bash
# Check for missing indexes
wp db query "EXPLAIN SELECT * FROM wp_wpgraphql_subscription_events WHERE created_at > NOW() - INTERVAL 1 HOUR"

# Monitor table growth
wp db query "SELECT COUNT(*) as event_count, DATE(created_at) as date FROM wp_wpgraphql_subscription_events GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 7"
```

#### Memory Issues
```php
// Monitor PHP memory usage in SSE streams
add_action('wpgraphql_subscription_stream_loop', function() {
    $memory = memory_get_usage(true);
    $peak = memory_get_peak_usage(true);
    
    if ($memory > 50 * 1024 * 1024) { // 50MB warning
        error_log("High memory usage in SSE stream: " . round($memory/1024/1024) . "MB");
    }
});
```

#### Connection Pool Exhaustion
```ini
# MySQL configuration adjustments
max_connections = 200
innodb_buffer_pool_size = 256M
query_cache_size = 64M
tmp_table_size = 64M
max_heap_table_size = 64M
```

### Migration to Redis

#### Step 1: Install Redis
```bash
# Ubuntu/Debian
sudo apt-get install redis-server php-redis

# CentOS/RHEL
sudo yum install redis php-redis

# Verify installation
redis-cli ping
# Should return: PONG
```

#### Step 2: Implement Redis Storage
```php
// Create Redis storage class (example)
class WPGraphQL_Subscription_Redis_Storage implements WPGraphQL_Subscription_Storage_Interface {
    private $redis;
    private $prefix;
    private $ttl;
    
    public function __construct($config = []) {
        $this->redis = new Redis();
        $this->redis->connect(
            $config['host'] ?? '127.0.0.1',
            $config['port'] ?? 6379
        );
        
        if (!empty($config['password'])) {
            $this->redis->auth($config['password']);
        }
        
        if (isset($config['database'])) {
            $this->redis->select($config['database']);
        }
        
        $this->prefix = $config['prefix'] ?? 'wpgql:';
        $this->ttl = $config['ttl'] ?? 3600;
    }
    
    public function store_connection($token, $expires_at = null) {
        $key = $this->prefix . 'conn:' . $token;
        $ttl = $expires_at ? strtotime($expires_at) - time() : $this->ttl;
        
        return $this->redis->setex($key, $ttl, json_encode([
            'created_at' => time(),
            'expires_at' => $expires_at
        ]));
    }
    
    // Implement other interface methods...
}
```

#### Step 3: Gradual Migration
```php
// Hybrid approach during migration
class WPGraphQL_Subscription_Hybrid_Storage implements WPGraphQL_Subscription_Storage_Interface {
    private $redis_storage;
    private $db_storage;
    private $use_redis;
    
    public function __construct() {
        $this->db_storage = new WPGraphQL_Subscription_Database_Storage();
        
        try {
            $this->redis_storage = new WPGraphQL_Subscription_Redis_Storage();
            $this->use_redis = true;
        } catch (Exception $e) {
            error_log("Redis unavailable, falling back to database: " . $e->getMessage());
            $this->use_redis = false;
        }
    }
    
    public function store_connection($token, $expires_at = null) {
        if ($this->use_redis) {
            return $this->redis_storage->store_connection($token, $expires_at);
        }
        return $this->db_storage->store_connection($token, $expires_at);
    }
    
    // Implement other methods with Redis-first, DB-fallback pattern...
}
```

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