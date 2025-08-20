import { parse, OperationDefinitionNode, DocumentNode } from 'graphql';

/**
 * Utility functions for GraphQL operation handling
 */

/**
 * Detects the operation type from a GraphQL query string using AST parsing
 * Returns 'query', 'mutation', 'subscription', or null if unable to determine
 */
export function getOperationType(query: string): 'query' | 'mutation' | 'subscription' | null {
  try {
    const document: DocumentNode = parse(query);
    
    // Find the first operation definition
    const operationDefinition = document.definitions.find(
      (definition): definition is OperationDefinitionNode =>
        definition.kind === 'OperationDefinition'
    );
    
    if (!operationDefinition) {
      return null;
    }
    
    // Return the operation type from AST
    return operationDefinition.operation;
  } catch (error) {
    // If parsing fails, fall back to simple string matching as last resort
    const trimmedQuery = query.trim().toLowerCase();
    
    if (trimmedQuery.startsWith('subscription')) {
      return 'subscription';
    }
    
    if (trimmedQuery.startsWith('mutation')) {
      return 'mutation';
    }
    
    if (trimmedQuery.startsWith('query') || trimmedQuery.startsWith('{')) {
      return 'query';
    }
    
    return null;
  }
}

/**
 * Checks if a GraphQL operation is a subscription using AST parsing
 */
export function isSubscriptionOperation(query: string): boolean {
  return getOperationType(query) === 'subscription';
}

/**
 * Parses a GraphQL query and returns the AST document
 * Returns null if parsing fails
 */
export function parseGraphQLQuery(query: string): DocumentNode | null {
  try {
    return parse(query);
  } catch (error) {
    return null;
  }
}
