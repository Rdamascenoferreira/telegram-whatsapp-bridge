import fs from 'node:fs/promises';
import path from 'node:path';
import { waitForFileOperations, writeJsonFileAtomic } from '../../jsonFileStore.js';

export function pruneRecentDeliveryReceipts(runtime, options = {}) {
  const deliveryReceiptTtlMs = Number(options.deliveryReceiptTtlMs);
  const maxRecentDeliveryReceipts = Number(options.maxRecentDeliveryReceipts);
  const now = Date.now();

  for (const [key, deliveredAt] of runtime.recentDeliveryReceipts.entries()) {
    if (now - deliveredAt > deliveryReceiptTtlMs) {
      runtime.recentDeliveryReceipts.delete(key);
    }
  }

  if (runtime.recentDeliveryReceipts.size <= maxRecentDeliveryReceipts) {
    return;
  }

  const entries = [...runtime.recentDeliveryReceipts.entries()].sort((left, right) => left[1] - right[1]);
  const toDelete = entries.slice(0, Math.max(0, entries.length - maxRecentDeliveryReceipts));

  for (const [key] of toDelete) {
    runtime.recentDeliveryReceipts.delete(key);
  }

  persistDeliveryReceipts(runtime, options).catch((error) => {
    console.error(`[bridge:${runtime.userId}] Falha ao persistir dedupe de entregas: ${error.message}`);
  });
}

export function hasRecentDelivery(runtime, deliveryKey, options = {}) {
  const deliveryReceiptTtlMs = Number(options.deliveryReceiptTtlMs);

  if (!deliveryKey) {
    return false;
  }

  const deliveredAt = runtime.recentDeliveryReceipts.get(deliveryKey);

  if (!deliveredAt) {
    return false;
  }

  if (Date.now() - deliveredAt > deliveryReceiptTtlMs) {
    runtime.recentDeliveryReceipts.delete(deliveryKey);
    return false;
  }

  return true;
}

export function markRecentDelivery(runtime, deliveryKey, options = {}) {
  if (!deliveryKey) {
    return;
  }

  runtime.recentDeliveryReceipts.set(deliveryKey, Date.now());
  pruneRecentDeliveryReceipts(runtime, options);
  persistDeliveryReceipts(runtime, options).catch((error) => {
    console.error(`[bridge:${runtime.userId}] Falha ao persistir dedupe de entregas: ${error.message}`);
  });
}

export function getDeliveryReceiptsPath(runtime, { deliveryReceiptsFilename }) {
  if (!runtime.paths?.workspaceDir) {
    return '';
  }

  return path.join(runtime.paths.workspaceDir, deliveryReceiptsFilename);
}

export async function loadDeliveryReceipts(runtime, options = {}) {
  const deliveryReceiptTtlMs = Number(options.deliveryReceiptTtlMs);
  const filePath = getDeliveryReceiptsPath(runtime, options);

  if (!filePath) {
    runtime.recentDeliveryReceipts = new Map();
    return;
  }

  try {
    await waitForFileOperations(filePath);
    const raw = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const now = Date.now();

    runtime.recentDeliveryReceipts = new Map(
      entries
        .map((entry) => [String(entry?.key ?? ''), Number(entry?.deliveredAt ?? 0)])
        .filter(([key, deliveredAt]) => key && Number.isFinite(deliveredAt) && now - deliveredAt <= deliveryReceiptTtlMs)
    );
    pruneRecentDeliveryReceipts(runtime, options);
  } catch (error) {
    if (error.code === 'ENOENT') {
      runtime.recentDeliveryReceipts = new Map();
      return;
    }

    runtime.recentDeliveryReceipts = new Map();
    runtime.log(`Não foi possível carregar dedupe de entregas: ${error.message}`, {
      level: 'error',
      type: 'delivery_dedupe_load_error',
      increments: { errors: 1 }
    });
  }
}

export async function persistDeliveryReceipts(runtime, options = {}) {
  const filePath = getDeliveryReceiptsPath(runtime, options);

  if (!filePath) {
    return;
  }

  const entries = [...runtime.recentDeliveryReceipts.entries()].map(([key, deliveredAt]) => ({
    key,
    deliveredAt
  }));

  runtime.persistDeliveryReceiptsPromise = runtime.persistDeliveryReceiptsPromise
    .catch(() => {})
    .then(() =>
      writeJsonFileAtomic(filePath, {
        entries,
        updatedAt: new Date().toISOString()
      })
    );

  return runtime.persistDeliveryReceiptsPromise;
}
