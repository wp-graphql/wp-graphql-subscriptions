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
- Redis server (see [Redis Setup](#redis-setup))
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
WPGRAPHQL_ENDPOINT=http://localhost/graphql
REDIS_URL=redis://localhost:6379
PORT=4000
```

### Development

```bash
# Start Redis + dev server together
npm run dev:full

# Or start them separately:
npm run redis:start  # Start Redis in Docker
npm run dev          # Start dev server with hot reload

# Other commands:
npm run build        # Build for production
npm start           # Start production server
npm run redis:stop   # Stop Redis container
npm run redis:logs   # View Redis logs
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Architecture

The sidecar server acts as an intelligent GraphQL proxy with real-time subscription capabilities:

### **Operation Routing**
- **Introspection**: Handled locally by Yoga for modern GraphQL tooling compatibility
- **Queries & Mutations**: Proxied directly to WPGraphQL for full WordPress integration  
- **Subscriptions**: Handled by custom Redis pub/sub system with SSE streaming
- **Schema**: Introspected from WPGraphQL and cached for performance

### **Key Components**
1. **Schema Introspection**: Automatically discovers and caches WPGraphQL schema
2. **Intelligent Proxy**: Content-based routing - detects operation type and routes accordingly
3. **Authentication Passthrough**: Forwards JWT tokens and cookies to WPGraphQL
4. **Real-time Engine**: Redis pub/sub + SSE for subscription events (Phase 1.4)

## Current Implementation Status

✅ **Phase 1.1 Complete**: Basic project setup and configuration  
✅ **Phase 1.2 Complete**: Schema management and introspection  
✅ **Phase 1.3 Complete**: Basic proxy functionality with intelligent operation routing  
🔄 **Phase 1.4 In Progress**: Simple subscription support with Redis pub/sub and SSE
  - ✅ Redis client integration with pub/sub support
  - ✅ Channel naming strategy with single-argument constraint
  - ✅ Subscription manager for lifecycle management
  - ✅ GraphiQL introspection compatibility fix
  - ⏳ SSE subscription resolvers (next)  

## Redis Setup

### Option 1: Docker (Recommended)
```bash
# Start Redis in Docker
docker run --name wpgraphql-redis -p 6379:6379 -d redis:7-alpine

# Stop when done
docker stop wpgraphql-redis
```

### Option 2: Homebrew (macOS)
```bash
# Install and start Redis
brew install redis
brew services start redis
```

### Option 3: Direct Installation
```bash
# Download and run Redis
wget http://download.redis.io/redis-stable.tar.gz
tar xvzf redis-stable.tar.gz
cd redis-stable
make
./src/redis-server
```

## Development

This project is under active development. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for detailed implementation progress.

## License

MIT
