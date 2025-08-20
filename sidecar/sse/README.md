# WPGraphQL Subscriptions Sidecar

A GraphQL Yoga-based sidecar server that provides real-time subscription capabilities for WPGraphQL using Server-Sent Events (SSE) and Redis pub/sub.

## Features

- 🚀 **GraphQL Yoga Integration**: Built on GraphQL Yoga for modern GraphQL server capabilities
- 📡 **Server-Sent Events**: Real-time subscriptions using native SSE support
- 🔄 **Schema Proxying**: Automatically introspects and proxies WPGraphQL schema
- 📨 **Redis Pub/Sub**: Event-driven architecture using Redis for scalability
- 🔒 **Authentication**: JWT token passthrough to WPGraphQL
- ⚡ **Performance**: Schema caching and connection pooling

## Quick Start

### Prerequisites

- Node.js 18+
- Redis server
- WordPress with WPGraphQL plugin

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp env.example .env

# Edit configuration
vim .env
```

### Configuration

Key environment variables:

```bash
WPGRAPHQL_ENDPOINT=http://localhost:8080/graphql
REDIS_URL=redis://localhost:6379
PORT=4000
```

### Development

```bash
# Start in development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Architecture

The sidecar server acts as a proxy between GraphQL clients and WPGraphQL, adding real-time subscription capabilities:

1. **Schema Introspection**: Automatically discovers WPGraphQL schema
2. **Request Proxying**: Forwards queries/mutations to WPGraphQL
3. **Subscription Enhancement**: Adds real-time capabilities to subscription fields
4. **Event Processing**: Listens to WordPress events via Redis and triggers subscription updates

## Current Implementation Status

✅ **Phase 1.1 Complete**: Basic project setup and configuration  
🔄 **Phase 1.2 In Progress**: Schema management and introspection  
⏳ **Phase 1.3 Pending**: Basic proxy functionality  
⏳ **Phase 1.4 Pending**: Simple subscription support  

## Development

This project is under active development. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for detailed implementation progress.

## License

MIT
