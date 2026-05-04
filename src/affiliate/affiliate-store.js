const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const cloudEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);

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
  const body = {
    user_id: userId,
    name: cleanText(payload.name) || 'Automacao de afiliados',
    telegram_source_group_id: cleanText(payload.telegramSourceGroupId),
    telegram_source_group_name: cleanText(payload.telegramSourceGroupName),
    unknown_link_behavior: normalizeUnknownBehavior(payload.unknownLinkBehavior),
    custom_footer: cleanText(payload.customFooter),
    remove_original_footer: Boolean(payload.removeOriginalFooter),
    is_active: Boolean(payload.isActive),
    updated_at: new Date().toISOString()
  };

  if (!body.telegram_source_group_id) {
    throw new Error('Escolha um grupo de origem do Telegram.');
  }

  const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
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
  const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
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
    throw new Error('Automacao nao encontrada.');
  }
}

export async function updateAffiliateAutomationRules(userId, automationId, payload = {}) {
  const rows = await supabaseRequest('/rest/v1/affiliate_automations', {
    method: 'PATCH',
    body: {
      unknown_link_behavior: normalizeUnknownBehavior(payload.unknownLinkBehavior),
      custom_footer: cleanText(payload.customFooter),
      remove_original_footer: Boolean(payload.removeOriginalFooter),
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
    throw new Error('Automacao nao encontrada.');
  }
}

export async function acceptAffiliateTerms(userId, metadata = {}) {
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
    throw new Error('Supabase nao configurado.');
  }

  const url = new URL(`${supabaseUrl}${endpoint}`);
  Object.entries(options.searchParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(`Falha ao acessar o Supabase (${response.status}). ${payload}`.trim());
  }

  if (response.status === 204) {
    return [];
  }

  const payload = await response.text().catch(() => '');
  return payload.trim() ? JSON.parse(payload) : [];
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
    customFooter: String(row.custom_footer ?? ''),
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

function cleanText(value) {
  return String(value ?? '').trim();
}
