import React, { useState, useRef, useEffect } from 'react';
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';
import { GraphQLSSELink } from './lib/graphql-sse-link';
import { ConnectionStatus } from './components/ConnectionStatus';
import { PostSubscription } from './components/PostSubscription';
import { ConnectionState } from './lib/graphql-sse-client';
import './App.css';

// Create Apollo Link with GraphQL-SSE
const sseLink = new GraphQLSSELink({
  baseUrl: '/graphql/stream',
  debug: true,
});

const client = new ApolloClient({
  link: sseLink,
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      errorPolicy: 'all'
    }
  }
});

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error' | 'debug';
  timestamp: string;
}

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isConnected, setIsConnected] = useState(false);
  const [postId, setPostId] = useState('394');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
    setTimeout(() => {
      logsRef.current?.scrollTo(0, logsRef.current.scrollHeight);
    }, 100);
  };

  const connect = async () => {
    try {
      addLog('Connecting to GraphQL-SSE...', 'info');
      const sseClient = sseLink.getClient();
      await sseClient.makeReservation();
      await sseClient.connect();
      setIsConnected(true);
      addLog('Connected successfully!', 'success');
    } catch (error) {
      addLog(`Connection failed: ${(error as Error).message}`, 'error');
    }
  };

  const disconnect = () => {
    const sseClient = sseLink.getClient();
    sseClient.disconnect();
    setIsConnected(false);
    addLog('Disconnected', 'info');
  };

  useEffect(() => {
    // Setup logging for the shared SSE client
    const sseClient = sseLink.getClient();
    
    sseClient.onConnectionChange = (state: ConnectionState) => {
      setConnectionState(state);
      addLog(`Connection state: ${state}`, 'info');
    };

    const originalOnError = sseClient.onError || console.error;
    sseClient.onError = (message: string, ...args: any[]) => {
      addLog(`Error: ${message}`, 'error');
      originalOnError(message, ...args);
    };

    const originalOnDebug = sseClient.onDebug || (() => {});
    sseClient.onDebug = (message: string, ...args: any[]) => {
      addLog(`Debug: ${message}`, 'debug');
      originalOnDebug(message, ...args);
    };
  }, []);

  const token = sseLink.getClient().getConnectionState().token;

  return (
    <ApolloProvider client={client}>
      <div className="app">
        <header>
          <h1>🚀 WPGraphQL Subscriptions - Production Demo</h1>
          <p>Built with TypeScript, Vite, and Real Apollo Client</p>
        </header>
        
        <div className="container">
          <ConnectionStatus state={connectionState} token={token} />
          
          <div className="controls">
            <button 
              className="connect" 
              onClick={connect} 
              disabled={isConnected || connectionState === 'connecting'}
            >
              Connect
            </button>
            <button 
              className="disconnect" 
              onClick={disconnect} 
              disabled={!isConnected}
            >
              Disconnect
            </button>
            <input 
              type="text" 
              value={postId} 
              onChange={(e) => setPostId(e.target.value)}
              placeholder="Post ID"
              className="post-id-input"
            />
          </div>
        </div>

        {connectionState === 'connected' && (
          <div className="container">
            <div style={{ marginBottom: '16px', padding: '12px', background: '#e3f2fd', borderRadius: '4px' }}>
              <strong>Debug Info:</strong><br />
              App connection state: {connectionState}<br />
              Apollo Link client state: {sseLink.getClient().getConnectionState().state}<br />
              Same client instance: {sseLink.getClient() === sseLink.getClient() ? 'Yes' : 'No'}
            </div>
            <PostSubscription postId={postId} />
          </div>
        )}

        <div className="container">
          <h3>Debug Logs</h3>
          <div className="logs" ref={logsRef}>
            {logs.map((log, index) => (
              <div key={index} className={`log-entry log-${log.type}`}>
                <span className="timestamp">[{log.timestamp}]</span>
                <span className="message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ApolloProvider>
  );
}

export default App;