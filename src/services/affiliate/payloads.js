import { normalizePostLayoutConfig } from '../../affiliate/post-layout-config.js';
import { generateCleanPostLayoutImage } from '../../affiliate/post-layout-generator.js';

const postLayoutRenderTimeoutMs = parseBoundedTimeout(
  process.env.AFFILIATE_POST_LAYOUT_RENDER_TIMEOUT_MS,
  12000,
  1000,
  60000
);
const postLayoutMaxGenerationsPerMinute = parseBoundedInteger(
  process.env.AFFILIATE_POST_LAYOUT_MAX_GENERATIONS_PER_MINUTE,
  12,
  1,
  120
);

export async function prepareAffiliateChannelPayloads(
  runtime,
  { originalMessageText, telegramMessage, automation, convertedUrls }
) {
  const whatsAppPayload = await prepareAffiliateWhatsAppPayload(runtime, {
    messageText: sanitizeWhatsAppAffiliateText(originalMessageText),
    telegramMessage,
    automation,
    convertedUrls
  });

  const telegramPayload = await prepareAffiliateTelegramPayload(runtime, {
    messageText: originalMessageText,
    telegramMessage,
    automation,
    convertedUrls
  });

  return {
    whatsApp: whatsAppPayload,
    telegram: telegramPayload
  };
}

export async function prepareAffiliateWhatsAppPayload(
  runtime,
  { messageText, telegramMessage, automation, convertedUrls }
) {
  const mode = normalizeAffiliateMediaSourceMode(automation?.mediaSourceMode);

  if (mode === 'system_layout') {
    const layoutPayload = await prepareAffiliateCleanPostLayoutPayload(runtime, messageText, convertedUrls, {
      force: true,
      telegramMessage
    });

    if (layoutPayload) {
      return layoutPayload;
    }

    return {
      type: 'text',
      text: messageText
    };
  }

  if (mode === 'product_image') {
    const productImagePayload = await prepareAffiliateProductImagePayload(runtime, messageText, convertedUrls, {
      preferSystemLayout: false
    });

    if (productImagePayload) {
      return productImagePayload;
    }
  }

  if (telegramMessage) {
    try {
      const originalPayload = await runtime.prepareWhatsAppPayload(telegramMessage);

      if (originalPayload.type === 'media') {
        return {
          ...originalPayload,
          caption: messageText
        };
      }
    } catch (error) {
      runtime.log(`Nao foi possivel reaproveitar a midia original no fluxo de afiliados: ${error.message}`, {
        level: 'error',
        type: 'affiliate_media_fallback',
        increments: { errors: 1 }
      });
    }
  }

  return {
    type: 'text',
    text: messageText
  };
}

export async function prepareAffiliateTelegramPayload(
  runtime,
  { messageText, telegramMessage, automation, convertedUrls }
) {
  const mode = normalizeAffiliateMediaSourceMode(automation?.mediaSourceMode);

  if (mode === 'system_layout') {
    const layoutPayload = await prepareAffiliateCleanPostLayoutPayload(runtime, messageText, convertedUrls, {
      force: true,
      telegramMessage
    });

    if (layoutPayload) {
      return layoutPayload;
    }

    return {
      type: 'text',
      text: messageText
    };
  }

  if (mode === 'product_image') {
    const productImagePayload = await prepareAffiliateProductImagePayload(runtime, messageText, convertedUrls, {
      preferSystemLayout: false
    });

    if (productImagePayload) {
      return productImagePayload;
    }
  }

  if (telegramMessage) {
    try {
      const originalPayload = await runtime.prepareWhatsAppPayload(telegramMessage);

      if (originalPayload.type === 'media') {
        return {
          ...originalPayload,
          caption: messageText
        };
      }
    } catch (error) {
      runtime.log(`Nao foi possivel reaproveitar a midia original no envio para Telegram: ${error.message}`, {
        level: 'error',
        type: 'affiliate_media_fallback',
        increments: { errors: 1 }
      });
    }
  }

  return {
    type: 'text',
    text: messageText
  };
}

export async function prepareAffiliateProductImagePayload(runtime, messageText, convertedUrls = [], options = {}) {
  const preferSystemLayout = options.preferSystemLayout !== false;

  if (preferSystemLayout) {
    const cleanPostLayoutPayload = await prepareAffiliateCleanPostLayoutPayload(runtime, messageText, convertedUrls);

    if (cleanPostLayoutPayload) {
      return cleanPostLayoutPayload;
    }
  }

  const convertedItem = extractPrimaryConvertedProduct(convertedUrls);
  const productUrl = convertedItem
    ? await runtime.fetchPreferredProductImageUrl(convertedItem)
    : extractPrimaryConvertedProductUrl(convertedUrls);

  if (!productUrl) {
    return null;
  }

  return await runtime.downloadExternalImageAsMediaPayload(productUrl, messageText);
}

