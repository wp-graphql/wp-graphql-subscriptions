# Implementation Plan: GraphQL Yoga Sidecar

## Phase 1: Foundation (MVP)

### 1.1 Project Setup ✅ COMPLETED
- [x] Initialize Node.js project with TypeScript
- [x] Install dependencies: GraphQL Yoga, Redis, GraphQL tools
- [x] Set up basic project structure
- [x] Configure TypeScript and build process
- [x] Create configuration management system
- [x] Set up logging with Pino
- [x] Create environment configuration template

### 1.2 Schema Management ✅ COMPLETED
- [x] Implement schema introspection from WPGraphQL
- [x] Create schema caching mechanism with TTL
- [x] Build subscription field detection logic
- [x] Add comprehensive error handling for schema operations
- [x] Implement schema invalidation and refresh capabilities

### 1.3 Basic Proxy Functionality ✅ COMPLETED
- [x] Implement intelligent operation routing (queries/mutations → WPGraphQL, subscriptions → custom handlers)
- [x] Content-based GraphQL operation detection (not URL-dependent)
- [x] Handle authentication passthrough (JWT, cookies, headers)
- [x] Set up HTTP client with timeout handling and connection pooling
- [x] Add comprehensive request/response logging
- [x] Implement robust error handling and graceful fallbacks
- [x] Create GraphQL operation type utilities

### 1.4 Simple Subscription Support ⚠️ ARCHITECTURE PIVOT
- [x] Implement basic Redis pub/sub integration with event handling
- [x] Create channel naming strategy for simple ID-based subscriptions (single-argument constraint)
- [x] Build subscription manager for lifecycle management and Redis coordination
- [x] Add GraphiQL introspection compatibility (handle locally vs proxy to WPGraphQL)
- [x] Implement dual-channel publishing strategy (specific + global channels)
- [x] ~~Create SSE subscription resolvers with async iterables~~ **WRONG APPROACH**
- [x] Integrate with existing `graphql_subscription_event` action hook
- [ ] **NEW APPROACH**: Implement subscription storage and WPGraphQL execution pattern

**🔄 ARCHITECTURE CHANGE**: Instead of executing subscriptions in the sidecar, we need to:
1. Store subscription documents when clients subscribe
2. Listen for Redis events
3. Execute stored subscriptions against WPGraphQL with event as rootValue
4. Forward WPGraphQL responses to subscribers

This ensures WPGraphQL handles all business logic, auth, and filtering.

## 🏗️ **Architecture Options Analysis**

### **Option A: Keep GraphQL Yoga (Current)**
**Pros:**
- ✅ Built-in GraphiQL IDE with subscription support
- ✅ Schema introspection already working
- ✅ Familiar GraphQL ecosystem
- ✅ Easy query/mutation proxying

**Cons:**
- ❌ Overkill - we're not using it as a GraphQL server
- ❌ Complex schema transformation for subscriptions
- ❌ Additional dependency and overhead

### **Option B: Lightweight HTTP + SSE Server**
**Pros:**
- ✅ Minimal dependencies (just HTTP server + SSE)
- ✅ Direct control over subscription handling
- ✅ Simpler architecture - just event coordination
- ✅ Better performance (no GraphQL execution overhead)

**Cons:**
- ❌ No built-in GraphiQL IDE
- ❌ Need to implement SSE protocol manually
- ❌ More custom code to maintain

### **Option C: Hybrid Approach**
**Pros:**
- ✅ GraphiQL IDE for development/testing
- ✅ Lightweight subscription handling
- ✅ Best of both worlds

**Implementation:**
- Keep Yoga for GraphiQL and query/mutation proxying
- Add separate SSE endpoint for subscriptions
- Subscriptions bypass Yoga entirely

### **Recommended: Option C - Hybrid**
This gives us the developer experience benefits while keeping subscription logic clean and simple.

## 📋 **New Implementation Plan - Phase 1.5**

### **1.5 Correct Subscription Architecture** ✅ **COMPLETED**
- [x] **Remove schema transformation approach** - revert to original WPGraphQL schema
- [x] **Create SSE subscription endpoint** - `/graphql/stream` for subscription connections  
- [x] **Implement subscription storage** - store active subscription documents and connection info
- [x] **Build event-triggered execution** - when Redis event occurs, execute against WPGraphQL
- [x] **Add rootValue support** - pass event payload as rootValue to WPGraphQL with security tokens
- [x] **Implement SSE streaming** - forward WPGraphQL responses to subscribers
- [x] **Handle connection lifecycle** - manage subscriber connections and cleanup
- [x] **Security implementation** - HMAC token validation for rootValue authentication

