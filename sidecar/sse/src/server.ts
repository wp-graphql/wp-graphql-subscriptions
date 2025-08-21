import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { print } from 'graphql';
import { appConfig } from './config.js';
import { isSubscriptionOperation } from './utils/graphql-utils.js';
import { SchemaIntrospector } from './schema/introspection.js';
import { SchemaTransformer } from './schema/transformer.js';
import { ProxyHandler } from './proxy/handler.js';
import logger from './logger.js';

class GraphQLYogaServer {
  private schemaIntrospector: SchemaIntrospector;
  private schemaTransformer: SchemaTransformer;
  private proxyHandler: ProxyHandler;

  constructor() {
    this.schemaIntrospector = new SchemaIntrospector();
    this.proxyHandler = new ProxyHandler();
    this.schemaTransformer = new SchemaTransformer(this.proxyHandler);
  }

  async start() {
    logger.info('Starting GraphQL Yoga sidecar server...');

    try {
      // Get initial schema from WPGraphQL
      logger.info(`Attempting to introspect WPGraphQL at: ${appConfig.wpgraphql.endpoint}`);
      const wpSchema = await this.schemaIntrospector.getSchema();
      logger.info('WPGraphQL schema loaded successfully');

      // For now, use the schema as-is and let Yoga handle the execution
      // We'll add proper proxy functionality in the next iteration
      logger.info('Using WPGraphQL schema directly (proxy functionality coming next)');

      // Create Yoga server with request interceptor
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
            proxyHandler: this.proxyHandler,
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
      const server = createServer(yoga);

      // Start server
      server.listen(appConfig.server.port, () => {
        logger.info(`🚀 GraphQL Yoga server running on http://localhost:${appConfig.server.port}/graphql`);
        logger.info(`📊 GraphiQL available at http://localhost:${appConfig.server.port}/graphql`);
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        logger.info('Received SIGINT, shutting down gracefully...');
        server.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });

      process.on('SIGTERM', () => {
        logger.info('Received SIGTERM, shutting down gracefully...');
        server.close(() => {
          logger.info('Server closed');
          process.exit(0);
        });
      });

    } catch (error) {
      logger.error({ error }, 'Failed to start server');
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
