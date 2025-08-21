import { RedisClient, SubscriptionEvent } from '../events/redis.js';
import { ChannelBuilder } from './channels.js';
import { ProxyHandler } from '../proxy/handler.js';
import { print, DocumentNode } from 'graphql';
import logger from '../logger.js';

export interface ActiveSubscription {
  id: string;
  document: DocumentNode;
  variables: Record<string, any>;
  operationName: string | undefined;
  context: {
    headers?: Record<string, string>;
    userId?: string;
  };
  channel: string;
  subscriptionName: string;
  args: Record<string, any>;
  createdAt: number;
}

/**
 * Manages GraphQL subscriptions and their Redis channel mappings
 */
export class SubscriptionManager {
  private redisClient: RedisClient;
  private proxyHandler: ProxyHandler;
  private activeSubscriptions: Map<string, ActiveSubscription> = new Map();
  private subscriptionsByChannel: Map<string, Set<string>> = new Map();

  constructor(redisClient: RedisClient, proxyHandler: ProxyHandler) {
    this.redisClient = redisClient;
    this.proxyHandler = proxyHandler;
  }

  /**
   * Creates a new subscription
   */
  async createSubscription(
    subscriptionId: string,
    document: DocumentNode,
    variables: Record<string, any>,
    operationName: string | undefined,
    context: { headers?: Record<string, string>; userId?: string }
  ): Promise<ActiveSubscription> {
    logger.info({ subscriptionId, operationName }, 'Creating new subscription');

    // Extract subscription field and arguments from document
    const { subscriptionName, args } = this.extractSubscriptionInfo(document, variables);

    // Build Redis channel name
    const channel = ChannelBuilder.build(subscriptionName, args);

    // Create subscription record
    const subscription: ActiveSubscription = {
      id: subscriptionId,
      document,
      variables,
      operationName,
      context,
      channel,
      subscriptionName,
      args,
      createdAt: Date.now(),
    };

    // Store subscription
    this.activeSubscriptions.set(subscriptionId, subscription);

    // Track by channel
    if (!this.subscriptionsByChannel.has(channel)) {
      this.subscriptionsByChannel.set(channel, new Set());
      
      // Subscribe to Redis channel
      await this.redisClient.subscribe(channel, (event) => {
        this.handleChannelEvent(channel, event);
      });
    }

    this.subscriptionsByChannel.get(channel)!.add(subscriptionId);

    logger.info(
      { 
        subscriptionId, 
        subscriptionName, 
        channel, 
        args,
        totalSubscriptions: this.activeSubscriptions.size 
      },
      'Subscription created successfully'
    );

    return subscription;
  }

  /**
   * Removes a subscription
   */
  async removeSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.activeSubscriptions.get(subscriptionId);
    if (!subscription) {
      logger.debug({ subscriptionId }, 'Subscription not found for removal');
      return;
    }

    logger.info({ subscriptionId, channel: subscription.channel }, 'Removing subscription');

    // Remove from active subscriptions
    this.activeSubscriptions.delete(subscriptionId);

    // Remove from channel tracking
    const channelSubscriptions = this.subscriptionsByChannel.get(subscription.channel);
    if (channelSubscriptions) {
      channelSubscriptions.delete(subscriptionId);

      // If no more subscriptions for this channel, unsubscribe from Redis
      if (channelSubscriptions.size === 0) {
        this.subscriptionsByChannel.delete(subscription.channel);
        
        await this.redisClient.unsubscribe(subscription.channel, (event) => {
          this.handleChannelEvent(subscription.channel, event);
        });

        logger.debug({ channel: subscription.channel }, 'Unsubscribed from Redis channel');
      }
    }

