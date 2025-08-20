import { GraphQLSchema } from 'graphql';
import { ProxyHandler } from '../proxy/handler.js';
import logger from '../logger.js';

/**
 * Creates a simple proxy schema that forwards all operations to WPGraphQL
 * This is a simpler approach than reconstructing operations from field resolvers
 */
export class SimpleProxySchema {
  private proxyHandler: ProxyHandler;

  constructor(proxyHandler: ProxyHandler) {
    this.proxyHandler = proxyHandler;
  }

  /**
   * Wraps the WPGraphQL schema with a simple executor that forwards everything
   */
  create(schema: GraphQLSchema): GraphQLSchema {
    logger.info('Creating simple proxy schema wrapper');

    try {
      // For now, let's just return the original schema
      // We'll enhance this to add proper subscription handling in Phase 1.4
      logger.info('Using original WPGraphQL schema (proxy functionality will be added in resolvers)');
      return schema;
    } catch (error) {
      logger.error({ error }, 'Failed to create proxy schema');
      throw error;
    }
  }
}
