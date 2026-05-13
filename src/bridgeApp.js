import { appendActivityEvent, defaultMetrics, loadActivityForUser, saveActivityForUser } from './activityStore.js';
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
  userPlanOptions
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
    const auditAdminAction = async (request, action, targetUserId, outcome = 'success', metadata = {}) => {
      const actorId = String(request.user?.id ?? '').trim();

      if (!actorId) {
        return;
      }

      try {
        const activity = await loadActivityForUser(actorId);
        const nextActivity = appendActivityEvent(activity, {
          at: new Date().toISOString(),
          level: outcome === 'success' ? 'info' : 'error',
          type: 'audit_admin',
          message: `Admin action: ${action} (${outcome})`,
          metadata: {
            action,
            outcome,
            actorUserId: actorId,
            actorEmail: String(request.user?.email ?? ''),
            targetUserId: String(targetUserId ?? '').trim(),
            ipAddress: getRequestIp(request),
            ...metadata
          }
        });
        await saveActivityForUser(actorId, nextActivity);
      } catch (error) {
        console.warn(`Admin audit unavailable: ${error.message}`);
      }
    };
    const respondWithState = async (request, response, options = {}) => {
      const includeAdmin = Boolean(options.includeAdmin);
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
          await runtime.maybeRecoverWhatsAppOnLogin();
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

      if (includeAdmin && this.auth?.isAdminUser(request.user)) {
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

      const includeAdminQuery = String(request.query?.includeAdmin ?? '').trim().toLowerCase();
      const includeAdmin = includeAdminQuery === '1' || includeAdminQuery === 'true';
      await respondWithState(request, response, { includeAdmin });
    });

    app.get('/api/admin/state', requireAdmin, async (_request, response) => {
      response.json(await this.buildAdminState());
    });

    app.get('/api/admin/health', requireAdmin, async (_request, response) => {
      response.json({
        ok: true,
        service: 'telegram-whatsapp-bridge',
        environment: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.round(process.uptime()),
        ...this.getHealthSnapshot(),
        timestamp: new Date().toISOString()
      });
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

    app.post('/api/post-layout', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'post-layout:update', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.updatePostLayout(request.body || {});
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

    app.get('/api/groups/list', requireAuth, async (request, response) => {
      try {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const search = String(request.query?.search ?? '').trim();
        const page = Math.max(1, parseInt(String(request.query?.page ?? '1'), 10) || 1);
        const pageSize = Math.min(100, Math.max(10, parseInt(String(request.query?.pageSize ?? '50'), 10) || 50));
        const filter = String(request.query?.filter ?? 'all').trim();
        const result = runtime.getGroupsPage({ search, page, pageSize, filter });
        response.json(result);
      } catch (error) {
        response.status(500).json({ error: error?.message || 'Não foi possível carregar a lista de grupos.' });
      }
    });

    app.get('/api/groups/status', requireAuth, async (request, response) => {
      try {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        const statusPage = runtime.getGroupsPage({ page: 1, pageSize: 1 });
        response.json(statusPage.meta);
      } catch (error) {
        response.status(500).json({ error: error?.message || 'Não foi possível obter o status dos grupos.' });
      }
    });

    app.post('/api/refresh-groups', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:refresh-groups', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.refreshAvailableGroups({ waitForCompletion: false });
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
      await auditAdminAction(request, 'whatsapp.reset_session', request.user?.id, 'success');
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
      await auditAdminAction(request, 'connections.reset_all', request.user?.id, 'success');
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/logout-behavior', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:logout-behavior', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.updateWhatsAppLogoutBehavior(Boolean(request.body?.disconnectWhatsAppOnLogout));
      });
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/logout-action', requireWriteAccess, async (request, response) => {
      await runUserOperation(request, 'whatsapp:logout-action', async () => {
        const runtime = await this.manager.getRuntimeForUser(request.user);
        await runtime.handleUserLogout();
      });
      response.json({ ok: true });
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
      const targetUserId = String(request.params.userId ?? '').trim();
      const updatedUser = await updateUserAdminSettings(String(request.params.userId ?? '').trim(), {
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

      await auditAdminAction(request, 'admin.update_user_settings', targetUserId, 'success', {
        plan: request.body?.plan,
        accountStatus: request.body?.accountStatus,
        billingStatus: request.body?.billingStatus
      });
      await respondWithState(request, response);
    });

    app.post('/api/admin/users/:userId/restart-runtime', requireAdmin, async (request, response) => {
      const targetUserId = String(request.params.userId ?? '').trim();
      const targetUser = await findUserById(targetUserId);

      if (!targetUser) {
        await auditAdminAction(request, 'admin.restart_runtime', targetUserId, 'not_found');
        response.status(404).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Usuário não encontrado.'
        });
        return;
      }

      await this.manager.restartRuntimeForUserId(targetUserId);
      await auditAdminAction(request, 'admin.restart_runtime', targetUserId, 'success');
      await respondWithState(request, response);
    });

    app.delete('/api/admin/users/:userId', requireAdmin, async (request, response) => {
      const targetUserId = String(request.params.userId ?? '').trim();
      const targetUser = await findUserById(targetUserId);

      if (!targetUser) {
        await auditAdminAction(request, 'admin.delete_user', targetUserId, 'not_found');
        response.status(404).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Usuário não encontrado.'
        });
        return;
      }

      if (request.user?.id === targetUserId) {
        await auditAdminAction(request, 'admin.delete_user', targetUserId, 'blocked_self_delete');
        response.status(400).json({
          authenticated: true,
          googleEnabled: this.auth?.googleEnabled ?? false,
          error: 'Você não pode excluir a propria conta pelo painel admin.'
        });
        return;
      }

      await this.manager.destroyRuntimeForUserId(targetUserId);
      await (this.auth ? this.auth.deleteAccount(targetUserId) : deleteUserAccount(targetUserId));
      await auditAdminAction(request, 'admin.delete_user', targetUserId, 'success');
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
    const deliveryHealth = summarizeDeliveryHealth(supervisor);

    return {
      summary: buildAdminSummary(enrichedUsers),
      supervisor: {
        totalRuntimes: supervisor.length,
        readyWhatsApp: supervisor.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: supervisor.filter((runtime) => runtime.telegramStatus === 'listening').length,
        queuedDeliveries: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryQueue?.queuedCount || 0), 0),
        activeDeliveries: supervisor.filter((runtime) => runtime.deliveryQueue?.active).length,
        skippedDuplicates: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.skippedDuplicates || 0), 0),
        transientFailures: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.transientFailures || 0), 0),
        fatalFailures: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.fatalFailures || 0), 0),
        healthAlerts: deliveryHealth.healthAlerts,
        sessions: supervisor
      },
      options: {
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
    const deliveryHealth = summarizeDeliveryHealth(runtimeSnapshots);
    const deliveryQueues = runtimeSnapshots.map((runtime) => ({
      userId: runtime.userId,
      telegramStatus: runtime.telegramStatus,
      whatsAppStatus: runtime.whatsAppStatus,
      pendingTelegramCount: runtime.pendingTelegramCount,
      deliveryQueue: runtime.deliveryQueue,
      deliveryStats: runtime.deliveryStats || {
        skippedDuplicates: 0,
        transientFailures: 0,
        fatalFailures: 0
      }
    }));

    return {
      runtimes: {
        loaded: this.manager.runtimes.size,
        initializing: this.manager.runtimePromises.size,
        readyWhatsApp: runtimeSnapshots.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: runtimeSnapshots.filter((runtime) => runtime.telegramStatus === 'listening').length
      },
      operations,
      delivery: deliveryHealth.totals,
      healthAlerts: deliveryHealth.healthAlerts,
      deliveryQueues
    };
  }

  async buildAffiliateState(userId) {
    try {
      const affiliateState = await getAffiliateState(userId);
      return {
        ...affiliateState,
        shortener: {
          amazonEnabled: isAmazonShortenerGloballyEnabled()
        }
      };
    } catch (error) {
      return {
        account: null,
        automations: [],
        logs: [],
        termsAccepted: false,
        shortener: {
          amazonEnabled: isAmazonShortenerGloballyEnabled()
        },
        error: error.message
      };
    }
  }

  buildUnavailableAdminState(error) {
    const supervisor = this.manager.getRuntimeSnapshots();
    const deliveryHealth = summarizeDeliveryHealth(supervisor);

    return {
      summary: buildAdminSummary([]),
      supervisor: {
        totalRuntimes: supervisor.length,
        readyWhatsApp: supervisor.filter((runtime) => isOperationalWhatsAppStatus(runtime.whatsAppStatus)).length,
        listeningTelegram: supervisor.filter((runtime) => runtime.telegramStatus === 'listening').length,
        queuedDeliveries: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryQueue?.queuedCount || 0), 0),
        activeDeliveries: supervisor.filter((runtime) => runtime.deliveryQueue?.active).length,
        skippedDuplicates: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.skippedDuplicates || 0), 0),
        transientFailures: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.transientFailures || 0), 0),
        fatalFailures: supervisor.reduce((total, runtime) => total + Number(runtime.deliveryStats?.fatalFailures || 0), 0),
        healthAlerts: deliveryHealth.healthAlerts,
        sessions: supervisor
      },
      options: {
        plans: userPlanOptions,
        accountStatuses: userAccountStatusOptions,
        billingStatuses: userBillingStatusOptions
      },
      users: [],
      error: error?.message || 'Não foi possível carregar a area administrativa.'
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
        disconnectWhatsAppOnLogout: false,
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
        deliveryStats: {
          skippedDuplicates: 0,
          transientFailures: 0,
          fatalFailures: 0
        },
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
        message: error?.message || 'Não foi possível carregar o runtime deste usuário.'
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

