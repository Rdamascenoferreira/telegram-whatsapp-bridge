import {
  getActiveAffiliateAutomationsBySource,
  getAffiliateState,
  updateAffiliateMessageLog
} from '../../affiliate/affiliate-store.js';
import { processAffiliateMessage } from '../../affiliate/affiliate-message-processor.js';
import { fallbackText } from './whatsAppPayload.js';

export async function routeTelegramMessage(runtime, updateType, message) {
  const sourceGroupId = String(message.chat?.id ?? '');
  const normalFlowMatches = matchesChannel(message.chat, runtime.config.telegramChannel);
  const affiliateHandled = await maybeProcessAffiliateAutomation(runtime, {
    sourceGroupId,
    sourceGroupName: describeTelegramChat(message.chat),
    telegramMessageId: String(message.message_id ?? ''),
    messageText: message.text || message.caption || fallbackText(message),
    telegramMessage: message
  });

  if (!normalFlowMatches) {
    return;
  }

  runtime.telegramStatus = 'listening';
  runtime.log(
    `Mensagem recebida do Telegram (${updateType}) em ${describeTelegramChat(message.chat)}.`,
    {
      type: 'telegram_received',
      increments: { telegramReceived: 1 },
      metadata: {
        updateType,
        chatId: sourceGroupId,
        messageId: Number(message.message_id ?? 0)
      }
    }
  );
  runtime.upsertOffer([message], {
    status: 'captured',
    metadata: {
      updateType,
      source: 'telegram_bot'
    }
  });

  if (affiliateHandled) {
    return;
  }

  await runtime.handleTelegramMessage(message);
}

export async function routeTelegramUserMessage(runtime, event) {
  const message = event?.message;

  if (!message) {
    return;
  }

  const sourceChatRefs = getTelegramUserMessageChatRefs(message);
  const sourceChatId = sourceChatRefs[0] || '';
  const chat = await message.getChat().catch(() => null);
  const sourceGroupIds = [
    ...sourceChatRefs,
    ...getTelegramEntityChatRefs(chat)
  ];
  rememberTelegramSourceCursor(runtime, sourceGroupIds, Number(message.id ?? 0));
  const runtimeMessage = {
    __telegramSource: 'user_session',
    id: Number(message.id ?? 0),
    chatId: sourceChatId,
    text: message.text || message.message || '',
    caption: message.text || message.message || '',
    rawMessage: message
  };

  const affiliateHandled = await maybeProcessAffiliateAutomation(runtime, {
    sourceGroupId: sourceChatId,
    sourceGroupIds,
    sourceGroupName: describeTelegramEntity(chat, sourceChatId),
    telegramMessageId: String(message.id ?? ''),
    messageText: runtimeMessage.text || runtimeMessage.caption || fallbackText(runtimeMessage),
    telegramMessage: runtimeMessage
  });

  if (!matchesTelegramUserMessage(message, runtime.config.telegramChannel)) {
    return;
  }

  runtime.telegramStatus = 'listening';
  runtime.log(
    `Mensagem recebida do Telegram (user session) em ${describeTelegramEntity(chat, sourceChatId)}.`,
    {
      type: 'telegram_received',
      increments: { telegramReceived: 1 },
      metadata: {
        updateType: 'user_session',
        chatId: sourceChatId,
        messageId: Number(message.id ?? 0)
      }
    }
  );
  runtime.upsertOffer([runtimeMessage], {
    status: 'captured',
    metadata: {
      updateType: 'user_session',
      source: 'telegram_user_session'
    }
  });

  if (affiliateHandled) {
    return;
  }

  await runtime.handleTelegramMessage(runtimeMessage);
}

