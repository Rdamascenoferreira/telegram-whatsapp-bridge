import { extractAffiliateOfferDetails, normalizeBeautifierStyle } from './message-beautifier.js';

const groqApiUrl = 'https://api.groq.com/openai/v1/chat/completions';
const defaultGroqModel = String(process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile').trim() || 'llama-3.3-70b-versatile';
const defaultTimeoutMs = 8000;

export async function rewriteAffiliateMessageWithGroq(params = {}) {
  const details = params.details || extractAffiliateOfferDetails(params.message || '', { style: params.style });
  const style = normalizeBeautifierStyle(params.style || details.style);
  const apiKey = String(params.apiKey ?? process.env.GROQ_API_KEY ?? '').trim();
  const model = String(params.model ?? process.env.GROQ_MODEL ?? defaultGroqModel).trim() || defaultGroqModel;
  const fetchFn = params.fetchFn || fetch;
  const timeoutMs = Number(params.timeoutMs ?? defaultTimeoutMs);

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

    return {
      success: true,
      provider: 'groq',
      model,
      message,
      structured: json
    };
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

function buildGroqPrompt({ details, style }) {
  const styleGuide = {
    clean: 'texto limpo, claro e comercial, com poucos emojis',
    sales: 'texto mais vendedor, energico e convincente',
    urgent: 'texto com senso de urgencia, sem exagerar',
    plain: 'texto simples, direto e sem emojis'
  };

  return JSON.stringify({
    task: 'Monte uma oferta limpa e pronta para envio',
    style,
    styleGuide: styleGuide[style] || styleGuide.clean,
    rules: [
      'nao inventar atributos do produto',
      'nao inventar preco ou cupom',
      'nao citar grupos, canais, comunidade, telegram, whatsapp, instagram, linktree ou propaganda da origem',
      'nao remover o link principal',
      'se existir parcelamento, manter',
      'se existir cupom, manter'
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
      headline: 'string',
      title: 'string',
      priceLine: 'string',
      installmentLine: 'string',
      couponLine: 'string',
      primaryLinkLabel: 'string',
      couponLinksLabel: 'string',
      extraLinksLabel: 'string',
      closingLine: 'string'
    }
  });
}

function composeAiMessage(details, json, style) {
  const blocks = [];
  const headline = cleanAiLine(json.headline) || defaultHeadline(style);
  const title = cleanAiLine(json.title) || details.title;
  const priceLine = cleanAiLine(json.priceLine) || details.price;
  const installmentLine = cleanAiLine(json.installmentLine) || details.installment;
  const couponLine = cleanAiLine(json.couponLine) || (details.coupon ? `Cupom: ${details.coupon}` : '');
  const primaryLinkLabel = cleanAiLine(json.primaryLinkLabel) || 'Link da oferta:';
  const couponLinksLabel = cleanAiLine(json.couponLinksLabel) || 'Cupons:';
  const extraLinksLabel = cleanAiLine(json.extraLinksLabel) || 'Links uteis:';
  const closingLine = cleanAiLine(json.closingLine);

  blocks.push(headline);
  blocks.push(title);

  const offerLines = [priceLine, installmentLine, couponLine].filter(Boolean);
  if (offerLines.length) {
    blocks.push(offerLines.join('\n'));
  }

  blocks.push(`${primaryLinkLabel}\n${details.primaryUrl}`);

  if (details.couponUrls.length) {
    blocks.push(`${couponLinksLabel}\n${details.couponUrls.join('\n')}`);
  }

  if (details.extraUrls.length) {
    blocks.push(`${extraLinksLabel}\n${details.extraUrls.join('\n')}`);
  }

  if (closingLine) {
    blocks.push(closingLine);
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
