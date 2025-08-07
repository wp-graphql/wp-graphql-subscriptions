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