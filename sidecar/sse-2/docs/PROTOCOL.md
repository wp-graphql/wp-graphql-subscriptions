# GraphQL-SSE Protocol Implementation

## Overview

This document outlines how SSE-2 implements the [GraphQL over Server-Sent Events Protocol](https://raw.githubusercontent.com/enisdenjo/graphql-sse/refs/heads/master/PROTOCOL.md) specification.

## Protocol Mode

We implement **Distinct Connections Mode** as it's simpler and more suitable for our use case:
- Each subscription gets its own SSE connection
- No reservation system needed
- Direct mapping between HTTP request and SSE stream

## Request Format

### HTTP Method & Headers
```http
POST /graphql HTTP/1.1
Content-Type: application/json
Accept: text/event-stream
```

### Request Body
```json
{
  "query": "subscription { postUpdated(id: 1) { id title content } }",
  "variables": {},
  "operationName": "PostUpdated"
}
```

## Response Format

### Success Response Headers
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

### Error Response (Non-Subscription)
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "errors": [{
    "message": "Only subscription operations are supported",
    "extensions": {
      "code": "OPERATION_NOT_SUPPORTED",
      "supportedOperations": ["subscription"]
    }
  }]
}
```

## SSE Event Types

### `next` Event - Execution Results
Emitted when WPGraphQL returns subscription data:

```
event: next
data: {"data":{"postUpdated":{"id":"1","title":"Updated Post","content":"New content"}}}

```

### `complete` Event - Stream Completion
Emitted when subscription completes or client disconnects:

```
event: complete
data: 

```

### Error Handling
Errors are sent as `next` events with error data:

```
event: next
data: {"errors":[{"message":"Access denied","extensions":{"code":"FORBIDDEN"}}]}

```

## Implementation Details

### 1. Request Validation

#### Content-Type Check
```typescript
if (request.headers['content-type'] !== 'application/json') {
  return 400; // Bad Request
}
```

#### Accept Header Check
```typescript
if (request.headers['accept'] !== 'text/event-stream') {
  return 415; // Unsupported Media Type
}
```

#### GraphQL Validation
```typescript
// Parse GraphQL document
const document = parse(query);

// Check if it's a subscription
const operation = document.definitions[0];
if (operation.operation !== 'subscription') {
  return 400; // Bad Request - Not a subscription
}
```

### 2. SSE Connection Setup

#### Response Headers
```typescript
response.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Cache-Control',
});
```

#### Keep-Alive Mechanism
```typescript
// Send periodic keep-alive
const keepAlive = setInterval(() => {
  response.write(': keep-alive\n\n');
}, 30000);
```

### 3. Event Streaming

#### Next Event Format
```typescript
function sendNextEvent(data: ExecutionResult) {
  const eventData = JSON.stringify(data);
  response.write(`event: next\ndata: ${eventData}\n\n`);
}
```

#### Complete Event Format
```typescript
function sendCompleteEvent() {
  response.write(`event: complete\ndata: \n\n`);
}
```

### 4. Connection Lifecycle

#### Setup
1. Validate request (headers, GraphQL document)
2. Establish SSE connection
3. Store subscription in manager
4. Subscribe to Redis channels
5. Start streaming

#### Cleanup
1. Client disconnects (connection closed)
2. Remove subscription from manager
3. Unsubscribe from Redis channels
4. Clean up resources

## Error Scenarios

### Invalid Content-Type
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "errors": [{
    "message": "Content-Type must be application/json",
    "extensions": {"code": "INVALID_CONTENT_TYPE"}
  }]
}
```

### Missing Accept Header
```http
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/json

{
  "errors": [{
    "message": "Accept header must be text/event-stream",
    "extensions": {"code": "INVALID_ACCEPT_HEADER"}
  }]
}
```

### Non-Subscription Operation
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "errors": [{
    "message": "Only subscription operations are supported. Use queries and mutations against WPGraphQL directly.",
    "extensions": {
      "code": "OPERATION_NOT_SUPPORTED",
      "receivedOperation": "query",
      "supportedOperations": ["subscription"]
    }
  }]
}
```

### Invalid GraphQL Document
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "errors": [{
    "message": "Syntax Error: Expected Name, found }",
    "locations": [{"line": 1, "column": 15}],
    "extensions": {"code": "GRAPHQL_PARSE_ERROR"}
  }]
}
```

## Client Integration Examples

### JavaScript (fetch API)
```javascript
const response = await fetch('/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  },
  body: JSON.stringify({
    query: 'subscription { postUpdated(id: 1) { id title } }'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = decoder.decode(value);
  // Parse SSE events from text
}
```

### EventSource (Limited)
```javascript
// Note: EventSource can't send POST with body
// This would require URL encoding the query
const eventSource = new EventSource('/graphql?query=subscription...');

eventSource.addEventListener('next', (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
});

eventSource.addEventListener('complete', () => {
  console.log('Subscription completed');
});
```

### GraphQL-SSE Client Library
```javascript
import { createClient } from 'graphql-sse';

const client = createClient({
  url: '/graphql'
});

const unsubscribe = client.subscribe(
  {
    query: 'subscription { postUpdated(id: 1) { id title } }'
  },
  {
    next: (data) => console.log('Received:', data),
    error: (err) => console.error('Error:', err),
    complete: () => console.log('Completed')
  }
);
```

## Testing Protocol Compliance

### Test Cases

1. **Valid Subscription Request**
   - ✅ Proper headers and GraphQL document
   - ✅ SSE connection established
   - ✅ Events streamed correctly

2. **Invalid Content-Type**
   - ❌ Wrong Content-Type header
   - ✅ 400 Bad Request response

3. **Missing Accept Header**
   - ❌ No Accept: text/event-stream
   - ✅ 415 Unsupported Media Type

4. **Non-Subscription Operation**
   - ❌ Query or mutation sent
   - ✅ 400 Bad Request with helpful message

5. **Invalid GraphQL**
   - ❌ Malformed GraphQL document
   - ✅ 400 Bad Request with parse error

6. **Connection Cleanup**
   - ✅ Client disconnect handled properly
   - ✅ Resources cleaned up

### Compliance Checklist

- [ ] Request validation according to spec
- [ ] Proper HTTP status codes
- [ ] SSE event formatting (`next`, `complete`)
- [ ] Error handling and reporting
- [ ] Connection lifecycle management
- [ ] Keep-alive mechanism
- [ ] CORS headers for browser compatibility

## Performance Considerations

### Connection Limits
- HTTP/1.1: ~6 connections per domain (browser limitation)
- HTTP/2: ~100 concurrent streams (configurable)
- Server: Configurable connection limits

### Memory Usage
- Store minimal subscription metadata
- Efficient event routing
- Proper cleanup on disconnect

### Network Efficiency
- Compress SSE events if possible
- Batch multiple events when appropriate
- Minimize keep-alive frequency

## Security Considerations

### Input Validation
- Validate all GraphQL documents
- Sanitize variables and operation names
- Limit document complexity

### Rate Limiting
- Limit connections per client
- Throttle subscription creation
- Monitor resource usage

### Authentication
- Support authentication headers
- Token-based security for WPGraphQL
- Audit subscription access
