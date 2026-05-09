import { defaultMetrics, loadActivityForUser } from './activityStore.js';
import {
  acceptAffiliateTerms,
  getActiveAffiliateAutomationsBySource,
  getAffiliateState,
  setAffiliateAutomationActive,
  updateAffiliateAutomationRules,
  upsertAffiliateAccount,
  upsertAffiliateAutomation
} from './affiliate/affiliate-store.js';
import { processAffiliateMessage } from './affiliate/affiliate-message-processor.js';
import {
  deleteUserAccount,
  findUserById,
  listUsersForAdmin,
  updateUserAdminSettings,
  userAccountStatusOptions,
  userBillingStatusOptions,
  userPlanOptions,
  userRoleOptions
} from './authStore.js';
import { BridgeManager } from './bridgeManager.js';
import { loadConfigForUser } from './configStore.js';
import { ensurePlanCount, ensurePlanFeature, getPlanLimits } from './planLimits.js';

function isOperationalWhatsAppStatus(value) {
  return ['authenticated', 'ready'].includes(String(value ?? '').trim().toLowerCase());
}

export class BridgeApp {
  constructor(options = {}) {
    this.auth = options.auth ?? null;
    this.frontendBaseUrl = String(options.frontendBaseUrl ?? '').trim().replace(/\/$/, '');
    this.manager = new BridgeManager();
  }

  async init() {
    await this.manager.init();
  }

