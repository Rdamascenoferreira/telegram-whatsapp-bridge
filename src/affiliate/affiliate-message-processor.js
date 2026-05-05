import { convertAmazonLink } from './converters/amazon-affiliate-converter.js';
import { convertShopeeLink } from './converters/shopee-affiliate-converter.js';
import { createAffiliateConversionLog, createAffiliateMessageLog, getAffiliateAccountForProcessing, getAffiliateAutomationById, updateAffiliateMessageLog } from './affiliate-store.js';
import { detectMarketplace } from './marketplace-detector.js';
import { beautifyAffiliateMessage } from './message-beautifier.js';
import { expandUrl } from './url-expander.js';
import { extractUrlMatches } from './url-extractor.js';

const maxMessageLength = 12000;
const maxLinksPerMessage = 20;

export async function processAffiliateMessage(params = {}) {
  const userId = String(params.userId ?? '').trim();
  const automationId = String(params.automationId ?? '').trim();
  const originalMessage = String(params.message ?? '').slice(0, maxMessageLength);
  const automation = params.automation || (automationId ? await getAffiliateAutomationById(userId, automationId) : null);
  const account = params.account || (userId ? await getAffiliateAccountForProcessing(userId) : null);
  const dryRun = Boolean(params.dryRun);
  const expandUrlFn = params.expandUrlFn || expandUrl;
  const logEnabled = !dryRun;
  let messageLogId = '';

  if (!automation) {
    return buildResult({
      originalMessage,
      processedMessage: originalMessage,
      status: 'ignored',
      shouldSend: false,
      errorMessage: 'Affiliate automation not found'
    });
  }

  if (!automation.isActive && !dryRun) {
    return buildResult({
      automationId: automation.id,
      originalMessage,
      processedMessage: originalMessage,
      status: 'ignored',
      shouldSend: false,
      errorMessage: 'Affiliate automation is inactive'
    });
  }

  if (logEnabled) {
    const initialLog = await createAffiliateMessageLog({
      automationId: automation.id,
      userId,
      telegramMessageId: params.telegramMessageId,
      originalMessage,
      status: 'processing'
    });
    messageLogId = initialLog?.id || '';
  }

  try {
    const urlMatches = extractUrlMatches(originalMessage).slice(0, maxLinksPerMessage);
    const originalUrls = urlMatches.map((item) => item.normalizedUrl);

    if (!originalUrls.length) {
      const ignored = buildResult({
        automationId: automation.id,
        messageLogId,
        originalMessage,
        processedMessage: originalMessage,
        originalUrls,
        convertedUrls: [],
        status: 'ignored',
        shouldSend: false
      });
      await persistMessageResult(logEnabled, messageLogId, ignored);
      return ignored;
    }

    const replacements = new Map();
    const convertedUrls = [];
    let shouldIgnoreEntireMessage = false;

    for (const urlMatch of urlMatches) {
      const originalUrl = urlMatch.normalizedUrl;
      const replacementTarget = urlMatch.rawUrl;
      const expanded = await expandUrlFn(originalUrl);
      const expandedUrl = expanded.expandedUrl || originalUrl;
      const marketplace = detectMarketplace(expandedUrl);
      let conversion = {
        originalUrl,
        expandedUrl,
        marketplace,
        status: 'ignored'
      };

      if (marketplace === 'amazon' && account?.amazonEnabled) {
        const amazonResult = convertAmazonLink(expandedUrl, account.amazonTag);
        conversion = {
          ...conversion,
          affiliateUrl: amazonResult.affiliateUrl,
          status: amazonResult.success ? 'converted' : 'error',
          error: amazonResult.error
        };
      } else if (marketplace === 'shopee' && account?.shopeeEnabled) {
        const shopeeResult = await convertShopeeLink(expandedUrl, {
          affiliateId: account.shopeeAffiliateId,
          appId: account.shopeeAppId,
          secret: account.shopeeSecret || params.shopeeSecret,
          userId,
          sourceChannel: 'telegram',
          sourceGroupId: automation.telegramSourceGroupId,
          sourceGroupName: automation.telegramSourceGroupName,
          destinationGroupId: automation.destinations?.[0]?.whatsappGroupId,
          destinationGroupName: automation.destinations?.[0]?.whatsappGroupName,
          destinationCount: automation.destinations?.length || 0,
          campaign: account.defaultSubId
        });
        conversion = {
          ...conversion,
          affiliateUrl: shopeeResult.affiliateUrl,
          affiliateId: shopeeResult.affiliateId,
          subIds: shopeeResult.subIds,
          utmContent: shopeeResult.utmContent,
          status: shopeeResult.success ? 'converted' : 'error',
          error: shopeeResult.error
        };
      } else if (marketplace === 'unknown') {
        if (automation.unknownLinkBehavior === 'remove') {
          addReplacement(replacements, originalUrl, replacementTarget, '');
        } else if (automation.unknownLinkBehavior === 'ignore_message') {
          shouldIgnoreEntireMessage = true;
        }
      }

      if (conversion.status === 'converted' && conversion.affiliateUrl) {
        addReplacement(replacements, originalUrl, replacementTarget, conversion.affiliateUrl);
      }

      convertedUrls.push(conversion);

      if (logEnabled) {
        await createAffiliateConversionLog({
          userId,
          automationId: automation.id,
          ...conversion
        }).catch((error) => {
          console.warn(`Affiliate conversion log skipped: ${error.message}`);
        });
      }
    }

    if (shouldIgnoreEntireMessage) {
      const ignored = buildResult({
        automationId: automation.id,
        messageLogId,
        originalMessage,
        processedMessage: originalMessage,
        originalUrls,
        convertedUrls,
        status: 'ignored',
        shouldSend: false
      });
      await persistMessageResult(logEnabled, messageLogId, ignored);
      return ignored;
    }

    let processedMessage = applyUrlReplacements(originalMessage, replacements);

    if (automation.removeOriginalFooter) {
      processedMessage = removeLikelyFooter(processedMessage);
    }

    if (automation.messageBeautifierEnabled) {
      processedMessage = beautifyAffiliateMessage(processedMessage, {
        style: automation.messageBeautifierStyle
      });
    }

    if (automation.customFooter) {
      processedMessage = `${processedMessage.trimEnd()}\n\n${automation.customFooter}`.trim();
    }

    const hasConvertedUrl = convertedUrls.some((item) => item.status === 'converted');
    const hasErrorsOnly = convertedUrls.some((item) => item.status === 'error') && !hasConvertedUrl;
    const status = hasConvertedUrl ? 'converted' : hasErrorsOnly ? 'error' : 'ignored';
    const result = buildResult({
      automationId: automation.id,
      messageLogId,
      originalMessage,
      processedMessage,
      originalUrls,
      convertedUrls,
      status,
      shouldSend: status !== 'ignored'
    });

    await persistMessageResult(logEnabled, messageLogId, result);
    return result;
  } catch (error) {
    const result = buildResult({
      automationId: automation.id,
      messageLogId,
      originalMessage,
      processedMessage: originalMessage,
      status: 'error',
      shouldSend: false,
      errorMessage: error.message
    });
    await persistMessageResult(logEnabled, messageLogId, result);
    return result;
  }
}

