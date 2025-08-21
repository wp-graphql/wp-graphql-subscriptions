import { GraphQLSchema, isObjectType, GraphQLObjectType } from 'graphql';
import { createProxyResolver } from './proxy-resolvers.js';
import { ProxyHandler } from '../proxy/handler.js';
import { createAllSubscriptionResolvers, extractSubscriptionFieldNames } from '../subscription/resolvers.js';
import { RedisClient } from '../events/redis.js';
import { SubscriptionManager } from '../subscription/manager.js';
import logger from '../logger.js';

/**
 * Transforms a WPGraphQL schema to add proxy resolvers
 * This makes the schema executable by forwarding operations to WPGraphQL
 */
export class SchemaTransformer {
  private proxyHandler: ProxyHandler;
  private redisClient: RedisClient | undefined;
  private subscriptionManager: SubscriptionManager | undefined;

  constructor(
    proxyHandler: ProxyHandler,
    redisClient?: RedisClient,
    subscriptionManager?: SubscriptionManager
  ) {
    this.proxyHandler = proxyHandler;
    this.redisClient = redisClient;
    this.subscriptionManager = subscriptionManager;
  }

  /**
   * Transforms the introspected WPGraphQL schema to add executable resolvers
   */
  transform(schema: GraphQLSchema): GraphQLSchema {
    logger.info('Transforming WPGraphQL schema to add proxy resolvers');

    try {
      // Get the actual root types from the schema
      const queryType = schema.getQueryType();
      const mutationType = schema.getMutationType();
      const subscriptionType = schema.getSubscriptionType();

      let transformedQuery = queryType;
      let transformedMutation = mutationType;
      let transformedSubscription = subscriptionType;

      logger.debug({
        queryTypeName: queryType?.name,
        mutationTypeName: mutationType?.name,
        subscriptionTypeName: subscriptionType?.name,
      }, 'Found root types in schema');

      // Keep query and mutation types as-is (they'll be handled by onRequest proxy)
      transformedQuery = queryType;
      transformedMutation = mutationType;

      // Only transform subscription type to add executable resolvers
      if (subscriptionType) {
        logger.debug(`Transforming subscription type: ${subscriptionType.name}`);
        transformedSubscription = this.transformSubscriptionType(subscriptionType);
      } else {
        logger.info('No subscription type found in schema');
      }

      // Create new schema with transformed types
      logger.debug({
        hasQuery: !!transformedQuery,
        hasMutation: !!transformedMutation,
        hasSubscription: !!transformedSubscription,
        totalTypes: Object.keys(schema.getTypeMap()).length
      }, 'Creating new schema');
      
      let transformedSchema: GraphQLSchema;
      try {
        // Filter out the original subscription type to avoid duplicates
        const originalTypes = Object.values(schema.getTypeMap());
        const filteredTypes = originalTypes.filter(type => {
          // Exclude the original subscription type if we're replacing it
          if (subscriptionType && transformedSubscription && type === subscriptionType) {
            return false;
          }
          return true;
        });

        transformedSchema = new GraphQLSchema({
          query: transformedQuery,
          mutation: transformedMutation,
          subscription: transformedSubscription,
          types: filteredTypes, // Keep all other types except the original subscription
        });
        logger.debug('GraphQL Schema creation successful');
      } catch (schemaError) {
        const errorMessage = schemaError instanceof Error ? schemaError.message : 'Unknown schema error';
        const errorStack = schemaError instanceof Error ? schemaError.stack : undefined;
        logger.error({ schemaError, message: errorMessage, stack: errorStack }, 'Failed to create GraphQL Schema');
        throw new Error(`Schema creation failed: ${errorMessage}`);
      }

      logger.info('Schema transformation complete');
      return transformedSchema;
    } catch (error) {
      logger.error({ error }, 'Schema transformation failed');
      throw error;
    }
  }

