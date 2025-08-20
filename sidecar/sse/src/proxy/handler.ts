import type { GraphQLRequest, GraphQLResponse } from './client.js';
import { WPGraphQLClient } from './client.js';
import logger from '../logger.js';

export class ProxyHandler {
  private client: WPGraphQLClient;

  constructor() {
    this.client = new WPGraphQLClient();
  }

  async handleRequest(
    request: GraphQLRequest,
    context: {
      headers?: Record<string, string>;
      userId?: string;
    } = {}
  ): Promise<GraphQLResponse> {
    logger.debug({ operationName: request.operationName }, 'Proxying request to WPGraphQL');

    // Forward authentication headers
    const headers: Record<string, string> = {};
    
    if (context.headers?.authorization) {
      headers.authorization = context.headers.authorization;
    }

    if (context.headers?.cookie) {
      headers.cookie = context.headers.cookie;
    }

    // Add user context if available
    if (context.userId) {
      headers['x-user-id'] = context.userId;
    }

    try {
      const response = await this.client.execute(request, headers);
      
      logger.debug(
        { 
          operationName: request.operationName,
          hasData: !!response.data,
          errorCount: response.errors?.length || 0
        },
        'Request proxied successfully'
      );

      return response;
    } catch (error) {
      logger.error({ error, operationName: request.operationName }, 'Proxy request failed');
      
      return {
        errors: [{
          message: 'Failed to connect to WPGraphQL server',
          extensions: {
            code: 'WPGRAPHQL_CONNECTION_ERROR',
            originalError: error instanceof Error ? error.message : String(error)
          }
        }]
      };
    }
  }
}
