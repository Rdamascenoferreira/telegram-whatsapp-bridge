import sharp from 'sharp';
import { normalizePostLayoutConfig } from './post-layout-config.js';

const canvasWidth = 1200;
const canvasHeight = 1000;

export async function generateCleanPostLayoutImage({ products = [], settings = {} } = {}) {
  const layout = normalizePostLayoutConfig({ ...settings, enabled: true });
  const items = products
    .filter((product) => product && (product.title || product.price || product.imageBuffer))
    .slice(0, layout.maxProducts);

  if (!items.length) {
    return null;
  }

  const slots = buildSlots(items.length);
  const composites = [];

  for (let index = 0; index < items.length; index += 1) {
    const product = items[index];
    const slot = slots[index];

    if (!product?.imageBuffer) {
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

  const svg = buildLayoutSvg({ products: items, slots, settings: layout });
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

function buildSlots(count) {
  if (count === 1) {
    return [
      {
        x: 220,
        y: 245,
        width: 760,
        height: 610,
        imageX: 300,
        imageY: 390,
        imageWidth: 600,
        imageHeight: 270
      }
    ];
  }

  if (count === 2) {
    return [
      {
        x: 70,
        y: 245,
        width: 500,
        height: 610,
        imageX: 140,
        imageY: 388,
        imageWidth: 360,
        imageHeight: 250
      },
      {
        x: 630,
        y: 245,
        width: 500,
        height: 610,
        imageX: 700,
        imageY: 388,
        imageWidth: 360,
        imageHeight: 250
      }
    ];
  }

  const slots = [];
  const width = 500;
  const height = 330;
  const positions = [
    [70, 220],
    [630, 220],
    [70, 585],
    [630, 585]
  ];

  for (let index = 0; index < Math.min(count, 4); index += 1) {
    const [x, y] = positions[index];
    slots.push({
      x,
      y,
      width,
      height,
      imageX: x + 34,
      imageY: y + 82,
      imageWidth: 230,
      imageHeight: 220
    });
  }

  return slots;
}

function buildLayoutSvg({ products, slots, settings }) {
  const brandName = settings.brandName || 'Oferta do dia';
  const headline = settings.headline || 'Ofertas selecionadas';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <defs>
    <pattern id="gridPattern" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M28 0H0V28" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    </pattern>
    <radialGradient id="bgGlowA" cx="20%" cy="18%" r="62%">
      <stop offset="0%" stop-color="rgba(37,211,102,0.18)"/>
      <stop offset="100%" stop-color="rgba(37,211,102,0)"/>
    </radialGradient>
    <radialGradient id="bgGlowB" cx="86%" cy="74%" r="48%">
      <stop offset="0%" stop-color="rgba(34,158,217,0.15)"/>
      <stop offset="100%" stop-color="rgba(34,158,217,0)"/>
    </radialGradient>
    <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${settings.primaryColor}"/>
      <stop offset="100%" stop-color="#0b132f"/>
    </linearGradient>
    <filter id="headerLineGlow" x="-40%" y="-900%" width="180%" height="1900%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="1200" height="1000" fill="#0b132f"/>
  <rect width="1200" height="1000" fill="url(#bgGlowA)"/>
  <rect width="1200" height="1000" fill="url(#bgGlowB)"/>
  <rect width="1200" height="1000" fill="url(#gridPattern)" opacity="0.45"/>
  <rect width="1200" height="170" fill="url(#headerGrad)"/>
  <rect y="170" width="1200" height="3" fill="${settings.accentColor}" filter="url(#headerLineGlow)"/>
  <text x="70" y="78" fill="#f3f4f6" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800">${escapeXml(brandName)}</text>
  <text x="70" y="122" fill="rgba(255,255,255,0.72)" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${escapeXml(headline)}</text>
  ${products.map((product, index) => buildProductCardSvg(product, slots[index], settings, products.length)).join('\n')}
</svg>`;
}

function buildProductCardSvg(product, slot, settings, total) {
  const compact = total > 2;
  const titleSize = compact ? 22 : 26;
  const priceSize = compact ? 30 : 42;
  const titleLines = wrapText(product.title || 'Produto em oferta', compact ? 28 : 30, compact ? 2 : 3);
  const price = compactPriceForBadge(product.price || '');
  const installment = product.installment || '';
  const marketplace = product.marketplace ? String(product.marketplace).toUpperCase() : 'OFERTA';
  const titleY = slot.y + (compact ? 46 : 54);
  const detailsX = compact ? slot.x + 245 : slot.x + 36;
  const detailsY = compact ? slot.y + 126 : slot.y + slot.height - 168;
  const priceBoxWidth = compact ? 220 : slot.width - 72;
  const priceBoxHeight = compact ? 112 : 126;
  const imageFrameX = compact ? slot.x + 22 : slot.x + 30;
  const imageFrameY = compact ? slot.y + 62 : slot.y + 110;
  const imageFrameW = compact ? 250 : slot.width - 60;
  const imageFrameH = compact ? 228 : 300;

  return `
  <rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="28" fill="rgba(255,255,255,0.10)"/>
  <rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="28" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
  <rect x="${slot.x + 2}" y="${slot.y + 2}" width="${slot.width - 4}" height="${slot.height - 4}" rx="26" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
  <text x="${slot.x + 36}" y="${slot.y + 34}" fill="${settings.accentColor}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="800" letter-spacing="2">${escapeXml(marketplace)}</text>
  ${titleLines.map((line, lineIndex) => `<text x="${slot.x + 36}" y="${titleY + lineIndex * (titleSize + 7)}" fill="${settings.textColor}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`).join('\n')}
  <rect x="${imageFrameX}" y="${imageFrameY}" width="${imageFrameW}" height="${imageFrameH}" rx="${compact ? 18 : 24}" fill="rgba(255,255,255,0.06)"/>
  <rect x="${imageFrameX}" y="${imageFrameY}" width="${imageFrameW}" height="${imageFrameH}" rx="${compact ? 18 : 24}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <rect x="${detailsX}" y="${detailsY}" width="${priceBoxWidth}" height="${priceBoxHeight}" rx="24" fill="${settings.primaryColor}"/>
  <text x="${detailsX + 24}" y="${detailsY + 44}" fill="rgba(255,255,255,0.70)" font-family="Arial, Helvetica, sans-serif" font-size="${compact ? 15 : 18}" font-weight="800">a partir de</text>
  <text x="${detailsX + 24}" y="${detailsY + (compact ? 84 : 92)}" fill="#f7e7a5" font-family="Arial, Helvetica, sans-serif" font-size="${priceSize}" font-weight="900">${escapeXml(price)}</text>
  ${installment ? `<text x="${detailsX + 24}" y="${detailsY + priceBoxHeight + 34}" fill="${settings.textColor}" opacity="0.75" font-family="Arial, Helvetica, sans-serif" font-size="${compact ? 16 : 20}" font-weight="700">${escapeXml(installment)}</text>` : ''}
  `;
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
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
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
    lines.push('Produto em oferta');
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
