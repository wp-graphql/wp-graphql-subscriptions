/**
 * GraphQL document parsing and validation utilities
 */

import { parse, validate } from 'graphql';
import type { OperationDefinitionNode, DocumentNode } from 'graphql';
import type { Logger } from 'pino';

export interface ParsedOperation {
  document: DocumentNode;
  operation: OperationDefinitionNode;
  operationType: 'query' | 'mutation' | 'subscription';
  operationName?: string | undefined;
  variables?: Record<string, any>;
}

export class GraphQLParser {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Parse and validate GraphQL document
   */
  parseDocument(query: string): ParsedOperation {
    try {
      // Parse the document
      const document = parse(query);

      // Find the operation definition
      const operationDefinition = document.definitions.find(
        (def): def is OperationDefinitionNode => def.kind === 'OperationDefinition'
      );

      if (!operationDefinition) {
        throw new Error('No operation definition found in document');
      }

      // Determine operation type
      const operationType = operationDefinition.operation;

      return {
        document,
        operation: operationDefinition,
        operationType,
        operationName: operationDefinition.name?.value,
      };

    } catch (error) {
      this.logger.error({ error, query: query.substring(0, 100) }, 'Failed to parse GraphQL document');
      throw new Error(`GraphQL parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that operation is a subscription
   */
  validateSubscription(parsedOperation: ParsedOperation): void {
    if (parsedOperation.operationType !== 'subscription') {
      throw new Error(`Only subscription operations are supported. Received: ${parsedOperation.operationType}`);
    }

    // Additional subscription-specific validation could go here
    const { operation } = parsedOperation;
    
    if (!operation.selectionSet || operation.selectionSet.selections.length === 0) {
      throw new Error('Subscription must have at least one field selection');
    }
  }

  /**
   * Extract subscription field names from parsed operation
   */
  extractSubscriptionFields(parsedOperation: ParsedOperation): string[] {
    const fields: string[] = [];
    
    const extractFields = (selectionSet: any): void => {
      for (const selection of selectionSet.selections) {
        if (selection.kind === 'Field') {
          fields.push(selection.name.value);
        }
        if (selection.selectionSet) {
          extractFields(selection.selectionSet);
        }
      }
    };

    extractFields(parsedOperation.operation.selectionSet);
    return fields;
  }

  /**
   * Simple regex-based operation type detection (for client-side use)
   */
  static detectOperationType(query: string): 'query' | 'mutation' | 'subscription' {
    const trimmed = query.trim();
    
    // Check for explicit operation type
    const match = trimmed.match(/^\s*(query|mutation|subscription)\s/i);
    if (match && match[1]) {
      return match[1].toLowerCase() as 'query' | 'mutation' | 'subscription';
    }
    
    // Default to query if no explicit type
    return 'query';
  }
}
