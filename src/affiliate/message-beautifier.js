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

  const style = normalizeBeautifierStyle(options.style);
  const lines = input
    .split('\n')
    .map((line) => normalizeLineForStyle(line, style).trim())
    .filter(Boolean);

  const title = findTitle(lines, urls);
  const price = findFirstMatch(input, /R\$\s?[\d.]+(?:,\d{2})?/i);
  const coupon = findCoupon(lines);
  const primaryUrlIndex = findPrimaryUrlIndex(lines, urls);
  const primaryUrl = urls[primaryUrlIndex] || urls[0];
  const couponUrls = findCouponUrls(lines, urls, primaryUrlIndex);
  const extraUrls = urls
    .filter((_, index) => index !== primaryUrlIndex)
    .filter((url) => !couponUrls.includes(url))
    .filter((url) => !isCommunityPromoUrl(url, lines));
  const blocks = [];

  blocks.push(getHeadline(style));
  blocks.push(title);

  const commercialLines = [];

  if (price) {
    commercialLines.push(style === 'plain' ? price : `\u{1F4B0} ${price}`);
  }

  if (coupon) {
    commercialLines.push(style === 'plain' ? `Cupom: ${coupon}` : `\u{1F3F7} Cupom: ${coupon}`);
  }

  if (commercialLines.length) {
    blocks.push(commercialLines.join('\n'));
  }

  blocks.push(style === 'plain' ? `Link da oferta:\n${primaryUrl}` : `\u{1F6D2} Link da oferta:\n${primaryUrl}`);

  if (couponUrls.length) {
    blocks.push(style === 'plain' ? `Cupons:\n${couponUrls.join('\n')}` : `\u{1F3F7} Cupons:\n${couponUrls.join('\n')}`);
  }

  if (extraUrls.length) {
    blocks.push(style === 'plain' ? `Links uteis:\n${extraUrls.join('\n')}` : `\u{1F517} Links uteis:\n${extraUrls.join('\n')}`);
  }

  if (style === 'urgent') {
    blocks.push('\u{23F3} Aproveite enquanto a oferta estiver disponivel.');
  } else if (style === 'sales') {
    blocks.push('\u{2705} Garanta antes que o preco mude.');
  }

  return blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  return title || 'Oferta especial';
}

function isLikelyPromotionalFooterLine(line) {
  const normalized = normalizeForMatching(line);

  return [
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

function findPrimaryUrlIndex(lines, urls) {
  const productIndex = urls.findIndex((url) => {
    const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
    const previousLabel = findPreviousNonEmptyLine(lines, lineIndex);
    const normalizedLabel = normalizeForMatching(previousLabel);

    return /\b(?:link\s*(?:do\s*)?produto|produto|link\s*(?:da\s*)?oferta)\b/.test(normalizedLabel);
  });

  if (productIndex >= 0) {
    return productIndex;
  }

  const nonCouponIndex = urls.findIndex((url) => {
    const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
    const previousLabel = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));

    return !/\b(?:cupom|cupons|resgate|pagina)\b/.test(previousLabel);
  });

  return nonCouponIndex >= 0 ? nonCouponIndex : 0;
}

function isCommunityPromoUrl(url, lines) {
  const lineIndex = lines.findIndex((line) => lineContainsKnownUrl(line, [url]));
  const currentLine = normalizeForMatching(lines[lineIndex] || '');
  const previousLine = normalizeForMatching(findPreviousNonEmptyLine(lines, lineIndex));
  const context = `${previousLine} ${currentLine}`;

  return [
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

function findPreviousNonEmptyLine(lines, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (String(lines[current] ?? '').trim()) {
      return lines[current];
    }
  }

  return '';
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

  const match = couponLine.match(/(?:cupom|coupon)\s*[:\-]?\s*([A-Z0-9_-]{3,})/i);
  return match ? String(match[1] ?? '').trim() : '';
}
