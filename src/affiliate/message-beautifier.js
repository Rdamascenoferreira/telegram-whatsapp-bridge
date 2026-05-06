import { extractUrls } from './url-extractor.js';

const supportedStyles = new Set(['clean', 'sales', 'urgent', 'plain']);

export function normalizeBeautifierStyle(style) {
  const normalized = String(style ?? '').trim().toLowerCase();
  return supportedStyles.has(normalized) ? normalized : 'clean';
}

export function beautifyAffiliateMessage(message, options = {}) {
  const input = String(message ?? '').trim();

  if (!input) {
    return '';
  }

  const urls = extractUrls(input);

  if (!urls.length) {
    return normalizeLineForStyle(input, normalizeBeautifierStyle(options.style)).trim();
  }

  const details = extractAffiliateOfferDetails(input, options);

  if (details.variants.length > 1) {
    return formatVariantAffiliateMessage(details);
  }

  const blocks = [];

  blocks.push(getHeadline(details.style));
  blocks.push(details.title);

  const commercialLines = [];

  if (details.price) {
    commercialLines.push(details.style === 'plain' ? details.price : `\u{1F4B0} ${details.price}`);
  }

  if (details.installment) {
    commercialLines.push(details.style === 'plain' ? details.installment : `\u{1F4B3} ${details.installment}`);
  }

  if (details.coupon) {
    commercialLines.push(details.style === 'plain' ? `Cupom: ${details.coupon}` : `\u{1F3F7} Cupom: ${details.coupon}`);
  }

  if (commercialLines.length) {
    blocks.push(commercialLines.join('\n'));
  }

  blocks.push(details.style === 'plain' ? `Link da oferta:\n${details.primaryUrl}` : `\u{1F6D2} Link da oferta:\n${details.primaryUrl}`);

  if (details.couponUrls.length) {
    blocks.push(details.style === 'plain' ? `Cupons:\n${details.couponUrls.join('\n')}` : `\u{1F3F7} Cupons:\n${details.couponUrls.join('\n')}`);
  }

  if (details.extraUrls.length) {
    blocks.push(details.style === 'plain' ? `Links uteis:\n${details.extraUrls.join('\n')}` : `\u{1F517} Links uteis:\n${details.extraUrls.join('\n')}`);
  }

  if (details.style === 'urgent') {
    blocks.push('\u{23F3} Aproveite enquanto a oferta estiver disponivel.');
  } else if (details.style === 'sales') {
    blocks.push('\u{2705} Garanta antes que o preco mude.');
  }

  return blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractAffiliateOfferDetails(message, options = {}) {
  const input = String(message ?? '').trim();
  const style = normalizeBeautifierStyle(options.style);
  const allUrls = extractUrls(input);
  const allLines = input
    .split('\n')
    .map((line) => normalizeLineForStyle(line, style).trim())
    .filter(Boolean);
  const hasPreferredPrimaryUrl = Boolean(normalizeUrlForComparison(options.primaryUrl));
  const initialPrimaryUrlIndex = findPrimaryUrlIndex(allLines, allUrls, options.primaryUrl);
  const lines = hasPreferredPrimaryUrl ? scopeLinesForPrimaryOffer(allLines, allUrls, initialPrimaryUrlIndex) : allLines;
  const scopedInput = lines.join('\n');
  const urls = allUrls.filter((url) => lines.some((line) => lineContainsKnownUrl(line, [url])));
  const variants = findOfferVariants(lines, urls);
  const title = findTitle(lines, urls);
  const price = findPrimaryPriceLine(lines, scopedInput);
  const installment = findInstallmentLine(lines);
  const coupon = findCoupon(lines);
  const preferredPrimaryUrl = allUrls[initialPrimaryUrlIndex] || options.primaryUrl;
  const primaryUrlIndex = findPrimaryUrlIndex(lines, urls, preferredPrimaryUrl);
  const primaryUrl = urls[primaryUrlIndex] || urls[0] || '';
  const couponUrls = findCouponUrls(lines, urls, primaryUrlIndex);
  const variantUrls = variants.map((variant) => variant.url);
  const extraUrls = urls
    .filter((_, index) => index !== primaryUrlIndex)
    .filter((url) => !variantUrls.includes(url))
    .filter((url) => !couponUrls.includes(url))
    .filter((url) => !isCommunityPromoUrl(url, lines));

  return {
    style,
    title,
    price,
    installment,
    coupon,
    primaryUrl,
    couponUrls,
    extraUrls,
    variants,
    urls
  };
}

function formatVariantAffiliateMessage(details) {
  const blocks = [];
  const optionBlocks = details.variants.map((variant, index) => {
    const label = variant.label || `Opcao ${index + 1}`;
    const lines = [details.style === 'plain' ? label : `- ${label}`];

    if (variant.price) {
      lines.push(details.style === 'plain' ? variant.price : `\u{1F4B0} ${variant.price}`);
    }

    if (variant.shipping) {
      lines.push(details.style === 'plain' ? variant.shipping : `\u{1F69A} ${variant.shipping}`);
    }

    lines.push(details.style === 'plain' ? `Link:\n${variant.url}` : `\u{1F6D2} Link:\n${variant.url}`);
    return lines.filter(Boolean).join('\n');
  });

  blocks.push(getHeadline(details.style));
  blocks.push(details.title);
  blocks.push('Opcoes disponiveis:');
  blocks.push(optionBlocks.join('\n\n'));

  if (details.coupon) {
    blocks.push(details.style === 'plain' ? `Cupom: ${details.coupon}` : `\u{1F3F7} Cupom: ${details.coupon}`);
  }

  return blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scopeLinesForPrimaryOffer(lines, urls, primaryUrlIndex) {
  if (!urls.length || primaryUrlIndex < 0) {
    return lines;
  }

  const primaryUrl = urls[primaryUrlIndex];
  const primaryLineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [primaryUrl]));

  if (primaryLineIndex < 0) {
    return lines;
  }

  let start = 0;
  const previousBlockingUrlLine = findPreviousBlockingUrlLine(lines, urls, primaryUrlIndex);

  if (previousBlockingUrlLine >= 0) {
    const nextHeading = findNextMarketplaceHeading(lines, previousBlockingUrlLine + 1, primaryLineIndex);
    start = nextHeading >= 0 ? nextHeading : previousBlockingUrlLine + 1;
  }

  let end = lines.length;

  for (let index = primaryLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lineUrls = urls.filter((url) => lineContainsKnownUrl(line, [url]));
    const hasOtherUrl = lineUrls.some((url) => url !== primaryUrl);

    if (isMarketplaceHeadingLine(line) && !lineContainsKnownUrl(line, [primaryUrl])) {
      end = index;
      break;
    }

    if (hasOtherUrl) {
      const belongsToSameOffer = lineUrls.some((url) => isCouponUrlByContext(lines, url) || isCommunityPromoUrl(url, lines));

      if (!belongsToSameOffer) {
        end = index;
        break;
      }
    }

    if (index > primaryLineIndex + 1 && isLikelyPromotionalFooterLine(line)) {
      end = index;
      break;
    }
  }

  const scoped = lines.slice(start, end).filter(Boolean);
  return scoped.length ? scoped : lines;
}