  attachRoutes(app) {
    const requireAuth = this.auth?.requireAuth() ?? ((_request, _response, next) => next());
    const requireWriteAccess = this.auth?.requireWriteAccess() ?? requireAuth;
    const requireAdmin = this.auth?.requireAdmin() ?? ((_request, _response, next) => next());
    const runUserOperation = async (request, operationName, task) =>
      await this.manager.runUserOperation(request.user?.id, operationName, task);
    const respondWithState = async (request, response) => {
      const auth = this.auth
        ? this.auth.getClientSession(request.user)
        : { authenticated: true, googleEnabled: false, user: null };
      const stateIssues = [];
      let runtimeState = {};
      let admin = null;
      let affiliate = null;

      if (request.user) {
        try {
          const runtime = await this.manager.getRuntimeForUser(request.user);
          runtimeState = runtime ? await runtime.getState() : {};
        } catch (error) {
          console.warn(`Runtime state unavailable for ${request.user.id}: ${error.message}`);
          runtimeState = this.buildUnavailableRuntimeState(error);
          stateIssues.push({
            scope: 'runtime',
            message: error.message
          });
        }

        affiliate = await this.buildAffiliateState(request.user.id);
        if (affiliate?.error) {
          stateIssues.push({
            scope: 'affiliate',
            message: affiliate.error
          });
        }
      }

      if (this.auth?.isAdminUser(request.user)) {
        try {
          admin = await this.buildAdminState();
        } catch (error) {
          console.warn(`Admin state unavailable: ${error.message}`);
          admin = this.buildUnavailableAdminState(error);
          stateIssues.push({
            scope: 'admin',
            message: error.message
          });
        }
      }
      const planLimits = request.user ? getPlanLimits(request.user.plan) : null;

      response.json({
        auth,
        ...(planLimits ? { planLimits } : {}),
        ...runtimeState,
        ...(affiliate ? { affiliate } : {}),
        ...(admin ? { admin } : {}),
        ...(stateIssues.length ? { issue: stateIssues[0], issues: stateIssues } : {})
      });
    };

    app.get('/', (request, response) => {
      if (this.shouldRedirectToFrontend(request)) {
        response.redirect(302, this.frontendBaseUrl);
        return;
      }

      response.type('html').send(renderBackendLandingPage(this.frontendBaseUrl));
    });

    app.get('/api/state', async (request, response) => {
      const auth = this.auth
        ? this.auth.getClientSession(request.user)
        : { authenticated: true, googleEnabled: false, user: null };

      if (this.auth && !request.user) {
        response.json({ auth });
        return;
      }

      await respondWithState(request, response);
    });

    app.post('/api/settings', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'settings:update', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const telegramMode = 'user';
        const telegramBotToken = '';
        const telegramApiId = String(request.body?.telegramApiId ?? '').trim();
        const telegramApiHash = String(request.body?.telegramApiHash ?? '').trim();
        const telegramPhone = String(request.body?.telegramPhone ?? '').trim();
        const telegramChannel = String(request.body?.telegramChannel ?? '').trim();
        await ensureTelegramSourceIsNotUsedByAffiliate(request.user.id, telegramChannel);

        await runtime.updateSettings({
          telegramMode,
          telegramBotToken,
          telegramApiId,
          telegramApiHash,
          telegramPhone,
          telegramChannel
        });
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/send-code', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'telegram:send-code', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.sendTelegramUserCode();
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/complete-auth', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'telegram:complete-auth', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.completeTelegramUserAuth({
          code: String(request.body?.code ?? '').trim(),
          password: String(request.body?.password ?? '')
        });
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/disconnect', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'telegram:disconnect', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.disconnectTelegramUser();
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/refresh-chats', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'telegram:refresh-chats', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.refreshTelegramAvailableChats();
      });
      await respondWithState(request, response);
    });

    app.post('/api/groups', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:save-groups', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const selectedGroupIds = Array.isArray(request.body?.selectedGroupIds)
          ? request.body.selectedGroupIds.map(String)
          : [];
        ensurePlanCount({
          plan: request.user.plan,
          key: 'whatsappDestinations',
          count: selectedGroupIds.length,
          label: 'A selecao de grupos WhatsApp'
        });

        await runtime.updateGroups(selectedGroupIds);
      });
      await respondWithState(request, response);
    });

    app.post('/api/refresh-groups', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:refresh-groups', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.refreshAvailableGroups();
      });
      await respondWithState(request, response);
    });

    app.post('/api/system-power', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'system:power', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const bridgeEnabled = Boolean(request.body?.bridgeEnabled);

        await runtime.updatePower(bridgeEnabled);
      });
      await respondWithState(request, response);
    });

    app.post('/api/dashboard/clear-view', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'dashboard:clear-view', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.clearDashboardView();
      });
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/reset-session', requireAdmin, async (request, response) => {
      await runUserOperation(request, 'whatsapp:reset-session', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.resetWhatsAppSession();
      });
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/reconnect', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:reconnect', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.reconnectWhatsApp();
      });
      await respondWithState(request, response);
    });

    app.post('/api/connections/reset-all', requireAdmin, async (request, response) => {
      await runUserOperation(request, 'connections:reset-all', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.resetAllConnections();
      });
      await respondWithState(request, response);
    });

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
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const affiliateState = await getAffiliateState(request.user.id);
        ensureAffiliateTermsAccepted(affiliateState);
        ensureAffiliateAutomationPlan(request.user.plan, request.body || {}, affiliateState.automations || []);
        const replaceTelegramBridgeSource = Boolean(request.body?.replaceTelegramBridgeSource);
        ensureAffiliateSourceIsNotUsedByTelegram(
          runtime.config.telegramChannel,
          request.body?.telegramSourceGroupId,
          { allowReplacement: replaceTelegramBridgeSource }
        );
        await upsertAffiliateAutomation(request.user.id, request.body || {});
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
        ensureAffiliateTermsAccepted(await getAffiliateState(request.user.id));
        const message = String(request.body?.message ?? '');
        const automationId = String(request.body?.automationId ?? '').trim();
        const draftAutomation = request.body?.automation
          ? normalizeAffiliateAutomationDraft(request.user.id, request.body.automation)
          : null;
        return await processAffiliateMessage({
          userId: request.user.id,
          automationId: draftAutomation ? '' : automationId,
          automation: draftAutomation,
          message,
          dryRun: true
        });
      });

      response.json(result);
    });

    app.get('/api/admin/users', requireAdmin, async (_request, response) => {
      response.json(await this.buildAdminState());
    });

    app.post('/api/admin/users/:userId', requireAdmin, async (request, response) => {
      const updatedUser = await updateUserAdminSettings(String(request.params.userId ?? '').trim(), {
        role: request.body?.role,
        plan: request.body?.plan,
        accountStatus: request.body?.accountStatus,
        billingStatus: request.body?.billingStatus,
        internalNote: request.body?.internalNote
      });

      if (request.user?.id === updatedUser.id) {
        Object.assign(request.user, updatedUser);
      }

      if (updatedUser.accountStatus === 'suspended') {
        await this.auth?.forceLogoutUser(updatedUser.id);
      }

      await respondWithState(request, response);
    });

    app.post('/api/admin/users/:userId/restart-runtime', requireAdmin, async (request, response) => {
      const targetUserId = String(request.params.userId ?? '').trim();
      const targetUser = await findUserById(targetUserId);

      if (!targetUser) {
        response.status(404).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Usuario nao encontrado.'
        });
        return;
      }

      await this.manager.restartRuntimeForUserId(targetUserId);
      await respondWithState(request, response);
    });

    app.delete('/api/admin/users/:userId', requireAdmin, async (request, response) => {
      const targetUserId = String(request.params.userId ?? '').trim();
      const targetUser = await findUserById(targetUserId);

      if (!targetUser) {
        response.status(404).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Usuario nao encontrado.'
        });
        return;
      }

      if (request.user?.id === targetUserId) {
        response.status(400).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Voce nao pode excluir a propria conta pelo painel admin.'
        });
        return;
      }

      await this.manager.destroyRuntimeForUserId(targetUserId);
      await (this.auth ? this.auth.deleteAccount(targetUserId) : deleteUserAccount(targetUserId));
      await respondWithState(request, response);
    });
  }

  shouldRedirectToFrontend(request) {
    if (!this.frontendBaseUrl) {
      return false;
    }

    try {
      const frontendUrl = new URL(this.frontendBaseUrl);
      const requestHost = String(request.headers.host ?? '').trim().toLowerCase();
      return frontendUrl.host.toLowerCase() !== requestHost;
    } catch {
      return false;
    }
  }

  async buildAdminState() {
    const users = await listUsersForAdmin();
    const enrichedUsers = await Promise.all(users.map(async (user) => {
      const [config, activity] = await Promise.all([
        loadConfigForUser(user.id),
        loadActivityForUser(user.id)
      ]);
      const runtime = this.manager.runtimes.get(user.id);
      const supervisor = runtime?.getSupervisorSnapshot?.() || null;

      return {
        ...user,
        planLimits: getPlanLimits(user.plan),
        isOnline: this.auth?.isUserOnline(user.id) ?? false,
        workspace: {
          bridgeEnabled: Boolean(config.bridgeEnabled),
          telegramConfigured: Boolean(
            (config.telegramApiId && config.telegramApiHash && config.telegramSession)
          ),
          telegramChannel: config.telegramChannel || '',
          selectedGroupCount: Array.isArray(config.selectedGroupIds) ? config.selectedGroupIds.length : 0,
          whatsAppStatus: runtime?.whatsAppStatus || 'offline',
          telegramStatus: runtime?.telegramStatus || 'offline',
          whatsAppPhone: runtime?.whatsAppPhone || null
        },
        metrics: {
          totalTelegramReceived: activity.metrics.totalTelegramReceived || 0,
          totalForwardedMessages: activity.metrics.totalForwardedMessages || 0,
          totalWhatsAppDeliveries: activity.metrics.totalWhatsAppDeliveries || 0,
          totalErrors: activity.metrics.totalErrors || 0,
          lastActivityAt: activity.metrics.lastActivityAt || null,
          lastForwardedAt: activity.metrics.lastForwardedAt || null
        },
        supervisor
      };
    }));
    const supervisor = this.manager.getRuntimeSnapshots();

    return {
      summary: buildAdminSummary(enrichedUsers),
      supervisor: {
        totalRuntimes: supervisor.length,
        readyWhatsApp: supervisor.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: supervisor.filter((runtime) => runtime.telegramStatus === 'listening').length,
        queuedDeliveries: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryQueue?.queuedCount || 0), 0),
        activeDeliveries: supervisor.filter((runtime) => runtime.deliveryQueue?.active).length,
        sessions: supervisor
      },
      options: {
        roles: userRoleOptions,
        plans: userPlanOptions,
        accountStatuses: userAccountStatusOptions,
        billingStatuses: userBillingStatusOptions
      },
      users: enrichedUsers
    };
  }

  getHealthSnapshot() {
    const operations = this.manager.getOperationsSnapshot();
    const runtimeSnapshots = this.manager.getRuntimeSnapshots();
    const deliveryQueues = runtimeSnapshots.map((runtime) => ({
      userId: runtime.userId,
      telegramStatus: runtime.telegramStatus,
      whatsAppStatus: runtime.whatsAppStatus,
      pendingTelegramCount: runtime.pendingTelegramCount,
      deliveryQueue: runtime.deliveryQueue
    }));

    return {
      runtimes: {
        loaded: this.manager.runtimes.size,
        initializing: this.manager.runtimePromises.size,
        readyWhatsApp: runtimeSnapshots.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: runtimeSnapshots.filter((runtime) => runtime.telegramStatus === 'listening').length
      },
      operations,
      deliveryQueues
    };
  }

  async buildAffiliateState(userId) {
    try {
      return await getAffiliateState(userId);
    } catch (error) {
      return {
        account: null,
        automations: [],
        logs: [],
        termsAccepted: false,
        error: error.message
      };
    }
  }

  buildUnavailableAdminState(error) {
    const supervisor = this.manager.getRuntimeSnapshots();

    return {
      summary: buildAdminSummary([]),
      supervisor: {
        totalRuntimes: supervisor.length,
        readyWhatsApp: supervisor.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: supervisor.filter((runtime) => runtime.telegramStatus === 'listening').length,
        queuedDeliveries: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryQueue?.queuedCount || 0), 0),
        activeDeliveries: supervisor.filter((runtime) => runtime.deliveryQueue?.active).length,
        sessions: supervisor
      },
      options: {
        roles: userRoleOptions,
        plans: userPlanOptions,
        accountStatuses: userAccountStatusOptions,
        billingStatuses: userBillingStatusOptions
      },
      users: [],
      error: error?.message || 'Nao foi possivel carregar a area administrativa.'
    };
  }

  buildUnavailableRuntimeState(error) {
    return {
      whatsAppStatus: 'offline',
      whatsAppPhone: null,
      qrDataUrl: null,
      telegramStatus: 'offline',
      config: {
        telegramMode: 'user',
        telegramChannel: '',
        telegramApiId: '',
        telegramApiHash: '',
        telegramPhone: '',
        hasTelegramBotToken: false,
        hasTelegramSession: false,
        bridgeEnabled: false,
        dashboardViewClearedAt: '',
        selectedGroupIds: []
      },
      metrics: {
        ...defaultMetrics,
        selectedGroupCount: 0,
        availableAdminGroupCount: 0,
        whatsAppStatus: 'offline',
        telegramStatus: 'offline',
        groupsRefreshing: false,
        groupRefreshProgress: null,
        groupCacheRefreshedAt: '',
        hasCachedGroups: false,
        pendingTelegramCount: 0,
        whatsAppDeliveryQueue: null,
        canResetWhatsAppSession: false,
        canReconnectWhatsApp: false
      },
      telegram: {
        authPhase: 'idle',
        phoneNumber: '',
        passwordRequired: false,
        codeSentViaApp: false,
        user: null,
        availableChats: []
      },
      issue: {
        scope: 'runtime',
        message: error?.message || 'Nao foi possivel carregar o runtime deste usuario.'
      },
      activity: [],
      offers: [],
      diagnostics: null,
      groups: [],
      logs: []
    };
  }
}

