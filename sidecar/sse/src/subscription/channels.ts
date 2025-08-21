import { appConfig } from '../config.js';
import logger from '../logger.js';

/**
 * Channel naming strategy for GraphQL subscriptions
 * Implements the single-argument constraint from Phase 1
 */
export class ChannelBuilder {
  private static readonly keyPrefix = appConfig.redis.keyPrefix;

  /**
   * Builds a Redis channel name from subscription name and arguments
   * Follows the pattern: {subscriptionName}[.{argumentValue}]
   */
  static build(subscriptionName: string, args: Record<string, any> = {}): string {
    const baseChannel = `${this.keyPrefix}${subscriptionName}`;

    // No arguments - use subscription name only (global channel)
    if (!args || Object.keys(args).length === 0) {
      return baseChannel;
    }

    // Validate single argument constraint (Phase 1)
    const argKeys = Object.keys(args);
    if (argKeys.length > 1) {
      logger.warn(
        { subscriptionName, argCount: argKeys.length, args },
        'Subscription has multiple arguments. Only single argument supported in Phase 1.'
      );
      
      // For now, use only the first argument
      const firstKey = argKeys[0]!;
      const firstValue = args[firstKey];
      return `${baseChannel}.${String(firstValue)}`;
    }

    // Single argument - append value directly
    const argKey = argKeys[0]!;
    const argValue = args[argKey];
    
    // Handle different argument types
    const serializedValue = this.serializeArgumentValue(argValue);
    return `${baseChannel}.${serializedValue}`;
  }

  /**
   * Builds multiple channel names for dual-channel publishing
   * Returns both specific and global channels for broad subscription support
   */
  static buildMultiple(subscriptionName: string, args: Record<string, any> = {}): string[] {
    const channels: string[] = [];
    const baseChannel = `${this.keyPrefix}${subscriptionName}`;

    // Always include the global channel
    channels.push(baseChannel);

    // Add specific channel if arguments provided
    if (args && Object.keys(args).length > 0) {
      const specificChannel = this.build(subscriptionName, args);
      if (specificChannel !== baseChannel) {
        channels.push(specificChannel);
      }
    }

    return channels;
  }

  /**
   * Extracts subscription name and arguments from a channel name
   */
  static parse(channelName: string): { subscriptionName: string; args: Record<string, any> } {
    // Remove prefix
    const withoutPrefix = channelName.startsWith(this.keyPrefix) 
      ? channelName.slice(this.keyPrefix.length)
      : channelName;

    const parts = withoutPrefix.split('.');
    const subscriptionName = parts[0];

    if (!subscriptionName) {
      throw new Error(`Invalid channel name: ${channelName}`);
    }

    // No argument part
    if (parts.length === 1) {
      return { subscriptionName, args: {} };
    }

    // Has argument part - for Phase 1, we don't know the argument name
    // This is mainly for debugging/logging purposes
    const argumentValue = parts.slice(1).join('.');
    return {
      subscriptionName,
      args: { id: argumentValue }, // Assume 'id' for Phase 1
    };
  }

  /**
   * Validates subscription arguments against Phase 1 constraints
   */
  static validateArgs(subscriptionName: string, args: Record<string, any>): void {
    const argCount = Object.keys(args || {}).length;
    
    if (argCount > 1) {
      throw new Error(
        `Subscription ${subscriptionName} violates single-argument constraint (has ${argCount} arguments)`
      );
    }
  }

  /**
   * Serializes argument values for channel names
   */
  private static serializeArgumentValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'string') {
      // For GraphQL IDs, use them directly (they're already base64 encoded)
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      // Convert array to comma-separated string
      return value.map(v => this.serializeArgumentValue(v)).join(',');
    }

    if (typeof value === 'object') {
      // For Phase 1, convert object to JSON string (not ideal, but functional)
      logger.warn({ value }, 'Complex object argument serialized as JSON');
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Creates a channel pattern for subscription matching
   * Useful for debugging and monitoring
   */
  static createPattern(subscriptionName: string): string {
    return `${this.keyPrefix}${subscriptionName}*`;
  }

  /**
   * Gets the base channel name without arguments
   */
  static getBaseChannel(subscriptionName: string): string {
    return `${this.keyPrefix}${subscriptionName}`;
  }
}

/**
 * Common subscription channel names for Phase 1
 */
export const SUBSCRIPTION_CHANNELS = {
  POST_UPDATED: 'postUpdated',
  POST_CREATED: 'postCreated',
  POST_DELETED: 'postDeleted',
  COMMENT_CREATED: 'commentCreated',
  COMMENT_UPDATED: 'commentUpdated',
  USER_UPDATED: 'userUpdated',
} as const;

export type SubscriptionChannelName = typeof SUBSCRIPTION_CHANNELS[keyof typeof SUBSCRIPTION_CHANNELS];
