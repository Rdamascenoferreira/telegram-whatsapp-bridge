import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMercadoLivreLink } from '../converters/mercadolivre-affiliate-converter.js';
import {
  extractMercadoLivreProductKey,
  isSupportedMercadoLivreProductUrl
} from '../converters/mercadolivre-product-key.js';

test('extractMercadoLivreProductKey normalizes MLB product ids', () => {
  assert.equal(
    extractMercadoLivreProductKey('https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM'),
    'MLB1234567890'
  );
  assert.equal(
    extractMercadoLivreProductKey('https://www.mercadolivre.com.br/p/MLB987654321'),
    'MLB987654321'
  );
});

test('isSupportedMercadoLivreProductUrl rejects non-product pages', () => {
  assert.equal(isSupportedMercadoLivreProductUrl('https://lista.mercadolivre.com.br/notebook'), false);
  assert.equal(isSupportedMercadoLivreProductUrl('https://www.mercadolivre.com.br/ofertas'), false);
  assert.equal(isSupportedMercadoLivreProductUrl('https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM'), true);
});

test('convertMercadoLivreLink returns cached affiliate link without browser automation', async () => {
  const result = await convertMercadoLivreLink(
    'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
    {
      label: 'vip',
      lookupAffiliateLinkFn: async ({ productKey, label }) => ({
        productKey,
        label,
        affiliateUrl: 'https://www.mercadolivre.com.br/afiliado/abc123',
        source: 'manual'
      })
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 'converted');
  assert.equal(result.productKey, 'MLB1234567890');
  assert.equal(result.affiliateUrl, 'https://www.mercadolivre.com.br/afiliado/abc123');
});

test('convertMercadoLivreLink ignores safely when automation is disabled', async () => {
  const result = await convertMercadoLivreLink(
    'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
    {
      lookupAffiliateLinkFn: async () => null,
      automationEnabled: false
    }
  );

  assert.equal(result.success, false);
  assert.equal(result.status, 'ignored');
  assert.match(result.error, /disabled|unavailable/i);
});

test('convertMercadoLivreLink can generate and save affiliate links', async () => {
  let saved = null;
  const result = await convertMercadoLivreLink(
    'https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM',
    {
      automationEnabled: true,
      lookupAffiliateLinkFn: async () => null,
      generateAffiliateUrlFn: async () => ({
        success: true,
        affiliateUrl: 'https://www.mercadolivre.com.br/afiliado/generated'
      }),
      saveAffiliateLinkFn: async (payload) => {
        saved = payload;
      }
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 'converted');
  assert.equal(saved.productKey, 'MLB1234567890');
  assert.equal(saved.source, 'browser_automation');
});