function ensureAffiliateAccountPlan(plan, payload = {}) {
  if (payload.amazonEnabled) {
    ensurePlanFeature({
      plan,
      key: 'amazonAffiliate',
      message: 'Conversao Amazon esta disponivel a partir do plano Plus.'
    });
  }

  if (payload.shopeeEnabled) {
    ensurePlanFeature({
      plan,
      key: 'shopeeAffiliate',
      message: 'Conversao Shopee esta disponivel a partir do plano Pro.'
    });
  }
}

function ensureAffiliateTermsAccepted(affiliateState = {}) {
  if (!affiliateState.termsAccepted) {
    throw new Error('Aceite os termos de afiliados antes de configurar ou testar o automatizador.');
  }
}

function ensureAffiliateAccountPayload(payload = {}, existingAccount = null) {
  if (payload.amazonEnabled) {
    const amazonTag = String(payload.amazonTag ?? '').trim();

    if (!amazonTag) {
      throw new Error('Informe sua tag de afiliado da Amazon antes de ativar a conversao Amazon.');
    }

    if (/\s/.test(amazonTag) || amazonTag.length > 80) {
      throw new Error('A tag de afiliado da Amazon nao pode ter espacos e deve ter ate 80 caracteres.');
    }
  }

  if (payload.shopeeEnabled) {
    const shopeeAppId = String(payload.shopeeAppId ?? '').trim();
    const shopeeSecret = String(payload.shopeeSecret ?? '').trim();
    const existingSecretConfigured = Boolean(existingAccount?.shopeeSecretConfigured);

    if (!shopeeAppId) {
      throw new Error('Informe o App ID da Shopee antes de ativar a conversao Shopee.');
    }

    if (/\s/.test(shopeeAppId) || shopeeAppId.length > 80) {
      throw new Error('O App ID da Shopee nao pode ter espacos e deve ter ate 80 caracteres.');
    }

    if (!shopeeSecret && !existingSecretConfigured) {
      throw new Error('Informe o Secret/API Secret da Shopee antes de ativar a conversao Shopee.');
    }
  }
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
    label: 'Os destinos WhatsApp desta automacao'
  });
}

