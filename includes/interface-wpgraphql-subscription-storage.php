<?php
/**
 * Interface for subscription document storage
 * 
 * This allows for swappable storage backends (database, Redis, etc.)
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

interface WPGraphQL_Subscription_Storage_Interface {
    
    /**
     * Store a connection
     */
    public function store_connection( $token, $expires_at = null );
    
    /**
     * Get connection data
     */
    public function get_connection( $token );
    
    /**
     * Remove a connection and all its subscriptions
     */
    public function remove_connection( $token );
    
    /**
     * Store a subscription document
     */
    public function store_subscription( $token, $operation_id, $query, $variables = [] );
    
    /**
     * Get subscription document
     */
    public function get_subscription( $token, $operation_id );
    
    /**
     * Get all subscriptions for a connection
     */
    public function get_subscriptions( $token );
    
    /**
     * Remove a specific subscription
     */
    public function remove_subscription( $token, $operation_id );
    
    /**
     * Get all active connections
     */
    public function get_active_connections();
    
    /**
     * Cleanup expired connections
     */
    public function cleanup_expired_connections();
}