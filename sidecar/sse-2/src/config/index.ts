/**
 * Configuration management for SSE-2 GraphQL Subscription Server
 */

import { config as loadDotenv } from 'dotenv';
import type { ServerConfig } from '../types/index.js';

// Load environment variables from .env file
loadDotenv();

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  const config: ServerConfig = {
    // Server Configuration
    port: parseInt(process.env.PORT || '4000', 10),
    host: process.env.HOST || 'localhost',
    nodeEnv: process.env.NODE_ENV || 'development',

    // WPGraphQL Configuration
    wpgraphqlEndpoint: process.env.WPGRAPHQL_ENDPOINT || 'http://localhost/graphql',
    wpgraphqlIntrospectionEndpoint: process.env.WPGRAPHQL_INTROSPECTION_ENDPOINT || process.env.WPGRAPHQL_ENDPOINT || 'http://localhost/graphql',

    // Redis Configuration
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

    // Security
    subscriptionSecret: process.env.SUBSCRIPTION_SECRET || 'change-me-in-production-this-is-32-chars-minimum',

    // CORS
    corsOrigin: process.env.CORS_ORIGIN?.split(',').map(origin => origin.trim()) || ['http://localhost:3000', 'http://localhost:8080'],

    // Timeouts and Intervals
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10),
    sseHeartbeatInterval: parseInt(process.env.SSE_HEARTBEAT_INTERVAL || '30000', 10),
    sseConnectionTimeout: parseInt(process.env.SSE_CONNECTION_TIMEOUT || '300000', 10),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    logPretty: process.env.LOG_PRETTY === 'true' || process.env.NODE_ENV === 'development',
  };

  // Validation
  validateConfig(config);

  return config;
}

/**
 * Validate configuration values
 */
function validateConfig(config: ServerConfig): void {
  const errors: string[] = [];

  // Port validation
  if (config.port < 1 || config.port > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  // URL validation
  try {
    new URL(config.wpgraphqlEndpoint);
  } catch {
    errors.push('WPGRAPHQL_ENDPOINT must be a valid URL');
  }

  try {
    new URL(config.wpgraphqlIntrospectionEndpoint);
  } catch {
    errors.push('WPGRAPHQL_INTROSPECTION_ENDPOINT must be a valid URL');
  }

  try {
    new URL(config.redisUrl);
  } catch {
    errors.push('REDIS_URL must be a valid URL');
  }

  // Security validation
  if (config.subscriptionSecret === 'change-me-in-production' && config.nodeEnv === 'production') {
    errors.push('SUBSCRIPTION_SECRET must be changed in production');
  }

  if (config.subscriptionSecret.length < 32) {
    errors.push('SUBSCRIPTION_SECRET should be at least 32 characters long');
  }

  // Timeout validation
  if (config.requestTimeout < 1000) {
    errors.push('REQUEST_TIMEOUT should be at least 1000ms');
  }

  if (config.sseHeartbeatInterval < 5000) {
    errors.push('SSE_HEARTBEAT_INTERVAL should be at least 5000ms');
  }

  if (config.sseConnectionTimeout < 30000) {
    errors.push('SSE_CONNECTION_TIMEOUT should be at least 30000ms');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get environment-specific defaults
 */
export function getEnvironmentDefaults(nodeEnv: string) {
  switch (nodeEnv) {
    case 'production':
      return {
        logLevel: 'warn',
        logPretty: false,
        requestTimeout: 10000,
        sseHeartbeatInterval: 30000,
      };
    case 'test':
      return {
        logLevel: 'silent',
        logPretty: false,
        requestTimeout: 5000,
        sseHeartbeatInterval: 10000,
      };
    case 'development':
    default:
      return {
        logLevel: 'debug',
        logPretty: true,
        requestTimeout: 30000,
        sseHeartbeatInterval: 15000,
      };
  }
}