function normalizeAffiliateAutomationDraft(userId, payload = {}) {
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
    preserveOriginalTextEnabled: true,
    isActive: true,
    destinations: []
  };
}

async function ensureTelegramSourceIsNotUsedByAffiliate(userId, telegramChannel) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);

  if (!normalizedTelegramChannel) {
    return;
  }

  const automations = await getActiveAffiliateAutomationsBySource(userId, normalizedTelegramChannel);

  if (automations.length) {
    const automationName = automations[0]?.name || 'Automacao de Afiliados';
    throw new Error(`Este grupo ja esta sendo usado em "${automationName}". Escolha outra origem para o Telegram normal ou edite a automacao de afiliados.`);
  }
}

function ensureAffiliateSourceIsNotUsedByTelegram(telegramChannel, affiliateSourceGroupId, options = {}) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);
  const normalizedAffiliateSource = normalizeRouteSourceId(affiliateSourceGroupId);

  if (normalizedTelegramChannel && normalizedAffiliateSource && normalizedTelegramChannel === normalizedAffiliateSource) {
    if (options.allowReplacement) {
      return;
    }

    throw new Error('Este grupo ja esta configurado no fluxo Telegram normal. Escolha outra origem para Afiliados ou remova a origem na aba Telegram.');
  }
}

function normalizeRouteSourceId(value) {
  return String(value ?? '').trim();
}

