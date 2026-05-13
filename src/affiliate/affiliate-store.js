const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const cloudEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabaseBreakerFailureThreshold = Number(process.env.SUPABASE_BREAKER_FAILURE_THRESHOLD ?? 5);
const supabaseBreakerCooldownMs = Number(process.env.SUPABASE_BREAKER_COOLDOWN_MS ?? 30_000);
const supabaseBreakerState = {
  consecutiveFailures: 0,
  openUntil: 0
};
const affiliateRulesMarkerPrefix = '<!--portal-affiliate-rules:';
const affiliateRulesMarkerSuffix = '-->';

export const affiliateTermsVersion = 'affiliate-automation-v1';

export function isAffiliateStoreEnabled() {
  return cloudEnabled;
}

export async function getAffiliateState(userId) {
  if (!cloudEnabled || !userId) {
    return emptyAffiliateState();
  }

  const [accountRows, automationRows, logRows, acceptanceRows] = await Promise.all([
    supabaseRequest('/rest/v1/affiliate_accounts', {
      searchParams: {
        select: '*',
        user_id: `eq.${userId}`,
        limit: '1'
      }
    }),
    supabaseRequest('/rest/v1/affiliate_automations', {
      searchParams: {
        select: '*,affiliate_automation_destinations(*)',
        user_id: `eq.${userId}`,
        order: 'created_at.desc'
      }
    }),
    supabaseRequest('/rest/v1/affiliate_messages_log', {
      searchParams: {
        select: '*',
        user_id: `eq.${userId}`,
        order: 'created_at.desc',
        limit: '30'
      }
    }),
    supabaseRequest('/rest/v1/affiliate_terms_acceptance', {
      searchParams: {
        select: 'id,accepted_at,terms_version',
        user_id: `eq.${userId}`,
        terms_version: `eq.${affiliateTermsVersion}`,
        order: 'accepted_at.desc',
        limit: '1'
      }
    })
  ]);

  return {
    account: mapAffiliateAccount(accountRows[0]),
    automations: automationRows.map(mapAffiliateAutomation),
    logs: logRows.map(mapAffiliateMessageLog),
    termsAccepted: acceptanceRows.length > 0,
    termsVersion: affiliateTermsVersion
  };
}

export async function getAffiliateAccount(userId) {
  const rows = await supabaseRequest('/rest/v1/affiliate_accounts', {
    searchParams: {
      select: '*',
      user_id: `eq.${userId}`,
      limit: '1'
    }
  });

  return mapAffiliateAccount(rows[0]);
}

export async function getAffiliateAccountForProcessing(userId) {
  const rows = await supabaseRequest('/rest/v1/affiliate_accounts', {
    searchParams: {
      select: '*',
      user_id: `eq.${userId}`,
      limit: '1'
    }
  });

  return mapAffiliateAccount(rows[0], { includeSecret: true });
}

export async function upsertAffiliateAccount(userId, payload = {}) {
  const body = {
    user_id: userId,
    amazon_tag: cleanText(payload.amazonTag),
    amazon_shortener_enabled: Boolean(payload.amazonShortenerEnabled),
    shopee_affiliate_id: cleanText(payload.shopeeAffiliateId),
    shopee_app_id: cleanText(payload.shopeeAppId),
    default_sub_id: cleanText(payload.defaultSubId),
    amazon_enabled: Boolean(payload.amazonEnabled),
    shopee_enabled: Boolean(payload.shopeeEnabled),
    updated_at: new Date().toISOString()
  };
  const shopeeSecret = cleanText(payload.shopeeSecret);

  if (shopeeSecret) {
    body.shopee_secret = shopeeSecret;
  }

  const rows = await supabaseRequest('/rest/v1/affiliate_accounts', {
    method: 'POST',
    body,
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    searchParams: {
      on_conflict: 'user_id'
    }
  });

  return mapAffiliateAccount(rows[0]);
}

export async function getAffiliateAutomationById(userId, automationId) {
  const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
    searchParams: {
      select: '*,affiliate_automation_destinations(*)',
      user_id: `eq.${userId}`,
      id: `eq.${automationId}`,
      limit: '1'
    }
  });

  return mapAffiliateAutomation(rows[0]);
}

