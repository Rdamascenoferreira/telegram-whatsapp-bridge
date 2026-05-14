import sharp from 'sharp';
import { normalizePostLayoutConfig } from './post-layout-config.js';

const canvasWidth = 1200;
const canvasHeight = 1000;
const headerHeight = 176;
const footerHeight = 124;

export async function generateCleanPostLayoutImage({ products = [], settings = {}, messageText = '' } = {}) {
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

    const image = await buildProductImageWithTransparentBackground(product.imageBuffer, slot);

    composites.push({
      input: image,
      left: slot.imageX,
      top: slot.imageY
    });
  }

  const pricing = resolveLowestPricing(items, messageText);
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

async function buildProductImageWithTransparentBackground(imageBuffer, slot) {
  const trimmed = sharp(imageBuffer)
    .rotate()
    .trim({
      background: { r: 255, g: 255, b: 255 },
      threshold: 14
    });

  const transparent = await removeLightBackgroundFromEdges(trimmed);

  return await sharp(transparent)
    .resize(slot.imageWidth, slot.imageHeight, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer();
}

async function removeLightBackgroundFromEdges(imageSharp) {
  const { data, info } = await imageSharp
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (!width || !height || channels < 4) {
    return await imageSharp.png().toBuffer();
  }

  const visited = new Uint8Array(width * height);
  const queue = [];
  let qIndex = 0;

  const indexOf = (x, y) => y * width + x;
  const pixelOffset = (x, y) => (y * width + x) * channels;

  const isLikelyBackground = (x, y) => {
    const offset = pixelOffset(x, y);
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    if (a < 8) {
      return true;
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const brightness = (r + g + b) / 3;
    const saturation = max === 0 ? 0 : (max - min) / max;

    return brightness >= 228 && saturation <= 0.17;
  };

  const pushIfBackground = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const idx = indexOf(x, y);
    if (visited[idx]) {
      return;
    }
    visited[idx] = 1;

    if (isLikelyBackground(x, y)) {
      queue.push([x, y]);
    }
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  while (qIndex < queue.length) {
    const [x, y] = queue[qIndex++];
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nIdx = indexOf(nx, ny);
      if (visited[nIdx]) {
        continue;
      }
      visited[nIdx] = 1;
      if (isLikelyBackground(nx, ny)) {
        queue.push([nx, ny]);
      }
    }
  }

  const rgba = Buffer.from(data);
  let removed = 0;
  for (const [x, y] of queue) {
    const offset = pixelOffset(x, y);
    if (rgba[offset + 3] > 0) {
      rgba[offset + 3] = 0;
      removed += 1;
    }
  }

  if (removed < width * height * 0.01) {
    return await imageSharp.png().toBuffer();
  }

  return await sharp(rgba, { raw: { width, height, channels } }).png().toBuffer();
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
        labelY: 202,
        titleY: 244,
        titleMaxChars: 34,
        titleMaxLines: 2,
        titleFontSize: 34,
        labelAnchor: 'middle',
        compact: false,
        imageAnchorX: 600,
        imageAnchorY: 526
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
        labelY: 228,
        titleY: 264,
        titleMaxChars: 28,
        titleMaxLines: 2,
        titleFontSize: 28,
        labelAnchor: 'middle',
        compact: false,
        imageAnchorX: 338,
        imageAnchorY: 508
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
        labelY: 228,
        titleY: 264,
        titleMaxChars: 28,
        titleMaxLines: 2,
        titleFontSize: 28,
        labelAnchor: 'middle',
        compact: false,
        imageAnchorX: 862,
        imageAnchorY: 508
      }
    ];
  }

  if (count === 3) {
    return [
      {
        imageX: 410,
        imageY: 236,
        imageWidth: 380,
        imageHeight: 274,
        frameX: 378,
        frameY: 194,
        frameWidth: 444,
        frameHeight: 334,
        labelX: 600,
        labelY: 180,
        titleY: 210,
        titleMaxChars: 22,
        titleMaxLines: 1,
        titleFontSize: 22,
        labelAnchor: 'middle',
        compact: true,
        imageAnchorX: 600,
        imageAnchorY: 359
      },
      {
        imageX: 120,
        imageY: 528,
        imageWidth: 384,
        imageHeight: 274,
        frameX: 88,
        frameY: 486,
        frameWidth: 448,
        frameHeight: 334,
        labelX: 312,
        labelY: 472,
        titleY: 502,
        titleMaxChars: 22,
        titleMaxLines: 1,
        titleFontSize: 22,
        labelAnchor: 'middle',
        compact: true,
        imageAnchorX: 312,
        imageAnchorY: 651
      },
      {
        imageX: 696,
        imageY: 528,
        imageWidth: 384,
        imageHeight: 274,
        frameX: 664,
        frameY: 486,
        frameWidth: 448,
        frameHeight: 334,
        labelX: 888,
        labelY: 472,
        titleY: 502,
        titleMaxChars: 22,
        titleMaxLines: 1,
        titleFontSize: 22,
        labelAnchor: 'middle',
        compact: true,
        imageAnchorX: 888,
        imageAnchorY: 651
      }
    ];
  }

  return [
    {
      imageX: 124,
      imageY: 248,
      imageWidth: 352,
      imageHeight: 226,
      frameX: 92,
      frameY: 208,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 300,
      labelY: 190,
      titleY: 228,
      titleMaxChars: 16,
      titleMaxLines: 1,
      titleFontSize: 20,
      labelAnchor: 'middle',
      compact: true,
      imageAnchorX: 300,
      imageAnchorY: 348
    },
    {
      imageX: 724,
      imageY: 248,
      imageWidth: 352,
      imageHeight: 226,
      frameX: 692,
      frameY: 208,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 900,
      labelY: 190,
      titleY: 228,
      titleMaxChars: 16,
      titleMaxLines: 1,
      titleFontSize: 20,
      labelAnchor: 'middle',
      compact: true,
      imageAnchorX: 900,
      imageAnchorY: 348
    },
    {
      imageX: 124,
      imageY: 560,
      imageWidth: 352,
      imageHeight: 226,
      frameX: 92,
      frameY: 520,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 300,
      labelY: 502,
      titleY: 540,
      titleMaxChars: 16,
      titleMaxLines: 1,
      titleFontSize: 20,
      labelAnchor: 'middle',
      compact: true,
      imageAnchorX: 300,
      imageAnchorY: 660
    },
    {
      imageX: 724,
      imageY: 560,
      imageWidth: 352,
      imageHeight: 226,
      frameX: 692,
      frameY: 520,
      frameWidth: 416,
      frameHeight: 284,
      labelX: 900,
      labelY: 502,
      titleY: 540,
      titleMaxChars: 16,
      titleMaxLines: 1,
      titleFontSize: 20,
      labelAnchor: 'middle',
      compact: true,
      imageAnchorX: 900,
      imageAnchorY: 660
    }
  ];
}

