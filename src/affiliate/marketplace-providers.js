import { convertAmazonLink } from './converters/amazon-affiliate-converter.js';
import { convertMercadoLivreLink } from './converters/mercadolivre-affiliate-converter.js';
import { convertShopeeLink } from './converters/shopee-affiliate-converter.js';
import {
  generateMercadoLivreAffiliateUrlWithPython,
  getMercadoLivreStorageStatePath,
  isMercadoLivreBrowserAutomationEnabled
} from './mercadolivre-browser-automation.js';
import { getAffiliateLinkCache, upsertAffiliateLinkCache } from './affiliate-store.js';
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
  const convertMercadoLivreLinkFn = options.convertMercadoLivreLinkFn || convertMercadoLivreLink;
  const shortenUrlFn = options.shortenUrlFn || createUrlShortenerFromEnv();
  const getAffiliateLinkCacheFn = options.getAffiliateLinkCacheFn || getAffiliateLinkCache;
  const upsertAffiliateLinkCacheFn = options.upsertAffiliateLinkCacheFn || upsertAffiliateLinkCache;
  const generateMercadoLivreAffiliateUrlFn =
    options.generateMercadoLivreAffiliateUrlFn || generateMercadoLivreAffiliateUrlWithPython;

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
    },
    mercadolivre: async (context) => {
      if (!context.account?.mercadoLivreEnabled) {
        return buildIgnoredConversion(context.originalUrl, context.expandedUrl, 'mercadolivre');
      }

      const mercadoLivreResult = await convertMercadoLivreLinkFn(context.expandedUrl, {
        userId: context.userId,
        label: context.account.defaultSubId,
        automationEnabled: Boolean(context.account?.mercadoLivreAutoEnabled) && isMercadoLivreBrowserAutomationEnabled(),
        storageStatePath: getMercadoLivreStorageStatePath(context.userId),
        lookupAffiliateLinkFn: async ({ marketplace, productKey, label }) => await getAffiliateLinkCacheFn({
          userId: context.userId,
          marketplace,
          productKey,
          label
        }),
        saveAffiliateLinkFn: async ({ marketplace, productKey, label, originalUrl, affiliateUrl, source }) => await upsertAffiliateLinkCacheFn({
          userId: context.userId,
          marketplace,
          productKey,
          label,
          originalUrl,
          affiliateUrl,
          source
        }),
        generateAffiliateUrlFn: generateMercadoLivreAffiliateUrlFn
      });

      return {
        originalUrl: context.originalUrl,
        expandedUrl: context.expandedUrl,
        marketplace: 'mercadolivre',
        affiliateUrl: mercadoLivreResult.affiliateUrl,
        productKey: mercadoLivreResult.productKey,
        label: mercadoLivreResult.label,
        source: mercadoLivreResult.source,
        status: mercadoLivreResult.success
          ? 'converted'
          : mercadoLivreResult.status === 'ignored'
            ? 'ignored'
            : 'error',
        error: mercadoLivreResult.error
      };
    }
  };
}
