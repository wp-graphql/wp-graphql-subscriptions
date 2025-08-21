/**
 * Logging configuration using Pino
 */

import pino from 'pino';
import type { ServerConfig } from '../types/index.js';

/**
 * Create and configure logger instance
 */
export function createLogger(config: ServerConfig) {
  const logger = pino({
    level: config.logLevel,
    ...(config.logPretty && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    }),
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: 'wp-graphql-sse-server',
      version: '0.1.0',
    },
  });

  // Log configuration on startup
  logger.info({
    config: {
      port: config.port,
      host: config.host,
      nodeEnv: config.nodeEnv,
      wpgraphqlEndpoint: config.wpgraphqlEndpoint,
      redisUrl: config.redisUrl.replace(/\/\/.*@/, '//***:***@'), // Hide credentials
      logLevel: config.logLevel,
      corsOrigin: config.corsOrigin,
    },
  }, 'Server configuration loaded');

  return logger;
}

/**
 * Create child logger with additional context
 */
export function createChildLogger(parentLogger: pino.Logger, context: Record<string, any>) {
  return parentLogger.child(context);
}

/**
 * Request logging middleware context
 */
export interface RequestLogContext {
  method: string;
  url: string;
  userAgent?: string | undefined;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  requestId: string;
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create request-specific logger
 */
export function createRequestLogger(parentLogger: pino.Logger, context: RequestLogContext) {
  return parentLogger.child({
    requestId: context.requestId,
    method: context.method,
    url: context.url,
    userAgent: context.userAgent,
    contentType: context.contentType,
    contentLength: context.contentLength,
  });
}

/**
 * Log levels for different scenarios
 */
export const LogLevels = {
  FATAL: 'fatal',
  ERROR: 'error', 
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
} as const;

/**
 * Common log messages and templates
 */
export const LogMessages = {
  SERVER_STARTING: 'Starting SSE GraphQL Subscription Server',
  SERVER_STARTED: 'Server started successfully',
  SERVER_STOPPING: 'Stopping server',
  SERVER_STOPPED: 'Server stopped',
  
  REQUEST_RECEIVED: 'Request received',
  REQUEST_COMPLETED: 'Request completed',
  REQUEST_ERROR: 'Request error',
  
  SSE_CONNECTION_OPENED: 'SSE connection opened',
  SSE_CONNECTION_CLOSED: 'SSE connection closed',
  SSE_MESSAGE_SENT: 'SSE message sent',
  
  SUBSCRIPTION_CREATED: 'Subscription created',
  SUBSCRIPTION_REMOVED: 'Subscription removed',
  SUBSCRIPTION_EXECUTED: 'Subscription executed against WPGraphQL',
  
  REDIS_CONNECTED: 'Connected to Redis',
  REDIS_DISCONNECTED: 'Disconnected from Redis',
  REDIS_EVENT_RECEIVED: 'Redis event received',
  
  GRAPHQL_REQUEST: 'GraphQL request',
  GRAPHQL_RESPONSE: 'GraphQL response',
  GRAPHQL_ERROR: 'GraphQL error',
  
  WPGRAPHQL_REQUEST: 'WPGraphQL request',
  WPGRAPHQL_RESPONSE: 'WPGraphQL response',
  WPGRAPHQL_ERROR: 'WPGraphQL error',
} as const;
