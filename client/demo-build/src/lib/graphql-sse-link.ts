import { ApolloLink, Operation, NextLink, Observable, FetchResult } from '@apollo/client';
import { GraphQLSSEClient, GraphQLSSEClientConfig } from './graphql-sse-client';

export interface GraphQLSSELinkConfig extends GraphQLSSEClientConfig {
  // Additional Apollo-specific configuration can go here
}

export class GraphQLSSELink extends ApolloLink {
  private client: GraphQLSSEClient;
  private operationCounter = 0;

  constructor(config: GraphQLSSELinkConfig = {}) {
    super();
    this.client = new GraphQLSSEClient(config);
  }

  public request(operation: Operation, forward?: NextLink): Observable<FetchResult> | null {
    // Only handle subscription operations
    if (operation.query.definitions[0].kind !== 'OperationDefinition' || 
        operation.query.definitions[0].operation !== 'subscription') {
      return forward ? forward(operation) : null;
    }

    return new Observable((observer) => {
      let subscription: { unsubscribe: () => void } | null = null;
      let isActive = true;

      const setupSubscription = async () => {
        try {
          // Verify the client is actually connected
          const connectionState = this.client.getConnectionState();
          console.log('Apollo Link checking connection state:', connectionState);
          
          if (connectionState.state !== 'connected') {
            throw new Error('GraphQL-SSE client is not connected. Connection state: ' + connectionState.state);
          }
          
          if (!isActive) return;

          const operationId = `apollo-sub-${++this.operationCounter}`;
          const query = operation.query.loc?.source.body || '';
          const variables = operation.variables || {};

          console.log('Apollo Link setting up subscription:', operationId);
          
          // Create the subscription
          const subscriptionPromise = this.client.subscribe(operationId, query, variables);
          const sub = await subscriptionPromise;
          
          if (!isActive) return;

          console.log('Apollo Link registering subscription observer for:', operationId);
          
          // Subscribe to the GraphQL-SSE client immediately after operation
          subscription = sub.subscribe({
            next: (result) => {
              if (!isActive) return;
              
              console.log('Apollo Link received result:', result);
              
              // Handle subscription confirmation
              if (result.data?.subscription) {
                console.log('Apollo subscription confirmed:', result.data.subscription);
                // Send a "ready" signal to Apollo to exit loading state
                observer.next({ data: null });
                return;
              }
              
              // Forward actual data to Apollo
              observer.next(result as FetchResult);
            },
            error: (error) => {
              if (!isActive) return;
              console.error('Apollo Link subscription error:', error);
              observer.error(error);
            },
            complete: () => {
              if (!isActive) return;
              console.log('Apollo Link subscription completed');
              observer.complete();
            }
          });

        } catch (error) {
          if (!isActive) return;
          console.error('Apollo Link setup error:', error);
          observer.error(error);
        }
      };

      setupSubscription();

      // Return cleanup function
      return () => {
        isActive = false;
        if (subscription && subscription.unsubscribe) {
          subscription.unsubscribe();
        }
      };
    });
  }

  public setOnError(fn: (message: string, ...args: any[]) => void): void {
    this.client.onError = fn;
  }

  public dispose(): void {
    this.client.disconnect();
  }

  public getClient(): GraphQLSSEClient {
    return this.client;
  }
}