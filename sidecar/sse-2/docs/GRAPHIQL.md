# GraphiQL IDE Integration

## Overview

Since SSE-2 is a subscription-only server, we need a GraphiQL IDE that can:
1. **Introspect the WPGraphQL schema** to show available subscriptions
2. **Handle SSE subscriptions** properly (not regular GraphQL execution)
3. **Provide a great developer experience** for testing subscriptions

## Implementation Options

### Option 1: Custom GraphiQL with SSE Support ⭐ **RECOMMENDED**

Build a custom GraphiQL interface that:
- Uses the WPGraphQL schema for introspection and autocomplete
- Redirects subscription operations to our SSE endpoint
- Shows real-time subscription results
- Provides helpful error messages

**Pros:**
- ✅ Perfect integration with our SSE protocol
- ✅ Full control over subscription handling
- ✅ Can show real-time events properly
- ✅ Custom documentation and examples

**Cons:**
- ❌ More development work
- ❌ Need to maintain custom GraphiQL build

### Option 2: GraphiQL with Custom Fetcher

Use standard GraphiQL with a custom fetcher that handles SSE:
- Standard GraphiQL interface
- Custom subscription fetcher for SSE protocol
- Schema introspection from WPGraphQL

**Pros:**
- ✅ Less custom code
- ✅ Standard GraphiQL features
- ✅ Easy to maintain

**Cons:**
- ❌ May have UI quirks with subscriptions
- ❌ Limited customization options

### Option 3: Separate Testing Interface

Build a simple custom testing interface:
- Basic subscription input form
- Real-time event display
- Schema browser

**Pros:**
- ✅ Minimal and focused
- ✅ Perfect for our use case
- ✅ Easy to build and maintain

**Cons:**
- ❌ No GraphiQL features (autocomplete, docs)
- ❌ Less familiar to developers

## Recommended Approach: GraphiQL with Custom Fetcher (GraphQL Yoga Pattern)

Let's implement **Option 2** - standard GraphiQL with a custom fetcher, following GraphQL Yoga's elegant content negotiation pattern.

### GraphQL Yoga's Content Negotiation Pattern

GraphQL Yoga uses **content negotiation** on a single endpoint - we'll follow the same pattern:

```
Browser Request → /graphql endpoint
                      │
                      ▼
            ┌─────────────────────┐
            │   Content           │
            │   Negotiation       │
            │   (Accept Header)   │
            └─────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│GET + html   │ │POST + json  │ │POST + sse   │
│             │ │             │ │             │
│Serve        │ │Handle       │ │Handle       │
│GraphiQL     │ │Introspection│ │Subscriptions│
│HTML         │ │Queries      │ │via SSE      │
└─────────────┘ └─────────────┘ └─────────────┘
```

**Single Endpoint Logic:**
```typescript
app.all('/graphql', (req, res) => {
  if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
    return serveGraphiQL(req, res);
  } else if (req.method === 'POST' && req.headers.accept?.includes('application/json')) {
    return handleIntrospection(req, res);
  } else if (req.method === 'POST' && req.headers.accept?.includes('text/event-stream')) {
    return handleSSESubscription(req, res);
  }
});
```

### Implementation Plan

#### 1. Content Negotiation Server
```typescript
private async handleRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.url !== '/graphql') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const acceptHeader = req.headers.accept || '';

  if (req.method === 'GET' && acceptHeader.includes('text/html')) {
    // Serve GraphiQL HTML
    return this.serveGraphiQL(req, res);
  } else if (req.method === 'POST' && acceptHeader.includes('text/event-stream')) {
    // Handle SSE subscriptions
    return this.handleSSESubscription(req, res);
  } else if (req.method === 'POST' && acceptHeader.includes('application/json')) {
    // Handle introspection queries
    return this.handleIntrospection(req, res);
  } else {
    res.writeHead(400);
    res.end('Bad Request');
  }
}
```

#### 2. GraphiQL HTML Template
```typescript
private serveGraphiQL(req: IncomingMessage, res: ServerResponse) {
  const graphiqlHTML = `
<!DOCTYPE html>
<html>
<head>
  <title>SSE-2 GraphiQL</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
  <style>
    body { margin: 0; height: 100vh; }
    #graphiql { height: 100vh; }
  </style>
