# Subscription Security Model

## Overview

The WPGraphQL Subscriptions system implements a secure server-to-server authentication model to prevent unauthorized access when executing subscriptions with `rootValue` data.

## Security Concerns

When subscriptions are executed against WPGraphQL with event data as `rootValue`, we need to ensure that:

1. **Only the authorized sidecar server** can set `rootValue` 
2. **Arbitrary clients cannot inject** malicious `rootValue` data
3. **Replay attacks are prevented** through timestamp validation
4. **Token tampering is detected** via cryptographic signatures

## Token-Based Authentication

### How It Works

1. **Sidecar generates token**: When executing a subscription, the sidecar creates an HMAC-SHA256 token containing:
   - Subscription ID
   - Event payload  
   - Timestamp
   - Cryptographic signature

2. **WPGraphQL validates token**: WordPress validates the token using the same shared secret:
   - Checks timestamp (prevents replay attacks)
   - Verifies signature (prevents tampering)
   - Extracts validated `rootValue`

3. **Secure execution**: Only validated `rootValue` data is used for subscription execution

### Token Format

```
timestamp.signature
```

**Example**: `1755797439.a1b2c3d4e5f6...`

### Signed Data Structure

```json
{
  "subscriptionId": "sub_1755797439095_9r6ndf38k",
  "payload": {
    "id": 1,
    "title": "Updated Post",
    "subscription_id": "sub_1755797439095_9r6ndf38k"
  },
  "timestamp": 1755797439
}
```

## Configuration

### Sidecar Configuration

Set the subscription secret in your environment:

```bash
# .env
SUBSCRIPTION_SECRET=your-secure-secret-key-here
```

### WordPress Configuration

#### Option 1: WordPress Constant (Recommended)

```php
// wp-config.php
define('WPGRAPHQL_SUBSCRIPTION_SECRET', 'your-secure-secret-key-here');
```

#### Option 2: WordPress Option

Set via WPGraphQL settings page or programmatically:

```php
update_option('wpgraphql_subscription_secret', 'your-secure-secret-key-here');
```

#### Option 3: Development Fallback

For development only, the system falls back to: `dev-subscription-secret-change-in-production`

## Security Features

### 1. **Replay Attack Prevention**
- Tokens expire after 5 minutes
- Timestamp validation prevents old tokens from being reused

### 2. **Tamper Detection** 
- HMAC-SHA256 signatures detect any modification to the payload
- Constant-time comparison prevents timing attacks

### 3. **Secure Secret Management**
- Secrets are never transmitted over the network
- Both servers use the same secret to generate/validate tokens

### 4. **Fail-Safe Defaults**
- Invalid tokens result in rejected `rootValue`
- Missing secrets prevent token validation
- Security events are logged for monitoring

## Implementation Details

### Sidecar Token Generation

```typescript
private generateSubscriptionToken(subscriptionId: string, payload: any): string {
  const secret = process.env.SUBSCRIPTION_SECRET;
  const timestamp = Math.floor(Date.now() / 1000);
  
  const dataToSign = JSON.stringify({
    subscriptionId,
    payload: { ...payload, subscription_id: subscriptionId },
    timestamp,
  });
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('hex');
    
  return `${timestamp}.${signature}`;
}
```

### WordPress Token Validation

```php
function wpgraphql_subscriptions_validate_token($token, $payload) {
  // Parse timestamp.signature format
  list($timestamp, $signature) = explode('.', $token, 2);
  
  // Check timestamp (5 minute expiry)
  if (abs(time() - (int)$timestamp) > 300) {
    return false;
  }
  
  // Validate signature
  $secret = wpgraphql_subscriptions_get_secret();
  $expected_signature = hash_hmac('sha256', $data_to_sign, $secret);
  
  return hash_equals($expected_signature, $signature);
}
```

## Production Recommendations

### 1. **Strong Secrets**
- Use cryptographically random secrets (32+ characters)
- Different secrets for different environments
- Rotate secrets periodically

### 2. **Secret Management**
- Store in environment variables or WordPress constants
- Never commit secrets to version control
- Use secret management services in production

### 3. **Monitoring**
- Monitor logs for invalid token attempts
- Set up alerts for repeated security violations
- Track token validation success/failure rates

### 4. **Network Security**
- Use HTTPS for all communication
- Restrict sidecar server access to WordPress
- Consider VPN or private networks for production

## Troubleshooting

### Common Issues

1. **"Invalid subscription token"**
   - Check that secrets match between sidecar and WordPress
   - Verify timestamp synchronization between servers
   - Ensure token hasn't expired (5 minute limit)

2. **"No subscription secret configured"**
   - Set `SUBSCRIPTION_SECRET` in sidecar environment
   - Set `WPGRAPHQL_SUBSCRIPTION_SECRET` constant in WordPress
   - Or configure via WPGraphQL settings page

3. **"Token expired"**
   - Check server time synchronization
   - Reduce network latency between sidecar and WordPress
   - Consider increasing expiry window if needed

### Debug Logging

Enable debug logging to troubleshoot token validation:

```php
// Enable WordPress debug logging
define('WP_DEBUG_LOG', true);

// Check error.log for messages like:
// "WPGraphQL Subscriptions: Invalid token signature"
// "WPGraphQL Subscriptions: Token expired"
```

## Security Audit Checklist

- [ ] Strong, unique secrets configured
- [ ] Secrets not in version control
- [ ] HTTPS enabled for all communication
- [ ] Token expiry appropriate for use case
- [ ] Monitoring/alerting for security events
- [ ] Regular secret rotation schedule
- [ ] Network access properly restricted
- [ ] Debug logging disabled in production