function ensureAffiliateTermsAccepted(affiliateState = {}) {
  if (!affiliateState.termsAccepted) {
    throw new Error('Aceite os termos de afiliados antes de configurar ou testar o automatizador.');
  }
}

function ensureAffiliateAccountPayload(payload = {}, existingAccount = null) {
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

function isAmazonShortenerGloballyEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.URL_SHORTENER_ENABLED ?? '').trim().toLowerCase()
  );
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
    mediaSourceMode: String(payload.mediaSourceMode ?? 'telegram_media').trim().toLowerCase() === 'product_image'
      ? 'product_image'
      : 'telegram_media',
    preserveOriginalTextEnabled: true,
    isActive: true,
    destinations: []
  };
}

async function ensureAffiliateAutomationPayload({ user, runtime, affiliateState, payload }) {
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

async function ensureTelegramSourceIsNotUsedByAffiliate(userId, telegramChannel) {
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

function ensureAffiliateSourceIsNotUsedByTelegram(telegramChannel, affiliateSourceGroupId, options = {}) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);
  const normalizedAffiliateSource = normalizeRouteSourceId(affiliateSourceGroupId);

  if (normalizedTelegramChannel && normalizedAffiliateSource && normalizedTelegramChannel === normalizedAffiliateSource) {
    if (options.allowReplacement) {
      return;
    }

    throw new Error('Este grupo já está configurado no fluxo Telegram normal. Escolha outra origem para Afiliados ou remova a origem na aba Telegram.');
  }
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

export function summarizeDeliveryHealth(runtimeSnapshots = []) {
  const totals = runtimeSnapshots.reduce((aggregate, runtime) => {
    aggregate.queued += Number(runtime?.deliveryQueue?.queuedCount || 0);
    aggregate.pendingTelegram += Number(runtime?.pendingTelegramCount || 0);
    aggregate.fatalFailures += Number(runtime?.deliveryStats?.fatalFailures || 0);
    aggregate.transientFailures += Number(runtime?.deliveryStats?.transientFailures || 0);
    aggregate.skippedDuplicates += Number(runtime?.deliveryStats?.skippedDuplicates || 0);
    return aggregate;
  }, {
    queued: 0,
    pendingTelegram: 0,
    fatalFailures: 0,
    transientFailures: 0,
    skippedDuplicates: 0
  });
  const healthAlerts = [];

  if (totals.queued >= 30) {
    healthAlerts.push({
      level: 'warning',
      code: 'DELIVERY_QUEUE_HIGH',
      message: `Fila de envio alta (${totals.queued} itens aguardando).`
    });
  }

  if (totals.pendingTelegram >= 20) {
    healthAlerts.push({
      level: 'warning',
      code: 'TELEGRAM_PENDING_HIGH',
      message: `Mensagens pendentes do Telegram em alta (${totals.pendingTelegram}).`
    });
  }

  if (totals.fatalFailures > 0) {
    healthAlerts.push({
      level: 'critical',
      code: 'DELIVERY_FATAL_FAILURES',
      message: `Falhas fatais de entrega detectadas (${totals.fatalFailures}).`
    });
  }

  return {
    totals,
    healthAlerts
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

