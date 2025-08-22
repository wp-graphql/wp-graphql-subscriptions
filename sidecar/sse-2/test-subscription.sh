#!/bin/bash

echo "🚀 Testing SSE-2 Subscription Flow"
echo "=================================="

# Start subscription in background
echo "📡 Starting subscription for post 147..."
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"query":"subscription { postUpdated(id: \"147\") { id title content } }"}' &
SUBSCRIPTION_PID=$!

echo "Subscription PID: $SUBSCRIPTION_PID"
echo "⏳ Waiting 3 seconds for subscription to establish..."
sleep 3

echo ""
echo "🔔 Sending webhook event for post 147..."
WEBHOOK_RESPONSE=$(curl -s -X POST http://localhost:4000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "node_type": "post",
    "action": "UPDATE", 
    "node_id": 147,
    "context": {
      "post": {
        "ID": "147",
        "post_title": "Real-time Update Test",
        "post_content": "This should appear in the subscription!"
      }
    },
    "metadata": {
      "timestamp": '$(date +%s)',
      "event_id": "test_event_'$(date +%s)'",
      "user_id": 1,
      "hook": "post_updated"
    }
  }')

echo "Webhook response: $WEBHOOK_RESPONSE"
echo ""
echo "⏳ Waiting 3 seconds for event to propagate through Redis..."
sleep 3

echo ""
echo "🛑 Stopping subscription..."
kill $SUBSCRIPTION_PID 2>/dev/null || true
wait $SUBSCRIPTION_PID 2>/dev/null || true

echo ""
echo "✅ Test completed!"
