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
  const input = '🔥 Oferta\nhttps://www.amazon.com.br/dp/B0ABC12345),\nFim';

  assert.deepEqual(extractUrls(input), ['https://www.amazon.com.br/dp/B0ABC12345']);
});