export async function maybeProcessAffiliateAutomation(
  runtime,
  { sourceGroupId, sourceGroupIds, sourceGroupName, telegramMessageId, messageText, telegramMessage }
) {
  if (!runtime.config?.bridgeEnabled) {
    runtime.log('Mensagem de afiliados recebida, mas o sistema esta desligado. Encaminhamento ignorado.', {
      type: 'affiliate_forward_skipped',
      metadata: {
        sourceGroupId: String(sourceGroupId || ''),
        sourceGroupName: String(sourceGroupName || '')
      }
    });
    return false;
  }

  const sourceRefs = Array.isArray(sourceGroupIds) && sourceGroupIds.length
    ? sourceGroupIds
    : [sourceGroupId];
  const sourceCandidates = [
    ...new Set(
      sourceRefs
        .flatMap((sourceRef) => buildTelegramChatRefCandidates(sourceRef))
        .filter(Boolean)
    )
  ];
  const automations = [];
  const seenAutomationIds = new Set();
  let activeAutomationCount = 0;

  for (const candidate of sourceCandidates) {
    const candidateAutomations = await getActiveAffiliateAutomationsBySource(runtime.userId, candidate);

    for (const automation of candidateAutomations) {
      if (seenAutomationIds.has(automation.id)) {
        continue;
      }
      seenAutomationIds.add(automation.id);
      automations.push(automation);
    }

    if (automations.length > 0) {
      break;
    }
  }

  if (!automations.length) {
    try {
      const affiliateState = await getAffiliateState(runtime.userId);
      activeAutomationCount = (affiliateState?.automations || []).filter((automation) => automation?.isActive).length;
      const normalizedSources = new Set(sourceCandidates.map(normalizeTelegramChatRef).filter(Boolean));
      const fallbackMatches = (affiliateState?.automations || []).filter((automation) => {
        if (!automation?.isActive) {
          return false;
        }
        return normalizedSources.has(normalizeTelegramChatRef(automation.telegramSourceGroupId));
      });

      for (const automation of fallbackMatches) {
        if (seenAutomationIds.has(automation.id)) {
          continue;
        }
        seenAutomationIds.add(automation.id);
        automations.push(automation);
      }
    } catch {}
  }

  if (!automations.length) {
    const previewText = String(messageText || '').trim() || 'Mensagem recebida sem origem de automacao correspondente.';
    if (activeAutomationCount > 0) {
      runtime.upsertOffer([telegramMessage || { text: previewText, caption: previewText, chatId: sourceGroupId }], {
        id: `affiliate:unmatched:${String(telegramMessageId || Date.now())}`,
        status: 'ignored',
        sourceLabel: `${sourceGroupName || sourceGroupId || 'Telegram'} [Afiliados]`,
        preview: previewText,
        messageCount: 1,
        groupCount: 0,
        deliveryCount: 0,
        reason: 'Origem sem automacao ativa correspondente.',
        metadata: {
          channels: {
            telegram: {
              status: 'received',
              detail: 'Mensagem recebida fora das origens configuradas na automacao ativa.'
            },
            whatsapp: {
              status: 'ignored',
              delivered: 0,
              failed: 0,
              skipped: 0,
              targetGroups: 0
            }
          }
        }
      });
    }

    runtime.log('Mensagem recebida sem automacao de afiliados correspondente para a origem.', {
      type: 'affiliate_source_unmatched',
      metadata: {
        sourceGroupId,
        sourceCandidates
      }
    });
    return false;
  }

  for (const automation of automations) {
    const offerId = `affiliate:${automation.id}:${String(telegramMessageId || Date.now())}`;
    const baseSourceMessage = telegramMessage || { text: messageText, caption: messageText, chatId: sourceGroupId };

    runtime.upsertOffer([baseSourceMessage], {
      id: offerId,
      status: 'captured',
      sourceLabel: `${sourceGroupName || sourceGroupId || 'Telegram'} [Afiliados]`,
      preview: String(messageText || 'Mensagem captada do Telegram.'),
      messageCount: 1,
      groupCount: 0,
      deliveryCount: 0,
      metadata: {
        channels: {
          telegram: {
            status: 'received',
            detail: 'Mensagem recebida pela automacao de afiliados.'
          },
          whatsapp: {
            status: 'pending',
            delivered: 0,
            failed: 0,
            skipped: 0,
            targetGroups: 0
          }
        },
        automationId: automation.id,
        automationName: automation.name
      }
    });

    const result = await processAffiliateMessage({
      userId: runtime.userId,
      automationId: automation.id,
      automation,
      telegramMessageId,
      message: messageText,
      telegramMessage
    });

    if (!result.shouldSend) {
      const ignoredReason = buildAffiliateIgnoredReason(result);
      runtime.upsertOffer([baseSourceMessage], {
        id: offerId,
        status: 'ignored',
        sourceLabel: `${sourceGroupName || sourceGroupId || 'Telegram'} [Afiliados]`,
        preview: String(result.processedMessage || messageText || 'Mensagem ignorada pela automacao de afiliados.'),
        messageCount: 1,
        groupCount: 0,
        deliveryCount: 0,
        reason: ignoredReason,
        metadata: {
          channels: {
            telegram: {
              status: 'received',
              detail: 'Mensagem processada pela automacao de afiliados.'
            },
            whatsapp: {
              status: 'ignored',
              delivered: 0,
              failed: 0,
              skipped: 0,
              targetGroups: 0
            }
          },
          automationId: automation.id,
          automationName: automation.name
        }
      });
      runtime.log(`Automacao de afiliados "${automation.name}" processou a mensagem sem envio (${result.status}).`, {
        type: 'affiliate_ignored',
        metadata: {
          automationId: automation.id,
          sourceGroupId,
          sourceGroupName
        }
      });
      continue;
    }

    const destinationIds = automation.destinations.map((destination) => destination.whatsappGroupId).filter(Boolean);
    const targetGroupIds = runtime.resolveWhatsAppTargetGroupIds(destinationIds);

    if (!targetGroupIds.length) {
      await updateAffiliateMessageLog(result.messageLogId, {
        status: 'error',
        errorMessage: 'Nenhum grupo de WhatsApp destino configurado.'
      });
      runtime.log(`Automacao de afiliados "${automation.name}" sem destino WhatsApp configurado.`, {
        level: 'error',
        type: 'affiliate_error',
        increments: { errors: 1 }
      });
      continue;
    }

    if (!runtime.whatsAppClient || runtime.whatsAppStatus !== 'ready') {
      await updateAffiliateMessageLog(result.messageLogId, {
        status: 'error',
        errorMessage: `WhatsApp indisponivel: ${runtime.whatsAppStatus}`
      });
      runtime.log('Mensagem de afiliados processada, mas o WhatsApp ainda nao esta pronto.', {
        level: 'error',
        type: 'affiliate_error',
        increments: { errors: 1 }
      });
      continue;
    }

    const originalMessageText = String(result.processedMessage || '');
    const channelPayloads = await runtime.prepareAffiliateChannelPayloads({
      originalMessageText,
      telegramMessage,
      automation,
      convertedUrls: result.convertedUrls
    });
    const whatsAppPayload = channelPayloads.whatsApp;
    const delivery = await runtime.sendAffiliateMessageToWhatsAppGroups(whatsAppPayload, targetGroupIds, {
      automationId: automation.id,
      telegramMessageId: String(telegramMessageId || '')
    });
    const telegramForwardResult = {
      enabled: Boolean(automation.telegramForwardEnabled && automation.telegramDestinationGroupId),
      sent: false,
      error: ''
    };

    if (telegramForwardResult.enabled) {
      if (!runtime.telegramClient || runtime.telegramStatus !== 'listening') {
        telegramForwardResult.error = `Telegram indisponivel: ${runtime.telegramStatus || 'offline'}`;
      } else {
        try {
          await runtime.sendAffiliateMessageToTelegramDestination(
            channelPayloads.telegram,
            automation.telegramDestinationGroupId
          );
          telegramForwardResult.sent = true;
          runtime.log(`Automacao de afiliados "${automation.name}" tambem enviada para o Telegram.`, {
            type: 'affiliate_telegram_sent',
            metadata: {
              automationId: automation.id,
              destinationId: automation.telegramDestinationGroupId,
              destinationName: automation.telegramDestinationGroupName || automation.telegramDestinationGroupId
            }
          });
        } catch (error) {
          telegramForwardResult.error = error.message;
        }
      }
    }

    const errorMessages = delivery.failed.map((failure) => `${failure.groupId}: ${failure.error}`);
    if (telegramForwardResult.error) {
      errorMessages.push(`telegram:${automation.telegramDestinationGroupId}: ${telegramForwardResult.error}`);
    }

    await updateAffiliateMessageLog(result.messageLogId, {
      status: errorMessages.length ? 'error' : 'sent',
      errorMessage: errorMessages.join(' | '),
      sentAt: delivery.sent.length || telegramForwardResult.sent ? new Date().toISOString() : null
    });
    runtime.upsertOffer([telegramMessage || { text: originalMessageText, chatId: sourceGroupId }], {
      id: offerId,
      status: errorMessages.length ? 'failed' : 'sent',
      sourceLabel: `${sourceGroupName || sourceGroupId || 'Telegram'} [Afiliados]`,
      preview: originalMessageText || 'Mensagem processada pela automacao de afiliados.',
      messageCount: 1,
      groupCount: targetGroupIds.length,
      deliveryCount: delivery.sent.length,
      reason: errorMessages.join(' | '),
      metadata: {
        channels: {
          telegram: {
            status: telegramForwardResult.enabled
              ? (telegramForwardResult.sent ? 'sent' : telegramForwardResult.error ? 'failed' : 'pending')
              : 'not_enabled',
            detail: telegramForwardResult.enabled
              ? (
                  telegramForwardResult.sent
                    ? `Enviado para ${automation.telegramDestinationGroupName || automation.telegramDestinationGroupId || 'destino Telegram'}.`
                    : `Falha: ${telegramForwardResult.error || 'nao enviado'}`
                )
              : 'Sem encaminhamento para Telegram nesta automacao.'
          },
          whatsapp: {
            status: delivery.failed.length > 0 ? 'partial' : 'sent',
            delivered: delivery.sent.length,
            failed: delivery.failed.length,
            skipped: delivery.skipped?.length || 0,
            targetGroups: targetGroupIds.length
          }
        },
        automationId: automation.id,
        automationName: automation.name
      }
    });

    runtime.log(`Automacao de afiliados "${automation.name}" enviada para ${delivery.sent.length}/${targetGroupIds.length} destino(s) do WhatsApp${telegramForwardResult.sent ? ' e tambem para Telegram' : ''}${delivery.skipped?.length ? ` (${delivery.skipped.length} duplicado(s) ignorado(s))` : ''}.`, {
      type: errorMessages.length ? 'affiliate_partial_error' : 'affiliate_sent',
      increments: {
        forwardBatches: 1,
        forwardedMessages: 1,
        whatsAppDeliveries: delivery.sent.length,
        errors: errorMessages.length
      },
      metadata: {
        automationId: automation.id,
        groups: targetGroupIds.length,
        sent: delivery.sent.length,
        failed: delivery.failed.length,
        skipped: delivery.skipped?.length || 0,
        payloadType: whatsAppPayload.type,
        telegramForwardEnabled: telegramForwardResult.enabled,
        telegramForwardSent: telegramForwardResult.sent,
        telegramDestinationId: automation.telegramDestinationGroupId || '',
        telegramDestinationName: automation.telegramDestinationGroupName || ''
      }
    });
  }

  return true;
}

