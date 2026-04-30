const asinPatterns = [
  /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i
];

export function convertAmazonLink(expandedUrl, amazonTag) {
  const tag = String(amazonTag ?? '').trim();

  if (!tag) {
    return {
      success: false,
      marketplace: 'amazon',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'Amazon affiliate tag is empty'
    };
  }

  try {
    const url = new URL(String(expandedUrl ?? ''));
    url.searchParams.delete('tag');
    const asin = extractAsin(url);

    if (asin) {
      return {
        success: true,
        marketplace: 'amazon',
        originalExpandedUrl: String(expandedUrl),
        affiliateUrl: `${url.origin}/dp/${asin}?tag=${encodeURIComponent(tag)}`
      };
    }

    url.searchParams.set('tag', tag);

    return {
      success: true,
      marketplace: 'amazon',
      originalExpandedUrl: String(expandedUrl),
      affiliateUrl: url.toString()
    };
  } catch {
    return {
      success: false,
      marketplace: 'amazon',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'Invalid Amazon URL'
    };
  }
}

function extractAsin(url) {
  const pathname = String(url?.pathname ?? '');

  for (const pattern of asinPatterns) {
    const match = pathname.match(pattern);

    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return '';
}