export async function prepareAffiliateCleanPostLayoutPayload(
  runtime,
  messageText,
  convertedUrls = [],
  options = {}
) {
  const settings = normalizePostLayoutConfig(runtime.config?.postLayout);
  const force = Boolean(options.force);

  if (!settings.enabled && !force) {
    return null;
  }

  const convertedCandidates = Array.isArray(convertedUrls)
    ? convertedUrls.filter((item) => item?.status === 'converted' && item?.affiliateUrl)
    : [];
  const convertedProducts = convertedCandidates.filter((item) => !isLikelyCouponConvertedUrl(messageText, item));
  const converted = (convertedProducts.length ? convertedProducts : convertedCandidates).slice(0, settings.maxProducts);

  if (!converted.length) {
    return null;
  }

  const sharedPriceLines = collectSharedPostLayoutPriceLines(messageText, converted);

  const cacheKey = runtime.buildPostLayoutCacheKey({ messageText, converted, settings });
  const cachedPayload = runtime.getCachedPostLayoutPayload(cacheKey);
  if (cachedPayload) {
    return {
      type: 'media',
      base64: cachedPayload.base64,
      mimeType: cachedPayload.mimeType,
      filename: `affiliate-layout-${Date.now()}.${inferImageExtension(cachedPayload.mimeType)}`,
      caption: messageText
    };
  }

  if (!runtime.reservePostLayoutGenerationSlot()) {
    runtime.log('Layout de postagem ignorado por limite de geracoes por minuto.', {
      level: 'error',
      type: 'affiliate_post_layout_rate_limit',
      increments: { errors: 1 },
      metadata: {
        limit: postLayoutMaxGenerationsPerMinute
      }
    });
    return null;
  }

  try {
    const sourceFallbackImageBuffer = await runtime.getPostLayoutSourceFallbackImageBuffer(
      options.telegramMessage,
      converted
    );
    const products = await Promise.all(
      converted.map(async (item, index) => {
        const metadata = await runtime.fetchPreferredProductMetadata(item);
        const imageUrl = metadata.imageUrl;
        let imageBuffer = imageUrl ? await runtime.downloadExternalImageBuffer(imageUrl) : null;

        if (
          !imageBuffer &&
          sourceFallbackImageBuffer &&
          converted.length === 1 &&
          !['shopee', 'mercadolivre'].includes(String(item?.marketplace || '').toLowerCase())
        ) {
          imageBuffer = sourceFallbackImageBuffer;
        }

        const details = extractPostLayoutProductDetails(messageText, item, index, {
          sharedPriceLines,
          pageTitle: metadata.title
        });
        return {
          ...details,
          marketplace: item.marketplace,
          imageBuffer
        };
      })
    );
    const imageBuffer = await withTimeout(
      generateCleanPostLayoutImage({ products, settings, messageText }),
      postLayoutRenderTimeoutMs
    );

    if (!imageBuffer) {
      return null;
    }
    const mimeType = 'image/png';
    const base64 = imageBuffer.toString('base64');
    runtime.setCachedPostLayoutPayload(cacheKey, {
      base64,
      mimeType
    });

    return {
      type: 'media',
      base64,
      mimeType,
      filename: `affiliate-layout-${Date.now()}.png`,
      caption: messageText
    };
  } catch (error) {
    runtime.log(`Layout de postagem indisponivel: ${error.message}`, {
      level: 'error',
      type: 'affiliate_post_layout_error',
      increments: { errors: 1 }
    });
    return null;
  }
}

function normalizeAffiliateMediaSourceMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return ['telegram_media', 'product_image', 'system_layout'].includes(mode) ? mode : 'telegram_media';
}

function sanitizeWhatsAppAffiliateText(value) {
  const lines = String(value ?? '').split('\n');
  const cleaned = lines.map((line) => stripWrappedFormattingMarkers(line));
  return cleaned.join('\n');
}

function stripWrappedFormattingMarkers(line) {
  const value = String(line ?? '');
  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  const unwrapped = trimmed
    .replace(/^\*(.+)\*$/u, '$1')
    .replace(/^_(.+)_$/u, '$1')
    .replace(/^~(.+)~$/u, '$1');

  return value.replace(trimmed, unwrapped);
}