function matchesChannel(chat, configuredChannel) {
  if (!configuredChannel) {
    return false;
  }

  const normalizedConfigured = normalizeTelegramChatRef(configuredChannel);
  const chatId = normalizeTelegramChatRef(chat?.id);
  const username = chat?.username ? `@${String(chat.username).trim().toLowerCase()}` : '';

  return normalizedConfigured === chatId || normalizedConfigured === username;
}

function normalizeTelegramChatRef(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized.startsWith('@')) {
    return normalized;
  }

  if (/^-100\d+$/.test(normalized)) {
    return normalized.slice(4);
  }

  if (/^-\d+$/.test(normalized)) {
    return normalized.slice(1);
  }

  return normalized;
}

function describeTelegramChat(chat) {
  const title = chat?.title || chat?.username || 'chat sem nome';
  return `${title} [${chat?.id}]`;
}

function buildAffiliateIgnoredReason(result) {
  const explicitError = String(result?.errorMessage || '').trim();
  if (explicitError) {
    return explicitError;
  }

  const status = String(result?.status || '').trim().toLowerCase();
  if (status === 'error') {
    return 'Falha no processamento da automacao de afiliados.';
  }

  const convertedUrls = Array.isArray(result?.convertedUrls) ? result.convertedUrls : [];
  if (convertedUrls.length === 0) {
    return 'Nenhum link elegivel encontrado na mensagem.';
  }

  const errorDetails = convertedUrls
    .map((item) => String(item?.error || '').trim())
    .filter(Boolean);
  if (errorDetails.length) {
    return `Falha ao converter links: ${errorDetails[0]}`;
  }

  const hasUnknown = convertedUrls.some((item) => String(item?.marketplace || '').toLowerCase() === 'unknown');
  if (hasUnknown) {
    const unknownHosts = convertedUrls
      .filter((item) => String(item?.marketplace || '').toLowerCase() === 'unknown')
      .map((item) => {
        const raw = String(item?.expandedUrl || item?.originalUrl || '').trim();
        try {
          return new URL(raw).hostname.toLowerCase();
        } catch {
          return '';
        }
      })
      .filter(Boolean);

    if (unknownHosts.length > 0) {
      return `Links nao suportados pela regra atual de afiliados (${[...new Set(unknownHosts)].join(', ')}).`;
    }

    return 'Links nao suportados pela regra atual de afiliados.';
  }

  return 'Mensagem ignorada por regra da automacao de afiliados.';
}