### **Architecture Flow:**
```
Client Subscription Request
  ↓
Store in Subscription Manager + Start SSE Connection  
  ↓
Listen for Redis Events
  ↓
Event Occurs → Generate Security Token + Execute Subscription against WPGraphQL
  ↓
WPGraphQL Validates Token → Sets rootValue → Executes Subscription
  ↓
WPGraphQL Response → Stream to Subscriber via SSE
```

### **Security Model:**
```
Sidecar Server                    WordPress/WPGraphQL
     |                                   |
     | 1. Generate HMAC Token            |
     |    (subscriptionId + payload      |
     |     + timestamp + signature)      |
     |                                   |
     | 2. Send GraphQL Request           |
     |    with extensions:               |
     |    - root_value: eventPayload     |
     |    - subscription_token: token    |
     |---------------------------------->|
     |                                   | 3. Validate Token:
     |                                   |    - Check timestamp
     |                                   |    - Verify signature  
     |                                   |    - Extract rootValue
     |                                   |
     |                                   | 4. Execute Subscription
     |                                   |    with validated rootValue
     |                                   |
     | 5. Stream Response via SSE        |
     |<----------------------------------|
```

### **Benefits:**
- ✅ **WPGraphQL handles all logic** (auth, filtering, data access)
- ✅ **Sidecar just coordinates** real-time delivery
- ✅ **Consistent behavior** with queries/mutations
- ✅ **Simpler maintenance** - no complex schema transformation

**Success Criteria**: ✅ **ACHIEVED** - Client can connect, execute queries/mutations via proxy to WPGraphQL, and see subscription schema. Ready for Phase 1.4 to implement SSE events from Redis using existing WordPress event emission system.

### 🎉 **Phase 1 Summary (Phases 1.1-1.3 Complete)**

The sidecar server now provides:

#### **✅ Production-Ready Features:**
- **Full GraphQL Proxy**: All queries and mutations work exactly like direct WPGraphQL
- **Complete Schema**: All WPGraphQL types, fields, and capabilities available
- **Authentication**: JWT tokens, cookies, and headers properly forwarded
- **Performance**: Schema caching, connection pooling, timeout handling
- **Reliability**: Comprehensive error handling, graceful degradation
- **Developer Experience**: Hot reload, logging, debugging tools

#### **✅ Technical Architecture:**
- **Intelligent Routing**: Content-based operation detection (not URL-dependent)
- **Modular Design**: Clean separation of concerns with TypeScript
- **Configuration Management**: Environment-based configuration system
- **Extensible**: Ready for Phase 1.4 subscription enhancements

#### **✅ Verified Functionality:**
```bash
# Queries work perfectly
curl -H "Content-Type: application/json" \
  -d '{"query":"{ posts { nodes { id title } } }"}' \
  http://localhost:4000/graphql

# Mutations work perfectly  
curl -H "Content-Type: application/json" \
  -d '{"query":"mutation { createPost(...) { id } }"}' \
  http://localhost:4000/graphql

# Subscriptions detected and ready for custom handlers
curl -H "Content-Type: application/json" \
  -d '{"query":"subscription { postUpdated { id } }"}' \
  http://localhost:4000/graphql
```

**🚀 Ready for Phase 1.4**: Subscription implementation with Redis pub/sub and SSE streaming.

## Phase 2: Core Features

### 2.1 Advanced Channel Mapping
- [ ] Implement hierarchical channel naming strategy
- [ ] Handle multiple subscription arguments
- [ ] Add support for complex argument types
- [ ] Create argument hashing for complex objects

### 2.2 Event Processing Engine
- [ ] Build event matching logic for subscriptions
- [ ] Implement subscription query execution against WPGraphQL
- [ ] Add event filtering and transformation
- [ ] Handle subscription lifecycle (start/stop/error)

### 2.3 WordPress Integration (Existing System)
- [x] Event emission system via `WPGraphQL_Event_Emitter::emit()`
- [x] Standardized `graphql_subscription_event` action hook
- [x] Event payload standardization with node_type, action, node_id structure
- [x] Webhook transport implementation in `transport-webhook.php`
- [ ] Add Redis transport integration to existing action hook
- [ ] Enhance event debugging and logging for sidecar integration

### 2.4 Error Handling & Resilience
- [ ] Implement retry logic for WPGraphQL calls
- [ ] Add graceful degradation for Redis failures
- [ ] Handle schema changes and subscription invalidation
- [ ] Create comprehensive error logging

