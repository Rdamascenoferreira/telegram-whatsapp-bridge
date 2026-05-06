import { extractUrlOccurrences, isSafeHttpUrl, normalizeUrlCandidate } from './url-extractor.js';

export function extractMessageUrlMatches({ text = '', telegramMessage = null } = {}) {
  const messageText = getTelegramMessageText(telegramMessage, text);
  const entityLinks = extractTelegramEntityLinks(telegramMessage, messageText);

  if (entityLinks.length) {
    const fallbackLinks = extractUrlOccurrences(messageText)
      .filter((fallbackLink) => !entityLinks.some((entityLink) => rangesOverlap(entityLink, fallbackLink)));
    return [...entityLinks, ...fallbackLinks].sort((left, right) => left.offset - right.offset);
  }

  return extractUrlOccurrences(messageText);
}

export function rebuildMessageWithUrlReplacements(text, urlMatches, replacements) {
  const content = String(text ?? '');
  const rangedMatches = Array.isArray(urlMatches)
    ? urlMatches.filter((match) => hasValidRange(match, content.length))
    : [];

  if (!rangedMatches.length) {
    return applyTextReplacements(content, replacements);
  }

  let result = content;
  const sorted = [...rangedMatches].sort((left, right) => right.offset - left.offset);

  for (const match of sorted) {
    const replacement = getReplacementForMatch(match, replacements);

    if (replacement === null) {
      continue;
    }

    result = result.slice(0, match.offset) + replacement + result.slice(match.offset + match.length);
  }

  return result.replace(/[ \t]+\n/g, '\n').trimEnd();
}

function extractTelegramEntityLinks(telegramMessage, text) {
  const entities = getTelegramEntities(telegramMessage);

  if (!entities.length) {
    return [];
  }

  const links = [];

  for (const entity of entities) {
    const offset = Number(entity?.offset);
    const length = Number(entity?.length);

    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0) {
      continue;
    }

    const displayText = text.slice(offset, offset + length);
    const entityKind = getEntityKind(entity);
    const rawUrl = entityKind === 'text_url' ? String(entity.url ?? '').trim() : displayText;

    if (!rawUrl) {
      continue;
    }

    const normalizedUrl = normalizeUrlCandidate(rawUrl);

    if (!isSafeHttpUrl(normalizedUrl)) {
      continue;
    }

    links.push({
      rawUrl: cleanEntityRawUrl(rawUrl),
      normalizedUrl,
      displayText,
      offset,
      length,
      source: entityKind
    });
  }

  return links.sort((left, right) => left.offset - right.offset);
}

function getTelegramEntities(telegramMessage) {
  if (!telegramMessage) {
    return [];
  }

  if (Array.isArray(telegramMessage.entities)) {
    return telegramMessage.entities;
  }

  if (Array.isArray(telegramMessage.message?.entities)) {
    return telegramMessage.message.entities;
  }

  if (Array.isArray(telegramMessage.caption_entities)) {
    return telegramMessage.caption_entities;
  }

  return [];
}

function getTelegramMessageText(telegramMessage, fallbackText) {
  if (!telegramMessage) {
    return String(fallbackText ?? '');
  }

  return String(
    telegramMessage.message
      ?? telegramMessage.text
      ?? telegramMessage.caption
      ?? fallbackText
      ?? ''
  );
}

function getEntityKind(entity) {
  const name = String(entity?.className ?? entity?.constructor?.name ?? entity?._ ?? '').toLowerCase();

  if (entity?.url && name.includes('texturl')) {
    return 'text_url';
  }

  if (entity?.url && name.includes('text_url')) {
    return 'text_url';
  }

  if (entity?.url && !name.includes('url')) {
    return 'text_url';
  }

  if (name.includes('messageentityurl') || name === 'url' || name.includes('entityurl')) {
    return 'url';
  }

  return entity?.url ? 'text_url' : 'url';
}

function getReplacementForMatch(match, replacements) {
  const keys = [
    match.normalizedUrl,
    match.rawUrl,
    match.displayText
  ].filter(Boolean);

  for (const key of keys) {
    if (replacements.has(key)) {
      return String(replacements.get(key) ?? '');
    }
  }

  return null;
}

function applyTextReplacements(text, replacements) {
  let processed = text;

  for (const [originalUrl, replacement] of replacements.entries()) {
    processed = processed.split(originalUrl).join(replacement);
  }

  return processed.replace(/[ \t]+\n/g, '\n').trimEnd();
}

function hasValidRange(match, textLength) {
  return Number.isInteger(match?.offset)
    && Number.isInteger(match?.length)
    && match.offset >= 0
    && match.length >= 0
    && match.offset + match.length <= textLength;
}

function cleanEntityRawUrl(url) {
  return String(url ?? '').trim();
}

function rangesOverlap(left, right) {
  if (!hasValidRange(left, Number.MAX_SAFE_INTEGER) || !hasValidRange(right, Number.MAX_SAFE_INTEGER)) {
    return false;
  }

  const leftEnd = left.offset + left.length;
  const rightEnd = right.offset + right.length;
  return left.offset < rightEnd && right.offset < leftEnd;
}
