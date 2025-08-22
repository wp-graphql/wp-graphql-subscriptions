/**
 * Core type definitions for SSE-2 GraphQL Subscription Server
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * HTTP Request/Response types
 */
export interface Request extends IncomingMessage {
  body?: any;
  url: string;
  method: string;
  headers: IncomingMessage['headers'];
}

export interface Response extends ServerResponse {
  json(data: any): void;
  status(code: number): Response;
  send(data: string): void;
  setHeader(name: string, value: string | string[]): this;
}

/**
 * GraphQL Operation types
 */
export interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string | undefined;
  extensions?: Record<string, any>;
}

export interface GraphQLResponse {
  data?: any;
  errors?: GraphQLError[];
  extensions?: Record<string, any>;
}

export interface GraphQLError {
  message: string;
  locations?: Array<{
    line: number;
    column: number;
  }>;
  path?: Array<string | number>;
  extensions?: Record<string, any>;
}

/**
 * SSE Connection types
 */
export interface SSEConnection {
  id: string;
  response: Response;
  subscriptionId?: string;
  isAlive: boolean;
  lastPing: number;
  createdAt: number;
}

/**
 * Subscription Management types
 */
export interface ActiveSubscription {
  id: string;
  connectionId: string;
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
  subscriptionFields: string[];
  redisChannels: string[];
  context?: SubscriptionContext;
  createdAt: number;
}

export interface SubscriptionContext {
  userId?: string;
  headers?: Record<string, string>;
  authorization?: string;
  cookies?: string;
}

/**
 * Redis Event types
 */
export interface RedisEvent {
  channel: string;
  data: any;
  timestamp: number;
  subscriptionId?: string;
}

export interface RedisEventPayload {
  type: string;
  data: any;
  meta?: Record<string, any>;
}

/**
 * Configuration types
 */
export interface ServerConfig {
  port: number;
  host: string;
  wpgraphqlEndpoint: string;
  wpgraphqlIntrospectionEndpoint: string;
  subscriptionSecret: string;
  corsOrigin: string[];
  requestTimeout: number;
  sseHeartbeatInterval: number;
  sseConnectionTimeout: number;
  logLevel: string;
  logPretty: boolean;
  nodeEnv: string;
  redis: {
    url: string;
    keyPrefix: string;
  };
}

/**
 * Content negotiation types
 */
export interface ContentNegotiation {
  acceptsHtml: boolean;
  acceptsJson: boolean;
  acceptsEventStream: boolean;
  method: 'GET' | 'POST' | 'OPTIONS';
}

/**
 * GraphQL Schema types
 */
export interface SchemaIntrospection {
  data?: {
    __schema: {
      subscriptionType?: {
        name: string;
        fields: Array<{
          name: string;
          type: any;
          args: any[];
        }>;
      };
      queryType?: {
        name: string;
      };
      mutationType?: {
        name: string;
      };
    };
  };
  errors?: GraphQLError[];
}

/**
 * Security types
 */
export interface SubscriptionToken {
  subscriptionId: string;
  timestamp: number;
  hmac: string;
}

export interface RootValuePayload {
  subscriptionId: string;
  eventData: any;
  timestamp: number;
}

/**
 * WordPress Event types
 */
export interface WordPressEvent {
  node_type: string;
  action: string;
  node_id: number;
  context: Record<string, any>;
  metadata: {
    timestamp: number;
    event_id: string;
    user_id?: number;
    hook?: string;
  };
}