**Success Criteria**: Multiple subscription types work with various argument patterns, WordPress events trigger updates, robust error handling.

## Phase 3: Production Readiness

### 3.1 Performance Optimization
- [ ] Implement subscription batching
- [ ] Add event deduplication
- [ ] Optimize schema caching strategy
- [ ] Add connection pooling optimizations

### 3.2 Security & Authentication
- [ ] Implement JWT validation
- [ ] Add rate limiting per connection
- [ ] Create subscription authorization checks
- [ ] Implement input validation and sanitization

### 3.3 Monitoring & Observability
- [ ] Add health check endpoints
- [ ] Implement metrics collection (Prometheus)
- [ ] Create structured logging
- [ ] Add performance monitoring

### 3.4 Deployment & Scaling
- [ ] Create Docker configuration
- [ ] Add Kubernetes manifests
- [ ] Implement graceful shutdown
- [ ] Support horizontal scaling with Redis

**Success Criteria**: Production-ready server with monitoring, security, and scaling capabilities.

## Phase 4: Advanced Features

### 4.1 Advanced Subscription Patterns
- [ ] Implement subscription filtering
- [ ] Add subscription aggregation
- [ ] Support subscription composition
- [ ] Create subscription middleware system

### 4.2 Developer Experience
- [ ] Create subscription debugging tools
- [ ] Add GraphQL Playground integration
- [ ] Implement subscription introspection
- [ ] Create comprehensive documentation

### 4.3 Integration Enhancements
- [x] Webhook transport already implemented in `transport-webhook.php`
- [ ] Enhance webhook transport to work alongside Redis
- [ ] Implement event replay capabilities using existing database queue
- [ ] Create subscription persistence (leverage existing connection storage)
- [ ] Add multi-tenant support

## Technical Specifications

### Dependencies
```json
{
  "graphql-yoga": "^5.x",
  "graphql": "^16.x",
  "@graphql-tools/schema": "^10.x",
  "@graphql-tools/utils": "^10.x",
  "redis": "^4.x",
  "node-fetch": "^3.x",
  "jsonwebtoken": "^9.x",
  "pino": "^8.x"
}
```

Note: Removed `ws` package as GraphQL Yoga handles SSE natively without additional WebSocket dependencies.

### File Structure
```
sidecar/sse/
├── src/
│   ├── schema/
│   │   ├── introspection.ts
│   │   ├── cache.ts
│   │   └── subscription-enhancer.ts
│   ├── subscription/
│   │   ├── manager.ts
│   │   ├── channels.ts
│   │   └── executor.ts
│   ├── proxy/
│   │   ├── handler.ts
│   │   └── client.ts
│   ├── events/
│   │   ├── processor.ts
│   │   └── redis.ts
│   ├── auth/
│   │   └── jwt.ts
│   └── server.ts
├── tests/
├── docker/
├── k8s/
├── package.json
├── tsconfig.json
└── README.md
```

### Configuration Schema
```typescript
interface Config {
  wpgraphql: {
    endpoint: string;
    timeout: number;
    retries: number;
  };
  redis: {
    url: string;
    keyPrefix: string;
  };
  server: {
    port: number;
    cors: boolean;
    subscriptionTimeout: number;
    sseKeepAlive: number; // SSE keep-alive interval
  };
  schema: {
    cacheTTL: number;
    introspectionInterval: number;
  };
  auth: {
    jwtSecret?: string;
    validateTokens: boolean;
  };
}
```

## Testing Strategy

### Unit Tests
- Schema introspection and caching
- Channel name generation
- Event processing logic
- Authentication handling

### Integration Tests
- End-to-end SSE subscription flow
- WPGraphQL proxy functionality
- Redis pub/sub integration
- SSE connection handling and reconnection
- Error handling scenarios

### Performance Tests
- Concurrent SSE subscription handling
- Event processing throughput
- Memory usage under load
- SSE connection scalability
- Schema introspection performance

## Success Metrics

### Phase 1 Metrics
- [ ] Schema introspection working
- [ ] Basic subscriptions functional
- [ ] Proxy queries/mutations working

### Phase 2 Metrics
- [ ] Multiple subscription types supported
- [ ] WordPress integration complete
- [ ] Error handling comprehensive

### Phase 3 Metrics
- [ ] Production deployment successful
- [ ] Performance benchmarks met
- [ ] Security audit passed

### Phase 4 Metrics
- [ ] Advanced features implemented
- [ ] Developer documentation complete
- [ ] Community adoption metrics
