import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls } from '../url-extractor.js';

test('extractUrls finds http and https links and trims trailing punctuation', () => {
  const input = 'Produto legal https://amzn.to/3QdY360 confira tambem https://linktr.ee/mc8mb.';

  assert.deepEqual(extractUrls(input), [
    'https://amzn.to/3QdY360',
    'https://linktr.ee/mc8mb'
  ]);
});

test('extractUrls tolerates emojis and line breaks', () => {
  const input = 'Oferta quente\nhttps://www.amazon.com.br/dp/B0ABC12345),\nFim';

  assert.deepEqual(extractUrls(input), ['https://www.amazon.com.br/dp/B0ABC12345']);
});

test('extractUrls normalizes links without protocol', () => {
  const input = `Oferta do dia
Resgate cupons: s.shopee.com.br/50VePQsPMC
Produto: https://s.shopee.com.br/5q4jmvCvmL
Mais cupons: nerdofertas.com`;

  assert.deepEqual(extractUrls(input), [
    'https://s.shopee.com.br/50VePQsPMC',
    'https://s.shopee.com.br/5q4jmvCvmL',
    'https://nerdofertas.com'
  ]);
});

test('extractUrls does not duplicate repeated links', () => {
  const input = 'https://amzn.to/abc https://amzn.to/abc amzn.to/abc';

  assert.deepEqual(extractUrls(input), ['https://amzn.to/abc']);
});
