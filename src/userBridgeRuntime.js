import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { CustomFile } from 'telegram/client/uploads.js';
import pkg from 'whatsapp-web.js';
import {
  appendActivityEvent,
  defaultActivity,
  loadActivityForUser,
  saveActivityForUser,
  upsertActivityOffer
} from './activityStore.js';
import {
  deleteAffiliateAutomationsForUser,
  getAffiliateState
} from './affiliate/affiliate-store.js';
import { normalizePostLayoutConfig } from './affiliate/post-layout-config.js';
import {
  prepareAffiliateChannelPayloads as buildAffiliateChannelPayloads,
  prepareAffiliateCleanPostLayoutPayload as buildAffiliateCleanPostLayoutPayload,
  prepareAffiliateProductImagePayload as buildAffiliateProductImagePayload,
  prepareAffiliateTelegramPayload as buildAffiliateTelegramPayload,
  prepareAffiliateWhatsAppPayload as buildAffiliateWhatsAppPayload
} from './services/affiliate/payloads.js';
import {
  ensureWorkspaceForUser,
  loadConfigForUser,
  saveConfigForUser
} from './configStore.js';
import {
  buildLogLines,
  buildRuntimeState,
  buildSupervisorSnapshot
} from './runtime/state.js';
import {
  getDeliveryReceiptsPath as getWhatsAppDeliveryReceiptsPath,
  hasRecentDelivery as hasRecentWhatsAppDelivery,
  loadDeliveryReceipts as loadWhatsAppDeliveryReceipts,
  markRecentDelivery as markRecentWhatsAppDelivery,
  persistDeliveryReceipts as persistWhatsAppDeliveryReceipts,
  pruneRecentDeliveryReceipts as pruneRecentWhatsAppDeliveryReceipts
} from './services/whatsapp/deliveryReceipts.js';
import {
  forwardPreparedMessagesToWhatsAppGroups,
  sendAffiliateMessageToWhatsAppGroups as deliverAffiliateMessageToWhatsAppGroups
} from './services/whatsapp/delivery.js';
import {
  downloadTelegramBotMedia,
  downloadTelegramUserMedia as downloadTelegramUserMediaPayload,
  prepareWhatsAppPayload as prepareTelegramWhatsAppPayload,
  prepareWhatsAppPayloadFromTelegramUser as prepareTelegramUserWhatsAppPayload
} from './services/telegram/whatsAppPayload.js';
import {
  buildTelegramAuthErrorMessage as buildTelegramUserAuthErrorMessage,
  completeTelegramUserAuth as completeTelegramUserSessionAuth,
  createTelegramUserClient as createTelegramUserSessionClient,
  disconnectTelegramUser as disconnectTelegramUserSession,
  normalizeTelegramPhone as normalizeTelegramUserPhone,
  refreshTelegramAvailableChats as refreshTelegramUserAvailableChats,
  sendTelegramUserCode as sendTelegramUserSessionCode,
  startTelegram as startTelegramSession,
  startTelegramUser as startTelegramUserSession,
  stopTelegramTransport as stopTelegramSessionTransport
} from './services/telegram/session.js';
import {
  maybeProcessAffiliateAutomation as processTelegramAffiliateAutomation,
  routeTelegramMessage as routeIncomingTelegramMessage,
  routeTelegramUserMessage as routeIncomingTelegramUserMessage
} from './services/telegram/routing.js';
import {
  fetchGroupSummaries as fetchWhatsAppGroupSummaries,
  getGroupsPage as getWhatsAppGroupsPage,
  hydrateGroupCache as hydrateWhatsAppGroupCache,
  isGroupCacheStale as isWhatsAppGroupCacheStale,
  performAvailableGroupsRefresh as performWhatsAppGroupsRefresh,
  persistGroupCache as persistWhatsAppGroupCache,
  refreshAvailableGroups as refreshWhatsAppGroups
} from './services/whatsapp/groups.js';
import { createBaileysWhatsAppClient } from './services/whatsapp/baileysClient.js';
import { WhatsAppDeliveryQueue } from './whatsAppDeliveryQueue.js';

const { Client, LocalAuth } = pkg;
const whatsAppProvider = normalizeWhatsAppProvider(process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_ENGINE || 'baileys');
const albumFlushDelayMs = 1800;
const pendingTelegramMessageLimit = 60;
const pendingTelegramMessageTtlMs = 5 * 60 * 1000;
const groupAdminCheckBatchSize = parseBoundedInteger(process.env.WHATSAPP_GROUP_ADMIN_CHECK_BATCH_SIZE, 12, 1, 100);
const groupCacheMaxAgeMs = parseBoundedTimeout(
  process.env.WHATSAPP_GROUP_CACHE_MAX_AGE_MS,
  30 * 60 * 1000,
  60 * 1000,
  24 * 60 * 60 * 1000
);
const whatsAppGroupsWarmupMs = parseBoundedTimeout(
  process.env.WHATSAPP_GROUPS_WARMUP_MS,
  45 * 1000,
  5 * 1000,
  5 * 60 * 1000
);
const whatsAppAutoRefreshGroupsOnReady = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.WHATSAPP_AUTO_REFRESH_GROUPS_ON_READY ?? 'false').trim().toLowerCase()
);
const whatsAppProgressiveAdminCheck = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_PROGRESSIVE_ADMIN_CHECK ?? 'true').trim().toLowerCase()
);
const deliveryReceiptTtlMs = 6 * 60 * 60 * 1000;
const maxRecentDeliveryReceipts = 4000;
const deliveryReceiptsFilename = 'delivery-receipts.json';
const ogImageFetchTimeoutMs = 7000;
const ogImageMaxBytes = 3 * 1024 * 1024;
const postLayoutRenderTimeoutMs = parseBoundedTimeout(
  process.env.POST_LAYOUT_RENDER_TIMEOUT_MS,
  6500,
  1000,
  30000
);
const postLayoutCacheTtlMs = parseBoundedTimeout(
  process.env.POST_LAYOUT_CACHE_TTL_MS,
  10 * 60 * 1000,
  30 * 1000,
  60 * 60 * 1000
);
const postLayoutCacheMaxEntries = parseBoundedInteger(
  process.env.POST_LAYOUT_CACHE_MAX_ENTRIES,
  160,
  10,
  5000
);
const postLayoutMaxGenerationsPerMinute = parseBoundedInteger(
  process.env.POST_LAYOUT_MAX_GENERATIONS_PER_MINUTE,
  24,
  1,
  1000
);
const modernChromeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const socialPreviewUserAgents = [
  'WhatsApp/2.24.0 N',
  'TelegramBot (like TwitterBot)',
  'Twitterbot/1.0',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
];
const defaultWhatsAppHeadless = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_HEADLESS ?? 'true').trim().toLowerCase()
);
const defaultWhatsAppProtocolTimeoutMs = parseProtocolTimeout(
  process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS,
  10 * 60 * 1000
);
const whatsAppAuthTimeoutMs = parseBoundedTimeout(
  process.env.WHATSAPP_AUTH_TIMEOUT_MS,
  45 * 1000,
  15 * 1000,
  5 * 60 * 1000
);
const whatsAppQrMaxRetries = parseBoundedInteger(process.env.WHATSAPP_QR_MAX_RETRIES, 8, 0, 50);
const whatsAppTakeoverOnConflict = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_TAKEOVER_ON_CONFLICT ?? 'true').trim().toLowerCase()
);
const whatsAppTakeoverTimeoutMs = parseBoundedTimeout(
  process.env.WHATSAPP_TAKEOVER_TIMEOUT_MS,
  5 * 1000,
  0,
  60 * 1000
);
const whatsAppStartupWatchdogMs = parseProtocolTimeout(
  process.env.WHATSAPP_STARTUP_WATCHDOG_MS,
  75 * 1000
);
const whatsAppDestroyTimeoutMs = parseBoundedTimeout(
  process.env.WHATSAPP_DESTROY_TIMEOUT_MS,
  15 * 1000,
  5 * 1000,
  2 * 60 * 1000
);
const whatsAppForceCloseTimeoutMs = parseBoundedTimeout(
  process.env.WHATSAPP_FORCE_CLOSE_TIMEOUT_MS,
  3500,
  1000,
  30 * 1000
);
const backgroundBrowserArgs = defaultWhatsAppHeadless
  ? ['--disable-gpu', '--mute-audio', '--hide-scrollbars', '--window-size=1280,900']
  : process.platform === 'win32'
    ? [
        '--start-minimized',
        '--window-position=-2400,0',
        '--window-size=1280,900',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion'
      ]
    : ['--start-minimized'];

function isWhatsAppOperationalStatus(value) {
  return ['authenticated', 'ready'].includes(String(value ?? '').trim().toLowerCase());
}

export class UserBridgeRuntime {
  constructor(options = {}) {
    this.userId = String(options.userId ?? '').trim();
    this.paths = null;
    this.config = null;
    this.activity = structuredClone(defaultActivity);
    this.logs = [];
    this.qrDataUrl = null;
    this.whatsAppClient = null;
    this.whatsAppProvider = whatsAppProvider;
    this.whatsAppStatus = 'starting';
    this.whatsAppPhone = null;
    this.availableGroups = [];
    this.telegramClient = null;
    this.telegramMessageHandler = null;
    this.telegramAvailableChats = [];
    this.telegramUserProfile = null;
    this.telegramAuthFlow = null;
    this.telegramStatus = 'not_configured';
    this.albumBuffers = new Map();
    this.whatsAppIssue = null;
    this.whatsAppReadyAt = 0;
    this.whatsAppReconnectInProgress = false;
    this.whatsAppResetInProgress = false;
    this.isRefreshingGroups = false;
    this.pendingTelegramMessages = [];
    this.isFlushingPendingTelegramMessages = false;
    this.whatsAppDeliveryQueue = new WhatsAppDeliveryQueue({ userId: this.userId });
    this.whatsAppAutoReconnectTimeout = null;
    this.whatsAppStartupWatchdogTimeout = null;
    this.whatsAppRestartAttempts = 0;
    this.whatsAppRestartTimeout = null;
    this.whatsAppSessionToken = 0;
    this.whatsAppStartPromise = null;
    this.groupDiagnostics = {
      totalGroupsSeen: 0,
      groupsWithAdminMatch: 0,
      sample: []
    };
    this.groupRefreshProgress = {
      phase: 'idle',
      total: 0,
      processed: 0,
      percent: 0,
      foundAdmins: 0
    };
    this.groupCacheRefreshedAt = '';
    this.groupRefreshPromise = null;
    this.groupAdminVerificationPromise = null;
    this.persistActivityPromise = Promise.resolve();
    this.recentDeliveryReceipts = new Map();
    this.deliveryStats = {
      skippedDuplicates: 0,
      transientFailures: 0,
      fatalFailures: 0
    };
    this.persistDeliveryReceiptsPromise = Promise.resolve();
    this.lastWhatsAppRecoveryAttemptAt = 0;
    this.postLayoutRenderCache = new Map();
    this.postLayoutGenerationWindow = {
      startedAt: 0,
      count: 0
    };
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.paths = await ensureWorkspaceForUser(this.userId);
    this.config = await loadConfigForUser(this.userId);
    this.activity = await loadActivityForUser(this.userId);
    await this.loadDeliveryReceipts();
    this.logs = buildLogLines(this.activity.events).slice(0, 80);
    this.hydrateGroupCache();
    this.startWhatsApp().catch((error) => {
      this.whatsAppStatus = 'error';
      this.log(`Falha ao iniciar o WhatsApp: ${error.message}`, {
        level: 'error',
        type: 'whatsapp_error',
        increments: { errors: 1 }
      });
    });
    await this.startTelegram();
    this.initialized = true;
  }

