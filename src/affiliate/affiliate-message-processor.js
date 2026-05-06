import { convertAmazonLink } from './converters/amazon-affiliate-converter.js';
import { convertShopeeLink } from './converters/shopee-affiliate-converter.js';
import { createAffiliateConversionLog, createAffiliateMessageLog, getAffiliateAccountForProcessing, getAffiliateAutomationById, updateAffiliateMessageLog } from './affiliate-store.js';
import { rewriteAffiliateMessageWithGroq } from './groq-rewriter.js';
import { detectMarketplace } from './marketplace-detector.js';
import { beautifyAffiliateMessage, hasMultipleOfferSections } from './message-beautifier.js';
import { extractMessageUrlMatches, rebuildMessageWithUrlReplacements } from './telegram-message-links.js';
import { expandUrl } from './url-expander.js';

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
  const rewriteAffiliateMessageFn = params.rewriteAffiliateMessageFn || rewriteAffiliateMessageWithGroq;
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
    const urlMatches = extractMessageUrlMatches({
      text: originalMessage,
      telegramMessage: params.telegramMessage
    }).slice(0, maxLinksPerMessage);
    const originalUrls = uniqueUrls(urlMatches.map((item) => item.normalizedUrl));

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

    for (const urlMatch of uniqueUrlMatches(urlMatches)) {
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

      if (marketplace !== 'unknown' && isCouponOrPromoLink(originalMessage, urlMatch)) {
        conversion = {
          ...conversion,
          marketplace,
          status: 'ignored',
          error: marketplace === 'unknown' ? '' : 'Coupon/promo link kept without affiliate conversion'
        };
      } else if (marketplace === 'amazon' && account?.amazonEnabled) {
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
          addReplacement(replacements, originalUrl, replacementTarget, '', urlMatch);
        } else if (automation.unknownLinkBehavior === 'ignore_message') {
          shouldIgnoreEntireMessage = true;
        }
      }

      if (conversion.status === 'converted' && conversion.affiliateUrl) {
        addReplacement(replacements, originalUrl, replacementTarget, conversion.affiliateUrl, urlMatch);
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

    let processedMessage = rebuildMessageWithUrlReplacements(originalMessage, urlMatches, replacements);

    if (automation.removeOriginalFooter) {
      processedMessage = removeLikelyFooter(processedMessage);
    }

    let rewriteMode = '';
    let rewriteError = '';
    const preserveOriginalTextEnabled = Boolean(automation.preserveOriginalTextEnabled || params.preserveOriginalTextEnabled);

    if (preserveOriginalTextEnabled) {
      rewriteMode = 'link_replace_only';
    } else {
      const preferredRewriteStyle = automation.aiRewriteStyle || automation.messageBeautifierStyle || 'clean';
      const preferredPrimaryUrl = selectPreferredPrimaryUrl(convertedUrls);
      const hasMultipleConvertedOffers = convertedUrls.filter((item) => item.status === 'converted' && item.affiliateUrl).length > 1;
      const shouldUseDeterministicRewrite = hasMultipleConvertedOffers || hasMultipleOfferSections(processedMessage);

      if (automation.aiRewriteEnabled && shouldUseDeterministicRewrite) {
        rewriteError = 'Multiple offers require deterministic local rewrite';
        console.warn(`Affiliate AI rewrite fallback: ${rewriteError}`);
      } else if (automation.aiRewriteEnabled) {
        const aiRewrite = await rewriteAffiliateMessageFn({
          message: processedMessage,
          originalMessage,
          style: preferredRewriteStyle,
          primaryUrl: preferredPrimaryUrl
        });

        if (aiRewrite.success && aiRewrite.message) {
          processedMessage = aiRewrite.message;
          rewriteMode = 'groq';
        } else {
          rewriteError = aiRewrite.error || 'AI rewrite failed';
          console.warn(`Affiliate AI rewrite fallback: ${rewriteError}`);
        }
      }

      if (automation.messageBeautifierEnabled || (automation.aiRewriteEnabled && rewriteError)) {
        processedMessage = beautifyAffiliateMessage(processedMessage, {
          style: preferredRewriteStyle,
          primaryUrl: preferredPrimaryUrl
        });
        rewriteMode = automation.aiRewriteEnabled && rewriteError ? 'groq_fallback_local' : 'local';
      }
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
      shouldSend: status !== 'ignored',
      rewriteMode,
      rewriteError
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
      errorMessage: error.message,
      rewriteMode: '',
      rewriteError: ''
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

function selectPreferredPrimaryUrl(convertedUrls) {
  const converted = convertedUrls.filter((item) => item.status === 'converted' && item.affiliateUrl);

  if (converted.length !== 1) {
    return '';
  }

  return converted[0].affiliateUrl;
}

function addReplacement(replacements, normalizedUrl, rawUrl, replacement, urlMatch = null) {
  replacements.set(rawUrl, replacement);

  if (normalizedUrl !== rawUrl) {
    replacements.set(normalizedUrl, replacement);
  }

  if (urlMatch?.displayText && urlMatch.displayText !== rawUrl && urlMatch.displayText !== normalizedUrl) {
    replacements.set(urlMatch.displayText, replacement);
  }
}

function uniqueUrls(urls = []) {
  return [...new Set(urls.filter(Boolean))];
}

function uniqueUrlMatches(urlMatches = []) {
  const seen = new Set();
  const unique = [];

  for (const match of urlMatches) {
    const key = match.normalizedUrl || match.rawUrl;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(match);
  }

  return unique;
}

function isCouponOrPromoLink(message, urlMatch) {
  const lineContext = getUrlLineContext(message, urlMatch);
  const currentLine = normalizeContext(lineContext.currentLine);
  const previousLine = normalizeContext(lineContext.previousLine);
  const joinedContext = normalizeContext([lineContext.previousLine, lineContext.currentLine].filter(Boolean).join(' '));

  if (/\b(resgate|resgatar|pegue|cupom|cupons|coupon|cupon)\b/iu.test(currentLine)) {
    return true;
  }

  if (/\b(resgate|resgatar|pegue)\b/iu.test(previousLine) && /\b(cupom|cupons|coupon|cupon)\b/iu.test(previousLine)) {
    return true;
  }

  if (/\b(todos\s+os\s+cupons|pagina\s+de\s+cupons|pagina\s+de\s+cupom|page\s+coupon)\b/iu.test(joinedContext)) {
    return true;
  }

  return false;
}

function getUrlLineContext(message, urlMatch) {
  const text = String(message ?? '');
  const offset = Number(urlMatch?.offset ?? -1);

  if (!Number.isInteger(offset) || offset < 0) {
    return { currentLine: '', previousLine: '' };
  }

  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const linesBefore = before.split('\n');
  const currentLinePrefix = linesBefore[linesBefore.length - 1] || '';
  const currentLineSuffix = after.split('\n')[0] || '';
  const currentLine = `${currentLinePrefix}${currentLineSuffix}`;
  const previousLine = findPreviousNonEmptyLine(linesBefore.slice(0, -1));

  return { currentLine, previousLine };
}

function findPreviousNonEmptyLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] ?? '').trim();

    if (line) {
      return line;
    }
  }

  return '';
}

function normalizeContext(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function removeLikelyFooter(message) {
  const lines = String(message ?? '').split('\n');
  let footerStart = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!isLikelyFooterContentLine(lines[index])) {
      continue;
    }

    for (let cursor = index; cursor >= 0; cursor -= 1) {
      if (/^_+\s*$/.test(lines[cursor].trim())) {
        footerStart = cursor;
        break;
      }
    }

    break;
  }

  return footerStart >= 0 ? lines.slice(0, footerStart).join('\n').trimEnd() : message;
}

function isLikelyFooterContentLine(line) {
  const normalized = normalizeContext(line);

  return [
    /\blinktr\.ee\b/,
    /\bgrupo\s+de\s+promocoes\b/,
    /\bcanais?\s+de\s+promocoes\b/,
    /\bconvide\s+seus\s+amigos\b/,
    /\b(?:telegram|whatsapp|instagram)\b/,
    /\bt\.me\b/
  ].some((pattern) => pattern.test(normalized));
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
    errorMessage: payload.errorMessage || '',
    rewriteMode: payload.rewriteMode || '',
    rewriteError: payload.rewriteError || ''
  };
}
