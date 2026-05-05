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
  const coupon = findFirstMatch(input, /(?:cupom|coupon)\s*[:\-]?\s*([A-Z0-9_-]{3,})/i, 1);
  const details = lines
    .filter((line) => !lineContainsKnownUrl(line, urls))
    .filter((line) => line !== title)
    .filter((line) => !/^(?:cupom|coupon)\b/i.test(line))
    .filter((line) => !/R\$\s?[\d.]+(?:,\d{2})?/i.test(line))
    .filter((line) => !/^[_-]\s*$/.test(line))
    .filter((line) => !isLikelyPromotionalFooterLine(line))
    .slice(0, 2);

  const primaryUrl = urls[0];
  const extraUrls = urls.slice(1);
  const blocks = [];

  blocks.push(getHeadline(style));
  blocks.push(title);

  if (details.length) {
    blocks.push(details.join('\n'));
  }

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

  if (extraUrls.length) {
    blocks.push(style === 'plain' ? `Links adicionais:\n${extraUrls.join('\n')}` : `\u{1F517} Links adicionais:\n${extraUrls.join('\n')}`);
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
    /\bmais\b.*\b(?:grupo|grupos|oferta|ofertas|cupom|cupons)\b/,
    /\b(?:grupo|grupos)\b.*\b(?:oferta|ofertas|promocao|promocoes|cupom|cupons)\b/,
    /\bresgate\b.*\b(?:cupom|cupons)\b.*\b(?:pagina|site|grupo|canal)\b/,
    /\b(?:siga|acesse|visite|entre|participe|convide)\b.*\b(?:instagram|linktree|grupo|grupos|canal|comunidade)\b/,
    /\b(?:instagram|linktree|tiktok|telegram|whatsapp)\b\s*:/,
    /\b(?:nerdofertas|badmeme|mc8mb)\b/
  ].some((pattern) => pattern.test(normalized));
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
    .toLowerCase();
}

function findFirstMatch(text, regex, group = 0) {
  const match = String(text ?? '').match(regex);
  return match ? String(match[group] ?? '').trim() : '';
}
