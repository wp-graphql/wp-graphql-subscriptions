import { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import { RedisClient } from '../events/redis.js';
import { SubscriptionManager } from './manager.js';
import { ChannelBuilder } from './channels.js';
import logger from '../logger.js';

/**
 * Context interface for subscription resolvers
 */
export interface SubscriptionContext {
  headers: Record<string, string>;
  request: Request;
  redisClient: RedisClient;
  subscriptionManager: SubscriptionManager;
}

/**
 * Subscription event payload interface
 */
export interface SubscriptionEvent {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  source?: string;
}

/**
 * Simple event emitter for subscription events
 */
class SubscriptionEventEmitter {
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  on(event: string, listener: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (data: any) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit(event: string, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          logger.error({ error, event }, 'Error in subscription event listener');
        }
      });
    }
  }
}

// Global event emitter for subscriptions
const subscriptionEmitter = new SubscriptionEventEmitter();

/**
 * Creates an async iterable for subscription streaming
 */
async function* createSubscriptionStream(
  channelName: string,
  redisClient: RedisClient,
  subscriptionId: string,
  subscriptionManager: SubscriptionManager
): AsyncIterable<any> {
  logger.info({ channelName, subscriptionId }, 'Starting subscription stream');

  const eventQueue: any[] = [];
  let isComplete = false;
  let resolveNext: ((value: any) => void) | null = null;

  // Set up Redis subscription handler
  const eventHandler = (event: any) => {
    try {
      logger.info({ subscriptionId, event, channel: event.channel }, '🎉 SUBSCRIPTION RESOLVER: Received Redis event');

      // Parse the event data
      let eventData: any = event.payload;
      if (typeof event.payload === 'string') {
        try {
          eventData = JSON.parse(event.payload);
        } catch (parseError) {
          logger.warn({ event: event.payload, parseError }, 'Using raw string as event data');
          eventData = event.payload;
        }
      }

      logger.info({ subscriptionId, eventData }, '📤 SUBSCRIPTION RESOLVER: Yielding event data to GraphQL subscription');

      // Add to queue or resolve pending promise
      if (resolveNext) {
        logger.info({ subscriptionId }, '✅ SUBSCRIPTION RESOLVER: Resolving pending promise');
        resolveNext(eventData);
        resolveNext = null;
      } else {
        logger.info({ subscriptionId, queueLength: eventQueue.length }, '📥 SUBSCRIPTION RESOLVER: Adding to event queue');
        eventQueue.push(eventData);
      }

    } catch (eventError) {
      logger.error({ subscriptionId, eventError }, '❌ SUBSCRIPTION RESOLVER: Error processing subscription event');
    }
  };

  try {
    // Subscribe to the Redis channel
    logger.info({ subscriptionId, channelName, redisConnected: redisClient.connected }, '🔧 SUBSCRIPTION RESOLVER: Attempting Redis subscription');
    await redisClient.subscribe(channelName, eventHandler);
    logger.info({ subscriptionId, channelName }, '✅ SUBSCRIPTION RESOLVER: Redis subscription successful');

    // Yield events as they come
    while (!isComplete) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        yield event;
      } else {
        // Wait for next event
        const nextEvent = await new Promise<any>((resolve) => {
          resolveNext = resolve;
          // Set a timeout to prevent hanging forever
          setTimeout(() => {
            if (resolveNext === resolve) {
              resolveNext = null;
              resolve(null);
            }
          }, 30000); // 30 second timeout
        });
        
        if (nextEvent !== null) {
          yield nextEvent;
        }
      }
    }

  } catch (error) {
    logger.error({ subscriptionId, channelName, error }, 'Subscription stream error');
    throw error;
  } finally {
    // Clean up subscription
    try {
      await redisClient.unsubscribe(channelName, eventHandler);
      logger.info({ subscriptionId }, 'Subscription cleaned up');
    } catch (cleanupError) {
      logger.error({ subscriptionId, cleanupError }, 'Error cleaning up subscription');
    }
  }
}

/**
 * Creates a subscription resolver for a given subscription type
 */
export function createSubscriptionResolver(
  subscriptionName: string
): GraphQLFieldResolver<any, SubscriptionContext, any> {
  return async (source, args, context, info: GraphQLResolveInfo) => {
    const { redisClient, subscriptionManager } = context;
    
    // Generate a unique subscription ID
    const subscriptionId = `${subscriptionName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Build the Redis channel name based on subscription arguments
    const channelName = ChannelBuilder.build(subscriptionName, args);
    
    logger.info({
      subscriptionName,
      subscriptionId,
      channelName,
      args,
    }, 'Creating subscription resolver');

    // Return the async iterable for SSE streaming
    return createSubscriptionStream(
      channelName,
      redisClient,
      subscriptionId,
      subscriptionManager
    );
  };
}

/**
 * Predefined subscription resolvers for common WPGraphQL subscription types
 */
export const subscriptionResolvers = {
  /**
   * Post update subscription resolver
   * Supports optional 'id' argument for specific post updates
   */
  postUpdated: createSubscriptionResolver('postUpdated'),

  /**
   * Comment update subscription resolver
   * Supports optional 'id' argument for specific comment updates
   */
  commentUpdated: createSubscriptionResolver('commentUpdated'),

  /**
   * User update subscription resolver
   * Supports optional 'id' argument for specific user updates
   */
  userUpdated: createSubscriptionResolver('userUpdated'),
};

/**
 * Creates subscription resolvers for all subscription fields in a schema
 */
export function createAllSubscriptionResolvers(
  subscriptionFieldNames: string[]
): Record<string, GraphQLFieldResolver<any, SubscriptionContext, any>> {
  const resolvers: Record<string, GraphQLFieldResolver<any, SubscriptionContext, any>> = {};

  for (const fieldName of subscriptionFieldNames) {
    resolvers[fieldName] = createSubscriptionResolver(fieldName);
    logger.debug({ fieldName }, 'Created subscription resolver');
  }

  return resolvers;
}

/**
 * Utility to extract subscription field names from a GraphQL schema
 */
export function extractSubscriptionFieldNames(schema: any): string[] {
  try {
    const subscriptionType = schema.getSubscriptionType();
    if (!subscriptionType) {
      logger.info('No subscription type found in schema');
      return [];
    }

    const fields = subscriptionType.getFields();
    const fieldNames = Object.keys(fields);
    
    logger.info({ fieldNames }, 'Extracted subscription field names from schema');
    return fieldNames;
  } catch (error) {
    logger.error({ error }, 'Error extracting subscription field names');
    return [];
  }
}
