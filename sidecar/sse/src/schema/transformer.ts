import { GraphQLSchema, isObjectType, GraphQLObjectType } from 'graphql';
import { createProxyResolver } from './proxy-resolvers.js';
import { ProxyHandler } from '../proxy/handler.js';
import logger from '../logger.js';

/**
 * Transforms a WPGraphQL schema to add proxy resolvers
 * This makes the schema executable by forwarding operations to WPGraphQL
 */
export class SchemaTransformer {
  private proxyHandler: ProxyHandler;

  constructor(proxyHandler: ProxyHandler) {
    this.proxyHandler = proxyHandler;
  }

  /**
   * Transforms the introspected WPGraphQL schema to add executable resolvers
   */
  transform(schema: GraphQLSchema): GraphQLSchema {
    logger.info('Transforming WPGraphQL schema to add proxy resolvers');

    try {
      const typeMap = schema.getTypeMap();
      const transformedTypes: Record<string, GraphQLObjectType> = {};

      logger.debug(`Found ${Object.keys(typeMap).length} types in schema`);

      // Transform root types (RootQuery, RootMutation, RootSubscription)
      for (const [typeName, type] of Object.entries(typeMap)) {
        if (isObjectType(type) && this.isRootType(typeName)) {
          logger.debug(`Transforming root type: ${typeName}`);
          transformedTypes[typeName] = this.transformRootType(type);
        }
      }

      logger.debug(`Transformed types: ${Object.keys(transformedTypes).join(', ')}`);

      // Create new schema with transformed types
      const transformedSchema = new GraphQLSchema({
        query: transformedTypes['RootQuery'] || schema.getQueryType(),
        mutation: transformedTypes['RootMutation'] || schema.getMutationType(),
        subscription: transformedTypes['RootSubscription'] || schema.getSubscriptionType(),
        types: Object.values(typeMap), // Keep all other types as-is
      });

      logger.info('Schema transformation complete');
      return transformedSchema;
    } catch (error) {
      logger.error({ error }, 'Schema transformation failed');
      throw error;
    }
  }

  /**
   * Checks if a type is a root operation type
   */
  private isRootType(typeName: string): boolean {
    return ['RootQuery', 'RootMutation', 'RootSubscription'].includes(typeName);
  }

  /**
   * Transforms a root type to add proxy resolvers to all fields
   */
  private transformRootType(type: GraphQLObjectType): GraphQLObjectType {
    try {
      const fields = type.getFields();
      const transformedFields: Record<string, any> = {};

      logger.debug(`Transforming ${Object.keys(fields).length} fields for type ${type.name}`);

      const proxyResolver = createProxyResolver(this.proxyHandler);

      // Add proxy resolver to each field
      for (const [fieldName, field] of Object.entries(fields)) {
        transformedFields[fieldName] = {
          ...field,
          resolve: proxyResolver,
        };
      }

      // Create new type with proxy resolvers
      return new GraphQLObjectType({
        name: type.name,
        description: type.description,
        fields: transformedFields,
        interfaces: type.getInterfaces(),
      });
    } catch (error) {
      logger.error({ error, typeName: type.name }, 'Failed to transform root type');
      throw error;
    }
  }
}