function getHeadline(style) {
  if (style === 'plain') {
    return 'Oferta selecionada';
  }

  if (style === 'urgent') {
    return '\u{26A1} Oferta relampago';
  }

  if (style === 'sales') {
    return '\u{1F525} Oferta garimpada para voce';
  }

  return '\u{2728} Oferta selecionada';
}

function normalizeLineForStyle(line, style) {
  const value = String(line ?? '');

  if (style !== 'plain') {
    return value;
  }

  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s{2,}/g, ' ');
}

function findTitle(lines, urls) {
  const title = lines.find((line) => {
    if (lineContainsKnownUrl(line, urls)) {
      return false;
    }

    if (/^(?:cupom|coupon)\b/i.test(line)) {
      return false;
    }

    if (/R\$\s?[\d.]+(?:,\d{2})?/i.test(line)) {
      return false;
    }

    if (/^[_-]\s*$/.test(line)) {
      return false;
    }

    if (isLikelyPromotionalFooterLine(line)) {
      return false;
    }

    return line.length >= 4;
  });

  return sanitizeTitle(title) || 'Oferta especial';
}

function isLikelyPromotionalFooterLine(line) {
  const normalized = normalizeForMatching(line);

  return [
    /^canais?\s+de\s+promocoes?\b/,
    /^convide\s+seus\s+amigos\s*:?\s*$/,
    /^(?:preco|valor|oferta)\s*:?\s*$/,
    /^#?\s*(?:link\s*(?:do\s*)?(?:produto|oferta)|produto|anuncio|anuncios?)\s*:?\s*$/,
    /^resgate\s+(?:os\s+)?cupons?\s*:?\s*$/,
    /^(?:promocoes?|ofertas?)\s+(?:gerais|no\s+whatsapp|no\s+telegram)\s*[-:]?\s*$/,
    /\bmais\b.*\b(?:grupo|grupos|oferta|ofertas|cupom|cupons)\b/,
    /\b(?:grupo|grupos)\b.*\b(?:oferta|ofertas|promocao|promocoes|cupom|cupons)\b/,
    /\bresgate\b.*\b(?:cupom|cupons)\b.*\b(?:pagina|site|grupo|canal)\b/,
    /\b(?:siga|acesse|visite|entre|participe|convide)\b.*\b(?:instagram|linktree|grupo|grupos|canal|comunidade)\b/,
    /\b(?:instagram|linktree|tiktok|telegram|whatsapp)\b\s*:/,
    /\b(?:nerdofertas|badmeme|mc8mb)\b/
  ].some((pattern) => pattern.test(normalized));
}

