<?php
/**
 * Subscription Registration API
 * 
 * Provides a formal API for registering GraphQL subscriptions with standardized patterns.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Register a GraphQL subscription with standardized resolver patterns.
 * 
 * This function abstracts the common patterns found in subscription resolvers,
 * making it easy to register new subscriptions without duplicating code.
 * 
 * @param string $subscription_name The name of the subscription field (e.g., 'postUpdated', 'commentCreated')
 * @param array  $config            Configuration array with the following keys:
 *   - description: string - Description of the subscription
 *   - type: string - GraphQL return type (e.g., 'Post', 'Comment')
 *   - args: array - GraphQL field arguments
 *   - event_key: string - Key to look for in the root data (defaults to subscription_name)
 *   - data_extractors: array - Functions to extract data from different event formats
 *   - filter_callback: callable - Optional callback to filter events (return true to include)
 */
function register_graphql_subscription( $subscription_name, $config ) {
    
    // Validate required config
    $required_keys = [ 'description', 'type', 'args' ];
    foreach ( $required_keys as $key ) {
        if ( ! isset( $config[ $key ] ) ) {
            throw new InvalidArgumentException( "Missing required config key: {$key}" );
        }
    }
    
    // Set defaults
    $event_key = $config['event_key'] ?? $subscription_name;
    $data_extractors = $config['data_extractors'] ?? [];
    $filter_callback = $config['filter_callback'] ?? null;
    
    register_graphql_field( 'RootSubscription', $subscription_name, [
        'description' => $config['description'],
        'type'        => $config['type'],
        'args'        => $config['args'],
        'resolve'     => function( $root, $args, $context, $info ) use ( $subscription_name, $event_key, $data_extractors, $filter_callback ) {
            
            // Debug logging
            error_log( "WPGraphQL-SSE: {$subscription_name} resolver called" );
            error_log( "WPGraphQL-SSE: Args: " . json_encode( $args ) );
            
            if ( is_array( $root ) ) {
                error_log( "WPGraphQL-SSE: Root keys: " . implode( ', ', array_keys( $root ) ) );
            }
            
            // Check if we have event data
            if ( ! isset( $root[ $event_key ] ) ) {
                error_log( "WPGraphQL-SSE: No {$event_key} event data found in root" );
                return null;
            }
            
            $event_data = $root[ $event_key ];
            error_log( "WPGraphQL-SSE: Found {$event_key} event in root" );
            
            // Extract the actual data using the configured extractors
            $extracted_data = null;
            foreach ( $data_extractors as $extractor ) {
                $extracted_data = call_user_func( $extractor, $event_data );
                if ( $extracted_data ) {
                    break;
                }
            }
            
            if ( ! $extracted_data ) {
                error_log( "WPGraphQL-SSE: Could not extract data from {$event_key} event" );
                return null;
            }
            
            // Apply filter if provided
            if ( $filter_callback && ! call_user_func( $filter_callback, $extracted_data, $args, $context ) ) {
                error_log( "WPGraphQL-SSE: Event filtered out by filter callback" );
                return null;
            }
            
            error_log( "WPGraphQL-SSE: Returning data from {$subscription_name} resolver" );
            return $extracted_data;
        }
    ]);
}

/**
 * Standard data extractors for common WordPress object types.
 */
class WPGraphQL_Subscription_Data_Extractors {
    
    /**
     * Extract WP_Post data from event payload and return WPGraphQL Post model.
     */
    public static function extract_post_data( $event_data ) {
        $post_data = null;
        
        if ( is_array( $event_data ) && isset( $event_data['post'] ) ) {
            // Standard event format: { post: WP_Post }
            $post_data = $event_data['post'];
        } elseif ( is_array( $event_data ) && isset( $event_data['ID'] ) ) {
            // Direct post data format
            $post_data = $event_data;
        } elseif ( is_object( $event_data ) && isset( $event_data->ID ) ) {
            // WP_Post object directly
            $post_data = $event_data;
        }
        
        if ( $post_data ) {
            // Convert array to WP_Post object if needed
            if ( is_array( $post_data ) && isset( $post_data['ID'] ) ) {
                $post = get_post( $post_data['ID'] );
                if ( $post && ! is_wp_error( $post ) ) {
                    $post_data = $post;
                }
            }
            
            // Return WPGraphQL model
            if ( is_object( $post_data ) && isset( $post_data->ID ) ) {
                return new \WPGraphQL\Model\Post( $post_data );
            }
        }
        
        return null;
    }
    
