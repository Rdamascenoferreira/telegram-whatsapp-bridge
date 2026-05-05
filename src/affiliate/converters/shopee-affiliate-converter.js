import crypto from 'node:crypto';
import { detectMarketplace } from '../marketplace-detector.js';

const defaultShopeeAffiliateEndpoint = 'https://open-api.affiliate.shopee.com.br/graphql';
const requestTimeoutMs = 8000;

export async function convertShopeeLink(expandedUrl, userShopeeConfig = {}) {
  if (detectMarketplace(expandedUrl) !== 'shopee') {
    return {
      success: false,
      marketplace: 'shopee',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'URL is not a Shopee link'
    };
  }

  const appId = cleanText(userShopeeConfig.appId);
  const secret = cleanText(userShopeeConfig.secret);

  if (!appId || !secret) {
    return {
      success: false,
      marketplace: 'shopee',
      originalExpandedUrl: String(expandedUrl ?? ''),
      error: 'Shopee App ID and Secret are required'
    };
  }

  const endpoint = cleanText(userShopeeConfig.endpoint || process.env.SHOPEE_AFFILIATE_API_URL) || defaultShopeeAffiliateEndpoint;
  const subIds = buildSubIds(userShopeeConfig);
  const fetchFn = userShopeeConfig.fetchFn || fetch;
  const nowFn = userShopeeConfig.nowFn || (() => Math.floor(Date.now() / 1000));

  try {
    validateHttpUrl(endpoint, 'Shopee API endpoint');
    validateHttpUrl(expandedUrl, 'Shopee URL');

    const shortLinkResult = await requestShopeeShortLink({
      endpoint,
      appId,
      secret,
      originUrl: expandedUrl,
      subIds,
      fetchFn,
      nowFn
    });

    if (shortLinkResult.shortLink) {
      return buildSuccess(expandedUrl, shortLinkResult.shortLink);
    }

    return buildError(expandedUrl, shortLinkResult.error || 'Shopee short link was not returned');
  } catch (error) {
    return buildError(expandedUrl, error.message);
  }
}

async function requestShopeeShortLink({ endpoint, appId, secret, originUrl, subIds, fetchFn, nowFn }) {
  const body = buildShopeePayload(originUrl, subIds);
  const payload = JSON.stringify(body);
  const timestamp = Number(nowFn());
  const signature = crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`
      },
      body: payload,
      signal: controller.signal
    });

    const responseText = await response.text().catch(() => '');

    if (!response.ok) {
      return {
        shortLink: '',
        error: `Shopee API returned HTTP ${response.status}: ${safeErrorText(responseText)}`
      };
    }

    const data = responseText.trim() ? JSON.parse(responseText) : {};
    const graphQlError = extractGraphQlErrors(data);
    const shortLink = extractShortLink(data);

    return {
      shortLink,
      error: shortLink ? '' : graphQlError
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildShopeePayload(originUrl, subIds) {
  const args = [`originUrl: ${JSON.stringify(originUrl)}`];

  if (subIds.length) {
    args.push(`subIds: ${JSON.stringify(subIds)}`);
  }

  return {
    query: `mutation { generateShortLink(${args.join(', ')}) { shortLink } }`
  };
}

function extractShortLink(payload) {
  const result = payload?.data?.generateShortLink;

  if (typeof result === 'string') {
    return result;
  }

  return cleanText(result?.shortLink || result?.short_link || result?.shortUrl || result?.short_url || result?.link);
}

function extractGraphQlErrors(payload) {
  if (!Array.isArray(payload?.errors) || !payload.errors.length) {
    return '';
  }

  return payload.errors
    .map((item) => item?.message || item?.extensions?.message)
    .filter(Boolean)
    .join('; ');
}

function buildSubIds(userShopeeConfig) {
  return [userShopeeConfig.subId, userShopeeConfig.affiliateId]
    .map((value) => cleanText(value).replace(/[^\w-]/g, '').slice(0, 80))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5);
}

function buildSuccess(expandedUrl, shortLink) {
  return {
    success: true,
    marketplace: 'shopee',
    originalExpandedUrl: String(expandedUrl ?? ''),
    affiliateUrl: shortLink
  };
}

function buildError(expandedUrl, error) {
  return {
    success: false,
    marketplace: 'shopee',
    originalExpandedUrl: String(expandedUrl ?? ''),
    error: safeErrorText(error) || 'Shopee affiliate conversion failed'
  };
}

function validateHttpUrl(value, label) {
  const url = new URL(String(value ?? ''));

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function safeErrorText(value) {
  return cleanText(value).replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 500);
}
