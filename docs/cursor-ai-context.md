# AI Context for Cursor IDE

## Project Overview

**WPGraphQL Subscriptions** is an experimental WordPress plugin that adds real-time GraphQL Subscriptions support to WPGraphQL using Server-Sent Events (SSE) and a database-backed event queue system.

## Current Status: MVP Complete ✅

### What's Working
- ✅ Database event queue system (multi-process safe)
- ✅ SSE streaming endpoint with proper session handling  
- ✅ Event emission from WordPress hooks (post updates)
- ✅ Multiple concurrent SSE connections working
- ✅ GraphQL schema integration (basic `RootSubscription` type)
- ✅ Admin monitoring interface and WP-CLI commands
- ✅ Automatic cleanup of old events

### Architecture Proven
- **Multi-process compatibility** - Works with PHP-FPM worker pools
- **No external dependencies** - Pure WordPress/PHP solution
- **Scalable design** - Database-centric for horizontal scaling

## Key Technical Decisions Made

### 1. Database Queue over Transients
**Why**: Transients use object cache that's isolated per PHP-FPM process. Multiple SSE streams couldn't share events.

**Implementation**: Custom table `wp_wpgraphql_subscription_events` with time-based retrieval.

### 2. SSE over WebSockets  
**Why**: HTTP-compatible, automatic reconnection, simpler implementation, works with standard web servers.

**Trade-off**: One-way communication, higher per-connection overhead.

### 3. Time-based Event Delivery (No "Processed" State)
**Why**: Real-time subscriptions should broadcast to all connected clients.

**Implementation**: Each SSE stream tracks `last_check_time` and gets events since that timestamp.

## Code Architecture

### Core Classes (Priority Order)
1. **`WPGraphQL_Event_Queue`** - Database event storage/retrieval
2. **`WPGraphQL_Event_Emitter`** - Standardized event emission  
3. **`WPGraphQL_Subscriptions_Stream`** - SSE endpoint handler
4. **`WPGraphQL_Subscription_Manager`** - Plugin coordination

### Event Flow
```
WordPress Hook → Event Emitter → Database Queue → SSE Stream → Client
```

### File Organization
- `includes/class-*.php` - Core classes
- `includes/events.php` - WordPress hook integration
- `includes/event-stream.php` - SSE routing
- `includes/schema.php` - GraphQL schema extensions
- `includes/plugin-init.php` - Database setup & cron jobs

## Current Limitations & Next Priorities

### 1. No Subscription Filtering (HIGH PRIORITY)
**Problem**: All events go to all clients regardless of subscription parameters.

**Goal**: Support `postUpdated(id: 123)` filtering.

**Approach**: 
- Parse GraphQL subscription documents  
- Store subscription parameters in taxonomy/database
- Filter events during retrieval based on subscription arguments

### 2. No Authentication (MEDIUM PRIORITY)
**Problem**: SSE endpoints are open to all users.

**Goal**: WordPress user authentication on SSE connections.

**Approach**:
- Check user permissions on SSE endpoint
- Filter events based on user capabilities
- Add rate limiting per user

### 3. Basic Schema (MEDIUM PRIORITY)
**Current**: Simple `postUpdated` field returning Post object.

**Goal**: Rich subscription types with proper resolvers.

**Approach**: Expand schema with additional subscription types (comments, users, etc.)

## Technical Constraints

### PHP-FPM Dependency
- Each SSE connection consumes one PHP-FPM worker process
- Default configs often have `pm.max_children = 2` (too low)
- Production needs `pm.max_children = 20-50+` depending on expected concurrent connections

### Session Blocking  
- WordPress sessions block concurrent requests from same user
- **Fixed** with `session_write_close()` in SSE handler
- Critical for multiple connections

### Database Load
- Events stored in WordPress database (no external cache)
- Cleanup every hour to prevent table growth
- Consider Redis for high-traffic scenarios (future)

## Development Patterns Established

### Error Handling
```php
if ($wpdb->last_error) {
    error_log('WPGraphQL Subscriptions: Database error - ' . $wpdb->last_error);
    return false;
}
```

### Event Emission
```php
WPGraphQL_Event_Emitter::emit(
    'post',              // node_type
    'UPDATE',            // action  
    $post_id,            // node_id
    ['post' => $post],   // context
    ['hook' => 'wp_insert_post'] // metadata
);
```

### SSE Stream Pattern
```php
// Always close session first
if (session_id()) {
    session_write_close();
}

// Set proper headers
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

// Main polling loop
while (connection_status() === CONNECTION_NORMAL) {
    $events = $this->event_queue->get_events_since($this->last_check_time);
    foreach ($events as $event) {
        echo "event: next\n";
        echo "data: " . wp_json_encode($event) . "\n\n";
    }
    flush();
    sleep(1);
}
```

### Database Query Pattern
```php
$events = $wpdb->get_results($wpdb->prepare(
    "SELECT * FROM {$this->table_name} WHERE created_at > %s ORDER BY created_at ASC LIMIT 50",
    date('Y-m-d H:i:s', (int) floor($timestamp))
));
```

## Development Setup Requirements

### Local Environment
- **Local by Flywheel** or similar with PHP-FPM
- **PHP 7.4+** with MySQLi extension
- **WPGraphQL plugin** installed and active
- **WordPress debug logging** enabled

### Required PHP-FPM Settings
```ini
pm = dynamic
pm.max_children = 20
pm.start_servers = 5
pm.min_spare_servers = 3
pm.max_spare_servers = 8
```

