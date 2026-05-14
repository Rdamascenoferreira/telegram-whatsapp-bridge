import { getActiveAffiliateAutomationsBySource } from '../../affiliate/affiliate-store.js';
import { ensurePlanCount, ensurePlanFeature } from '../../planLimits.js';

export function ensureAffiliateAccountPlan(plan, payload = {}) {
  if (payload.amazonEnabled) {
    ensurePlanFeature({
      plan,
      key: 'amazonAffiliate',
      message: 'Conversão Amazon está disponível a partir do plano Plus.'
    });
  }

  if (payload.shopeeEnabled) {
    ensurePlanFeature({
      plan,
      key: 'shopeeAffiliate',
      message: 'Conversão Shopee está disponível a partir do plano Pro.'
    });
  }
}

export function ensureAffiliateTermsAccepted(affiliateState = {}) {
  if (!affiliateState.termsAccepted) {
    throw new Error('Aceite os termos de afiliados antes de configurar ou testar o automatizador.');
  }
}

export function ensureAffiliateAccountPayload(payload = {}, existingAccount = null) {
  if (payload.amazonEnabled) {
    const amazonTag = String(payload.amazonTag ?? '').trim();

    if (!amazonTag) {
      throw new Error('Informe sua tag de afiliado da Amazon antes de ativar a conversão Amazon.');
    }

    if (/\s/.test(amazonTag) || amazonTag.length > 80) {
      throw new Error('A tag de afiliado da Amazon não pode ter espaços e deve ter até 80 caracteres.');
    }
  }

  if (payload.shopeeEnabled) {
    const shopeeAppId = String(payload.shopeeAppId ?? '').trim();
    const shopeeSecret = String(payload.shopeeSecret ?? '').trim();
    const existingSecretConfigured = Boolean(existingAccount?.shopeeSecretConfigured);

    if (!shopeeAppId) {
      throw new Error('Informe o App ID da Shopee antes de ativar a conversão Shopee.');
    }

    if (/\s/.test(shopeeAppId) || shopeeAppId.length > 80) {
      throw new Error('O App ID da Shopee não pode ter espaços e deve ter até 80 caracteres.');
    }

    if (!shopeeSecret && !existingSecretConfigured) {
      throw new Error('Informe o Secret/API Secret da Shopee antes de ativar a conversão Shopee.');
    }
  }
}

export async function ensureAffiliateAutomationPayload({ user, runtime, affiliateState, payload }) {
  ensureAffiliateTermsAccepted(affiliateState);
  ensureAffiliateAutomationPlan(user.plan, payload, affiliateState.automations || []);
  const fieldErrors = computeAffiliateAutomationFieldErrors({
    payload,
    runtimeTelegramStatus: runtime.telegramStatus,
    automations: affiliateState.automations || []
  });

  if (Object.keys(fieldErrors).length) {
    throw createValidationError('Revise os campos destacados antes de salvar o fluxo.', fieldErrors, 'FLOW_VALIDATION_FAILED');
  }
}

export function computeAffiliateAutomationFieldErrors({
  payload = {},
  runtimeTelegramStatus = '',
  automations = []
}) {
  const fieldErrors = {};
  const sourceId = normalizeRouteSourceId(payload.telegramSourceGroupId);
  const destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
  const destinationIds = destinations
    .map((destination) => String(destination?.whatsappGroupId ?? '').trim())
    .filter(Boolean);

  if (runtimeTelegramStatus !== 'listening') {
    fieldErrors.telegram = 'Conclua o login do Telegram antes de salvar o fluxo.';
  }

  if (!sourceId) {
    fieldErrors.telegramSourceGroupId = 'Escolha uma origem do Telegram para este fluxo.';
  }

  if (!destinationIds.length) {
    fieldErrors.destinations = 'Selecione ao menos um grupo de destino no WhatsApp.';
  }

  if (sourceId) {
    const payloadAutomationId = String(payload.id ?? '').trim();
    const duplicateSourceAutomation = automations.find((automation) => {
      const automationId = String(automation?.id ?? '').trim();
      if (payloadAutomationId && automationId === payloadAutomationId) {
        return false;
      }
      return normalizeRouteSourceId(automation?.telegramSourceGroupId) === sourceId;
    });

    if (duplicateSourceAutomation) {
      fieldErrors.telegramSourceGroupId = `Esta origem já está em uso no fluxo "${duplicateSourceAutomation.name || 'Automatizador de Ofertas'}".`;
    }
  }

  return fieldErrors;
}

