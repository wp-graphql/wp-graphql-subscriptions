import React from 'react';
import { ConnectionState } from '../lib/graphql-sse-client';

interface ConnectionStatusProps {
  state: ConnectionState;
  token?: string | null;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ state, token }) => {
  const getStatusClass = () => {
    switch (state) {
      case 'connected': return 'connected';
      case 'connecting': return 'connecting';
      case 'error': return 'error';
      default: return 'disconnected';
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'connected': return 'CONNECTED';
      case 'connecting': return 'CONNECTING...';
      case 'error': return 'ERROR';
      default: return 'DISCONNECTED';
    }
  };

  return (
    <div className={`status ${getStatusClass()}`}>
      <div className="status-indicator" />
      <span>Status: {getStatusText()}</span>
      {token && (
        <span className="token"> | Token: {token.substring(0, 8)}...</span>
      )}
    </div>
  );
};