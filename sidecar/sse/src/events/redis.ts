import { createClient, RedisClientType } from 'redis';
import { appConfig } from '../config.js';
import logger from '../logger.js';

export interface SubscriptionEvent {
  channel: string;
  payload: any;
  timestamp: number;
}

/**
 * Redis client for handling subscription events
 */
export class RedisClient {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<(event: SubscriptionEvent) => void>> = new Map();

  constructor() {
    // Create main client for publishing
    this.client = createClient({
      url: appConfig.redis.url,
    });

    // Create separate client for subscribing (Redis requirement)
    this.subscriber = createClient({
      url: appConfig.redis.url,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Main client error handling
    this.client.on('error', (error) => {
      logger.error({ error }, 'Redis client error');
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    // Subscriber error handling
    this.subscriber.on('error', (error) => {
      logger.error({ error }, 'Redis subscriber error');
    });

    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    // Handle subscription messages
    this.subscriber.on('message', (channel: string, message: string) => {
      try {
        logger.info({ channel, message }, '🎉 REDIS CLIENT: Received Redis message on global handler');
        
        const payload = JSON.parse(message);
        const event: SubscriptionEvent = {
          channel,
          payload,
          timestamp: Date.now(),
        };

        logger.info({ channel, payload, handlersAvailable: this.eventHandlers.has(channel) }, '📤 REDIS CLIENT: Processing Redis message');
        this.handleSubscriptionEvent(event);
      } catch (error) {
        logger.error({ error, channel, message }, '❌ REDIS CLIENT: Failed to parse Redis message');
      }
    });

    // Add additional event listeners for debugging
    this.subscriber.on('subscribe', (channel: string, count: number) => {
      logger.info({ channel, count }, '🔔 REDIS CLIENT: Successfully subscribed to channel');
    });

    this.subscriber.on('unsubscribe', (channel: string, count: number) => {
      logger.info({ channel, count }, '🔕 REDIS CLIENT: Unsubscribed from channel');
    });

    this.subscriber.on('error', (error: any) => {
      logger.error({ error }, '❌ REDIS CLIENT: Subscriber error');
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      logger.info('Connecting to Redis...');
      
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
      ]);

      this.isConnected = true;
      logger.info('Redis connected successfully');
      
      // Test the subscriber connection
      logger.info('🔧 REDIS CLIENT: Testing subscriber connection and message handling');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Redis');
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
      logger.info('Disconnecting from Redis...');
      
      await Promise.all([
        this.client.disconnect(),
        this.subscriber.disconnect(),
      ]);

      this.isConnected = false;
      logger.info('Redis disconnected successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to disconnect from Redis');
    }
  }

  /**
   * Subscribe to a Redis channel
   */
  async subscribe(channel: string, handler: (event: SubscriptionEvent) => void): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }

    logger.info({ channel, existingChannels: Array.from(this.eventHandlers.keys()) }, '🔧 REDIS CLIENT: Starting subscription process');

    // Add handler to our internal map
    if (!this.eventHandlers.has(channel)) {
      this.eventHandlers.set(channel, new Set());
      
      // Subscribe to the channel in Redis (Redis v4+ API)
      logger.info({ channel }, '📡 REDIS CLIENT: Subscribing to Redis channel');
      await this.subscriber.subscribe(channel, (message: string, channelName: string) => {
        // Direct callback approach for Redis v4+
        logger.info({ channel: channelName, message }, '🎉 REDIS CLIENT: Received message via direct callback');
        
        try {
          const payload = JSON.parse(message);
          const event: SubscriptionEvent = {
            channel: channelName,
            payload,
            timestamp: Date.now(),
          };

          logger.info({ channel: channelName, payload, handlersAvailable: this.eventHandlers.has(channelName) }, '📤 REDIS CLIENT: Processing message from direct callback');
          this.handleSubscriptionEvent(event);
        } catch (error) {
          logger.error({ error, channel: channelName, message }, '❌ REDIS CLIENT: Failed to parse message from direct callback');
        }
      });

      logger.info({ channel }, '✅ REDIS CLIENT: Successfully subscribed to Redis channel');
    }

    this.eventHandlers.get(channel)!.add(handler);
    logger.info({ 
      channel, 
      handlerCount: this.eventHandlers.get(channel)!.size,
      totalChannels: this.eventHandlers.size 
    }, '✅ REDIS CLIENT: Added subscription handler');
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
    logger.debug({ channel, handlerCount: handlers.size }, 'Removed subscription handler');

    // If no more handlers, unsubscribe from Redis
    if (handlers.size === 0) {
      this.eventHandlers.delete(channel);
      
      if (this.isConnected) {
        await this.subscriber.unsubscribe(channel);
        logger.debug({ channel }, 'Unsubscribed from Redis channel');
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
      await this.client.publish(channel, message);
      
      logger.debug({ channel, payload }, 'Published message to Redis');
    } catch (error) {
      logger.error({ error, channel, payload }, 'Failed to publish Redis message');
      throw error;
    }
  }

  /**
   * Handle incoming subscription events
   */
  private handleSubscriptionEvent(event: SubscriptionEvent): void {
    const handlers = this.eventHandlers.get(event.channel);
    if (!handlers || handlers.size === 0) {
      logger.debug({ channel: event.channel }, 'No handlers for Redis event');
      return;
    }

    // Call all handlers for this channel
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error({ error, channel: event.channel }, 'Subscription handler error');
      }
    }
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get active subscription channels
   */
  getActiveChannels(): string[] {
    return Array.from(this.eventHandlers.keys());
  }
}
