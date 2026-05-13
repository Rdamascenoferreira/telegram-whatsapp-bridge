const trailingUrlPunctuation = /[)\].,;:!?*_~]+$/;
const urlLikePattern = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/giu;

export function extractUrls(text) {
  return extractUrlMatches(text).map((item) => item.normalizedUrl);
}

export function extractUrlMatches(text) {
  const matches = extractUrlOccurrences(text);
  const uniqueMatches = [];
  const seenUrls = new Set();

  for (const match of matches) {
    if (seenUrls.has(match.normalizedUrl)) {
      continue;
    }

    seenUrls.add(match.normalizedUrl);
    uniqueMatches.push(match);
  }

  return uniqueMatches;
}

export function extractUrlOccurrences(text) {
  const content = String(text ?? '');
  const matches = [];

  for (const match of content.matchAll(urlLikePattern)) {
    const candidate = match[0] || '';
    const rawUrl = cleanUrlCandidate(candidate);
    const normalizedUrl = normalizeUrlCandidate(rawUrl);

    if (!isSafeHttpUrl(normalizedUrl)) {
      continue;
    }

    const index = Number(match.index ?? 0);
    matches.push({
      rawUrl,
      normalizedUrl,
      displayText: rawUrl,
      offset: index,
      length: rawUrl.length,
      source: 'text'
    });
  }

  return matches;
}

export function cleanUrlCandidate(candidate) {
  return String(candidate ?? '').replace(trailingUrlPunctuation, '');
}

export function normalizeUrlCandidate(candidate) {
  const cleaned = cleanUrlCandidate(candidate);

  if (/^https?:\/\//iu.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned}`;
}

export function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
