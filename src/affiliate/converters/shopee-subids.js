const maxSubIdLength = 40;

export function sanitizeSubId(value, fallback = 'unknown') {
  const normalizedFallback = normalizeValue(fallback) || 'unknown';
  const normalizedValue = normalizeValue(value);

  return (normalizedValue || normalizedFallback).slice(0, maxSubIdLength);
}

export function buildShopeeSubIds({
  userId,
  sourceChannel = 'telegram',
  sourceGroupId,
  sourceGroupName,
  destinationGroupId,
  destinationGroupName,
  destinationCount,
  campaign
} = {}) {
  return {
    subId1: buildUserSubId(userId),
    subId2: sanitizeSubId(sourceChannel, 'unknown'),
    subId3: sanitizeSubId(sourceGroupName || sourceGroupId, 'origem'),
    subId4: sanitizeSubId(resolveDestinationLabel({ destinationGroupId, destinationGroupName, destinationCount }), 'destino'),
    subId5: sanitizeSubId(campaign, 'auto')
  };
}

export function toShopeeSubIdArray(subIds = {}) {
  return [subIds.subId1, subIds.subId2, subIds.subId3, subIds.subId4, subIds.subId5]
    .map((value, index) => sanitizeSubId(value, defaultSubIdFallback(index)))
    .filter(Boolean)
    .slice(0, 5);
}

function buildUserSubId(userId) {
  const compactUserId = String(userId ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return sanitizeSubId(compactUserId ? `u${compactUserId}` : '', 'user');
}

function resolveDestinationLabel({ destinationGroupId, destinationGroupName, destinationCount }) {
  const count = Number(destinationCount || 0);

  if (count > 1) {
    return `multi-${count}`;
  }

  return destinationGroupName || destinationGroupId || 'destino';
}

function defaultSubIdFallback(index) {
  return ['user', 'unknown', 'origem', 'destino', 'auto'][index] || 'unknown';
}

function normalizeValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}
