import React, { useState, useEffect } from 'react';
import { useSubscription } from '@apollo/client';
import { POST_UPDATED_SUBSCRIPTION, PostUpdatedData, PostUpdatedVars } from '../lib/queries';

type PostUpdatedType = PostUpdatedData['postUpdated'];

interface Post extends PostUpdatedType {
  isUpdated?: boolean;
}

interface PostSubscriptionProps {
  postId: string;
}

export const PostSubscription: React.FC<PostSubscriptionProps> = ({ postId }) => {
  const { data, loading, error } = useSubscription<PostUpdatedData, PostUpdatedVars>(
    POST_UPDATED_SUBSCRIPTION,
    { 
      variables: { id: postId },
      // Only start subscription when component mounts - Apollo Link will wait for connection
      skip: false
    }
  );

  const [posts, setPosts] = useState<Post[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  // Debug subscription data
  useEffect(() => {
    console.log('PostSubscription received data:', data);
    console.log('PostSubscription loading:', loading);
    console.log('PostSubscription error:', error);
  }, [data, loading, error]);

  useEffect(() => {
    if (data === null) {
      // This is the "ready" signal from Apollo Link - subscription is confirmed
      console.log('Subscription ready signal received');
      return;
    }
    
    if (data?.postUpdated) {
      console.log('Processing post update:', data.postUpdated);
      const post = data.postUpdated;
      setLastUpdate(Date.now());
      
      setPosts(prev => {
        const existing = prev.find(p => p.id === post.id);
        if (existing) {
          return prev.map(p => p.id === post.id ? { ...post, isUpdated: true } : p);
        } else {
          return [...prev, { ...post, isUpdated: true }];
        }
      });

      // Remove update indicator after animation
      setTimeout(() => {
        setPosts(prev => prev.map(p => ({ ...p, isUpdated: false })));
      }, 1000);
    }
  }, [data]);

  if (loading) {
    return (
      <div className="info">
        <div>⏳ Setting up subscription...</div>
        <div style={{ fontSize: '14px', marginTop: '8px', opacity: 0.8 }}>
          Waiting for GraphQL-SSE connection. Click "Connect" first if you haven't already.
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="error">
        <div>❌ Subscription error: {error.message}</div>
        <div style={{ fontSize: '14px', marginTop: '8px' }}>
          Make sure to click "Connect" before the subscription starts.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3>Subscribed to Post Updates (ID: {postId})</h3>
      {lastUpdate && (
        <p className="info">Last update: {new Date(lastUpdate).toLocaleTimeString()}</p>
      )}
      
      {posts.length === 0 ? (
        <p>No post updates received yet. Try updating post #{postId} in WordPress admin.</p>
      ) : (
        posts.map(post => (
          <div key={post.id} className={`post-card ${post.isUpdated ? 'updated' : ''}`}>
            <h4>{post.title}</h4>
            <p><strong>Status:</strong> {post.status}</p>
            <p><strong>Author:</strong> {post.author?.node?.name || 'Unknown'}</p>
            <p><strong>Modified:</strong> {new Date(post.modified).toLocaleString()}</p>
            <div className="content-preview">
              <div dangerouslySetInnerHTML={{ 
                __html: post.content?.substring(0, 200) + '...' 
              }} />
            </div>
            <div className="meta">
              Received at: {new Date().toLocaleTimeString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
};