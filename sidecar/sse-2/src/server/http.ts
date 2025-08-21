/**
 * HTTP Server implementation with content negotiation
 * Handles GraphQL requests, GraphiQL IDE, and SSE subscriptions
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import type { Logger } from 'pino';
import type { ServerConfig, ContentNegotiation, GraphQLRequest } from '../types/index.js';
import { generateRequestId, createRequestLogger } from '../logger/index.js';

export class HTTPServer {
  private server: ReturnType<typeof createServer>;
  private logger: Logger;
  private config: ServerConfig;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.server = createServer(this.handleRequest.bind(this));
    
    // Server event handlers
    this.server.on('listening', () => {
      this.logger.info({
        port: this.config.port,
        host: this.config.host,
      }, 'HTTP server listening');
    });

    this.server.on('error', (error) => {
      this.logger.error({ error }, 'HTTP server error');
    });

    this.server.on('close', () => {
      this.logger.info('HTTP server closed');
    });
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  /**
   * Main request handler with content negotiation
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = generateRequestId();
    const requestLogger = createRequestLogger(this.logger, {
      requestId,
      method: req.method || 'UNKNOWN',
      url: req.url || '/',
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : undefined,
    });

    const startTime = Date.now();
    requestLogger.info('Request received');

    try {
      // Add CORS headers
      this.addCORSHeaders(res);

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Parse URL
      const parsedUrl = parseUrl(req.url || '/', true);
      
      // Only handle /graphql endpoint
      if (parsedUrl.pathname !== '/graphql') {
        this.sendNotFound(res, requestLogger);
        return;
      }

      // Determine content negotiation
      const negotiation = this.determineContentNegotiation(req);
      
      // Route based on content negotiation
      if (negotiation.method === 'GET' && negotiation.acceptsHtml) {
        // Serve GraphiQL IDE
        await this.handleGraphiQL(req, res, requestLogger);
      } else if (negotiation.method === 'POST' && negotiation.acceptsJson) {
        // Handle introspection queries
        await this.handleIntrospection(req, res, requestLogger);
      } else if (negotiation.method === 'POST' && negotiation.acceptsEventStream) {
        // Handle SSE subscriptions
        await this.handleSSESubscription(req, res, requestLogger);
      } else {
        // Unsupported request
        this.sendMethodNotAllowed(res, requestLogger, negotiation);
      }

    } catch (error) {
      requestLogger.error({ error }, 'Request error');
      this.sendInternalServerError(res, error);
    } finally {
      const duration = Date.now() - startTime;
      requestLogger.info({ duration }, 'Request completed');
    }
  }

  /**
   * Determine content negotiation from request
   */
  private determineContentNegotiation(req: IncomingMessage): ContentNegotiation {
    const method = (req.method?.toUpperCase() || 'GET') as 'GET' | 'POST' | 'OPTIONS';
    const accept = req.headers.accept || '';
    
    return {
      method,
      acceptsHtml: accept.includes('text/html'),
      acceptsJson: accept.includes('application/json'),
      acceptsEventStream: accept.includes('text/event-stream'),
    };
  }

  /**
   * Add CORS headers to response
   */
  private addCORSHeaders(res: ServerResponse): void {
    const origin = this.config.corsOrigin.join(', ');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  /**
   * Handle GraphiQL IDE requests (GET + text/html)
   */
  private async handleGraphiQL(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
    logger.info('Serving GraphiQL IDE');
    
    // TODO: Implement GraphiQL HTML template
    const graphiqlHtml = this.generateGraphiQLHTML();
    
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(graphiqlHtml),
    });
    res.end(graphiqlHtml);
  }

  /**
   * Handle introspection queries (POST + application/json)
   */
  private async handleIntrospection(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
    logger.info('Handling introspection request');
    
    try {
      // Parse request body
      const body = await this.parseRequestBody(req);
      const graphqlRequest: GraphQLRequest = JSON.parse(body);
      
      // TODO: Implement introspection proxy to WPGraphQL
      logger.debug({ query: graphqlRequest.query }, 'Introspection query received');
      
      // Placeholder response
      const response = {
        data: null,
        errors: [{
          message: 'Introspection not yet implemented',
          extensions: { code: 'NOT_IMPLEMENTED' }
        }]
      };
      
      this.sendJSON(res, response);
      
    } catch (error) {
      logger.error({ error }, 'Introspection error');
      this.sendGraphQLError(res, 'Failed to process introspection request');
    }
  }

  /**
   * Handle SSE subscription requests (POST + text/event-stream)
   */
  private async handleSSESubscription(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
    logger.info('Handling SSE subscription request');
    
    try {
      // Parse request body
      const body = await this.parseRequestBody(req);
      const graphqlRequest: GraphQLRequest = JSON.parse(body);
      
      // TODO: Implement subscription validation and SSE streaming
      logger.debug({ query: graphqlRequest.query }, 'Subscription query received');
      
      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
      });
      
      // Send connection acknowledgment
      res.write('event: connection_ack\n');
      res.write('data: {"type":"connection_ack"}\n\n');
      
      // TODO: Implement subscription lifecycle
      // For now, just keep connection alive
      const keepAlive = setInterval(() => {
        res.write('event: ping\n');
        res.write('data: {"type":"ping"}\n\n');
      }, 30000);
      
      // Handle client disconnect
      req.on('close', () => {
        logger.info('SSE connection closed');
        clearInterval(keepAlive);
      });
      
    } catch (error) {
      logger.error({ error }, 'SSE subscription error');
      this.sendGraphQLError(res, 'Failed to process subscription request');
    }
  }

  /**
   * Parse request body as string
   */
  private async parseRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  /**
   * Generate GraphiQL HTML template
   */
  private generateGraphiQLHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GraphiQL - WPGraphQL Subscriptions</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
