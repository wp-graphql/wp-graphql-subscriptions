<?php
/**
 * WPGraphQL Connection Manager
 * 
 * Manages connection-scoped subscription document storage using
 * database persistence for cross-process compatibility.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WPGraphQL_Connection_Manager {
    
    /**
     * Singleton instance
     */
    private static $instance = null;
    
    /**
     * Storage backend
     */
    private $storage;
    
    /**
     * Get singleton instance
     */
    public static function get_instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    /**
     * Private constructor for singleton
     */
    private function __construct() {
        // Use database storage by default, but allow override
        $this->storage = apply_filters( 'wpgraphql_subscription_storage', new WPGraphQL_Subscription_Database_Storage() );
        
        // Register cleanup on shutdown
        add_action( 'shutdown', [ $this, 'cleanup_stale_connections' ] );
    }
    
    /**
     * Get or create connection for token
     */
    public function get_connection( $token ) {
        if ( empty( $token ) ) {
            return null;
        }
        
        // Check if connection exists in database
        $connection_data = $this->storage->get_connection( $token );
        
        if ( ! $connection_data ) {
            // Create new connection
            if ( $this->storage->store_connection( $token ) ) {
                return new WPGraphQL_Subscription_Connection( $token, $this->storage );
            }
            return null;
        }
        
        return new WPGraphQL_Subscription_Connection( $token, $this->storage );
    }
    
    /**
     * Remove connection
     */
    public function remove_connection( $token ) {
        return $this->storage->remove_connection( $token );
    }
    
    /**
     * Get all active connections
     */
    public function get_active_connections() {
        return $this->storage->get_active_connections();
    }
    
    /**
     * Cleanup stale connections
     */
    public function cleanup_stale_connections() {
        return $this->storage->cleanup_expired_connections();
    }
    
    /**
     * Get connection count
     */
    public function get_connection_count() {
        return count( $this->get_active_connections() );
    }
    
    /**
     * Get total subscription count across all connections
     */
    public function get_total_subscription_count() {
        $total = 0;
        foreach ( $this->get_active_connections() as $connection_data ) {
            $subscriptions = $this->storage->get_subscriptions( $connection_data['token'] );
            $total += count( $subscriptions );
        }
        return $total;
    }
}