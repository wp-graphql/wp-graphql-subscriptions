/**
 * Subscription manager for SSE-2
 * Handles active subscriptions and channel mapping
 */

import type { Logger } from 'pino';
import type { ServerResponse } from 'node:http';
import { parse, validate } from 'graphql';
import type { OperationDefinitionNode, FieldNode, ArgumentNode, ValueNode } from 'graphql';
import { RedisClient, type SubscriptionEvent } from '../redis/client.js';
import { ChannelBuilder } from './channels.js';
import { WPGraphQLClient } from '../graphql/client.js';
import type { GraphQLRequest, ServerConfig } from '../types/index.js';

export interface ActiveSubscription {
  id: string;
  query: string;
  variables: Record<string, any>;
  operationName?: string | undefined;
  channel: string;
  subscriptionName: string;
  args: Record<string, any>;
  createdAt: number;
  sseResponse: ServerResponse;
}

export class SubscriptionManager {
  private redisClient: RedisClient;
  private logger: Logger;
  private config: ServerConfig;
  private wpgraphqlClient: WPGraphQLClient;
  private activeSubscriptions = new Map<string, ActiveSubscription>();
  private subscriptionsByChannel = new Map<string, Set<string>>();

  constructor(redisClient: RedisClient, config: ServerConfig, logger: Logger) {
    this.redisClient = redisClient;
    this.config = config;
    this.logger = logger;
    this.wpgraphqlClient = new WPGraphQLClient(config, logger);
  }

  /**
   * Create a new subscription
   */
  async createSubscription(
    subscriptionId: string,
    graphqlRequest: GraphQLRequest,
    sseResponse: ServerResponse
  ): Promise<ActiveSubscription> {
    this.logger.info({ subscriptionId }, 'Creating new subscription');

    // Extract subscription field and arguments from query string
    const { subscriptionName, args } = this.extractSubscriptionInfoFromQuery(
      graphqlRequest.query,
      graphqlRequest.variables || {}
    );

    // Build Redis channel name - use specific channel if args exist, otherwise global
    const channel = ChannelBuilder.build(subscriptionName, args);

    // Create subscription record
    const subscription: ActiveSubscription = {
      id: subscriptionId,
      query: graphqlRequest.query,
      variables: graphqlRequest.variables || {},
      operationName: graphqlRequest.operationName,
      channel,
      subscriptionName,
      args,
      createdAt: Date.now(),
      sseResponse,
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

      this.logger.info({ channel }, 'Subscribed to Redis channel');
    }

    this.subscriptionsByChannel.get(channel)!.add(subscriptionId);

    this.logger.info({
      subscriptionId,
      subscriptionName,
      channel,
      args,
      totalSubscriptions: this.activeSubscriptions.size,
      queryHash: Buffer.from(graphqlRequest.query).toString('base64').substring(0, 20) + '...'
    }, 'Subscription created successfully');

    return subscription;
  }

  /**
   * Remove a subscription
   */
  async removeSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.activeSubscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    this.logger.info({ subscriptionId, channel: subscription.channel }, 'Removing subscription');

    // Remove from active subscriptions
    this.activeSubscriptions.delete(subscriptionId);

    // Remove from channel tracking
    const channelSubscriptions = this.subscriptionsByChannel.get(subscription.channel);
    if (channelSubscriptions) {
      channelSubscriptions.delete(subscriptionId);

      // If no more subscriptions for this channel, unsubscribe from Redis
      if (channelSubscriptions.size === 0) {
        this.subscriptionsByChannel.delete(subscription.channel);
        // Note: We don't unsubscribe from Redis here to avoid race conditions
        // Redis subscriptions will be cleaned up when the connection closes
        this.logger.info({ channel: subscription.channel }, 'No more subscriptions for channel');
      }
    }

