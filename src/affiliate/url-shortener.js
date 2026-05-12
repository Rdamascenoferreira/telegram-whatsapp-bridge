const defaultTimeoutMs = 3000;
const defaultCacheTtlMs = 24 * 60 * 60 * 1000;
const defaultCacheMaxEntries = 1500;

export function createUrlShortenerFromEnv(options = {}) {
  const enabled = parseBoolean(process.env.URL_SHORTENER_ENABLED, false);
  const provider = String(process.env.URL_SHORTENER_PROVIDER || 'isgd').trim().toLowerCase();
  const timeoutMs = parseInteger(process.env.URL_SHORTENER_TIMEOUT_MS, defaultTimeoutMs);
  const cacheTtlMs = parseInteger(process.env.URL_SHORTENER_CACHE_TTL_MS, defaultCacheTtlMs);
  const cacheMaxEntries = parseCount(process.env.URL_SHORTENER_CACHE_MAX_ENTRIES, defaultCacheMaxEntries);
  const fetchFn = options.fetchFn || fetch;

  if (!enabled) {
    return null;
  }

  if (provider !== 'isgd') {
    return null;
  }

  const shortenCore = async function shortenUrlCore(url) {
    const longUrl = String(url ?? '').trim();

    if (!longUrl) {
      throw new Error('URL vazia para encurtamento');
    }

    const endpoint = new URL('https://is.gd/create.php');
    endpoint.searchParams.set('format', 'simple');
    endpoint.searchParams.set('url', longUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(endpoint.toString(), {
        method: 'GET',
        signal: controller.signal
      });

      const text = String(await response.text()).trim();

      if (!response.ok) {
        throw new Error(`is.gd retornou HTTP ${response.status}`);
      }

      if (!/^https?:\/\//i.test(text)) {
        throw new Error('is.gd retornou resposta inválida');
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  };

  return createCachedShortener(shortenCore, {
    ttlMs: cacheTtlMs,
    maxEntries: cacheMaxEntries
  });
}

export function createCachedShortener(shortenCore, options = {}) {
  const ttlMs = parseInteger(options.ttlMs, defaultCacheTtlMs);
  const maxEntries = parseCount(options.maxEntries, defaultCacheMaxEntries);
  const cache = new Map();

  return async function shortenUrlWithCache(url) {
    const longUrl = String(url ?? '').trim();

    if (!longUrl) {
      throw new Error('URL vazia para encurtamento');
    }

    const now = Date.now();
    const cached = cache.get(longUrl);
    if (cached && cached.expiresAt > now) {
      return cached.shortUrl;
    }

    if (cached) {
      cache.delete(longUrl);
    }

    const shortUrl = await shortenCore(longUrl);
    cache.set(longUrl, {
      shortUrl,
      expiresAt: now + ttlMs
    });

    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      cache.delete(oldestKey);
    }

    return shortUrl;
  };
}

function parseBoolean(value, fallbackValue) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return fallbackValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 500) {
    return fallbackValue;
  }
  return Math.min(parsed, 30 * 24 * 60 * 60 * 1000);
}

function parseCount(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallbackValue;
  }
  return Math.min(parsed, 100_000);
}
