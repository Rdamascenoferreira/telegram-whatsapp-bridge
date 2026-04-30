import { convertAmazonLink } from './converters/amazon-affiliate-converter.js';
import { convertShopeeLink } from './converters/shopee-affiliate-converter.js';
import { createAffiliateConversionLog, createAffiliateMessageLog, getAffiliateAccount, getAffiliateAutomationById, updateAffiliateMessageLog } from './affiliate-store.js';
import { detectMarketplace } from './marketplace-detector.js';
import { expandUrl } from './url-expander.js';
import { extractUrls } from './url-extractor.js';

const maxMessageLength = 12000;
const maxLinksPerMessage = 20;

export async function processAffiliateMessage(params = {}) {
  const userId = String(params.userId ?? '').trim();
  const automationId = String(params.automationId ?? '').trim();
  const originalMessage = String(params.message ?? '').slice(0, maxMessageLength);
  const automation = params.automation || (automationId ? await getAffiliateAutomationById(userId, automationId) : null);
  const account = params.account || (userId ? await getAffiliateAccount(userId) : null);
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
    const originalUrls = extractUrls(originalMessage).slice(0, maxLinksPerMessage);

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

    for (const originalUrl of originalUrls) {
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
          secret: params.shopeeSecret,
          subId: account.defaultSubId
        });
        conversion = {
          ...conversion,
          affiliateUrl: shopeeResult.affiliateUrl,
          status: shopeeResult.success ? 'converted' : 'error',
          error: shopeeResult.error
        };
      } else if (marketplace === 'unknown') {
        if (automation.unknownLinkBehavior === 'remove') {
          replacements.set(originalUrl, '');
        } else if (automation.unknownLinkBehavior === 'ignore_message') {
          shouldIgnoreEntireMessage = true;
        }
      }

      if (conversion.status === 'converted' && conversion.affiliateUrl) {
        replacements.set(originalUrl, conversion.affiliateUrl);
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