    this.logger.info({ 
      subscriptionId, 
      channel: subscription.channel,
      remainingSubscriptions: this.activeSubscriptions.size,
      channelSubscriptionCount: channelSubscriptions?.size || 0
    }, 'Subscription removed');
  }

  /**
   * Handle events from Redis channels
   */
  private async handleChannelEvent(channel: string, event: SubscriptionEvent): Promise<void> {
    const subscriptionIds = this.subscriptionsByChannel.get(channel);
    if (!subscriptionIds || subscriptionIds.size === 0) {
      this.logger.warn({ channel }, 'Received event for channel with no subscriptions');
      return;
    }

    this.logger.info({ 
      channel, 
      subscriptionCount: subscriptionIds.size,
      subscriptionIds: Array.from(subscriptionIds),
      totalActiveSubscriptions: this.activeSubscriptions.size,
      payload: event.payload 
    }, 'Broadcasting event to subscriptions');

    // Send event to all subscriptions on this channel
    for (const subscriptionId of subscriptionIds) {
      try {
        const subscription = this.activeSubscriptions.get(subscriptionId);
        if (!subscription) {
          this.logger.warn({ subscriptionId, channel }, 'Subscription not found');
          continue;
        }

        this.logger.debug({ subscriptionId, channel }, 'Processing event for subscription');
        await this.sendEventToSubscription(subscription, event.payload);
      } catch (error) {
        this.logger.error({ 
          error, 
          subscriptionId, 
          channel 
        }, 'Failed to process event for subscription');
      }
    }
  }

  /**
   * Send event to a specific subscription via SSE
   */
  private async sendEventToSubscription(subscription: ActiveSubscription, payload: any): Promise<void> {
    try {
      // Check if the response is still writable
      if (!subscription.sseResponse.writable) {
        this.logger.info({ subscriptionId: subscription.id }, 'SSE connection closed, removing subscription');
        this.removeSubscription(subscription.id);
        return;
      }

      this.logger.debug({
        subscriptionId: subscription.id,
        subscriptionName: subscription.subscriptionName,
        payload: Object.keys(payload)
      }, 'Executing subscription against WPGraphQL');

      // Prepare root value with the standardized event format
      // The WPGraphQL resolver will extract what it needs from this event structure
      const rootValue = {
        [subscription.subscriptionName]: payload
      };

      this.logger.debug({
        subscriptionId: subscription.id,
        subscriptionName: subscription.subscriptionName,
        originalPayload: Object.keys(payload),
        rootValue
      }, 'Prepared root value for WPGraphQL');

      // Execute the subscription query against WPGraphQL with the formatted root value
      const result = await this.wpgraphqlClient.executeSubscription(
        subscription.query,
        subscription.variables,
        subscription.operationName,
        rootValue
      );

      // Send the GraphQL result as SSE event
      subscription.sseResponse.write('event: next\n');
      subscription.sseResponse.write(`data: ${JSON.stringify(result)}\n\n`);

      this.logger.debug({ 
        subscriptionId: subscription.id,
        subscriptionName: subscription.subscriptionName,
        hasData: !!result.data,
        hasErrors: !!result.errors
      }, 'Sent GraphQL result to subscription');

    } catch (error) {
      this.logger.error({ 
        error, 
        subscriptionId: subscription.id 
      }, 'Failed to send event to subscription');
      
      // Send error to client
      try {
        if (subscription.sseResponse.writable) {
          const errorResponse = {
            data: null,
            errors: [{
              message: error instanceof Error ? error.message : 'Subscription execution error',
              extensions: { code: 'SUBSCRIPTION_ERROR' }
            }]
          };
          subscription.sseResponse.write('event: next\n');
          subscription.sseResponse.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        }
      } catch (writeError) {
        this.logger.error({ error: writeError }, 'Failed to send error to client');
      }
      
      // Remove broken subscription
      this.removeSubscription(subscription.id);
    }
  }

  /**
   * Extract subscription name and arguments from GraphQL query using AST parsing
   */
  private extractSubscriptionInfoFromQuery(query: string, variables: Record<string, any>): {
    subscriptionName: string;
    args: Record<string, any>;
  } {
    try {
      // Parse the GraphQL query into an AST
      const ast = parse(query);
      
      // Find the subscription operation
      const subscriptionOperation = ast.definitions.find(
        (def): def is OperationDefinitionNode => 
          def.kind === 'OperationDefinition' && def.operation === 'subscription'
      );
      
      if (!subscriptionOperation) {
        throw new Error('No subscription operation found in query');
      }
      
      // Get the first field in the subscription (should be our subscription field like 'postUpdated')
      const subscriptionField = subscriptionOperation.selectionSet.selections[0] as FieldNode;
      if (!subscriptionField || subscriptionField.kind !== 'Field') {
        throw new Error('No subscription field found');
      }
      
      const subscriptionName = subscriptionField.name.value;
      let args: Record<string, any> = {};
      
      // Extract arguments from the field
      if (subscriptionField.arguments) {
        for (const argument of subscriptionField.arguments) {
          const argName = argument.name.value;
          const argValue = this.extractValueFromAST(argument.value, variables);
          
          if (argValue !== undefined) {
            args[argName] = argValue;
          }
        }
      }
      
      this.logger.debug({ subscriptionName, args, query, variables }, 'Extracted subscription info from AST');
      
      return { subscriptionName, args };
      
    } catch (error) {
      this.logger.error({ error, query }, 'Failed to parse GraphQL query');
      throw new Error(`Failed to parse GraphQL query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Extract a value from a GraphQL AST ValueNode
   */
  private extractValueFromAST(valueNode: ValueNode, variables: Record<string, any>): any {
    switch (valueNode.kind) {
      case 'StringValue':
        return valueNode.value;
      case 'IntValue':
        return parseInt(valueNode.value, 10);
      case 'FloatValue':
        return parseFloat(valueNode.value);
      case 'BooleanValue':
        return valueNode.value;
      case 'NullValue':
        return null;
      case 'Variable':
        return variables[valueNode.name.value];
      case 'ListValue':
        return valueNode.values.map(v => this.extractValueFromAST(v, variables));
      case 'ObjectValue':
        const obj: Record<string, any> = {};
        valueNode.fields.forEach(field => {
          obj[field.name.value] = this.extractValueFromAST(field.value, variables);
        });
        return obj;
      case 'EnumValue':
        return valueNode.value;
      default:
        this.logger.warn({ valueNode }, 'Unsupported AST value node type');
        return undefined;
    }
  }

  /**
   * Get subscription statistics
   */
  getStats(): {
    totalSubscriptions: number;
    channelCount: number;
    subscriptionsByChannel: Record<string, number>;
  } {
    const subscriptionsByChannel: Record<string, number> = {};
    this.subscriptionsByChannel.forEach((subscriptions, channel) => {
      subscriptionsByChannel[channel] = subscriptions.size;
    });

    return {
      totalSubscriptions: this.activeSubscriptions.size,
      channelCount: this.subscriptionsByChannel.size,
      subscriptionsByChannel,
    };
  }

  /**
   * Clean up all subscriptions (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    this.logger.info({ subscriptionCount: this.activeSubscriptions.size }, 'Cleaning up all subscriptions');

    // Close all SSE connections
    this.activeSubscriptions.forEach(subscription => {
      try {
        if (subscription.sseResponse.writable) {
          subscription.sseResponse.write('event: complete\n');
          subscription.sseResponse.write('data: \n\n');
          subscription.sseResponse.end();
        }
      } catch (error) {
        this.logger.error({ error, subscriptionId: subscription.id }, 'Error closing SSE connection');
      }
    });

    // Clear all data structures
    this.activeSubscriptions.clear();
    this.subscriptionsByChannel.clear();

    this.logger.info('Subscription cleanup completed');
  }
}
