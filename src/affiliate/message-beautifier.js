import { extractUrls } from './url-extractor.js';

const supportedStyles = new Set(['clean', 'sales', 'urgent']);

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
    return input;
  }

  const style = normalizeBeautifierStyle(options.style);
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const title = findTitle(lines, urls);
  const price = findFirstMatch(input, /R\$\s?[\d.]+(?:,\d{2})?/i);
  const coupon = findFirstMatch(input, /(?:cupom|coupon)\s*[:\-]?\s*([A-Z0-9_-]{3,})/i, 1);
  const details = lines
    .filter((line) => !urls.some((url) => line.includes(url)))
    .filter((line) => line !== title)
    .filter((line) => !/^(?:cupom|coupon)\b/i.test(line))
    .filter((line) => !/R\$\s?[\d.]+(?:,\d{2})?/i.test(line))
    .filter((line) => !/^[_-]\s*$/.test(line))
    .slice(0, 2);

  const primaryUrl = urls[0];
  const extraUrls = urls.slice(1);
  const blocks = [];

  if (style === 'urgent') {
    blocks.push('⚡ Oferta relampago');
  } else if (style === 'sales') {
    blocks.push('🔥 Oferta garimpada para voce');
  } else {
    blocks.push('✨ Oferta selecionada');
  }

  blocks.push(title);

  if (details.length) {
    blocks.push(details.join('\n'));
  }

  const commercialLines = [];

  if (price) {
    commercialLines.push(`💰 ${price}`);
  }

  if (coupon) {
    commercialLines.push(`🏷 Cupom: ${coupon}`);
  }

  if (commercialLines.length) {
    blocks.push(commercialLines.join('\n'));
  }

  blocks.push(`🛒 Link da oferta:\n${primaryUrl}`);

  if (extraUrls.length) {
    blocks.push(`🔗 Links adicionais:\n${extraUrls.join('\n')}`);
  }

  if (style === 'urgent') {
    blocks.push('⏳ Aproveite enquanto a oferta estiver disponivel.');
  } else if (style === 'sales') {
    blocks.push('✅ Garanta antes que o preco mude.');
  }

  return blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findTitle(lines, urls) {
  const title = lines.find((line) => {
    if (urls.some((url) => line.includes(url))) {
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

    return line.length >= 4;
  });

  return title || 'Oferta especial';
}

function findFirstMatch(text, regex, group = 0) {
  const match = String(text ?? '').match(regex);
  return match ? String(match[group] ?? '').trim() : '';
}
