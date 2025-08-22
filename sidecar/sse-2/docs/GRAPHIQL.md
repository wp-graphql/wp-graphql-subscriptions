# Custom GraphiQL Implementation

## Overview

SSE-2 includes a custom-built GraphiQL IDE specifically optimized for GraphQL subscriptions. Unlike the standard CDN-based approach, our custom implementation provides:

1. **🔍 Proper AST parsing** - Uses `graphql-js` for accurate operation detection
2. **⚡ Pre-validation** - Catches syntax and variable errors before subscription creation
3. **🎨 Real-time updates** - Native SSE subscription support with async iterators
4. **🌐 Cross-browser compatibility** - Works in regular and incognito/private modes
5. **📱 Modern interface** - Custom React components with TypeScript

## Architecture

```
Browser Request → /graphql
        │
        ▼
┌─────────────────┐
│   HTTP Server   │
│ Content Negotiation │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Static File     │
│ Serving         │
│ /graphiql.html  │
│ /graphiql-bundle.js │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Custom GraphiQL │
│ React Component │
│ + SSE Fetcher   │
└─────────────────┘
```

## Build System

### Webpack Configuration

Our custom build uses webpack with the following setup:

```javascript
// webpack.config.cjs
module.exports = {
  entry: './src/graphiql/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/public'),
    filename: 'graphiql-bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/graphiql/index.html',
      filename: 'graphiql.html',
    }),
  ],
};
```

### Build Commands

```bash
# Development build with watch
npm run build:graphiql:dev

# Production build
npm run build:graphiql

# Build everything (server + GraphiQL)
npm run build
```

## Custom GraphiQL Component

### Core Features

**AST-Based Operation Detection:**
```typescript
// Uses graphql-js parse() instead of regex
const ast = parse(graphQLParams.query);
const operationDef = ast.definitions.find(def => 
  def.kind === 'OperationDefinition'
);
const operationType = operationDef?.operation;
```

**Pre-Subscription Validation:**
```typescript
// Server-side validation before SSE connection
const validation = await this.validateSubscription(graphqlRequest);
if (!validation.isValid) {
  // Return 400 with specific error messages
  res.end(JSON.stringify({ errors: validation.errors }));
  return;
}
```

**SSE Async Iterator:**
```typescript
// Proper async generator for GraphiQL subscriptions
async function* createSSESubscription(params) {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Accept': 'text/event-stream' },
    body: JSON.stringify(params),
  });
  
  // Handle validation errors
  if (!response.ok && response.status === 400) {
    const errorResponse = await response.json();
    yield errorResponse;
    return;
  }
  
  // Stream SSE events
  const reader = response.body.getReader();
  // ... SSE parsing logic
}
```

## Validation System

### Server-Side Validation

The server validates subscriptions before establishing SSE connections:

**GraphQL Syntax Validation:**
```typescript
try {
  const document = parse(graphqlRequest.query);
  const operationAST = getOperationAST(document, graphqlRequest.operationName);
} catch (error) {
  return { isValid: false, errors: [{ message: `GraphQL syntax error: ${error.message}` }] };
}
```

**Operation Type Validation:**
```typescript
if (operationAST.operation !== 'subscription') {
  return {
    isValid: false,
    errors: [{ message: `Operation must be a subscription, got ${operationAST.operation}` }]
  };
}
```

**Variable Validation:**
```typescript
const variableDefinitions = operationAST.variableDefinitions || [];
const providedVariables = graphqlRequest.variables || {};

for (const varDef of variableDefinitions) {
  const varName = varDef.variable.name.value;
  const isRequired = varDef.type.kind === 'NonNullType';
  
  if (isRequired && !(varName in providedVariables)) {
    missingVariables.push(varName);
  }
}
```

### Validation Error Examples

**Missing Required Variables:**
```json
{
  "errors": [
    {
      "message": "Variable \"$id\" of required type was not provided.",
      "locations": []
    }
  ]
}
```

**Invalid Operation Type:**
```json
{
  "errors": [
    {
      "message": "Operation must be a subscription, got query",
      "locations": []
    }
  ]
}
```

**Syntax Errors:**
```json
{
  "errors": [
    {
      "message": "GraphQL syntax error: Syntax Error: Expected Name, found }",
      "locations": []
    }
  ]
}
```

## File Structure

```
src/graphiql/
├── index.tsx              # Entry point and React root
├── CustomGraphiQL.tsx     # Main GraphiQL component
└── index.html            # HTML template

dist/public/              # Built assets
├── graphiql.html         # Generated HTML
├── graphiql-bundle.js    # Main bundle
├── *.js                  # Code-split chunks
└── *.js.map             # Source maps
```

### Key Files

**Entry Point (`src/graphiql/index.tsx`):**
```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import CustomGraphiQL from './CustomGraphiQL';

const container = document.getElementById('graphiql');
if (container) {
  const root = createRoot(container);
  root.render(<CustomGraphiQL />);
}
```

