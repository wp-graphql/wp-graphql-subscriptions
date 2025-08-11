/**
 * GraphQL-SSE Client Library
 * 
 * A JavaScript client for GraphQL-SSE protocol subscriptions
 * Compatible with Apollo Client and other GraphQL clients
 */

export class GraphQLSSEClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || '/graphql/stream';
    this.debug = config.debug || false;
    this.reconnectAttempts = config.reconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
    this.headers = config.headers || {};
    
    // Internal state
    this.connectionToken = null;
    this.eventSource = null;
    this.subscriptions = new Map();
    this.connectionState = 'disconnected'; // disconnected, connecting, connected, error
    this.reconnectCount = 0;
    
    // Event handlers
    this.onConnectionChange = config.onConnectionChange || (() => {});
    this.onError = config.onError || console.error;
    this.onDebug = config.onDebug || (this.debug ? console.log : () => {});
  }

  /**
   * Step 1: Make reservation (PUT)
   */
  async makeReservation() {
    try {
      this.onDebug('Making GraphQL-SSE reservation...');
      
      const response = await fetch(this.baseUrl, {
        method: 'PUT',
        headers: this.headers
      });

      if (!response.ok) {
        throw new Error(`Reservation failed: ${response.status} ${response.statusText}`);
      }

      this.connectionToken = await response.text();
      this.onDebug('Reservation successful:', this.connectionToken);
      
      return this.connectionToken;
    } catch (error) {
      this.onError('Reservation error:', error);
      throw error;
    }
  }

  /**
   * Step 2: Execute GraphQL operation (POST)
   */
  async executeOperation(operationId, query, variables = {}) {
    if (!this.connectionToken) {
      throw new Error('Must make reservation before executing operations');
    }

    try {
      this.onDebug('Executing GraphQL operation:', operationId);
      
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GraphQL-Event-Stream-Token': this.connectionToken,
          ...this.headers
        },
        body: JSON.stringify({
          query,
          variables,
          extensions: {
            operationId
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Operation failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      this.onDebug('Operation accepted:', result);
      
      return result;
    } catch (error) {
      this.onError('Operation error:', error);
      throw error;
    }
  }

  /**
   * Step 3: Establish SSE connection (GET)
   */
  async connect() {
    if (!this.connectionToken) {
      throw new Error('Must make reservation before connecting');
    }

    if (this.eventSource) {
      this.disconnect();
    }

    try {
      this.connectionState = 'connecting';
      this.onConnectionChange(this.connectionState);
      
      const sseUrl = `${this.baseUrl}?token=${encodeURIComponent(this.connectionToken)}`;
      this.onDebug('Establishing SSE connection:', sseUrl);
      
      this.eventSource = new EventSource(sseUrl);
      
      this.eventSource.onopen = () => {
        this.connectionState = 'connected';
        this.reconnectCount = 0;
        this.onConnectionChange(this.connectionState);
        this.onDebug('SSE connection established');
      };

      this.eventSource.onmessage = (event) => {
        this.handleSSEMessage(event);
      };

      this.eventSource.onerror = (error) => {
        this.onError('SSE connection error:', error);
        this.connectionState = 'error';
        this.onConnectionChange(this.connectionState);
        
        // Attempt reconnection
        this.attemptReconnection();
      };

    } catch (error) {
      this.connectionState = 'error';
      this.onConnectionChange(this.connectionState);
      this.onError('Connection error:', error);
      throw error;
    }
  }

  /**
   * Handle incoming SSE messages
   */
  handleSSEMessage(event) {
    try {
      const data = JSON.parse(event.data);
      this.onDebug('Received SSE message:', data);

      // Handle different message types
      switch (data.type || event.type) {
        case 'test':
          this.onDebug('Connection test successful:', data);
          break;
          
        case 'next':
          this.handleNextEvent(data);
          break;
          
        case 'complete':
          this.handleCompleteEvent(data);
          break;
          
        case 'error':
          this.handleErrorEvent(data);
          break;
          
        default:
          // Handle messages without explicit type (legacy format)
          if (data.id && data.payload) {
            this.handleNextEvent(data);
          } else {
            this.onDebug('Unknown message type:', data);
          }
      }
    } catch (error) {
      this.onError('Error parsing SSE message:', error, event.data);
    }
  }

  /**
   * Handle 'next' events (subscription data)
   */
  handleNextEvent(data) {
    const operationId = data.id;
    const subscription = this.subscriptions.get(operationId);
    
    if (subscription && subscription.observer) {
      subscription.observer.next(data.payload);
    } else {
      this.onDebug('No subscription found for operation:', operationId);
    }
  }

  /**
   * Handle 'complete' events
   */
  handleCompleteEvent(data) {
    const operationId = data.id;
    const subscription = this.subscriptions.get(operationId);
    
    if (subscription && subscription.observer) {
      subscription.observer.complete();
      this.subscriptions.delete(operationId);
    }
  }

  /**
   * Handle 'error' events
   */
  handleErrorEvent(data) {
    const operationId = data.id;
    const subscription = this.subscriptions.get(operationId);
    
    if (subscription && subscription.observer) {
      subscription.observer.error(new Error(data.payload?.message || 'Subscription error'));
    } else {
      this.onError('Subscription error:', data.payload);
    }
  }

  /**
   * Subscribe to a GraphQL subscription
   */
  async subscribe(operationId, query, variables = {}) {
    // Execute the operation first
    await this.executeOperation(operationId, query, variables);

    // Return an observable-like object
    return {
      subscribe: (observer) => {
        // Store the subscription
        this.subscriptions.set(operationId, {
          query,
          variables,
          observer,
          createdAt: Date.now()
        });

        this.onDebug('Subscription registered:', operationId);

        // Return unsubscribe function
        return {
          unsubscribe: () => {
            this.subscriptions.delete(operationId);
            this.onDebug('Subscription removed:', operationId);
          }
        };
      }
    };
  }

  /**
   * Attempt reconnection with exponential backoff
   */
  async attemptReconnection() {
    if (this.reconnectCount >= this.reconnectAttempts) {
      this.onError('Max reconnection attempts reached');
      return;
    }

    this.reconnectCount++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectCount - 1);
    
    this.onDebug(`Reconnecting in ${delay}ms (attempt ${this.reconnectCount}/${this.reconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        // Re-establish the entire connection flow
        await this.makeReservation();
        
        // Re-register all subscriptions
        const subscriptionsToRestore = Array.from(this.subscriptions.entries());
        
        for (const [operationId, subscription] of subscriptionsToRestore) {
          await this.executeOperation(operationId, subscription.query, subscription.variables);
        }
        
        await this.connect();
      } catch (error) {
        this.onError('Reconnection failed:', error);
        this.attemptReconnection();
      }
    }, delay);
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.connectionState = 'disconnected';
    this.onConnectionChange(this.connectionState);
    this.connectionToken = null;
    this.reconnectCount = 0;
    
    // Complete all active subscriptions
    for (const [operationId, subscription] of this.subscriptions) {
      if (subscription.observer) {
        subscription.observer.complete();
      }
    }
    this.subscriptions.clear();
    
    this.onDebug('Disconnected and cleaned up');
  }

  /**
   * Get current connection state
   */
  getConnectionState() {
    return {
      state: this.connectionState,
      token: this.connectionToken,
      activeSubscriptions: this.subscriptions.size,
      reconnectCount: this.reconnectCount
    };
  }
}

/**
 * Apollo Client Link for GraphQL-SSE
 */
export class GraphQLSSELink {
  constructor(config = {}) {
    this.client = new GraphQLSSEClient(config);
    this.operationCounter = 0;
  }

  request(operation, forward) {
    // Only handle subscriptions
    if (operation.query.definitions[0].operation !== 'subscription') {
      return forward ? forward(operation) : null;
    }

    return new Promise(async (resolve, reject) => {
      try {
        // Ensure connection is established
        if (this.client.connectionState !== 'connected') {
          await this.client.makeReservation();
          await this.client.connect();
        }

        const operationId = `apollo-sub-${++this.operationCounter}`;
        const query = operation.query.loc.source.body;
        const variables = operation.variables || {};

        const subscription = await this.client.subscribe(operationId, query, variables);

        resolve(subscription);
      } catch (error) {
        reject(error);
      }
    });
  }

  // Apollo Link interface methods
  setOnError(fn) {
    this.client.onError = fn;
  }

  dispose() {
    this.client.disconnect();
  }
}

/**
 * Convenience function for quick setup
 */
export function createGraphQLSSEClient(config) {
  return new GraphQLSSEClient(config);
}

export function createApolloSSELink(config) {
  return new GraphQLSSELink(config);
}