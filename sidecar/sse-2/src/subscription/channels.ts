/**
 * Channel naming strategy for GraphQL subscriptions in SSE-2
 * Simplified version based on SSE-1 implementation
 */

import type { Logger } from 'pino';

export class ChannelBuilder {
  private static readonly keyPrefix = 'wpgraphql:';

  /**
   * Builds a Redis channel name from subscription name and arguments
   * Follows the pattern: wpgraphql:{subscriptionName}[.{argumentValue}]
   */
  static build(subscriptionName: string, args: Record<string, any> = {}): string {
    const baseChannel = `${this.keyPrefix}${subscriptionName}`;

    // No arguments - use subscription name only (global channel)
    if (!args || Object.keys(args).length === 0) {
      return baseChannel;
    }

    // Get the first argument (Phase 1 constraint: single argument only)
    const argKeys = Object.keys(args);
    if (argKeys.length > 1) {
      console.warn(`Subscription ${subscriptionName} has multiple arguments. Only using first argument: ${argKeys[0]}`);
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
    
    // Always include the global channel
    channels.push(`${this.keyPrefix}${subscriptionName}`);
    
    // Add specific channel if arguments exist
    if (args && Object.keys(args).length > 0) {
      channels.push(this.build(subscriptionName, args));
    }
    
    return channels;
  }

  /**
   * Serialize argument values for channel names
   */
  private static serializeArgumentValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    
    if (typeof value === 'string') {
      return value;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    // For complex objects, use JSON serialization
    // This could be improved with hashing for very large objects
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Parse a channel name back to subscription name and args
   * Useful for debugging and monitoring
   */
  static parseChannel(channel: string): { subscriptionName: string; hasArgs: boolean; argValue?: string | undefined } {
    if (!channel.startsWith(this.keyPrefix)) {
      throw new Error(`Invalid channel format: ${channel}`);
    }

    const withoutPrefix = channel.slice(this.keyPrefix.length);
    const parts = withoutPrefix.split('.');
    
    const subscriptionName = parts[0] || '';
    const hasArgs = parts.length > 1;
    const argValue = hasArgs ? parts.slice(1).join('.') : undefined;

    return { subscriptionName, hasArgs, argValue };
  }

  /**
   * Validate channel name format
   */
  static isValidChannel(channel: string): boolean {
    try {
      this.parseChannel(channel);
      return true;
    } catch {
      return false;
    }
  }
}
