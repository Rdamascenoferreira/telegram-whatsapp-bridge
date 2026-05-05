const trailingUrlPunctuation = /[),.;:!?]+$/;
const urlLikePattern = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/giu;

export function extractUrls(text) {
  return extractUrlMatches(text).map((item) => item.normalizedUrl);
}

export function extractUrlMatches(text) {
  const content = String(text ?? '');
  const matches = content.match(urlLikePattern) || [];
  const uniqueMatches = [];
  const seenUrls = new Set();

  for (const match of matches) {
    const rawUrl = cleanUrlCandidate(match);
    const normalizedUrl = normalizeUrlCandidate(rawUrl);

    if (seenUrls.has(normalizedUrl)) {
      continue;
    }

    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        continue;
      }
    } catch {
      continue;
    }

    seenUrls.add(normalizedUrl);
    uniqueMatches.push({ rawUrl, normalizedUrl });
  }

  return uniqueMatches;
}

function cleanUrlCandidate(candidate) {
  return String(candidate ?? '').replace(trailingUrlPunctuation, '');
}

function normalizeUrlCandidate(candidate) {
  const cleaned = cleanUrlCandidate(candidate);

  if (/^https?:\/\//iu.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned}`;
}
