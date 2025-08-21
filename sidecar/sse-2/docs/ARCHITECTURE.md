# SSE-2 Sidecar Architecture

## Overview

A minimal, focused GraphQL subscription server that follows the [GraphQL over Server-Sent Events Protocol](https://raw.githubusercontent.com/enisdenjo/graphql-sse/refs/heads/master/PROTOCOL.md). This server is designed specifically for real-time subscriptions with WPGraphQL.

## Design Principles

### 1. **Subscription-Only Focus**
- ✅ Accept only GraphQL subscription operations
- ❌ Reject queries and mutations with helpful error messages
- 🎯 Single responsibility: real-time subscription coordination

### 2. **Protocol Compliance**
- Follow GraphQL-SSE Protocol (distinct connections mode)
- Proper SSE event formatting (`next`, `complete` events)
- Standard HTTP status codes and headers

### 3. **Minimal Dependencies**
- No GraphQL execution engine (delegate to WPGraphQL)
- Simple HTTP server with SSE capabilities
- Focus on coordination, not execution

## Architecture Overview

```
┌─────────────────┐    Subscription     ┌─────────────────┐
│                 │ ─────────────────→  │                 │
│   GraphQL       │                     │   SSE-2         │
│   Client        │ ←─────────────────  │   Sidecar       │
│                 │    SSE Stream       │                 │
└─────────────────┘                     └─────────────────┘
                                                │
                                                │ Redis Events
                                                ▼
                                        ┌─────────────────┐
                                        │                 │
                                        │   Redis         │
                                        │   Pub/Sub       │
                                        │                 │
                                        └─────────────────┘
                                                ▲
                                                │ Events
                                                │
                                        ┌─────────────────┐    Execute Document    ┌─────────────────┐
                                        │                 │ ──────────────────→   │                 │
                                        │   WordPress     │                       │   WPGraphQL     │
                                        │   Events        │ ←────────────────────  │   Endpoint      │
                                        │                 │    Response            │                 │
                                        └─────────────────┘                       └─────────────────┘
```

## Core Components

### 1. **HTTP Server**
- Accept POST requests with `Accept: text/event-stream`
- Validate GraphQL subscription operations
- Establish SSE connections

### 2. **Subscription Manager**
- Store active subscription documents and metadata
- Map subscriptions to Redis channels
- Manage subscription lifecycle

### 3. **Redis Event Listener**
- Subscribe to relevant Redis channels
- Route events to appropriate subscriptions
- Handle event payload processing

### 4. **WPGraphQL Executor**
- Execute subscription documents against WPGraphQL
- Pass event payload as `rootValue`
- Include security tokens for authentication

### 5. **SSE Streamer**
- Stream WPGraphQL responses to clients
- Format events according to GraphQL-SSE protocol
- Handle connection cleanup

## Data Flow

### 1. **Subscription Setup**
```
Client Request (POST /graphql)
  ↓
Validate: Is Subscription? ✓
  ↓
Extract: Document, Variables, Operation
  ↓
Store: Subscription in Manager
  ↓
Subscribe: To Redis Channels
  ↓
Establish: SSE Connection
```

### 2. **Event Processing**
```
WordPress Event
  ↓
Redis Pub/Sub
  ↓
SSE-2 Receives Event
  ↓
Find: Matching Subscriptions
  ↓
Execute: Document against WPGraphQL
  ↓
Stream: Response via SSE
```

### 3. **Connection Cleanup**
```
Client Disconnects
  ↓
Remove: Subscription from Manager
  ↓
Unsubscribe: From Redis Channels
  ↓
Cleanup: Resources
```

## Security Model

### 1. **Token-Based Authentication**
- Generate HMAC tokens for WPGraphQL requests
- Include subscription metadata in token
- Prevent unauthorized `rootValue` injection

### 2. **Request Validation**
- Validate subscription documents
- Sanitize variables and operation names
- Rate limiting and connection limits

### 3. **Channel Security**
- Map subscription fields to specific Redis channels
- Prevent unauthorized channel access
- Audit subscription activity

## Protocol Implementation

### SSE Event Format
Following [GraphQL-SSE Protocol](https://raw.githubusercontent.com/enisdenjo/graphql-sse/refs/heads/master/PROTOCOL.md):

#### `next` Event
```
event: next
data: {"data": {"postUpdated": {"id": "1", "title": "Updated Post"}}}
```

#### `complete` Event
```
event: complete
data: 
```

### HTTP Response Codes
- `200 OK`: Successful SSE connection establishment
- `400 Bad Request`: Invalid GraphQL operation or non-subscription
- `401 Unauthorized`: Authentication required
- `415 Unsupported Media Type`: Wrong Content-Type or Accept headers

## Performance Considerations

### 1. **Connection Management**
- HTTP/2 support for multiple concurrent connections
- Connection pooling for WPGraphQL requests
- Efficient memory usage for subscription storage

### 2. **Redis Optimization**
- Channel pattern matching for efficient routing
- Connection pooling for Redis clients
- Batch processing for multiple events

### 3. **Scaling Strategy**
- Horizontal scaling with shared Redis instance
- Load balancing across multiple SSE-2 instances
- Database-backed subscription persistence (future)

## Monitoring & Observability

### 1. **Metrics**
- Active subscription count
- Event processing latency
- WPGraphQL request success/failure rates
- SSE connection duration

### 2. **Logging**
- Structured logging with correlation IDs
- Security event tracking
- Performance monitoring
- Error aggregation

### 3. **Health Checks**
- Redis connectivity
- WPGraphQL endpoint availability
- Memory and CPU usage
- Active connection count

## Comparison with SSE-1

| Aspect | SSE-1 (Current) | SSE-2 (New) |
|--------|-----------------|-------------|
| **Framework** | GraphQL Yoga | Minimal HTTP Server |
| **Schema** | Schema Transformation | No Schema Management |
| **Operations** | Query/Mutation/Subscription | Subscription Only |
| **Complexity** | High (proxy + execution) | Low (coordination only) |
| **Protocol** | Custom Implementation | GraphQL-SSE Compliant |
| **Dependencies** | Many (Yoga ecosystem) | Few (HTTP, Redis, fetch) |
| **Maintainability** | Complex | Simple |
| **Performance** | Good | Better |

## Next Steps

1. **Phase 1**: Basic HTTP server with subscription validation
2. **Phase 2**: SSE connection management and protocol implementation
3. **Phase 3**: Redis integration and event routing
4. **Phase 4**: WPGraphQL execution with security tokens
5. **Phase 5**: Testing, optimization, and monitoring
