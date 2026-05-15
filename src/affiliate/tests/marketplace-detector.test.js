import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMarketplace } from '../marketplace-detector.js';

test('detectMarketplace detects Amazon domains', () => {
  assert.equal(detectMarketplace('https://www.amazon.com.br/dp/B0ABC12345'), 'amazon');
  assert.equal(detectMarketplace('https://amazon.com/dp/B0ABC12345'), 'amazon');
  assert.equal(detectMarketplace('https://amzn.to/3QdY360'), 'amazon');
});

test('detectMarketplace detects Shopee domains', () => {
  assert.equal(detectMarketplace('https://www.shopee.com.br/produto'), 'shopee');
  assert.equal(detectMarketplace('https://shope.ee/abc123'), 'shopee');
});

test('detectMarketplace detects Mercado Livre domains', () => {
  assert.equal(detectMarketplace('https://produto.mercadolivre.com.br/MLB-1234567890-produto-_JM'), 'mercadolivre');
  assert.equal(detectMarketplace('https://www.mercadolivre.com.br/p/MLB12345678'), 'mercadolivre');
  assert.equal(detectMarketplace('https://meli.la/abc123'), 'mercadolivre');
});

test('detectMarketplace returns unknown for other or invalid URLs', () => {
  assert.equal(detectMarketplace('https://linktr.ee/mc8mb'), 'unknown');
  assert.equal(detectMarketplace('not-a-url'), 'unknown');
});