function extractPrimaryConvertedProductUrl(convertedUrls = []) {
  const converted = Array.isArray(convertedUrls)
    ? convertedUrls.find((item) => item?.status === 'converted' && item?.affiliateUrl)
    : null;

  return converted ? String(converted.affiliateUrl).trim() : '';
}

function extractPrimaryConvertedProduct(convertedUrls = []) {
  return Array.isArray(convertedUrls)
    ? convertedUrls.find((item) => item?.status === 'converted' && item?.affiliateUrl)
    : null;
}

function isLikelyCouponConvertedUrl(messageText, convertedUrl = {}) {
  const lines = String(messageText ?? '').split('\n');
  const affiliateUrl = String(convertedUrl?.affiliateUrl || '').trim();
  const originalUrlFull = String(convertedUrl?.originalUrl || '').trim();
  const originalUrl = originalUrlFull.replace(/^https?:\/\//i, '');
  const lineIndex = findProductUrlLineIndex(lines, affiliateUrl, originalUrlFull, originalUrl);

  if (lineIndex < 0) {
    return false;
  }

  const couponPattern = /\b(?:cupom|cupons|coupon|cupon|resgate|resgatar|aplique|ative|desconto|off)\b/iu;
  const productHintPattern = /\b(?:ps5|playstation|xbox|switch|nintendo|pc|produto|jogo|game|monitor|tv|smartphone|notebook)\b/iu;
  const currentLine = String(lines[lineIndex] ?? '');
  const previousLine = String(lines[lineIndex - 1] ?? '');
  const previousTwoLine = String(lines[lineIndex - 2] ?? '');
  const context = [previousTwoLine, previousLine, currentLine].join(' ').toLowerCase();

  if (productHintPattern.test(context)) {
    return false;
  }

  return couponPattern.test(context);
}

function extractPostLayoutProductDetails(messageText, convertedUrl, index, options = {}) {
  const lines = String(messageText ?? '').split('\n');
  const affiliateUrl = String(convertedUrl?.affiliateUrl || '').trim();
  const originalUrlFull = String(convertedUrl?.originalUrl || '').trim();
  const originalUrl = originalUrlFull.replace(/^https?:\/\//i, '');
  const lineIndex = findProductUrlLineIndex(lines, affiliateUrl, originalUrlFull, originalUrl);
  const contextStart = lineIndex >= 0 ? lineIndex : 0;
  const sameLine = lineIndex >= 0 ? lines[lineIndex] : '';
  const inlineTitle = cleanPostLayoutTitle(removeKnownUrlsFromLine(sameLine, [affiliateUrl, originalUrlFull, originalUrl]));
  const previousTitle = cleanPostLayoutTitle(findPreviousProductTitleLine(lines, contextStart));
  const pageTitle = cleanPostLayoutTitle(options.pageTitle || '');
  const title = resolvePostLayoutTitle(pageTitle, inlineTitle, previousTitle, index);
  const priceLines = collectNearbyPriceLines(lines, contextStart);
  const sharedPriceLines = Array.isArray(options.sharedPriceLines) ? options.sharedPriceLines : [];
  const resolvedPriceLines = priceLines.length ? priceLines : sharedPriceLines;
  const { price, installment } = splitPostLayoutPriceLines(resolvedPriceLines);

  return {
    title,
    price,
    installment
  };
}

function resolvePostLayoutTitle(pageTitle, inlineTitle, previousTitle, index) {
  if (pageTitle) {
    return pageTitle;
  }

  if (inlineTitle && previousTitle) {
    if (looksLikeSizeOnlyVariant(inlineTitle)) {
      return cleanPostLayoutTitle(
        previousTitle.toLowerCase().includes(inlineTitle.toLowerCase())
          ? previousTitle
          : `${previousTitle} ${inlineTitle}`
      ) || `Oferta ${index + 1}`;
    }

    if (isWeakStandaloneLayoutTitle(inlineTitle)) {
      return previousTitle;
    }
  }

  return inlineTitle || previousTitle || `Oferta ${index + 1}`;
}

function splitPostLayoutPriceLines(lines = []) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => cleanCommercialDisplayLine(line)).filter(Boolean)
    : [];
  const price = normalizedLines[0] || '';
  const explicitSecondaryLine = normalizedLines[1] || '';

  if (explicitSecondaryLine) {
    return {
      price,
      installment: explicitSecondaryLine
    };
  }

  return {
    price,
    installment: extractPriceQualifier(price)
  };
}