function getRequestIp(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwardedFor || request.ip || '';
}

function buildAdminSummary(users) {
  return {
    totalUsers: users.length,
    activeBridges: users.filter((user) => user.workspace?.bridgeEnabled).length,
    readySessions: users.filter((user) => ['authenticated', 'ready'].includes(String(user.workspace?.whatsAppStatus ?? '').toLowerCase())).length,
    paidPlans: users.filter((user) => ['starter', 'pro', 'enterprise'].includes(user.plan)).length
  };
}

function renderBackendLandingPage(frontendBaseUrl) {
  const panelUrl = frontendBaseUrl || 'http://localhost:3000';

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telegram WhatsApp Bridge API</title>
    <style>
      body {
        align-items: center;
        background: #f5f1e8;
        color: #1c1915;
        display: flex;
        font-family: Georgia, "Times New Roman", serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }

      main {
        background: #fffaf0;
        border: 1px solid #ded5c5;
        border-radius: 24px;
        box-shadow: 0 24px 70px rgb(47 38 24 / 14%);
        max-width: 560px;
        padding: 42px;
      }

      h1 {
        font-size: clamp(2rem, 6vw, 3.5rem);
        line-height: 0.95;
        margin: 0 0 18px;
      }

      p {
        color: #5c5347;
        font-size: 1.05rem;
        line-height: 1.7;
      }

      a {
        color: #8b4e20;
        font-weight: 700;
      }

      code {
        background: #efe6d7;
        border-radius: 999px;
        padding: 3px 8px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Backend ativo</h1>
      <p>Esta porta agora serve a API da ponte Telegram -> WhatsApp. O painel principal foi movido para o frontend Next.</p>
      <p>Acesse <a href="${escapeHtml(panelUrl)}">${escapeHtml(panelUrl)}</a> para abrir o painel.</p>
      <p>Healthcheck: <code>/api/health</code></p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
