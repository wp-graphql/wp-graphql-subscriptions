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

    try {
      // Initialize Redis connection
      logger.info('Initializing Redis connection...');
      await this.redisClient.connect();
      logger.info('Redis connected successfully');

      // Get initial schema from WPGraphQL
      logger.info(`Attempting to introspect WPGraphQL at: ${appConfig.wpgraphql.endpoint}`);
      const wpSchema = await this.schemaIntrospector.getSchema();
      logger.info('WPGraphQL schema loaded successfully');

      // Transform schema to add executable subscription resolvers only
      // Queries and mutations will be handled by onRequest plugin
      logger.info('Transforming schema to add executable subscription resolvers...');
      const transformedSchema = this.schemaTransformer.transform(wpSchema);
      logger.info('Schema transformation complete');

      // Create Yoga server with hybrid approach:
      // - Transformed schema for subscription execution
      // - onRequest plugin for query/mutation proxying
      const yoga = createYoga({
        schema: transformedSchema,
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
              // Intercept POST requests that contain GraphQL operations
              if (request.method === 'POST') {
                let body;
                try {
                  body = await request.json();
                } catch (error) {
                  // Not JSON, not a GraphQL request, let it pass through
                  return;
                }

                const { query, variables, operationName } = body;

                // Check if this is actually a GraphQL request
                if (!query || typeof query !== 'string') {
                  // Not a GraphQL request, let it pass through
                  return;
                }

                // Check if this is a subscription operation
                if (isSubscriptionOperation(query)) {
                  // Let subscriptions pass through to our custom handlers (Phase 1.4)
                  logger.debug('Subscription detected, letting it pass through to custom handlers');
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
