import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateCleanPostLayoutImage } from '../post-layout-generator.js';

test('generateCleanPostLayoutImage creates a png layout for multiple products', async () => {
  const imageBuffer = await sharp({
    create: {
      width: 320,
      height: 320,
      channels: 4,
      background: '#e5e7eb'
    }
  })
    .png()
    .toBuffer();

  const result = await generateCleanPostLayoutImage({
    settings: {
      enabled: true,
      brandName: 'Achadinhos VIP',
      headline: 'Ofertas selecionadas',
      primaryColor: '#0f172a',
      accentColor: '#25D366',
      backgroundColor: '#f8fafc',
      textColor: '#111827',
      maxProducts: 2
    },
    products: [
      {
        title: 'Mortal Kombat 11 Ultimate PS5',
        price: 'R$ 111,50',
        installment: 'R$ 119,90 em ate 3x',
        marketplace: 'amazon',
        imageBuffer
      },
      {
        title: 'Mortal Kombat 1 PS5',
        price: 'R$ 130,10',
        installment: 'R$ 139,90 em ate 6x',
        marketplace: 'amazon',
        imageBuffer
      }
    ]
  });

  assert.ok(Buffer.isBuffer(result));
  assert.deepEqual([...result.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