  async getState() {
    return buildRuntimeState(this);
  }

  getSupervisorSnapshot() {
    return buildSupervisorSnapshot(this);
  }

  getTelegramMode() {
    return 'user';
  }

  async updateSettings({
    telegramMode,
    telegramBotToken,
    telegramApiId,
    telegramApiHash,
    telegramPhone,
    telegramChannel
  }) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      telegramMode: 'user',
      telegramBotToken: '',
      telegramApiId,
      telegramApiHash,
      telegramPhone,
      telegramChannel
    });

    await this.startTelegram();
  }

  async updateGroups(selectedGroupIds) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      selectedGroupIds
    });

    this.log(`Grupos selecionados atualizados (${selectedGroupIds.length}).`);
  }

  async updatePostLayout(postLayout) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      postLayout: normalizePostLayoutConfig(postLayout)
    });

    this.log('Layout de postagem atualizado pelo painel.');
  }

  async clearDashboardView() {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      dashboardViewClearedAt: new Date().toISOString()
    });
  }

  async updatePower(bridgeEnabled) {
    if (bridgeEnabled) {
      await this.ensureCanEnableBridge();
    }

    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      bridgeEnabled
    });

    this.log(`Sistema ${bridgeEnabled ? 'ligado' : 'desligado'} pelo painel.`);
  }

  canEnableBridge() {
    return this.telegramStatus === 'listening' && isWhatsAppOperationalStatus(this.whatsAppStatus);
  }

  async getOperationalFlowState() {
    const affiliateState = await getAffiliateState(this.userId);
    const activeAffiliateAutomation =
      (affiliateState?.automations || []).find((automation) => automation.isActive) || null;
    const configuredAffiliateAutomation =
      (affiliateState?.automations || []).find((automation) =>
        String(automation?.telegramSourceGroupId || '').trim()
      ) || null;
    const operationalSource = String(
      activeAffiliateAutomation?.telegramSourceGroupId ||
        this.config.telegramChannel ||
        configuredAffiliateAutomation?.telegramSourceGroupId ||
        ''
    ).trim();
    const destinationCount = Array.isArray(this.config.selectedGroupIds)
      ? this.config.selectedGroupIds.length
      : 0;

    return {
      hasTelegramReady: this.telegramStatus === 'listening',
      hasWhatsAppReady: isWhatsAppOperationalStatus(this.whatsAppStatus),
      hasOperationalSource: Boolean(operationalSource),
      hasDestination: destinationCount > 0
    };
  }

  async ensureCanEnableBridge() {
    const flowState = await this.getOperationalFlowState();

    if (!flowState.hasTelegramReady) {
      throw new Error('Conecte e conclua o login no Telegram antes de ligar o sistema.');
    }
    if (!flowState.hasWhatsAppReady) {
      throw new Error('Conecte o WhatsApp e aguarde o status ficar pronto antes de ligar o sistema.');
    }
    if (!flowState.hasOperationalSource) {
      throw new Error('Escolha e salve uma origem no fluxo ativo antes de ligar o sistema.');
    }
    if (!flowState.hasDestination) {
      throw new Error('Escolha ao menos um destino do WhatsApp antes de ligar o sistema.');
    }
  }

  resolveWhatsAppTargetGroupIds(selectedGroupIds = this.config.selectedGroupIds) {
    const selectedIds = Array.isArray(selectedGroupIds) ? selectedGroupIds : [];
    const groupsById = new Map(this.availableGroups.map((group) => [group.id, group]));
    const resolved = new Set();

    for (const selectedId of selectedIds) {
      const group = groupsById.get(selectedId);

      if (group?.isCommunityLinked && !group?.isAnnouncement) {
        const linkedAnnouncements = this.availableGroups.filter(
          (candidate) => candidate.isAnnouncement && candidate.parentGroupId === group.id
        );

        if (linkedAnnouncements.length > 0) {
          for (const announcement of linkedAnnouncements) {
            resolved.add(announcement.id);
          }
          continue;
        }
      }

      resolved.add(selectedId);
    }

    return [...resolved];
  }

  async resetAllConnections() {
    this.telegramAuthFlow = null;
    this.pendingTelegramMessages = [];
    this.isFlushingPendingTelegramMessages = false;

    if (this.telegramClient) {
      try {
        await this.telegramClient.logOut();
      } catch {}
    }

    await this.stopTelegramTransport();
    this.telegramAvailableChats = [];
    this.telegramUserProfile = null;
    this.telegramStatus = 'not_configured';

    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      telegramBotToken: '',
      telegramApiId: '',
      telegramApiHash: '',
      telegramPhone: '',
      telegramSession: '',
      telegramChannel: '',
      selectedGroupIds: [],
      bridgeEnabled: false
    });

    await deleteAffiliateAutomationsForUser(this.userId);

    this.log('Conexões do Telegram removidas e configuração da ponte reiniciada.', {
      type: 'connections_reset'
    });

    await this.resetWhatsAppSession();
    this.log('Reset completo concluído. O usuário pode conectar tudo novamente do zero.', {
      type: 'connections_reset_complete'
    });
  }

  async reconnectWhatsApp() {
    if (this.whatsAppReconnectInProgress || this.whatsAppResetInProgress) {
      return;
    }

    this.whatsAppReconnectInProgress = true;
    this.clearWhatsAppRestart();
    this.clearWhatsAppAutoReconnect();
    this.whatsAppIssue = null;
    this.whatsAppStatus = 'reconnecting';
    this.qrDataUrl = null;

    try {
      this.log('Reconectando a sessão do WhatsApp...', {
        type: 'whatsapp_reconnect_started'
      });
      await this.startWhatsApp();
    } finally {
      this.whatsAppReconnectInProgress = false;
    }
  }

  log(message, options = {}) {
    const timestamp = new Date().toISOString();
    this.activity = appendActivityEvent(this.activity, {
      at: timestamp,
      message,
      level: options.level || 'info',
      type: options.type || 'system',
      metadata: options.metadata || {},
      increments: options.increments || {}
    });
    this.syncActivityArtifacts();
    const line = `[${new Date().toLocaleString('pt-BR')}] ${message}`;
    console.log(`[bridge:${this.userId}] ${line}`);
  }

  syncActivityArtifacts() {
    this.logs = buildLogLines(this.activity.events).slice(0, 80);
    this.pruneRecentDeliveryReceipts();
    this.persistActivity().catch((error) => {
      console.error(`[bridge:${this.userId}] Falha ao persistir atividade: ${error.message}`);
    });
  }

  pruneRecentDeliveryReceipts() {
    pruneRecentWhatsAppDeliveryReceipts(this, {
      deliveryReceiptTtlMs,
      maxRecentDeliveryReceipts,
      deliveryReceiptsFilename
    });
  }

  hasRecentDelivery(deliveryKey) {
    return hasRecentWhatsAppDelivery(this, deliveryKey, { deliveryReceiptTtlMs });
  }

  markRecentDelivery(deliveryKey) {
    markRecentWhatsAppDelivery(this, deliveryKey, {
      deliveryReceiptTtlMs,
      maxRecentDeliveryReceipts,
      deliveryReceiptsFilename
    });
  }

  getDeliveryReceiptsPath() {
    return getWhatsAppDeliveryReceiptsPath(this, { deliveryReceiptsFilename });
  }

  async loadDeliveryReceipts() {
    await loadWhatsAppDeliveryReceipts(this, {
      deliveryReceiptTtlMs,
      maxRecentDeliveryReceipts,
      deliveryReceiptsFilename
    });
  }

  async persistDeliveryReceipts() {
    return await persistWhatsAppDeliveryReceipts(this, { deliveryReceiptsFilename });
  }

  upsertOffer(messages, offer = {}) {
    const baseOffer = buildOfferSnapshot(messages, {
      groupCount: this.resolveWhatsAppTargetGroupIds().length
    });
    const nextOffer = {
      ...baseOffer,
      ...offer,
      lastUpdatedAt: offer.lastUpdatedAt || new Date().toISOString()
    };
    const offerMetadata = {
      ...(baseOffer.metadata && typeof baseOffer.metadata === 'object' ? baseOffer.metadata : {}),
      ...(offer.metadata && typeof offer.metadata === 'object' ? offer.metadata : {})
    };

    if (!offerMetadata.channels) {
      offerMetadata.channels = buildOfferChannelStatus(nextOffer);
    }

    this.activity = upsertActivityOffer(this.activity, {
      ...nextOffer,
      metadata: offerMetadata
    });
    this.syncActivityArtifacts();
  }

  async startWhatsApp() {
    if (this.whatsAppStartPromise) {
      return this.whatsAppStartPromise;
    }

    const startPromise = this.createWhatsAppClient();
    this.whatsAppStartPromise = startPromise;

    try {
      await startPromise;
    } finally {
      if (this.whatsAppStartPromise === startPromise) {
        this.whatsAppStartPromise = null;
      }
    }
  }

  async createWhatsAppClient() {
    const sessionToken = this.whatsAppSessionToken + 1;
    this.whatsAppSessionToken = sessionToken;
    await this.stopWhatsAppClient({ invalidatePending: false });

    if (this.whatsAppSessionToken !== sessionToken) {
      return;
    }

    this.whatsAppStatus = 'connecting';
    this.whatsAppIssue = null;
    this.scheduleWhatsAppStartupWatchdog('inicializacao');
    const client = await this.createWhatsAppProviderClient();

    this.whatsAppClient = client;
    const isCurrent = () => this.isCurrentWhatsAppClient(client, sessionToken);

    client.on('qr', async (qr) => {
      let qrDataUrl;
      try {
        qrDataUrl = await QRCode.toDataURL(qr);
      } catch (error) {
        if (isCurrent()) {
          this.log(`Falha ao gerar QR Code do WhatsApp: ${error.message}`, {
            level: 'error',
            type: 'whatsapp_qr_error',
            increments: { errors: 1 }
          });
        }
        return;
      }

      if (!isCurrent()) {
        return;
      }

      this.qrDataUrl = qrDataUrl;
      this.whatsAppStatus = 'qr_required';
      this.whatsAppIssue = null;
      this.whatsAppReadyAt = 0;
      this.clearWhatsAppStartupWatchdog();
      this.whatsAppPhone = null;
      this.log('Escaneie o QR Code do WhatsApp no painel.', {
        type: 'whatsapp_qr'
      });
    });

    client.on('authenticated', () => {
      if (!isCurrent()) {
        return;
      }

      this.whatsAppStatus = 'authenticated';
      this.whatsAppRestartAttempts = 0;
      this.whatsAppIssue = null;
      this.attachWhatsAppBrowserLifecycle(client, sessionToken);
      this.log('WhatsApp autenticado.', {
        type: 'whatsapp_authenticated'
      });
    });

    client.on('ready', async () => {
      if (!isCurrent()) {
        return;
      }

      this.qrDataUrl = null;
      this.whatsAppStatus = 'ready';
      this.whatsAppReadyAt = Date.now();
      this.whatsAppRestartAttempts = 0;
      this.whatsAppIssue = null;
      this.clearWhatsAppStartupWatchdog();
      this.clearWhatsAppRestart();
      this.clearWhatsAppAutoReconnect();
      this.attachWhatsAppBrowserLifecycle(client, sessionToken);
      this.whatsAppPhone = serializeWid(client.info?.wid);
      this.log(`WhatsApp pronto (${this.whatsAppPhone ?? 'sessão ativa'}).`, {
        type: 'whatsapp_ready'
      });
      void this.flushPendingTelegramMessages().catch((error) => {
        this.log(`Falha ao processar a fila de mensagens pendentes: ${error.message}`, {
          level: 'error',
          type: 'pending_forward_error',
          increments: { errors: 1 }
        });
      });
      if (!whatsAppAutoRefreshGroupsOnReady) {
        this.log('Auto-atualizacao de grupos apos login desativada. Use "Atualizar grupos" quando quiser sincronizar.', {
          type: 'groups_auto_refresh_disabled'
        });
      } else {
        setTimeout(() => {
          if (!isCurrent()) {
            return;
          }

          // Skip auto-refresh if cache is fresh (< groupCacheMaxAgeMs)
          if (this.availableGroups.length > 0 && !this.isGroupCacheStale()) {
            this.log(`Cache de grupos reutilizado (${this.availableGroups.length} grupos, atualizado em ${this.groupCacheRefreshedAt}).`, {
              type: 'groups_cache_reused'
            });
            return;
          }

          this.refreshAvailableGroups({
            waitForCompletion: false,
            skipWarmupCheck: true
          }).catch((error) => {
            this.log(`Falha ao atualizar grupos apos login: ${error.message}`, {
              level: 'error',
              type: 'whatsapp_groups_error',
              increments: { errors: 1 }
            });
          });
        }, Math.max(1500, whatsAppGroupsWarmupMs));
      }
    });

    client.on('auth_failure', (message) => {
      if (!isCurrent()) {
        return;
      }

      this.whatsAppStatus = 'auth_failure';
      this.whatsAppReadyAt = 0;
      this.whatsAppIssue = {
        status: 'auth_failure',
        canResetSession: true,
        type: 'whatsapp_auth_failure',
        message:
          'A sessão salva do WhatsApp falhou na autenticação. Use "Resetar sessão do WhatsApp" para gerar um novo QR Code.',
        metadata: {
          originalError: String(message ?? '')
        }
      };
      this.clearWhatsAppStartupWatchdog();
      this.clearWhatsAppRestart();
      this.clearWhatsAppAutoReconnect();
      this.log(`Falha na autenticação do WhatsApp: ${message}`, {
        level: 'error',
        type: 'whatsapp_auth_failure',
        increments: { errors: 1 }
      });
      void this.stopWhatsAppClient({
        client,
        invalidatePending: false,
        settleDelayMs: 0
      }).catch(() => {});
    });

    client.on('disconnected', (reason) => {
      if (!isCurrent()) {
        return;
      }

      this.whatsAppStatus = 'disconnected';
      this.whatsAppReadyAt = 0;
      this.whatsAppIssue = null;
      this.clearWhatsAppStartupWatchdog();
      this.log(`WhatsApp desconectado: ${reason}`, {
        type: 'whatsapp_disconnected'
      });
      this.scheduleWhatsAppRestart(`desconexao: ${reason}`);
    });

    client.initialize().catch((error) => {
      if (!isCurrent()) {
        return;
      }

      void this.handleWhatsAppInitFailure(error, client, sessionToken);
    });
  }

  async createWhatsAppProviderClient() {
    if (this.whatsAppProvider === 'baileys') {
      this.log('Inicializando WhatsApp com Baileys (sem Chromium).', {
        type: 'whatsapp_provider_start',
        metadata: {
          provider: this.whatsAppProvider
        }
      });
      return await createBaileysWhatsAppClient({
        authDir: this.paths.baileysAuthSessionDir,
        defaultQueryTimeoutMs: defaultWhatsAppProtocolTimeoutMs
      });
    }

    return new Client({
      authStrategy: new LocalAuth({
        clientId: this.paths.authClientId,
        dataPath: this.paths.authRootDir
      }),
      authTimeoutMs: whatsAppAuthTimeoutMs,
      qrMaxRetries: whatsAppQrMaxRetries,
      takeoverOnConflict: whatsAppTakeoverOnConflict,
      takeoverTimeoutMs: whatsAppTakeoverTimeoutMs,
      userAgent: modernChromeUserAgent,
      puppeteer: {
        headless: defaultWhatsAppHeadless,
        protocolTimeout: defaultWhatsAppProtocolTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          ...backgroundBrowserArgs
        ]
      }
    });
  }

  isCurrentWhatsAppClient(client, sessionToken = this.whatsAppSessionToken) {
    return this.whatsAppClient === client && this.whatsAppSessionToken === sessionToken;
  }

  async handleWhatsAppInitFailure(error, client = this.whatsAppClient, sessionToken = this.whatsAppSessionToken) {
    if (!this.isCurrentWhatsAppClient(client, sessionToken)) {
      return;
    }

    const issue = await this.inspectWhatsAppIssue(error, client, sessionToken);

    if (!this.isCurrentWhatsAppClient(client, sessionToken)) {
      return;
    }

    if (issue) {
      this.whatsAppStatus = issue.status;
      this.whatsAppIssue = issue;
      this.clearWhatsAppStartupWatchdog();
      this.clearWhatsAppRestart();
      this.log(issue.message, {
        level: 'error',
        type: issue.type,
        increments: { errors: 1 },
        metadata: issue.metadata
      });
      return;
    }

    this.whatsAppStatus = 'error';
    this.whatsAppIssue = null;
    this.clearWhatsAppStartupWatchdog();
    const errorMessage = getErrorMessage(error);
    this.log(`Falha na inicializacao do WhatsApp: ${errorMessage}`, {
      level: 'error',
      type: 'whatsapp_init_error',
      increments: { errors: 1 }
    });
    this.scheduleWhatsAppRestart(errorMessage);
  }

  async resetWhatsAppSession() {
    if (this.whatsAppResetInProgress) {
      return;
    }

    const providerSessionDir = this.getWhatsAppProviderSessionDir();

    if (!isPathInside(providerSessionDir, this.paths.authRootDir)) {
      throw new Error('Diretório de sessão fora do escopo permitido.');
    }

    this.whatsAppResetInProgress = true;
    this.clearWhatsAppRestart();
    this.clearWhatsAppAutoReconnect();
    this.clearWhatsAppStartupWatchdog();
    this.whatsAppStatus = 'resetting';
    this.whatsAppReadyAt = 0;
    this.whatsAppIssue = null;
    this.qrDataUrl = null;
    this.whatsAppPhone = null;
    this.availableGroups = [];
    this.groupCacheRefreshedAt = '';
    await this.persistGroupCache([], null, '');

    try {
      await this.stopWhatsAppClient();

      if (await pathExists(providerSessionDir)) {
        const backupPath = buildSessionBackupPath(providerSessionDir);
        await fs.rename(providerSessionDir, backupPath);
        this.log('Sessão anterior do WhatsApp movida para backup. Um novo QR Code será gerado.', {
          type: 'whatsapp_session_reset',
          metadata: {
            backupPath,
            provider: this.whatsAppProvider
          }
        });
      } else {
        this.log('Preparando uma nova sessão do WhatsApp. Um novo QR Code será gerado.', {
          type: 'whatsapp_session_reset',
          metadata: {
            provider: this.whatsAppProvider
          }
        });
      }

      await this.startWhatsApp();
    } finally {
      this.whatsAppResetInProgress = false;
    }
  }

  async stopWhatsAppClient(options = {}) {
    const {
      client: requestedClient = null,
      invalidatePending = true,
      settleDelayMs = 500
    } = options;

    if (invalidatePending) {
      this.whatsAppSessionToken += 1;
      this.whatsAppStartPromise = null;
    }

    const client = requestedClient ?? this.whatsAppClient;
    this.clearWhatsAppStartupWatchdog();

    if (!client) {
      return;
    }

    if (this.whatsAppClient === client) {
      this.whatsAppClient = null;
    }
    client.removeAllListeners();
    await this.destroyWhatsAppClient(client);

    if (settleDelayMs > 0) {
      await wait(settleDelayMs);
    }
  }

  async destroyWhatsAppClient(client) {
    if (this.whatsAppProvider === 'baileys' || client?.provider === 'baileys') {
      await withTimeout(client.destroy().catch(() => {}), whatsAppDestroyTimeoutMs).catch(() => {});
      return;
    }

    const browser = client?.pupBrowser;

    await withTimeout(client.destroy().catch(() => {}), whatsAppDestroyTimeoutMs).catch(async (error) => {
      this.log(
        `Timeout ao encerrar a sessão travada do WhatsApp (${Math.round(
          whatsAppDestroyTimeoutMs / 1000
        )}s). Forcando nova tentativa de conexão.`,
        {
          level: 'error',
          type: 'whatsapp_destroy_timeout',
          increments: { errors: 1 },
          metadata: {
            timeoutMs: whatsAppDestroyTimeoutMs,
            error: String(error?.message ?? error ?? '')
          }
        }
      );
      await this.forceCloseWhatsAppBrowser(client, browser);
    });

    client.pupPage = null;
    client.pupBrowser = null;
  }

  async forceCloseWhatsAppBrowser(client, browser = client?.pupBrowser) {
    const page = client?.pupPage;

    if (page && !page.isClosed?.()) {
      await withTimeout(page.close({ runBeforeUnload: false }), whatsAppForceCloseTimeoutMs).catch(() => {});
    }

    if (browser?.isConnected?.()) {
      await withTimeout(browser.close(), whatsAppForceCloseTimeoutMs).catch(() => {});
    }

    const browserProcess = browser?.process?.();
    if (browserProcess && !browserProcess.killed && browser?.isConnected?.()) {
      try {
        browserProcess.kill('SIGKILL');
      } catch {
        try {
          browserProcess.kill();
        } catch {
          // Ignore process kill errors; the next connection will use a fresh browser.
        }
      }
    }
  }

  async inspectWhatsAppIssue(error, client = this.whatsAppClient, sessionToken = this.whatsAppSessionToken) {
    if (!this.isCurrentWhatsAppClient(client, sessionToken)) {
      return null;
    }

    if (this.whatsAppProvider === 'baileys' || client?.provider === 'baileys') {
      return null;
    }

    const page = client?.pupPage;

    if (!page || page.isClosed?.()) {
      return null;
    }

    try {
      const snapshot = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        debugVersion: window.Debug?.VERSION ?? null,
        bodyText: document.body?.innerText?.slice(0, 1200) ?? '',
        hasStore: typeof window.Store !== 'undefined',
        hasAuthStore: typeof window.AuthStore !== 'undefined'
      }));

      if (isLikelyBrowserDatabaseError(snapshot.bodyText)) {
        return {
          status: 'session_error',
          canResetSession: true,
          type: 'whatsapp_session_corrupted',
          message:
            'A sessão salva do WhatsApp ficou corrompida no navegador. Clique em "Resetar sessão do WhatsApp" para gerar um novo QR Code.',
          metadata: {
            originalError: String(error?.message ?? error ?? ''),
            debugVersion: snapshot.debugVersion ?? '',
            url: snapshot.url ?? '',
            title: snapshot.title ?? ''
          }
        };
      }
    } catch (_inspectError) {
      return null;
    }

    return null;
  }

  async startTelegram() {
    await startTelegramSession(this);
  }

  async stopTelegramTransport() {
    await stopTelegramSessionTransport(this);
  }

  async startTelegramUser() {
    await startTelegramUserSession(this);
  }

  async routeTelegramMessage(updateType, message) {
    await routeIncomingTelegramMessage(this, updateType, message);
  }

  createTelegramUserClient(session = this.config.telegramSession || '') {
    return createTelegramUserSessionClient(this, session);
  }

  async updateWhatsAppLogoutBehavior(disconnectWhatsAppOnLogout) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      disconnectWhatsAppOnLogout: Boolean(disconnectWhatsAppOnLogout)
    });
  }

  async handleUserLogout() {
    if (!this.config.disconnectWhatsAppOnLogout) {
      return;
    }

    await this.resetWhatsAppSession();
  }

  async maybeRecoverWhatsAppOnLogin() {
    const now = Date.now();
    if (now - this.lastWhatsAppRecoveryAttemptAt < 30 * 1000) {
      return;
    }

    const normalizedStatus = String(this.whatsAppStatus || '').trim().toLowerCase();
    if (
      [
        'ready',
        'authenticated',
        'connecting',
        'qr_required',
        'reconnecting',
        'resetting',
        'auth_failure',
        'session_error'
      ].includes(normalizedStatus)
    ) {
      return;
    }

    this.lastWhatsAppRecoveryAttemptAt = now;

    try {
      await this.reconnectWhatsApp();
      this.log('Reconexao automatica do WhatsApp iniciada ao retomar sessão do painel.', {
        type: 'whatsapp_auto_reconnect'
      });
    } catch (error) {
      this.log(`Falha na reconexao automatica do WhatsApp ao retomar sessão: ${error.message}`, {
        level: 'error',
        type: 'whatsapp_auto_reconnect_error',
        increments: { errors: 1 }
      });
    }
  }

  normalizeTelegramPhone(phone) {
    return normalizeTelegramUserPhone(phone);
  }

  buildTelegramAuthErrorMessage(error, fallback = 'N?o foi poss?vel concluir a autentica??o do Telegram.') {
    return buildTelegramUserAuthErrorMessage(error, fallback);
  }

  async sendTelegramUserCode() {
    await sendTelegramUserSessionCode(this);
  }

  async completeTelegramUserAuth({ code, password }) {
    await completeTelegramUserSessionAuth(this, { code, password });
  }

  async disconnectTelegramUser() {
    await disconnectTelegramUserSession(this);
  }

  async refreshTelegramAvailableChats() {
    await refreshTelegramUserAvailableChats(this);
  }

  async routeTelegramUserMessage(event) {
    await routeIncomingTelegramUserMessage(this, event);
  }

  async maybeProcessAffiliateAutomation({ sourceGroupId, sourceGroupName, telegramMessageId, messageText, telegramMessage }) {
    return await processTelegramAffiliateAutomation(this, {
      sourceGroupId,
      sourceGroupName,
      telegramMessageId,
      messageText,
      telegramMessage
    });
  }

  async prepareAffiliateChannelPayloads({ originalMessageText, telegramMessage, automation, convertedUrls }) {
    return await buildAffiliateChannelPayloads(this, {
      originalMessageText,
      telegramMessage,
      automation,
      convertedUrls
    });
  }

  async prepareAffiliateWhatsAppPayload({ messageText, telegramMessage, automation, convertedUrls }) {
    return await buildAffiliateWhatsAppPayload(this, {
      messageText,
      telegramMessage,
      automation,
      convertedUrls
    });
  }

  async prepareAffiliateTelegramPayload({ messageText, telegramMessage, automation, convertedUrls }) {
    return await buildAffiliateTelegramPayload(this, {
      messageText,
      telegramMessage,
      automation,
      convertedUrls
    });
  }

  async prepareAffiliateProductImagePayload(messageText, convertedUrls = [], options = {}) {
    return await buildAffiliateProductImagePayload(this, messageText, convertedUrls, options);
  }

  async prepareAffiliateCleanPostLayoutPayload(messageText, convertedUrls = [], options = {}) {
    return await buildAffiliateCleanPostLayoutPayload(this, messageText, convertedUrls, options);
  }

  async fetchPreferredProductImageUrl(conversionItem = {}) {
    const metadata = await this.fetchPreferredProductMetadata(conversionItem);
    return metadata.imageUrl || '';
  }

  async fetchPreferredProductMetadata(conversionItem = {}) {
    const candidates = resolvePostLayoutMetadataUrls(conversionItem);

    for (const targetUrl of candidates) {
      const metadata = await this.fetchOpenGraphMetadata(targetUrl);
      if (metadata.imageUrl || metadata.title) {
        return metadata;
      }
    }

    return {
      imageUrl: '',
      title: ''
    };
  }

  async getPostLayoutSourceFallbackImageBuffer(telegramMessage, convertedUrls = []) {
    if (!telegramMessage || !Array.isArray(convertedUrls) || convertedUrls.length !== 1) {
      return null;
    }

    try {
      const originalPayload = await this.prepareWhatsAppPayload(telegramMessage);

      if (originalPayload?.type !== 'media' || !String(originalPayload.mimeType || '').toLowerCase().startsWith('image/')) {
        return null;
      }

      return Buffer.from(String(originalPayload.base64 || ''), 'base64');
    } catch {
      return null;
    }
  }

  reservePostLayoutGenerationSlot() {
    const now = Date.now();
    const windowStart = this.postLayoutGenerationWindow.startedAt || 0;
    const elapsed = now - windowStart;

    if (elapsed >= 60 * 1000) {
      this.postLayoutGenerationWindow.startedAt = now;
      this.postLayoutGenerationWindow.count = 0;
    }

    if (this.postLayoutGenerationWindow.count >= postLayoutMaxGenerationsPerMinute) {
      return false;
    }

    this.postLayoutGenerationWindow.count += 1;
    return true;
  }

  buildPostLayoutCacheKey({ messageText, converted, settings }) {
    const normalizedUrls = Array.isArray(converted)
      ? converted.map((item) => String(item?.affiliateUrl || '').trim()).filter(Boolean).join('|')
      : '';
    const signature = JSON.stringify({
      messageText: String(messageText || '').trim(),
      normalizedUrls,
      settings: {
        brandName: settings.brandName,
        headline: settings.headline,
        primaryColor: settings.primaryColor,
        accentColor: settings.accentColor,
        backgroundColor: settings.backgroundColor,
        textColor: settings.textColor,
        maxProducts: settings.maxProducts
      }
    });

    return crypto.createHash('sha1').update(signature).digest('hex');
  }

  getCachedPostLayoutPayload(cacheKey) {
    if (!cacheKey) {
      return null;
    }

    const entry = this.postLayoutRenderCache.get(cacheKey);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.postLayoutRenderCache.delete(cacheKey);
      return null;
    }

    return entry.payload;
  }

  setCachedPostLayoutPayload(cacheKey, payload) {
    if (!cacheKey || !payload?.base64 || !payload?.mimeType) {
      return;
    }

    this.postLayoutRenderCache.set(cacheKey, {
      expiresAt: Date.now() + postLayoutCacheTtlMs,
      payload
    });

    if (this.postLayoutRenderCache.size <= postLayoutCacheMaxEntries) {
      return;
    }

    const oldestKey = this.postLayoutRenderCache.keys().next().value;
    if (oldestKey) {
      this.postLayoutRenderCache.delete(oldestKey);
    }
  }

  async fetchOpenGraphMetadata(targetUrl) {
    const url = String(targetUrl ?? '').trim();

    if (!url) {
      return { imageUrl: '', title: '' };
    }

    const userAgents = resolveOpenGraphUserAgents(url);

    for (const userAgent of userAgents) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ogImageFetchTimeoutMs);
        let response;

        try {
          response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'user-agent': userAgent
            }
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response?.ok) {
          continue;
        }

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();

        if (!contentType.includes('text/html')) {
          continue;
        }

        const html = await response.text();
        const rawImageUrl = extractProductImageUrlFromHtml(html);
        const rawTitle = extractProductTitleFromHtml(html);
        const normalizedTitle = cleanPostLayoutTitle(rawTitle);

        if (!rawImageUrl && !normalizedTitle) {
          continue;
        }

        const resolved = rawImageUrl ? new URL(rawImageUrl, url).toString() : '';
        return {
          imageUrl: resolved || '',
          title: normalizedTitle || ''
        };
      } catch {
        continue;
      }
    }

    return { imageUrl: '', title: '' };
  }

  async downloadExternalImageAsMediaPayload(imageUrl, caption) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ogImageFetchTimeoutMs);

    try {
      const response = await fetch(imageUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': modernChromeUserAgent
        }
      });

      if (!response.ok) {
        return null;
      }

      const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

      if (!mimeType.startsWith('image/')) {
        return null;
      }

      const contentLength = Number(response.headers.get('content-length') || 0);

      if (Number.isFinite(contentLength) && contentLength > ogImageMaxBytes) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (!buffer.length || buffer.byteLength > ogImageMaxBytes) {
        return null;
      }

      return {
        type: 'media',
        base64: buffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg',
        filename: `affiliate-product-${Date.now()}.${inferImageExtension(mimeType)}`,
        caption
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendAffiliateMessageToWhatsAppGroups(whatsAppPayload, targetGroupIds, options = {}) {
    return await deliverAffiliateMessageToWhatsAppGroups(this, whatsAppPayload, targetGroupIds, options);
  }

  async sendAffiliateMessageToTelegramDestination(messageText, destinationId) {
    if (!this.telegramClient) {
      throw new Error('Cliente do Telegram indisponível.');
    }

    if (!destinationId) {
      throw new Error('Destino Telegram não configurado.');
    }

    if (messageText?.type === 'media' && messageText?.base64) {
      const mediaBuffer = Buffer.from(messageText.base64, 'base64');
      const mimeType = String(messageText.mimeType || '').toLowerCase();
      const isImage = mimeType.startsWith('image/');
      const fallbackImageName = `affiliate-image-${Date.now()}.${inferImageExtension(mimeType || 'image/jpeg')}`;
      const fallbackDocumentName = `affiliate-media-${Date.now()}`;
      const filename = String(messageText.filename || '').trim() || (isImage ? fallbackImageName : fallbackDocumentName);
      const uploadableMedia = new CustomFile(filename, mediaBuffer.length, '', mediaBuffer);
      await this.telegramClient.sendFile(destinationId, {
        file: uploadableMedia,
        caption: String(messageText.caption || ''),
        forceDocument: !isImage
      });
      return { destinationId };
    }

    const finalText = messageText?.type === 'text'
      ? String(messageText.text || '')
      : String(messageText || '');

    await this.telegramClient.sendMessage(destinationId, { message: finalText });
    return { destinationId };
  }

  async handleTelegramMessage(message, options = {}) {
    if (!this.config.bridgeEnabled) {
      this.upsertOffer([message], {
        status: 'ignored',
        reason: 'bridge_disabled',
        fromQueue: Boolean(options.fromQueue)
      });
      this.log('Mensagem recebida, mas o sistema está desligado. Encaminhamento ignorado.', {
        type: 'forward_skipped'
      });
      return;
    }

    if (!this.whatsAppClient || this.whatsAppStatus !== 'ready') {
      if (this.shouldQueueTelegramMessage()) {
        this.upsertOffer([message], {
          status: 'queued',
          reason: this.whatsAppStatus,
          fromQueue: Boolean(options.fromQueue)
        });
        this.enqueueTelegramMessages([message], {
          source: options.fromQueue ? 'retry' : 'live',
          reason: this.whatsAppStatus
        });
      } else {
        this.upsertOffer([message], {
          status: 'ignored',
          reason: this.whatsAppStatus,
          fromQueue: Boolean(options.fromQueue)
        });
        this.log('Post recebido, mas o WhatsApp ainda não está pronto.', {
          type: 'forward_skipped'
        });
      }
      return;
    }

    const targetGroupIds = this.resolveWhatsAppTargetGroupIds();

    if (targetGroupIds.length === 0) {
      this.upsertOffer([message], {
        status: 'ignored',
        reason: 'no_groups_selected',
        fromQueue: Boolean(options.fromQueue)
      });
      this.log('Post recebido, mas nenhum grupo do WhatsApp foi selecionado.', {
        type: 'forward_skipped'
      });
      return;
    }

    const mediaGroupId = message.media_group_id || message.rawMessage?.groupedId;

    if (mediaGroupId) {
      const key = String(mediaGroupId);
      const current = this.albumBuffers.get(key) ?? { items: [], timeout: null };

      current.items.push(message);
      clearTimeout(current.timeout);
      current.timeout = setTimeout(() => {
        this.flushAlbum(key).catch((error) => {
          this.log(`Falha ao encaminhar album ${key}: ${error.message}`, {
            level: 'error',
            type: 'forward_error',
            increments: { errors: 1 }
          });
        });
      }, albumFlushDelayMs);

      this.albumBuffers.set(key, current);
      this.upsertOffer(current.items, {
        id: buildTelegramOfferKey(current.items[0]),
        status: 'captured',
        fromQueue: Boolean(options.fromQueue),
        messageCount: current.items.length
      });
      return;
    }

    await this.forwardMessagesWithRecovery([message], {
      targetGroupIds,
      fromQueue: Boolean(options.fromQueue)
    });
  }

  async flushAlbum(key) {
    const bucket = this.albumBuffers.get(key);

    if (!bucket) {
      return;
    }

    this.albumBuffers.delete(key);
    const messages = [...bucket.items].sort(
      (left, right) => getTelegramMessageNumericId(left) - getTelegramMessageNumericId(right)
    );
    await this.forwardMessagesWithRecovery(messages, {
      targetGroupIds: this.resolveWhatsAppTargetGroupIds()
    });
  }

  shouldQueueTelegramMessage() {
    return new Set([
      'starting',
      'connecting',
      'authenticated',
      'reconnecting',
      'disconnected',
      'browser_closed',
      'qr_required',
      'error'
    ]).has(this.whatsAppStatus);
  }

  enqueueTelegramMessages(messages, options = {}) {
    const now = Date.now();
    let queuedCount = 0;

    this.dropExpiredPendingTelegramMessages();

    for (const message of messages) {
      const key = buildTelegramMessageKey(message);

      if (!key || this.pendingTelegramMessages.some((entry) => entry.key === key)) {
        continue;
      }

      this.pendingTelegramMessages.push({
        key,
        message,
        queuedAt: now,
        expiresAt: now + pendingTelegramMessageTtlMs
      });
      queuedCount += 1;
    }

    let droppedCount = 0;

    while (this.pendingTelegramMessages.length > pendingTelegramMessageLimit) {
      this.pendingTelegramMessages.shift();
      droppedCount += 1;
    }

    if (queuedCount > 0) {
      this.log(
        `WhatsApp indisponível no momento. ${queuedCount} mensagem(ns) ficou(aram) na fila temporária (${this.pendingTelegramMessages.length} aguardando).`,
        {
          type: 'forward_queued',
          metadata: {
            queuedCount,
            pendingCount: this.pendingTelegramMessages.length,
            reason: options.reason || this.whatsAppStatus,
            source: options.source || 'live',
            droppedCount
          }
        }
      );
    }

    if (droppedCount > 0) {
      this.log(
        `A fila temporaria do Telegram atingiu o limite. ${droppedCount} mensagem(ns) antiga(s) foi(foram) descartada(s).`,
        {
          level: 'error',
          type: 'forward_queue_trimmed',
          increments: { errors: 1 },
          metadata: {
            droppedCount,
            pendingCount: this.pendingTelegramMessages.length
          }
        }
      );
    }
  }

  dropExpiredPendingTelegramMessages() {
    const now = Date.now();
    const before = this.pendingTelegramMessages.length;
    this.pendingTelegramMessages = this.pendingTelegramMessages.filter(
      (entry) => entry.expiresAt > now
    );

    const expiredCount = before - this.pendingTelegramMessages.length;

    if (expiredCount > 0) {
      this.log(
        `${expiredCount} mensagem(ns) saiu(ram) da fila temporaria porque o WhatsApp demorou demais para voltar.`,
        {
          level: 'error',
          type: 'forward_queue_expired',
          increments: { errors: 1 },
          metadata: {
            expiredCount,
            pendingCount: this.pendingTelegramMessages.length
          }
        }
      );
    }
  }

  async flushPendingTelegramMessages() {
    if (
      this.isFlushingPendingTelegramMessages ||
      !this.whatsAppClient ||
      this.whatsAppStatus !== 'ready'
    ) {
      return;
    }

    this.dropExpiredPendingTelegramMessages();

    if (this.pendingTelegramMessages.length === 0) {
      return;
    }

    const pending = [...this.pendingTelegramMessages];
    this.pendingTelegramMessages = [];
    this.isFlushingPendingTelegramMessages = true;
    this.log(
      `WhatsApp voltou. Processando ${pending.length} mensagem(ns) que estava(m) aguardando na fila.`,
      {
        type: 'forward_queue_flushing',
        metadata: { pendingCount: pending.length }
      }
    );

    try {
      for (const entry of pending) {
        if (entry.expiresAt <= Date.now()) {
          continue;
        }

        await this.handleTelegramMessage(entry.message, { fromQueue: true });
      }
    } finally {
      this.isFlushingPendingTelegramMessages = false;
    }
  }

  async forwardMessagesWithRecovery(messages, options = {}) {
    try {
      await this.forwardMessages(messages, options);
    } catch (error) {
      if (isRecoverableWhatsAppTargetError(error)) {
        this.markWhatsAppBrowserClosed('encaminhar mensagem', error);
        this.upsertOffer(messages, {
          status: 'queued',
          reason: 'recoverable_target_error',
          fromQueue: Boolean(options.fromQueue)
        });
        this.enqueueTelegramMessages(messages, {
          source: 'forward',
          reason: 'recoverable_target_error'
        });
        return;
      }

      this.upsertOffer(messages, {
        status: 'failed',
        reason: error.message,
        fromQueue: Boolean(options.fromQueue)
      });
      throw error;
    }
  }

  async forwardMessages(messages, options = {}) {
    const prepared = [];
    const targetGroupIds = Array.isArray(options.targetGroupIds) && options.targetGroupIds.length
      ? options.targetGroupIds
      : this.resolveWhatsAppTargetGroupIds();

    for (const message of messages) {
      prepared.push({
        payload: await this.prepareWhatsAppPayload(message),
        sourceKey: buildTelegramMessageKey(message) || buildTelegramOfferKey(message)
      });
    }

    const delivery = await forwardPreparedMessagesToWhatsAppGroups(this, { prepared, targetGroupIds });

    if (delivery.failed.length > 0 && delivery.sent.length === 0) {
      throw new Error(
        `Falha em ${delivery.failed.length} entrega(s) do WhatsApp: ${delivery.failed
          .slice(0, 3)
          .map((failure) => `${failure.groupId}: ${failure.error}`)
          .join(' | ')}`
      );
    }

    if (delivery.failed.length > 0) {
      this.log(`Mensagem enviada parcialmente. ${delivery.failed.length} entrega(s) falharam${delivery.skipped?.length ? ` e ${delivery.skipped.length} duplicado(s) foram ignorado(s)` : ''}.`, {
        level: 'error',
        type: 'forward_partial_error',
        increments: { errors: delivery.failed.length },
        metadata: {
          failed: delivery.failed.slice(0, 6),
          skipped: delivery.skipped?.length || 0
        }
      });
    }

    const groupCount = targetGroupIds.length;
    this.upsertOffer(messages, {
      status: 'sent',
      groupCount,
      deliveryCount: delivery.sent.length,
      fromQueue: Boolean(options.fromQueue),
      reason: '',
      metadata: {
        channels: {
          telegram: {
            status: 'received',
            detail: 'Mensagem captada no Telegram.'
          },
          whatsapp: {
            status: delivery.failed.length > 0 ? 'partial' : 'sent',
            delivered: delivery.sent.length,
            failed: delivery.failed.length,
            skipped: delivery.skipped?.length || 0,
            targetGroups: groupCount
          }
        }
      }
    });
    this.log(`Mensagem do Telegram encaminhada para ${groupCount} grupo(s)${delivery.skipped?.length ? ` (${delivery.skipped.length} duplicado(s) ignorado(s))` : ''}.`, {
      type: 'forward_success',
      increments: {
        forwardBatches: 1,
        forwardedMessages: prepared.length,
        whatsAppDeliveries: delivery.sent.length
      },
      metadata: {
        groups: groupCount,
        messages: prepared.length,
        deliveries: delivery.sent.length,
        skipped: delivery.skipped?.length || 0
      }
    });
  }

  async prepareWhatsAppPayload(message) {
    return await prepareTelegramWhatsAppPayload(this, message);
  }

  async downloadTelegramMedia(fileId, metadata) {
    return await downloadTelegramBotMedia(this, fileId, metadata);
  }

  async prepareWhatsAppPayloadFromTelegramUser(message) {
    return await prepareTelegramUserWhatsAppPayload(message);
  }

  async downloadTelegramUserMedia(rawMessage, metadata) {
    return await downloadTelegramUserMediaPayload(rawMessage, metadata);
  }

  isGroupCacheStale() {
    return isWhatsAppGroupCacheStale(this, { groupCacheMaxAgeMs });
  }

  async downloadExternalImageBuffer(imageUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ogImageFetchTimeoutMs);

    try {
      const response = await fetch(imageUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': modernChromeUserAgent
        }
      });

      if (!response.ok) {
        return null;
      }

      const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

      if (!mimeType.startsWith('image/')) {
        return null;
      }

      const contentLength = Number(response.headers.get('content-length') || 0);

      if (Number.isFinite(contentLength) && contentLength > ogImageMaxBytes) {
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.length && buffer.byteLength <= ogImageMaxBytes ? buffer : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  getGroupsPage({ search = '', page = 1, pageSize = 50, filter = 'all' } = {}) {
    return getWhatsAppGroupsPage(this, { search, page, pageSize, filter }, { groupCacheMaxAgeMs });
  }

  async refreshAvailableGroups(options = {}) {
    await refreshWhatsAppGroups(this, options, {
      groupAdminCheckBatchSize,
      defaultWhatsAppProtocolTimeoutMs,
      whatsAppGroupsWarmupMs,
      progressiveAdminCheckEnabled: whatsAppProgressiveAdminCheck
    });
  }

  async performAvailableGroupsRefresh() {
    await performWhatsAppGroupsRefresh(this, {
      groupAdminCheckBatchSize,
      defaultWhatsAppProtocolTimeoutMs,
      whatsAppGroupsWarmupMs,
      progressiveAdminCheckEnabled: whatsAppProgressiveAdminCheck
    });
  }

  getWhatsAppGroupsWarmupRemainingMs() {
    const readyAt = Number(this.whatsAppReadyAt || 0);

    if (!readyAt) {
      return 0;
    }

    return Math.max(0, whatsAppGroupsWarmupMs - (Date.now() - readyAt));
  }

  async fetchGroupSummaries() {
    return await fetchWhatsAppGroupSummaries(this);
  }

  hydrateGroupCache() {
    hydrateWhatsAppGroupCache(this);
  }

  async persistGroupCache(groups, diagnostics, refreshedAt) {
    await persistWhatsAppGroupCache(this, groups, diagnostics, refreshedAt);
  }

  async persistActivity() {
    this.persistActivityPromise = this.persistActivityPromise
      .catch(() => {})
      .then(() => saveActivityForUser(this.userId, this.activity));

    return this.persistActivityPromise;
  }

  scheduleWhatsAppRestart(reason, options = {}) {
    if (
      this.whatsAppResetInProgress ||
      this.whatsAppStatus === 'session_error' ||
      this.whatsAppStatus === 'browser_closed'
    ) {
      return;
    }

    if (this.whatsAppRestartTimeout) {
      return;
    }

    if (this.whatsAppRestartAttempts >= 5) {
      this.log('O WhatsApp atingiu o limite de tentativas automaticas. Se continuar assim, reescaneie o QR Code.', {
        level: 'error',
        type: 'whatsapp_retry_exhausted',
        increments: { errors: 1 },
        metadata: { reason }
      });
      return;
    }

    const nextAttempt = this.whatsAppRestartAttempts + 1;
    const requestedDelayMs = Number(options.delayMs);
    const delayMs = Number.isFinite(requestedDelayMs)
      ? Math.max(0, requestedDelayMs)
      : Math.min(15000, 2000 + this.whatsAppRestartAttempts * 2500);
    this.whatsAppRestartAttempts = nextAttempt;
    this.log(
      `Tentando reconectar o WhatsApp automaticamente em ${Math.round(delayMs / 1000)}s (${nextAttempt}/5).`,
      {
        type: 'whatsapp_retry_scheduled',
        metadata: {
          reason,
          attempt: nextAttempt,
          delayMs
        }
      }
    );

    this.whatsAppRestartTimeout = setTimeout(() => {
      this.whatsAppRestartTimeout = null;
      this.startWhatsApp().catch((error) => {
        this.whatsAppStatus = 'error';
        this.log(`Falha ao reiniciar o WhatsApp: ${error.message}`, {
          level: 'error',
          type: 'whatsapp_restart_error',
          increments: { errors: 1 }
        });
        this.scheduleWhatsAppRestart(error.message);
      });
    }, delayMs);
  }

  clearWhatsAppRestart() {
    if (!this.whatsAppRestartTimeout) {
      return;
    }

    clearTimeout(this.whatsAppRestartTimeout);
    this.whatsAppRestartTimeout = null;
  }

  scheduleWhatsAppAutoReconnect(reason) {
    if (
      this.whatsAppResetInProgress ||
      this.whatsAppReconnectInProgress ||
      this.whatsAppAutoReconnectTimeout
    ) {
      return;
    }

    const delayMs = 1500;
    this.log(
      `A janela do WhatsApp foi fechada. Tentando reabrir automaticamente em ${Math.round(
        delayMs / 1000
      )}s.`,
      {
        type: 'whatsapp_browser_reconnect_scheduled',
        metadata: { reason, delayMs }
      }
    );

    this.whatsAppAutoReconnectTimeout = setTimeout(() => {
      this.whatsAppAutoReconnectTimeout = null;
      this.startWhatsApp().catch((error) => {
        this.whatsAppStatus = 'error';
        this.log(`Falha ao reabrir o WhatsApp automaticamente: ${error.message}`, {
          level: 'error',
          type: 'whatsapp_browser_reconnect_error',
          increments: { errors: 1 }
        });
        this.scheduleWhatsAppRestart(`auto_reconnect: ${error.message}`);
      });
    }, delayMs);
  }

  clearWhatsAppAutoReconnect() {
    if (!this.whatsAppAutoReconnectTimeout) {
      return;
    }

    clearTimeout(this.whatsAppAutoReconnectTimeout);
    this.whatsAppAutoReconnectTimeout = null;
  }

  scheduleWhatsAppStartupWatchdog(reason) {
    this.clearWhatsAppStartupWatchdog();

    this.whatsAppStartupWatchdogTimeout = setTimeout(() => {
      this.whatsAppStartupWatchdogTimeout = null;

      if (!['connecting', 'authenticated', 'reconnecting'].includes(this.whatsAppStatus)) {
        return;
      }

      this.log('O WhatsApp ficou preso em reconexao. Reiniciando a janela automaticamente.', {
        level: 'error',
        type: 'whatsapp_startup_watchdog',
        increments: { errors: 1 },
        metadata: {
          reason,
          status: this.whatsAppStatus
        }
      });

      this.scheduleWhatsAppRestart(`watchdog: ${this.whatsAppStatus}`, { delayMs: 0 });
    }, whatsAppStartupWatchdogMs);
  }

  clearWhatsAppStartupWatchdog() {
    if (!this.whatsAppStartupWatchdogTimeout) {
      return;
    }

    clearTimeout(this.whatsAppStartupWatchdogTimeout);
    this.whatsAppStartupWatchdogTimeout = null;
  }

  attachWhatsAppBrowserLifecycle(client = this.whatsAppClient, sessionToken = this.whatsAppSessionToken) {
    if (this.whatsAppProvider === 'baileys' || client?.provider === 'baileys') {
      return;
    }

    const browser = client?.pupBrowser;

    if (!browser || browser.__bridgeLifecycleAttached) {
      return;
    }

    browser.__bridgeLifecycleAttached = true;
    browser.on('disconnected', () => {
      if (!this.isCurrentWhatsAppClient(client, sessionToken) || client?.pupBrowser !== browser) {
        return;
      }

      this.markWhatsAppBrowserClosed('janela do WhatsApp foi fechada');
    });
  }

  isWhatsAppBrowserAlive() {
    if (this.whatsAppProvider === 'baileys' || this.whatsAppClient?.provider === 'baileys') {
      return Boolean(this.whatsAppClient?.isAlive?.());
    }

    const browser = this.whatsAppClient?.pupBrowser;
    const page = this.whatsAppClient?.pupPage;

    return Boolean(browser?.connected && page && !page.isClosed?.());
  }

  markWhatsAppBrowserClosed(context, error = null) {
    if (this.whatsAppStatus === 'browser_closed' && this.whatsAppIssue?.type === 'whatsapp_browser_closed') {
      return;
    }

    this.whatsAppStatus = 'browser_closed';
    this.qrDataUrl = null;
    this.whatsAppIssue = {
      status: 'browser_closed',
      canReconnect: true,
      type: 'whatsapp_browser_closed',
      message:
        'A janela do WhatsApp foi fechada ou reiniciou. O sistema vai tentar reabrir sozinho; se não voltar, use "Reconectar WhatsApp".',
      metadata: {
        context,
        error: error ? String(error.message ?? error) : ''
      }
    };

    this.log(
      `A sessão do navegador do WhatsApp não está mais disponível (${context}). O sistema vai tentar reabrir a janela automaticamente.`,
      {
        level: 'error',
        type: 'whatsapp_browser_closed',
        increments: { errors: 1 },
        metadata: this.whatsAppIssue.metadata
      }
    );
    this.scheduleWhatsAppAutoReconnect(context);
  }

  getWhatsAppProviderSessionDir() {
    return this.whatsAppProvider === 'baileys'
      ? this.paths.baileysAuthSessionDir
      : this.paths.authSessionDir;
  }
}

function normalizeWhatsAppProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'web' || normalized === 'whatsapp-web' || normalized === 'whatsapp-web.js'
    ? 'web'
    : 'baileys';
}

function serializeWid(wid) {
  if (!wid) {
    return null;
  }

  if (typeof wid === 'string') {
    return wid;
  }

  if (wid._serialized) {
    return wid._serialized;
  }

  if (wid.user && wid.server) {
    return `${wid.user}@${wid.server}`;
  }

  return String(wid);
}

function describeTelegramChat(chat) {
  const title = chat?.title || chat?.username || 'chat sem nome';
  return `${title} [${chat?.id}]`;
}

function buildOfferSnapshot(messages, options = {}) {
  const items = Array.isArray(messages) ? messages.filter(Boolean) : [messages].filter(Boolean);
  const primary = items[0];
  const now = new Date().toISOString();

  return {
    id: buildTelegramOfferKey(primary),
    at: now,
    lastUpdatedAt: now,
    sourceLabel: describeTelegramSource(primary),
    preview: buildTelegramPreview(items),
    status: 'captured',
    messageCount: items.length || 1,
    groupCount: Math.max(0, Number(options.groupCount || 0)),
    deliveryCount: Math.max(0, Number(options.deliveryCount || 0)),
    fromQueue: Boolean(options.fromQueue),
    reason: String(options.reason || ''),
    metadata: {
      ...(options.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
      channels: buildOfferChannelStatus({
        status: 'captured',
        reason: String(options.reason || ''),
        fromQueue: Boolean(options.fromQueue)
      })
    }
  };
}

function buildOfferChannelStatus(offer) {
  const normalizedStatus = String(offer?.status || '').trim().toLowerCase();
  const reason = String(offer?.reason || '').trim().toLowerCase();

  let whatsappStatus = 'captured';

  if (normalizedStatus === 'sent') {
    whatsappStatus = 'sent';
  } else if (normalizedStatus === 'failed') {
    whatsappStatus = 'failed';
  } else if (normalizedStatus === 'queued') {
    whatsappStatus = 'queued';
  } else if (normalizedStatus === 'ignored') {
    if (reason === 'bridge_disabled') {
      whatsappStatus = 'skipped';
    } else if (reason === 'no_groups_selected') {
      whatsappStatus = 'no_destination';
    } else {
      whatsappStatus = 'blocked';
    }
  }

  return {
    telegram: {
      status: 'received'
    },
    whatsapp: {
      status: whatsappStatus
    }
  };
}

function buildTelegramOfferKey(message) {
  if (!message) {
    return `telegram:${Date.now()}`;
  }

  const mediaGroupId = String(message?.media_group_id ?? message?.rawMessage?.groupedId ?? '').trim();
  const chatId = String(message?.chat?.id ?? message?.chatId ?? '').trim();

  if (mediaGroupId) {
    return `${chatId || 'telegram'}:album:${mediaGroupId}`;
  }

  return buildTelegramMessageKey(message) || `telegram:${chatId || 'unknown'}:${Date.now()}`;
}

function buildTelegramPreview(messages) {
  const parts = messages
    .map((message) => String(message?.text || message?.caption || fallbackText(message) || '').trim())
    .map((value) => value.replace(/\s+/g, ' '))
    .filter(Boolean);
  const merged = parts.join(' | ');

  if (!merged) {
    return 'Mensagem captada do Telegram.';
  }

  return merged.length > 180 ? `${merged.slice(0, 177)}...` : merged;
}

function describeTelegramSource(message) {
  if (message?.chat) {
    return describeTelegramChat(message.chat);
  }

  if (message?.chatId) {
    return describeTelegramEntity(message?.rawMessage?.chat || null, message.chatId);
  }

  return 'Telegram';
}

function buildTelegramMessageKey(message) {
  const chatId = String(message?.chat?.id ?? message?.chatId ?? '').trim();
  const messageId = String(message?.message_id ?? message?.id ?? '').trim();

  if (!chatId || !messageId) {
    return '';
  }

  return `${chatId}:${messageId}`;
}

function stripWrappedFormattingMarkers(line) {
  const value = String(line ?? '');
  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  const unwrapped = trimmed
    .replace(/^\*(.+)\*$/u, '$1')
    .replace(/^_(.+)_$/u, '$1')
    .replace(/^~(.+)~$/u, '$1');

  return value.replace(trimmed, unwrapped);
}

function extractPostLayoutProductDetails(messageText, convertedUrl, index, options = {}) {
  const lines = String(messageText ?? '').split('\n');
  const affiliateUrl = String(convertedUrl?.affiliateUrl || '').trim();
  const originalUrlFull = String(convertedUrl?.originalUrl || '').trim();
  const originalUrl = originalUrlFull.replace(/^https?:\/\//i, '');
  const lineIndex = findProductUrlLineIndex(lines, affiliateUrl, originalUrlFull, originalUrl);
  const contextStart = lineIndex >= 0 ? lineIndex : 0;
  const sameLine = lineIndex >= 0 ? lines[lineIndex] : '';
  const inlineTitle = cleanPostLayoutTitle(removeKnownUrlsFromLine(sameLine, [affiliateUrl, originalUrlFull, originalUrl]));
  const previousTitle = cleanPostLayoutTitle(findPreviousProductTitleLine(lines, contextStart));
  const pageTitle = cleanPostLayoutTitle(options.pageTitle || '');
  const title = resolvePostLayoutTitle(pageTitle, inlineTitle, previousTitle, index);
  const priceLines = collectNearbyPriceLines(lines, contextStart);
  const sharedPriceLines = Array.isArray(options.sharedPriceLines) ? options.sharedPriceLines : [];
  const resolvedPriceLines = priceLines.length ? priceLines : sharedPriceLines;
  const { price, installment } = splitPostLayoutPriceLines(resolvedPriceLines);

  return {
    title,
    price,
    installment
  };
}

function resolvePostLayoutTitle(pageTitle, inlineTitle, previousTitle, index) {
  if (pageTitle) {
    return pageTitle;
  }

  if (inlineTitle && previousTitle) {
    if (looksLikeSizeOnlyVariant(inlineTitle)) {
      return cleanPostLayoutTitle(
        previousTitle.toLowerCase().includes(inlineTitle.toLowerCase())
          ? previousTitle
          : `${previousTitle} ${inlineTitle}`
      ) || `Oferta ${index + 1}`;
    }

    if (isWeakStandaloneLayoutTitle(inlineTitle)) {
      return previousTitle;
    }
  }

  return inlineTitle || previousTitle || `Oferta ${index + 1}`;
}

function splitPostLayoutPriceLines(lines = []) {
  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => cleanCommercialDisplayLine(line)).filter(Boolean)
    : [];
  const price = normalizedLines[0] || '';
  const explicitSecondaryLine = normalizedLines[1] || '';

  if (explicitSecondaryLine) {
    return {
      price,
      installment: explicitSecondaryLine
    };
  }

  return {
    price,
    installment: extractPriceQualifier(price)
  };
}

function findProductUrlLineIndex(lines, ...urls) {
  return lines.findIndex((line) => {
    const normalized = String(line ?? '');
    return urls.filter(Boolean).some((url) => normalized.includes(url));
  });
}

function findPreviousProductTitleLine(lines, index) {
  for (let current = index - 1; current >= 0; current -= 1) {
    const line = String(lines[current] ?? '').trim();

    if (!line || /R\$\s?[\d.]+(?:,\d{2})?/i.test(line) || /^[-_*]+$/.test(line)) {
      continue;
    }

    return line;
  }

  return '';
}

function collectNearbyPriceLines(lines, index) {
  const prices = [];

  for (let current = Math.max(0, index); current < Math.min(lines.length, index + 6); current += 1) {
    const rawLine = String(lines[current] ?? '');
    const line = cleanCommercialDisplayLine(rawLine);
    const hasPrice = /R\$\s?[\d.]+(?:,\d{2})?/i.test(line);

    // Stop scanning when we detect a new product/link block ahead.
    if (
      current > index &&
      !hasPrice &&
      /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/\S+)/i.test(rawLine)
    ) {
      break;
    }

    if (hasPrice) {
      prices.push(line);
    }

    if (prices.length >= 2) {
      break;
    }
  }

  return prices;
}