export async function getActiveAffiliateAutomationsBySource(userId, sourceGroupId) {
  if (!cloudEnabled || !userId || !sourceGroupId) {
    return [];
  }

  try {
    const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
      searchParams: {
        select: '*,affiliate_automation_destinations(*)',
        user_id: `eq.${userId}`,
        telegram_source_group_id: `eq.${sourceGroupId}`,
        is_active: 'eq.true',
        order: 'created_at.asc'
      }
    });

    return rows.map(mapAffiliateAutomation);
  } catch (error) {
    console.warn(`Affiliate automation lookup skipped: ${error.message}`);
    return [];
  }
}

export async function upsertAffiliateAutomation(userId, payload = {}) {
  const automationId = cleanText(payload.id);
  const currentAutomation = automationId ? await getAffiliateAutomationById(userId, automationId) : null;
  const mergedRulesPayload = mergeAffiliateAutomationRulesPayload(currentAutomation, payload);
  const body = {
    user_id: userId,
    name: cleanText(payload.name) || 'Automação de afiliados',
    telegram_source_group_id: cleanText(payload.telegramSourceGroupId),
    telegram_source_group_name: cleanText(payload.telegramSourceGroupName),
    unknown_link_behavior: normalizeUnknownBehavior(payload.unknownLinkBehavior),
    remove_original_footer: Boolean(payload.removeOriginalFooter),
    is_active: Boolean(payload.isActive),
    ...mapAutomationRulesColumns(mergedRulesPayload),
    updated_at: new Date().toISOString()
  };

  if (!body.telegram_source_group_id) {
    throw new Error('Escolha um grupo de origem do Telegram.');
  }

  const rows = await writeAffiliateAutomation({
    method: 'POST',
    body: automationId ? { id: automationId, ...body } : body,
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    searchParams: automationId ? { on_conflict: 'id' } : undefined
  });
  const saved = rows[0];
  const destinations = Array.isArray(payload.destinations) ? payload.destinations : [];

  await replaceAffiliateDestinations(saved.id, destinations);
  return getAffiliateAutomationById(userId, saved.id);
}

export async function setAffiliateAutomationActive(userId, automationId, isActive) {
  const rows = await writeAffiliateAutomation({
    method: 'PATCH',
    body: {
      is_active: Boolean(isActive),
      updated_at: new Date().toISOString()
    },
    searchParams: {
      user_id: `eq.${userId}`,
      id: `eq.${automationId}`,
      select: 'id'
    },
    headers: {
      Prefer: 'return=representation'
    }
  });

  if (!rows.length) {
    throw new Error('Automação não encontrada.');
  }
}

async function writeAffiliateAutomation(options) {
  try {
    return await supabaseRequest('/rest/v1/affiliate_automations', options);
  } catch (error) {
    if (isAffiliateAutomationRulesSchemaMissing(error)) {
      throw new Error('O banco de afiliados precisa da migracao das colunas de regras. Rode scripts/supabase-affiliate-automation.sql no Supabase e tente novamente.');
    }

    throw error;
  }
}

export async function updateAffiliateAutomationRules(userId, automationId, payload = {}) {
  const currentAutomation = await getAffiliateAutomationById(userId, automationId);
  const mergedRulesPayload = mergeAffiliateAutomationRulesPayload(currentAutomation, payload);
  const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
    method: 'PATCH',
    body: {
      unknown_link_behavior: normalizeUnknownBehavior(payload.unknownLinkBehavior),
      remove_original_footer: Boolean(payload.removeOriginalFooter),
      ...mapAutomationRulesColumns(mergedRulesPayload),
      updated_at: new Date().toISOString()
    },
    searchParams: {
      user_id: `eq.${userId}`,
      id: `eq.${automationId}`,
      select: 'id'
    },
    headers: {
      Prefer: 'return=representation'
    }
  });

  if (!rows.length) {
    throw new Error('Automação não encontrada.');
  }
}

export async function deleteAffiliateAutomationsForUser(userId) {
  if (!cloudEnabled || !userId) {
    return;
  }

  await supabaseRequest('/rest/v1/affiliate_automations', {
    method: 'DELETE',
    searchParams: {
      user_id: `eq.${userId}`
    }
  });
}

