import {
  acceptAffiliateTerms,
  getAffiliateState,
  setAffiliateAutomationActive,
  updateAffiliateAutomationRules,
  upsertAffiliateAccount,
  upsertAffiliateAutomation
} from '../affiliate/affiliate-store.js';
import { processAffiliateMessage } from '../affiliate/affiliate-message-processor.js';
import {
  ensureAffiliateAccountPayload,
  ensureAffiliateAccountPlan,
  ensureAffiliateAutomationPayload,
  ensureAffiliateSourceIsNotUsedByTelegram,
  ensureAffiliateTermsAccepted,
  normalizeAffiliateAutomationDraft,
  serializeAffiliatePayloadForSimulation
} from '../services/affiliate/validation.js';

const simulatorInlinePreviewMaxBytes = 320 * 1024;

export function attachAffiliateRoutes({
  app,
  requireWriteAccess,
  manager,
  runUserOperation,
  respondWithState,
  getRequestIp
}) {
  app.post('/api/affiliate/account', requireWriteAccess, async (request, response) => {
    await runUserOperation(request, 'affiliate:account', async () => {
      const affiliateState = await getAffiliateState(request.user.id);
      ensureAffiliateTermsAccepted(affiliateState);
      ensureAffiliateAccountPlan(request.user.plan, request.body || {});
      ensureAffiliateAccountPayload(request.body || {}, affiliateState.account);
      await upsertAffiliateAccount(request.user.id, request.body || {});
    });
    await respondWithState(request, response);
  });

  app.post('/api/affiliate/automations', requireWriteAccess, async (request, response) => {
    await runUserOperation(request, 'affiliate:automation', async () => {
      const runtime = await manager.getRuntimeForUser(request.user);
      const affiliateState = await getAffiliateState(request.user.id);
      const normalizedPayload = request.body || {};
      await ensureAffiliateAutomationPayload({
        user: request.user,
        runtime,
        affiliateState,
        payload: normalizedPayload
      });
      const replaceTelegramBridgeSource = Boolean(request.body?.replaceTelegramBridgeSource);
      ensureAffiliateSourceIsNotUsedByTelegram(
        runtime.config.telegramChannel,
        normalizedPayload.telegramSourceGroupId,
        { allowReplacement: replaceTelegramBridgeSource }
      );
      await upsertAffiliateAutomation(request.user.id, normalizedPayload);
      if (replaceTelegramBridgeSource && runtime.config.telegramChannel) {
        await runtime.updateSettings({
          ...runtime.config,
          telegramMode: 'user',
          telegramBotToken: '',
          telegramChannel: ''
        });
      }
    });
    await respondWithState(request, response);
  });

  app.post('/api/affiliate/automations/:automationId/toggle', requireWriteAccess, async (request, response) => {
    await runUserOperation(request, 'affiliate:toggle', async () => {
      if (Boolean(request.body?.isActive)) {
        ensureAffiliateTermsAccepted(await getAffiliateState(request.user.id));
      }
      await setAffiliateAutomationActive(
        request.user.id,
        String(request.params.automationId ?? '').trim(),
        Boolean(request.body?.isActive)
      );
    });
    await respondWithState(request, response);
  });

  app.post('/api/affiliate/automations/:automationId/rules', requireWriteAccess, async (request, response) => {
    await runUserOperation(request, 'affiliate:rules', async () => {
      ensureAffiliateTermsAccepted(await getAffiliateState(request.user.id));
      await updateAffiliateAutomationRules(
        request.user.id,
        String(request.params.automationId ?? '').trim(),
        request.body || {}
      );
    });
    await respondWithState(request, response);
  });

  app.post('/api/affiliate/terms/accept', requireWriteAccess, async (request, response) => {
    await runUserOperation(request, 'affiliate:terms', async () => {
      await acceptAffiliateTerms(request.user.id, {
        ipAddress: getRequestIp(request),
        userAgent: request.headers['user-agent']
      });
    });
    await respondWithState(request, response);
  });

  app.post('/api/affiliate/test', requireWriteAccess, async (request, response) => {
    const result = await runUserOperation(request, 'affiliate:test', async () => {
      const affiliateState = await getAffiliateState(request.user.id);
      ensureAffiliateTermsAccepted(affiliateState);
      const message = String(request.body?.message ?? '');
      const automationId = String(request.body?.automationId ?? '').trim();
      const draftAutomation = request.body?.automation
        ? normalizeAffiliateAutomationDraft(request.user.id, request.body.automation)
        : null;
      const simulationResult = await processAffiliateMessage({
        userId: request.user.id,
        automationId: draftAutomation ? '' : automationId,
        automation: draftAutomation,
        message,
        dryRun: true
      });

      const automationForSimulation =
        draftAutomation
        || (affiliateState.automations || []).find((automation) => String(automation.id || '') === automationId)
        || normalizeAffiliateAutomationDraft(request.user.id, {});

      let channelPayloads = null;

      if (simulationResult?.shouldSend && simulationResult?.processedMessage) {
        const runtime = await manager.getRuntimeForUser(request.user);
        const payloads = await runtime.prepareAffiliateChannelPayloads({
          originalMessageText: String(simulationResult.processedMessage || ''),
          telegramMessage: null,
          automation: automationForSimulation,
          convertedUrls: Array.isArray(simulationResult.convertedUrls) ? simulationResult.convertedUrls : []
        });
        channelPayloads = {
          whatsApp: serializeAffiliatePayloadForSimulation(payloads?.whatsApp, simulatorInlinePreviewMaxBytes),
          telegram: serializeAffiliatePayloadForSimulation(payloads?.telegram, simulatorInlinePreviewMaxBytes)
        };
      }

      return {
        ...simulationResult,
        channelPayloads
      };
    });

    response.json(result);
  });
}
