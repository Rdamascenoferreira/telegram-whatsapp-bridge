import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserBridgeRuntime } from '../userBridgeRuntime.js';

test('runtime delivery dedupe persists and reloads recent receipts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-runtime-dedupe-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  const runtimeA = new UserBridgeRuntime({ userId: 'user-a' });
  runtimeA.paths = {
    workspaceDir
  };

  const deliveryKey = 'telegram_forward|chat:100:55|group-1|text';

  assert.equal(runtimeA.hasRecentDelivery(deliveryKey), false);
  runtimeA.markRecentDelivery(deliveryKey);
  assert.equal(runtimeA.hasRecentDelivery(deliveryKey), true);

  await runtimeA.persistDeliveryReceiptsPromise;

  const runtimeB = new UserBridgeRuntime({ userId: 'user-a' });
  runtimeB.paths = {
    workspaceDir
  };
  await runtimeB.loadDeliveryReceipts();

  assert.equal(runtimeB.hasRecentDelivery(deliveryKey), true);
});