export async function acceptAffiliateTerms(userId, metadata = {}) {
  if (!cloudEnabled || !userId) {
    return;
  }

  const existingRows = await supabaseRequest('/rest/v1/affiliate_terms_acceptance', {
    searchParams: {
      select: 'id',
      user_id: `eq.${userId}`,
      terms_version: `eq.${affiliateTermsVersion}`,
      limit: '1'
    }
  });

  if (existingRows.length > 0) {
    return;
  }

  await supabaseRequest('/rest/v1/affiliate_terms_acceptance', {
    method: 'POST',
    body: {
      user_id: userId,
      ip_address: cleanText(metadata.ipAddress),
      user_agent: cleanText(metadata.userAgent),
      terms_version: affiliateTermsVersion
    },
    headers: {
      Prefer: 'return=minimal'
    }
  });
}

export async function createAffiliateMessageLog(payload = {}) {
  const rows = await supabaseRequest('/rest/v1/affiliate_messages_log', {
    method: 'POST',
    body: mapMessageLogPayload(payload),
    headers: {
      Prefer: 'return=representation'
    }
  });

  return mapAffiliateMessageLog(rows[0]);
}

export async function updateAffiliateMessageLog(logId, payload = {}) {
  if (!logId) {
    return null;
  }

  const rows = await supabaseRequest('/rest/v1/affiliate_messages_log', {
    method: 'PATCH',
    body: mapMessageLogPayload(payload, true),
    searchParams: {
      id: `eq.${logId}`,
      select: '*'
    },
    headers: {
      Prefer: 'return=representation'
    }
  });

  return mapAffiliateMessageLog(rows[0]);
}

export async function createAffiliateConversionLog(payload = {}) {
  await supabaseRequest('/rest/v1/affiliate_conversion_logs', {
    method: 'POST',
    body: {
      user_id: payload.userId,
      automation_id: payload.automationId || null,
      marketplace: payload.marketplace || 'unknown',
      original_url: payload.originalUrl,
      expanded_url: payload.expandedUrl || null,
      affiliate_url: payload.affiliateUrl || null,
      status: payload.status || 'ignored',
      error_message: payload.error || null
    },
    headers: {
      Prefer: 'return=minimal'
    }
  });
}

async function replaceAffiliateDestinations(automationId, destinations) {
  await supabaseRequest('/rest/v1/affiliate_automation_destinations', {
    method: 'DELETE',
    searchParams: {
      automation_id: `eq.${automationId}`
    }
  });

  const rows = destinations
    .map((destination) => ({
      automation_id: automationId,
      whatsapp_group_id: cleanText(destination.whatsappGroupId ?? destination.id),
      whatsapp_group_name: cleanText(destination.whatsappGroupName ?? destination.name)
    }))
    .filter((destination) => destination.whatsapp_group_id);

  if (!rows.length) {
    return;
  }

  await supabaseRequest('/rest/v1/affiliate_automation_destinations', {
    method: 'POST',
    body: rows,
    headers: {
      Prefer: 'return=minimal'
    }
  });
}