    logger.info(
      { 
        subscriptionId, 
        totalSubscriptions: this.activeSubscriptions.size 
      },
      'Subscription removed successfully'
    );
  }

  /**
   * Handles events from Redis channels
   */
  private async handleChannelEvent(channel: string, event: SubscriptionEvent): Promise<void> {
    const subscriptionIds = this.subscriptionsByChannel.get(channel);
    if (!subscriptionIds || subscriptionIds.size === 0) {
      logger.debug({ channel }, 'No active subscriptions for channel event');
      return;
    }

    logger.debug(
      { 
        channel, 
        subscriptionCount: subscriptionIds.size,
        eventPayload: event.payload 
      },
      'Processing channel event for subscriptions'
    );

    // Process event for each subscription
    for (const subscriptionId of subscriptionIds) {
      const subscription = this.activeSubscriptions.get(subscriptionId);
      if (!subscription) {
        continue;
      }

      try {
        await this.executeSubscription(subscription, event);
      } catch (error) {
        logger.error(
          { error, subscriptionId, channel },
          'Failed to execute subscription for event'
        );
      }
    }
  }

  /**
   * Executes a subscription against WPGraphQL with event payload
   */
  private async executeSubscription(
    subscription: ActiveSubscription,
    event: SubscriptionEvent
  ): Promise<void> {
    logger.debug(
      { 
        subscriptionId: subscription.id,
        subscriptionName: subscription.subscriptionName 
      },
      'Executing subscription with event payload'
    );

    try {
      // Convert document back to query string
      const query = print(subscription.document);

      // Execute subscription against WPGraphQL with event payload as context
      const response = await this.proxyHandler.handleRequest(
        {
          query,
          variables: subscription.variables,
          ...(subscription.operationName ? { operationName: subscription.operationName } : {}),
          extensions: {
            subscriptionExecution: {
              eventPayload: event.payload,
              isSubscription: true,
            },
          },
        },
        subscription.context
      );

      // Handle the response
      if (response.errors && response.errors.length > 0) {
        logger.debug(
          { 
            subscriptionId: subscription.id,
            errors: response.errors 
          },
          'Subscription execution returned errors'
        );
        
        // For now, we'll emit the error - in a real implementation,
        // this would be sent to the SSE client
        this.emitSubscriptionResult(subscription.id, { errors: response.errors });
        return;
      }

      // Check if subscription returned data
      if (response.data) {
        // Check if all subscription fields returned null (filtered out by WPGraphQL)
        const allNull = Object.values(response.data).every(value => value === null);
        
        if (allNull) {
          logger.debug(
            { subscriptionId: subscription.id },
            'Subscription filtered out by WPGraphQL (all fields null)'
          );
          return;
        }

        // Emit successful result
        this.emitSubscriptionResult(subscription.id, { data: response.data });
      }
    } catch (error) {
      logger.error(
        { error, subscriptionId: subscription.id },
        'Subscription execution failed'
      );
      
      this.emitSubscriptionResult(subscription.id, {
        errors: [{
          message: error instanceof Error ? error.message : 'Unknown subscription error',
        }],
      });
    }
  }

  /**
   * Emits subscription result (placeholder for SSE integration)
   */
  private emitSubscriptionResult(subscriptionId: string, result: any): void {
    // TODO: In Phase 1.4, this will send SSE events to the client
    // For now, we'll just log the result
    logger.info(
      { subscriptionId, result },
      'Subscription result (SSE emission not yet implemented)'
    );
  }

  /**
   * Extracts subscription name and arguments from GraphQL document
   */
  private extractSubscriptionInfo(
    document: DocumentNode,
    variables: Record<string, any>
  ): { subscriptionName: string; args: Record<string, any> } {
    // Find the subscription operation
    const operation = document.definitions.find(
      (def): def is any => def.kind === 'OperationDefinition' && def.operation === 'subscription'
    );

    if (!operation || !operation.selectionSet.selections[0]) {
      throw new Error('Invalid subscription document');
    }

    const firstSelection = operation.selectionSet.selections[0];
    if (firstSelection.kind !== 'Field') {
      throw new Error('Subscription must select a field');
    }

    const subscriptionName = firstSelection.name.value;
    const args: Record<string, any> = {};

    // Extract arguments
    if (firstSelection.arguments) {
      for (const arg of firstSelection.arguments) {
        if (arg.value.kind === 'Variable') {
          // Resolve variable
          const variableName = arg.value.name.value;
          if (variables[variableName] !== undefined) {
            args[arg.name.value] = variables[variableName];
          }
        } else if (arg.value.kind === 'StringValue' || arg.value.kind === 'IntValue') {
          // Direct value
          args[arg.name.value] = arg.value.value;
        }
        // TODO: Handle other value types as needed
      }
    }

    return { subscriptionName, args };
  }

  /**
   * Gets all active subscriptions
   */
  getActiveSubscriptions(): ActiveSubscription[] {
    return Array.from(this.activeSubscriptions.values());
  }

  /**
   * Gets subscription by ID
   */
  getSubscription(subscriptionId: string): ActiveSubscription | undefined {
    return this.activeSubscriptions.get(subscriptionId);
  }

  /**
   * Gets statistics about active subscriptions
   */
  getStats(): {
    totalSubscriptions: number;
    activeChannels: number;
    subscriptionsByChannel: Record<string, number>;
  } {
    const subscriptionsByChannel: Record<string, number> = {};
    
    for (const [channel, subscriptions] of this.subscriptionsByChannel) {
      subscriptionsByChannel[channel] = subscriptions.size;
    }

    return {
      totalSubscriptions: this.activeSubscriptions.size,
      activeChannels: this.subscriptionsByChannel.size,
      subscriptionsByChannel,
    };
  }

  /**
   * Shuts down the subscription manager and cleans up all subscriptions
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down subscription manager...');

    try {
      // Get all active subscription IDs
      const subscriptionIds = Array.from(this.activeSubscriptions.keys());
      
      logger.info({ count: subscriptionIds.length }, 'Cleaning up active subscriptions');

      // Remove all subscriptions
      for (const subscriptionId of subscriptionIds) {
        try {
          await this.removeSubscription(subscriptionId);
        } catch (error) {
          logger.error({ subscriptionId, error }, 'Error removing subscription during shutdown');
        }
      }

      // Clear all maps
      this.activeSubscriptions.clear();
      this.subscriptionsByChannel.clear();

      logger.info('Subscription manager shutdown complete');
    } catch (error) {
      logger.error({ error }, 'Error during subscription manager shutdown');
      throw error;
    }
  }
}
