import test from 'node:test';
import assert from 'node:assert/strict';
import { createCachedShortener } from '../url-shortener.js';

test('createCachedShortener reuses cached value for same URL', async () => {
  let calls = 0;
  const shorten = createCachedShortener(
    async (url) => {
      calls += 1;
      return `https://is.gd/${Buffer.from(url).toString('base64').slice(0, 6)}`;
    },
    { ttlMs: 10_000, maxEntries: 100 }
  );

  const first = await shorten('https://www.amazon.com.br/dp/B0ABC12345?tag=tag-20');
  const second = await shorten('https://www.amazon.com.br/dp/B0ABC12345?tag=tag-20');

  assert.equal(first, second);
  assert.equal(calls, 1);
});

test('createCachedShortener expires cache by ttl', async () => {
  let calls = 0;
  const shorten = createCachedShortener(
    async (url) => {
      calls += 1;
      return `https://is.gd/${calls}-${url.length}`;
    },
    { ttlMs: 500, maxEntries: 100 }
  );

  const first = await shorten('https://www.amazon.com.br/dp/B0ABC12345?tag=tag-20');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const second = await shorten('https://www.amazon.com.br/dp/B0ABC12345?tag=tag-20');

  assert.notEqual(first, second);
  assert.equal(calls, 2);
});

test('createCachedShortener evicts oldest entries when max size is reached', async () => {
  let calls = 0;
  const shorten = createCachedShortener(
    async (url) => {
      calls += 1;
      return `https://is.gd/${calls}-${url.length}`;
    },
    { ttlMs: 10_000, maxEntries: 2 }
  );

  await shorten('https://a.example/1');
  await shorten('https://a.example/2');
  await shorten('https://a.example/3');
  await shorten('https://a.example/1');

  assert.equal(calls, 4);
});
