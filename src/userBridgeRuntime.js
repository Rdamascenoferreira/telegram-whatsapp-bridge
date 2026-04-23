import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'whatsapp-web.js';
import {
  appendActivityEvent,
  defaultActivity,
  loadActivityForUser,
  saveActivityForUser
} from './activityStore.js';
import {
  ensureWorkspaceForUser,
  loadConfigForUser,
  saveConfigForUser
} from './configStore.js';

const { Client, LocalAuth, MessageMedia } = pkg;
const albumFlushDelayMs = 1800;
const pendingTelegramMessageLimit = 60;
const pendingTelegramMessageTtlMs = 5 * 60 * 1000;
const modernChromeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const defaultWhatsAppHeadless = !['0', 'false', 'no', 'off'].includes(
  String(process.env.WHATSAPP_HEADLESS ?? 'true').trim().toLowerCase()
);
const defaultWhatsAppProtocolTimeoutMs = parseProtocolTimeout(
  process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS,
  10 * 60 * 1000
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
    this.telegramBot = null;
    this.telegramStatus = 'not_configured';
    this.albumBuffers = new Map();
    this.whatsAppIssue = null;
    this.whatsAppReconnectInProgress = false;
    this.whatsAppResetInProgress = false;
    this.isRefreshingGroups = false;
    this.pendingTelegramMessages = [];
    this.isFlushingPendingTelegramMessages = false;
    this.whatsAppAutoReconnectTimeout = null;
    this.whatsAppRestartAttempts = 0;
    this.whatsAppRestartTimeout = null;
    this.groupDiagnostics = {
      totalGroupsSeen: 0,
      groupsWithAdminMatch: 0,
      sample: []
    };
    this.persistActivityPromise = Promise.resolve();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.paths = await ensureWorkspaceForUser(this.userId);
    this.config = await loadConfigForUser(this.userId);
    this.activity = await loadActivityForUser(this.userId);
    this.logs = buildLogLines(this.activity.events).slice(0, 80);
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

    return {
      whatsAppStatus: this.whatsAppStatus,
      whatsAppPhone: this.whatsAppPhone,
      qrDataUrl: this.qrDataUrl,
      telegramStatus: this.telegramStatus,
      config: {
        telegramChannel: this.config.telegramChannel,
        hasTelegramBotToken: Boolean(this.config.telegramBotToken),
        bridgeEnabled: this.config.bridgeEnabled,
        selectedGroupIds: this.config.selectedGroupIds
      },
      metrics: {
        ...this.activity.metrics,
        selectedGroupCount: this.config.selectedGroupIds.length,
        availableAdminGroupCount: this.availableGroups.length,
        whatsAppStatus: this.whatsAppStatus,
        telegramStatus: this.telegramStatus,
        groupsRefreshing: this.isRefreshingGroups,
        pendingTelegramCount: this.pendingTelegramMessages.length,
        canResetWhatsAppSession: Boolean(this.whatsAppIssue?.canResetSession),
        canReconnectWhatsApp: this.whatsAppStatus !== 'connecting' && !this.whatsAppReconnectInProgress
      },
      issue: this.whatsAppIssue,
      activity: this.activity.events.slice(0, 24),
      diagnostics: this.groupDiagnostics,
      groups: this.availableGroups.map((group) => ({
        ...group,
        selected: selected.has(group.id)
      })),
      logs: this.logs
    };
  }

  async updateSettings({ telegramBotToken, telegramChannel }) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      telegramBotToken,
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

  async updatePower(bridgeEnabled) {
    this.config = await saveConfigForUser(this.userId, {
      ...this.config,
      bridgeEnabled
    });

    this.log(`Sistema ${bridgeEnabled ? 'ligado' : 'desligado'} pelo painel.`);
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
    this.availableGroups = [];
    this.qrDataUrl = null;

    try {
      this.log('Reconectando a sessao do WhatsApp...', {
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
    this.logs = buildLogLines(this.activity.events).slice(0, 80);
    this.persistActivity().catch((error) => {
      console.error(`[bridge:${this.userId}] Falha ao persistir atividade: ${error.message}`);
    });
    const line = `[${new Date().toLocaleString('pt-BR')}] ${message}`;
    console.log(`[bridge:${this.userId}] ${line}`);
  }

  async startWhatsApp() {
    await this.stopWhatsAppClient();

    this.whatsAppStatus = 'connecting';
    this.whatsAppIssue = null;
    this.whatsAppClient = new Client({
      authStrategy: new LocalAuth({
        clientId: this.paths.authClientId,
        dataPath: this.paths.authRootDir
      }),
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

    this.whatsAppClient.on('qr', async (qr) => {
      this.qrDataUrl = await QRCode.toDataURL(qr);
      this.whatsAppStatus = 'qr_required';
      this.whatsAppIssue = null;
      this.whatsAppPhone = null;
      this.log('Escaneie o QR Code do WhatsApp no painel.', {
        type: 'whatsapp_qr'
      });
    });

    this.whatsAppClient.on('authenticated', () => {
      this.whatsAppStatus = 'authenticated';
      this.whatsAppRestartAttempts = 0;
      this.whatsAppIssue = null;
      this.attachWhatsAppBrowserLifecycle();
      this.log('WhatsApp autenticado.', {
        type: 'whatsapp_authenticated'
      });
    });

    this.whatsAppClient.on('ready', async () => {
      this.qrDataUrl = null;
      this.whatsAppStatus = 'ready';
      this.whatsAppRestartAttempts = 0;
      this.whatsAppIssue = null;
      this.clearWhatsAppRestart();
      this.clearWhatsAppAutoReconnect();
      this.attachWhatsAppBrowserLifecycle();
      this.whatsAppPhone = serializeWid(this.whatsAppClient.info?.wid);
      this.log(`WhatsApp pronto (${this.whatsAppPhone ?? 'sessao ativa'}).`, {
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
        this.refreshAvailableGroups().catch((error) => {
          this.log(`Falha ao atualizar grupos apos login: ${error.message}`, {
            level: 'error',
            type: 'whatsapp_groups_error',
            increments: { errors: 1 }
          });
        });
      }, 4000);
    });

    this.whatsAppClient.on('auth_failure', (message) => {
      this.whatsAppStatus = 'auth_failure';
      this.whatsAppIssue = null;
      this.clearWhatsAppRestart();
      this.clearWhatsAppAutoReconnect();
      this.log(`Falha na autenticacao do WhatsApp: ${message}`, {
        level: 'error',
        type: 'whatsapp_auth_failure',
        increments: { errors: 1 }
      });
    });

    this.whatsAppClient.on('disconnected', (reason) => {
      this.whatsAppStatus = 'disconnected';
      this.whatsAppIssue = null;
      this.availableGroups = [];
      this.log(`WhatsApp desconectado: ${reason}`, {
        type: 'whatsapp_disconnected'
      });
      this.scheduleWhatsAppRestart(`desconexao: ${reason}`);
    });

    this.whatsAppClient.initialize().catch((error) => {
      void this.handleWhatsAppInitFailure(error);
    });
  }

  async handleWhatsAppInitFailure(error) {
    const issue = await this.inspectWhatsAppIssue(error);

    if (issue) {
      this.whatsAppStatus = issue.status;
      this.whatsAppIssue = issue;
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
    this.log(`Falha na inicializacao do WhatsApp: ${error.message}`, {
      level: 'error',
      type: 'whatsapp_init_error',
      increments: { errors: 1 }
    });
    this.scheduleWhatsAppRestart(error.message);
  }

  async resetWhatsAppSession() {
    if (this.whatsAppResetInProgress) {
      return;
    }

    if (!isPathInside(this.paths.authSessionDir, this.paths.authRootDir)) {
      throw new Error('Diretorio de sessao fora do escopo permitido.');
    }

    this.whatsAppResetInProgress = true;
    this.clearWhatsAppRestart();
    this.clearWhatsAppAutoReconnect();
    this.whatsAppStatus = 'resetting';
    this.whatsAppIssue = null;
    this.qrDataUrl = null;
    this.whatsAppPhone = null;
    this.availableGroups = [];

    try {
      await this.stopWhatsAppClient();

      if (await pathExists(this.paths.authSessionDir)) {
        const backupPath = buildSessionBackupPath(this.paths.authSessionDir);
        await fs.rename(this.paths.authSessionDir, backupPath);
        this.log('Sessao anterior do WhatsApp movida para backup. Um novo QR Code sera gerado.', {
          type: 'whatsapp_session_reset',
          metadata: {
            backupPath
          }
        });
      } else {
        this.log('Preparando uma nova sessao do WhatsApp. Um novo QR Code sera gerado.', {
          type: 'whatsapp_session_reset'
        });
      }

      await this.startWhatsApp();
    } finally {
      this.whatsAppResetInProgress = false;
    }
  }

  async stopWhatsAppClient() {
    if (!this.whatsAppClient) {
      return;
    }

    const client = this.whatsAppClient;
    this.whatsAppClient = null;
    client.removeAllListeners();
    await client.destroy().catch(() => {});
    await wait(1200);
  }

  async inspectWhatsAppIssue(error) {
    const page = this.whatsAppClient?.pupPage;

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
            'A sessao salva do WhatsApp ficou corrompida no navegador. Clique em "Resetar sessao do WhatsApp" para gerar um novo QR Code.',
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
    if (this.telegramBot) {
      this.telegramBot.removeAllListeners();
      await this.telegramBot.stopPolling().catch(() => {});
      this.telegramBot = null;
    }

    if (!this.config.telegramBotToken) {
      this.telegramStatus = 'not_configured';
      this.log('Telegram ainda nao configurado.', {
        type: 'telegram_not_configured'
      });
      return;
    }

    this.telegramStatus = 'connecting';
    this.telegramBot = new TelegramBot(this.config.telegramBotToken, {
      polling: true
    });

    this.telegramBot.on('polling_error', (error) => {
      this.telegramStatus = 'error';
      this.log(`Erro no polling do Telegram: ${error.message}`, {
        level: 'error',
        type: 'telegram_polling_error',
        increments: { errors: 1 }
      });
    });

    this.telegramBot.on('channel_post', async (message) => {
      try {
        await this.routeTelegramMessage('channel_post', message);
      } catch (error) {
        this.log(`Falha ao encaminhar post do Telegram: ${error.message}`, {
          level: 'error',
          type: 'telegram_forward_error',
          increments: { errors: 1 }
        });
      }
    });

    this.telegramBot.on('message', async (message) => {
      try {
        await this.routeTelegramMessage('message', message);
      } catch (error) {
        this.log(`Falha ao encaminhar mensagem do Telegram: ${error.message}`, {
          level: 'error',
          type: 'telegram_forward_error',
          increments: { errors: 1 }
        });
      }
    });

    this.telegramStatus = 'listening';
    this.log(
      'Telegram conectado. Se a origem for grupo, deixe o bot no grupo; se for canal, deixe como admin do canal.',
      {
        type: 'telegram_ready'
      }
    );
  }

  async routeTelegramMessage(updateType, message) {
    if (!matchesChannel(message.chat, this.config.telegramChannel)) {
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
          chatId: String(message.chat?.id ?? ''),
          messageId: Number(message.message_id ?? 0)
        }
      }
    );
    await this.handleTelegramMessage(message);
  }

  async handleTelegramMessage(message, options = {}) {
    if (!this.config.bridgeEnabled) {
      this.log('Mensagem recebida, mas o sistema esta desligado. Encaminhamento ignorado.', {
        type: 'forward_skipped'
      });
      return;
    }

    if (!this.whatsAppClient || this.whatsAppStatus !== 'ready') {
      if (this.shouldQueueTelegramMessage()) {
        this.enqueueTelegramMessages([message], {
          source: options.fromQueue ? 'retry' : 'live',
          reason: this.whatsAppStatus
        });
      } else {
        this.log('Post recebido, mas o WhatsApp ainda nao esta pronto.', {
          type: 'forward_skipped'
        });
      }
      return;
    }

    if (this.config.selectedGroupIds.length === 0) {
      this.log('Post recebido, mas nenhum grupo do WhatsApp foi selecionado.', {
        type: 'forward_skipped'
      });
      return;
    }

    if (message.media_group_id) {
      const key = String(message.media_group_id);
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
      return;
    }

    await this.forwardMessagesWithRecovery([message]);
  }

  async flushAlbum(key) {
    const bucket = this.albumBuffers.get(key);

    if (!bucket) {
      return;
    }

    this.albumBuffers.delete(key);
    const messages = [...bucket.items].sort((left, right) => left.message_id - right.message_id);
    await this.forwardMessagesWithRecovery(messages);
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
        `WhatsApp indisponivel no momento. ${queuedCount} mensagem(ns) ficou(aram) na fila temporaria (${this.pendingTelegramMessages.length} aguardando).`,
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

  async forwardMessagesWithRecovery(messages) {
    try {
      await this.forwardMessages(messages);
    } catch (error) {
      if (isRecoverableWhatsAppTargetError(error)) {
        this.markWhatsAppBrowserClosed('encaminhar mensagem', error);
        this.enqueueTelegramMessages(messages, {
          source: 'forward',
          reason: 'recoverable_target_error'
        });
        return;
      }

      throw error;
    }
  }

  async forwardMessages(messages) {
    const prepared = [];

    for (const message of messages) {
      prepared.push(await this.prepareWhatsAppPayload(message));
    }

    for (const groupId of this.config.selectedGroupIds) {
      for (const item of prepared) {
        if (item.type === 'text') {
          await this.whatsAppClient.sendMessage(groupId, item.text);
        } else if (item.type === 'media') {
          const media = new MessageMedia(item.mimeType, item.base64, item.filename);
          await this.whatsAppClient.sendMessage(groupId, media, {
            caption: item.caption || undefined
          });
        }
      }
    }

    this.log(`Mensagem do Telegram encaminhada para ${this.config.selectedGroupIds.length} grupo(s).`, {
      type: 'forward_success',
      increments: {
        forwardBatches: 1,
        forwardedMessages: prepared.length,
        whatsAppDeliveries: prepared.length * this.config.selectedGroupIds.length
      },
      metadata: {
        groups: this.config.selectedGroupIds.length,
        messages: prepared.length
      }
    });
  }

  async prepareWhatsAppPayload(message) {
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
      throw new Error(`Nao foi possivel baixar a midia do Telegram (${response.status}).`);
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

  async refreshAvailableGroups() {
    if (!this.whatsAppClient || this.whatsAppStatus !== 'ready' || this.isRefreshingGroups) {
      return;
    }

    if (!this.isWhatsAppBrowserAlive()) {
      this.markWhatsAppBrowserClosed('listar grupos');
      return;
    }

    this.isRefreshingGroups = true;

    try {
      this.log('Atualizando grupos do WhatsApp... Na primeira sincronizacao isso pode levar 1 a 3 minutos.', {
        type: 'groups_refresh_started'
      });
      const groups = await this.fetchGroupSummaries();
      const myId = this.whatsAppClient.info?.wid;
      const myCanonicalIds = buildCanonicalIds(myId);
      const availableGroups = [];
      const diagnosticSample = [];

      for (const chat of groups) {
        const participants = getGroupParticipants(chat);
        const adminParticipant = participants.find((participant) => {
          const participantIds = buildCanonicalIds(participant.id);
          return (
            intersects(participantIds, myCanonicalIds) &&
            (participant.isAdmin || participant.isSuperAdmin)
          );
        });

        if (diagnosticSample.length < 6) {
          diagnosticSample.push({
            name: chat.name || 'Grupo sem nome',
            id: chat.id,
            participantCount: participants.length,
            matchedAdmin: Boolean(adminParticipant),
            sampleParticipantIds: participants.slice(0, 5).map((participant) => ({
              id: serializeWid(participant.id),
              canonical: [...buildCanonicalIds(participant.id)],
              isAdmin: Boolean(participant.isAdmin),
              isSuperAdmin: Boolean(participant.isSuperAdmin)
            }))
          });
        }

        if (!adminParticipant) {
          continue;
        }

        availableGroups.push({
          id: chat.id,
          name: chat.name || 'Grupo sem nome'
        });
      }

      this.availableGroups = availableGroups.sort((left, right) =>
        left.name.localeCompare(right.name, 'pt-BR')
      );
      this.groupDiagnostics = {
        totalGroupsSeen: groups.length,
        groupsWithAdminMatch: this.availableGroups.length,
        myCanonicalIds: [...myCanonicalIds],
        sample: diagnosticSample
      };

      this.log(
        `Lista de grupos atualizada. Total vistos: ${groups.length}. Grupos com admin detectado: ${this.availableGroups.length}.`,
        {
          type: 'groups_refresh_success',
          increments: { groupRefreshes: 1 },
          metadata: {
            totalGroupsSeen: groups.length,
            groupsWithAdminMatch: this.availableGroups.length
          }
        }
      );
    } catch (error) {
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
      .map((chat) => ({
        id: serializeWid(chat.id),
        name: chat.name || 'Grupo sem nome',
        participants: getGroupParticipants(chat).map((participant) => ({
          id: serializeWid(participant.id),
          isAdmin: Boolean(participant.isAdmin),
          isSuperAdmin: Boolean(participant.isSuperAdmin)
        }))
      }));
  }

  async persistActivity() {
    this.persistActivityPromise = this.persistActivityPromise
      .catch(() => {})
      .then(() => saveActivityForUser(this.userId, this.activity));

    return this.persistActivityPromise;
  }

  scheduleWhatsAppRestart(reason) {
    if (
      this.whatsAppResetInProgress ||
      this.whatsAppReconnectInProgress ||
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
    const delayMs = Math.min(20000, 4000 + this.whatsAppRestartAttempts * 3000);
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

    const delayMs = 2500;
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

  attachWhatsAppBrowserLifecycle() {
    const browser = this.whatsAppClient?.pupBrowser;

    if (!browser || browser.__bridgeLifecycleAttached) {
      return;
    }

    browser.__bridgeLifecycleAttached = true;
    browser.on('disconnected', () => {
      if (this.whatsAppClient?.pupBrowser !== browser) {
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
    this.availableGroups = [];
    this.whatsAppIssue = {
      status: 'browser_closed',
      canReconnect: true,
      type: 'whatsapp_browser_closed',
      message:
        'A janela do WhatsApp foi fechada ou reiniciou. O sistema vai tentar reabrir sozinho; se nao voltar, use "Reconectar WhatsApp".',
      metadata: {
        context,
        error: error ? String(error.message ?? error) : ''
      }
    };

    this.log(
      `A sessao do navegador do WhatsApp nao esta mais disponivel (${context}). O sistema vai tentar reabrir a janela automaticamente.`,
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

  if (normalized.startsWith('-100')) {
    return normalized.slice(4);
  }

  return normalized;
}

function describeTelegramChat(chat) {
  const title = chat?.title || chat?.username || 'chat sem nome';
  return `${title} [${chat?.id}]`;
}

function buildTelegramMessageKey(message) {
  const chatId = String(message?.chat?.id ?? '').trim();
  const messageId = String(message?.message_id ?? '').trim();

  if (!chatId || !messageId) {
    return '';
  }

  return `${chatId}:${messageId}`;
}

function fallbackText(message) {
  if (message.poll) {
    return `Enquete do Telegram: ${message.poll.question}`;
  }

  if (message.location) {
    return `Localizacao recebida do Telegram: ${message.location.latitude}, ${message.location.longitude}`;
  }

  return 'Mensagem encaminhada do Telegram.';
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

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function parseProtocolTimeout(value, fallbackMs) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return fallbackMs;
  }

  return Math.min(parsed, 30 * 60 * 1000);
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