function findPrimaryUrlIndex(lines, urls, preferredUrl = '') {
  const preferredIndex = findPreferredUrlIndex(urls, preferredUrl);

  if (preferredIndex >= 0) {
    return preferredIndex;
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  urls.forEach((url, index) => {
    const score = scorePrimaryUrlCandidate(lines, url);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function findPreferredUrlIndex(urls, preferredUrl) {
  const preferred = normalizeUrlForComparison(preferredUrl);

  if (!preferred) {
    return -1;
  }

  return urls.findIndex((url) => normalizeUrlForComparison(url) === preferred);
}

function findPreviousBlockingUrlLine(lines, urls, primaryUrlIndex) {
  for (let index = primaryUrlIndex - 1; index >= 0; index -= 1) {
    const url = urls[index];
    const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));

    if (lineIndex < 0) {
      continue;
    }

    if (isCouponUrlByContext(lines, url) || isCommunityPromoUrl(url, lines)) {
      continue;
    }

    return lineIndex;
  }

  return -1;
}

function findNextMarketplaceHeading(lines, start, end) {
  for (let index = start; index <= end; index += 1) {
    if (isMarketplaceHeadingLine(lines[index])) {
      return index;
    }
  }

  return -1;
}

function isCouponUrlByContext(lines, url) {
  const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
  const currentLine = normalizeForMatching(lines[lineIndex] || '');
  const previousLine = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));
  const context = `${previousLine} ${currentLine}`;

  return /\b(?:cupom|cupons|resgate)\b/.test(context);
}

function isMarketplaceHeadingLine(line) {
  const normalized = normalizeForMatching(line);

  return [
    /^\[?(?:amazon|shopee|kabum|magalu|mercado\s*livre|aliexpress|pichau|terabyte|americanas|carrefour)\b/,
    /^loja\s*[:\-]/,
    /^marketplace\s*[:\-]/
  ].some((pattern) => pattern.test(normalized));
}

function isCommunityPromoUrl(url, lines) {
  const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
  const currentLine = normalizeForMatching(lines[lineIndex] || '');
  const previousLine = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));
  const context = `${previousLine} ${currentLine}`;
  const hostname = getNormalizedHostname(url);

  return isLikelyLandingHostname(hostname) || [
    /\bcanais?\s+de\s+promocoes?\b/,
    /\bconvide\s+seus\s+amigos\b/,
    /\bmais\b.*\b(?:grupo|grupos|oferta|ofertas|cupom|cupons)\b/,
    /\b(?:telegram|whatsapp|instagram|linktree|tiktok)\b/,
    /\bt\.me\b/,
    /\blinktr\.ee\b/,
    /\b(?:nerdofertas|badmeme|mc8mb)\b/
  ].some((pattern) => pattern.test(context));
}

