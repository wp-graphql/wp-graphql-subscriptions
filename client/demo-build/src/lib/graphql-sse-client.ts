export interface GraphQLSSEClientConfig {
  baseUrl?: string;
  debug?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  headers?: Record<string, string>;
  onConnectionChange?: (state: ConnectionState) => void;
  onError?: (message: string, ...args: any[]) => void;
  onDebug?: (message: string, ...args: any[]) => void;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SubscriptionObserver<T = any> {
  next: (value: T) => void;
  error: (error: Error) => void;
  complete: () => void;
}

export interface Subscription {
  unsubscribe: () => void;
}

export interface GraphQLSSESubscription {
  subscribe: (observer: SubscriptionObserver) => Subscription;
}

interface StoredSubscription {
  query: string;
  variables: Record<string, any>;
  observer: SubscriptionObserver;
  createdAt: number;
}

export class GraphQLSSEClient {
  private baseUrl: string;
  private debug: boolean;
  private reconnectAttempts: number;
  private reconnectDelay: number;
  private headers: Record<string, string>;
  
  // Internal state
  private connectionToken: string | null = null;
  private eventSource: EventSource | null = null;
  private subscriptions = new Map<string, StoredSubscription>();
  private connectionState: ConnectionState = 'disconnected';
  private reconnectCount = 0;
  
  // Event handlers
  public onConnectionChange: (state: ConnectionState) => void;
  public onError: (message: string, ...args: any[]) => void;
  public onDebug: (message: string, ...args: any[]) => void;

  constructor(config: GraphQLSSEClientConfig = {}) {
    this.baseUrl = config.baseUrl || '/graphql/stream';
    this.debug = config.debug || false;
    this.reconnectAttempts = config.reconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
    this.headers = config.headers || {};
    
    this.onConnectionChange = config.onConnectionChange || (() => {});
    this.onError = config.onError || console.error;
    this.onDebug = config.onDebug || (this.debug ? console.log : () => {});
  }

  async makeReservation(): Promise<string> {
    try {
      this.onDebug('Making GraphQL-SSE reservation...');
      
      const response = await fetch(this.baseUrl, {
        method: 'PUT',
        headers: this.headers
      });

      if (!response.ok) {
        throw new Error(`Reservation failed: ${response.status} ${response.statusText}`);
      }

          const result = await response.json();
    this.connectionToken = result.token;
    this.onDebug('Reservation successful:', this.connectionToken);
      
      return this.connectionToken;
    } catch (error) {
      this.onError('Reservation error:', error);
      throw error;
    }
  }

  async executeOperation(operationId: string, query: string, variables: Record<string, any> = {}): Promise<any> {
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

  async connect(): Promise<void> {
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

      // Listen for specific event types (GraphQL-SSE protocol)
      this.eventSource.addEventListener('test', (event) => {
        this.handleSSEMessage(event);
      });

      this.eventSource.addEventListener('next', (event) => {
        this.handleSSEMessage(event);
      });

      this.eventSource.addEventListener('complete', (event) => {
        this.handleSSEMessage(event);
      });

      this.eventSource.onerror = (error) => {
        this.onError('SSE connection error:', error);
        this.connectionState = 'error';
        this.onConnectionChange(this.connectionState);
        this.attemptReconnection();
      };

    } catch (error) {
      this.connectionState = 'error';
      this.onConnectionChange(this.connectionState);
      this.onError('Connection error:', error);
      throw error;
    }
  }

  private handleSSEMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      this.onDebug('Received SSE message:', data);

      // Handle different message types
      if (data.type === 'test') {
        this.onDebug('Connection test successful:', data);
      } else if (data.id && data.payload) {
        this.onDebug('Processing next event:', data);
        this.handleNextEvent(data);
      } else {
        this.onDebug('Unhandled message type:', data);
      }
    } catch (error) {
      this.onError('Error parsing SSE message:', error, event.data);
    }
  }

  private handleNextEvent(data: { id: string; payload: any }): void {
    const operationId = data.id;
    const subscription = this.subscriptions.get(operationId);
    
    this.onDebug(`Looking for subscription ${operationId}, found:`, !!subscription);
    this.onDebug('Available subscriptions:', Array.from(this.subscriptions.keys()));
    this.onDebug('Payload to send:', data.payload);
    
    if (subscription && subscription.observer) {
      subscription.observer.next(data.payload);
    } else {
      this.onDebug('No subscription found for operation:', operationId);
    }
  }

  async subscribe(operationId: string, query: string, variables: Record<string, any> = {}): Promise<GraphQLSSESubscription> {
    this.onDebug('Starting subscription setup for:', operationId);
    await this.executeOperation(operationId, query, variables);
    this.onDebug('GraphQL operation executed for:', operationId);

    return {
      subscribe: (observer: SubscriptionObserver): Subscription => {
        this.onDebug('Registering observer for:', operationId);
        
        this.subscriptions.set(operationId, {
          query,
          variables,
          observer,
          createdAt: Date.now()
        });

        this.onDebug('Subscription registered:', operationId);
        this.onDebug('Total subscriptions now:', this.subscriptions.size);
        this.onDebug('All subscription IDs:', Array.from(this.subscriptions.keys()));

        return {
          unsubscribe: () => {
            this.subscriptions.delete(operationId);
            this.onDebug('Subscription removed:', operationId);
          }
        };
      }
    };
  }

  private async attemptReconnection(): Promise<void> {
    if (this.reconnectCount >= this.reconnectAttempts) {
      this.onError('Max reconnection attempts reached');
      return;
    }

    this.reconnectCount++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectCount - 1);
    
    this.onDebug(`Reconnecting in ${delay}ms (attempt ${this.reconnectCount}/${this.reconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        await this.makeReservation();
        
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

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.connectionState = 'disconnected';
    this.onConnectionChange(this.connectionState);
    this.connectionToken = null;
    this.reconnectCount = 0;
    
    for (const [operationId, subscription] of this.subscriptions) {
      if (subscription.observer) {
        subscription.observer.complete();
      }
    }
    this.subscriptions.clear();
    
    this.onDebug('Disconnected and cleaned up');
  }

  getConnectionState() {
    return {
      state: this.connectionState,
      token: this.connectionToken,
      activeSubscriptions: this.subscriptions.size,
      reconnectCount: this.reconnectCount
    };
  }
}