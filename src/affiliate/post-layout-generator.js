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
      imageX: x + 28,
      imageY: y + 126,
      imageWidth: 190,
      imageHeight: 140
    });
  }

  return slots;
}

function buildLayoutSvg({ products, slots, settings }) {
  const brandName = settings.brandName || 'Oferta do dia';
  const headline = settings.headline || 'Ofertas selecionadas';

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="1200" height="1000" fill="${settings.backgroundColor}"/>
  <rect width="1200" height="170" fill="${settings.primaryColor}"/>
  <rect y="170" width="1200" height="6" fill="${settings.accentColor}"/>
  <text x="70" y="78" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800">${escapeXml(brandName)}</text>
  <text x="70" y="122" fill="rgba(255,255,255,0.76)" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${escapeXml(headline)}</text>
  ${products.map((product, index) => buildProductCardSvg(product, slots[index], settings, products.length)).join('\n')}
</svg>`;
}

function buildProductCardSvg(product, slot, settings, total) {
  const compact = total > 2;
  const titleSize = compact ? 22 : 26;
  const priceSize = compact ? 30 : 42;
  const titleLines = wrapText(product.title || 'Produto em oferta', compact ? 28 : 30, compact ? 2 : 3);
  const price = product.price || 'Confira no link';
  const installment = product.installment || '';
  const marketplace = product.marketplace ? String(product.marketplace).toUpperCase() : 'OFERTA';
  const titleY = slot.y + (compact ? 46 : 54);
  const detailsX = compact ? slot.x + 245 : slot.x + 36;
  const detailsY = compact ? slot.y + 96 : slot.y + slot.height - 168;
  const priceBoxWidth = compact ? 230 : slot.width - 72;
  const priceBoxHeight = compact ? 112 : 126;

  return `
  <rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="28" fill="#ffffff"/>
  <rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="28" fill="none" stroke="rgba(15,23,42,0.10)" stroke-width="2"/>
  <text x="${slot.x + 36}" y="${slot.y + 34}" fill="${settings.accentColor}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="800" letter-spacing="2">${escapeXml(marketplace)}</text>
  ${titleLines.map((line, lineIndex) => `<text x="${slot.x + 36}" y="${titleY + lineIndex * (titleSize + 7)}" fill="${settings.textColor}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`).join('\n')}
  <rect x="${detailsX}" y="${detailsY}" width="${priceBoxWidth}" height="${priceBoxHeight}" rx="24" fill="${settings.primaryColor}"/>
  <text x="${detailsX + 24}" y="${detailsY + 44}" fill="rgba(255,255,255,0.70)" font-family="Arial, Helvetica, sans-serif" font-size="${compact ? 15 : 18}" font-weight="800">a partir de</text>
  <text x="${detailsX + 24}" y="${detailsY + (compact ? 84 : 92)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${priceSize}" font-weight="900">${escapeXml(price)}</text>
  ${installment ? `<text x="${detailsX + 24}" y="${detailsY + priceBoxHeight + 34}" fill="${settings.textColor}" opacity="0.75" font-family="Arial, Helvetica, sans-serif" font-size="${compact ? 16 : 20}" font-weight="700">${escapeXml(installment)}</text>` : ''}
  `;
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
