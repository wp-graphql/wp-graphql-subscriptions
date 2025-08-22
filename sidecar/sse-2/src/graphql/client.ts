/**
 * WPGraphQL client for executing subscription queries
 */

import fetch from 'node-fetch';
import type { Logger } from 'pino';
import type { ServerConfig, GraphQLRequest, GraphQLResponse } from '../types/index.js';

export class WPGraphQLClient {
  private config: ServerConfig;
  private logger: Logger;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Execute a GraphQL request against WPGraphQL
   */
  async executeRequest(
    graphqlRequest: GraphQLRequest,
    headers: Record<string, string> = {},
    rootValue?: any
  ): Promise<GraphQLResponse> {
    try {
      // Build request payload
      const requestBody: any = {
        query: graphqlRequest.query,
        variables: graphqlRequest.variables,
        operationName: graphqlRequest.operationName,
      };

      // Add root value for subscription execution
      // WPGraphQL doesn't seem to support extensions.root_value, so let's try a different approach
      if (rootValue) {
        // Try setting rootValue directly in the request body
        (requestBody as any).rootValue = rootValue;
        
        // Also try in extensions for compatibility
        requestBody.extensions = {
          root_value: rootValue
        };
      }

      this.logger.debug({
        endpoint: this.config.wpgraphqlEndpoint,
        query: graphqlRequest.query?.substring(0, 100) + '...',
        variables: graphqlRequest.variables,
        hasRootValue: !!rootValue,
        rootValue: rootValue,
        requestBody: requestBody
      }, 'Executing GraphQL request');

      // Make request to WPGraphQL
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);
      
      const response = await fetch(this.config.wpgraphqlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WPGraphQL-SSE-Server/0.1.0',
          ...headers,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as GraphQLResponse;
      
      this.logger.debug({
        hasData: !!result.data,
        hasErrors: !!result.errors,
        errorCount: result.errors?.length || 0
      }, 'GraphQL request completed');

      return result;

    } catch (error) {
      this.logger.error({
        error,
        endpoint: this.config.wpgraphqlEndpoint,
        query: graphqlRequest.query?.substring(0, 100)
      }, 'GraphQL request failed');

      return {
        data: null,
        errors: [{
          message: error instanceof Error ? error.message : 'Unknown error',
          extensions: {
            code: 'NETWORK_ERROR'
          }
        }]
      };
    }
  }

  /**
   * Execute a subscription query with event data as rootValue
   */
  async executeSubscription(
    subscriptionQuery: string,
    variables: Record<string, any>,
    operationName: string | undefined,
    eventData: any,
    headers: Record<string, string> = {}
  ): Promise<GraphQLResponse> {
    this.logger.debug({
      subscriptionQuery: subscriptionQuery.substring(0, 100) + '...',
      variables,
      operationName,
      eventData: Object.keys(eventData)
    }, 'Executing subscription with event data');

    return this.executeRequest(
      {
        query: subscriptionQuery,
        variables,
        operationName: operationName || undefined
      },
      headers,
      eventData
    );
  }
}