# Project Roadmap

## Current Status: MVP Complete ✅

The core architecture is proven and working. Multiple concurrent SSE connections can receive real-time events from WordPress through a database-backed queue system.

## Phase 1: Subscription Filtering (Next Priority) 🚧

**Target**: Q4 2025  
**Status**: Not Started

### Goal
Support GraphQL subscription parameters like `postUpdated(id: 123)` so clients only receive events they've subscribed to.

### Current Problem
All events are broadcast to all connected SSE streams regardless of subscription parameters.

### Implementation Plan

#### 1.1 Subscription Document Parser
**New File**: `includes/class-wpgraphql-subscription-parser.php`

Parse GraphQL subscription documents to extract:
- Subscription field name (e.g., "postUpdated")  
- Arguments/variables (e.g., `{id: 123}`)
- Requested fields for response shaping

```php
class WPGraphQL_Subscription_Parser {
    public function parse_document(string $query, array $variables = []);
    public function extract_subscription_info($parsed_document);
    public function generate_subscription_hash($subscription_info);
}
```

#### 1.2 Subscription Storage Enhancement  
**Modify**: `includes/class-wpgraphql-subscription-manager.php`

Extend existing post type/taxonomy system:
- Store parsed subscription parameters in `gql_subscription_args` taxonomy
- Create unique subscription hashes for deduplication
- Map connection IDs to subscription hashes

```php
// New taxonomy terms like:
// "id:123", "post_type:post", "subscription_type:postUpdated"
```

#### 1.3 Event Filtering in Queue
**Modify**: `includes/class-wpgraphql-event-queue.php`

Add methods to filter events based on subscription parameters:

```php
class WPGraphQL_Event_Queue {
    public function get_events_for_subscription_hash(
        string $subscription_hash, 
        float $since_timestamp
    );
    public function match_event_to_subscriptions(array $event_data);
}
```

#### 1.4 SSE Stream Enhancement
**Modify**: `includes/class-wpgraphql-subscriptions-stream.php`

Update stream to:
- Accept subscription hash instead of generic connection ID
- Query events filtered by subscription parameters
- Only send relevant events to each stream

### Success Criteria
- Multiple clients can subscribe to different post IDs
- Only relevant events reach each client
- Performance doesn't degrade with filtering
- Backward compatibility maintained

### Risk Areas
- Subscription document parsing complexity
- Performance impact of parameter matching
- Database query optimization for filtering

---

## Phase 2: Authentication & Authorization 🔒

**Target**: Q1 2026  
**Status**: Not Started

### Goal
Secure subscription endpoints with WordPress user authentication and capability-based filtering.

### Implementation Plan

#### 2.1 SSE Authentication
**Modify**: `includes/event-stream.php`

Add authentication check before starting SSE stream:
```php
// Check if user can access subscription endpoint
if (!current_user_can('read')) {
    http_response_code(403);
    exit;
}
```

Consider authentication methods:
- Cookie-based (for same-origin requests)
- JWT tokens (for API clients)
- WordPress nonces

#### 2.2 Permission-based Event Filtering
**New**: `includes/class-wpgraphql-subscription-permissions.php`

Filter events based on user capabilities:
- Check if user can read specific posts
- Filter based on post status (private, password-protected)
- Respect custom post type capabilities

#### 2.3 Rate Limiting
**New**: `includes/class-wpgraphql-connection-limiter.php`

Implement per-user connection limits:
- Max concurrent connections per user
- Rate limiting for new connections
- Cleanup of abandoned connections

### Success Criteria
- Users only receive events for content they can access
- Proper authentication for SSE endpoints
- Protection against abuse/spam connections

---

## Phase 3: Enhanced Schema & Resolvers 📋

**Target**: Q2 2026  
**Status**: Not Started

### Goal
Rich GraphQL subscription types beyond basic post updates.

### Implementation Plan

#### 3.1 Additional Subscription Types
**Modify**: `includes/schema.php`

Add subscription fields:
```graphql
type RootSubscription {
  postUpdated(id: ID, postType: String): Post
  postCreated(postType: String): Post  
  postDeleted(id: ID): Post
  commentAdded(postId: ID): Comment
  userUpdated(id: ID): User
  userRegistered: User
}
```

#### 3.2 Event Emission Expansion
**Modify**: `includes/events.php`

Hook into additional WordPress events:
- Comment hooks (`wp_insert_comment`, `wp_update_comment`)
- User hooks (`user_register`, `profile_update`)  
- Term hooks (categories, tags)
- Meta field changes