</head>
<body>
  <div id="graphiql">Loading...</div>
  
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  
  <script>
    ${this.getCustomFetcher()}
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(graphiqlHTML);
}
```

#### 3. Custom SSE Fetcher Implementation
```typescript
private getCustomFetcher(): string {
  return `
    // Custom fetcher that handles introspection and subscriptions
    const customFetcher = (graphQLParams, opts) => {
      const { query, variables, operationName } = graphQLParams;
      
      // Check if it's an introspection query
      if (query.includes('__schema') || query.includes('__type') || query.includes('IntrospectionQuery')) {
        // Use regular fetch for introspection
        return fetch('/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ query, variables, operationName })
        }).then(res => res.json());
      }
      
      // Check if it's a subscription
      if (query.trim().startsWith('subscription')) {
        // Use SSE for subscriptions
        return new Promise((resolve, reject) => {
          let hasResolved = false;
          
          fetch('/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            },
            body: JSON.stringify({ query, variables, operationName })
          })
          .then(response => {
            if (!response.ok) {
              return response.json().then(reject);
            }
            
            // Handle SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            const readStream = () => {
              reader.read().then(({ done, value }) => {
                if (done) {
                  if (!hasResolved) {
                    resolve({ data: null });
                    hasResolved = true;
                  }
                  return;
                }
                
                const text = decoder.decode(value);
                const events = parseSSEEvents(text);
                
                events.forEach(event => {
                  if (event.type === 'next' && !hasResolved) {
                    try {
                      const data = JSON.parse(event.data);
                      resolve(data);
                      hasResolved = true;
                    } catch (e) {
                      reject(e);
                    }
                  } else if (event.type === 'complete' && !hasResolved) {
                    resolve({ data: null });
                    hasResolved = true;
                  }
                });
                
                if (!hasResolved) {
                  readStream(); // Continue reading
                }
              }).catch(reject);
            };
            
            readStream();
          })
          .catch(reject);
        });
      }
      
      // Non-subscription operation - show helpful error
      return Promise.resolve({
        errors: [{
          message: 'Only subscription operations are supported. Use queries and mutations against WPGraphQL directly.',
          extensions: {
            code: 'OPERATION_NOT_SUPPORTED',
            wpgraphqlEndpoint: '${process.env.WPGRAPHQL_ENDPOINT || 'http://localhost/graphql'}'
          }
        }]
      });
    };
    
    // Helper function to parse SSE events
    function parseSSEEvents(text) {
      const events = [];
      const lines = text.split('\\n');
      let currentEvent = {};
      
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent.type = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.substring(5).trim();
        } else if (line === '') {
          if (currentEvent.type) {
            events.push(currentEvent);
            currentEvent = {};
          }
        }
      }
      
      return events;
    }
    
    // Initialize GraphiQL
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    root.render(
      React.createElement(GraphiQL, {
        fetcher: customFetcher,
        defaultQuery: \`# Welcome to SSE-2 GraphiQL
# 
# This server only supports GraphQL subscriptions.
# For queries and mutations, use WPGraphQL directly.
#
# Try this example subscription:

subscription PostUpdated($id: ID!) {
  postUpdated(id: $id) {
    id
    title
    content
    dateModified
    author {
      node {
        name
      }
    }
  }
}

# Variables:
# {
#   "id": "1"
# }\`,
        variables: JSON.stringify({ id: "1" }, null, 2)
      })
    );
  `;
}
```

#### 4. Introspection Handler
```typescript
private async handleIntrospection(req: IncomingMessage, res: ServerResponse) {
  try {
    // Get request body
    const body = await this.getRequestBody(req);
    const { query, variables, operationName } = JSON.parse(body);
    
    // Only allow introspection queries
    if (!query.includes('__schema') && !query.includes('__type') && operationName !== 'IntrospectionQuery') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{
          message: 'Only introspection queries are supported on this endpoint for JSON responses.',
          extensions: { code: 'OPERATION_NOT_SUPPORTED' }
        }]
      }));
      return;
    }
    
    // Forward introspection to WPGraphQL
    const response = await fetch(process.env.WPGRAPHQL_ENDPOINT!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables, operationName })
    });
    
    const result = await response.json();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      errors: [{ message: 'Internal server error' }]
    }));
  }
}
```

### Example Subscriptions

We'll include helpful example subscriptions in the GraphiQL interface:

```graphql
# Post Updates
subscription PostUpdated($id: ID!) {
  postUpdated(id: $id) {
    id
    title
    content
    dateModified
    author {
      node {
        name
      }
    }
  }
}

