import { config } from 'dotenv';

// Load environment variables
config();

export interface Config {
  wpgraphql: {
    endpoint: string;
    timeout: number;
    retries: number;
  };
  redis: {
    url: string;
    keyPrefix: string;
  };
  server: {
    port: number;
    cors: boolean;
    subscriptionTimeout: number;
    sseKeepAlive: number;
  };
  schema: {
    cacheTTL: number;
    introspectionInterval: number;
  };
  auth: {
    jwtSecret?: string;
    validateTokens: boolean;
  };
}

export const appConfig: Config = {
  wpgraphql: {
    endpoint: process.env.WPGRAPHQL_ENDPOINT || 'http://localhost/graphql',
    timeout: parseInt(process.env.WPGRAPHQL_TIMEOUT || '10000'),
    retries: parseInt(process.env.WPGRAPHQL_RETRIES || '3'),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'wpgraphql:subscriptions:',
  },
  server: {
    port: parseInt(process.env.PORT || '4000'),
    cors: process.env.CORS_ENABLED !== 'false',
    subscriptionTimeout: parseInt(process.env.SUBSCRIPTION_TIMEOUT || '30000'),
    sseKeepAlive: parseInt(process.env.SSE_KEEP_ALIVE || '30000'),
  },
  schema: {
    cacheTTL: parseInt(process.env.SCHEMA_CACHE_TTL || '300'),
    introspectionInterval: parseInt(process.env.SCHEMA_INTROSPECTION_INTERVAL || '300000'),
  },
  auth: {
    ...(process.env.JWT_SECRET ? { jwtSecret: process.env.JWT_SECRET } : {}),
    validateTokens: process.env.VALIDATE_TOKENS !== 'false',
  },
};
