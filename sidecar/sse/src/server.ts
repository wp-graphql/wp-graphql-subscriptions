import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { buildSchema } from 'graphql';
import { appConfig } from './config.js';
import { SchemaIntrospector } from './schema/introspection.js';
import { ProxyHandler } from './proxy/handler.js';
import logger from './logger.js';

class GraphQLYogaServer {
  private schemaIntrospector: SchemaIntrospector;
  private proxyHandler: ProxyHandler;

  constructor() {
    this.schemaIntrospector = new SchemaIntrospector();
    this.proxyHandler = new ProxyHandler();
  }

  async start() {
    logger.info('Starting GraphQL Yoga sidecar server...');

    try {
      // Get initial schema from WPGraphQL
      const wpSchema = await this.schemaIntrospector.getSchema();
      logger.info('Initial schema loaded successfully');

      // Create a temporary schema for now - we'll enhance this with subscriptions later
      const tempSchema = buildSchema(`
        type Query {
          hello: String
        }
        
        type Subscription {
          postUpdated(id: ID): String
        }
      `);

      // Create Yoga server
      const yoga = createYoga({
        schema: tempSchema,
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