### Testing Commands
```bash
# Terminal 1 - Stream 1
curl -N "http://yoursite.local/?gql_subscription=stream1"

# Terminal 2 - Stream 2  
curl -N "http://yoursite.local/?gql_subscription=stream2"

# Terminal 3 - Trigger event
wp post update 1 --post_title="Updated Title"
# OR
wp wpgraphql subscription test-event --type=postUpdated --node-id=1

# Monitor queue
wp wpgraphql subscription stats
```

## Code Quality Standards

### WordPress Coding Standards
- Use `$wpdb->prepare()` for all dynamic queries
- Prefix all functions/classes with `WPGraphQL_` or `wpgraphql_`
- Follow WordPress hook naming conventions
- Use `error_log()` for debugging (not `var_dump` or `echo`)

### Class Structure Pattern
```php
class WPGraphQL_Feature_Name {
    private static $instance = null;
    private $table_name;
    
    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'wpgraphql_feature';
    }
    
    public static function get_instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    // Public methods with full docblocks
    /**
     * Method description
     * 
     * @param string $param Description
     * @return bool Success status
     */
    public function method_name($param) {
        // Implementation with error handling
    }
}
```

## Known Working Configurations

### Nginx (Local by Flywheel)
```nginx
location ~ \.php$ {
    fastcgi_buffering off;  # Important for SSE
    fastcgi_read_timeout 300s;
    # ... other settings
}
```

### Database Schema (Proven)
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
    KEY idx_node_id (node_id),
    KEY idx_type_created (subscription_type, created_at),
    KEY idx_unprocessed (processed_at, created_at)
);
```

## Debugging Strategies

### Check Event Flow
1. **WordPress Hook** - `error_log()` in `events.php`
2. **Event Emitter** - Logs in `WPGraphQL_Event_Emitter::emit()`
3. **Database Storage** - Query events table directly
4. **SSE Retrieval** - Logs in stream processing loop
5. **Client Delivery** - Browser dev tools Network tab

### Common Issues & Solutions

#### "Events not reaching all streams"
- ✅ **Fixed**: Changed from "processed" state to time-based retrieval
- Each stream tracks own `last_check_time`

#### "Multiple connections block WordPress admin"  
- ✅ **Fixed**: Increased PHP-FPM `pm.max_children`
- Added `session_write_close()` in SSE handler

#### "Float precision loss warnings"
- ✅ **Fixed**: Use `(int) floor($timestamp)` for database queries

## Future Development Roadmap

### Phase 1: Subscription Filtering (Next Sprint)
**Goal**: Implement `postUpdated(id: 123)` parameter filtering

**Files to Create/Modify**:
- `includes/class-wpgraphql-subscription-parser.php` (NEW)
- `includes/class-wpgraphql-subscription-manager.php` (MODIFY - add subscription storage)
- `includes/class-wpgraphql-event-queue.php` (MODIFY - add filtering methods)

**Database Changes**:
- Add subscription storage (post type + taxonomy OR new table)
- Store parsed subscription parameters for matching

### Phase 2: Authentication & Authorization
**Goal**: Secure subscriptions with WordPress user permissions

**Implementation**:
- Add auth checks to SSE endpoint
- Filter events based on user capabilities  
- Add rate limiting per user

### Phase 3: Enhanced Schema
**Goal**: Rich subscription types beyond basic post updates

**Additions**:
- Comment subscriptions
- User profile subscriptions  
- Custom post type subscriptions
- Meta field change subscriptions

### Phase 4: Production Optimizations
**Goal**: Handle higher traffic and concurrent connections

**Optimizations**:
- Redis event queue option
- Connection pooling
- Event batching
- Horizontal scaling guides

## Integration Points

### WPGraphQL Integration
- Extends existing schema with `RootSubscription` type
- Uses WPGraphQL's type system and resolvers
- Compatible with WPGraphQL's authentication/authorization

### WordPress Integration  
- Uses standard WordPress hooks (`wp_insert_post`, etc.)
- Follows WordPress database conventions
- Compatible with WordPress multisite (untested)
- Uses WordPress cron for cleanup

## Performance Characteristics

### Current Benchmarks (Development)
- **Concurrent SSE connections**: 10+ tested successfully
- **Event latency**: ~1-2 seconds (polling interval)
- **Database impact**: Minimal with proper indexing
- **Memory usage**: ~10MB per active SSE connection

### Scaling Limits
- **PHP-FPM workers**: Primary bottleneck (1 worker per SSE connection)
- **Database connections**: Secondary bottleneck
- **Network**: SSE overhead higher than WebSockets but acceptable

## Security Considerations

### Current Security State
- ⚠️ **No authentication** on SSE endpoints
- ⚠️ **No rate limiting** or connection management  
- ⚠️ **Full post data** exposed in events (no field filtering)
- ✅ **SQL injection prevention** via `$wpdb->prepare()`
- ✅ **XSS prevention** via `wp_json_encode()`

### Security Roadmap
1. WordPress user authentication for SSE connections
2. Capability-based event filtering  
3. Rate limiting per user/IP
4. Field-level permissions in event payloads
5. Connection timeout and cleanup

## AI Development Guidance

When working on this codebase:

1. **Preserve the multi-process architecture** - Don't use transients or object cache for shared state
2. **Always close sessions in SSE handlers** - Critical for concurrent connections  
3. **Use database-first approach** - The event queue pattern is proven and scalable
4. **Follow WordPress conventions** - This needs to integrate cleanly with WP ecosystem
5. **Test with multiple concurrent connections** - The primary use case driving the architecture
6. **Prioritize subscription filtering next** - The biggest missing feature for production use
7. **Maintain backward compatibility** - Other parts of the plugin depend on the current event emission API

The foundation is solid. Focus on building subscription parameter filtering and authentication on top of the existing event queue system.