import test from 'node:test';
import assert from 'node:assert/strict';
import { __postLayoutTestUtils } from '../../userBridgeRuntime.js';

const {
  extractPostLayoutProductDetails,
  extractProductImageUrlFromHtml,
  sanitizeImageCandidate,
  splitPostLayoutPriceLines,
  selectPostLayoutMetadataUrl
} = __postLayoutTestUtils;

test('extractPostLayoutProductDetails prefers previous product title for Shopee size-only rows', () => {
  const message = [
    'Vai acabar rapido',
    '',
    'Smart TV TCL 4K QLED P7K 2025 - (Shopee)',
    '',
    '50" 👉 https://s.shopee.com.br/809U2f2i0H?lp=aff',
    'R$ 1.164,59 no Pix',
    '',
    '- loja com selo Shopee Oficial'
  ].join('\n');

  const details = extractPostLayoutProductDetails(
    message,
    {
      affiliateUrl: 'https://s.shopee.com.br/affiliate-convertido',
      originalUrl: 'https://s.shopee.com.br/809U2f2i0H?lp=aff'
    },
    0
  );

  assert.equal(details.title, 'Smart TV TCL 4K QLED P7K 2025 50"');
  assert.equal(details.price, 'R$ 1.164,59 no Pix');
  assert.equal(details.installment, 'no Pix');
});

test('splitPostLayoutPriceLines preserves pix qualifier when there is a single price line', () => {
  const details = splitPostLayoutPriceLines(['R$ 111,50 no Pix ou NuPay']);

  assert.equal(details.price, 'R$ 111,50 no Pix ou NuPay');
  assert.equal(details.installment, 'no Pix ou NuPay');
});

test('extractPostLayoutProductDetails prefers product page title when available', () => {
  const message = [
    'Resgate o cupom de R$ 90',
    'https://s.shopee.com.br/cupom123',
    '',
    'Ative o cupom da loja',
    'https://s.shopee.com.br/produto456'
  ].join('\n');

  const details = extractPostLayoutProductDetails(
    message,
    {
      affiliateUrl: 'https://s.shopee.com.br/produto456',
      originalUrl: 'https://s.shopee.com.br/produto456'
    },
    0,
    {
      pageTitle: 'Volante Logitech G923 com TRUEFORCE para Xbox Series X|S, Xbox One e PC'
    }
  );

  assert.equal(details.title, 'Volante Logitech G923 com TRUEFORCE para Xbox Series X|S, Xbox One e PC');
});

test('extractProductImageUrlFromHtml accepts Shopee CDN images without file extension', () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {"image":"https:\\/\\/down-br.img.susercontent.com\\/file\\/br-11134207-7r98o-lz1abc123xyz"}
        </script>
      </head>
    </html>
  `;

  assert.equal(
    extractProductImageUrlFromHtml(html),
    'https://down-br.img.susercontent.com/file/br-11134207-7r98o-lz1abc123xyz'
  );
});

test('sanitizeImageCandidate accepts protocol-relative Shopee CDN urls', () => {
  assert.equal(
    sanitizeImageCandidate('//down-br.img.susercontent.com/file/br-11134207-7r98o-lz1abc123xyz'),
    'https://down-br.img.susercontent.com/file/br-11134207-7r98o-lz1abc123xyz'
  );
});

test('selectPostLayoutMetadataUrl prefers shopee affiliate short link first for social og:image', () => {
  assert.equal(
    selectPostLayoutMetadataUrl({
      marketplace: 'shopee',
      expandedUrl: 'https://shopee.com.br/produto-i.123.456',
      affiliateUrl: 'https://s.shopee.com.br/abc123'
    }),
    'https://s.shopee.com.br/abc123'
  );
});

test('selectPostLayoutMetadataUrl keeps expanded url first for non-shopee marketplaces', () => {
  assert.equal(
    selectPostLayoutMetadataUrl({
      marketplace: 'amazon',
      expandedUrl: 'https://www.amazon.com.br/dp/B0ABC12345?tag=abc-20',
      affiliateUrl: 'https://amzn.to/abc123'
    }),
    'https://www.amazon.com.br/dp/B0ABC12345?tag=abc-20'
  );
});
