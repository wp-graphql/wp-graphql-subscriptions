# Changelog

All notable changes to the WPGraphQL Subscriptions Sidecar will be documented in this file.

## [0.1.0] - 2025-01-20

### Phase 1.1 - Project Setup ✅
- Initial Node.js TypeScript project structure
- GraphQL Yoga, Redis, and GraphQL tools integration
- Comprehensive configuration management with environment variables
- Structured logging with Pino and pretty printing
- Build system and development tooling
- Environment configuration template
- Git ignore configuration
- Redis management npm scripts

### Phase 1.2 - Schema Management ✅
- WPGraphQL schema introspection with automatic discovery
- Schema caching mechanism with configurable TTL (5 minutes default)
- Graceful error handling and fallback to cached schema
- Schema invalidation and refresh capabilities
- Timeout handling for introspection requests
- Comprehensive logging for schema operations

### Phase 1.3 - Intelligent Proxy Functionality ✅
- **Content-based GraphQL operation detection** - detects GraphQL by request content, not URL patterns
- **Intelligent operation routing**:
  - Queries & Mutations → Proxied to WPGraphQL
  - Subscriptions → Pass through to custom handlers (ready for Phase 1.4)
- **Authentication passthrough** - forwards JWT tokens, cookies, and headers
- **HTTP client with timeout handling** using AbortController
- **Comprehensive error handling** with graceful fallbacks
- **Request/response logging** for debugging
- **GraphQL operation type utilities** for robust operation detection
- **Non-GraphQL request passthrough** - ignores non-GraphQL requests

### Technical Improvements
- Modular TypeScript architecture with clean separation of concerns
- Robust error handling throughout the application
- Performance optimizations with connection pooling
- Developer experience enhancements (hot reload, debugging)
- Production-ready logging and monitoring capabilities

### Verified Functionality
- ✅ Full WPGraphQL schema introspection and caching
- ✅ All queries work exactly like direct WPGraphQL connection
- ✅ All mutations work with proper authentication
- ✅ Subscription operations detected and routed correctly
- ✅ Non-GraphQL requests handled gracefully
- ✅ Authentication headers forwarded properly
- ✅ Error handling and graceful degradation

### Architecture
```
Client → Yoga Sidecar → [Queries/Mutations] → WPGraphQL
                    → [Subscriptions] → Custom Handlers (Phase 1.4)
```

### Ready for Phase 1.4
The foundation is complete for implementing:
- Redis pub/sub integration
- SSE event streaming for subscriptions
- WordPress event triggers
- Real-time subscription functionality

---

## Upcoming

### Phase 1.4 - Simple Subscription Support (Next)
- Redis pub/sub integration
- SSE connection management
- WordPress event emission integration
- Basic subscription field resolvers