async function supabaseRequest(endpoint, options = {}) {
  if (!cloudEnabled) {
    throw new Error('Supabase não configurado.');
  }

  if (Date.now() < supabaseBreakerState.openUntil) {
    throw new Error('Supabase indisponivel temporariamente. Tente novamente em alguns segundos.');
  }

  const url = new URL(`${supabaseUrl}${endpoint}`);
  Object.entries(options.searchParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let response;

  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      registerSupabaseFailure();
      throw new Error('Tempo esgotado ao acessar o Supabase.');
    }

    registerSupabaseFailure();
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    registerSupabaseFailure();
    const payload = await response.text().catch(() => '');
    throw new Error(`Falha ao acessar o Supabase (${response.status}). ${payload}`.trim());
  }

  clearSupabaseBreakerFailures();

  if (response.status === 204) {
    return [];
  }

  const payload = await response.text().catch(() => '');

  if (!payload.trim()) {
    return [];
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Resposta inválida do Supabase em ${endpoint}.`);
  }
}

function registerSupabaseFailure() {
  supabaseBreakerState.consecutiveFailures += 1;

  if (supabaseBreakerState.consecutiveFailures >= supabaseBreakerFailureThreshold) {
    supabaseBreakerState.openUntil = Date.now() + supabaseBreakerCooldownMs;
  }
}

function clearSupabaseBreakerFailures() {
  supabaseBreakerState.consecutiveFailures = 0;
  supabaseBreakerState.openUntil = 0;
}

function isAffiliateAutomationRulesSchemaMissing(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return [
    'preserve_original_text_enabled',
    'message_beautifier_enabled',
    'message_beautifier_style',
    'ai_rewrite_enabled',
    'ai_rewrite_style',
    'telegram_forward_enabled',
    'telegram_destination_group_id',
    'telegram_destination_group_name'
  ].some((columnName) => message.includes(columnName));
}

function emptyAffiliateState() {
  return {
    account: null,
    automations: [],
    logs: [],
    termsAccepted: false,
    termsVersion: affiliateTermsVersion
  };
}

function mapAffiliateAccount(row, options = {}) {
  if (!row) {
    return null;
  }

  const account = {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    amazonTag: String(row.amazon_tag ?? ''),
    amazonShortenerEnabled: Boolean(row.amazon_shortener_enabled),
    shopeeAffiliateId: String(row.shopee_affiliate_id ?? ''),
    shopeeAppId: String(row.shopee_app_id ?? ''),
    shopeeSecretConfigured: Boolean(row.shopee_secret),
    defaultSubId: String(row.default_sub_id ?? ''),
    amazonEnabled: Boolean(row.amazon_enabled),
    shopeeEnabled: Boolean(row.shopee_enabled),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  };

  if (options.includeSecret) {
    account.shopeeSecret = String(row.shopee_secret ?? '');
  }

  return account;
}

function mapAffiliateAutomation(row) {
  if (!row) {
    return null;
  }

  const footerRules = decodeCustomFooterRules(row.custom_footer);
  const useLegacyRules = hasEncodedCustomFooterRules(row.custom_footer);
  const destinations = Array.isArray(row.affiliate_automation_destinations)
    ? row.affiliate_automation_destinations
    : [];

  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    name: String(row.name ?? ''),
    telegramSourceGroupId: String(row.telegram_source_group_id ?? ''),
    telegramSourceGroupName: String(row.telegram_source_group_name ?? ''),
    unknownLinkBehavior: normalizeUnknownBehavior(row.unknown_link_behavior),
    customFooter: footerRules.customFooter,
    preserveOriginalTextEnabled: useLegacyRules
      ? footerRules.preserveOriginalTextEnabled
      : Boolean(row.preserve_original_text_enabled),
    messageBeautifierEnabled: useLegacyRules
      ? footerRules.messageBeautifierEnabled
      : Boolean(row.message_beautifier_enabled),
    messageBeautifierStyle: useLegacyRules
      ? footerRules.messageBeautifierStyle
      : normalizeBeautifierStyle(row.message_beautifier_style),
    aiRewriteEnabled: useLegacyRules
      ? footerRules.aiRewriteEnabled
      : Boolean(row.ai_rewrite_enabled),
    aiRewriteStyle: useLegacyRules
      ? footerRules.aiRewriteStyle
      : normalizeBeautifierStyle(row.ai_rewrite_style),
    mediaSourceMode: useLegacyRules
      ? footerRules.mediaSourceMode
      : 'telegram_media',
    telegramForwardEnabled: useLegacyRules
      ? footerRules.telegramForwardEnabled
      : Boolean(row.telegram_forward_enabled),
    telegramDestinationGroupId: useLegacyRules
      ? footerRules.telegramDestinationGroupId
      : String(row.telegram_destination_group_id ?? ''),
    telegramDestinationGroupName: useLegacyRules
      ? footerRules.telegramDestinationGroupName
      : String(row.telegram_destination_group_name ?? ''),
    removeOriginalFooter: Boolean(row.remove_original_footer),
    isActive: Boolean(row.is_active),
    destinations: destinations.map((destination) => ({
      id: String(destination.id ?? ''),
      whatsappGroupId: String(destination.whatsapp_group_id ?? ''),
      whatsappGroupName: String(destination.whatsapp_group_name ?? '')
    })),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? '')
  };
}

function mapAffiliateMessageLog(row) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id ?? ''),
    automationId: String(row.automation_id ?? ''),
    userId: String(row.user_id ?? ''),
    telegramMessageId: String(row.telegram_message_id ?? ''),
    originalMessage: String(row.original_message ?? ''),
    processedMessage: String(row.processed_message ?? ''),
    originalUrls: Array.isArray(row.original_urls) ? row.original_urls : [],
    convertedUrls: Array.isArray(row.converted_urls) ? row.converted_urls : [],
    status: String(row.status ?? ''),
    errorMessage: String(row.error_message ?? ''),
    sentAt: String(row.sent_at ?? ''),
    createdAt: String(row.created_at ?? '')
  };
}

function mapMessageLogPayload(payload, patch = false) {
  const body = {};
  const assign = (key, value) => {
    if (!patch || Object.prototype.hasOwnProperty.call(payload, key) || value !== undefined) {
      body[key] = value;
    }
  };

  if (!patch || payload.automationId !== undefined) assign('automation_id', payload.automationId || null);
  if (!patch || payload.userId !== undefined) assign('user_id', payload.userId);
  if (!patch || payload.telegramMessageId !== undefined) assign('telegram_message_id', payload.telegramMessageId || null);
  if (!patch || payload.originalMessage !== undefined) assign('original_message', payload.originalMessage);
  if (!patch || payload.processedMessage !== undefined) assign('processed_message', payload.processedMessage || null);
  if (!patch || payload.originalUrls !== undefined) assign('original_urls', payload.originalUrls || null);
  if (!patch || payload.convertedUrls !== undefined) assign('converted_urls', payload.convertedUrls || null);
  if (!patch || payload.status !== undefined) assign('status', payload.status);
  if (!patch || payload.errorMessage !== undefined) assign('error_message', payload.errorMessage || null);
  if (!patch || payload.sentAt !== undefined) assign('sent_at', payload.sentAt || null);

  return body;
}

function normalizeUnknownBehavior(value) {
  const behavior = String(value ?? '').trim();
  return ['keep', 'remove', 'ignore_message'].includes(behavior) ? behavior : 'keep';
}

function normalizeBeautifierStyle(value) {
  const style = String(value ?? '').trim().toLowerCase();
  return ['clean', 'sales', 'urgent', 'plain'].includes(style) ? style : 'clean';
}

function normalizeMediaSourceMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return ['telegram_media', 'product_image', 'system_layout'].includes(mode) ? mode : 'telegram_media';
}

function mapAutomationRulesColumns(payload = {}) {
  return {
    custom_footer: encodeCustomFooterRules(payload),
    preserve_original_text_enabled: Boolean(payload.preserveOriginalTextEnabled),
    message_beautifier_enabled: Boolean(payload.messageBeautifierEnabled),
    message_beautifier_style: normalizeBeautifierStyle(payload.messageBeautifierStyle),
    ai_rewrite_enabled: Boolean(payload.aiRewriteEnabled),
    ai_rewrite_style: normalizeBeautifierStyle(payload.aiRewriteStyle),
    telegram_forward_enabled: Boolean(payload.telegramForwardEnabled),
    telegram_destination_group_id: cleanText(payload.telegramDestinationGroupId),
    telegram_destination_group_name: cleanText(payload.telegramDestinationGroupName)
  };
}

function hasEncodedCustomFooterRules(value) {
  return String(value ?? '').trim().startsWith(affiliateRulesMarkerPrefix);
}

function defaultAutomationRules(customFooter = '') {
  return {
    customFooter,
    preserveOriginalTextEnabled: false,
    messageBeautifierEnabled: false,
    messageBeautifierStyle: 'clean',
    aiRewriteEnabled: false,
    aiRewriteStyle: 'clean',
    mediaSourceMode: 'telegram_media',
    telegramForwardEnabled: false,
    telegramDestinationGroupId: '',
    telegramDestinationGroupName: ''
  };
}

function decodeCustomFooterRules(value) {
  const raw = String(value ?? '').trim();

  if (!raw.startsWith(affiliateRulesMarkerPrefix)) {
    return defaultAutomationRules(raw);
  }

  const endIndex = raw.indexOf(affiliateRulesMarkerSuffix);

  if (endIndex < 0) {
    return defaultAutomationRules(raw);
  }

  const encodedRules = raw.slice(affiliateRulesMarkerPrefix.length, endIndex);
  const customFooter = raw.slice(endIndex + affiliateRulesMarkerSuffix.length).trim();

  try {
    const rules = JSON.parse(encodedRules);

    return {
      customFooter,
      preserveOriginalTextEnabled: Boolean(rules.preserveOriginalTextEnabled),
      messageBeautifierEnabled: Boolean(rules.messageBeautifierEnabled),
      messageBeautifierStyle: normalizeBeautifierStyle(rules.messageBeautifierStyle),
      aiRewriteEnabled: Boolean(rules.aiRewriteEnabled),
      aiRewriteStyle: normalizeBeautifierStyle(rules.aiRewriteStyle),
      mediaSourceMode: normalizeMediaSourceMode(rules.mediaSourceMode),
      telegramForwardEnabled: Boolean(rules.telegramForwardEnabled),
      telegramDestinationGroupId: cleanText(rules.telegramDestinationGroupId),
      telegramDestinationGroupName: cleanText(rules.telegramDestinationGroupName)
    };
  } catch (_error) {
    return defaultAutomationRules(customFooter);
  }
}

function mergeAffiliateAutomationRulesPayload(currentAutomation, payload = {}) {
  return {
    customFooter:
      payload.customFooter !== undefined ? payload.customFooter : currentAutomation?.customFooter || '',
    preserveOriginalTextEnabled:
      payload.preserveOriginalTextEnabled !== undefined
        ? payload.preserveOriginalTextEnabled
        : currentAutomation?.preserveOriginalTextEnabled,
    messageBeautifierEnabled:
      payload.messageBeautifierEnabled !== undefined
        ? payload.messageBeautifierEnabled
        : currentAutomation?.messageBeautifierEnabled,
    messageBeautifierStyle:
      payload.messageBeautifierStyle !== undefined
        ? payload.messageBeautifierStyle
        : currentAutomation?.messageBeautifierStyle,
    aiRewriteEnabled:
      payload.aiRewriteEnabled !== undefined
        ? payload.aiRewriteEnabled
        : currentAutomation?.aiRewriteEnabled,
    aiRewriteStyle:
      payload.aiRewriteStyle !== undefined
        ? payload.aiRewriteStyle
        : currentAutomation?.aiRewriteStyle,
    mediaSourceMode:
      payload.mediaSourceMode !== undefined
        ? payload.mediaSourceMode
        : currentAutomation?.mediaSourceMode,
    telegramForwardEnabled:
      payload.telegramForwardEnabled !== undefined
        ? payload.telegramForwardEnabled
        : currentAutomation?.telegramForwardEnabled,
    telegramDestinationGroupId:
      payload.telegramDestinationGroupId !== undefined
        ? payload.telegramDestinationGroupId
        : currentAutomation?.telegramDestinationGroupId,
    telegramDestinationGroupName:
      payload.telegramDestinationGroupName !== undefined
        ? payload.telegramDestinationGroupName
        : currentAutomation?.telegramDestinationGroupName
  };
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function encodeCustomFooterRules(payload = {}) {
  const encodedRules = {
    preserveOriginalTextEnabled: Boolean(payload.preserveOriginalTextEnabled),
    messageBeautifierEnabled: Boolean(payload.messageBeautifierEnabled),
    messageBeautifierStyle: normalizeBeautifierStyle(payload.messageBeautifierStyle),
    aiRewriteEnabled: Boolean(payload.aiRewriteEnabled),
    aiRewriteStyle: normalizeBeautifierStyle(payload.aiRewriteStyle),
    mediaSourceMode: normalizeMediaSourceMode(payload.mediaSourceMode),
    telegramForwardEnabled: Boolean(payload.telegramForwardEnabled),
    telegramDestinationGroupId: cleanText(payload.telegramDestinationGroupId),
    telegramDestinationGroupName: cleanText(payload.telegramDestinationGroupName)
  };
  const customFooter = cleanText(payload.customFooter);

  return `${affiliateRulesMarkerPrefix}${JSON.stringify(encodedRules)}${affiliateRulesMarkerSuffix}${customFooter ? `\n${customFooter}` : ''}`;
}
