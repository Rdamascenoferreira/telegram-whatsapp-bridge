import sharp from 'sharp';
import { normalizePostLayoutConfig } from './post-layout-config.js';

const canvasWidth = 1200;
const canvasHeight = 1000;
const headerHeight = 176;
const footerHeight = 124;

export async function generateCleanPostLayoutImage({ products = [], settings = {} } = {}) {
  const layout = normalizePostLayoutConfig({ ...settings, enabled: true });
  const items = products
    .filter((product) => product && (product.title || product.price || product.imageBuffer))
    .slice(0, layout.maxProducts);

  if (!items.length) {
    return null;
  }

  const slots = buildHeroSlots(items.length);
  const composites = [];

  for (let index = 0; index < items.length; index += 1) {
    const product = items[index];
    const slot = slots[index];

    if (!product?.imageBuffer || !slot) {
      continue;
    }

    const image = await sharp(product.imageBuffer)
      .rotate()
      .resize(slot.imageWidth, slot.imageHeight, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toBuffer();

    composites.push({
      input: image,
      left: slot.imageX,
      top: slot.imageY
    });
  }

  const pricing = resolveLowestPricing(items);
  const svg = buildLayoutSvg({ products: items, slots, settings: layout, pricing });
  return await sharp(Buffer.from(svg))
    .composite(composites)
    .png({
      compressionLevel: 9,
      effort: 9,
      palette: true,
      quality: 82
    })
    .toBuffer();
}

function buildHeroSlots(count) {
  if (count <= 1) {
    return [
      {
        imageX: 248,
        imageY: 232,
        imageWidth: 704,
        imageHeight: 574,
        frameX: 208,
        frameY: 216,
        frameWidth: 784,
        frameHeight: 600,
        labelX: 600,
        labelY: 206,
        labelAnchor: 'middle',
        compact: false
      }
    ];
  }

  if (count === 2) {
    return [
      {
        imageX: 104,
        imageY: 258,
        imageWidth: 468,
        imageHeight: 500,
        frameX: 78,
        frameY: 242,
        frameWidth: 520,
        frameHeight: 532,
        labelX: 338,
        labelY: 232,
        labelAnchor: 'middle',
        compact: false
      },
      {
        imageX: 628,
        imageY: 258,
        imageWidth: 468,
        imageHeight: 500,
        frameX: 602,
        frameY: 242,
        frameWidth: 520,
        frameHeight: 532,
        labelX: 862,
        labelY: 232,
        labelAnchor: 'middle',
        compact: false
      }
    ];
  }

  if (count === 3) {
    return [
      {
        imageX: 410,
        imageY: 208,
        imageWidth: 380,
        imageHeight: 302,
        frameX: 378,
        frameY: 194,
        frameWidth: 444,
        frameHeight: 334,
        labelX: 600,
        labelY: 184,
        labelAnchor: 'middle',
        compact: true
      },
      {
        imageX: 120,
        imageY: 500,
        imageWidth: 384,
        imageHeight: 302,
        frameX: 88,
        frameY: 486,
        frameWidth: 448,
        frameHeight: 334,
        labelX: 312,
        labelY: 476,
        labelAnchor: 'middle',
        compact: true
      },
      {
        imageX: 696,
        imageY: 500,
        imageWidth: 384,
        imageHeight: 302,
        frameX: 664,
        frameY: 486,
        frameWidth: 448,
        frameHeight: 334,
        labelX: 888,
        labelY: 476,
        labelAnchor: 'middle',
        compact: true
      }
    ];
  }

  return [
    {
      imageX: 124,
      imageY: 222,
      imageWidth: 352,
      imageHeight: 252,
      frameX: 92,
      frameY: 208,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 300,
      labelY: 198,
      labelAnchor: 'middle',
      compact: true
    },
    {
      imageX: 724,
      imageY: 222,
      imageWidth: 352,
      imageHeight: 252,
      frameX: 692,
      frameY: 208,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 900,
      labelY: 198,
      labelAnchor: 'middle',
      compact: true
    },
    {
      imageX: 124,
      imageY: 534,
      imageWidth: 352,
      imageHeight: 252,
      frameX: 92,
      frameY: 520,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 300,
      labelY: 510,
      labelAnchor: 'middle',
      compact: true
    },
    {
      imageX: 724,
      imageY: 534,
      imageWidth: 352,
      imageHeight: 252,
      frameX: 692,
      frameY: 520,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 900,
      labelY: 510,
      labelAnchor: 'middle',
      compact: true
    }
  ];
}

function buildLayoutSvg({ products, slots, settings, pricing }) {
  const brandName = settings.brandName || 'Oferta do dia';
  const headline = settings.headline || 'Ofertas selecionadas';
  const stageTop = headerHeight;
  const stageHeight = canvasHeight - headerHeight - footerHeight;
  const footerY = canvasHeight - footerHeight;
  const footerBadgeWidth = 388;
  const footerBadgeHeight = 92;
  const footerBadgeX = canvasWidth - footerBadgeWidth - 28;
  const footerBadgeY = footerY + 16;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <defs>
    <pattern id="premiumGrid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    </pattern>
    <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${settings.primaryColor}"/>
      <stop offset="100%" stop-color="#0a1435"/>
    </linearGradient>
    <linearGradient id="footerGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#07112e"/>
      <stop offset="100%" stop-color="#0a1a42"/>
    </linearGradient>
    <radialGradient id="stageGlowA" cx="18%" cy="24%" r="58%">
      <stop offset="0%" stop-color="rgba(37,211,102,0.13)"/>
      <stop offset="100%" stop-color="rgba(37,211,102,0)"/>
    </radialGradient>
    <radialGradient id="stageGlowB" cx="88%" cy="78%" r="42%">
      <stop offset="0%" stop-color="rgba(34,158,217,0.14)"/>
      <stop offset="100%" stop-color="rgba(34,158,217,0)"/>
    </radialGradient>
    <linearGradient id="priceBadgeGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${settings.primaryColor}"/>
      <stop offset="100%" stop-color="#133f73"/>
    </linearGradient>
    <filter id="accentGlow" x="-40%" y="-1000%" width="180%" height="2000%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="#060d24"/>
  <rect y="${stageTop}" width="${canvasWidth}" height="${stageHeight}" fill="${settings.backgroundColor}"/>
  <rect y="${stageTop}" width="${canvasWidth}" height="${stageHeight}" fill="url(#stageGlowA)"/>
  <rect y="${stageTop}" width="${canvasWidth}" height="${stageHeight}" fill="url(#stageGlowB)"/>
  <rect y="${stageTop}" width="${canvasWidth}" height="${stageHeight}" fill="url(#premiumGrid)" opacity="0.5"/>

  <rect width="${canvasWidth}" height="${headerHeight}" fill="url(#headerGrad)"/>
  <rect y="${headerHeight - 3}" width="${canvasWidth}" height="3" fill="${settings.accentColor}" filter="url(#accentGlow)"/>
  <text x="64" y="78" fill="#f3f4f6" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="900">${escapeXml(brandName)}</text>
  <text x="64" y="126" fill="rgba(255,255,255,0.74)" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeXml(headline)}</text>

  ${products.map((product, index) => buildHeroProductSvg(product, slots[index], settings)).join('\n')}

  <rect y="${footerY}" width="${canvasWidth}" height="${footerHeight}" fill="url(#footerGrad)"/>
  <text x="52" y="${footerY + 52}" fill="rgba(255,255,255,0.78)" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">Selecao premium de ofertas</text>
  <text x="52" y="${footerY + 88}" fill="rgba(255,255,255,0.58)" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600">Valores ja convertidos pela automacao</text>

  <rect x="${footerBadgeX}" y="${footerBadgeY}" width="${footerBadgeWidth}" height="${footerBadgeHeight}" rx="24" fill="url(#priceBadgeGrad)"/>
  <text x="${footerBadgeX + 26}" y="${footerBadgeY + 34}" fill="rgba(255,255,255,0.72)" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800">a partir de</text>
  <text x="${footerBadgeX + 26}" y="${footerBadgeY + 74}" fill="#f7e7a5" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="900">${escapeXml(pricing.label)}</text>
</svg>`;
}

function buildHeroProductSvg(product, slot, settings) {
  if (!slot) {
    return '';
  }

  const marketplace = product.marketplace ? String(product.marketplace).toUpperCase() : 'OFERTA';
  const title = cleanTitleForHero(product.title || 'Produto em destaque');
  const titleLines = wrapText(title, slot.compact ? 26 : 30, slot.compact ? 1 : 2);
  const fontSize = slot.compact ? 20 : 24;

  return `
  <rect x="${slot.frameX}" y="${slot.frameY}" width="${slot.frameWidth}" height="${slot.frameHeight}" rx="${slot.compact ? 22 : 28}" fill="rgba(4,15,43,0.10)"/>
  <rect x="${slot.frameX}" y="${slot.frameY}" width="${slot.frameWidth}" height="${slot.frameHeight}" rx="${slot.compact ? 22 : 28}" fill="none" stroke="rgba(11,23,52,0.18)" stroke-width="2"/>
  <text x="${slot.labelX}" y="${slot.labelY}" text-anchor="${slot.labelAnchor}" fill="${settings.accentColor}" font-family="Arial, Helvetica, sans-serif" font-size="${slot.compact ? 14 : 16}" font-weight="900" letter-spacing="${slot.compact ? 2 : 2.4}">${escapeXml(marketplace)}</text>
  ${titleLines.map((line, index) => `<text x="${slot.labelX}" y="${slot.labelY + 30 + index * (fontSize + 5)}" text-anchor="${slot.labelAnchor}" fill="${settings.textColor}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900">${escapeXml(line)}</text>`).join('\n')}
  `;
}

function resolveLowestPricing(products = []) {
  const candidates = [];

  for (const product of products) {
    candidates.push(...extractPriceCandidates(product?.price));
    candidates.push(...extractPriceCandidates(product?.installment));
  }

  if (!candidates.length) {
    const fallback = compactPriceForBadge(products[0]?.price || '');
    return { label: fallback || 'Confira no link' };
  }

  candidates.sort((a, b) => a.value - b.value);
  const winner = candidates[0];
  return {
    label: formatCurrencyBR(winner.value)
  };
}

function extractPriceCandidates(value) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) {
    return [];
  }

  const matches = Array.from(source.matchAll(/R\$\s?[\d.]+(?:,\d{2})?/gi));
  const result = [];

  for (const match of matches) {
    const amount = parseBrazilianCurrency(match[0]);
    if (!Number.isFinite(amount)) {
      continue;
    }
    result.push({ value: amount });
  }

  return result;
}

function parseBrazilianCurrency(value) {
  const normalized = String(value || '')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? number : Number.NaN;
}

function formatCurrencyBR(value) {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
  }
}

function cleanTitleForHero(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–-]\s*\((?:amazon|shopee)\)\s*$/i, '')
    .trim();
}

function compactPriceForBadge(value) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  const match = source.match(/R\$\s?[\d.]+(?:,\d{2})?/i);

  if (match?.[0]) {
    return match[0].replace(/\s+/g, ' ').trim();
  }

  if (source.length <= 24) {
    return source || 'Confira no link';
  }

  return `${source.slice(0, 24).trim()}...`;
}

function wrapText(value, maxChars, maxLines) {
  const words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (!lines.length) {
    lines.push('Produto em destaque');
  }

  if (words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.]+$/g, '')}...`;
  }

  return lines;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