  /**
   * Transforms a root type (query/mutation) to add proxy resolvers to all fields
   */
  private transformRootType(type: GraphQLObjectType, operationType: 'query' | 'mutation'): GraphQLObjectType {
    try {
      const fields = type.getFields();
      const transformedFields: Record<string, any> = {};

      logger.debug(`Transforming ${Object.keys(fields).length} ${operationType} fields for type ${type.name}`);

      const proxyResolver = createProxyResolver(this.proxyHandler);

      // Add proxy resolver to each field
      for (const [fieldName, field] of Object.entries(fields)) {
        transformedFields[fieldName] = {
          ...field,
          resolve: proxyResolver,
        };
      }

      // Create new type with proxy resolvers
      logger.debug({ 
        typeName: type.name, 
        operationType,
        fieldCount: Object.keys(transformedFields).length 
      }, 'Creating new root type');
      
      return new GraphQLObjectType({
        name: type.name,
        description: type.description,
        fields: () => transformedFields, // Use function form to avoid circular references
        interfaces: type.getInterfaces(),
      });
    } catch (error) {
      logger.error({ error, typeName: type.name, operationType }, 'Failed to transform root type');
      throw error;
    }
  }

  /**
   * Transforms subscription type to add SSE subscription resolvers
   */
  private transformSubscriptionType(type: GraphQLObjectType): GraphQLObjectType {
    try {
      const fields = type.getFields();
      const transformedFields: Record<string, any> = {};

      logger.debug(`Transforming subscription type with ${Object.keys(fields).length} fields`);

      // Only add subscription resolvers if we have Redis client and manager
      if (this.redisClient && this.subscriptionManager) {
        const fieldNames = Object.keys(fields);
        const subscriptionResolvers = createAllSubscriptionResolvers(fieldNames);

        // Add SSE subscription resolvers to each field
        for (const [fieldName, field] of Object.entries(fields)) {
          // Convert args array to args object format expected by GraphQL
          const argsObject: Record<string, any> = {};
          if (field.args && Array.isArray(field.args)) {
            for (const arg of field.args) {
              argsObject[arg.name] = {
                type: arg.type,
                description: arg.description,
                defaultValue: arg.defaultValue,
                deprecationReason: arg.deprecationReason,
              };
            }
          }

          transformedFields[fieldName] = {
            type: field.type,
            description: field.description,
            args: argsObject,
            deprecationReason: field.deprecationReason,
            subscribe: subscriptionResolvers[fieldName],
            resolve: (payload: any) => payload, // Simple pass-through resolver
          };
        }

        logger.info({ fieldCount: fieldNames.length }, 'Added SSE subscription resolvers');
      } else {
        logger.warn('Redis client or subscription manager not available, keeping original subscription fields');
        
        // Keep original fields without executable resolvers (they won't work but schema will be valid)
        for (const [fieldName, field] of Object.entries(fields)) {
          // Convert args array to args object format expected by GraphQL
          const argsObject: Record<string, any> = {};
          if (field.args && Array.isArray(field.args)) {
            for (const arg of field.args) {
              argsObject[arg.name] = {
                type: arg.type,
                description: arg.description,
                defaultValue: arg.defaultValue,
                deprecationReason: arg.deprecationReason,
              };
            }
          }

          transformedFields[fieldName] = {
            type: field.type,
            description: field.description,
            args: argsObject,
            deprecationReason: field.deprecationReason,
            // No subscribe function - these won't work without Redis
          };
        }
      }

      // Create new subscription type with SSE resolvers
      logger.debug({ 
        typeName: type.name, 
        fieldCount: Object.keys(transformedFields).length,
        fieldNames: Object.keys(transformedFields) 
      }, 'Creating new subscription type');
      
      try {
        const newSubscriptionType = new GraphQLObjectType({
          name: type.name,
          description: type.description,
          fields: () => transformedFields, // Use function form to avoid circular references
          interfaces: type.getInterfaces(),
        });
        logger.debug({ typeName: type.name }, 'Subscription type creation successful');
        return newSubscriptionType;
      } catch (typeError) {
        const errorMessage = typeError instanceof Error ? typeError.message : 'Unknown type error';
        const errorStack = typeError instanceof Error ? typeError.stack : undefined;
        logger.error({ 
          typeError, 
          message: errorMessage, 
          stack: errorStack,
          typeName: type.name,
          transformedFields: Object.keys(transformedFields)
        }, 'Failed to create subscription GraphQLObjectType');
        throw new Error(`Subscription type creation failed: ${errorMessage}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to transform subscription type');
      throw error;
    }
  }
}