# Comment Updates
subscription CommentUpdated($postId: ID!) {
  commentUpdated(postId: $postId) {
    id
    content
    date
    author {
      node {
        name
        email
      }
    }
    commentedOn {
      node {
        id
        title
      }
    }
  }
}

# User Updates
subscription UserUpdated($id: ID!) {
  userUpdated(id: $id) {
    id
    name
    email
    roles {
      nodes {
        name
      }
    }
  }
}
```

### Benefits of GraphQL Yoga Approach

#### ✅ **Familiar Pattern**
- Same pattern as GraphQL Yoga (developers know how to use it)
- Single endpoint with content negotiation (`/graphql`)
- Standard GraphiQL interface with all features

#### ✅ **Minimal Custom Code**
- Use standard GraphiQL library (not custom build)
- Only custom part is the fetcher function
- Less maintenance overhead

#### ✅ **Full GraphiQL Features**
- Schema introspection and autocomplete from WPGraphQL
- Documentation explorer with all subscription fields
- Query formatting, validation, and syntax highlighting
- Variable editor and query history

#### ✅ **Proper Subscription Handling**
- SSE subscriptions work correctly with real-time streaming
- Helpful errors for non-subscription operations
- Seamless developer experience

### File Structure

```
sidecar/sse-2/
├── src/
│   ├── server.ts              # Main server with content negotiation
│   ├── graphiql/
│   │   ├── template.ts        # HTML template generation
│   │   ├── fetcher.ts         # Custom SSE fetcher logic
│   │   └── examples.ts        # Default queries and examples
│   └── introspection/
│       └── proxy.ts           # WPGraphQL schema introspection proxy
└── tests/                     # GraphiQL integration tests
```

### Testing Strategy

#### 1. **Manual Testing**
- Test subscription creation and streaming
- Verify error handling for non-subscriptions
- Test with different subscription types
- Verify schema introspection works

#### 2. **Automated Testing**
- Unit tests for SSE fetcher
- Integration tests for GraphiQL endpoint
- E2E tests for subscription flow

#### 3. **User Experience Testing**
- Test with developers unfamiliar with the system
- Gather feedback on interface usability
- Iterate on error messages and documentation

### Alternative: GraphiQL Subscriptions Plugin

If building a custom GraphiQL proves complex, we could use existing GraphiQL subscription plugins:

```bash
npm install @graphiql/plugin-explorer graphiql-subscriptions-fetcher
```

```javascript
import { createGraphiQLFetcher } from '@graphiql/toolkit';
import { subscriptionExchange } from 'graphiql-subscriptions-fetcher';

const fetcher = createGraphiQLFetcher({
  url: '/graphql',
  subscriptionUrl: '/graphql', // Same endpoint, different headers
  headers: {
    'Accept': 'text/event-stream'
  }
});
```

### Configuration Options

```typescript
interface GraphiQLConfig {
  endpoint: string;           // SSE-2 server endpoint
  wpgraphqlEndpoint: string; // WPGraphQL endpoint for schema
  defaultQuery?: string;     // Default subscription to show
  theme?: 'light' | 'dark';  // UI theme
  examples: {               // Example subscriptions
    name: string;
    query: string;
    variables?: any;
  }[];
}
```

### Deployment

The GraphiQL interface will be served at:
- **Development**: `http://localhost:4000/graphiql`
- **Production**: Configurable, could be disabled for security

### Security Considerations

1. **Production Access**: GraphiQL should be disabled or protected in production
2. **CORS**: Proper CORS headers for browser access
3. **Rate Limiting**: Prevent abuse of the GraphiQL interface
4. **Authentication**: Optional authentication for GraphiQL access

This GraphiQL integration will provide an excellent developer experience for testing and exploring subscriptions! 🚀
