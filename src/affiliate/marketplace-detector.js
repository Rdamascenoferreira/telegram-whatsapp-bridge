const amazonHosts = new Set(['amazon.com.br', 'www.amazon.com.br', 'amazon.com', 'www.amazon.com', 'amzn.to']);
const shopeeHosts = new Set(['shopee.com.br', 'www.shopee.com.br', 's.shopee.com.br', 'shope.ee']);

export function detectMarketplace(url) {
  try {
    const host = new URL(String(url ?? '')).hostname.toLowerCase();

    if (amazonHosts.has(host)) {
      return 'amazon';
    }

    if (shopeeHosts.has(host)) {
      return 'shopee';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

