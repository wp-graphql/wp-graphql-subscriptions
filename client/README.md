# GraphQL-SSE Client Library

A JavaScript client library for GraphQL-SSE protocol subscriptions, with built-in support for Apollo Client and other GraphQL clients.

## Features

- ✅ **GraphQL-SSE Protocol Compliant** - Full implementation of the GraphQL-SSE specification
- ✅ **Apollo Client Integration** - Drop-in replacement for WebSocket subscriptions
- ✅ **Automatic Reconnection** - Exponential backoff with configurable retry attempts
- ✅ **Connection Management** - Handles reservation, operation execution, and SSE streaming
- ✅ **TypeScript Ready** - Full TypeScript support (types coming soon)
- ✅ **Framework Agnostic** - Works with React, Vue, Angular, or vanilla JS
- ✅ **Comprehensive Logging** - Debug and error logging with configurable levels

## Quick Start

### Installation

```bash
# Copy the client library to your project
cp graphql-sse-client.js /path/to/your/project/
```

### Basic Usage (Vanilla JS)

```javascript
import { GraphQLSSEClient } from './graphql-sse-client.js';

const client = new GraphQLSSEClient({
  baseUrl: '/graphql/stream',
  debug: true
});

// Connect and subscribe
await client.makeReservation();
await client.connect();

const subscription = await client.subscribe(
  'my-subscription',
  `subscription { postUpdated(id: "123") { id title } }`,
  { id: "123" }
);

subscription.subscribe({
  next: (data) => console.log('Update:', data),
  error: (error) => console.error('Error:', error),
  complete: () => console.log('Subscription completed')
});
```

### Apollo Client Integration

```javascript
import { ApolloClient, InMemoryCache } from '@apollo/client';
import { GraphQLSSELink } from './graphql-sse-client.js';

const sseLink = new GraphQLSSELink({
  baseUrl: '/graphql/stream',
  debug: true
});

const client = new ApolloClient({
  link: sseLink,
  cache: new InMemoryCache()
});

// Use with React hooks
import { useSubscription, gql } from '@apollo/client';

const POST_SUBSCRIPTION = gql`
  subscription PostUpdated($id: ID!) {
    postUpdated(id: $id) {
      id
      title
      status
      modified
    }
  }
`;

function MyComponent() {
  const { data, loading, error } = useSubscription(POST_SUBSCRIPTION, {
    variables: { id: "123" }
  });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <div>Post: {data?.postUpdated?.title}</div>;
}
```

## API Reference

### GraphQLSSEClient

#### Constructor Options

```javascript
const client = new GraphQLSSEClient({
  baseUrl: '/graphql/stream',           // GraphQL-SSE endpoint
  debug: false,                         // Enable debug logging
  reconnectAttempts: 5,                 // Max reconnection attempts
  reconnectDelay: 1000,                 // Base reconnection delay (ms)
  headers: {},                          // Additional HTTP headers
  onConnectionChange: (state) => {},    // Connection state callback
  onError: (error) => {},               // Error callback
  onDebug: (message) => {}              // Debug callback
});
```

#### Methods

##### `makeReservation(): Promise<string>`
Creates a connection token via PUT request.

```javascript
const token = await client.makeReservation();
console.log('Token:', token);
```

##### `executeOperation(operationId, query, variables): Promise<object>`
Registers a GraphQL subscription via POST request.

```javascript
await client.executeOperation(
  'my-sub-001',
  'subscription { postUpdated { id title } }',
  { id: "123" }
);
```

##### `connect(): Promise<void>`
Establishes SSE connection via GET request.

```javascript
await client.connect();
```

##### `subscribe(operationId, query, variables): Promise<Observable>`
Complete subscription flow - executes operation and returns observable.

```javascript
const subscription = await client.subscribe(
  'my-subscription',
  'subscription { postUpdated { id title } }',
  { id: "123" }
);

const unsubscribe = subscription.subscribe({
  next: (data) => console.log(data),
  error: (error) => console.error(error),
  complete: () => console.log('Done')
});

// Later: unsubscribe.unsubscribe();
```

##### `disconnect(): void`
Closes connection and cleans up subscriptions.

```javascript
client.disconnect();
```

##### `getConnectionState(): object`
Returns current connection state information.

```javascript
const state = client.getConnectionState();
// {
//   state: 'connected',
//   token: 'abc-123',
//   activeSubscriptions: 2,
//   reconnectCount: 0
// }
```

#### Connection States

- `disconnected` - No active connection
- `connecting` - Establishing connection
- `connected` - Ready for subscriptions
- `error` - Connection failed

### GraphQLSSELink (Apollo)

Apollo Client Link implementation for GraphQL-SSE subscriptions.

```javascript
const sseLink = new GraphQLSSELink({
  baseUrl: '/graphql/stream',
  debug: true,
  onConnectionChange: (state) => {
    console.log('Connection:', state);
  }
});

const client = new ApolloClient({
  link: sseLink,
  cache: new InMemoryCache()
});
```

#### Methods

- `setOnError(fn)` - Set error handler
- `dispose()` - Clean up and disconnect

## Examples

### React with Apollo Client

See `demo-apollo-react.html` for a complete React example with:
- Connection management UI
- Real-time post updates
- Subscription lifecycle handling
- Error handling and reconnection

### Vanilla JavaScript

See `demo-vanilla-js.html` for a pure JavaScript example with:
- Multiple concurrent subscriptions
- Connection status monitoring
- Debug logging
- Manual subscription management

### Vue.js Integration

