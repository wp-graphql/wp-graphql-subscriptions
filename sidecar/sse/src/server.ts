import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { print } from 'graphql';
import { appConfig } from './config.js';
import { isSubscriptionOperation } from './utils/graphql-utils.js';
import { SchemaIntrospector } from './schema/introspection.js';
import { SchemaTransformer } from './schema/transformer.js';
import { ProxyHandler } from './proxy/handler.js';
import { RedisClient } from './events/redis.js';
import { SubscriptionManager } from './subscription/manager.js';
import { ChannelBuilder } from './subscription/channels.js';
import logger from './logger.js';

class GraphQLYogaServer {
  private schemaIntrospector: SchemaIntrospector;
  private schemaTransformer: SchemaTransformer;
  private proxyHandler: ProxyHandler;
  private redisClient: RedisClient;
  private subscriptionManager: SubscriptionManager;

  constructor() {
    this.schemaIntrospector = new SchemaIntrospector();
    this.proxyHandler = new ProxyHandler();
    this.redisClient = new RedisClient();
    this.subscriptionManager = new SubscriptionManager(this.redisClient, this.proxyHandler);
    this.schemaTransformer = new SchemaTransformer(
      this.proxyHandler,
      this.redisClient,
      this.subscriptionManager
    );
  }

  async start() {
    logger.info('Starting GraphQL Yoga sidecar server...');
    logger.info({ 
      wpgraphqlEndpoint: appConfig.wpgraphql.endpoint,
      redisUrl: appConfig.redis.url,
      port: appConfig.server.port 
    }, 'Server configuration');

    try {
      // Initialize Redis connection
      logger.info('Initializing Redis connection...');
      await this.redisClient.connect();
      logger.info('Redis connected successfully');

      // Get initial schema from WPGraphQL
      logger.info(`Attempting to introspect WPGraphQL at: ${appConfig.wpgraphql.endpoint}`);
      const wpSchema = await this.schemaIntrospector.getSchema();
      logger.info('WPGraphQL schema loaded successfully');

      // Use the original WPGraphQL schema for introspection and GraphiQL
      // Subscriptions will be handled via dedicated SSE endpoint
      logger.info('Using original WPGraphQL schema for GraphiQL and introspection');

      // Create Yoga server for GraphiQL, introspection, and query/mutation proxying
      // Subscriptions will bypass Yoga entirely via /graphql/stream endpoint
      const yoga = createYoga({
        schema: wpSchema,
        context: async ({ request }) => {
          // Extract headers for authentication
          const headers: Record<string, string> = {};
          request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });

          return {
            headers,
            request,
            proxyHandler: this.proxyHandler,
            redisClient: this.redisClient,
            subscriptionManager: this.subscriptionManager,
          };
        },
        plugins: [
          {
                              onRequest: async ({ request, fetchAPI, endResponse }) => {
                    // Intercept both GET and POST requests that contain GraphQL operations
                    let query: string;
                    let variables: any = {};
                    let operationName: string | undefined;

                    if (request.method === 'POST') {
                      let body;
                      try {
                        body = await request.json();
                      } catch (error) {
                        // Not JSON, not a GraphQL request, let it pass through
                        return;
                      }
                      
                      query = body.query;
                      variables = body.variables || {};
                      operationName = body.operationName;
                    } else if (request.method === 'GET') {
                      // Handle GraphiQL GET requests
                      const url = new URL(request.url);
                      query = url.searchParams.get('query') || '';
                      
                      const variablesParam = url.searchParams.get('variables');
                      if (variablesParam) {
                        try {
                          variables = JSON.parse(variablesParam);
                        } catch (e) {
                          variables = {};
                        }
                      }
                      
                      operationName = url.searchParams.get('operationName') || undefined;
                    } else {
                      // Not a GraphQL request method, let it pass through
                      return;
                    }

                // Check if this is actually a GraphQL request
                if (!query || typeof query !== 'string') {
                  // Not a GraphQL request, let it pass through
                  return;
                }

                                                                    // Check if this is a subscription operation
                        if (isSubscriptionOperation(query)) {
                          // Redirect subscriptions to SSE endpoint
                          logger.info('Subscription detected, redirecting to SSE endpoint');
                          endResponse(new fetchAPI.Response(JSON.stringify({
                            errors: [{
                              message: 'Subscriptions must use Server-Sent Events. For GraphiQL, use a subscription-capable client or connect directly to /graphql/stream with Accept: text/event-stream header.',
                              extensions: {
                                code: 'SUBSCRIPTION_SSE_REQUIRED',
                                endpoint: '/graphql/stream',
                                instructions: {
                                  sse_endpoint: 'POST /graphql/stream',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Accept': 'text/event-stream'
                                  },
                                  body: {
                                    query: 'subscription { postUpdated(id: 1) { id title } }',
                                    variables: {}
                                  }
                                }
                              }
                            }]
                          }), {
                            status: 400,
                            headers: {
                              'Content-Type': 'application/json',
                            },
                          }));
                          return;
                        }

                // Check if this is an introspection query
                if (query.includes('__schema') || query.includes('__type') || operationName === 'IntrospectionQuery') {
                  // Let introspection queries pass through to Yoga's default handling
                  // This avoids compatibility issues with WPGraphQL's older GraphQL spec
                  logger.debug('Introspection query detected, letting Yoga handle it locally');
                  return;
                }

                try {
                  logger.debug('Intercepting query/mutation for proxying to WPGraphQL');

                  // Extract headers for authentication
                  const headers: Record<string, string> = {};
                  request.headers.forEach((value, key) => {
                    headers[key.toLowerCase()] = value;
                  });

                  // Forward the request to WPGraphQL
                  const response = await this.proxyHandler.handleRequest(
                    {
                      query,
                      variables: variables || {},
                      ...(operationName ? { operationName } : {}),
                    },
                    {
                      headers,
                    }
                  );

                  // Return the response directly
                  endResponse(
                    new fetchAPI.Response(JSON.stringify(response), {
                      status: 200,
                      headers: {
                        'Content-Type': 'application/json',
                      },
                    })
                  );
                } catch (error) {
                  logger.error({ error }, 'Request proxy failed');
                  endResponse(
                    new fetchAPI.Response(
                      JSON.stringify({
                        errors: [{
                          message: error instanceof Error ? error.message : 'Unknown proxy error',
                        }],
                      }),
                      {
                        status: 500,
                        headers: {
                          'Content-Type': 'application/json',
                        },
                      }
                    )
                  );
                }
            }
          }
        ],
        cors: appConfig.server.cors ? {
          origin: ['http://localhost:3000', 'http://localhost:8080'],
          credentials: true,
        } : false,
      });

      // Create HTTP server
      const server = createServer((req, res) => {
        // Handle WordPress webhook events
        if (req.url === '/webhook/subscription-event' && req.method === 'POST') {
          this.handleWebhookEvent(req, res);
          return;
        }
        
        // Handle SSE subscription endpoint
        if (req.url === '/graphql/stream' && req.method === 'POST') {
          this.handleSSESubscription(req, res);
          return;
        }
        
        // Handle all other requests with Yoga
        return yoga(req, res);
      });

      // Start server
      server.listen(appConfig.server.port, () => {
        logger.info(`🚀 GraphQL Yoga server running on http://localhost:${appConfig.server.port}/graphql`);
        logger.info(`📊 GraphiQL available at http://localhost:${appConfig.server.port}/graphql`);
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        logger.info('Received SIGINT, shutting down gracefully...');
        this.shutdown(server);
      });

      process.on('SIGTERM', () => {
        logger.info('Received SIGTERM, shutting down gracefully...');
        this.shutdown(server);
      });

    } catch (error) {
      logger.error({ error }, 'Failed to start server');
      process.exit(1);
    }
  }

  /**
   * Handle SSE subscription connections
   */
  private async handleSSESubscription(req: any, res: any) {
    try {
      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      // Parse subscription request
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { query, variables, operationName } = JSON.parse(body);
          
          if (!isSubscriptionOperation(query)) {
            res.write(`event: error\ndata: ${JSON.stringify({
              errors: [{ message: 'Only subscription operations are allowed on this endpoint' }]
            })}\n\n`);
            res.end();
            return;
          }

          logger.info({ query, variables, operationName }, '🔄 SSE: New subscription connection');

          // Generate unique subscription ID
          const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          // Store subscription in manager with SSE response for streaming
          await this.subscriptionManager.createSubscription(
            subscriptionId,
            query,
            variables || {},
            operationName,
            {
              headers: this.extractHeaders(req),
              ...(this.extractUserId(req) ? { userId: this.extractUserId(req) } : {}),
            },
            res // Pass SSE response for streaming
          );

          // Send confirmation
          res.write(`event: connection_ack\ndata: ${JSON.stringify({
            id: subscriptionId,
            type: 'connection_ack'
          })}\n\n`);

          // Keep connection alive
          const keepAlive = setInterval(() => {
            res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
          }, 30000);

          // Handle connection close
          req.on('close', async () => {
            clearInterval(keepAlive);
            await this.subscriptionManager.removeSubscription(subscriptionId);
            logger.info({ subscriptionId }, '🔌 SSE: Connection closed');
          });

        } catch (parseError) {
          logger.error({ parseError }, '❌ SSE: Failed to parse subscription request');
          res.write(`event: error\ndata: ${JSON.stringify({
            errors: [{ message: 'Invalid subscription request' }]
          })}\n\n`);
          res.end();
        }
      });

    } catch (error) {
      logger.error({ error }, '❌ SSE: Error handling subscription');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Internal server error' }] }));
    }
  }

  /**
   * Extract headers from request for authentication
   */
  private extractHeaders(req: any): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key.toLowerCase()] = value;
      }
    }
    return headers;
  }

  /**
   * Extract user ID from request (if available)
   */
  private extractUserId(req: any): string | undefined {
    // TODO: Extract user ID from JWT token or other auth mechanism
    return undefined;
  }

  /**
   * Handle WordPress webhook events and publish to Redis
   */
  private async handleWebhookEvent(req: any, res: any) {
    try {
      // Parse request body
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const eventData = JSON.parse(body);
          logger.info({ eventData }, 'Received WordPress subscription event');

          // Extract event information
          const { node_type, action, node_id, context, metadata } = eventData;
          
          // Determine subscription type and build channel name
          const subscriptionType = this.mapWordPressEventToSubscription(node_type, action);
          if (!subscriptionType) {
            logger.warn({ node_type, action }, 'Unknown subscription type for WordPress event');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ignored', reason: 'unknown_subscription_type' }));
            return;
          }

          // Build Redis channels (both specific and global)
          const channels = this.buildRedisChannels(subscriptionType, node_id);
          logger.info({ subscriptionType, node_id, channels }, '🔧 WEBHOOK: Built Redis channels for publishing');
          
          // Create event payload for subscribers
          const subscriptionPayload = {
            id: node_id,
            action,
            timestamp: metadata?.timestamp || Date.now(),
            ...context
          };

          // Publish to all relevant channels
          let publishCount = 0;
          for (const channel of channels) {
            try {
              logger.info({ channel, payload: subscriptionPayload }, '📡 WEBHOOK: Publishing to Redis channel');
              await this.redisClient.publish(channel, JSON.stringify(subscriptionPayload));
              publishCount++;
              logger.info({ channel, subscriptionType, node_id }, '✅ WEBHOOK: Successfully published event to Redis channel');
            } catch (publishError) {
              logger.error({ publishError, channel }, '❌ WEBHOOK: Failed to publish to Redis channel');
            }
          }

          logger.info({ 
            subscriptionType, 
            node_id, 
            channelsPublished: publishCount,
            totalChannels: channels.length 
          }, 'WordPress event processed and published to Redis');

          // Send success response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            status: 'success', 
            subscriptionType,
            channelsPublished: publishCount 
          }));

        } catch (parseError) {
          logger.error({ parseError, body }, 'Failed to parse webhook event body');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
        }
      });

    } catch (error) {
      logger.error({ error }, 'Error handling webhook event');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Internal server error' }));
    }
  }

  /**
   * Map WordPress event to GraphQL subscription type
   */
  private mapWordPressEventToSubscription(nodeType: string, action: string): string | null {
    const mapping: Record<string, Record<string, string>> = {
      'post': {
        'CREATE': 'postUpdated',
        'UPDATE': 'postUpdated',
        'DELETE': 'postUpdated'
      },
      'comment': {
        'CREATE': 'commentUpdated',
        'UPDATE': 'commentUpdated',
        'DELETE': 'commentUpdated'
      },
      'user': {
        'CREATE': 'userUpdated',
        'UPDATE': 'userUpdated',
        'DELETE': 'userUpdated'
      }
    };

    return mapping[nodeType]?.[action] || null;
  }

  /**
   * Build Redis channel names for the event using the same logic as subscription resolvers
   */
  private buildRedisChannels(subscriptionType: string, nodeId: number): string[] {
    // Use ChannelBuilder to ensure consistency with subscription resolvers
    const globalChannel = ChannelBuilder.build(subscriptionType); // No args = global
    const specificChannel = ChannelBuilder.build(subscriptionType, { id: nodeId }); // With ID arg
    
    return [globalChannel, specificChannel];
  }

  private async shutdown(server: any) {
    logger.info('Shutting down server and connections...');
    
    try {
      // Close HTTP server
      await new Promise<void>((resolve) => {
        server.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });

      // Close Redis connection
      await this.redisClient.disconnect();
      logger.info('Redis connection closed');

      // Close subscription manager
      await this.subscriptionManager.shutdown();
      logger.info('Subscription manager shut down');

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  }
}

// Start the server
const server = new GraphQLYogaServer();
server.start().catch((error) => {
  logger.error({ error }, 'Unhandled server startup error');
  process.exit(1);
});