export async function ensureTelegramSourceIsNotUsedByAffiliate(userId, telegramChannel) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);

  if (!normalizedTelegramChannel) {
    return;
  }

  const automations = await getActiveAffiliateAutomationsBySource(userId, normalizedTelegramChannel);

  if (automations.length) {
    const automationName = automations[0]?.name || 'Automação de Afiliados';
    throw new Error(`Este grupo já está sendo usado em "${automationName}". Escolha outra origem para o Telegram normal ou edite a automação de afiliados.`);
  }
}

export function ensureAffiliateSourceIsNotUsedByTelegram(telegramChannel, affiliateSourceGroupId, options = {}) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);
  const normalizedAffiliateSource = normalizeRouteSourceId(affiliateSourceGroupId);

  if (normalizedTelegramChannel && normalizedAffiliateSource && normalizedTelegramChannel === normalizedAffiliateSource) {
    if (options.allowReplacement) {
      return;
    }

    throw new Error('Este grupo já está configurado no fluxo Telegram normal. Escolha outra origem para Afiliados ou remova a origem na aba Telegram.');
  }
}

export function normalizeAffiliateAutomationDraft(userId, payload = {}) {
  const mediaSourceMode = String(payload.mediaSourceMode ?? 'telegram_media').trim().toLowerCase();
  return {
    id: 'manual-test',
    userId,
    name: String(payload.name ?? 'Teste manual').trim() || 'Teste manual',
    telegramSourceGroupId: String(payload.telegramSourceGroupId ?? '').trim(),
    telegramSourceGroupName: String(payload.telegramSourceGroupName ?? '').trim(),
    unknownLinkBehavior: String(payload.unknownLinkBehavior ?? 'keep'),
    customFooter: String(payload.customFooter ?? '').trim(),
    removeOriginalFooter: Boolean(payload.removeOriginalFooter),
    messageBeautifierEnabled: false,
    messageBeautifierStyle: 'clean',
    aiRewriteEnabled: false,
    aiRewriteStyle: 'clean',
    mediaSourceMode: ['telegram_media', 'product_image', 'system_layout'].includes(mediaSourceMode)
      ? mediaSourceMode
      : 'telegram_media',
    preserveOriginalTextEnabled: true,
    isActive: true,
    destinations: []
  };
}

export function serializeAffiliatePayloadForSimulation(payload, maxInlinePreviewBytes) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.type === 'media' && payload.base64) {
    const mimeType = String(payload.mimeType || 'image/jpeg');
    const base64 = String(payload.base64 || '');
    const mediaBytes = Buffer.byteLength(base64, 'base64');
    const mediaPreviewUrl =
      mediaBytes <= maxInlinePreviewBytes
        ? `data:${mimeType};base64,${base64}`
        : '';
    return {
      type: 'media',
      caption: String(payload.caption || ''),
      mimeType,
      filename: String(payload.filename || ''),
      mediaBytes,
      previewOmitted: mediaBytes > maxInlinePreviewBytes,
      mediaPreviewUrl
    };
  }

  return {
    type: 'text',
    text: String(payload.text || '')
  };
}

export function isAmazonShortenerGloballyEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.URL_SHORTENER_ENABLED ?? '').trim().toLowerCase()
  );
}

function ensureAffiliateAutomationPlan(plan, payload = {}, automations = []) {
  const automationId = String(payload.id ?? '').trim();
  const existingAutomation = automations.find((automation) => String(automation.id) === automationId);
  const creatingNewAutomation = !automationId || !existingAutomation;
  const nextAutomationCount = creatingNewAutomation ? automations.length + 1 : automations.length;
  const destinations = Array.isArray(payload.destinations) ? payload.destinations : [];

  ensurePlanCount({
    plan,
    key: 'affiliateAutomations',
    count: nextAutomationCount,
    label: 'A quantidade de automacoes de afiliados'
  });
  ensurePlanCount({
    plan,
    key: 'whatsappDestinations',
    count: destinations.length,
    label: 'Os destinos WhatsApp desta automação'
  });
}

function createValidationError(message, fieldErrors = {}, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  error.fieldErrors = fieldErrors;
  return error;
}

function normalizeRouteSourceId(value) {
  return String(value ?? '').trim();
}