</head>
<body style="margin: 0; height: 100vh;">
  <div id="graphiql" style="height: 100vh;"></div>
  
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  
  <script>
    // Custom fetcher for GraphiQL with SSE subscription support
    function createCustomFetcher() {
      return async function fetcher(graphQLParams, opts) {
        const { query, variables, operationName } = graphQLParams;
        
        // Check if this is a subscription
        const isSubscription = query.trim().toLowerCase().startsWith('subscription');
        
        if (isSubscription) {
          // Handle subscription via SSE
          return new Promise((resolve, reject) => {
            const eventSource = new EventSource('/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
              },
              body: JSON.stringify({ query, variables, operationName }),
            });
            
            eventSource.onmessage = function(event) {
              try {
                const data = JSON.parse(event.data);
                resolve(data);
              } catch (e) {
                reject(e);
              }
            };
            
            eventSource.onerror = function(error) {
              reject(error);
            };
          });
        } else {
          // Handle queries and mutations via regular fetch
          const response = await fetch('/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ query, variables, operationName }),
          });
          
          return await response.json();
        }
      };
    }
    
    // Initialize GraphiQL
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    root.render(
      React.createElement(GraphiQL, {
        fetcher: createCustomFetcher(),
        defaultQuery: \`# Welcome to GraphiQL for WPGraphQL Subscriptions!
# 
# This server only supports GraphQL subscriptions.
# Queries and mutations will be rejected.
#
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
\`,
        variables: JSON.stringify({ id: "147" }, null, 2),
      })
    );
  </script>
</body>
</html>`;
  }

  /**
   * Send JSON response
   */
  private sendJSON(res: ServerResponse, data: any): void {
    const json = JSON.stringify(data);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  /**
   * Send GraphQL error response
   */
  private sendGraphQLError(res: ServerResponse, message: string): void {
    this.sendJSON(res, {
      data: null,
      errors: [{ message }],
    });
  }

  /**
   * Send 404 Not Found
   */
  private sendNotFound(res: ServerResponse, logger: Logger): void {
    logger.warn('Not found');
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  /**
   * Send 405 Method Not Allowed
   */
  private sendMethodNotAllowed(res: ServerResponse, logger: Logger, negotiation: ContentNegotiation): void {
    logger.warn({ negotiation }, 'Method not allowed');
    res.writeHead(405, { 
      'Content-Type': 'application/json',
      'Allow': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify({
      error: 'Method Not Allowed',
      message: 'This endpoint supports: GET (GraphiQL), POST + application/json (introspection), POST + text/event-stream (subscriptions)',
      received: negotiation,
    }));
  }

  /**
   * Send 500 Internal Server Error
   */
  private sendInternalServerError(res: ServerResponse, error: unknown): void {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}