```javascript
import { GraphQLSSEClient } from './graphql-sse-client.js';

export default {
  data() {
    return {
      client: null,
      posts: [],
      connectionState: 'disconnected'
    };
  },
  
  async mounted() {
    this.client = new GraphQLSSEClient({
      baseUrl: '/graphql/stream',
      onConnectionChange: (state) => {
        this.connectionState = state;
      }
    });

    await this.client.makeReservation();
    await this.client.connect();
    await this.subscribeToUpdates();
  },

  methods: {
    async subscribeToUpdates() {
      const subscription = await this.client.subscribe(
        'post-updates',
        'subscription { postUpdated { id title } }'
      );

      subscription.subscribe({
        next: (data) => {
          this.posts.unshift(data.data.postUpdated);
        }
      });
    }
  },

  beforeDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }
};
```

### Angular Integration

```typescript
import { Injectable } from '@angular/core';
import { GraphQLSSEClient } from './graphql-sse-client.js';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class GraphQLSSEService {
  private client: GraphQLSSEClient;
  private connectionState$ = new BehaviorSubject<string>('disconnected');

  constructor() {
    this.client = new GraphQLSSEClient({
      baseUrl: '/graphql/stream',
      onConnectionChange: (state) => {
        this.connectionState$.next(state);
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.makeReservation();
    await this.client.connect();
  }

  subscribeToPostUpdates(postId: string): Observable<any> {
    return new Observable(observer => {
      this.client.subscribe(
        `post-${postId}`,
        `subscription PostUpdated($id: ID!) { 
          postUpdated(id: $id) { id title status } 
        }`,
        { id: postId }
      ).then(subscription => {
        return subscription.subscribe(observer);
      });
    });
  }

  getConnectionState(): Observable<string> {
    return this.connectionState$.asObservable();
  }

  disconnect(): void {
    this.client.disconnect();
  }
}
```

## Error Handling

### Connection Errors

```javascript
const client = new GraphQLSSEClient({
  onError: (error) => {
    console.error('Connection error:', error);
    // Handle connection failures
    showNotification('Connection lost. Reconnecting...', 'warning');
  },
  onConnectionChange: (state) => {
    if (state === 'error') {
      // Handle connection errors
      showNotification('Connection failed', 'error');
    } else if (state === 'connected') {
      showNotification('Connected successfully', 'success');
    }
  }
});
```

### Subscription Errors

```javascript
const subscription = await client.subscribe('my-sub', query, variables);

subscription.subscribe({
  next: (data) => {
    // Handle successful updates
    updateUI(data);
  },
  error: (error) => {
    // Handle subscription-specific errors
    console.error('Subscription error:', error);
    showError(`Subscription failed: ${error.message}`);
  },
  complete: () => {
    // Subscription ended normally
    console.log('Subscription completed');
  }
});
```

## Advanced Configuration

### Custom Headers

```javascript
const client = new GraphQLSSEClient({
  headers: {
    'Authorization': 'Bearer ' + getAuthToken(),
    'X-Custom-Header': 'value'
  }
});
```

### Reconnection Strategy

```javascript
const client = new GraphQLSSEClient({
  reconnectAttempts: 10,        // Try 10 times
  reconnectDelay: 2000,         // Start with 2 second delay
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, ...
});
```

### Debug Logging

```javascript
const client = new GraphQLSSEClient({
  debug: true,
  onDebug: (message, ...args) => {
    // Custom debug logging
    console.log(`[SSE Debug] ${message}`, ...args);
    
    // Send to logging service
    logToService('debug', message, args);
  }
});
```

## Browser Compatibility

- **Modern Browsers**: Chrome 60+, Firefox 55+, Safari 12+, Edge 79+
- **EventSource Support**: Required (available in all modern browsers)
- **ES6 Modules**: Required (or use bundler for older browsers)

### Polyfills

For older browser support, include EventSource polyfill:

```html
<script src="https://polyfill.io/v3/polyfill.min.js?features=EventSource"></script>
```

## Performance Considerations

### Connection Pooling

The client automatically manages connection pooling:
- One connection per client instance
- Multiple subscriptions share the same connection
- Automatic cleanup on disconnect

### Memory Management

```javascript
// Always clean up subscriptions
const unsubscribe = subscription.subscribe(observer);

// Later...
unsubscribe.unsubscribe();

// Disconnect client when done
client.disconnect();
```

### Subscription Limits

Be mindful of subscription limits:
- Database storage: ~10 concurrent subscriptions recommended
- Redis storage: Thousands of subscriptions supported

## Troubleshooting

### Common Issues

#### "Reservation failed" Error
- Check that `/graphql/stream` endpoint is accessible
- Verify WordPress rewrite rules are working
- Check server error logs

#### "Connection timeout" Error
- Verify SSE endpoint allows long-running connections
- Check PHP-FPM timeout settings
- Ensure no proxy/CDN is buffering SSE responses

#### "No matching subscriptions" Error
- Verify subscription document is registered correctly
- Check that WordPress events are being emitted
- Review server-side subscription matching logic

### Debug Mode

Enable debug mode for detailed logging:

```javascript
const client = new GraphQLSSEClient({
  debug: true,
  onDebug: console.log,
  onError: console.error
});
```

### Network Inspection

Use browser dev tools to inspect:
1. **PUT** `/graphql/stream` - Should return connection token
2. **POST** `/graphql/stream` - Should return 202 Accepted
3. **GET** `/graphql/stream?token=...` - Should establish SSE stream

## Contributing

Contributions welcome! Please:

1. Follow existing code style
2. Add tests for new features
3. Update documentation
4. Test with both Apollo and vanilla JS examples

## License

This client library follows the same license as the WPGraphQL Subscriptions plugin (GPL v3 or later).