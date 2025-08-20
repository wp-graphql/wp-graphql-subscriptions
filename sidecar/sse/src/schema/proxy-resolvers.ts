import type { GraphQLFieldResolver } from 'graphql';
import { ProxyHandler } from '../proxy/handler.js';
import logger from '../logger.js';

/**
 * Creates a proxy resolver that forwards operations to WPGraphQL
 */
export function createProxyResolver(proxyHandler: ProxyHandler): GraphQLFieldResolver<any, any> {
  return async (source, args, context, info) => {
    // For subscription fields, return null for now (we'll implement these in Phase 1.4)
    if (info.parentType.name === 'RootSubscription') {
      logger.debug(`Subscription field ${info.fieldName} not yet implemented`);
      return null;
    }

    // Build the GraphQL operation for this field
    const operation = buildOperationFromInfo(info, args);
    
    logger.debug(
      { 
        operation: info.operation.operation,
        fieldName: info.fieldName,
        parentType: info.parentType.name 
      },
      'Proxying operation to WPGraphQL'
    );

    try {
      // Forward the request to WPGraphQL
      const request: any = {
        query: operation,
        variables: {}, // Variables are already resolved in args
      };
      
      // Add operationName only if it exists
      if (info.operation.name?.value) {
        request.operationName = info.operation.name.value;
      }

      const response = await proxyHandler.handleRequest(
        request,
        {
          headers: context.headers || {},
          userId: context.userId,
        }
      );

      // Handle GraphQL errors
      if (response.errors && response.errors.length > 0) {
        // Forward GraphQL errors to the client
        for (const error of response.errors) {
          throw new Error(error.message);
        }
      }

      // Return the data for this specific field
      const fieldData = response.data?.[info.fieldName];
      return fieldData;
    } catch (error) {
      logger.error(
        { 
          error, 
          fieldName: info.fieldName,
          parentType: info.parentType.name 
        },
        'Proxy resolver failed'
      );
      throw error;
    }
  };
}

/**
 * Builds a GraphQL operation string from GraphQL execution info
 * This reconstructs the query/mutation that should be sent to WPGraphQL
 */
function buildOperationFromInfo(info: any, args: any): string {
  const operationType = info.operation.operation; // 'query' or 'mutation'
  const fieldName = info.fieldName;
  
  // Build arguments string
  const argsString = buildArgumentsString(args);
  
  // Build selection set (requested fields)
  const selectionSet = buildSelectionSet(info.fieldNodes[0].selectionSet);
  
  // Construct the operation
  const operation = `
    ${operationType} {
      ${fieldName}${argsString} ${selectionSet}
    }
  `;

  return operation;
}

/**
 * Converts resolver arguments to GraphQL argument string
 */
function buildArgumentsString(args: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) {
    return '';
  }

  const argPairs = Object.entries(args).map(([key, value]) => {
    const serializedValue = serializeArgumentValue(value);
    return `${key}: ${serializedValue}`;
  });

  return `(${argPairs.join(', ')})`;
}

/**
 * Serializes argument values for GraphQL
 */
function serializeArgumentValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  
  if (Array.isArray(value)) {
    const items = value.map(serializeArgumentValue);
    return `[${items.join(', ')}]`;
  }
  
  if (typeof value === 'object') {
    const pairs = Object.entries(value).map(([k, v]) => 
      `${k}: ${serializeArgumentValue(v)}`
    );
    return `{${pairs.join(', ')}}`;
  }
  
  return String(value);
}

/**
 * Builds selection set string from GraphQL selection set AST
 */
function buildSelectionSet(selectionSet: any): string {
  if (!selectionSet || !selectionSet.selections) {
    return '';
  }

  const selections = selectionSet.selections.map((selection: any) => {
    if (selection.kind === 'Field') {
      const fieldName = selection.name.value;
      const subSelectionSet = selection.selectionSet 
        ? buildSelectionSet(selection.selectionSet)
        : '';
      
      return `${fieldName}${subSelectionSet}`;
    }
    
    // Handle fragments, inline fragments, etc. (basic support)
    return '';
  }).filter(Boolean);

  return selections.length > 0 ? `{ ${selections.join(' ')} }` : '';
}
