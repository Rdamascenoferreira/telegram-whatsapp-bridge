import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDeliveryHealth } from '../bridgeApp.js';

test('summarizeDeliveryHealth returns clean state without alerts', () => {
  const result = summarizeDeliveryHealth([]);

  assert.deepEqual(result.totals, {
    queued: 0,
    pendingTelegram: 0,
    fatalFailures: 0,
    transientFailures: 0,
    skippedDuplicates: 0
  });
  assert.equal(result.healthAlerts.length, 0);
});

test('summarizeDeliveryHealth emits warning and critical alerts by threshold', () => {
  const result = summarizeDeliveryHealth([
    {
      deliveryQueue: { queuedCount: 12 },
      pendingTelegramCount: 10,
      deliveryStats: { fatalFailures: 1, transientFailures: 3, skippedDuplicates: 7 }
    },
    {
      deliveryQueue: { queuedCount: 20 },
      pendingTelegramCount: 12,
      deliveryStats: { fatalFailures: 0, transientFailures: 2, skippedDuplicates: 5 }
    }
  ]);

  assert.deepEqual(result.totals, {
    queued: 32,
    pendingTelegram: 22,
    fatalFailures: 1,
    transientFailures: 5,
    skippedDuplicates: 12
  });

  const codes = result.healthAlerts.map((alert) => alert.code);
  assert.ok(codes.includes('DELIVERY_QUEUE_HIGH'));
  assert.ok(codes.includes('TELEGRAM_PENDING_HIGH'));
  assert.ok(codes.includes('DELIVERY_FATAL_FAILURES'));
});