function removeKnownUrlsFromLine(line, urls) {
  return urls
    .filter(Boolean)
    .reduce((value, url) => value.split(url).join(''), String(line ?? ''));
}

function cleanPostLayoutTitle(value) {
  return stripWrappedFormattingMarkers(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[a-z0-9-]+\.[a-z]{2,}\/\S+/gi, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~`[\](){}]/g, '')
    .replace(/\s*[-–—]?\s*(?:amazon|shopee)\s*$/i, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .replace(/[\s:;,\-.>]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 90);
}

function looksLikeSizeOnlyVariant(value) {
  const normalized = String(value ?? '').trim();
  return /^\d{1,3}\s*(?:"|”|pol|polegadas?)$/i.test(normalized);
}

function isWeakStandaloneLayoutTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return true;
  }

  if (looksLikeSizeOnlyVariant(normalized)) {
    return true;
  }

  return normalized.length <= 4 && !/[a-z]{2,}/i.test(normalized);
}

function extractPriceQualifier(value) {
  const source = cleanCommercialDisplayLine(value);

  if (!source) {
    return '';
  }

  return source
    .replace(/^.*?R\$\s?[\d.]+(?:,\d{2})?/i, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .trim();
}

function cleanCommercialDisplayLine(value) {
  return String(value ?? '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/^[\s:;,\-.>]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 64);
}

function inferImageExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();

  if (normalized.includes('png')) {
    return 'png';
  }
  if (normalized.includes('webp')) {
    return 'webp';
  }
  if (normalized.includes('gif')) {
    return 'gif';
  }

  return 'jpg';
}

function extractProductImageUrlFromHtml(html) {
  const source = String(html ?? '');
  const decodedSource = decodeEmbeddedUrlSource(source);
  const candidatePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image:src["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+id=["']landingImage["'][^>]*src=["']([^"']+)["'][^>]*>/i,
    /data-old-hires=["']([^"']+)["']/i,
    /"image"\s*:\s*\[\s*"([^"]+)"/i,
    /"image"\s*:\s*"([^"]+)"/i,
    /"image_url"\s*:\s*"([^"]+)"/i,
    /"imageUrl"\s*:\s*"([^"]+)"/i,
    /"thumbnail"\s*:\s*"([^"]+)"/i
  ];

  for (const pattern of candidatePatterns) {
    const match = decodedSource.match(pattern);
    const candidate = sanitizeImageCandidate(match?.[1]);

    if (candidate) {
      return candidate;
    }
  }

  const dynamicImageMatch = decodedSource.match(/data-a-dynamic-image=["']\{([^"']+)\}["']/i);
  if (dynamicImageMatch?.[1]) {
    const unescaped = dynamicImageMatch[1].replace(/&quot;/g, '"');
    const urlMatch = unescaped.match(/https?:\/\/[^"\\\s]+/i);
    const candidate = sanitizeImageCandidate(urlMatch?.[0]);
    if (candidate) {
      return candidate;
    }
  }

  const jsonLdImageMatch = decodedSource.match(/"image"\s*:\s*"([^"]+)"/i);
  const jsonLdCandidate = sanitizeImageCandidate(jsonLdImageMatch?.[1]);
  if (jsonLdCandidate) {
    return jsonLdCandidate;
  }

  const knownHostMatch = decodedSource.match(/(?:https?:)?\/\/[^\s"'<>]+(?:susercontent\.com|images(?:-na)?\.ssl-images-amazon\.com|mlstatic\.com)[^\s"'<>]*/i);
  const knownHostCandidate = sanitizeImageCandidate(knownHostMatch?.[0]);
  if (knownHostCandidate) {
    return knownHostCandidate;
  }

  return '';
}

function extractProductTitleFromHtml(html) {
  const source = decodeEmbeddedUrlSource(String(html ?? ''));
  const candidatePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /"name"\s*:\s*"([^"]+)"/i,
    /"title"\s*:\s*"([^"]+)"/i
  ];

  for (const pattern of candidatePatterns) {
    const match = source.match(pattern);
    const candidate = decodeEmbeddedUrlSource(match?.[1] || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!candidate) {
      continue;
    }
    if (/^shopee\b/i.test(candidate) || /^amazon\b/i.test(candidate)) {
      continue;
    }
    return candidate;
  }

  return '';
}

function sanitizeImageCandidate(value) {
  let candidate = decodeEmbeddedUrlSource(String(value ?? '').trim());

  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  }

  if (!candidate || !/^https?:\/\//i.test(candidate)) {
    return '';
  }

  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(candidate)) {
    return candidate;
  }

  if (/images(-na)?\.ssl-images-amazon\.com/i.test(candidate)) {
    return candidate;
  }

  if (/(?:^|\/\/)(?:[a-z-]+\.)?img\.susercontent\.com\/.+/i.test(candidate)) {
    return candidate;
  }

  if (/(?:^|\/\/)(?:[a-z0-9-]+\.)?mlstatic\.com\/.+/i.test(candidate)) {
    return candidate;
  }

  return '';
}

function decodeEmbeddedUrlSource(value) {
  return String(value ?? '')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');
}

function selectPostLayoutMetadataUrl(item) {
  const marketplace = String(item?.marketplace || '').trim().toLowerCase();
  const preferred = [
    ...(marketplace === 'shopee'
      ? [item?.affiliateUrl, item?.expandedUrl, item?.originalExpandedUrl]
      : [item?.expandedUrl, item?.originalExpandedUrl, item?.affiliateUrl]),
    item?.originalUrl
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return preferred[0] || '';
}

function resolvePostLayoutMetadataUrls(item) {
  const marketplace = String(item?.marketplace || '').trim().toLowerCase();
  const ordered = [
    ...(marketplace === 'shopee'
      ? [item?.affiliateUrl, item?.expandedUrl, item?.originalExpandedUrl]
      : [item?.expandedUrl, item?.originalExpandedUrl, item?.affiliateUrl]),
    item?.originalUrl
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return [...new Set(ordered)];
}

function resolveOpenGraphUserAgents(targetUrl) {
  const url = String(targetUrl ?? '').trim();

  if (!url) {
    return [modernChromeUserAgent];
  }

  let hostname = '';

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return [modernChromeUserAgent];
  }

  if (hostname.includes('shopee.')) {
    return [...socialPreviewUserAgents, modernChromeUserAgent];
  }

  return [modernChromeUserAgent];
}

function fallbackText(message) {
  if (message?.rawMessage?.poll) {
    return `Enquete do Telegram: ${message.rawMessage.poll.question}`;
  }

  if (message?.rawMessage?.location) {
    return `Localizacao recebida do Telegram: ${message.rawMessage.location.latitude}, ${message.rawMessage.location.longitude}`;
  }

  if (message.poll) {
    return `Enquete do Telegram: ${message.poll.question}`;
  }

  if (message.location) {
    return `Localizacao recebida do Telegram: ${message.location.latitude}, ${message.location.longitude}`;
  }

  return 'Mensagem encaminhada do Telegram.';
}

function describeTelegramEntity(chat, fallbackId = '') {
  const title = chat?.title || chat?.username || chat?.firstName || chat?.id || fallbackId || 'chat sem nome';
  return `${title} [${fallbackId || chat?.id || ''}]`;
}

function getTelegramMessageNumericId(message) {
  return Number(message?.message_id ?? message?.id ?? message?.rawMessage?.id ?? 0);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function buildSessionBackupPath(sessionDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${sessionDir}.bak-${stamp}`;
}

function isPathInside(targetPath, parentDir) {
  const resolvedTarget = path.resolve(targetPath).toLowerCase();
  const resolvedParent = path.resolve(parentDir).toLowerCase();
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`);
}

function isLikelyBrowserDatabaseError(bodyText) {
  const normalized = String(bodyText ?? '').toLowerCase();
  return (
    normalized.includes('erro no banco de dados do seu navegador') &&
    normalized.includes('reconecte seu dispositivo')
  );
}

function getErrorMessage(error, fallback = 'erro desconhecido') {
  return String(error?.message ?? error ?? fallback).trim() || fallback;
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timeout_after_${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function parseProtocolTimeout(value, fallbackMs) {
  return parseBoundedTimeout(value, fallbackMs, 60_000, 30 * 60 * 1000);
}

function parseBoundedTimeout(value, fallbackMs, minMs, maxMs) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < minMs) {
    return fallbackMs;
  }

  return Math.min(parsed, maxMs);
}

function parseBoundedInteger(value, fallbackValue, minValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallbackValue;
  }

  return Math.min(parsed, maxValue);
}

function isRecoverableWhatsAppTargetError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('target closed') ||
    message.includes('session closed') ||
    message.includes('execution context was destroyed') ||
    message.includes('most likely because of a navigation')
  );
}

function isProtocolTimeoutError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return message.includes('runtime.callfunctionon timed out');
}

export const __postLayoutTestUtils = {
  extractPostLayoutProductDetails,
  extractProductImageUrlFromHtml,
  sanitizeImageCandidate,
  cleanPostLayoutTitle,
  splitPostLayoutPriceLines,
  selectPostLayoutMetadataUrl
};
