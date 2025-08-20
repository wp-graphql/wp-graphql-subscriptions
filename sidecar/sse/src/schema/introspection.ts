import fetch from 'node-fetch';
import { buildClientSchema, getIntrospectionQuery, IntrospectionQuery } from 'graphql';
import type { GraphQLSchema } from 'graphql';
import { appConfig } from '../config.js';
import logger from '../logger.js';

export class SchemaIntrospector {
  private cachedSchema: GraphQLSchema | null = null;
  private lastIntrospection: number = 0;

  async getSchema(): Promise<GraphQLSchema> {
    const now = Date.now();
    
    // Return cached schema if still valid
    if (this.cachedSchema && (now - this.lastIntrospection) < appConfig.schema.cacheTTL * 1000) {
      logger.debug('Returning cached schema');
      return this.cachedSchema;
    }

    logger.info('Introspecting WPGraphQL schema');
    
    try {
      const schema = await this.introspectSchema();
      this.cachedSchema = schema;
      this.lastIntrospection = now;
      
      logger.info('Schema introspection successful');
      return schema;
    } catch (error) {
      logger.error({ error }, 'Schema introspection failed');
      
      // Return cached schema if available, otherwise rethrow
      if (this.cachedSchema) {
        logger.warn('Using stale cached schema due to introspection failure');
        return this.cachedSchema;
      }
      
      throw error;
    }
  }

  private async introspectSchema(): Promise<GraphQLSchema> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), appConfig.wpgraphql.timeout);
    
    const response = await fetch(appConfig.wpgraphql.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: getIntrospectionQuery(),
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`WPGraphQL introspection failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { data: IntrospectionQuery };
    
    if (!result.data) {
      throw new Error('No introspection data received from WPGraphQL');
    }

    return buildClientSchema(result.data);
  }

  invalidateCache(): void {
    logger.info('Invalidating schema cache');
    this.cachedSchema = null;
    this.lastIntrospection = 0;
  }
}
