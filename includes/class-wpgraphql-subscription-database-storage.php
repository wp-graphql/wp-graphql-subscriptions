<?php
/**
 * Database-based subscription storage implementation
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WPGraphQL_Subscription_Database_Storage implements WPGraphQL_Subscription_Storage_Interface {
    
    /**
     * Table names
     */
    private $connections_table;
    private $subscriptions_table;
    
    public function __construct() {
        global $wpdb;
        $this->connections_table = $wpdb->prefix . 'wpgraphql_subscription_connections';
        $this->subscriptions_table = $wpdb->prefix . 'wpgraphql_subscription_documents';
    }
    
    /**
     * Create database tables
     */
    public function create_tables() {
        global $wpdb;
        
        $charset_collate = $wpdb->get_charset_collate();
        
        // Connections table
        $connections_sql = "CREATE TABLE {$this->connections_table} (
            token varchar(255) NOT NULL,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            expires_at datetime DEFAULT NULL,
            PRIMARY KEY (token),
            KEY expires_at (expires_at)
        ) $charset_collate;";
        
        // Subscription documents table
        $subscriptions_sql = "CREATE TABLE {$this->subscriptions_table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            connection_token varchar(255) NOT NULL,
            operation_id varchar(255) NOT NULL,
            query text NOT NULL,
            variables text DEFAULT NULL,
            registered_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY connection_operation (connection_token, operation_id),
            KEY connection_token (connection_token),
            FOREIGN KEY (connection_token) REFERENCES {$this->connections_table}(token) ON DELETE CASCADE
        ) $charset_collate;";
        
        require_once( ABSPATH . 'wp-admin/includes/upgrade.php' );
        dbDelta( $connections_sql );
        dbDelta( $subscriptions_sql );
        
        error_log( "WPGraphQL Subscriptions: Created database tables" );
    }
    
    /**
     * Store a connection
     */
    public function store_connection( $token, $expires_at = null ) {
        global $wpdb;
        
        if ( ! $expires_at ) {
            // Default to 24 hours from now
            $expires_at = gmdate( 'Y-m-d H:i:s', time() + ( 24 * HOUR_IN_SECONDS ) );
        }
        
        $result = $wpdb->insert(
            $this->connections_table,
            [
                'token' => $token,
                'expires_at' => $expires_at
            ],
            [ '%s', '%s' ]
        );
        
        if ( $result === false ) {
            error_log( "WPGraphQL Subscriptions: Failed to store connection {$token}: " . $wpdb->last_error );
            return false;
        }
        
        error_log( "WPGraphQL Subscriptions: Stored connection {$token} with expiry {$expires_at}" );
        return true;
    }
    
    /**
     * Get connection data
     */
    public function get_connection( $token ) {
        global $wpdb;
        
        $connection = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$this->connections_table} WHERE token = %s AND (expires_at IS NULL OR expires_at > NOW())",
            $token
        ), ARRAY_A );
        
        return $connection ?: null;
    }
    
    /**
     * Remove a connection and all its subscriptions
     */
    public function remove_connection( $token ) {
        global $wpdb;
        
        // Remove subscriptions first (though CASCADE should handle this)
        $wpdb->delete( $this->subscriptions_table, [ 'connection_token' => $token ], [ '%s' ] );
        
        // Remove connection
        $result = $wpdb->delete( $this->connections_table, [ 'token' => $token ], [ '%s' ] );
        
        error_log( "WPGraphQL Subscriptions: Removed connection {$token}" );
        return $result !== false;
    }
    
    /**
     * Store a subscription document
     */
    public function store_subscription( $token, $operation_id, $query, $variables = [] ) {
        global $wpdb;
        
        $result = $wpdb->replace(
            $this->subscriptions_table,
            [
                'connection_token' => $token,
                'operation_id' => $operation_id,
                'query' => $query,
                'variables' => wp_json_encode( $variables )
            ],
            [ '%s', '%s', '%s', '%s' ]
        );
        
        if ( $result === false ) {
            error_log( "WPGraphQL Subscriptions: Failed to store subscription {$operation_id} for {$token}: " . $wpdb->last_error );
            return false;
        }
        
        error_log( "WPGraphQL Subscriptions: Stored subscription {$operation_id} for connection {$token}" );
        return true;
    }
    
    /**
     * Get subscription document
     */
    public function get_subscription( $token, $operation_id ) {
        global $wpdb;
        
        $subscription = $wpdb->get_row( $wpdb->prepare(
            "SELECT s.* FROM {$this->subscriptions_table} s 
             JOIN {$this->connections_table} c ON s.connection_token = c.token 
             WHERE s.connection_token = %s AND s.operation_id = %s 
             AND (c.expires_at IS NULL OR c.expires_at > NOW())",
            $token,
            $operation_id
        ), ARRAY_A );
        
        if ( $subscription ) {
            $subscription['variables'] = json_decode( $subscription['variables'] ?? '[]', true );
        }
        
        return $subscription ?: null;
    }
    
    /**
     * Get all subscriptions for a connection
     */
    public function get_subscriptions( $token ) {
        global $wpdb;
        
        $subscriptions = $wpdb->get_results( $wpdb->prepare(
            "SELECT s.* FROM {$this->subscriptions_table} s 
             JOIN {$this->connections_table} c ON s.connection_token = c.token 
             WHERE s.connection_token = %s 
             AND (c.expires_at IS NULL OR c.expires_at > NOW())",
            $token
        ), ARRAY_A );
        
        $result = [];
        foreach ( $subscriptions as $subscription ) {
            $subscription['variables'] = json_decode( $subscription['variables'] ?? '[]', true );
            $result[ $subscription['operation_id'] ] = $subscription;
        }
        
        return $result;
    }
    
    /**
     * Remove a specific subscription
     */
    public function remove_subscription( $token, $operation_id ) {
        global $wpdb;
        
        $result = $wpdb->delete(
            $this->subscriptions_table,
            [
                'connection_token' => $token,
                'operation_id' => $operation_id
            ],
            [ '%s', '%s' ]
        );
        
        return $result !== false;
    }
    
    /**
     * Get all active connections
     */
    public function get_active_connections() {
        global $wpdb;
        
        return $wpdb->get_results(
            "SELECT * FROM {$this->connections_table} WHERE expires_at IS NULL OR expires_at > NOW()",
            ARRAY_A
        );
    }
    
    /**
     * Cleanup expired connections
     */
    public function cleanup_expired_connections() {
        global $wpdb;
        
        // Get count of expired connections
        $expired_count = $wpdb->get_var(
            "SELECT COUNT(*) FROM {$this->connections_table} WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
        );
        
        if ( $expired_count > 0 ) {
            // Delete expired connections (CASCADE will handle subscriptions)
            $wpdb->query(
                "DELETE FROM {$this->connections_table} WHERE expires_at IS NOT NULL AND expires_at <= NOW()"
            );
            
            error_log( "WPGraphQL Subscriptions: Cleaned up {$expired_count} expired connections" );
        }
        
        return $expired_count;
    }
}