function findProductUrlLineIndex(lines, ...urls) {
  return lines.findIndex((line) => {
    const normalized = String(line ?? '');
    return urls.filter(Boolean).some((url) => normalized.includes(url));
  });
}

function findPreviousProductTitleLine(lines, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    const line = String(lines[current] ?? '').trim();

    if (!line || /R\$\s?[\d.]+(?:,\d{2})?/i.test(line) || /^[-_*]+$/.test(line)) {
      continue;
    }

    return line;
  }

  return '';
}

function collectNearbyPriceLines(lines, index) {
  const prices = [];

  for (let current = Math.max(0, index); current < Math.min(lines.length, index + 6); current += 1) {
    const rawLine = String(lines[current] ?? '');
    const line = cleanCommercialDisplayLine(rawLine);
    const hasPrice = /R\$\s?[\d.]+(?:,\d{2})?/i.test(line);

    if (
      current > index &&
      !hasPrice &&
      /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/\S+)/i.test(rawLine)
    ) {
      break;
    }

    if (hasPrice) {
      prices.push(line);
    }

    if (prices.length >= 2) {
      break;
    }
  }

  return prices;
}

function collectSharedPostLayoutPriceLines(messageText, convertedUrls = []) {
  const lines = String(messageText ?? '').split('\n');
  const productLineIndexes = Array.isArray(convertedUrls)
    ? convertedUrls
        .map((item) => findProductUrlLineIndex(
          lines,
          String(item?.affiliateUrl || '').trim(),
          String(item?.originalUrl || '').trim(),
          String(item?.originalUrl || '').replace(/^https?:\/\//i, '')
        ))
        .filter((index) => index >= 0)
    : [];

  if (!productLineIndexes.length) {
    return [];
  }

  const lastProductLineIndex = Math.max(...productLineIndexes);
  const prices = [];

  for (let current = lastProductLineIndex + 1; current < Math.min(lines.length, lastProductLineIndex + 10); current += 1) {
    const rawLine = String(lines[current] ?? '');
    const line = cleanCommercialDisplayLine(rawLine);

    if (isLikelyPostFooterLine(rawLine)) {
      break;
    }

    if (/R\$\s?[\d.]+(?:,\d{2})?/i.test(line)) {
      prices.push(line);
    }

    if (prices.length >= 2) {
      break;
    }
  }

  return prices;
}

function isLikelyPostFooterLine(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  return (
    normalized.startsWith('canais de') ||
    normalized.startsWith('visite ') ||
    normalized.startsWith('siga ') ||
    normalized.startsWith('@') ||
    normalized.includes('instagram') ||
    normalized.includes('telegram') ||
    normalized.includes('whatsapp')
  );
}

function removeKnownUrlsFromLine(line, urls) {
  return urls
    .filter(Boolean)
    .reduce((value, url) => value.split(url).join(''), String(line ?? ''));
}

function cleanPostLayoutTitle(value) {
  return stripWrappedFormattingMarkers(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[a-z0-9-]+\.[a-z]{2,}\/\S+/gi, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~`[\](){}]/g, '')
    .replace(/\s*[-\u2013\u2014]?\s*(?:amazon|shopee|mercado\s*livre|mercadolivre)\s*$/i, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .replace(/[\s:;,\-.>]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 90);
}

function looksLikeSizeOnlyVariant(value) {
  const normalized = String(value ?? '').trim();
  return /^\d{1,3}\s*(?:"|\u201d|pol|polegadas?)$/i.test(normalized);
}

function isWeakStandaloneLayoutTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return true;
  }

  if (looksLikeSizeOnlyVariant(normalized)) {
    return true;
  }

  return normalized.length <= 4 && !/[a-z]{2,}/i.test(normalized);
}

function extractPriceQualifier(value) {
  const source = cleanCommercialDisplayLine(value);

  if (!source) {
    return '';
  }

  return source
    .replace(/^.*?R\$\s?[\d.]+(?:,\d{2})?/i, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .trim();
}

function cleanCommercialDisplayLine(value) {
  return String(value ?? '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 64);
}

function inferImageExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();

  if (normalized.includes('png')) {
    return 'png';
  }
  if (normalized.includes('webp')) {
    return 'webp';
  }
  if (normalized.includes('gif')) {
    return 'gif';
  }

  return 'jpg';
}

async function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Operacao excedeu ${timeoutMs}ms.`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseBoundedTimeout(value, fallback, min, max) {
  return parseBoundedInteger(value, fallback, min, max);
}
