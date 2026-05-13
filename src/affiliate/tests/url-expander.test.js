import test from 'node:test';
import assert from 'node:assert/strict';
import { expandUrl, clearExpandUrlCache } from '../url-expander.js';

function createResponse({ url, status = 200, headers = {}, body = '' }) {
  return {
    status,
    url,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        return headers[key] ?? headers[name] ?? null;
      }
    },
    async text() {
      return body;
    }
  };
}

test('expandUrl follows intermediate html redirect until final store url', async () => {
  clearExpandUrlCache();
  const originalFetch = globalThis.fetch;

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const current = String(url);

    if (current.includes('jogobara.to')) {
      return createResponse({
        url: current,
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><script>window.location.href="https://www.jogobarato.com.br/oferta/123"</script></html>'
      });
    }

    if (current.includes('jogobarato.com.br')) {
      return createResponse({
        url: current,
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><a href="https://www.amazon.com.br/dp/B0BP2TGK6W">Comprar</a></html>'
      });
    }

    return createResponse({
      url: 'https://www.amazon.com.br/dp/B0BP2TGK6W',
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html>Amazon</html>'
    });
  };

  try {
    const result = await expandUrl('https://jogobara.to/mEwin', { timeoutMs: 1000, ttlMs: 0 });

    assert.equal(result.success, true);
    assert.equal(result.expandedUrl, 'https://www.amazon.com.br/dp/B0BP2TGK6W');
    assert.ok(calls.length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearExpandUrlCache();
  }
});