function findCouponUrls(lines, urls, primaryUrlIndex) {
  return urls.filter((url, index) => {
    if (index === primaryUrlIndex || isCommunityPromoUrl(url, lines)) {
      return false;
    }

    const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
    const currentLine = normalizeForMatching(lines[lineIndex] || '');
    const previousLine = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));
    const context = `${previousLine} ${currentLine}`;

    return /\b(?:cupom|cupons|resgate)\b/.test(context);
  });
}

function findOfferVariants(lines, urls) {
  const variants = urls
    .filter((url) => !isCouponUrlByContext(lines, url))
    .filter((url) => !isCommunityPromoUrl(url, lines))
    .map((url) => {
      const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));

      if (lineIndex < 0) {
        return null;
      }

      const variantLines = collectVariantLines(lines, urls, lineIndex, url);
      const priceLine = variantLines.find((line) => /R\$\s?[\d.]+(?:,\d{2})?/i.test(line));
      const shippingLine = variantLines.find((line) => /\bfrete\b/i.test(normalizeForMatching(line)));

      return {
        label: extractVariantLabel(lines, urls, lineIndex, url),
        price: priceLine ? cleanCommercialLine(priceLine) : '',
        shipping: shippingLine ? cleanCommercialLine(shippingLine) : '',
        url
      };
    })
    .filter(Boolean);

  if (variants.length < 2) {
    return [];
  }

  const usefulVariants = variants.filter((variant) => variant.label || variant.price || variant.shipping);
  const labelCount = variants.filter((variant) => variant.label).length;

  if (usefulVariants.length < 2 || labelCount < 2) {
    return [];
  }

  return variants;
}

function collectVariantLines(lines, urls, lineIndex, currentUrl) {
  const collected = [];

  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const lineUrls = urls.filter((url) => lineContainsKnownUrl(line, [url]));
    const hasOtherUrl = lineUrls.some((url) => url !== currentUrl);

    if (hasOtherUrl || isMarketplaceHeadingLine(line)) {
      break;
    }

    if (isLikelyPromotionalFooterLine(line) && !/\bfrete\b/i.test(normalizeForMatching(line))) {
      break;
    }

    collected.push(line);
  }

  return collected;
}

function extractVariantLabel(lines, urls, lineIndex, url) {
  const sameLineLabel = cleanVariantLabel(removeUrlFromLine(lines[lineIndex], url));

  if (sameLineLabel) {
    return sameLineLabel;
  }

  const previousLine = cleanVariantLabel(findPreviousNonEmptyLine(lines, lineIndex));

  if (previousLine && !lineContainsKnownUrl(previousLine, urls)) {
    return previousLine;
  }

  return '';
}

function removeUrlFromLine(line, url) {
  const normalizedUrl = String(url ?? '');
  const withoutProtocol = normalizedUrl.replace(/^https?:\/\//i, '');
  const withoutWww = withoutProtocol.replace(/^www\./i, '');

  return [normalizedUrl, withoutProtocol, withoutWww]
    .filter(Boolean)
    .reduce((value, candidate) => value.split(candidate).join(''), String(line ?? ''));
}

function cleanVariantLabel(value) {
  const label = sanitizeTitle(value)
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/^[\s:;,\-.>()[\]{}]+/g, '')
    .replace(/[\s:;,\-.>()[\]{}]+$/g, '')
    .replace(/(?:👉|➡️|🔗|🛒)/gu, '')
    .replace(/[?¿�]+/g, '')
    .replace(/\b(?:link\s*(?:do\s*)?(?:produto|oferta)|produto|oferta|compre|acesse)\b\s*:?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!label || label.length > 60) {
    return '';
  }

  if (/R\$\s?[\d.]+(?:,\d{2})?/i.test(label) || isLikelyPromotionalFooterLine(label)) {
    return '';
  }

  return label;
}

function findPreviousNonEmptyLine(lines, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (String(lines[current] ?? '').trim()) {
      return lines[current];
    }
  }

  return '';
}

