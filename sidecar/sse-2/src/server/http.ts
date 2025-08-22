/**
 * HTTP Server implementation with content negotiation
 * Handles GraphQL requests, GraphiQL IDE, and SSE subscriptions
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parse, validate, buildSchema, getOperationAST } from 'graphql';
import type { Logger } from 'pino';
import type { ServerConfig, ContentNegotiation, GraphQLRequest } from '../types/index.js';
import { generateRequestId, createRequestLogger } from '../logger/index.js';
import { RedisClient } from '../redis/client.js';
import { SubscriptionManager } from '../subscription/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class HTTPServer {
  private server: ReturnType<typeof createServer>;
  private logger: Logger;
  private config: ServerConfig;
  private redisClient: RedisClient;
  private subscriptionManager: SubscriptionManager;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.server = createServer(this.handleRequest.bind(this));
    
    // Initialize Redis client and subscription manager
    this.redisClient = new RedisClient(config, logger);
    this.subscriptionManager = new SubscriptionManager(this.redisClient, config, logger);
    
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
    // Connect to Redis first
    await this.redisClient.connect();
    
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
    // Clean up subscriptions and disconnect from Redis
    await this.subscriptionManager.cleanup();
    await this.redisClient.disconnect();
    
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
      
      // Determine content negotiation
      const negotiation = this.determineContentNegotiation(req);
      
      // Route to appropriate handler
      if (parsedUrl.pathname === '/graphql') {
        // Handle GraphQL endpoint
        await this.handleGraphQLEndpoint(req, res, requestLogger, parsedUrl, negotiation);
      } else if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {
        // Handle WordPress webhook events
        await this.handleWebhookEvent(req, res, requestLogger);
      } else if (parsedUrl.pathname?.startsWith('/static/') || parsedUrl.pathname?.endsWith('.js') || parsedUrl.pathname?.endsWith('.map')) {
        // Handle static files (GraphiQL bundle)
        await this.handleStaticFile(req, res, requestLogger, parsedUrl.pathname);
      } else {
        this.sendNotFound(res, requestLogger);
        return;
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
   * Handle static file requests (JS, CSS, maps)
   */
  private async handleStaticFile(req: IncomingMessage, res: ServerResponse, logger: Logger, pathname: string): Promise<void> {
    try {
      const publicDir = join(__dirname, '../../dist/public');
      const filename = pathname.replace(/^\/static\//, '').replace(/^\//, '');
      const filePath = join(publicDir, filename);

      // Security check - ensure file is within public directory
      if (!filePath.startsWith(publicDir)) {
        this.sendNotFound(res, logger);
        return;
      }

      // Check if file exists
      await stat(filePath);

      // Read file
      const content = await readFile(filePath);

      // Determine content type
      const ext = extname(filePath).toLowerCase();
      const contentType = this.getContentType(ext);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      });
      res.end(content);

      logger.debug({ pathname, filePath, contentType }, 'Served static file');

    } catch (error) {
      logger.warn({ pathname, error }, 'Static file not found');
      this.sendNotFound(res, logger);
    }
  }

  /**
   * Get content type for file extension
   */
  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      '.js': 'application/javascript',
      '.map': 'application/json',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
    };
    return types[ext] || 'application/octet-stream';
  }

  /**
   * Handle GraphiQL IDE requests (GET + text/html)
   */
  private async handleGraphiQL(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
    logger.info('Serving custom GraphiQL IDE');

    // Serve the built GraphiQL HTML
    const graphiqlHtml = await this.loadCustomGraphiQLHTML();
    
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
      
      // Forward headers for authentication
      const forwardHeaders: Record<string, string> = {};
      if (req.headers.authorization) {
        forwardHeaders.authorization = req.headers.authorization;
      }
      if (req.headers.cookie) {
        forwardHeaders.cookie = req.headers.cookie;
      }
      
      // Use the extracted introspection logic
      await this.handleIntrospectionQuery(graphqlRequest, res, logger, forwardHeaders);
      
    } catch (error) {
      logger.error({ error }, 'Introspection error');
      this.sendGraphQLError(res, 'Failed to process introspection request');
    }
  }

  /**
   * Handle SSE subscription requests from query parameters (GET + text/event-stream)
   */
  private async handleSSESubscriptionFromQuery(req: IncomingMessage, res: ServerResponse, logger: Logger, parsedUrl: any): Promise<void> {
    logger.info('Handling SSE subscription request from query parameters');
    
    try {
      // Extract GraphQL request from query parameters
      const query = parsedUrl.query?.query;
      const variables = parsedUrl.query?.variables ? JSON.parse(parsedUrl.query.variables) : undefined;
      const operationName = parsedUrl.query?.operationName;
      
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          errors: [{
            message: 'Missing query parameter',
            extensions: { code: 'MISSING_QUERY' }
          }]
        }));
        return;
      }
      
      const graphqlRequest = { query, variables, operationName };
      
      // Capture headers for authentication
      const requestHeaders: Record<string, string> = {};
      if (req.headers.cookie) {
        requestHeaders.cookie = req.headers.cookie;
      }
      if (req.headers.authorization) {
        requestHeaders.authorization = req.headers.authorization;
      }
      
      await this.processSSESubscription(graphqlRequest, res, logger, requestHeaders);
      
    } catch (error) {
      logger.error({ error }, 'SSE subscription from query error');
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{
          message: 'Failed to process subscription request',
          extensions: { code: 'INTERNAL_ERROR' }
        }]
      }));
    }
  }

  /**
   * Handle SSE subscriptions with pre-parsed body
   */
  private async handleSSESubscriptionWithBody(body: string, res: ServerResponse, logger: Logger): Promise<void> {
    try {
      const graphqlRequest: GraphQLRequest = JSON.parse(body);
      await this.processSSESubscription(graphqlRequest, res, logger);
    } catch (error) {
      logger.error({ error }, 'Failed to parse GraphQL request for SSE subscription');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{
          message: 'Invalid GraphQL request',
          extensions: { code: 'INVALID_REQUEST' }
        }]
      }));
    }
  }

  /**
   * Handle introspection query with GraphQL request object
   */
  private async handleIntrospectionQuery(graphqlRequest: GraphQLRequest, res: ServerResponse, logger: Logger, forwardHeaders: Record<string, string>): Promise<void> {
    try {
      logger.debug({ query: graphqlRequest.query?.substring(0, 100) + '...' }, 'Proxying request to WPGraphQL');
      
      // Proxy to WPGraphQL
      const { WPGraphQLClient } = await import('../graphql/client.js');
      const client = new WPGraphQLClient(this.config, logger);
      const response = await client.executeRequest(graphqlRequest, forwardHeaders);
      
      this.sendJSON(res, response);
    } catch (error) {
      logger.error({ error }, 'Introspection query error');
      this.sendGraphQLError(res, 'Failed to process introspection request');
    }
  }

  /**
   * Handle introspection queries with pre-parsed body
   */
  private async handleIntrospectionWithBody(body: string, res: ServerResponse, logger: Logger): Promise<void> {
    try {
      const graphqlRequest: GraphQLRequest = JSON.parse(body);
      // Process as regular GraphQL query (not SSE) - delegate to existing introspection handler
      logger.info('Handling introspection request with pre-parsed body');
      
      // Use the extracted introspection logic
      await this.handleIntrospectionQuery(graphqlRequest, res, logger, {});
    } catch (error) {
      logger.error({ error }, 'Failed to parse GraphQL request for introspection');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{
          message: 'Invalid GraphQL request',
          extensions: { code: 'INVALID_REQUEST' }
        }]
      }));
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
      
      // Capture headers for authentication
      const requestHeaders: Record<string, string> = {};
      if (req.headers.cookie) {
        requestHeaders.cookie = req.headers.cookie;
      }
      if (req.headers.authorization) {
        requestHeaders.authorization = req.headers.authorization;
      }
      
      await this.processSSESubscription(graphqlRequest, res, logger, requestHeaders);
      
    } catch (error) {
      logger.error({ error }, 'SSE subscription error');
      
      // Send error response
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{
          message: 'Failed to process subscription request',
          extensions: { code: 'INTERNAL_ERROR' }
        }]
      }));
    }
  }

  /**
   * Validate GraphQL subscription before processing
   */
  private async validateSubscription(graphqlRequest: GraphQLRequest): Promise<{ isValid: boolean; errors?: any[] }> {
    try {
      // Parse the query to check syntax
      const document = parse(graphqlRequest.query);
      
      // Get the operation AST
      const operationAST = getOperationAST(document, graphqlRequest.operationName);
      
      if (!operationAST) {
        return {
          isValid: false,
          errors: [{
            message: `Operation "${graphqlRequest.operationName || 'unnamed'}" not found in query`,
            locations: []
          }]
        };
      }
      
      if (operationAST.operation !== 'subscription') {
        return {
          isValid: false,
          errors: [{
            message: `Operation must be a subscription, got ${operationAST.operation}`,
            locations: []
          }]
        };
      }

      // Check for required variables
      const variableDefinitions = operationAST.variableDefinitions || [];
      const providedVariables = graphqlRequest.variables || {};
      
      const missingVariables: string[] = [];
      
      for (const varDef of variableDefinitions) {
        const varName = varDef.variable.name.value;
        const isRequired = varDef.type.kind === 'NonNullType';
        
        if (isRequired && !(varName in providedVariables)) {
          missingVariables.push(varName);
        }
      }
      
      if (missingVariables.length > 0) {
        return {
          isValid: false,
          errors: missingVariables.map(varName => ({
            message: `Variable "$${varName}" of required type was not provided.`,
            locations: []
          }))
        };
      }
      
      return { isValid: true };
      
    } catch (error) {
      return {
        isValid: false,
        errors: [{
          message: `GraphQL syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          locations: []
        }]
      };
    }
  }

  /**
   * Process SSE subscription (shared logic for GET and POST)
   */
  private async processSSESubscription(
    graphqlRequest: GraphQLRequest, 
    res: ServerResponse, 
    logger: Logger, 
    requestHeaders?: Record<string, string>
  ): Promise<void> {
    // Validate the subscription before processing
    const validation = await this.validateSubscription(graphqlRequest);
    
    if (!validation.isValid) {
      logger.warn({ errors: validation.errors }, 'Subscription validation failed');
      
      // Send validation error as JSON response
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Cookie',
        'Access-Control-Allow-Credentials': 'true',
      });
      
      res.end(JSON.stringify({
        errors: validation.errors
      }));
      
      return;
    }

    logger.info('Subscription validation passed, establishing SSE connection');
    
    // Set up SSE headers with enhanced compatibility for incognito mode
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Cookie',
      'Access-Control-Allow-Credentials': 'true',
    });
    
    // Send initial connection event with explicit flush for incognito compatibility
    res.write('retry: 10000\n'); // Set retry interval
    res.write('event: next\n');
    res.write('data: {"data":{"message":"Subscription established - waiting for events..."}}\n\n');
    
    // Force flush the initial event for incognito browsers
    if ('flush' in res && typeof res.flush === 'function') {
      (res as any).flush();
    }
    
    // Generate unique subscription ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Create subscription with the manager, including request context
      await this.subscriptionManager.createSubscription(
        subscriptionId,
        graphqlRequest,
        res,
        requestHeaders ? { headers: requestHeaders } : undefined
      );
      
      logger.info({ subscriptionId }, 'Subscription created successfully');
      
    } catch (subscriptionError) {
      logger.error({ subscriptionError, subscriptionId }, 'Failed to create subscription');
      
      // Send error and complete
      res.write('event: next\n');
      res.write(`data: {"errors":[{"message":"Failed to create subscription: ${subscriptionError instanceof Error ? subscriptionError.message : 'Unknown error'}"}]}\n\n`);
      res.write('event: complete\n');
      res.write('data: \n\n');
      res.end();
      return;
    }
    
    // Handle client disconnect
    res.on('close', () => {
      logger.info({ subscriptionId }, 'SSE connection closed by client');
      this.subscriptionManager.removeSubscription(subscriptionId);
    });
    
    res.on('error', (error) => {
      logger.error({ error, subscriptionId }, 'SSE connection error');
      this.subscriptionManager.removeSubscription(subscriptionId);
    });
  }

  /**
   * Check if a request contains a subscription operation
   */
  private async isSubscriptionRequest(body: string, logger: Logger): Promise<boolean> {
    try {
      const data = JSON.parse(body);
      const query = data.query || '';
      
      // More precise check for subscription operation
      const trimmedQuery = query.trim().toLowerCase();
      
      // Check if it starts with 'subscription' keyword (ignoring whitespace and comments)
      const cleanQuery = trimmedQuery.replace(/^\s*#.*$/gm, '').trim();
      const isSubscription = /^\s*subscription\s+/i.test(cleanQuery);
      
      logger.debug({ isSubscription, queryStart: cleanQuery.substring(0, 50) }, 'Subscription detection');
      
      return isSubscription;
    } catch (error) {
      logger.debug({ error }, 'Failed to parse request body for subscription check');
      return false;
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
   * Load custom GraphiQL HTML from built bundle
   */
  private async loadCustomGraphiQLHTML(): Promise<string> {
    try {
      const htmlPath = join(__dirname, '../../dist/public/graphiql.html');
      const html = await readFile(htmlPath, 'utf-8');
      return html;
    } catch (error) {
      this.logger.error({ error }, 'Failed to load custom GraphiQL HTML');
      // Fallback to simple HTML
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WPGraphQL Subscriptions IDE - Loading Error</title>
</head>
<body>
  <div style="padding: 20px; font-family: Arial, sans-serif;">
    <h1>GraphiQL Loading Error</h1>
    <p>The custom GraphiQL bundle could not be loaded. Please run:</p>
    <code>npm run build:graphiql</code>
    <p>Then restart the server.</p>
  </div>
</body>
</html>`;
    }
  }

  /**
   * Generate GraphiQL HTML template (DEPRECATED - kept for fallback)
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
  <script src="https://unpkg.com/graphql@16/graphql.min.js"></script>
  <script src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  
  <script>
    // Custom fetcher for GraphiQL with SSE subscription support
    function createCustomFetcher() {
      console.log('GraphiQL: Custom fetcher created');
      
      return async function fetcher(graphQLParams, opts) {
        console.log('GraphiQL: Fetcher called with:', { graphQLParams, opts });
        console.log('GraphiQL: Browser context:', {
          userAgent: navigator.userAgent,
          isIncognito: !window.indexedDB || !window.localStorage,
          location: window.location.href
        });
        
        const { query, variables, operationName } = graphQLParams;
        
        console.log('GraphiQL: Raw query:', JSON.stringify(query));
        console.log('GraphiQL: Operation name:', operationName);
        
        // Parse the query using GraphQL AST (much more robust than regex)
        let operationType = 'query'; // default
        try {
          console.log('GraphiQL: Parsing query with GraphQL AST...');
          console.log('GraphiQL: GraphQL available:', typeof GraphQL);
          
          // Use GraphQL's parse function to create AST
          const ast = GraphQL.parse(query);
          console.log('GraphiQL: AST parsed successfully');
          
          // Find the operation definition
          const operationDef = ast.definitions.find(def => 
            def.kind === 'OperationDefinition'
          );
          
          if (operationDef) {
            operationType = operationDef.operation;
            console.log('GraphiQL: Operation type from AST:', operationType);
            
            // Also log the operation name from AST if available
            if (operationDef.name) {
              console.log('GraphiQL: Operation name from AST:', operationDef.name.value);
            }
          } else {
            console.warn('GraphiQL: No operation definition found in AST');
          }
          
        } catch (parseError) {
          console.error('GraphiQL: GraphQL parse error:', parseError);
          console.log('GraphiQL: Falling back to enhanced regex detection...');
          
          // Enhanced regex fallback - more robust than before
          try {
            const trimmed = query.trim();
            
            // Remove comments and try to find operation type
            const commentStripped = trimmed.replace(/^\\s*#[^\\n]*\\n/gm, '').trim();
            
            // Try multiple patterns
            const patterns = [
              /^\\s*(query|mutation|subscription)\\s+\\w+/i,  // with operation name
              /^\\s*(query|mutation|subscription)\\s*\\{/i,    // anonymous
              /^\\s*(query|mutation|subscription)\\s*\\(/i,    // with variables
            ];
            
            for (const pattern of patterns) {
              const match = commentStripped.match(pattern);
              if (match) {
                operationType = match[1].toLowerCase();
                console.log('GraphiQL: Enhanced regex detected:', operationType, 'with pattern:', pattern);
                break;
              }
            }
            
            // Final fallback: check operation name
            if (operationType === 'query' && operationName && operationName.toLowerCase().includes('subscription')) {
              operationType = 'subscription';
              console.log('GraphiQL: Detected subscription from operation name:', operationName);
            }
            
          } catch (regexError) {
            console.error('GraphiQL: Enhanced regex fallback failed:', regexError);
            
            // Last resort: simple string search
            if (query.toLowerCase().includes('subscription')) {
              operationType = 'subscription';
              console.log('GraphiQL: Final fallback - found "subscription" in query text');
            }
          }
        }
        
        if (operationType === 'subscription') {
          // Handle subscription via SSE - return async generator that works in both modes
          console.log('GraphiQL: Setting up subscription');
          
          return (async function* () {
            console.log('GraphiQL: Starting async generator');
            console.log('GraphiQL: Browser info:', {
              userAgent: navigator.userAgent,
              isIncognito: !window.indexedDB || !window.localStorage,
              hasEventSource: !!window.EventSource
            });
            
            let reader;
            let isActive = true;
            let eventCount = 0;
            
            try {
              console.log('GraphiQL: Making fetch request...');
              const response = await fetch('/graphql', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                },
                body: JSON.stringify({ query, variables, operationName }),
              });
              
              console.log('GraphiQL: Response status:', response.status, response.statusText);
              console.log('GraphiQL: Response headers:', Object.fromEntries(response.headers.entries()));
              
              if (!response.ok) {
                throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
              }
              
              reader = response.body.getReader();
              const decoder = new TextDecoder();
              
              console.log('GraphiQL: SSE connection established, starting to read...');
              
              while (isActive) {
                const { done, value } = await reader.read();
                
                if (done) {
                  console.log('GraphiQL: SSE stream ended after', eventCount, 'events');
                  break;
                }
                
                const text = decoder.decode(value, { stream: true });
                console.log('GraphiQL: Raw SSE chunk:', JSON.stringify(text));
                const lines = text.split('\\n');
                
                for (const line of lines) {
                  if (line.startsWith('data: ') && line.length > 6) {
                    try {
                      const dataStr = line.substring(6);
                      console.log('GraphiQL: Parsing SSE data:', dataStr);
                      const data = JSON.parse(dataStr);
                      
                      // Skip the initial "Subscription established" message to keep spinner
                      if (data.data && data.data.message && data.data.message.includes('Subscription established')) {
                        console.log('GraphiQL: Skipping initial connection message to maintain spinner');
                        continue;
                      }
                      
                      eventCount++;
                      console.log('GraphiQL: Event #' + eventCount + ', yielding data:', data);
                      yield data;
                    } catch (e) {
                      console.warn('GraphiQL: Failed to parse SSE data:', line, e);
                    }
                  } else if (line.trim()) {
                    console.log('GraphiQL: Non-data SSE line:', JSON.stringify(line));
                  }
                }
              }
              
            } catch (error) {
              console.error('GraphiQL: Subscription error:', error);
              throw error;
            } finally {
              isActive = false;
              if (reader) {
                try {
                  await reader.cancel();
                  console.log('GraphiQL: SSE connection cleaned up');
                } catch (e) {
                  console.warn('GraphiQL: Error during cleanup:', e);
                }
              }
            }
          })();
        } else {
          // Handle queries and mutations via regular fetch to WPGraphQL
          const response = await fetch('/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ query, variables, operationName }),
          });
          
          if (!response.ok) {
            throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
          }
          
          return await response.json();
        }
      };
    }
    
    // Initialize GraphiQL
    console.log('GraphiQL: Initializing GraphiQL component');
    console.log('GraphiQL: React version:', React.version);
    console.log('GraphiQL: ReactDOM available:', !!ReactDOM);
    console.log('GraphiQL: GraphiQL constructor available:', !!GraphiQL);
    
    const customFetcher = createCustomFetcher();
    console.log('GraphiQL: Custom fetcher created:', typeof customFetcher);
    
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    root.render(
      React.createElement(GraphiQL, {
        fetcher: customFetcher,
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
      message: 'This endpoint supports: GET (GraphiQL or SSE subscriptions), POST + application/json (introspection), POST + text/event-stream (subscriptions)',
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

  /**
   * Handle GraphQL endpoint with content negotiation
   */
  private async handleGraphQLEndpoint(
    req: IncomingMessage, 
    res: ServerResponse, 
    logger: Logger, 
    parsedUrl: any, 
    negotiation: ContentNegotiation
  ): Promise<void> {
    // Route based on content negotiation
    if (negotiation.method === 'GET' && negotiation.acceptsHtml) {
      // Serve GraphiQL IDE
      await this.handleGraphiQL(req, res, logger);
    } else if (negotiation.method === 'GET' && negotiation.acceptsEventStream) {
      // Handle SSE subscriptions via GET (from GraphiQL)
      await this.handleSSESubscriptionFromQuery(req, res, logger, parsedUrl);
    } else if (negotiation.method === 'POST' && negotiation.acceptsEventStream) {
      // Handle SSE subscriptions via POST
      await this.handleSSESubscription(req, res, logger);
    } else if (negotiation.method === 'POST' && negotiation.acceptsJson) {
      // Check if this is a subscription operation first
      const body = await this.parseRequestBody(req);
      const isSubscription = await this.isSubscriptionRequest(body, logger);
      
      if (isSubscription) {
        // Handle SSE subscriptions via POST (recreate request with body)
        await this.handleSSESubscriptionWithBody(body, res, logger);
      } else {
        // Handle introspection queries (recreate request with body)
        await this.handleIntrospectionWithBody(body, res, logger);
      }
    } else {
      // Unsupported request
      this.sendMethodNotAllowed(res, logger, negotiation);
    }
  }

  /**
   * Handle WordPress webhook events
   */
  private async handleWebhookEvent(req: IncomingMessage, res: ServerResponse, logger: Logger): Promise<void> {
    logger.info('Handling WordPress webhook event');
    
    try {
      // Parse request body
      const body = await this.parseRequestBody(req);
      const eventData = JSON.parse(body);
      
      logger.info({ eventData }, 'Received WordPress event');

      // TODO: Validate webhook signature for security
      
      // Extract event information
      const { node_type, action, node_id, context, metadata } = eventData;
      
      if (!node_type || !action || !node_id) {
        logger.warn({ eventData }, 'Invalid webhook event - missing required fields');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Invalid event format',
          message: 'Missing required fields: node_type, action, node_id'
        }));
        return;
      }

      // Map WordPress event to subscription type
      const subscriptionType = this.mapWordPressEventToSubscription(node_type, action);
      if (!subscriptionType) {
        logger.warn({ node_type, action }, 'Unknown subscription type for WordPress event');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ignored', 
          reason: 'unknown_subscription_type' 
        }));
        return;
      }

      // Get Redis client (we'll need to initialize this in the constructor)
      if (!this.redisClient) {
        logger.error('Redis client not initialized');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Redis not available',
          message: 'Redis client not initialized'
        }));
        return;
      }

      // Build Redis channels (both specific and global)
      const { ChannelBuilder } = await import('../subscription/channels.js');
      const channels = ChannelBuilder.buildMultiple(subscriptionType, { id: node_id });
      
      logger.info({ subscriptionType, node_id, channels }, 'Publishing to Redis channels');
      
      // Create event payload for subscribers
      const subscriptionPayload = {
        id: String(node_id),
        action,
        timestamp: metadata?.timestamp || Date.now(),
        ...context
      };

      // Publish to all relevant channels
      let publishCount = 0;
      for (const channel of channels) {
        try {
          await this.redisClient.publish(channel, subscriptionPayload);
          publishCount++;
          logger.debug({ channel, payload: subscriptionPayload }, 'Published to Redis channel');
        } catch (error) {
          logger.error({ error, channel }, 'Failed to publish to Redis channel');
        }
      }

      // Send success response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        subscription_type: subscriptionType,
        channels_published: publishCount,
        total_channels: channels.length,
      }));

      logger.info({ 
        subscriptionType, 
        node_id, 
        publishCount, 
        totalChannels: channels.length 
      }, 'WordPress event processed successfully');

    } catch (error) {
      logger.error({ error }, 'Failed to process webhook event');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to process webhook event'
      }));
    }
  }

  /**
   * Map WordPress event to subscription type
   */
  private mapWordPressEventToSubscription(node_type: string, action: string): string | null {
    // Map WordPress events to GraphQL subscription names
    const eventMap: Record<string, Record<string, string>> = {
      'post': {
        'CREATE': 'postCreated',
        'UPDATE': 'postUpdated',
        'DELETE': 'postDeleted',
      },
      'user': {
        'CREATE': 'userCreated',
        'UPDATE': 'userUpdated',
        'DELETE': 'userDeleted',
      },
      'comment': {
        'CREATE': 'commentCreated',
        'UPDATE': 'commentUpdated',
        'DELETE': 'commentDeleted',
      },
    };

    return eventMap[node_type]?.[action] || null;
  }
}
