const trailingUrlPunctuation = /[),.;:!?]+$/;

export function extractUrls(text) {
  const content = String(text ?? '');
  const matches = content.match(/https?:\/\/[^\s<>"']+/giu) || [];

  return matches
    .map((url) => url.replace(trailingUrlPunctuation, ''))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    });
}