function getTelegramUserMessageChatRefs(message) {
  const candidates = [
    message?.peerId,
    message?.inputChat,
    message?.inputSender,
    message?.chatId,
    message?.peerId?.channelId,
    message?.peerId?.chatId,
    message?.peerId?.userId,
    message?.inputChat?.channelId,
    message?.inputChat?.chatId,
    message?.inputSender?.channelId,
    message?.inputSender?.chatId
  ];

  return [...new Set(candidates.flatMap((candidate) => serializeTelegramChatRefs(candidate)).filter(Boolean))];
}

function matchesTelegramUserMessage(message, configuredChannel) {
  if (!configuredChannel) {
    return false;
  }

  const configured = normalizeTelegramChatRef(configuredChannel);
  return getTelegramUserMessageChatRefs(message).some(
    (candidate) => normalizeTelegramChatRef(candidate) === configured
  );
}

function describeTelegramEntity(chat, fallbackId = '') {
  const title = chat?.title || chat?.username || chat?.firstName || chat?.id || fallbackId || 'chat sem nome';
  return `${title} [${fallbackId || chat?.id || ''}]`;
}

function serializeTelegramChatRef(value) {
  return serializeTelegramChatRefs(value)[0] || '';
}

function serializeTelegramChatRefs(value, seen = new Set()) {
  if (value === undefined || value === null) {
    return [];
  }

  if (['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    return [String(value).trim()].filter(Boolean);
  }

  const direct = String(value).trim();
  const refs = [];

  if (direct && direct !== '[object Object]') {
    refs.push(direct);
  }

  if (typeof value !== 'object') {
    return refs;
  }

  if (seen.has(value)) {
    return refs;
  }
  seen.add(value);

  for (const key of ['channelId', 'chatId', 'userId', 'id', 'value']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      refs.push(...serializeTelegramChatRefs(value[key], seen));
    }
  }

  return [...new Set(refs.filter(Boolean))];
}

