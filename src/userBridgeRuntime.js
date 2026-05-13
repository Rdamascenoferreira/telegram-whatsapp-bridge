import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { Api, TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { computeCheck } from 'telegram/Password.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { StringSession } from 'telegram/sessions/index.js';
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
  getActiveAffiliateAutomationsBySource,
  getAffiliateState,
  updateAffiliateMessageLog
} from './affiliate/affiliate-store.js';
import { processAffiliateMessage } from './affiliate/affiliate-message-processor.js';
import { normalizePostLayoutConfig } from './affiliate/post-layout-config.js';
import { generateCleanPostLayoutImage } from './affiliate/post-layout-generator.js';
import {
  ensureWorkspaceForUser,
  loadConfigForUser,
  saveConfigForUser
} from './configStore.js';
import { waitForFileOperations, writeJsonFileAtomic } from './jsonFileStore.js';
import { WhatsAppDeliveryQueue } from './whatsAppDeliveryQueue.js';

const { Client, LocalAuth, MessageMedia } = pkg;
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
const deliveryReceiptTtlMs = 6 * 60 * 60 * 1000;
const maxRecentDeliveryReceipts = 4000;
const deliveryReceiptsFilename = 'delivery-receipts.json';
const ogImageFetchTimeoutMs = 7000;
const ogImageMaxBytes = 3 * 1024 * 1024;
const modernChromeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
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
    this.persistActivityPromise = Promise.resolve();
    this.recentDeliveryReceipts = new Map();
    this.deliveryStats = {
      skippedDuplicates: 0,
      transientFailures: 0,
      fatalFailures: 0
    };
    this.persistDeliveryReceiptsPromise = Promise.resolve();
    this.lastWhatsAppRecoveryAttemptAt = 0;
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
    const selected = new Set(this.config.selectedGroupIds);
    const dashboardViewClearedAt = String(this.config.dashboardViewClearedAt || '');
    const visibleEvents = filterDashboardItemsByTimestamp(this.activity.events, dashboardViewClearedAt, 'at');
    const visibleOffers = filterDashboardItemsByTimestamp(this.activity.offers, dashboardViewClearedAt, 'lastUpdatedAt');

    return {
      whatsAppStatus: this.whatsAppStatus,
      whatsAppPhone: this.whatsAppPhone,
      qrDataUrl: this.qrDataUrl,
      telegramStatus: this.telegramStatus,
      config: {
        telegramMode: 'user',
        telegramChannel: this.config.telegramChannel,
        telegramApiId: this.config.telegramApiId,
        telegramApiHash: this.config.telegramApiHash,
        telegramPhone: this.config.telegramPhone,
        hasTelegramBotToken: false,
        hasTelegramSession: Boolean(this.config.telegramSession),
        bridgeEnabled: this.config.bridgeEnabled,
        disconnectWhatsAppOnLogout: Boolean(this.config.disconnectWhatsAppOnLogout),
        dashboardViewClearedAt,
        selectedGroupIds: this.config.selectedGroupIds,
        postLayout: normalizePostLayoutConfig(this.config.postLayout)
      },
      metrics: {
        ...this.activity.metrics,
        selectedGroupCount: this.resolveWhatsAppTargetGroupIds().length,
        availableAdminGroupCount: countAdminGroups(this.availableGroups),
        availableGroupCount: this.availableGroups.length,
        whatsAppStatus: this.whatsAppStatus,
        telegramStatus: this.telegramStatus,
        groupsRefreshing: this.isRefreshingGroups,
        groupRefreshProgress: this.groupRefreshProgress,
        groupCacheRefreshedAt: this.groupCacheRefreshedAt,
        hasCachedGroups: this.availableGroups.length > 0,
        pendingTelegramCount: this.pendingTelegramMessages.length,
        whatsAppDeliveryQueue: this.whatsAppDeliveryQueue.getSnapshot(),
        deliveryStats: this.deliveryStats,
        canResetWhatsAppSession: Boolean(this.whatsAppIssue?.canResetSession),
        canReconnectWhatsApp: this.whatsAppStatus !== 'connecting' && !this.whatsAppReconnectInProgress
      },
      telegram: {
        authPhase: this.telegramAuthFlow?.phase || 'idle',
        phoneNumber: this.telegramAuthFlow?.phoneNumber || this.config.telegramPhone || '',
        passwordRequired: Boolean(this.telegramAuthFlow?.passwordRequired),
        codeSentViaApp: Boolean(this.telegramAuthFlow?.isCodeViaApp),
        user: this.telegramUserProfile,
        availableChats: this.telegramAvailableChats
      },
      issue: this.whatsAppIssue,
      activity: visibleEvents.slice(0, 24),
      offers: visibleOffers.slice(0, 10),
      diagnostics: this.groupDiagnostics,
      groups: this.availableGroups.map((group) => ({
        ...group,
        selected: selected.has(group.id)
      })),
      logs: this.logs
    };
  }

  getSupervisorSnapshot() {
    return {
      userId: this.userId,
      telegramStatus: this.telegramStatus,
      whatsAppStatus: this.whatsAppStatus,
      whatsAppPhone: this.whatsAppPhone,
      bridgeEnabled: Boolean(this.config?.bridgeEnabled),
      selectedGroupCount: this.resolveWhatsAppTargetGroupIds().length,
      pendingTelegramCount: this.pendingTelegramMessages.length,
      deliveryQueue: this.whatsAppDeliveryQueue.getSnapshot(),
      deliveryStats: this.deliveryStats,
      lastActivityAt: this.activity?.metrics?.lastActivityAt || null,
      lastForwardedAt: this.activity?.metrics?.lastForwardedAt || null,
      totalErrors: this.activity?.metrics?.totalErrors || 0
    };
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
    const now = Date.now();

    for (const [key, deliveredAt] of this.recentDeliveryReceipts.entries()) {
      if (now - deliveredAt > deliveryReceiptTtlMs) {
        this.recentDeliveryReceipts.delete(key);
      }
    }

    if (this.recentDeliveryReceipts.size <= maxRecentDeliveryReceipts) {
      return;
    }

    const entries = [...this.recentDeliveryReceipts.entries()].sort((left, right) => left[1] - right[1]);
    const toDelete = entries.slice(0, Math.max(0, entries.length - maxRecentDeliveryReceipts));

    for (const [key] of toDelete) {
      this.recentDeliveryReceipts.delete(key);
    }

    this.persistDeliveryReceipts().catch((error) => {
      console.error(`[bridge:${this.userId}] Falha ao persistir dedupe de entregas: ${error.message}`);
    });
  }

  hasRecentDelivery(deliveryKey) {
    if (!deliveryKey) {
      return false;
    }

    const deliveredAt = this.recentDeliveryReceipts.get(deliveryKey);

    if (!deliveredAt) {
      return false;
    }

    if (Date.now() - deliveredAt > deliveryReceiptTtlMs) {
      this.recentDeliveryReceipts.delete(deliveryKey);
      return false;
    }

    return true;
  }

  markRecentDelivery(deliveryKey) {
    if (!deliveryKey) {
      return;
    }

    this.recentDeliveryReceipts.set(deliveryKey, Date.now());
    this.pruneRecentDeliveryReceipts();
    this.persistDeliveryReceipts().catch((error) => {
      console.error(`[bridge:${this.userId}] Falha ao persistir dedupe de entregas: ${error.message}`);
    });
  }

  getDeliveryReceiptsPath() {
    if (!this.paths?.workspaceDir) {
      return '';
    }

    return path.join(this.paths.workspaceDir, deliveryReceiptsFilename);
  }

  async loadDeliveryReceipts() {
    const filePath = this.getDeliveryReceiptsPath();

    if (!filePath) {
      this.recentDeliveryReceipts = new Map();
      return;
    }

    try {
      await waitForFileOperations(filePath);
      const raw = await fs.readFile(filePath, 'utf8');
      const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const now = Date.now();

      this.recentDeliveryReceipts = new Map(
        entries
          .map((entry) => [String(entry?.key ?? ''), Number(entry?.deliveredAt ?? 0)])
          .filter(([key, deliveredAt]) => key && Number.isFinite(deliveredAt) && now - deliveredAt <= deliveryReceiptTtlMs)
      );
      this.pruneRecentDeliveryReceipts();
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.recentDeliveryReceipts = new Map();
        return;
      }

      this.recentDeliveryReceipts = new Map();
      this.log(`Não foi possível carregar dedupe de entregas: ${error.message}`, {
        level: 'error',
        type: 'delivery_dedupe_load_error',
        increments: { errors: 1 }
      });
    }
  }

  async persistDeliveryReceipts() {
    const filePath = this.getDeliveryReceiptsPath();

    if (!filePath) {
      return;
    }

    const entries = [...this.recentDeliveryReceipts.entries()].map(([key, deliveredAt]) => ({
      key,
      deliveredAt
    }));

    this.persistDeliveryReceiptsPromise = this.persistDeliveryReceiptsPromise
      .catch(() => {})
      .then(() =>
        writeJsonFileAtomic(filePath, {
          entries,
          updatedAt: new Date().toISOString()
        })
      );

    return this.persistDeliveryReceiptsPromise;
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
    const client = new Client({
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

        this.refreshAvailableGroups({ waitForCompletion: false }).catch((error) => {
          this.log(`Falha ao atualizar grupos apos login: ${error.message}`, {
            level: 'error',
            type: 'whatsapp_groups_error',
            increments: { errors: 1 }
          });
        });
      }, 1500);
    });

    client.on('auth_failure', (message) => {
      if (!isCurrent()) {
        return;
      }

      this.whatsAppStatus = 'auth_failure';
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

    if (!isPathInside(this.paths.authSessionDir, this.paths.authRootDir)) {
      throw new Error('Diretório de sessão fora do escopo permitido.');
    }

    this.whatsAppResetInProgress = true;
    this.clearWhatsAppRestart();
    this.clearWhatsAppAutoReconnect();
    this.clearWhatsAppStartupWatchdog();
    this.whatsAppStatus = 'resetting';
    this.whatsAppIssue = null;
    this.qrDataUrl = null;
    this.whatsAppPhone = null;
    this.availableGroups = [];
    this.groupCacheRefreshedAt = '';
    await this.persistGroupCache([], null, '');

    try {
      await this.stopWhatsAppClient();

      if (await pathExists(this.paths.authSessionDir)) {
        const backupPath = buildSessionBackupPath(this.paths.authSessionDir);
        await fs.rename(this.paths.authSessionDir, backupPath);
        this.log('Sessão anterior do WhatsApp movida para backup. Um novo QR Code será gerado.', {
          type: 'whatsapp_session_reset',
          metadata: {
            backupPath
          }
        });
      } else {
        this.log('Preparando uma nova sessão do WhatsApp. Um novo QR Code será gerado.', {
          type: 'whatsapp_session_reset'
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
    await this.stopTelegramTransport();
    this.telegramAvailableChats = [];
    this.telegramUserProfile = null;

    await this.startTelegramUser();
  }

  async stopTelegramTransport() {
    if (this.telegramClient) {
      if (this.telegramMessageHandler) {
        this.telegramClient.removeEventHandler(this.telegramMessageHandler);
      }

      await this.telegramClient.disconnect().catch(() => {});
      this.telegramClient = null;
      this.telegramMessageHandler = null;
    }

    if (this.telegramAuthFlow?.client) {
      await this.telegramAuthFlow.client.disconnect().catch(() => {});
    }
  }

  async startTelegramUser() {
    if (!this.config.telegramApiId || !this.config.telegramApiHash || !this.config.telegramPhone) {
      this.telegramStatus = 'not_configured';
      this.log('Telegram ainda não configurado. Informe API ID, API Hash e telefone para usar a sessão de usuário.', {
        type: 'telegram_not_configured'
      });
      return;
    }

    if (!this.config.telegramSession) {
      this.telegramStatus = this.telegramAuthFlow?.phase === 'code_required' ? 'code_required' : 'auth_required';
      this.log('Sessão do Telegram aguardando autenticação por código.', {
        type: 'telegram_auth_required'
      });
      return;
    }

    this.telegramStatus = 'connecting';
    const client = this.createTelegramUserClient();
    await client.connect();

    const isAuthorized = await client.checkAuthorization();

    if (!isAuthorized) {
      this.telegramStatus = 'auth_required';
      this.telegramClient = null;
      await client.disconnect().catch(() => {});
      this.log('A sessão salva do Telegram expirou. Envie um novo código para autenticar novamente.', {
        level: 'error',
        type: 'telegram_auth_expired',
        increments: { errors: 1 }
      });
      return;
    }

    this.telegramClient = client;
    const me = await client.getMe();
    this.telegramUserProfile = {
      id: String(me?.id ?? ''),
      name: [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.username || this.config.telegramPhone,
      username: me?.username ? '@' + me.username : '',
      phone: me?.phone ? '+' + me.phone : this.config.telegramPhone
    };
    await this.refreshTelegramAvailableChats();

    this.telegramMessageHandler = async (event) => {
      try {
        await this.routeTelegramUserMessage(event);
      } catch (error) {
        this.log(`Falha ao encaminhar mensagem do Telegram: ${error.message}`, {
          level: 'error',
          type: 'telegram_forward_error',
          increments: { errors: 1 }
        });
      }
    };

    client.addEventHandler(this.telegramMessageHandler, new NewMessage({}));
    this.telegramStatus = 'listening';
    this.telegramAuthFlow = null;
    this.log('Telegram conectado pela sua conta. Agora a ponte pode ler mensagens do grupo sem bot.', {
      type: 'telegram_ready'
    });
  }

  async routeTelegramMessage(updateType, message) {
    const sourceGroupId = String(message.chat?.id ?? '');
    const normalFlowMatches = matchesChannel(message.chat, this.config.telegramChannel);
    const affiliateHandled = await this.maybeProcessAffiliateAutomation({
      sourceGroupId,
      sourceGroupName: describeTelegramChat(message.chat),
      telegramMessageId: String(message.message_id ?? ''),
      messageText: message.text || message.caption || fallbackText(message),
      telegramMessage: message
    });

    if (!normalFlowMatches) {
      return;
    }

    this.telegramStatus = 'listening';
    this.log(
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
    this.upsertOffer([message], {
      status: 'captured',
      metadata: {
        updateType,
        source: 'telegram_bot'
      }
    });

    if (affiliateHandled) {
      return;
    }

    await this.handleTelegramMessage(message);
  }

  createTelegramUserClient(session = this.config.telegramSession || '') {
    return new TelegramClient(
      new StringSession(session),
      Number(this.config.telegramApiId),
      String(this.config.telegramApiHash),
      {
        connectionRetries: 5,
        autoReconnect: true,
        useWSS: true
      }
    );
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
    return String(phone ?? '').trim().replace(/\s+/g, '');
  }

  buildTelegramAuthErrorMessage(error, fallback = 'Não foi possível concluir a autenticação do Telegram.') {
    const rawMessage = String(error?.errorMessage ?? error?.message ?? error ?? '').trim();
    const normalizedMessage = rawMessage.toUpperCase();

    if (!rawMessage) {
      return fallback;
    }

    const floodWaitMatch = normalizedMessage.match(/FLOOD_WAIT_?(\d+)/);
    if (floodWaitMatch) {
      const waitSeconds = Number(floodWaitMatch[1] || 0);
      if (waitSeconds > 0) {
        return `Telegram bloqueou novas tentativas temporariamente. Aguarde ${waitSeconds}s e tente novamente.`;
      }
      return 'Telegram bloqueou novas tentativas temporariamente. Aguarde alguns instantes e tente novamente.';
    }

    if (normalizedMessage.includes('PHONE_NUMBER_INVALID')) {
      return 'Telefone inválido. Use o formato internacional com código do pais (ex: +5511999999999).';
    }

    if (normalizedMessage.includes('PHONE_NUMBER_FLOOD') || normalizedMessage.includes('PHONE_PASSWORD_FLOOD')) {
      return 'Muitas tentativas de autenticação no Telegram. Aguarde alguns minutos e tente novamente.';
    }

    if (normalizedMessage.includes('PHONE_CODE_FLOOD')) {
      return 'Muitas solicitacoes de código. Aguarde um pouco antes de solicitar um novo código.';
    }

    if (normalizedMessage.includes('API_ID_INVALID') || normalizedMessage.includes('API_ID_PUBLISHED_FLOOD')) {
      return 'API ID/API Hash invalidos ou temporariamente limitados. Revise suas credenciais no Telegram API.';
    }

    if (normalizedMessage.includes('AUTH_RESTART')) {
      return 'Telegram pediu para reiniciar a autenticação. Solicite um novo código e tente novamente.';
    }

    return rawMessage;
  }

  async sendTelegramUserCode() {
    const normalizedPhone = this.normalizeTelegramPhone(this.config.telegramPhone);
    if (!this.config.telegramApiId || !this.config.telegramApiHash || !normalizedPhone) {
      throw new Error('Preencha API ID, API Hash e telefone antes de pedir o código do Telegram.');
    }

    await this.stopTelegramTransport();

    const client = this.createTelegramUserClient('');
    try {
      await client.connect();
      const apiCredentials = {
        apiId: Number(this.config.telegramApiId),
        apiHash: String(this.config.telegramApiHash)
      };
      const sendResult = await client.sendCode(apiCredentials, normalizedPhone);

      this.telegramAuthFlow = {
        client,
        phoneNumber: normalizedPhone,
        phoneCodeHash: sendResult.phoneCodeHash,
        isCodeViaApp: Boolean(sendResult.isCodeViaApp),
        passwordRequired: false,
        phase: 'code_required'
      };
      this.telegramStatus = 'code_required';
      this.log(
        sendResult.isCodeViaApp
          ? 'Código do Telegram enviado para o aplicativo oficial.'
          : 'Código do Telegram enviado por SMS ou outro canal disponível.',
        {
          type: 'telegram_code_sent'
        }
      );
    } catch (error) {
      await client.disconnect().catch(() => {});
      this.telegramAuthFlow = null;
      this.telegramStatus = 'auth_required';
      const reason = this.buildTelegramAuthErrorMessage(error, 'Não foi possível enviar o código do Telegram.');
      this.log(`Falha ao enviar código do Telegram: ${reason}`, {
        level: 'error',
        type: 'telegram_code_send_error',
        increments: { errors: 1 }
      });
      throw new Error(reason);
    }
  }

  async completeTelegramUserAuth({ code, password }) {
    if (!this.telegramAuthFlow?.client || !this.telegramAuthFlow?.phoneCodeHash) {
      throw new Error('Peça um novo código do Telegram antes de concluir a autenticação.');
    }

    const client = this.telegramAuthFlow.client;

    try {
      if (this.telegramAuthFlow.passwordRequired) {
        if (!password) {
          throw new Error('Informe a senha em duas etapas do Telegram para concluir o login.');
        }

        const passwordSrpResult = await client.invoke(new Api.account.GetPassword());
        const passwordSrpCheck = await computeCheck(passwordSrpResult, password);
        await client.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }));
      } else {
        if (!code) {
          throw new Error('Informe o código enviado pelo Telegram.');
        }

        await client.invoke(new Api.auth.SignIn({
          phoneNumber: this.telegramAuthFlow.phoneNumber,
          phoneCodeHash: this.telegramAuthFlow.phoneCodeHash,
          phoneCode: code
        }));
      }
    } catch (error) {
      if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        this.telegramAuthFlow.passwordRequired = true;
        this.telegramAuthFlow.phase = 'password_required';
        this.telegramStatus = 'password_required';
        this.log('O Telegram pediu a senha em duas etapas para concluir o login.', {
          type: 'telegram_password_required'
        });
        return;
      }

      throw new Error(this.buildTelegramAuthErrorMessage(error, 'Não foi possível concluir o login do Telegram.'));
    }

    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      telegramMode: 'user',
      telegramSession: client.session.save()
    });
    this.telegramAuthFlow = null;
    await client.disconnect().catch(() => {});
    await this.startTelegram();
  }

  async disconnectTelegramUser() {
    this.telegramAuthFlow = null;

    if (this.telegramClient) {
      try {
        await this.telegramClient.logOut();
      } catch {}
    }

    await this.stopTelegramTransport();
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      telegramMode: 'user',
      telegramBotToken: '',
      telegramApiId: '',
      telegramApiHash: '',
      telegramPhone: '',
      telegramSession: '',
      telegramChannel: '',
      bridgeEnabled: false
    });
    this.telegramAvailableChats = [];
    this.telegramUserProfile = null;
    this.telegramStatus = 'not_configured';
    this.log('Sessão da conta do Telegram desconectada.', {
      type: 'telegram_disconnected'
    });
  }

  async refreshTelegramAvailableChats() {
    if (!this.telegramClient) {
      this.telegramAvailableChats = [];
      return;
    }

    const dialogs = await this.telegramClient.getDialogs({ limit: 200 });
    this.telegramAvailableChats = dialogs
      .filter((dialog) => dialog.isGroup || dialog.isChannel)
      .map((dialog) => ({
        id: String(dialog.id),
        name: String(dialog.title || dialog.name || 'Chat do Telegram'),
        type: dialog.isChannel && !dialog.isGroup ? 'channel' : 'group',
        role: resolveTelegramDialogRole(dialog),
        selected: String(dialog.id) === String(this.config.telegramChannel || '')
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }

  async routeTelegramUserMessage(event) {
    const message = event?.message;

    if (!message) {
      return;
    }

    const sourceChatRefs = getTelegramUserMessageChatRefs(message);
    const sourceChatId = sourceChatRefs[0] || '';
    const chat = await message.getChat().catch(() => null);
    const runtimeMessage = {
      __telegramSource: 'user_session',
      id: Number(message.id ?? 0),
      chatId: sourceChatId,
      text: message.text || message.message || '',
      caption: message.text || message.message || '',
      rawMessage: message
    };

    const affiliateHandled = await this.maybeProcessAffiliateAutomation({
      sourceGroupId: sourceChatId,
      sourceGroupName: describeTelegramEntity(chat, sourceChatId),
      telegramMessageId: String(message.id ?? ''),
      messageText: runtimeMessage.text || runtimeMessage.caption || fallbackText(runtimeMessage),
      telegramMessage: runtimeMessage
    });

    if (!matchesTelegramUserMessage(message, this.config.telegramChannel)) {
      return;
    }

    this.telegramStatus = 'listening';
    this.log(
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
    this.upsertOffer([runtimeMessage], {
      status: 'captured',
      metadata: {
        updateType: 'user_session',
        source: 'telegram_user_session'
      }
    });

    if (affiliateHandled) {
      return;
    }

    await this.handleTelegramMessage(runtimeMessage);
  }

  async maybeProcessAffiliateAutomation({ sourceGroupId, sourceGroupName, telegramMessageId, messageText, telegramMessage }) {
    const sourceCandidates = buildTelegramChatRefCandidates(sourceGroupId);
    const automations = [];
    const seenAutomationIds = new Set();

    for (const candidate of sourceCandidates) {
      const candidateAutomations = await getActiveAffiliateAutomationsBySource(this.userId, candidate);

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
      return false;
    }

    for (const automation of automations) {
      const result = await processAffiliateMessage({
        userId: this.userId,
        automationId: automation.id,
        automation,
        telegramMessageId,
        message: messageText,
        telegramMessage
      });

      if (!result.shouldSend) {
        const ignoredReason = buildAffiliateIgnoredReason(result);
        const ignoredSourceMessage =
          telegramMessage || { text: messageText, caption: messageText, chatId: sourceGroupId };
        this.upsertOffer([ignoredSourceMessage], {
          id: `affiliate:${automation.id}:${String(telegramMessageId || Date.now())}`,
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
        this.log(`Automação de afiliados "${automation.name}" processou a mensagem sem envio (${result.status}).`, {
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
      const targetGroupIds = this.resolveWhatsAppTargetGroupIds(destinationIds);

      if (!targetGroupIds.length) {
        await updateAffiliateMessageLog(result.messageLogId, {
          status: 'error',
          errorMessage: 'Nenhum grupo de WhatsApp destino configurado.'
        });
        this.log(`Automação de afiliados "${automation.name}" sem destino WhatsApp configurado.`, {
          level: 'error',
          type: 'affiliate_error',
          increments: { errors: 1 }
        });
        continue;
      }

      if (!this.whatsAppClient || this.whatsAppStatus !== 'ready') {
        await updateAffiliateMessageLog(result.messageLogId, {
          status: 'error',
          errorMessage: `WhatsApp indisponível: ${this.whatsAppStatus}`
        });
        this.log('Mensagem de afiliados processada, mas o WhatsApp ainda não está pronto.', {
          level: 'error',
          type: 'affiliate_error',
          increments: { errors: 1 }
        });
        continue;
      }

      const originalMessageText = String(result.processedMessage || '');
      const channelPayloads = await this.prepareAffiliateChannelPayloads({
        originalMessageText,
        telegramMessage,
        automation,
        convertedUrls: result.convertedUrls
      });
      const whatsAppPayload = channelPayloads.whatsApp;
      const delivery = await this.sendAffiliateMessageToWhatsAppGroups(whatsAppPayload, targetGroupIds, {
        automationId: automation.id,
        telegramMessageId: String(telegramMessageId || '')
      });
      const telegramForwardResult = {
        enabled: Boolean(automation.telegramForwardEnabled && automation.telegramDestinationGroupId),
        sent: false,
        error: ''
      };

      if (telegramForwardResult.enabled) {
        if (!this.telegramClient || this.telegramStatus !== 'listening') {
          telegramForwardResult.error = `Telegram indisponível: ${this.telegramStatus || 'offline'}`;
        } else {
          try {
            await this.sendAffiliateMessageToTelegramDestination(
              channelPayloads.telegram,
              automation.telegramDestinationGroupId
            );
            telegramForwardResult.sent = true;
            this.log(`Automação de afiliados "${automation.name}" tambem enviada para o Telegram.`, {
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
      this.upsertOffer([telegramMessage || { text: originalMessageText, chatId: sourceGroupId }], {
        id: `affiliate:${automation.id}:${String(telegramMessageId || Date.now())}`,
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

      this.log(`Automação de afiliados "${automation.name}" enviada para ${delivery.sent.length}/${targetGroupIds.length} destino(s) do WhatsApp${telegramForwardResult.sent ? ' e tambem para Telegram' : ''}${delivery.skipped?.length ? ` (${delivery.skipped.length} duplicado(s) ignorado(s))` : ''}.`, {
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

  async prepareAffiliateChannelPayloads({ originalMessageText, telegramMessage, automation, convertedUrls }) {
    const whatsAppPayload = await this.prepareAffiliateWhatsAppPayload({
      messageText: sanitizeWhatsAppAffiliateText(originalMessageText),
      telegramMessage,
      automation,
      convertedUrls
    });

    const telegramPayload = await this.prepareAffiliateTelegramPayload({
      messageText: originalMessageText,
      telegramMessage,
      automation,
      convertedUrls
    });

    return {
      whatsApp: whatsAppPayload,
      telegram: telegramPayload
    };
  }

  async prepareAffiliateWhatsAppPayload({ messageText, telegramMessage, automation, convertedUrls }) {
    const mode = normalizeAffiliateMediaSourceMode(automation?.mediaSourceMode);

    if (mode === 'system_layout') {
      const layoutPayload = await this.prepareAffiliateCleanPostLayoutPayload(messageText, convertedUrls);

      if (layoutPayload) {
        return layoutPayload;
      }
    }

    if (mode === 'product_image') {
      const productImagePayload = await this.prepareAffiliateProductImagePayload(messageText, convertedUrls, {
        preferSystemLayout: false
      });

      if (productImagePayload) {
        return productImagePayload;
      }
    }

    if (telegramMessage) {
      try {
        const originalPayload = await this.prepareWhatsAppPayload(telegramMessage);

        if (originalPayload.type === 'media') {
          return {
            ...originalPayload,
            caption: messageText
          };
        }
      } catch (error) {
        this.log(`Não foi possível reaproveitar a mídia original no fluxo de afiliados: ${error.message}`, {
          level: 'error',
          type: 'affiliate_media_fallback',
          increments: { errors: 1 }
        });
      }
    }

    return {
      type: 'text',
      text: messageText
    };
  }

  async prepareAffiliateTelegramPayload({ messageText, telegramMessage, automation, convertedUrls }) {
    const mode = normalizeAffiliateMediaSourceMode(automation?.mediaSourceMode);

    if (mode === 'system_layout') {
      const layoutPayload = await this.prepareAffiliateCleanPostLayoutPayload(messageText, convertedUrls);

      if (layoutPayload) {
        return layoutPayload;
      }
    }

    if (mode === 'product_image') {
      const productImagePayload = await this.prepareAffiliateProductImagePayload(messageText, convertedUrls, {
        preferSystemLayout: false
      });

      if (productImagePayload) {
        return productImagePayload;
      }
    }

    if (telegramMessage) {
      try {
        const originalPayload = await this.prepareWhatsAppPayload(telegramMessage);

        if (originalPayload.type === 'media') {
          return {
            ...originalPayload,
            caption: messageText
          };
        }
      } catch (error) {
        this.log(`Não foi possível reaproveitar a mídia original no envio para Telegram: ${error.message}`, {
          level: 'error',
          type: 'affiliate_media_fallback',
          increments: { errors: 1 }
        });
      }
    }

    return {
      type: 'text',
      text: messageText
    };
  }

  async prepareAffiliateProductImagePayload(messageText, convertedUrls = [], options = {}) {
    const preferSystemLayout = options.preferSystemLayout !== false;

    if (preferSystemLayout) {
      const cleanPostLayoutPayload = await this.prepareAffiliateCleanPostLayoutPayload(messageText, convertedUrls);

      if (cleanPostLayoutPayload) {
        return cleanPostLayoutPayload;
      }
    }

    const productUrl = extractPrimaryConvertedProductUrl(convertedUrls);

    if (!productUrl) {
      return null;
    }

    const imageUrl = await this.fetchOpenGraphImageUrl(productUrl);

    if (!imageUrl) {
      return null;
    }

    const mediaPayload = await this.downloadExternalImageAsMediaPayload(imageUrl, messageText);
    return mediaPayload;
  }

  async prepareAffiliateCleanPostLayoutPayload(messageText, convertedUrls = []) {
    const settings = normalizePostLayoutConfig(this.config?.postLayout);

    if (!settings.enabled) {
      return null;
    }

    const converted = Array.isArray(convertedUrls)
      ? convertedUrls.filter((item) => item?.status === 'converted' && item?.affiliateUrl).slice(0, settings.maxProducts)
      : [];

    if (!converted.length) {
      return null;
    }

    try {
      const products = [];

      for (let index = 0; index < converted.length; index += 1) {
        const item = converted[index];
        const imageUrl = await this.fetchOpenGraphImageUrl(item.affiliateUrl);
        const imageBuffer = imageUrl ? await this.downloadExternalImageBuffer(imageUrl) : null;
        const details = extractPostLayoutProductDetails(messageText, item, index);

        products.push({
          ...details,
          marketplace: item.marketplace,
          imageBuffer
        });
      }

      const imageBuffer = await generateCleanPostLayoutImage({ products, settings });

      if (!imageBuffer) {
        return null;
      }

      return {
        type: 'media',
        base64: imageBuffer.toString('base64'),
        mimeType: 'image/png',
        filename: `affiliate-layout-${Date.now()}.png`,
        caption: messageText
      };
    } catch (error) {
      this.log(`Layout de postagem indisponivel: ${error.message}`, {
        level: 'error',
        type: 'affiliate_post_layout_error',
        increments: { errors: 1 }
      });
      return null;
    }
  }

  async fetchOpenGraphImageUrl(targetUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ogImageFetchTimeoutMs);
      let response;

      try {
        response = await fetch(targetUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'user-agent': modernChromeUserAgent
          }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response?.ok) {
        return '';
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      if (!contentType.includes('text/html')) {
        return '';
      }

      const html = await response.text();
      const rawImageUrl = extractProductImageUrlFromHtml(html);

      if (!rawImageUrl) {
        return '';
      }

      return new URL(rawImageUrl, targetUrl).toString();
    } catch {
      return '';
    }
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
    const messageText = whatsAppPayload.type === 'text' ? whatsAppPayload.text : whatsAppPayload.caption || '';
    const sourceKey = `affiliate:${options.automationId || 'automation'}:${options.telegramMessageId || hashText(messageText)}`;

    return await this.whatsAppDeliveryQueue.enqueue('affiliate-message', async ({ sendWithRetry, waitBetweenDeliveries }) => {
      const sent = [];
      const failed = [];
      const skipped = [];

      for (const groupId of targetGroupIds) {
        const deliveryKey = buildDeliveryKey({
          flow: 'affiliate',
          sourceKey,
          groupId,
          messageType: whatsAppPayload.type
        });

        if (this.hasRecentDelivery(deliveryKey)) {
          skipped.push({ groupId, reason: 'duplicate_delivery_key' });
          this.deliveryStats.skippedDuplicates += 1;
          continue;
        }

        const delivery = await sendWithRetry(async () => {
          if (whatsAppPayload.type === 'text') {
            await this.whatsAppClient.sendMessage(groupId, whatsAppPayload.text);
            return;
          }

          const media = new MessageMedia(whatsAppPayload.mimeType, whatsAppPayload.base64, whatsAppPayload.filename);
          await this.whatsAppClient.sendMessage(groupId, media, {
            caption: whatsAppPayload.caption || undefined
          });
        });

        if (delivery.ok) {
          this.markRecentDelivery(deliveryKey);
          sent.push({ groupId, attempt: delivery.attempt, type: whatsAppPayload.type });
        } else {
          if (delivery.errorClass === 'fatal') {
            this.deliveryStats.fatalFailures += 1;
          } else {
            this.deliveryStats.transientFailures += 1;
          }
          failed.push({
            groupId,
            error: delivery.error,
            type: whatsAppPayload.type,
            errorClass: delivery.errorClass || 'transient'
          });
        }

        await waitBetweenDeliveries();
      }

      return { sent, failed, skipped };
    });
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

    const delivery = await this.whatsAppDeliveryQueue.enqueue('telegram-forward', async ({ sendWithRetry, waitBetweenDeliveries }) => {
      const sent = [];
      const failed = [];
      const skipped = [];

      for (const groupId of targetGroupIds) {
        for (const preparedItem of prepared) {
          const item = preparedItem.payload;
          const deliveryKey = buildDeliveryKey({
            flow: 'telegram_forward',
            sourceKey: preparedItem.sourceKey,
            groupId,
            messageType: item.type
          });

          if (this.hasRecentDelivery(deliveryKey)) {
            skipped.push({ groupId, type: item.type, reason: 'duplicate_delivery_key' });
            this.deliveryStats.skippedDuplicates += 1;
            continue;
          }

          const result = await sendWithRetry(async () => {
            if (item.type === 'text') {
              await this.whatsAppClient.sendMessage(groupId, item.text);
              return;
            }

            if (item.type === 'media') {
              const media = new MessageMedia(item.mimeType, item.base64, item.filename);
              await this.whatsAppClient.sendMessage(groupId, media, {
                caption: item.caption || undefined
              });
            }
          });

          if (result.ok) {
            this.markRecentDelivery(deliveryKey);
            sent.push({ groupId, attempt: result.attempt, type: item.type });
          } else {
            if (result.errorClass === 'fatal') {
              this.deliveryStats.fatalFailures += 1;
            } else {
              this.deliveryStats.transientFailures += 1;
            }
            failed.push({
              groupId,
              type: item.type,
              error: result.error,
              errorClass: result.errorClass || 'transient'
            });
          }
        }

        await waitBetweenDeliveries();
      }

      return { sent, failed, skipped };
    });

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
    if (message.__telegramSource === 'user_session') {
      return this.prepareWhatsAppPayloadFromTelegramUser(message);
    }

    const caption = message.caption || '';

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      return this.downloadTelegramMedia(photo.file_id, {
        mimeType: 'image/jpeg',
        filename: `telegram-photo-${message.message_id}.jpg`,
        caption
      });
    }

    if (message.video?.file_id) {
      return this.downloadTelegramMedia(message.video.file_id, {
        mimeType: message.video.mime_type || 'video/mp4',
        filename: message.video.file_name || `telegram-video-${message.message_id}.mp4`,
        caption
      });
    }

    if (message.document?.file_id) {
      return this.downloadTelegramMedia(message.document.file_id, {
        mimeType: message.document.mime_type || 'application/octet-stream',
        filename: message.document.file_name || `telegram-document-${message.message_id}`,
        caption
      });
    }

    if (message.animation?.file_id) {
      return this.downloadTelegramMedia(message.animation.file_id, {
        mimeType: message.animation.mime_type || 'image/gif',
        filename: message.animation.file_name || `telegram-animation-${message.message_id}.gif`,
        caption
      });
    }

    const text = message.text || caption || fallbackText(message);

    return {
      type: 'text',
      text
    };
  }

  async downloadTelegramMedia(fileId, metadata) {
    const fileUrl = await this.telegramBot.getFileLink(fileId);
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Não foi possível baixar a mídia do Telegram (${response.status}).`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      type: 'media',
      base64: buffer.toString('base64'),
      mimeType: metadata.mimeType,
      filename: metadata.filename,
      caption: metadata.caption
    };
  }

  async prepareWhatsAppPayloadFromTelegramUser(message) {
    const rawMessage = message.rawMessage;
    const caption = rawMessage?.text || rawMessage?.message || message.caption || '';
    const messageId = getTelegramMessageNumericId(message);

    if (rawMessage?.photo) {
      return this.downloadTelegramUserMedia(rawMessage, {
        mimeType: 'image/jpeg',
        filename: `telegram-photo-${messageId}.jpg`,
        caption
      });
    }

    if (rawMessage?.video) {
      return this.downloadTelegramUserMedia(rawMessage, {
        mimeType: rawMessage.video.mimeType || 'video/mp4',
        filename: inferTelegramFilename(rawMessage) || `telegram-video-${messageId}.mp4`,
        caption
      });
    }

    if (rawMessage?.document) {
      return this.downloadTelegramUserMedia(rawMessage, {
        mimeType: rawMessage.document.mimeType || 'application/octet-stream',
        filename: inferTelegramFilename(rawMessage) || `telegram-document-${messageId}`,
        caption
      });
    }

    if (rawMessage?.gif) {
      return this.downloadTelegramUserMedia(rawMessage, {
        mimeType: rawMessage.gif.mimeType || 'image/gif',
        filename: inferTelegramFilename(rawMessage) || `telegram-animation-${messageId}.gif`,
        caption
      });
    }

    const text = rawMessage?.text || rawMessage?.message || fallbackText(message);

    return {
      type: 'text',
      text
    };
  }

  async downloadTelegramUserMedia(rawMessage, metadata) {
    const buffer = await rawMessage.downloadMedia({});

    if (!buffer) {
      throw new Error('Não foi possível baixar a mídia da sessão do Telegram.');
    }

    return {
      type: 'media',
      base64: Buffer.from(buffer).toString('base64'),
      mimeType: metadata.mimeType,
      filename: metadata.filename,
      caption: metadata.caption
    };
  }

  isGroupCacheStale() {
    if (!this.groupCacheRefreshedAt) {
      return true;
    }

    const cachedAt = new Date(this.groupCacheRefreshedAt).getTime();

    if (Number.isNaN(cachedAt)) {
      return true;
    }

    return Date.now() - cachedAt > groupCacheMaxAgeMs;
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
    const selected = new Set(this.config.selectedGroupIds);
    let groups = this.availableGroups;

    if (filter === 'selected') {
      groups = groups.filter((group) => selected.has(group.id));
    } else if (filter === 'community') {
      groups = groups.filter((group) => Boolean(group.isCommunityLinked) && !Boolean(group.isAnnouncement));
    } else if (filter === 'announcement') {
      groups = groups.filter((group) => Boolean(group.isAnnouncement));
    } else if (filter === 'admin') {
      groups = groups.filter((group) => group.hasAdminAccess === true);
    }

    if (search) {
      const normalized = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      groups = groups.filter((group) => {
        const name = (group.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return name.includes(normalized);
      });
    }

    // Sort: selected first, then alphabetical
    groups = [...groups].sort((left, right) => {
      const leftSelected = selected.has(left.id) ? 1 : 0;
      const rightSelected = selected.has(right.id) ? 1 : 0;
      if (leftSelected !== rightSelected) return rightSelected - leftSelected;
      return left.name.localeCompare(right.name, 'pt-BR');
    });

    const total = groups.length;
    const clampedPage = Math.max(1, Math.min(page, Math.ceil(total / pageSize) || 1));
    const start = (clampedPage - 1) * pageSize;
    const paged = groups.slice(start, start + pageSize);

    return {
      groups: paged.map((group) => ({ ...group, selected: selected.has(group.id) })),
      pagination: {
        page: clampedPage,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1
      },
      meta: {
        refreshing: this.isRefreshingGroups,
        progress: this.groupRefreshProgress,
        cachedAt: this.groupCacheRefreshedAt,
        cacheStale: this.isGroupCacheStale(),
        selectedGroupIds: this.config.selectedGroupIds || [],
        adminGroupCount: countAdminGroups(this.availableGroups),
        totalAvailable: this.availableGroups.length
      }
    };
  }

  async refreshAvailableGroups(options = {}) {
    const waitForCompletion = options.waitForCompletion !== false;

    if (this.groupRefreshPromise) {
      if (waitForCompletion) {
        await this.groupRefreshPromise;
      }
      return;
    }

    const refreshPromise = this.performAvailableGroupsRefresh()
      .catch((err) => {
        this.log(`Erro ao atualizar grupos: ${err.message}`, { level: 'error' });
      })
      .finally(() => {
        if (this.groupRefreshPromise === refreshPromise) {
          this.groupRefreshPromise = null;
        }
      });
    this.groupRefreshPromise = refreshPromise;

    if (waitForCompletion) {
      await refreshPromise;
    }
  }

  async performAvailableGroupsRefresh() {
    if (!this.whatsAppClient || this.whatsAppStatus !== 'ready') {
      throw new Error('O WhatsApp ainda está finalizando a conexão. Aguarde o status "Pronto" e tente atualizar os grupos novamente.');
    }

    if (!this.isWhatsAppBrowserAlive()) {
      this.markWhatsAppBrowserClosed('listar grupos');
      return;
    }

    this.isRefreshingGroups = true;
    this.groupRefreshProgress = {
      phase: 'loading_groups',
      total: 0,
      processed: 0,
      percent: 5,
      foundAdmins: 0
    };

    try {
      this.log('Atualizando grupos do WhatsApp... Na primeira sincronizacao isso pode levar 1 a 3 minutos.', {
        type: 'groups_refresh_started'
      });
      const groups = await this.fetchGroupSummaries();
      const provisionalGroups = groups
        .map((chat) => ({
          id: chat.id,
          name: chat.name || 'Grupo sem nome',
          kind: chat.kind,
          isAnnouncement: chat.isAnnouncement,
          isCommunityLinked: chat.isCommunityLinked,
          parentGroupId: chat.parentGroupId,
          hasAdminAccess: null
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
      this.availableGroups = provisionalGroups;
      this.groupRefreshProgress = {
        phase: 'checking_admins',
        total: groups.length,
        processed: 0,
        percent: groups.length ? 10 : 100,
        foundAdmins: 0
      };
      const myId = this.whatsAppClient.info?.wid;
      const myCanonicalIds = buildCanonicalIds(myId);
      const groupsWithAdminFlag = [];
      const diagnosticSample = [];
      let foundAdmins = 0;

      const cachedMap = new Map(this.availableGroups.map((g) => [g.id, g]));

      for (let index = 0; index < groups.length; index += 1) {
        const chat = groups[index];
        const cached = cachedMap.get(chat.id);
        const participants = chat.participants;
        
        let isAdmin = cached?.hasAdminAccess;

        if (isAdmin === undefined || isAdmin === null) {
          const adminParticipant = participants.find((participant) => {
            const participantIds = buildCanonicalIds(participant.id);
            return (
              intersects(participantIds, myCanonicalIds) &&
              (participant.isAdmin || participant.isSuperAdmin)
            );
          });
          isAdmin = Boolean(adminParticipant);
        }

        if (diagnosticSample.length < 6) {
          diagnosticSample.push({
            name: chat.name || 'Grupo sem nome',
            id: chat.id,
            participantCount: participants.length,
            matchedAdmin: isAdmin,
            sampleParticipantIds: participants.slice(0, 5).map((participant) => ({
              id: serializeWid(participant.id),
              canonical: [...buildCanonicalIds(participant.id)],
              isAdmin: Boolean(participant.isAdmin),
              isSuperAdmin: Boolean(participant.isSuperAdmin)
            }))
          });
        }

        const processed = index + 1;
        const shouldUpdateProgress =
          processed === groups.length ||
          processed === 1 ||
          processed % 5 === 0;

        groupsWithAdminFlag.push({
          id: chat.id,
          name: chat.name || 'Grupo sem nome',
          kind: chat.kind,
          isAnnouncement: chat.isAnnouncement,
          isCommunityLinked: chat.isCommunityLinked,
          parentGroupId: chat.parentGroupId,
          hasAdminAccess: isAdmin
        });
        if (isAdmin) {
          foundAdmins += 1;
        }

        if (shouldUpdateProgress) {
          this.groupRefreshProgress = {
            phase: 'checking_admins',
            total: groups.length,
            processed,
            percent: groups.length
              ? Math.max(10, Math.min(99, Math.round((processed / groups.length) * 100)))
              : 100,
            foundAdmins
          };
        }

        if ((index + 1) % groupAdminCheckBatchSize === 0 && index + 1 < groups.length) {
          await wait(0);
        }
      }

      this.availableGroups = groupsWithAdminFlag.sort((left, right) =>
        left.name.localeCompare(right.name, 'pt-BR')
      );
      const groupsWithAdminMatch = countAdminGroups(this.availableGroups);
      this.groupCacheRefreshedAt = new Date().toISOString();
      this.groupRefreshProgress = {
        phase: 'done',
        total: groups.length,
        processed: groups.length,
        percent: 100,
        foundAdmins: groupsWithAdminMatch
      };
      this.groupDiagnostics = {
        totalGroupsSeen: groups.length,
        groupsWithAdminMatch,
        myCanonicalIds: [...myCanonicalIds],
        sample: diagnosticSample
      };
      await this.persistGroupCache(this.availableGroups, this.groupDiagnostics, this.groupCacheRefreshedAt);

      this.log(
        `Lista de grupos atualizada. Total vistos: ${groups.length}. Grupos com admin detectado: ${groupsWithAdminMatch}.`,
        {
          type: 'groups_refresh_success',
          increments: { groupRefreshes: 1 },
          metadata: {
            totalGroupsSeen: groups.length,
            groupsWithAdminMatch
          }
        }
      );
    } catch (error) {
      this.groupRefreshProgress = {
        ...this.groupRefreshProgress,
        phase: 'error'
      };
      if (isRecoverableWhatsAppTargetError(error)) {
        this.markWhatsAppBrowserClosed('listar grupos', error);
        return;
      }

      if (isProtocolTimeoutError(error)) {
        this.log(
          `A leitura dos grupos do WhatsApp excedeu o tempo limite de ${Math.round(
            defaultWhatsAppProtocolTimeoutMs / 1000
          )}s. Tente novamente ou aumente WHATSAPP_PROTOCOL_TIMEOUT_MS no servidor.`,
          {
            level: 'error',
            type: 'groups_refresh_timeout',
            increments: { errors: 1 },
            metadata: {
              protocolTimeoutMs: defaultWhatsAppProtocolTimeoutMs
            }
          }
        );
        return;
      }

      this.log(`Falha ao listar grupos do WhatsApp: ${error.message}`, {
        level: 'error',
        type: 'groups_refresh_error',
        increments: { errors: 1 }
      });
    } finally {
      this.isRefreshingGroups = false;
    }
  }

  async fetchGroupSummaries() {
    const chats = await this.whatsAppClient.getChats();

    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => {
        const groupKind = getWhatsAppGroupKind(chat);

        return {
          id: serializeWid(chat.id),
          name: chat.name || 'Grupo sem nome',
          participants: getGroupParticipants(chat).map((participant) => ({
            id: serializeWid(participant.id),
            isAdmin: Boolean(participant.isAdmin),
            isSuperAdmin: Boolean(participant.isSuperAdmin)
          })),
          kind: groupKind.kind,
          isAnnouncement: groupKind.isAnnouncement,
          isCommunityLinked: groupKind.isCommunityLinked,
          parentGroupId: groupKind.parentGroupId
        };
      });
  }

  hydrateGroupCache() {
    const cache = this.config?.whatsAppGroupCache;

    if (!cache || !Array.isArray(cache.groups) || cache.groups.length === 0) {
      this.availableGroups = [];
      this.groupCacheRefreshedAt = '';
      return;
    }

    this.availableGroups = cache.groups
      .map((group) => ({
        id: String(group.id ?? ''),
        name: String(group.name ?? 'Grupo sem nome'),
        kind: group.kind ?? 'group',
        isAnnouncement: Boolean(group.isAnnouncement),
        isCommunityLinked: Boolean(group.isCommunityLinked),
        parentGroupId: group.parentGroupId ? String(group.parentGroupId) : null,
        hasAdminAccess:
          group.hasAdminAccess === null || group.hasAdminAccess === undefined
            ? null
            : Boolean(group.hasAdminAccess)
      }))
      .filter((group) => group.id)
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    this.groupCacheRefreshedAt = typeof cache.refreshedAt === 'string' ? cache.refreshedAt : '';

    if (cache.diagnostics && typeof cache.diagnostics === 'object') {
      this.groupDiagnostics = cache.diagnostics;
    }
  }

  async persistGroupCache(groups, diagnostics, refreshedAt) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      whatsAppGroupCache: {
        groups,
        diagnostics,
        refreshedAt
      }
    });
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
}

function buildLogLines(events) {
  return events.map((event) => `[${formatEventDate(event.at)}] ${event.message}`);
}

function formatEventDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('pt-BR');
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

function getGroupParticipants(chat) {
  if (Array.isArray(chat.participants) && chat.participants.length > 0) {
    return chat.participants;
  }

  if (Array.isArray(chat.groupMetadata?.participants) && chat.groupMetadata.participants.length > 0) {
    return chat.groupMetadata.participants;
  }

  return [];
}

function getWhatsAppGroupKind(chat) {
  const metadata = chat?.groupMetadata || {};
  const parentGroupId = serializeWid(
    metadata.parentGroupId ||
      metadata.parentGroupWid ||
      metadata.linkedParent ||
      metadata.linkedParentId ||
      metadata.communityId ||
      metadata.communityParentId ||
      metadata.parentGroup ||
      metadata.linkedParentWid ||
      metadata.linkedParentGroupId
  );
  const isAnnouncement = Boolean(
    metadata.announce ||
      metadata.isAnnounceGrp ||
      metadata.announcement ||
      metadata.isAnnouncementGroup ||
      metadata.announceGrp ||
      chat?.isReadOnly
  );
  const explicitCommunityFlag = Boolean(
    metadata.isCommunity ||
      metadata.isCommunityGroup ||
      metadata.community ||
      metadata.isParentGroup ||
      metadata.isParentCommunity
  );
  const isCommunityLinked = Boolean(parentGroupId || explicitCommunityFlag);

  return {
    kind: isAnnouncement ? 'announcement' : isCommunityLinked ? 'community_group' : 'group',
    isAnnouncement,
    isCommunityLinked,
    parentGroupId
  };
}

function buildCanonicalIds(wid) {
  const values = new Set();
  const serialized = serializeWid(wid);

  if (serialized) {
    values.add(serialized.toLowerCase());
    values.add(serialized.replace(/@.+$/, '').toLowerCase());
    values.add(serialized.replace(/\D/g, ''));
  }

  if (wid && typeof wid === 'object') {
    if (wid.user) {
      values.add(String(wid.user).toLowerCase());
      values.add(String(wid.user).replace(/\D/g, ''));
    }

    if (wid.server && wid.user) {
      values.add(`${String(wid.user).toLowerCase()}@${String(wid.server).toLowerCase()}`);
    }

    if (wid._serialized) {
      values.add(String(wid._serialized).toLowerCase());
      values.add(String(wid._serialized).replace(/@.+$/, '').toLowerCase());
      values.add(String(wid._serialized).replace(/\D/g, ''));
    }
  }

  values.delete('');
  return values;
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function resolveTelegramDialogRole(dialog) {
  const entity = dialog?.entity || {};
  const adminRights =
    entity?.adminRights ||
    entity?.admin_rights ||
    dialog?.adminRights ||
    dialog?.admin_rights;
  const isCreator = Boolean(dialog?.isCreator ?? entity?.creator ?? entity?.isCreator);
  const isAdmin = Boolean(dialog?.isAdmin ?? entity?.admin ?? entity?.isAdmin ?? adminRights);

  return isCreator || isAdmin ? 'admin' : 'member';
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

function countAdminGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return 0;
  }

  return groups.reduce((total, group) => total + (group?.hasAdminAccess ? 1 : 0), 0);
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

function buildDeliveryKey({ flow, sourceKey, groupId, messageType }) {
  return [
    String(flow || 'unknown'),
    String(sourceKey || 'unknown'),
    String(groupId || 'unknown'),
    String(messageType || 'unknown')
  ].join('|');
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 12);
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

function normalizeAffiliateMediaSourceMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return ['telegram_media', 'product_image', 'system_layout'].includes(mode) ? mode : 'telegram_media';
}

function sanitizeWhatsAppAffiliateText(value) {
  const lines = String(value ?? '').split('\n');
  const cleaned = lines.map((line) => stripWrappedFormattingMarkers(line));
  return cleaned.join('\n');
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

function extractPrimaryConvertedProductUrl(convertedUrls = []) {
  const converted = Array.isArray(convertedUrls)
    ? convertedUrls.find((item) => item?.status === 'converted' && item?.affiliateUrl)
    : null;

  return converted ? String(converted.affiliateUrl).trim() : '';
}

function extractPostLayoutProductDetails(messageText, convertedUrl, index) {
  const lines = String(messageText ?? '').split('\n');
  const affiliateUrl = String(convertedUrl?.affiliateUrl || '').trim();
  const originalUrl = String(convertedUrl?.originalUrl || '').replace(/^https?:\/\//i, '');
  const lineIndex = findProductUrlLineIndex(lines, affiliateUrl, originalUrl);
  const contextStart = lineIndex >= 0 ? lineIndex : 0;
  const sameLine = lineIndex >= 0 ? lines[lineIndex] : '';
  const title =
    cleanPostLayoutTitle(removeKnownUrlsFromLine(sameLine, [affiliateUrl, originalUrl])) ||
    cleanPostLayoutTitle(findPreviousProductTitleLine(lines, contextStart)) ||
    `Oferta ${index + 1}`;
  const priceLines = collectNearbyPriceLines(lines, contextStart);

  return {
    title,
    price: priceLines[0] || '',
    installment: priceLines[1] || ''
  };
}

function findProductUrlLineIndex(lines, affiliateUrl, originalUrl) {
  return lines.findIndex((line) => {
    const normalized = String(line ?? '');
    return [affiliateUrl, originalUrl].filter(Boolean).some((url) => normalized.includes(url));
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
    const line = cleanCommercialDisplayLine(lines[current]);

    if (/R\$\s?[\d.]+(?:,\d{2})?/i.test(line)) {
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
    .replace(/^[\s:;,\-.>]+/g, '')
    .replace(/[\s:;,\-.>]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 90);
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
  const candidatePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image:src["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+id=["']landingImage["'][^>]*src=["']([^"']+)["'][^>]*>/i,
    /data-old-hires=["']([^"']+)["']/i
  ];

  for (const pattern of candidatePatterns) {
    const match = source.match(pattern);
    const candidate = sanitizeImageCandidate(match?.[1]);

    if (candidate) {
      return candidate;
    }
  }

  const dynamicImageMatch = source.match(/data-a-dynamic-image=["']\{([^"']+)\}["']/i);
  if (dynamicImageMatch?.[1]) {
    const unescaped = dynamicImageMatch[1].replace(/&quot;/g, '"');
    const urlMatch = unescaped.match(/https?:\/\/[^"\\\s]+/i);
    const candidate = sanitizeImageCandidate(urlMatch?.[0]);
    if (candidate) {
      return candidate;
    }
  }

  const jsonLdImageMatch = source.match(/"image"\s*:\s*"([^"]+)"/i);
  const jsonLdCandidate = sanitizeImageCandidate(jsonLdImageMatch?.[1]);
  if (jsonLdCandidate) {
    return jsonLdCandidate;
  }

  return '';
}

function sanitizeImageCandidate(value) {
  const candidate = String(value ?? '').trim();

  if (!candidate || !/^https?:\/\//i.test(candidate)) {
    return '';
  }

  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(candidate)) {
    return candidate;
  }

  if (/images(-na)?\.ssl-images-amazon\.com/i.test(candidate)) {
    return candidate;
  }

  return '';
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

function normalizeTelegramUserChatId(value) {
  return normalizeTelegramChatRef(value);
}

function getTelegramUserMessageChatRefs(message) {
  const candidates = [
    message?.chatId,
    message?.peerId?.channelId,
    message?.peerId?.chatId,
    message?.peerId?.userId,
    message?.inputChat?.channelId,
    message?.inputChat?.chatId,
    message?.inputSender?.channelId,
    message?.inputSender?.chatId
  ];

  return [...new Set(candidates.map(serializeTelegramChatRef).filter(Boolean))];
}

function matchesTelegramUserMessage(message, configuredChannel) {
  if (!configuredChannel) {
    return false;
  }

  const configured = normalizeTelegramUserChatId(configuredChannel);
  return getTelegramUserMessageChatRefs(message).some(
    (candidate) => normalizeTelegramUserChatId(candidate) === configured
  );
}

function describeTelegramEntity(chat, fallbackId = '') {
  const title = chat?.title || chat?.username || chat?.firstName || chat?.id || fallbackId || 'chat sem nome';
  return `${title} [${fallbackId || chat?.id || ''}]`;
}

function getTelegramMessageNumericId(message) {
  return Number(message?.message_id ?? message?.id ?? message?.rawMessage?.id ?? 0);
}

function inferTelegramFilename(message) {
  const attributes = Array.isArray(message?.document?.attributes)
    ? message.document.attributes
    : Array.isArray(message?.rawMessage?.document?.attributes)
      ? message.rawMessage.document.attributes
      : [];
  const attributeWithName = attributes.find((attribute) => attribute?.fileName);
  return String(attributeWithName?.fileName || '').trim();
}

function serializeTelegramChatRef(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
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

function filterDashboardItemsByTimestamp(items, clearedAt, dateField) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const baseline = Date.parse(String(clearedAt || ''));

  if (!Number.isFinite(baseline)) {
    return items;
  }

  return items.filter((item) => {
    const rawValue = item?.[dateField] || item?.at || '';
    const value = Date.parse(String(rawValue));

    if (!Number.isFinite(value)) {
      return true;
    }

    return value >= baseline;
  });
}