**Custom Component (`src/graphiql/CustomGraphiQL.tsx`):**
- GraphiQL component with custom fetcher
- AST-based operation detection
- SSE subscription handling
- Error handling and validation display

**HTML Template (`src/graphiql/index.html`):**
- Minimal HTML structure
- Responsive viewport meta tags
- CSS reset and GraphiQL container

## Server Integration

### Static File Serving

```typescript
// HTTP server serves built GraphiQL assets
if (parsedUrl.pathname?.endsWith('.js') || parsedUrl.pathname?.endsWith('.map')) {
  await this.handleStaticFile(req, res, logger, parsedUrl.pathname);
}
```

### Content Negotiation

```typescript
// Serve GraphiQL for browser requests
if (req.method === 'GET' && acceptHeader.includes('text/html')) {
  return this.handleGraphiQL(req, res, logger);
}
```

### GraphiQL HTML Loading

```typescript
private async loadCustomGraphiQLHTML(): Promise<string> {
  try {
    const htmlPath = join(__dirname, '../../dist/public/graphiql.html');
    return await readFile(htmlPath, 'utf-8');
  } catch (error) {
    // Fallback error page with build instructions
    return this.getFallbackHTML();
  }
}
```

## Development Workflow

### Hot Reload Development

```bash
# Terminal 1: Build GraphiQL with watch
npm run build:graphiql:dev

# Terminal 2: Start server with hot reload
npm run dev

# Visit: http://localhost:4000/graphql
```

### Production Deployment

```bash
# Build everything
npm run build

# Start production server
npm start
```

## Cross-Browser Compatibility

### Incognito/Private Mode Support

Our implementation handles browser-specific behaviors:

**Enhanced SSE Headers:**
```typescript
res.writeHead(200, {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
});
```

**Operation Detection Fallback:**
```typescript
// Enhanced regex fallback for edge cases
const patterns = [
  /^\s*(subscription)\s+\w+/i,
  /^\s*(subscription)\s*\{/i,
  /^\s*(subscription)\s*\(/i,
];
```

## User Experience Features

### Default Query Template

```graphql
# Welcome to WPGraphQL Subscriptions IDE!
# 
# This custom GraphiQL interface supports real-time GraphQL subscriptions.
# Try this example subscription:

subscription PostUpdated($id: ID!) {
  postUpdated(id: $id) {
    id
    title
    modified
    content
    author {
      node {
        name
      }
    }
  }
}

# Variables:
# { "id": "147" }

# After running the subscription, edit post 147 in WordPress
# to see real-time updates appear here!
```

### Spinner Behavior

- **Native GraphiQL spinner** shows during initial connection
- **Immediate error display** for validation failures
- **Real-time updates** once subscription is established

### Error Handling

- **Validation errors** display immediately without SSE connection
- **Network errors** show proper HTTP status messages
- **Syntax errors** highlight specific issues in the query

## Performance Optimizations

### Bundle Optimization

- **Code splitting** - Separate chunks for better caching
- **Tree shaking** - Only include used GraphiQL components
- **Minification** - Production builds are optimized
- **Source maps** - Available for debugging

### Caching Strategy

```typescript
res.writeHead(200, {
  'Content-Type': 'application/javascript',
  'Cache-Control': 'public, max-age=31536000', // 1 year cache
});
```

## Testing Strategy

### Manual Testing Checklist

- [ ] GraphiQL loads without errors
- [ ] Syntax validation works for invalid queries
- [ ] Variable validation catches missing required variables
- [ ] Operation type validation rejects queries/mutations
- [ ] SSE subscriptions establish correctly
- [ ] Real-time updates display properly
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari)
- [ ] Incognito/private mode functionality

### Automated Testing

```bash
# Unit tests for validation logic
npm run test

# Integration tests for GraphiQL endpoint
npm run test:integration

# E2E tests for subscription workflow
npm run test:e2e
```

## Troubleshooting

### Common Issues

**GraphiQL Bundle Not Found:**
```
GraphiQL Loading Error - The custom GraphiQL bundle could not be loaded
```
**Solution:** Run `npm run build:graphiql` then restart server

**Validation Errors Not Displaying:**
- Check browser console for JavaScript errors
- Verify GraphiQL bundle is loading correctly
- Ensure server validation is working

**SSE Connection Issues:**
- Verify `Accept: text/event-stream` header is sent
- Check server logs for connection establishment
- Test with simple curl command

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Check GraphiQL console logs
# Open browser dev tools → Console
```

## Future Enhancements

### Planned Features

1. **Connection Status Indicator** - Show real-time connection state
2. **Event History** - Display previous subscription events
3. **Subscription Templates** - Pre-built common subscriptions
4. **Performance Metrics** - Show latency and event counts
5. **Dark Mode Support** - Theme customization options

### Extension Points

- **Custom CSS themes** via webpack configuration
- **Additional validation rules** in server validation
- **Custom error messages** for specific use cases
- **Integration with GraphiQL plugins** for enhanced features

This custom GraphiQL implementation provides a robust, production-ready interface specifically optimized for GraphQL subscriptions with excellent developer experience! 🚀