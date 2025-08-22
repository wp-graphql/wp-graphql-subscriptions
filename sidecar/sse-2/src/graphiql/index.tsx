import React from 'react';
import { createRoot } from 'react-dom/client';
import CustomGraphiQL from './CustomGraphiQL';

console.log('WPGraphQL Subscriptions IDE: Initializing...');

const container = document.getElementById('graphiql');
if (container) {
  const root = createRoot(container);
  root.render(<CustomGraphiQL />);
  console.log('WPGraphQL Subscriptions IDE: Initialized successfully');
} else {
  console.error('WPGraphQL Subscriptions IDE: Could not find #graphiql container');
}
