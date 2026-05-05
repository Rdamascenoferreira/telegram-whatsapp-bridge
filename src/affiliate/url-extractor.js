const trailingUrlPunctuation = /[),.;:!?]+$/;
const urlLikePattern = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/giu;

export function extractUrls(text) {
  const content = String(text ?? '');
  const matches = content.match(urlLikePattern) || [];

  return matches
    .map(normalizeUrlCandidate)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    })
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function normalizeUrlCandidate(candidate) {
  const cleaned = String(candidate ?? '').replace(trailingUrlPunctuation, '');

  if (/^https?:\/\//iu.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned}`;
}
