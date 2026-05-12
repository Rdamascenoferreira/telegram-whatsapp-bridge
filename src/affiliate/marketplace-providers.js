import { convertAmazonLink } from './converters/amazon-affiliate-converter.js';
import { convertShopeeLink } from './converters/shopee-affiliate-converter.js';
import { createUrlShortenerFromEnv } from './url-shortener.js';

function buildIgnoredConversion(originalUrl, expandedUrl, marketplace, error = '') {
  return {
    originalUrl,
    expandedUrl,
    marketplace,
    status: 'ignored',
    ...(error ? { error } : {})
  };
}

export function createMarketplaceProviders(options = {}) {
  const convertAmazonLinkFn = options.convertAmazonLinkFn || convertAmazonLink;
  const convertShopeeLinkFn = options.convertShopeeLinkFn || convertShopeeLink;
  const shortenUrlFn = options.shortenUrlFn || createUrlShortenerFromEnv();

  return {
    amazon: async (context) => {
      if (context.isCouponOrPromoLink) {
        return buildIgnoredConversion(
          context.originalUrl,
          context.expandedUrl,
          'amazon',
          'Coupon/promo link kept without affiliate conversion'
        );
      }

      if (!context.account?.amazonEnabled) {
        return buildIgnoredConversion(context.originalUrl, context.expandedUrl, 'amazon');
      }

      const amazonResult = convertAmazonLinkFn(context.expandedUrl, context.account.amazonTag);
      let affiliateUrl = amazonResult.affiliateUrl;

      if (amazonResult.success && affiliateUrl && shortenUrlFn && context.account?.amazonShortenerEnabled) {
        try {
          affiliateUrl = await shortenUrlFn(affiliateUrl);
        } catch (error) {
          // Fallback seguro: mantém o link original com tag de afiliado.
          console.warn(`Amazon shortener fallback: ${error.message}`);
        }
      }

      return {
        originalUrl: context.originalUrl,
        expandedUrl: context.expandedUrl,
        marketplace: 'amazon',
        affiliateUrl,
        status: amazonResult.success ? 'converted' : 'error',
        error: amazonResult.error
      };
    },
    shopee: async (context) => {
      if (!context.account?.shopeeEnabled) {
        return buildIgnoredConversion(context.originalUrl, context.expandedUrl, 'shopee');
      }

      const shopeeResult = await convertShopeeLinkFn(context.expandedUrl, {
        affiliateId: context.account.shopeeAffiliateId,
        appId: context.account.shopeeAppId,
        secret: context.account.shopeeSecret || context.params.shopeeSecret,
        userId: context.userId,
        sourceChannel: 'telegram',
        sourceGroupId: context.automation.telegramSourceGroupId,
        sourceGroupName: context.automation.telegramSourceGroupName,
        destinationGroupId: context.automation.destinations?.[0]?.whatsappGroupId,
        destinationGroupName: context.automation.destinations?.[0]?.whatsappGroupName,
        destinationCount: context.automation.destinations?.length || 0,
        campaign: context.account.defaultSubId
      });

      return {
        originalUrl: context.originalUrl,
        expandedUrl: context.expandedUrl,
        marketplace: 'shopee',
        affiliateUrl: shopeeResult.affiliateUrl,
        affiliateId: shopeeResult.affiliateId,
        subIds: shopeeResult.subIds,
        utmContent: shopeeResult.utmContent,
        status: shopeeResult.success ? 'converted' : 'error',
        error: shopeeResult.error
      };
    }
  };
}
