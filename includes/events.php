<?php
// NOTE: This ideally would be abstracted so that subscriptions could register the events they track and the payloads they emit. 
// For now, this is very manual to get started and prove a concetp.

/**
 * Handle post insertion events.
 * 
 * Emits CREATE events for new posts.
 */
add_action( 'post_updated', function( $post_id, $post_after, $post_before ) {

    error_log( 'WPGraphQL-SSE: post_updated hook fired for post ' . $post_id );
    
    // Skip auto-saves and revisions
    if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
        error_log( 'revision or autosave' );
        return;
    }

    $action = 'UPDATE';
    $node_type = 'post';
    $node_id = $post_id;

    // If the post author has changed, emit an event for the new and old author.
    if ( $post_after->post_author !== $post_before->post_author ) {
        $action = 'UPDATE';
        $node_type = 'user';

         // Emit the standardized CREATE event
        WPGraphQL_Event_Emitter::emit(
            $node_type,                    // node_type
            $action,                  // action
            $post_after->post_author,                  // node_id
            [                          // context
                'user' => $post_after->post_author
            ],
            [                          // metadata
                'hook' => 'post_updated',
            ]
        );

        WPGraphQL_Event_Emitter::emit(
            $node_type,                    // node_type
            $action,                  // action
            $post_before->post_author,                  // node_id
            [                          // context
                'user' => $post_before->post_author
            ],
            [                          // metadata
                'hook' => 'post_updated',
            ]
        );
    }
    
    error_log( "WPGraphQL-SSE: About to emit event - Type: {$node_type}, Action: {$action}, ID: {$node_id}" );
    error_log( "WPGraphQL-SSE: Post object details - ID: {$post_after->ID}, Title: {$post_after->post_title}" );
    
    // Emit the standardized CREATE event
    WPGraphQL_Event_Emitter::emit(
        $node_type,                    // node_type
        $action,                  // action
        $node_id,                  // node_id
        [                          // context
            'post' => $post_after,
            'post_type' => $post_after->post_type,
        ],
        [                          // metadata
            'hook' => 'post_updated',
        ]
    );
    
}, 10, 3 );

/**
 * Handle comment insertion events.
 * 
 * Emits CREATE events for new comments.
 */
add_action( 'comment_post', function( $comment_id, $comment_approved, $comment_data ) {
    
    error_log( 'WPGraphQL-SSE: comment_post hook fired for comment ' . $comment_id );
    
    // Only handle approved comments (or those pending moderation)
    if ( $comment_approved === 'spam' || $comment_approved === 'trash' ) {
        error_log( 'WPGraphQL-SSE: Comment is spam or trash, skipping' );
        return;
    }
    
    // Get the full comment object
    $comment = get_comment( $comment_id );
    if ( ! $comment ) {
        error_log( 'WPGraphQL-SSE: Could not retrieve comment object' );
        return;
    }
    
    $action = 'CREATE';
    $node_type = 'comment';
    $node_id = $comment_id;
    
    error_log( "WPGraphQL-SSE: About to emit comment event - Type: {$node_type}, Action: {$action}, ID: {$node_id}" );
    error_log( "WPGraphQL-SSE: Comment object details - ID: {$comment->comment_ID}, Post ID: {$comment->comment_post_ID}, Content: " . substr( $comment->comment_content, 0, 100 ) );
    
    // Emit the standardized CREATE event
    WPGraphQL_Event_Emitter::emit(
        $node_type,                    // node_type
        $action,                       // action
        $node_id,                      // node_id
        [                              // context
            'comment' => $comment,
            'post_id' => $comment->comment_post_ID,
            'comment_approved' => $comment_approved,
        ],
        [                              // metadata
            'hook' => 'comment_post',
        ]
    );
    
}, 10, 3 );

/**
 * Handle comment status change events.
 * 
 * Emits UPDATE events when comments are approved, unapproved, etc.
 */
add_action( 'wp_set_comment_status', function( $comment_id, $comment_status ) {
    
    error_log( 'WPGraphQL-SSE: wp_set_comment_status hook fired for comment ' . $comment_id . ' with status ' . $comment_status );
    
    // Skip if comment is being deleted/trashed
    if ( $comment_status === 'trash' || $comment_status === 'spam' ) {
        error_log( 'WPGraphQL-SSE: Comment status is trash/spam, skipping' );
        return;
    }
    
    // Get the full comment object
    $comment = get_comment( $comment_id );
    if ( ! $comment ) {
        error_log( 'WPGraphQL-SSE: Could not retrieve comment object' );
        return;
    }
    
    $action = 'UPDATE';
    $node_type = 'comment';
    $node_id = $comment_id;
    
    error_log( "WPGraphQL-SSE: About to emit comment status event - Type: {$node_type}, Action: {$action}, ID: {$node_id}, Status: {$comment_status}" );
    
    // Emit the standardized UPDATE event
    WPGraphQL_Event_Emitter::emit(
        $node_type,                    // node_type
        $action,                       // action
        $node_id,                      // node_id
        [                              // context
            'comment' => $comment,
            'post_id' => $comment->comment_post_ID,
            'comment_status' => $comment_status,
        ],
        [                              // metadata
            'hook' => 'wp_set_comment_status',
        ]
    );
    
}, 10, 2 );