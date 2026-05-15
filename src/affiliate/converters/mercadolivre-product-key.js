const blockedPathPatterns = [
  /^\/?$/i,
  /^\/ofertas\b/i,
  /^\/categorias?\b/i,
  /^\/carrinho\b/i,
  /^\/checkout\b/i,
  /^\/compras\b/i,
  /^\/vendas\b/i,
  /^\/perfil\b/i,
  /^\/loja\b/i
];

export function extractMercadoLivreProductKey(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return '';
  }

  const candidate = extractFromUrl(text) || extractFromText(text);
  return normalizeMercadoLivreProductKey(candidate);
}

export function isSupportedMercadoLivreProductUrl(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return false;
  }

  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    const path = url.pathname || '/';

    if (host === 'lista.mercadolivre.com.br' && !extractMercadoLivreProductKey(text)) {
      return false;
    }

    if (blockedPathPatterns.some((pattern) => pattern.test(path))) {
      return false;
    }

    return Boolean(extractMercadoLivreProductKey(text));
  } catch {
    return Boolean(extractMercadoLivreProductKey(text));
  }
}

function extractFromUrl(value) {
  try {
    const url = new URL(value);
    const searchKeys = ['item_id', 'itemId', 'item', 'id'];

    for (const key of searchKeys) {
      const candidate = extractFromText(url.searchParams.get(key));
      if (candidate) {
        return candidate;
      }
    }

    return extractFromText(decodeURIComponent(`${url.pathname}${url.search}`));
  } catch {
    return '';
  }
}

function extractFromText(value) {
  const text = String(value ?? '');
  const match = text.match(/\b(MLB)-?(\d{5,})\b/i);

  return match ? `${match[1]}${match[2]}` : '';
}

function normalizeMercadoLivreProductKey(value) {
  const match = String(value ?? '').trim().match(/\b(MLB)-?(\d{5,})\b/i);

  return match ? `${match[1].toUpperCase()}${match[2]}` : '';
}
