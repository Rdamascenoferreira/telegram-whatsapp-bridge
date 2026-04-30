import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ensureWorkspaceForUser, getWorkspacePaths } from './configStore.js';

const maxEvents = 160;
const maxOffers = 80;

export const defaultMetrics = {
  totalEvents: 0,
  totalTelegramReceived: 0,
  totalForwardBatches: 0,
  totalForwardedMessages: 0,
  totalWhatsAppDeliveries: 0,
  totalErrors: 0,
  totalGroupRefreshes: 0,
  lastActivityAt: null,
  lastTelegramMessageAt: null,
  lastForwardedAt: null,
  lastErrorAt: null,
  lastGroupRefreshAt: null
};

export const defaultActivity = {
  metrics: structuredClone(defaultMetrics),
  events: [],
  offers: []
};

export async function loadActivityForUser(userId) {
  const paths = await ensureWorkspaceForUser(userId);

  try {
    const raw = await fs.readFile(paths.activityPath, 'utf8');
    const parsed = JSON.parse(raw);

    return normalizeActivity(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveActivityForUser(userId, defaultActivity);
      return structuredClone(defaultActivity);
    }

    throw error;
  }
}

export async function saveActivityForUser(userId, activity) {
  const paths = getWorkspacePaths(userId);
  await fs.writeFile(paths.activityPath, JSON.stringify(normalizeActivity(activity), null, 2), 'utf8');
}

export function appendActivityEvent(activity, event) {
  const normalizedActivity = normalizeActivity(activity);
  const metrics = {
    ...normalizedActivity.metrics
  };
  const timestamp = event.at || new Date().toISOString();
  const increments = event.increments || {};

  metrics.totalEvents += 1;
  metrics.totalTelegramReceived += Number(increments.telegramReceived || 0);
  metrics.totalForwardBatches += Number(increments.forwardBatches || 0);
  metrics.totalForwardedMessages += Number(increments.forwardedMessages || 0);
  metrics.totalWhatsAppDeliveries += Number(increments.whatsAppDeliveries || 0);
  metrics.totalErrors += Number(increments.errors || 0);
  metrics.totalGroupRefreshes += Number(increments.groupRefreshes || 0);
  metrics.lastActivityAt = timestamp;

  if (increments.telegramReceived) {
    metrics.lastTelegramMessageAt = timestamp;
  }

  if (increments.forwardedMessages || increments.whatsAppDeliveries || increments.forwardBatches) {
    metrics.lastForwardedAt = timestamp;
  }

  if (increments.errors || event.level === 'error') {
    metrics.lastErrorAt = timestamp;
  }

  if (increments.groupRefreshes) {
    metrics.lastGroupRefreshAt = timestamp;
  }

  const nextEvent = {
    id: event.id || crypto.randomUUID(),
    at: timestamp,
    level: event.level || 'info',
    type: event.type || 'system',
    message: event.message || '',
    metadata: event.metadata || {}
  };

  return {
    metrics,
    events: [nextEvent, ...normalizedActivity.events].slice(0, maxEvents),
    offers: normalizedActivity.offers
  };
}

export function upsertActivityOffer(activity, offer) {
  const normalizedActivity = normalizeActivity(activity);
  const timestamp = String(offer.lastUpdatedAt || offer.at || new Date().toISOString());
  const nextOffer = {
    id: String(offer.id || crypto.randomUUID()),
    at: String(offer.at || timestamp),
    lastUpdatedAt: timestamp,
    status: String(offer.status || 'captured'),
    sourceLabel: String(offer.sourceLabel || 'Telegram'),
    preview: String(offer.preview || 'Mensagem captada do Telegram.'),
    messageCount: Math.max(1, Number(offer.messageCount || 1)),
    groupCount: Math.max(0, Number(offer.groupCount || 0)),
    deliveryCount: Math.max(0, Number(offer.deliveryCount || 0)),
    fromQueue: Boolean(offer.fromQueue),
    reason: String(offer.reason || ''),
    metadata: offer.metadata && typeof offer.metadata === 'object' ? offer.metadata : {}
  };
  const existingIndex = normalizedActivity.offers.findIndex((item) => item.id === nextOffer.id);
  const offers = [...normalizedActivity.offers];

  if (existingIndex >= 0) {
    const previous = offers[existingIndex];
    offers[existingIndex] = {
      ...previous,
      ...nextOffer,
      at: previous.at || nextOffer.at,
      messageCount: Math.max(previous.messageCount || 1, nextOffer.messageCount),
      groupCount: nextOffer.groupCount,
      deliveryCount: nextOffer.deliveryCount,
      metadata: {
        ...(previous.metadata || {}),
        ...(nextOffer.metadata || {})
      }
    };
  } else {
    offers.push(nextOffer);
  }

  offers.sort((left, right) => String(right.lastUpdatedAt).localeCompare(String(left.lastUpdatedAt)));

  return {
    metrics: normalizedActivity.metrics,
    events: normalizedActivity.events,
    offers: offers.slice(0, maxOffers)
  };
}

function normalizeActivity(activity) {
  const events = Array.isArray(activity?.events) ? activity.events : [];
  const offers = Array.isArray(activity?.offers) ? activity.offers : [];

  return {
    metrics: {
      ...defaultMetrics,
      ...(activity?.metrics || {})
    },
    events: events.map((event) => ({
      id: String(event.id || crypto.randomUUID()),
      at: String(event.at || new Date().toISOString()),
      level: String(event.level || 'info'),
      type: String(event.type || 'system'),
      message: String(event.message || ''),
      metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {}
    })),
    offers: offers.map((offer) => ({
      id: String(offer.id || crypto.randomUUID()),
      at: String(offer.at || new Date().toISOString()),
      lastUpdatedAt: String(offer.lastUpdatedAt || offer.at || new Date().toISOString()),
      status: String(offer.status || 'captured'),
      sourceLabel: String(offer.sourceLabel || 'Telegram'),
      preview: String(offer.preview || 'Mensagem captada do Telegram.'),
      messageCount: Math.max(1, Number(offer.messageCount || 1)),
      groupCount: Math.max(0, Number(offer.groupCount || 0)),
      deliveryCount: Math.max(0, Number(offer.deliveryCount || 0)),
      fromQueue: Boolean(offer.fromQueue),
      reason: String(offer.reason || ''),
      metadata: offer.metadata && typeof offer.metadata === 'object' ? offer.metadata : {}
    }))
  };
}