    /**
     * Extract WP_Comment data from event payload and return WPGraphQL Comment model.
     */
    public static function extract_comment_data( $event_data ) {
        $comment_data = null;
        
        if ( is_array( $event_data ) && isset( $event_data['comment'] ) ) {
            // Standard event format: { comment: WP_Comment }
            $comment_data = $event_data['comment'];
        } elseif ( is_array( $event_data ) && isset( $event_data['comment_ID'] ) ) {
            // Direct comment data format
            $comment_data = $event_data;
        } elseif ( is_object( $event_data ) && isset( $event_data->comment_ID ) ) {
            // WP_Comment object directly
            $comment_data = $event_data;
        }
        
        if ( $comment_data ) {
            // Convert array to WP_Comment object if needed
            if ( is_array( $comment_data ) && isset( $comment_data['comment_ID'] ) ) {
                $comment = get_comment( $comment_data['comment_ID'] );
                if ( $comment && ! is_wp_error( $comment ) ) {
                    $comment_data = $comment;
                }
            }
            
            // Return WPGraphQL model
            if ( is_object( $comment_data ) && isset( $comment_data->comment_ID ) ) {
                return new \WPGraphQL\Model\Comment( $comment_data );
            }
        }
        
        return null;
    }
    
    /**
     * Extract WP_User data from event payload and return WPGraphQL User model.
     */
    public static function extract_user_data( $event_data ) {
        $user_data = null;
        
        if ( is_array( $event_data ) && isset( $event_data['user'] ) ) {
            // Standard event format: { user: WP_User }
            $user_data = $event_data['user'];
        } elseif ( is_array( $event_data ) && isset( $event_data['ID'] ) ) {
            // Direct user data format
            $user_data = $event_data;
        } elseif ( is_object( $event_data ) && isset( $event_data->ID ) ) {
            // WP_User object directly
            $user_data = $event_data;
        }
        
        if ( $user_data ) {
            // Convert array to WP_User object if needed
            if ( is_array( $user_data ) && isset( $user_data['ID'] ) ) {
                $user = get_user_by( 'id', $user_data['ID'] );
                if ( $user && ! is_wp_error( $user ) ) {
                    $user_data = $user;
                }
            }
            
            // Return WPGraphQL model
            if ( is_object( $user_data ) && isset( $user_data->ID ) ) {
                return new \WPGraphQL\Model\User( $user_data );
            }
        }
        
        return null;
    }
}

/**
 * Standard filter callbacks for common subscription patterns.
 */
class WPGraphQL_Subscription_Filters {
    
    /**
     * Filter posts by ID.
     * 
     * @param WPGraphQL\Model\Post $post_model
     * @param array $args Subscription arguments
     * @return bool
     */
    public static function filter_post_by_id( $post_model, $args ) {
        if ( ! isset( $args['id'] ) ) {
            return true; // No filter specified
        }
        
        $requested_id = absint( $args['id'] );
        $post_id = $post_model->ID ?? null;
        
        if ( $requested_id && $post_id != $requested_id ) {
            error_log( "WPGraphQL-SSE: Post ID {$post_id} does not match requested ID {$requested_id}, filtering out" );
            return false;
        }
        
        return true;
    }
    
    /**
     * Filter comments by node ID (the post/page they're commenting on).
     * 
     * @param WPGraphQL\Model\Comment $comment_model
     * @param array $args Subscription arguments
     * @return bool
     */
    public static function filter_comment_by_node_id( $comment_model, $args ) {
        if ( ! isset( $args['nodeId'] ) ) {
            return true; // No filter specified
        }
        
        $requested_node_id = absint( $args['nodeId'] );
        $comment_post_id = $comment_model->comment_post_ID ?? null;
        
        if ( $requested_node_id && $comment_post_id != $requested_node_id ) {
            error_log( "WPGraphQL-SSE: Comment node ID {$comment_post_id} does not match requested node ID {$requested_node_id}, filtering out" );
            return false;
        }
        
        return true;
    }
    
    /**
     * Filter users by ID.
     * 
     * @param WPGraphQL\Model\User $user_model
     * @param array $args Subscription arguments
     * @return bool
     */
    public static function filter_user_by_id( $user_model, $args ) {
        if ( ! isset( $args['id'] ) ) {
            return true; // No filter specified
        }
        
        $requested_id = absint( $args['id'] );
        $user_id = $user_model->ID ?? null;
        
        if ( $requested_id && $user_id != $requested_id ) {
            error_log( "WPGraphQL-SSE: User ID {$user_id} does not match requested ID {$requested_id}, filtering out" );
            return false;
        }
        
        return true;
    }
}