function buildLayoutSvg({ products, slots, settings, pricing }) {
  const brandName = settings.brandName || 'Oferta do dia';
  const headline = settings.headline || 'Ofertas selecionadas';
  const footerText = fitFooterMessage(settings.footerText || 'Seleção premium de ofertas', 34);
  const stageTop = headerHeight;
  const stageHeight = canvasHeight - headerHeight - footerHeight;
  const footerY = canvasHeight - footerHeight;
  const footerBadgeWidth = 350;
  const footerBadgeHeight = 96;
  const footerBadgeX = canvasWidth - footerBadgeWidth - 24;
  const footerBadgeY = footerY + 14;

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
  <rect y="${stageTop}" width="${canvasWidth}" height="${stageHeight}" fill="#ffffff"/>

  <rect width="${canvasWidth}" height="${headerHeight}" fill="url(#headerGrad)"/>
  <rect y="${headerHeight - 3}" width="${canvasWidth}" height="3" fill="${settings.accentColor}" filter="url(#accentGlow)"/>
  <text x="64" y="78" fill="#f3f4f6" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="900">${escapeXml(brandName)}</text>
  <text x="64" y="126" fill="rgba(255,255,255,0.74)" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeXml(headline)}</text>

  ${products.map((product, index) => buildHeroProductSvg(product, slots[index], settings)).join('\n')}

  <rect y="${footerY}" width="${canvasWidth}" height="${footerHeight}" fill="url(#footerGrad)"/>
  <text x="52" y="${footerY + 52}" fill="rgba(255,255,255,0.78)" font-family="'Segoe UI', 'Arial', sans-serif" font-size="24" font-weight="700">${escapeXml(footerText)}</text>

  <rect x="${footerBadgeX}" y="${footerBadgeY}" width="${footerBadgeWidth}" height="${footerBadgeHeight}" rx="24" fill="url(#priceBadgeGrad)"/>
  <text x="${footerBadgeX + 24}" y="${footerBadgeY + 36}" fill="rgba(255,255,255,0.8)" font-family="'Segoe UI', 'Arial', sans-serif" font-size="20" font-weight="700">a partir de</text>
  <text x="${footerBadgeX + 24}" y="${footerBadgeY + 76}" fill="#f7e7a5" font-family="'Segoe UI', 'Arial', sans-serif" font-size="34" font-weight="900">${escapeXml(fitFooterPriceLabel(pricing.label, 14))}</text>
