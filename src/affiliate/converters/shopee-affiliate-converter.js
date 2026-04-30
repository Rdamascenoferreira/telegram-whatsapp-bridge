import { detectMarketplace } from '../marketplace-detector.js';

export async function convertShopeeLink(expandedUrl, userShopeeConfig = {}) {
  if (detectMarketplace(expandedUrl) !== 'shopee') {
    return {
      success: false,
      marketplace: 'shopee',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'URL is not a Shopee link'
    };
  }

  const hasConfig = Boolean(
    userShopeeConfig.affiliateId ||
      userShopeeConfig.appId ||
      userShopeeConfig.secret ||
      userShopeeConfig.subId
  );

  if (!hasConfig) {
    return {
      success: false,
      marketplace: 'shopee',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'Shopee affiliate config is empty'
    };
  }

  return {
    success: false,
    marketplace: 'shopee',
    originalExpandedUrl: String(expandedUrl ?? ''),
    error: 'Shopee affiliate conversion provider not configured'
  };
}

