/**
 * Main server entry point for SSE-2 GraphQL Subscription Server
 */

import { loadConfig } from './config/index.js';
import { createLogger, LogMessages } from './logger/index.js';
import { HTTPServer } from './server/http.js';

async function main() {
  let server: HTTPServer | undefined;
  
  try {
    // Load configuration
    const config = loadConfig();
    
    // Create logger
    const logger = createLogger(config);
    
    // Log startup
    logger.info(LogMessages.SERVER_STARTING);
    
    // Create and start HTTP server
    server = new HTTPServer(config, logger);
    await server.start();
    
    logger.info({
      port: config.port,
      host: config.host,
      endpoint: `http://${config.host}:${config.port}/graphql`,
      graphiql: `http://${config.host}:${config.port}/graphql`,
    }, LogMessages.SERVER_STARTED);
    
    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      logger.info({ signal }, LogMessages.SERVER_STOPPING);
      
      if (server) {
        await server.stop();
      }
      
      logger.info(LogMessages.SERVER_STOPPED);
      process.exit(0);
    };
    
    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled rejection');
      process.exit(1);
    });
    
  } catch (error) {
    const logger = createLogger(loadConfig());
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