</svg>`;
}

function buildHeroProductSvg(product, slot, settings) {
  if (!slot) {
    return '';
  }

  const marketplace = product.marketplace ? String(product.marketplace).toUpperCase() : 'OFERTA';
  const title = cleanTitleForHero(product.title || 'Produto em destaque');
  const titleLines = wrapText(
    title,
    slot.titleMaxChars || (slot.compact ? 26 : 30),
    slot.titleMaxLines || (slot.compact ? 1 : 2)
  );
  const fontSize = slot.titleFontSize || (slot.compact ? 20 : 24);
  const safeLabelY = Math.max(slot.labelY || 0, slot.frameY + (slot.compact ? 24 : 20));
  const safeTitleY = Math.max(
    slot.titleY || 0,
    safeLabelY + (slot.compact ? 32 : 36),
    slot.frameY + (slot.compact ? 58 : 64)
  );

  return `
  <rect x="${slot.frameX}" y="${slot.frameY}" width="${slot.frameWidth}" height="${slot.frameHeight}" rx="${slot.compact ? 22 : 28}" fill="rgba(4,15,43,0.10)"/>
  <rect x="${slot.frameX}" y="${slot.frameY}" width="${slot.frameWidth}" height="${slot.frameHeight}" rx="${slot.compact ? 22 : 28}" fill="none" stroke="rgba(11,23,52,0.18)" stroke-width="2"/>
  <text x="${slot.labelX}" y="${safeLabelY}" text-anchor="${slot.labelAnchor}" fill="${settings.accentColor}" font-family="'Segoe UI', 'Arial', sans-serif" font-size="${slot.compact ? 14 : 16}" font-weight="900" letter-spacing="${slot.compact ? 2 : 2.4}">${escapeXml(marketplace)}</text>
  ${titleLines.map((line, index) => `<text x="${slot.labelX}" y="${safeTitleY + index * (fontSize + 5)}" text-anchor="${slot.labelAnchor}" fill="#0f172a" font-family="'Segoe UI', 'Arial', sans-serif" font-size="${fontSize}" font-weight="800">${escapeXml(line)}</text>`).join('\n')}
  `;
}

function resolveLowestPricing(products = [], messageText = '') {
  const candidates = [];

  for (const product of products) {
    candidates.push(...extractPriceCandidates(product?.price));
    candidates.push(...extractPriceCandidates(product?.installment));
  }
  candidates.push(...extractMessagePriceCandidates(messageText));

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

function extractMessagePriceCandidates(messageText) {
  const lines = String(messageText || '').split('\n');
  const candidates = [];

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      continue;
    }

    if (/(?:cupom|coupon|cupon|desconto|off\b)/i.test(line)) {
      continue;
    }

    candidates.push(...extractPriceCandidates(line));
  }

  return candidates;
}

function extractPriceCandidates(value) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) {
    return [];
  }

  const matches = [
    ...Array.from(source.matchAll(/R\$\s?[\d.]+(?:,\d{2})?/gi)),
    ...Array.from(source.matchAll(/(?:^|[^\d])(\d{1,3}(?:\.\d{3})*,\d{2})(?=\D|$)/g))
  ];
  const result = [];

  for (const match of matches) {
    const rawValue = match[1] || match[0];
    const amount = parseBrazilianCurrency(rawValue);
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

  return lines;
}

function fitFooterPriceLabel(value, maxChars) {
  const source = String(value || '').trim();
  const extracted = extractPriceCandidates(source);
  if (extracted.length) {
    const minValue = extracted.sort((a, b) => a.value - b.value)[0]?.value;
    if (Number.isFinite(minValue)) {
      return formatCurrencyBR(minValue);
    }
  }

  if (source.length <= maxChars) {
    return source;
  }

  return 'Confira no link';
}

function fitFooterMessage(value, maxChars) {
  const source = String(value || '').trim();
  if (!source) {
    return 'Seleção premium de ofertas';
  }
  if (source.length <= maxChars) {
    return source;
  }

  return `${source.slice(0, Math.max(8, maxChars - 3)).trim()}...`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
