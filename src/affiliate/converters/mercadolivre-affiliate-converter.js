import { detectMarketplace } from '../marketplace-detector.js';
import {
  extractMercadoLivreProductKey,
  isSupportedMercadoLivreProductUrl
} from './mercadolivre-product-key.js';

export async function convertMercadoLivreLink(expandedUrl, config = {}) {
  const originalExpandedUrl = String(expandedUrl ?? '').trim();

  if (detectMarketplace(originalExpandedUrl) !== 'mercadolivre') {
    return buildError(originalExpandedUrl, 'URL is not a Mercado Livre link');
  }

  const productKey = extractMercadoLivreProductKey(originalExpandedUrl);
  const label = cleanText(config.label);

  if (!productKey || !isSupportedMercadoLivreProductUrl(originalExpandedUrl)) {
    return buildIgnored(originalExpandedUrl, productKey, label, 'Mercado Livre URL is not a product page');
  }

  const cached = await safeLookup(config.lookupAffiliateLinkFn, {
    marketplace: 'mercadolivre',
    productKey,
    label,
    originalUrl: originalExpandedUrl
  });

  if (cached.affiliateUrl) {
    return buildSuccess(originalExpandedUrl, cached.affiliateUrl, {
      productKey,
      label,
      source: cached.source || 'cache'
    });
  }

  if (cached.error && !config.generateAffiliateUrlFn) {
    return buildIgnored(originalExpandedUrl, productKey, label, cached.error);
  }

  if (!config.automationEnabled || !config.generateAffiliateUrlFn) {
    return buildIgnored(
      originalExpandedUrl,
      productKey,
      label,
      'Mercado Livre browser automation is disabled or unavailable'
    );
  }

  const generated = await safeGenerate(config.generateAffiliateUrlFn, {
    url: originalExpandedUrl,
    productKey,
    label,
    userId: config.userId,
    storageStatePath: config.storageStatePath,
    timeoutMs: config.timeoutMs
  });

  if (!generated.success || !generated.affiliateUrl) {
    return buildIgnored(
      originalExpandedUrl,
      productKey,
      label,
      generated.error || 'Mercado Livre affiliate link was not generated'
    );
  }

  const affiliateUrl = normalizeHttpUrl(generated.affiliateUrl);
  if (!affiliateUrl) {
    return buildError(originalExpandedUrl, 'Mercado Livre generator returned an invalid URL');
  }

  await safeSave(config.saveAffiliateLinkFn, {
    marketplace: 'mercadolivre',
    productKey,
    label,
    originalUrl: originalExpandedUrl,
    affiliateUrl,
    source: generated.source || 'browser_automation'
  });

  return buildSuccess(originalExpandedUrl, affiliateUrl, {
    productKey,
    label,
    source: generated.source || 'browser_automation'
  });
}

async function safeLookup(lookupFn, payload) {
  if (!lookupFn) {
    return {};
  }

  try {
    return (await lookupFn(payload)) || {};
  } catch (error) {
    return {
      error: `Mercado Livre cache unavailable: ${safeErrorText(error?.message)}`
    };
  }
}

async function safeGenerate(generateFn, payload) {
  try {
    return (await generateFn(payload)) || {};
  } catch (error) {
    return {
      success: false,
      error: safeErrorText(error?.message) || 'Mercado Livre browser automation failed'
    };
  }
}

async function safeSave(saveFn, payload) {
  if (!saveFn) {
    return;
  }

  try {
    await saveFn(payload);
  } catch (error) {
    console.warn(`Mercado Livre affiliate cache save skipped: ${safeErrorText(error?.message)}`);
  }
}

function buildSuccess(originalExpandedUrl, affiliateUrl, metadata = {}) {
  return {
    success: true,
    status: 'converted',
    marketplace: 'mercadolivre',
    originalExpandedUrl,
    affiliateUrl,
    ...metadata
  };
}

function buildIgnored(originalExpandedUrl, productKey, label, error = '') {
  return {
    success: false,
    status: 'ignored',
    marketplace: 'mercadolivre',
    originalExpandedUrl,
    productKey,
    label,
    error: safeErrorText(error)
  };
}

function buildError(originalExpandedUrl, error = '') {
  return {
    success: false,
    status: 'error',
    marketplace: 'mercadolivre',
    originalExpandedUrl,
    error: safeErrorText(error) || 'Mercado Livre affiliate conversion failed'
  };
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function safeErrorText(value) {
  return cleanText(value).replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 500);
}