#### 3.3 Advanced Resolvers
Implement proper GraphQL resolvers that:
- Shape response data based on requested fields
- Handle nested relationships (post.author, post.comments)
- Optimize database queries (avoid N+1 problems)

### Success Criteria
- Complete coverage of major WordPress content types
- Efficient resolvers with proper data loading
- Consistent GraphQL API patterns

---

## Phase 4: Production Optimizations 🚀

**Target**: Q3 2026  
**Status**: Not Started

### Goal
Handle high-traffic scenarios and large numbers of concurrent connections.

### Implementation Plan

#### 4.1 Redis Event Queue Option
**New**: `includes/class-wpgraphql-redis-queue.php`

Alternative to database queue for high-volume scenarios:
- Redis pub/sub for real-time event distribution
- Fallback to database when Redis unavailable
- Configuration option to choose queue backend

#### 4.2 Connection Management
**New**: `includes/class-wpgraphql-connection-manager.php`

Advanced connection handling:
- Connection pooling and cleanup
- Heartbeat monitoring with timeout detection
- Graceful shutdown handling
- Connection statistics and monitoring

#### 4.3 Event Batching
Optimize for high-frequency updates:
- Batch similar events (multiple post updates)
- Debouncing for rapid sequential changes  
- Configurable batching windows

#### 4.4 Horizontal Scaling
Documentation and tooling for:
- Load balancing across multiple PHP-FPM pools
- Database connection pooling
- Redis clustering for event queue
- Performance monitoring and alerting

### Success Criteria
- Handle 100+ concurrent SSE connections
- Sub-second event delivery latency
- Horizontal scaling documentation
- Production monitoring tools

---

## Phase 5: Alternative Transports 🔄

**Target**: Q4 2026  
**Status**: Not Started  

### Goal
Support WebSocket transport alongside SSE for different use cases.

### Implementation Plan

#### 5.1 Transport Abstraction
**New**: `includes/interface-transport.php`

Abstract transport interface:
```php
interface WPGraphQL_Transport_Interface {
    public function send_event(string $connection_id, array $event_data);
    public function close_connection(string $connection_id);
    public function get_active_connections(): array;
}
```

#### 5.2 WebSocket Implementation  
**New**: `includes/class-wpgraphql-websocket-transport.php`

WebSocket server using ReactPHP or similar:
- Proper WebSocket handshaking
- Connection state management
- Message framing and parsing
- GraphQL over WebSocket protocol support

#### 5.3 Transport Selection
Configuration option to choose transport:
- SSE for simpler deployments
- WebSocket for high-performance scenarios
- Hybrid approach (WebSocket with SSE fallback)

### Success Criteria
- WebSocket transport working alongside SSE
- Easy configuration switching between transports
- Performance comparison documentation

---

## Future Considerations (Phase 6+)

### Advanced Features
- **Subscription Directives** - `@live`, `@defer` for advanced behaviors
- **Subscription Federation** - Multi-site subscription coordination
- **Subscription Analytics** - Usage metrics and performance monitoring
- **Custom Subscription Types** - Plugin API for third-party subscriptions

### Integration Improvements  
- **WooCommerce Integration** - Product, order, and cart subscriptions
- **ACF Integration** - Custom field change subscriptions
- **Multisite Support** - Cross-site event coordination
- **Custom Post Type API** - Automatic subscription generation

### Developer Experience
- **GraphiQL Subscriptions** - In-browser subscription testing
- **Subscription Introspection** - Better schema documentation
- **Debug Tooling** - Visual subscription flow monitoring
- **Testing Framework** - Automated subscription testing tools

---

## Technical Debt & Maintenance

### Known Issues to Address
1. **Error Handling** - More graceful error recovery in SSE streams
2. **Memory Management** - Long-running process memory leak detection
3. **Database Optimization** - Query performance monitoring and optimization
4. **Session Management** - Better handling of WordPress sessions in SSE context

### Code Quality Goals
- **Test Coverage** - Unit and integration tests for core classes
- **Documentation** - Complete PHPDoc coverage
- **Performance Benchmarks** - Baseline performance metrics
- **Security Audit** - Third-party security review

---

## Success Metrics

### Phase 1 (Filtering)
- [ ] Support subscription parameters correctly
- [ ] No performance regression with filtering enabled
- [ ] All existing functionality preserved

### Phase 2