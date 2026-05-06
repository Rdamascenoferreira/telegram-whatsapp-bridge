import { extractAffiliateOfferDetails, normalizeBeautifierStyle } from './message-beautifier.js';

const groqApiUrl = 'https://api.groq.com/openai/v1/chat/completions';
const defaultGroqModel = String(process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile').trim() || 'llama-3.3-70b-versatile';
const defaultTimeoutMs = 8000;
const rewriteCache = new Map();
const rewriteCacheTtlMs = 10 * 60 * 1000;
const rewriteCacheMaxEntries = 200;

export async function rewriteAffiliateMessageWithGroq(params = {}) {
  const details = params.details || extractAffiliateOfferDetails(params.message || '', {
    style: params.style,
    primaryUrl: params.primaryUrl
  });
  const style = normalizeBeautifierStyle(params.style || details.style);
  const apiKey = String(params.apiKey ?? process.env.GROQ_API_KEY ?? '').trim();
  const model = String(params.model ?? process.env.GROQ_MODEL ?? defaultGroqModel).trim() || defaultGroqModel;
  const fetchFn = params.fetchFn || fetch;
  const timeoutMs = Number(params.timeoutMs ?? defaultTimeoutMs);
  const cacheKey = buildRewriteCacheKey({ model, style, details });
  const canUseCache = !params.fetchFn && params.cache !== false;

  if (!apiKey) {
    return {
      success: false,
      provider: 'groq',
      model,
      error: 'Groq API key not configured'
    };
  }

  if (!details?.title || !details?.primaryUrl) {
    return {
      success: false,
      provider: 'groq',
      model,
      error: 'Insufficient offer data for AI rewrite'
    };
  }

  if (canUseCache) {
    const cached = getCachedRewrite(cacheKey);

    if (cached) {
      return {
        ...cached,
        cached: true
      };
    }
  }

  const payload = {
    model,
    temperature: 0.3,
    max_tokens: 350,
    messages: [
      {
        role: 'system',
        content: [
          'Voce reescreve ofertas em portugues do Brasil sem inventar nenhuma informacao.',
          'Use apenas os dados estruturados fornecidos.',
          'Nao inclua rodapes promocionais da origem, grupos, canais, Telegram, WhatsApp, Linktree ou chamadas de convite.',
          'Nao altere URLs.',
          'Responda somente com JSON valido, sem markdown e sem texto extra.'
        ].join(' ')
      },
      {
        role: 'user',
        content: buildGroqPrompt({ details, style })
      }
    ]
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(groqApiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        success: false,
        provider: 'groq',
        model,
        error: `Groq request failed (${response.status}) ${errorText}`.trim()
      };
    }

    const rawPayload = await response.text().catch(() => '');
    const parsedPayload = rawPayload ? JSON.parse(rawPayload) : {};
    const rawContent = String(parsedPayload?.choices?.[0]?.message?.content ?? '').trim();
    const json = parseJsonObject(rawContent);

    if (!json) {
      return {
        success: false,
        provider: 'groq',
        model,
        error: 'Groq returned invalid JSON'
      };
    }

    const message = composeAiMessage(details, json, style);

    if (!message.includes(details.primaryUrl)) {
      return {
        success: false,
        provider: 'groq',
        model,
        error: 'Groq response did not preserve the primary URL'
      };
    }

    const result = {
      success: true,
      provider: 'groq',
      model,
      message,
      structured: json
    };

    if (canUseCache) {
      setCachedRewrite(cacheKey, result);
    }

    return result;
  } catch (error) {
    return {
      success: false,
      provider: 'groq',
      model,
      error: error?.name === 'AbortError' ? 'Groq request timed out' : String(error?.message ?? error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRewriteCacheKey({ model, style, details }) {
  return JSON.stringify({
    model,
    style,
    title: details.title,
    price: details.price,
    installment: details.installment,
    coupon: details.coupon,
    primaryUrl: details.primaryUrl,
    couponUrls: details.couponUrls,
    extraUrls: details.extraUrls
  });
}

function getCachedRewrite(cacheKey) {
  const cached = rewriteCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt > rewriteCacheTtlMs) {
    rewriteCache.delete(cacheKey);
    return null;
  }

  return cached.result;
}

function setCachedRewrite(cacheKey, result) {
  rewriteCache.set(cacheKey, {
    createdAt: Date.now(),
    result
  });

  if (rewriteCache.size <= rewriteCacheMaxEntries) {
    return;
  }

  const oldestKey = rewriteCache.keys().next().value;

  if (oldestKey) {
    rewriteCache.delete(oldestKey);
  }
}

function buildGroqPrompt({ details, style }) {
  return JSON.stringify({
    task: 'Classifique e normalize os campos uteis da oferta para envio',
    style,
    rules: [
      'responda somente com json valido',
      'nao escreva texto comercial extra',
      'nao invente titulo, preco, parcelamento, cupom ou urls',
      'ignore rodapes, grupos, canais, propaganda, telegram, whatsapp, instagram, linktree e convites',
      'se nao houver um campo, devolva string vazia',
      'o cupom deve conter apenas o codigo util, sem rotulos nem texto sobrando',
      'nao inclua urls em campos de titulo, preco, parcelamento ou cupom'
    ],
    offer: {
      title: details.title,
      price: details.price,
      installment: details.installment,
      coupon: details.coupon,
      primaryUrl: details.primaryUrl,
      couponUrls: details.couponUrls,
      extraUrls: details.extraUrls
    },
    responseSchema: {
      title: 'string',
      priceLine: 'string',
      installmentLine: 'string',
      couponCode: 'string'
    }
  });
}

function composeAiMessage(details, json, style) {
  const blocks = [];
  const title = sanitizeField(json.title) || details.title;
  const priceLine = sanitizeField(json.priceLine) || details.price;
  const installmentLine = sanitizeField(json.installmentLine) || details.installment;
  const couponCode = pickBestCouponCode(json.couponCode, details.coupon);

  blocks.push(defaultHeadline(style));
  blocks.push(title);

  const offerLines = [
    priceLine,
    installmentLine,
    couponCode ? `Cupom: ${couponCode}` : ''
  ].filter(Boolean);

  if (offerLines.length) {
    blocks.push(offerLines.join('\n'));
  }

  blocks.push(`Link da oferta:\n${details.primaryUrl}`);

  if (details.couponUrls.length) {
    blocks.push(`Cupons:\n${details.couponUrls.join('\n')}`);
  }

  if (details.extraUrls.length) {
    blocks.push(`Links uteis:\n${details.extraUrls.join('\n')}`);
  }

  return blocks
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanAiLine(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .trim();
}

function sanitizeField(value) {
  const line = cleanAiLine(value);

  if (!line) {
    return '';
  }

  if (/https?:\/\//i.test(line)) {
    return '';
  }

  return line;
}

function sanitizeCouponCode(value) {
  const raw = cleanAiLine(value)
    .replace(/^cupom\s*[:\-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw || /https?:\/\//i.test(raw)) {
    return '';
  }

  const tokens = raw.match(/[A-Z0-9_-]{4,}/gi) || [];

  if (!tokens.length) {
    return '';
  }

  return String(tokens[tokens.length - 1] ?? '').trim();
}

function pickBestCouponCode(aiValue, localValue) {
  const aiCoupon = sanitizeCouponCode(aiValue);
  const localCoupon = sanitizeCouponCode(localValue);

  if (!aiCoupon) {
    return localCoupon;
  }

  if (!localCoupon) {
    return aiCoupon;
  }

  const aiHasDigit = /\d/.test(aiCoupon);
  const localHasDigit = /\d/.test(localCoupon);

  if (localHasDigit && !aiHasDigit) {
    return localCoupon;
  }

  if (localCoupon.length > aiCoupon.length) {
    return localCoupon;
  }

  return aiCoupon;
}

function defaultHeadline(style) {
  if (style === 'plain') {
    return 'Oferta selecionada';
  }

  if (style === 'urgent') {
    return 'Oferta relampago';
  }

  if (style === 'sales') {
    return 'Oferta selecionada para voce';
  }

  return 'Oferta selecionada';
}

function parseJsonObject(value) {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (__error) {
      return null;
    }
  }
}