function getTelegramEntityChatRefs(chat) {
  return [
    chat?.id,
    chat?.username ? `@${String(chat.username).trim().toLowerCase()}` : ''
  ].flatMap((candidate) => serializeTelegramChatRefs(candidate));
}

function buildTelegramChatRefCandidates(value) {
  const raw = serializeTelegramChatRef(value);

  if (!raw) {
    return [];
  }

  const candidates = new Set([raw]);
  const normalized = normalizeTelegramChatRef(raw);

  if (normalized) {
    candidates.add(normalized);
    candidates.add(`-${normalized}`);
    if (/^\d+$/.test(normalized)) {
      candidates.add(`-100${normalized}`);
    }
  }

  return [...candidates];
}

function rememberTelegramSourceCursor(runtime, sourceGroupIds, messageId) {
  if (!Number.isFinite(messageId) || messageId <= 0) {
    return;
  }

  if (!runtime.telegramSourceCursor || typeof runtime.telegramSourceCursor.set !== 'function') {
    runtime.telegramSourceCursor = new Map();
  }

  const refs = Array.isArray(sourceGroupIds) ? sourceGroupIds : [sourceGroupIds];

  for (const ref of refs) {
    for (const candidate of buildTelegramChatRefCandidates(ref)) {
      const key = toTelegramSourceCursorKey(candidate);
      const previous = Number(runtime.telegramSourceCursor.get(key) || 0);
      if (messageId > previous) {
        runtime.telegramSourceCursor.set(key, messageId);
      }
    }
  }
}

function toTelegramSourceCursorKey(value) {
  const normalized = normalizeTelegramChatRef(value);

  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('@')) {
    return `username:${normalized}`;
  }

  return `id:${normalized}`;
}

export const __telegramRoutingTestUtils = {
  buildTelegramChatRefCandidates,
  getTelegramUserMessageChatRefs,
  normalizeTelegramChatRef
};
