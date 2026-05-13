const amazonHosts = new Set(['amazon.com.br', 'www.amazon.com.br', 'amazon.com', 'www.amazon.com', 'amzn.to']);
const shopeeHosts = new Set(['shopee.com.br', 'www.shopee.com.br', 's.shopee.com.br', 'shope.ee']);

export function detectMarketplace(url, options = {}) {
  const candidateUrls = [
    String(url ?? '').trim(),
    String(options.originalUrl ?? '').trim()
  ].filter(Boolean);

  for (const candidate of candidateUrls) {
    const byHost = detectByHost(candidate);
    if (byHost !== 'unknown') {
      return byHost;
    }
  }

  for (const candidate of candidateUrls) {
    const byPattern = detectByUrlPattern(candidate);
    if (byPattern !== 'unknown') {
      return byPattern;
    }
  }

  return 'unknown';
}

function detectByHost(url) {
  try {
    const host = new URL(String(url ?? '')).hostname.toLowerCase();

    if (amazonHosts.has(host)) {
      return 'amazon';
    }

    if (shopeeHosts.has(host)) {
      return 'shopee';
    }
  } catch {}
  return 'unknown';
}

function detectByUrlPattern(url) {
  const normalized = String(url || '').toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  const amazonSignals = [
    'amazon.com.br',
    'amazon.com',
    'amzn.to',
    '/dp/',
    '/gp/product',
    'tag='
  ];

  if (amazonSignals.some((signal) => normalized.includes(signal))) {
    return 'amazon';
  }

  const shopeeSignals = ['shopee.com.br', 'shopee.com', 'shope.ee'];
  if (shopeeSignals.some((signal) => normalized.includes(signal))) {
    return 'shopee';
  }

  return 'unknown';
}
