/**
 * Redis client for handling subscription events in SSE-2
 * Simplified version based on SSE-1 implementation
 */

import { createClient, type RedisClientType } from 'redis';
import type { Logger } from 'pino';
import type { ServerConfig } from '../types/index.js';

export interface SubscriptionEvent {
  channel: string;
  payload: any;
  timestamp: number;
}

export class RedisClient {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private publisher: RedisClientType;
  private logger: Logger;
  private config: ServerConfig;
  private isConnected = false;
  private eventHandlers = new Map<string, Set<(event: SubscriptionEvent) => void>>();

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    // Create Redis clients
    this.client = createClient({ url: config.redis.url });
    this.subscriber = createClient({ url: config.redis.url });
    this.publisher = createClient({ url: config.redis.url });

    // Set up error handlers
    this.client.on('error', (error) => {
      this.logger.error({ error }, 'Redis client error');
    });

    this.subscriber.on('error', (error) => {
      this.logger.error({ error }, 'Redis subscriber error');
    });

    this.publisher.on('error', (error) => {
      this.logger.error({ error }, 'Redis publisher error');
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      this.logger.info({ url: this.config.redis.url }, 'Connecting to Redis');

      // Connect all clients
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect()
      ]);

      this.isConnected = true;
      this.logger.info('Redis connected successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Redis');
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      this.logger.info('Disconnecting from Redis');

      // Disconnect all clients
      await Promise.all([
        this.client.disconnect(),
        this.subscriber.disconnect(),
        this.publisher.disconnect()
      ]);

      this.isConnected = false;
      this.eventHandlers.clear();
      this.logger.info('Redis disconnected successfully');

    } catch (error) {
      this.logger.error({ error }, 'Error disconnecting from Redis');
      throw error;
    }
  }

  /**
   * Subscribe to a Redis channel
   */
  async subscribe(channel: string, handler: (event: SubscriptionEvent) => void): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }

    this.logger.info({ channel }, 'Subscribing to Redis channel');

    // Add handler to our internal map
    if (!this.eventHandlers.has(channel)) {
      this.eventHandlers.set(channel, new Set());

      // Subscribe to the channel in Redis
      await this.subscriber.subscribe(channel, (message: string, channelName: string) => {
        this.logger.debug({ channel: channelName, message }, 'Received Redis message');

        try {
          const payload = JSON.parse(message);
          const event: SubscriptionEvent = {
            channel: channelName,
            payload,
            timestamp: Date.now(),
          };

          this.handleSubscriptionEvent(event);
        } catch (error) {
          this.logger.error({ error, channel: channelName, message }, 'Failed to parse Redis message');
        }
      });

      this.logger.info({ channel }, 'Successfully subscribed to Redis channel');
    }

    this.eventHandlers.get(channel)!.add(handler);
    this.logger.debug({ 
      channel, 
      handlerCount: this.eventHandlers.get(channel)!.size 
    }, 'Added subscription handler');
  }

  /**
   * Unsubscribe from a Redis channel
   */
  async unsubscribe(channel: string, handler: (event: SubscriptionEvent) => void): Promise<void> {
    const handlers = this.eventHandlers.get(channel);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    // If no more handlers for this channel, unsubscribe from Redis
    if (handlers.size === 0) {
      this.eventHandlers.delete(channel);
      
      if (this.isConnected) {
        await this.subscriber.unsubscribe(channel);
        this.logger.info({ channel }, 'Unsubscribed from Redis channel');
      }
    }
  }

  /**
   * Publish an event to a Redis channel
   */
  async publish(channel: string, payload: any): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }

    try {
      const message = JSON.stringify(payload);
      await this.publisher.publish(channel, message);
      
      this.logger.debug({ channel, payload }, 'Published message to Redis');
    } catch (error) {
      this.logger.error({ error, channel, payload }, 'Failed to publish Redis message');
      throw error;
    }
  }

  /**
   * Handle incoming subscription events
   */
  private handleSubscriptionEvent(event: SubscriptionEvent): void {
    const handlers = this.eventHandlers.get(event.channel);
    if (!handlers || handlers.size === 0) {
      this.logger.warn({ channel: event.channel }, 'No handlers for Redis event');
      return;
    }

    this.logger.debug({ 
      channel: event.channel, 
      handlerCount: handlers.size,
      payload: event.payload 
    }, 'Dispatching Redis event to handlers');

    // Call all handlers for this channel
    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        this.logger.error({ error, channel: event.channel }, 'Error in subscription event handler');
      }
    });
  }

  /**
   * Check if Redis is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }
}
