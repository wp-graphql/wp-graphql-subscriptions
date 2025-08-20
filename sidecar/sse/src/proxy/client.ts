import fetch from 'node-fetch';
import { appConfig } from '../config.js';
import logger from '../logger.js';

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
  extensions?: Record<string, any>;
}

export interface GraphQLResponse {
  data?: any;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: Record<string, any>;
  }>;
}

export class WPGraphQLClient {
  private readonly endpoint: string;
  private readonly timeout: number;

  constructor() {
    this.endpoint = appConfig.wpgraphql.endpoint;
    this.timeout = appConfig.wpgraphql.timeout;
  }

  async execute(
    request: GraphQLRequest,
    headers: Record<string, string> = {}
  ): Promise<GraphQLResponse> {
    logger.debug({ operationName: request.operationName }, 'Executing GraphQL request');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`WPGraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as GraphQLResponse;
      
      if (result.errors && result.errors.length > 0) {
        logger.debug({ errors: result.errors }, 'GraphQL response contains errors');
      }

      return result;
    } catch (error) {
      logger.error({ error, operationName: request.operationName }, 'WPGraphQL request failed');
      throw error;
    }
  }
}
