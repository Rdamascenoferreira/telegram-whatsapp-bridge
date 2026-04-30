const cache = new Map();
const defaultTimeoutMs = 8000;
const defaultMaxRedirects = 10;
const defaultTtlMs = 10 * 60 * 1000;

export async function expandUrl(inputUrl, options = {}) {
  const originalUrl = String(inputUrl ?? '').trim();
  const timeoutMs = Number(options.timeoutMs || defaultTimeoutMs);
  const maxRedirects = Number(options.maxRedirects || defaultMaxRedirects);
  const ttlMs = Number(options.ttlMs || defaultTtlMs);
  const cached = cache.get(originalUrl);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (!isSafeHttpUrl(originalUrl)) {
    return {
      originalUrl,
      expandedUrl: originalUrl,
      success: false,
      error: 'Invalid or unsafe URL protocol'
    };
  }

  let result = await followRedirects(originalUrl, 'HEAD', timeoutMs, maxRedirects);

  if (!result.success) {
    result = await followRedirects(originalUrl, 'GET', timeoutMs, maxRedirects);
  }

  cache.set(originalUrl, {
    value: result,
    expiresAt: Date.now() + ttlMs
  });

  return result;
}

export function clearExpandUrlCache() {
  cache.clear();
}

async function followRedirects(originalUrl, method, timeoutMs, maxRedirects) {
  let currentUrl = originalUrl;
  const seen = new Set();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (seen.has(currentUrl)) {
      return {
        originalUrl,
        expandedUrl: currentUrl,
        success: false,
        error: 'Redirect loop detected'
      };
    }

    seen.add(currentUrl);

    try {
      const response = await fetchWithTimeout(currentUrl, method, timeoutMs);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');

        if (!location) {
          return { originalUrl, expandedUrl: currentUrl, success: true };
        }

        const nextUrl = new URL(location, currentUrl).toString();

        if (!isSafeHttpUrl(nextUrl)) {
          return {
            originalUrl,
            expandedUrl: currentUrl,
            success: false,
            error: 'Redirect target has unsafe protocol'
          };
        }

        currentUrl = nextUrl;
        continue;
      }

      return { originalUrl, expandedUrl: response.url || currentUrl, success: true };
    } catch (error) {
      return {
        originalUrl,
        expandedUrl: currentUrl,
        success: false,
        error: error.message
      };
    }
  }

  return {
    originalUrl,
    expandedUrl: currentUrl,
    success: false,
    error: 'Too many redirects'
  };
}

async function fetchWithTimeout(url, method, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

