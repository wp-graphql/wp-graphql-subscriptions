import React from 'react';
import { GraphiQL } from 'graphiql';
import { parse } from 'graphql';
import 'graphiql/graphiql.css';

interface GraphQLParams {
  query: string;
  variables?: Record<string, any>;
  operationName?: string | null;
}

// Create SSE subscription async generator
async function* createSSESubscription(params: GraphQLParams) {
  console.log('Custom GraphiQL: Starting SSE subscription');
  
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let isActive = true;
  let eventCount = 0;

  try {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(params),
    });

    console.log('Custom GraphiQL: Response status:', response.status);

    if (!response.ok) {
      // For validation errors, try to parse the JSON error response
      if (response.status === 400) {
        try {
          const errorResponse = await response.json();
          console.log('Custom GraphiQL: Validation error:', errorResponse);
          
          // Yield the error response so GraphiQL can display it
          yield errorResponse;
          return;
        } catch (parseError) {
          console.error('Custom GraphiQL: Failed to parse error response:', parseError);
        }
      }
      
      // For other errors, throw with status info
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    reader = response.body!.getReader();
    const decoder = new TextDecoder();

    console.log('Custom GraphiQL: SSE connection established');

    while (isActive) {
      const { done, value } = await reader.read();

      if (done) {
        console.log('Custom GraphiQL: SSE stream ended after', eventCount, 'events');
        break;
      }

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && line.length > 6) {
          try {
            const dataStr = line.substring(6);
            const data = JSON.parse(dataStr);

            // Skip the initial "Subscription established" message to keep spinner
            if (data.data && data.data.message && data.data.message.includes('Subscription established')) {
              console.log('Custom GraphiQL: Skipping initial connection message');
              continue;
            }

            eventCount++;
            console.log('Custom GraphiQL: Event #' + eventCount + ', yielding data:', data);
            yield data;
          } catch (e) {
            console.warn('Custom GraphiQL: Failed to parse SSE data:', line, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Custom GraphiQL: Subscription error:', error);
    throw error;
  } finally {
    isActive = false;
    if (reader) {
      try {
        await reader.cancel();
        console.log('Custom GraphiQL: SSE connection cleaned up');
      } catch (e) {
        console.warn('Custom GraphiQL: Error during cleanup:', e);
      }
    }
  }
}

// Standard fetch for queries and mutations
async function standardFetch(params: GraphQLParams) {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// Custom fetcher with proper GraphQL AST parsing
const customFetcher = async (graphQLParams: GraphQLParams) => {
  console.log('Custom GraphiQL: Fetcher called with:', { 
    query: graphQLParams.query.substring(0, 100) + '...', 
    operationName: graphQLParams.operationName 
  });

  try {
    // Use GraphQL AST parsing for accurate operation detection
    const ast = parse(graphQLParams.query);
    console.log('Custom GraphiQL: AST parsed successfully');

    // Find the operation definition
    const operationDef = ast.definitions.find(def => 
      def.kind === 'OperationDefinition'
    );

    if (operationDef) {
      const operationType = operationDef.operation;
      console.log('Custom GraphiQL: Operation type from AST:', operationType);

      if (operationType === 'subscription') {
        console.log('Custom GraphiQL: Setting up subscription');
        return createSSESubscription(graphQLParams);
      }
    }

    // Handle queries and mutations
    console.log('Custom GraphiQL: Using standard fetch');
    return standardFetch(graphQLParams);

  } catch (parseError) {
    console.error('Custom GraphiQL: GraphQL parse error:', parseError);
    
    // Fallback to enhanced regex detection
    const query = graphQLParams.query.trim();
    const commentStripped = query.replace(/^\s*#[^\n]*\n/gm, '').trim();
    
    const patterns = [
      /^\s*(subscription)\s+\w+/i,
      /^\s*(subscription)\s*\{/i,
      /^\s*(subscription)\s*\(/i,
    ];
    
    for (const pattern of patterns) {
      const match = commentStripped.match(pattern);
      if (match) {
        console.log('Custom GraphiQL: Fallback detected subscription');
        return createSSESubscription(graphQLParams);
      }
    }

    // Default to standard fetch
    return standardFetch(graphQLParams);
  }
};

export default function CustomGraphiQL() {
  return (
    <GraphiQL 
      fetcher={customFetcher}
      defaultQuery={`# Welcome to WPGraphQL Subscriptions IDE!
# 
# This custom GraphiQL interface supports real-time GraphQL subscriptions.
# Try these example subscriptions:

# 1. Subscribe to post updates
subscription PostUpdated($id: ID!) {
  postUpdated(id: $id) {
    id
    title
    modified
    content
    author {
      node {
        name
      }
    }
  }
}

# 2. Subscribe to new comments on any node (post, page, etc)
subscription CommentAdded($nodeId: ID!) {
  commentAdded(nodeId: $nodeId) {
    id
    content
    date
    author {
      node {
        name
        email
      }
    }
    commentedOn {
      node {
        id
        title
      }
    }
  }
}

# Variables for post updates:
# { "id": "147" }

# Variables for comment subscription:
# { "nodeId": "147" }

# After running a subscription:
# - For posts: Edit post 147 in WordPress to see updates
# - For comments: Add a comment to node 147 (post/page/etc) to see new comments`}
    />
  );
}