function scorePrimaryUrlCandidate(lines, url) {
  const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
  const currentLine = normalizeForMatching(lines[lineIndex] || '');
  const previousLine = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));
  const context = `${previousLine} ${currentLine}`.trim();
  const hostname = getNormalizedHostname(url);
  let score = 0;

  if (/\b(?:link\s*(?:do\s*)?produto|produto|link\s*(?:da\s*)?oferta)\b/.test(context)) {
    score += 8;
  }

  if (/\b(?:cupom|cupons|resgate|pagina)\b/.test(context)) {
    score -= 4;
  }

  if (isCommunityPromoUrl(url, lines)) {
    score -= 20;
  }

  if (isKnownMarketplaceHostname(hostname)) {
    score += 6;
  }

  if (isLikelyLandingHostname(hostname)) {
    score -= 3;
  }

  return score;
}

function lineContainsKnownUrl(line, urls) {
  const value = String(line ?? '');

  return urls.some((url) => {
    const normalizedUrl = String(url ?? '');
    const withoutProtocol = normalizedUrl.replace(/^https?:\/\//i, '');
    const withoutWww = withoutProtocol.replace(/^www\./i, '');

    return [normalizedUrl, withoutProtocol, withoutWww]
      .filter(Boolean)
      .some((candidate) => value.includes(candidate));
  });
}

function getNormalizedHostname(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

function normalizeUrlForComparison(url) {
  try {
    const parsed = new URL(String(url ?? '').trim());
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch (_error) {
    return '';
  }
}

function isKnownMarketplaceHostname(hostname) {
  return [
    'shopee.com.br',
    's.shopee.com.br',
    'shopee.com',
    'shope.ee',
    'amazon.com.br',
    'amazon.com',
    'amzn.to'
  ].includes(hostname);
}

function isLikelyLandingHostname(hostname) {
  return [
    'jogobara.to',
    'jogobarato.com.br'
  ].includes(hostname);
}

function normalizeForMatching(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .trim()
    .toLowerCase();
}

function findFirstMatch(text, regex, group = 0) {
  const match = String(text ?? '').match(regex);
  return match ? String(match[group] ?? '').trim() : '';
}

function findCoupon(lines) {
  const couponLine = lines.find((line) => /(?:cupom|coupon)/i.test(line) && !lineContainsKnownUrl(line, []));

  if (!couponLine) {
    return '';
  }

  const normalizedLine = String(couponLine ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  const afterColon = normalizedLine.includes(':')
    ? normalizedLine.slice(normalizedLine.lastIndexOf(':') + 1)
    : normalizedLine.replace(/(?:cupom|coupon)/i, '');

  const directTokens = afterColon.match(/[A-Z0-9_-]{4,}/gi) || [];

  if (directTokens.length) {
    return String(directTokens[directTokens.length - 1] ?? '').trim();
  }

  const lineTokens = normalizedLine.match(/[A-Z0-9_-]{4,}/gi) || [];
  return lineTokens.length ? String(lineTokens[lineTokens.length - 1] ?? '').trim() : '';
}

function findPrimaryPriceLine(lines, input) {
  const priceLine = lines.find((line) => {
    if (!/R\$\s?[\d.]+(?:,\d{2})?/i.test(line)) {
      return false;
    }

    const normalized = normalizeForMatching(line);
    return !/\bate\s*\d+\s*x\b/.test(normalized);
  });

  if (priceLine) {
    return cleanCommercialLine(priceLine);
  }

  return findFirstMatch(input, /R\$\s?[\d.]+(?:,\d{2})?/i);
}

function findInstallmentLine(lines) {
  const installmentLine = lines.find((line) => {
    if (!/R\$\s?[\d.]+(?:,\d{2})?/i.test(line)) {
      return false;
    }

    const normalized = normalizeForMatching(line);
    return /\bate\s*\d+\s*x\b/.test(normalized);
  });

  return installmentLine ? cleanCommercialLine(installmentLine) : '';
}

function cleanCommercialLine(line) {
  return String(line ?? '')
    .replace(/^[•·▪▫◦○●✅💵💰💳🏷🎟👉🔗🛒\-\s]+/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeTitle(title) {
  return String(title ?? '')
    .replace(/^\[(amazon|shopee)\]\s*/i, '')
    .replace(/\s*[-–—]?\s*\((?:amazon|shopee)\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
