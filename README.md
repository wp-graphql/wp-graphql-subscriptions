# WPGraphQL Subscriptions

> [!WARNING]
> **EXPERIMENTAL PLUGIN.** This plugin is in active development and should be used with caution. It's not recommended for production environments without thorough testing.

An experimental WordPress plugin that adds GraphQL Subscriptions support to WPGraphQL, enabling real-time updates through Server-Sent Events (SSE).

## Overview

This plugin extends WPGraphQL to support GraphQL Subscriptions, allowing clients to receive real-time updates when WordPress content changes. It provides a reference implementation for real-time messaging in WordPress using native WordPress technologies (no external services required).

## Features

- ✅ **GraphQL Subscriptions Schema** - Adds `RootSubscription` type to WPGraphQL schema
- ✅ **Real-time Event System** - Centralized event tracking and emission
- ✅ **Server-Sent Events (SSE)** - HTTP-based real-time transport
- ✅ **Database Event Queue** - Reliable multi-process event handling
- ✅ **WordPress Native** - No external dependencies or services required
- ✅ **Multi-process Safe** - Works with PHP-FPM and multiple concurrent connections
- ✅ **Debug Tools** - Admin interface and WP-CLI commands for monitoring

## Current Status

### ✅ Working Features
- Post update subscriptions (`postUpdated`)
- SSE streaming endpoint
- Event emission on WordPress hooks
- Database-backed event queue
- Multiple concurrent SSE connections
- Admin monitoring interface
- WP-CLI management commands

### 🚧 In Development
- Subscription argument filtering (e.g., `postUpdated(id: 123)`)
- User authentication/authorization for subscriptions
- WebSocket transport option
- Additional subscription types (comments, users, etc.)
- Production optimization and scaling

### 📋 Planned Features
- GraphQL subscription document parsing and storage
- Client-side subscription management
- Rate limiting and connection management
- Redis/external cache support for high-scale deployments

## Installation

1. Download or clone this repository to your `wp-content/plugins/` directory
2. Ensure you have WPGraphQL installed and activated
3. Activate the "WPGraphQL Subscriptions" plugin
4. The plugin will automatically create the required database table

## Basic Usage

### 1. GraphQL Subscription Query

```graphql
subscription PostUpdates($id: ID!) {
  postUpdated(id: $id) {
    id
    title
    content
    modifiedOn
  }
}
```

### 2. Connect to SSE Stream

```javascript
// Connect to the SSE endpoint
const eventSource = new EventSource('/path/to/stream?gql_subscription=your_connection_id');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received update:', data);
};

eventSource.addEventListener('next', function(event) {
  const result = JSON.parse(event.data);
  console.log('GraphQL result:', result);
});
```

### 3. Test Events

Update any WordPress post and connected clients will receive real-time notifications.

## Architecture

### Event Flow

```
WordPress Hook → Event Emitter → Database Queue → SSE Streams → Clients
```

1. **WordPress Events** - Standard WP hooks (`wp_insert_post`, etc.)
2. **Event Emitter** - Standardizes and emits subscription events
3. **Database Queue** - Stores events for reliable multi-process delivery
4. **SSE Streams** - Long-running HTTP connections that poll for events
5. **Client Applications** - Receive real-time GraphQL subscription results

### Key Components

- **`WPGraphQL_Event_Emitter`** - Central event emission system
- **`WPGraphQL_Event_Queue`** - Database-backed event storage
- **`WPGraphQL_Subscriptions_Stream`** - SSE endpoint handler
- **`WPGraphQL_Subscription_Manager`** - Plugin coordination and schema registration

## Configuration

### PHP-FPM Settings

For multiple concurrent SSE connections, ensure adequate PHP-FPM workers:

```ini
; In your PHP-FPM pool configuration
pm = dynamic
pm.max_children = 10        ; Increase from default
pm.start_servers = 3
pm.min_spare_servers = 2
pm.max_spare_servers = 5
```

### WordPress Settings

No special WordPress configuration required. The plugin works with standard WordPress installations.

## Development

### File Structure

```
wp-graphql-subscriptions/
├── wp-graphql-subscriptions.php          # Main plugin file
├── README.md
├── docs/                                 # Documentation
├── includes/
│   ├── class-wpgraphql-event-emitter.php       # Event emission
│   ├── class-wpgraphql-event-queue.php         # Database queue
│   ├── class-wpgraphql-subscriptions-stream.php # SSE handler
│   ├── class-wpgraphql-subscription-manager.php # Plugin manager
│   ├── event-stream.php                         # SSE routing
│   ├── events.php                               # WordPress event hooks
│   ├── plugin-init.php                          # Plugin initialization
│   ├── schema.php                               # GraphQL schema additions
│   └── transport-webhook.php                    # Webhook transport (optional)
└── LICENSE
```

### WP-CLI Commands

```bash
# View queue statistics
wp wpgraphql subscription stats

# Test event emission
wp wpgraphql subscription test-event --type=postUpdated --node-id=123

# Clean up old events
wp wpgraphql subscription cleanup --hours=1

# Create database table
wp wpgraphql subscription create-table
```

### Debug Mode

Enable debug mode by adding to your `wp-config.php`:

```php
// Enable WPGraphQL debug mode to see admin interfaces
define('GRAPHQL_DEBUG', true);
```

Then visit **GraphQL → Subscription Queue** in WordPress admin.

## Troubleshooting

### Multiple Connections Freezing

This usually indicates PHP-FPM process pool exhaustion. Increase `pm.max_children` in your PHP-FPM configuration.

### Events Not Appearing in Streams

1. Check that the database table exists: `SHOW TABLES LIKE 'wp_wpgraphql_subscription_events'`
2. Verify events are being stored: `SELECT * FROM wp_wpgraphql_subscription_events ORDER BY created_at DESC LIMIT 10`
3. Check error logs for PHP or database errors

### Session Blocking Issues

The plugin automatically calls `session_write_close()` to prevent session locking. If you're still experiencing issues, ensure no other plugins are starting sessions after the SSE stream begins.

## Contributing

This is an experimental plugin and we welcome contributions! Please see our [Development Guide](docs/development.md) for more information.

### Current Focus Areas

1. **Subscription Filtering** - Implementing proper argument-based event filtering
2. **Authentication** - Adding user permission checks for subscriptions  
3. **Performance** - Optimizing for high-traffic scenarios
4. **Transport Options** - Adding WebSocket support alongside SSE

## License

GPL v3 or later. See [LICENSE](LICENSE) file for details.

## Changelog

### 0.1.0 - Current
- Initial experimental release
- Basic subscription schema support
- SSE transport implementation  
- Database event queue system
- Multi-process compatibility
- Debug tools and monitoring