async function persistMessageResult(enabled, messageLogId, result) {
  if (!enabled || !messageLogId) {
    return;
  }

  await updateAffiliateMessageLog(messageLogId, {
    processedMessage: result.processedMessage,
    originalUrls: result.originalUrls,
    convertedUrls: result.convertedUrls,
    status: result.status,
    errorMessage: result.errorMessage
  }).catch((error) => {
    console.warn(`Affiliate message log update skipped: ${error.message}`);
  });
}

function applyUrlReplacements(message, replacements) {
  let processed = message;

  for (const [originalUrl, replacement] of replacements.entries()) {
    processed = processed.split(originalUrl).join(replacement);
  }

  return processed.replace(/[ \t]+\n/g, '\n').trimEnd();
}

function addReplacement(replacements, normalizedUrl, rawUrl, replacement) {
  replacements.set(rawUrl, replacement);

  if (normalizedUrl !== rawUrl) {
    replacements.set(normalizedUrl, replacement);
  }
}

function removeLikelyFooter(message) {
  const lines = String(message ?? '').split('\n');
  const footerStart = lines.findIndex((line) => /^[_-]\s*$/.test(line.trim()));

  if (footerStart < 0) {
    return message;
  }

  return lines.slice(0, footerStart).join('\n').trimEnd();
}

function buildResult(payload) {
  return {
    automationId: payload.automationId || '',
    messageLogId: payload.messageLogId || '',
    originalMessage: payload.originalMessage || '',
    processedMessage: payload.processedMessage || payload.originalMessage || '',
    originalUrls: payload.originalUrls || [],
    convertedUrls: payload.convertedUrls || [],
    shouldSend: Boolean(payload.shouldSend),
    status: payload.status || 'ignored',
    errorMessage: payload.errorMessage || ''
  };
}
