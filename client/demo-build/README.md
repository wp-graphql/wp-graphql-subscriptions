# WPGraphQL Subscriptions - Production Demo

A production-ready demo of WPGraphQL Subscriptions built with modern tooling and best practices.

## 🚀 Features

- **TypeScript** - Full type safety and IntelliSense
- **Real Apollo Client** - Production Apollo Client integration
- **Vite** - Fast development and optimized builds
- **ES Modules** - Modern JavaScript module system
- **GraphQL-SSE Client** - Custom TypeScript client library
- **Apollo Link** - Seamless Apollo integration
- **Production Ready** - Optimized builds and source maps

## 📦 Tech Stack

- **React 18** - Modern React with hooks
- **TypeScript 5** - Latest TypeScript features
- **Apollo Client 3.8** - GraphQL client with caching
- **Vite 5** - Next-generation frontend tooling
- **GraphQL-SSE Protocol** - Real-time subscriptions over SSE

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm or yarn
- WordPress site with WPGraphQL Subscriptions plugin

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Update configuration:**
   - Edit `vite.config.ts` to point to your WordPress site
   - Default proxy target: `http://wpgraphql.local`

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run type-check` - Run TypeScript type checking

## 🏗️ Build for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` directory with:
- ✅ Minified JavaScript and CSS
- ✅ Source maps for debugging
- ✅ Optimized assets
- ✅ Tree-shaken code

## 📁 Project Structure

```
src/
├── components/          # React components
│   ├── ConnectionStatus.tsx
│   └── PostSubscription.tsx
├── lib/                 # Core libraries
│   ├── graphql-sse-client.ts    # TypeScript SSE client
│   ├── graphql-sse-link.ts      # Apollo Link integration
│   └── queries.ts               # GraphQL queries
├── App.tsx             # Main application
├── App.css             # Application styles
├── main.tsx            # Entry point
└── index.css           # Global styles
```

## 🔌 GraphQL-SSE Client API

### Basic Usage

```typescript
import { GraphQLSSEClient } from './lib/graphql-sse-client';

const client = new GraphQLSSEClient({
  baseUrl: '/graphql/stream',
  debug: true,
  onConnectionChange: (state) => console.log('State:', state),
  onError: (error) => console.error('Error:', error),
  onDebug: (msg) => console.log('Debug:', msg)
});

// Connect
await client.makeReservation();
await client.connect();

// Subscribe
const subscription = await client.subscribe(
  'my-operation',
  'subscription { postUpdated(id: "123") { title } }',
  { id: '123' }
);

subscription.subscribe({
  next: (data) => console.log('Data:', data),
  error: (error) => console.error('Error:', error),
  complete: () => console.log('Complete')
});
```

### Apollo Integration

```typescript
import { ApolloClient, InMemoryCache } from '@apollo/client';
import { GraphQLSSELink } from './lib/graphql-sse-link';

const link = new GraphQLSSELink({
  baseUrl: '/graphql/stream',
  debug: true
});

const client = new ApolloClient({
  link,
  cache: new InMemoryCache()
});

// Use with hooks
const { data, loading, error } = useSubscription(POST_UPDATED_SUBSCRIPTION, {
  variables: { id: '123' }
});
```

## 🎯 Usage

1. **Connect to GraphQL-SSE**
   - Click "Connect" to establish SSE connection
   - Status indicator shows connection state

2. **Subscribe to Updates**
   - Enter a post ID (e.g., 394)
   - Subscription starts automatically when connected

3. **Test Real-time Updates**
   - Update the post in WordPress admin
   - See real-time updates appear in the UI

4. **Monitor Debug Logs**
   - View detailed logs in the debug panel
   - Track connection state, messages, and errors

## 🔧 Configuration

### Proxy Configuration (vite.config.ts)

```typescript
server: {
  proxy: {
    '/graphql/stream': {
      target: 'http://your-wordpress-site.local',
      changeOrigin: true
    }
  }
}
```

### TypeScript Configuration

The project uses strict TypeScript settings:
- Strict type checking enabled
- No unused locals/parameters
- Full ES2020 support

## 🚀 Deployment

### Static Hosting

After building, deploy the `dist/` directory to any static host:
- Netlify
- Vercel  
- AWS S3 + CloudFront
- GitHub Pages

### Server Requirements

The built app requires:
- Static file serving
- Proxy to WordPress GraphQL-SSE endpoint
- HTTPS recommended for production

## 🐛 Troubleshooting

### Common Issues

1. **CORS Errors**
   - Configure WordPress CORS headers
   - Use proxy in development

2. **Connection Failures**
   - Check WordPress site URL in proxy config
   - Verify WPGraphQL Subscriptions plugin is active

3. **TypeScript Errors**
   - Run `npm run type-check` for detailed errors
   - Check import paths and type definitions

### Debug Mode

Enable debug logging:

```typescript
const client = new GraphQLSSEClient({
  debug: true, // Enable debug logs
  onDebug: (msg) => console.log('Debug:', msg)
});
```

## 📚 Learn More

- [WPGraphQL Subscriptions Documentation](../docs/)
- [GraphQL-SSE Protocol](https://github.com/enisdenjo/graphql-sse/blob/master/PROTOCOL.md)
- [Apollo Client Documentation](https://www.apollographql.com/docs/react/)
- [Vite Documentation](https://vitejs.dev/)