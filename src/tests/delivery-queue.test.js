import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppDeliveryQueue } from '../whatsAppDeliveryQueue.js';

test('sendWithRetry retries transient failures until success', async () => {
  const queue = new WhatsAppDeliveryQueue({
    userId: 'test-user',
    retryLimit: 3,
    retryBaseDelayMs: 1,
    retryJitterMs: 1
  });
  let attempts = 0;

  const result = await queue.sendWithRetry(async () => {
    attempts += 1;

    if (attempts < 3) {
      throw new Error('Target closed');
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempt, 3);
  assert.equal(attempts, 3);
});

test('sendWithRetry stops immediately for fatal failures', async () => {
  const queue = new WhatsAppDeliveryQueue({
    userId: 'test-user',
    retryLimit: 5,
    retryBaseDelayMs: 1,
    retryJitterMs: 1
  });
  let attempts = 0;

  const result = await queue.sendWithRetry(async () => {
    attempts += 1;
    throw new Error('invalid wid');
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorClass, 'fatal');
  assert.equal(result.attempt, 1);
  assert.equal(attempts, 1);
});
