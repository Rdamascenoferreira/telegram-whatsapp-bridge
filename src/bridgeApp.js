import path from 'node:path';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'whatsapp-web.js';
import { loadActivityForUser } from './activityStore.js';
import {
  acceptAffiliateTerms,
  getActiveAffiliateAutomationsBySource,
  getAffiliateState,
  setAffiliateAutomationActive,
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

const { Client, LocalAuth, MessageMedia } = pkg;
const albumFlushDelayMs = 1800;

export class BridgeApp {
  constructor(options = {}) {
    this.auth = options.auth ?? null;
    this.manager = new BridgeManager();
    this.config = null;
    this.logs = [];
    this.qrDataUrl = null;
    this.whatsAppClient = null;
    this.whatsAppStatus = 'starting';
    this.whatsAppPhone = null;
    this.availableGroups = [];
    this.telegramBot = null;
    this.telegramStatus = 'not_configured';
    this.albumBuffers = new Map();
    this.isRefreshingGroups = false;
    this.groupDiagnostics = {
      totalGroupsSeen: 0,
      groupsWithAdminMatch: 0,
      sample: []
    };
  }

  async init() {
    await this.manager.init();
  }

  attachRoutes(app) {
    const requireAuth = this.auth?.requireAuth() ?? ((_request, _response, next) => next());
    const requireAdmin = this.auth?.requireAdmin() ?? ((_request, _response, next) => next());
    const respondWithState = async (request, response) => {
      const auth = this.auth
        ? this.auth.getClientSession(request.user)
        : { authenticated: true, googleEnabled: false, user: null };
      const runtime = request.user ? await this.manager.getRuntimeForUser(request.user) : null;
      const admin = this.auth?.isAdminUser(request.user)
        ? await this.buildAdminState()
        : null;
      const affiliate = request.user ? await this.buildAffiliateState(request.user.id) : null;

      response.json({
        auth,
        ...(runtime ? await runtime.getState() : {}),
        ...(affiliate ? { affiliate } : {}),
        ...(admin ? { admin } : {})
      });
    };

    app.get('/', (_request, response) => {
      response.type('html').send(renderPage());
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

    app.post('/api/settings', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      const telegramMode = String(request.body?.telegramMode ?? runtime.getTelegramMode()).trim();
      const incomingTelegramBotToken = String(request.body?.telegramBotToken ?? '').trim();
      const telegramApiId = String(request.body?.telegramApiId ?? '').trim();
      const telegramApiHash = String(request.body?.telegramApiHash ?? '').trim();
      const telegramPhone = String(request.body?.telegramPhone ?? '').trim();
      const telegramChannel = String(request.body?.telegramChannel ?? '').trim();
      const telegramBotToken = incomingTelegramBotToken || runtime.config.telegramBotToken;
      await ensureTelegramSourceIsNotUsedByAffiliate(request.user.id, telegramChannel);

      await runtime.updateSettings({
        telegramMode,
        telegramBotToken,
        telegramApiId,
        telegramApiHash,
        telegramPhone,
        telegramChannel
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/send-code', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.sendTelegramUserCode();
      await respondWithState(request, response);
    });

    app.post('/api/telegram/complete-auth', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.completeTelegramUserAuth({
        code: String(request.body?.code ?? '').trim(),
        password: String(request.body?.password ?? '')
      });
      await respondWithState(request, response);
    });

    app.post('/api/telegram/disconnect', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.disconnectTelegramUser();
      await respondWithState(request, response);
    });

    app.post('/api/telegram/refresh-chats', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.refreshTelegramAvailableChats();
      await respondWithState(request, response);
    });

    app.post('/api/groups', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      const selectedGroupIds = Array.isArray(request.body?.selectedGroupIds)
        ? request.body.selectedGroupIds.map(String)
        : [];

      await runtime.updateGroups(selectedGroupIds);
      await respondWithState(request, response);
    });

    app.post('/api/refresh-groups', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.refreshAvailableGroups();
      await respondWithState(request, response);
    });

    app.post('/api/system-power', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      const bridgeEnabled = Boolean(request.body?.bridgeEnabled);

      await runtime.updatePower(bridgeEnabled);
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/reset-session', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.resetWhatsAppSession();
      await respondWithState(request, response);
    });

    app.post('/api/whatsapp/reconnect', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.reconnectWhatsApp();
      await respondWithState(request, response);
    });

    app.post('/api/connections/reset-all', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      await runtime.resetAllConnections();
      await respondWithState(request, response);
    });

    app.post('/api/affiliate/account', requireAuth, async (request, response) => {
      await upsertAffiliateAccount(request.user.id, request.body || {});
      await respondWithState(request, response);
    });

    app.post('/api/affiliate/automations', requireAuth, async (request, response) => {
      const runtime = await this.manager.getRuntimeForUser(request.user);
      ensureAffiliateSourceIsNotUsedByTelegram(runtime.config.telegramChannel, request.body?.telegramSourceGroupId);
      await upsertAffiliateAutomation(request.user.id, request.body || {});
      await respondWithState(request, response);
    });

    app.post('/api/affiliate/automations/:automationId/toggle', requireAuth, async (request, response) => {
      await setAffiliateAutomationActive(
        request.user.id,
        String(request.params.automationId ?? '').trim(),
        Boolean(request.body?.isActive)
      );
      await respondWithState(request, response);
    });

    app.post('/api/affiliate/terms/accept', requireAuth, async (request, response) => {
      await acceptAffiliateTerms(request.user.id, {
        ipAddress: getRequestIp(request),
        userAgent: request.headers['user-agent']
      });
      await respondWithState(request, response);
    });

    app.post('/api/affiliate/test', requireAuth, async (request, response) => {
      const message = String(request.body?.message ?? '');
      const automationId = String(request.body?.automationId ?? '').trim();
      const draftAutomation = request.body?.automation && !automationId
        ? normalizeAffiliateAutomationDraft(request.user.id, request.body.automation)
        : null;
      const result = await processAffiliateMessage({
        userId: request.user.id,
        automationId,
        automation: draftAutomation,
        message,
        dryRun: true
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

  async buildAdminState() {
    const users = await listUsersForAdmin();
    const enrichedUsers = await Promise.all(users.map(async (user) => {
      const [config, activity] = await Promise.all([
        loadConfigForUser(user.id),
        loadActivityForUser(user.id)
      ]);
      const runtime = this.manager.runtimes.get(user.id);

      return {
        ...user,
        isOnline: this.auth?.isUserOnline(user.id) ?? false,
        workspace: {
          bridgeEnabled: Boolean(config.bridgeEnabled),
          telegramConfigured: Boolean(config.telegramBotToken && config.telegramChannel),
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
        }
      };
    }));

    return {
      summary: buildAdminSummary(enrichedUsers),
      options: {
        roles: userRoleOptions,
        plans: userPlanOptions,
        accountStatuses: userAccountStatusOptions,
        billingStatuses: userBillingStatusOptions
      },
      users: enrichedUsers
    };
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
      diagnostics: this.groupDiagnostics,
      groups: this.availableGroups.map((group) => ({
        ...group,
        selected: selected.has(group.id)
      })),
      logs: this.logs
    };
  }

  log(message) {
    const line = `[${new Date().toLocaleString('pt-BR')}] ${message}`;
    this.logs.unshift(line);
    this.logs = this.logs.slice(0, 80);
    console.log(line);
  }

  async startWhatsApp() {
    if (this.whatsAppClient) {
      await this.whatsAppClient.destroy().catch(() => {});
    }

    this.whatsAppStatus = 'connecting';
    this.whatsAppClient = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.resolve(process.cwd(), '.wwebjs_auth')
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: 180000,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    this.whatsAppClient.on('qr', async (qr) => {
      this.qrDataUrl = await QRCode.toDataURL(qr);
      this.whatsAppStatus = 'qr_required';
      this.log('Escaneie o QR Code do WhatsApp no painel.');
    });

    this.whatsAppClient.on('authenticated', () => {
      this.whatsAppStatus = 'authenticated';
      this.log('WhatsApp autenticado.');
    });

    this.whatsAppClient.on('ready', async () => {
      this.qrDataUrl = null;
      this.whatsAppStatus = 'ready';
      this.whatsAppPhone = serializeWid(this.whatsAppClient.info?.wid);
      this.log(`WhatsApp pronto (${this.whatsAppPhone ?? 'sessao ativa'}).`);
      setTimeout(() => {
        this.refreshAvailableGroups().catch((error) => {
          this.log(`Falha ao atualizar grupos apos login: ${error.message}`);
        });
      }, 4000);
    });

    this.whatsAppClient.on('auth_failure', (message) => {
      this.whatsAppStatus = 'auth_failure';
      this.log(`Falha na autenticacao do WhatsApp: ${message}`);
    });

    this.whatsAppClient.on('disconnected', (reason) => {
      this.whatsAppStatus = 'disconnected';
      this.availableGroups = [];
      this.log(`WhatsApp desconectado: ${reason}`);
    });

    this.whatsAppClient.initialize().catch((error) => {
      this.whatsAppStatus = 'error';
      this.log(`Falha na inicializacao do WhatsApp: ${error.message}`);
    });
  }

  async startTelegram() {
    if (this.telegramBot) {
      this.telegramBot.removeAllListeners();
      await this.telegramBot.stopPolling().catch(() => {});
      this.telegramBot = null;
    }

    if (!this.config.telegramBotToken) {
      this.telegramStatus = 'not_configured';
      this.log('Telegram ainda nao configurado.');
      return;
    }

    this.telegramStatus = 'connecting';
    this.telegramBot = new TelegramBot(this.config.telegramBotToken, {
      polling: true
    });

    this.telegramBot.on('polling_error', (error) => {
      this.telegramStatus = 'error';
      this.log(`Erro no polling do Telegram: ${error.message}`);
    });

    this.telegramBot.on('channel_post', async (message) => {
      try {
        await this.routeTelegramMessage('channel_post', message);
      } catch (error) {
        this.log(`Falha ao encaminhar post do Telegram: ${error.message}`);
      }
    });

    this.telegramBot.on('message', async (message) => {
      try {
        await this.routeTelegramMessage('message', message);
      } catch (error) {
        this.log(`Falha ao encaminhar mensagem do Telegram: ${error.message}`);
      }
    });

    this.telegramStatus = 'listening';
    this.log('Telegram conectado. Se a origem for grupo, deixe o bot no grupo; se for canal, deixe como admin do canal.');
  }

  async routeTelegramMessage(updateType, message) {
    if (!matchesChannel(message.chat, this.config.telegramChannel)) {
      return;
    }

    this.telegramStatus = 'listening';
    this.log(
      `Mensagem recebida do Telegram (${updateType}) em ${describeTelegramChat(message.chat)}.`
    );
    await this.handleTelegramMessage(message);
  }

  async handleTelegramMessage(message) {
    if (!this.config.bridgeEnabled) {
      this.log('Mensagem recebida, mas o sistema esta desligado. Encaminhamento ignorado.');
      return;
    }

    if (!this.whatsAppClient || this.whatsAppStatus !== 'ready') {
      this.log('Post recebido, mas o WhatsApp ainda nao esta pronto.');
      return;
    }

    if (this.config.selectedGroupIds.length === 0) {
      this.log('Post recebido, mas nenhum grupo do WhatsApp foi selecionado.');
      return;
    }

    if (message.media_group_id) {
      const key = String(message.media_group_id);
      const current = this.albumBuffers.get(key) ?? { items: [], timeout: null };

      current.items.push(message);
      clearTimeout(current.timeout);
      current.timeout = setTimeout(() => {
        this.flushAlbum(key).catch((error) => {
          this.log(`Falha ao encaminhar album ${key}: ${error.message}`);
        });
      }, albumFlushDelayMs);

      this.albumBuffers.set(key, current);
      return;
    }

    await this.forwardMessages([message]);
  }

  async flushAlbum(key) {
    const bucket = this.albumBuffers.get(key);

    if (!bucket) {
      return;
    }

    this.albumBuffers.delete(key);
    const messages = [...bucket.items].sort((left, right) => left.message_id - right.message_id);
    await this.forwardMessages(messages);
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

    this.log(`Mensagem do Telegram encaminhada para ${this.config.selectedGroupIds.length} grupo(s).`);
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

    this.isRefreshingGroups = true;

    try {
      this.log('Atualizando grupos do WhatsApp...');
      const groups = await this.fetchGroupSummaries();
      const myId = this.whatsAppClient.info?.wid;
      const myCanonicalIds = buildCanonicalIds(myId);
      const availableGroups = [];
      const diagnosticSample = [];

      for (const chat of groups) {
        const participants = getGroupParticipants(chat);
        const adminParticipant = participants.find((participant) => {
          const participantIds = buildCanonicalIds(participant.id);
          return intersects(participantIds, myCanonicalIds) && (participant.isAdmin || participant.isSuperAdmin);
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

      this.availableGroups = availableGroups.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
      this.groupDiagnostics = {
        totalGroupsSeen: groups.length,
        groupsWithAdminMatch: this.availableGroups.length,
        myCanonicalIds: [...myCanonicalIds],
        sample: diagnosticSample
      };

      this.log(
        `Lista de grupos atualizada. Total vistos: ${groups.length}. Grupos com admin detectado: ${this.availableGroups.length}.`
      );
    } catch (error) {
      this.log(`Falha ao listar grupos do WhatsApp: ${error.message}`);
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

function ensureAffiliateSourceIsNotUsedByTelegram(telegramChannel, affiliateSourceGroupId) {
  const normalizedTelegramChannel = normalizeRouteSourceId(telegramChannel);
  const normalizedAffiliateSource = normalizeRouteSourceId(affiliateSourceGroupId);

  if (normalizedTelegramChannel && normalizedAffiliateSource && normalizedTelegramChannel === normalizedAffiliateSource) {
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

function fallbackText(message) {
  if (message.poll) {
    return `Enquete do Telegram: ${message.poll.question}`;
  }

  if (message.location) {
    return `Localizacao recebida do Telegram: ${message.location.latitude}, ${message.location.longitude}`;
  }

  return 'Mensagem encaminhada do Telegram.';
}

function buildAdminSummary(users) {
  return {
    totalUsers: users.length,
    activeBridges: users.filter((user) => user.workspace?.bridgeEnabled).length,
    readySessions: users.filter((user) => user.workspace?.whatsAppStatus === 'ready').length,
    paidPlans: users.filter((user) => ['starter', 'pro', 'enterprise'].includes(user.plan)).length
  };
}

function renderPage() {
  const currentPanelVersion = 'Versao 0.57';
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Portal do Afiliado</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --bg-top: #eef4f0;
        --bg: #e6ece7;
        --panel: rgba(255, 255, 252, 0.8);
        --panel-strong: rgba(255, 255, 255, 0.96);
        --panel-elevated: rgba(255, 255, 255, 0.98);
        --ink: #142019;
        --muted: #607165;
        --accent: #1ea86a;
        --accent-strong: #157a4e;
        --accent-2: #155e75;
        --border: rgba(31, 51, 41, 0.12);
        --soft: rgba(239, 245, 241, 0.92);
        --group-bg: rgba(255, 255, 255, 0.78);
        --input-bg: rgba(255, 255, 255, 0.98);
        --log-bg: #111814;
        --log-ink: #e6f4e9;
        --shadow: rgba(13, 21, 17, 0.09);
        --hero-a: rgba(21, 94, 117, 0.16);
        --hero-b: rgba(30, 168, 106, 0.12);
        --hero-c: rgba(94, 114, 106, 0.12);
        --spotlight-bg:
          radial-gradient(circle at top right, rgba(99, 214, 158, 0.18), transparent 34%),
          linear-gradient(150deg, #10231c 0%, #12372c 42%, #145642 100%);
        --spotlight-ink: #f6fffa;
        --spotlight-muted: rgba(228, 243, 235, 0.78);
        --spotlight-border: rgba(255, 255, 255, 0.1);
        --accent-soft: rgba(30, 168, 106, 0.16);
        --page-stroke: rgba(255, 255, 255, 0.74);
        --ring: rgba(30, 168, 106, 0.18);
        --danger: #c65b31;
      }

      :root[data-theme="dark"] {
        --bg-top: #09110e;
        --bg: #070c09;
        --panel: rgba(13, 19, 16, 0.84);
        --panel-strong: rgba(14, 21, 17, 0.94);
        --panel-elevated: rgba(18, 25, 22, 0.98);
        --ink: #f4fbf6;
        --muted: #a7bbb0;
        --accent: #2fc57b;
        --accent-strong: #1f8f58;
        --accent-2: #2590b9;
        --border: rgba(145, 166, 153, 0.18);
        --soft: rgba(19, 28, 23, 0.92);
        --group-bg: rgba(13, 19, 16, 0.92);
        --input-bg: rgba(9, 14, 11, 0.96);
        --log-bg: #050907;
        --log-ink: #ddf3e2;
        --shadow: rgba(0, 0, 0, 0.44);
        --hero-a: rgba(37, 144, 185, 0.2);
        --hero-b: rgba(47, 197, 123, 0.14);
        --hero-c: rgba(111, 135, 122, 0.08);
        --spotlight-bg:
          radial-gradient(circle at top right, rgba(84, 221, 156, 0.15), transparent 34%),
          linear-gradient(150deg, #0e1914 0%, #10271f 40%, #124131 100%);
        --spotlight-ink: #f6fff8;
        --spotlight-muted: rgba(232, 244, 236, 0.82);
        --spotlight-border: rgba(255, 255, 255, 0.08);
        --accent-soft: rgba(47, 197, 123, 0.14);
        --page-stroke: rgba(255, 255, 255, 0.04);
        --ring: rgba(47, 197, 123, 0.16);
        --danger: #db6f43;
      }

      * {
        box-sizing: border-box;
      }

      html {
        color-scheme: light;
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
      }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, var(--hero-a), transparent 25%),
          radial-gradient(circle at 84% 12%, var(--hero-b), transparent 28%),
          radial-gradient(circle at 18% 78%, var(--hero-c), transparent 26%),
          radial-gradient(circle at 70% 78%, var(--accent-soft), transparent 24%),
          linear-gradient(180deg, var(--bg-top) 0%, var(--bg) 100%);
        font-family: "Manrope", "Segoe UI", sans-serif;
        transition: background 180ms ease, color 180ms ease;
      }

      main {
        max-width: 1220px;
        margin: 0 auto;
        padding: 32px 20px 64px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 24px;
        margin-bottom: 30px;
      }

      .topbar-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
      }

      .brand-block {
        max-width: 760px;
      }

      .brand-tag {
        display: inline-flex;
        align-items: center;
        padding: 9px 13px;
        margin-bottom: 16px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
        box-shadow: 0 10px 28px var(--shadow);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      h1 {
        margin: 0 0 12px;
        font-family: "Sora", "Manrope", sans-serif;
        font-size: clamp(34px, 4.5vw, 52px);
        line-height: 1.04;
        letter-spacing: -0.05em;
        color: var(--ink);
      }

      .lead-strong {
        margin: 0 0 10px;
        color: var(--ink);
        font-size: 18px;
        font-weight: 600;
        line-height: 1.55;
      }

      .lead {
        max-width: 740px;
        margin: 0;
        color: var(--muted);
        line-height: 1.72;
        font-size: 17px;
      }

      .feedback {
        margin: 0 0 18px;
        padding: 15px 18px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-strong) 94%, transparent);
        color: var(--ink);
        box-shadow: 0 18px 34px var(--shadow);
      }

      .feedback.error {
        border-color: color-mix(in srgb, var(--danger) 38%, transparent);
        background: color-mix(in srgb, var(--danger) 12%, var(--panel-strong));
      }

      .feedback.success {
        border-color: color-mix(in srgb, var(--accent) 34%, transparent);
        background: color-mix(in srgb, var(--accent) 12%, var(--panel-strong));
      }

      .user-chip {
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-strong) 94%, transparent);
        color: var(--ink);
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 14px 30px var(--shadow);
      }

      .auth-shell {
        display: grid;
        grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
        gap: 24px;
        align-items: stretch;
      }

      .auth-spotlight {
        position: relative;
        overflow: hidden;
        background: var(--spotlight-bg);
        color: var(--spotlight-ink);
        border: 1px solid var(--spotlight-border);
        min-height: 560px;
      }

      .auth-spotlight::after {
        content: '';
        position: absolute;
        inset: auto -52px -60px auto;
        width: 250px;
        height: 250px;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.11), transparent 68%);
        pointer-events: none;
      }

      .auth-spotlight::before {
        content: '';
        position: absolute;
        inset: -80px auto auto -64px;
        width: 250px;
        height: 250px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.14), transparent 70%);
        pointer-events: none;
      }

      .eyebrow {
        display: inline-flex;
        padding: 9px 13px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: var(--spotlight-muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 18px;
      }

      .auth-title {
        margin: 0 0 14px;
        font-family: "Sora", "Manrope", sans-serif;
        font-size: clamp(30px, 3.7vw, 42px);
        line-height: 1.06;
        max-width: 13ch;
      }

      .auth-list {
        list-style: none;
        margin: 28px 0 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }

      .auth-list li {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: flex-start;
        padding: 16px;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.08);
        color: var(--spotlight-ink);
        backdrop-filter: blur(8px);
      }

      .benefit-icon {
        width: 34px;
        height: 34px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.12);
        display: inline-grid;
        place-items: center;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.04em;
        color: var(--spotlight-ink);
      }

      .benefit-copy strong {
        display: block;
        margin-bottom: 4px;
        font-size: 15px;
      }

      .benefit-copy span {
        display: block;
        color: var(--spotlight-muted);
        font-size: 14px;
        line-height: 1.55;
      }

      .auth-copy {
        max-width: 39ch;
        color: var(--spotlight-muted);
        line-height: 1.72;
        font-size: 16px;
      }

      .spotlight-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 24px 0 4px;
      }

      .spotlight-stat {
        min-width: 120px;
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(8px);
      }

      .spotlight-stat strong {
        display: block;
        font-size: 22px;
        margin-bottom: 2px;
      }

      .spotlight-stat span {
        color: var(--spotlight-muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--page-stroke);
        border-radius: 28px;
        padding: 28px;
        box-shadow: 0 24px 48px var(--shadow);
        backdrop-filter: blur(18px);
      }

      .card h2 {
        margin: 0 0 14px;
        font-family: "Sora", "Manrope", sans-serif;
        font-size: 22px;
        line-height: 1.2;
      }

      .auth-card {
        background: color-mix(in srgb, var(--panel-elevated) 96%, transparent);
      }

      .auth-kicker {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      label {
        display: block;
        margin-bottom: 9px;
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
      }

      input[type="text"],
      input[type="password"],
      select,
      textarea {
        width: 100%;
        padding: 15px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--input-bg);
        color: var(--ink);
        font: inherit;
        margin-bottom: 16px;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.28),
          0 1px 0 rgba(255, 255, 255, 0.06);
      }

      textarea {
        min-height: 132px;
        resize: vertical;
      }

      select {
        appearance: none;
      }

      input::placeholder,
      textarea::placeholder {
        color: color-mix(in srgb, var(--muted) 76%, transparent);
      }

      input[type="text"]:focus,
      input[type="password"]:focus,
      select:focus,
      textarea:focus {
        outline: none;
        border-color: color-mix(in srgb, var(--accent) 54%, var(--border));
        box-shadow: 0 0 0 4px var(--ring);
      }

      button,
      .button-link {
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
        color: white;
        font: inherit;
        padding: 14px 22px;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-weight: 700;
        box-shadow: 0 16px 32px color-mix(in srgb, var(--accent) 26%, transparent);
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          border-color 160ms ease,
          background 160ms ease,
          color 160ms ease,
          opacity 160ms ease;
      }

      button:hover,
      .button-link:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 38px color-mix(in srgb, var(--accent) 24%, transparent);
      }

      button.secondary,
      .button-link.secondary {
        background: linear-gradient(135deg, var(--accent-2) 0%, #1f77a4 100%);
      }

      button.ghost,
      .button-link.ghost {
        background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
        color: var(--ink);
        border: 1px solid var(--border);
        box-shadow: none;
      }

      button.warn {
        background: linear-gradient(135deg, #c65b31 0%, #a3441f 100%);
      }

      button:disabled,
      .button-link[aria-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.58;
        pointer-events: none;
        transform: none;
        box-shadow: none;
      }

      .button-link {
        border-radius: 999px;
        width: 100%;
      }

      .google-button {
        min-height: 56px;
        background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
        color: var(--ink);
        border: 1px solid var(--border);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }

      .google-mark {
        width: 28px;
        height: 28px;
        display: inline-grid;
        place-items: center;
        border-radius: 999px;
        background:
          conic-gradient(from 45deg, #4285f4 0 25%, #34a853 25% 50%, #fbbc05 50% 75%, #ea4335 75% 100%);
        color: white;
        font-weight: 700;
        font-size: 14px;
      }

      .theme-toggle {
        min-width: 0;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .tabs {
        display: inline-flex;
        gap: 8px;
        padding: 6px;
        border-radius: 999px;
        background: var(--soft);
        border: 1px solid var(--border);
        margin-bottom: 24px;
      }

      .tab {
        background: transparent;
        color: var(--muted);
        padding: 11px 18px;
        box-shadow: none;
      }

      .tab.active {
        background: var(--panel-elevated);
        color: var(--ink);
        border: 1px solid var(--border);
      }

      .auth-form {
        display: grid;
      }

      .auth-panel-title {
        margin: 0 0 8px;
        font-family: "Sora", "Manrope", sans-serif;
        font-size: 28px;
        line-height: 1.1;
      }

      .auth-panel-copy {
        margin: 0 0 24px;
        color: var(--muted);
        line-height: 1.65;
      }

      .auth-separator {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--muted);
        margin: 18px 0 14px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .auth-separator span {
        white-space: nowrap;
      }

      .auth-separator::before,
      .auth-separator::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
      }

      .auth-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        margin-top: 4px;
      }

      .auth-actions button[type="submit"] {
        min-width: 190px;
      }

      .text-link {
        padding: 0;
        border: 0;
        border-radius: 0;
        width: auto;
        background: transparent;
        box-shadow: none;
        color: var(--accent);
        font-size: 14px;
        font-weight: 700;
      }

      .text-link:hover {
        transform: none;
        box-shadow: none;
        color: color-mix(in srgb, var(--accent) 82%, white 18%);
      }

      .status {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 14px;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
      }

      .metric-card {
        padding: 18px;
        border-radius: 22px;
        border: 1px solid var(--page-stroke);
        background: var(--panel);
        box-shadow: 0 20px 36px var(--shadow);
        backdrop-filter: blur(14px);
      }

      .metric-label {
        display: block;
        margin-bottom: 10px;
        color: var(--muted);
        font-size: 13px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      .metric-value {
        display: block;
        font-size: clamp(26px, 3.2vw, 36px);
        line-height: 1;
        letter-spacing: -0.04em;
        margin-bottom: 8px;
      }

      .metric-meta {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.55;
      }

      .pill {
        padding: 8px 12px;
        border-radius: 999px;
        background: var(--soft);
        border: 1px solid var(--border);
        font-size: 14px;
        color: var(--ink);
      }

      .groups {
        display: grid;
        gap: 10px;
        max-height: 320px;
        overflow: auto;
        padding-right: 4px;
      }

      .search-input {
        width: 100%;
        padding: 13px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--input-bg);
        color: var(--ink);
        font: inherit;
        margin-bottom: 14px;
      }

      .group {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--group-bg);
        transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
      }

      .group:hover {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--accent) 22%, var(--border));
      }

      .group-name {
        font-size: 14px;
        color: var(--ink);
      }

      .qr {
        width: min(320px, 100%);
        display: none;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: white;
        padding: 12px;
      }

      pre {
        margin: 0;
        min-height: 260px;
        max-height: 360px;
        overflow: auto;
        padding: 14px;
        border-radius: 16px;
        background: var(--log-bg);
        color: var(--log-ink);
        font-size: 13px;
        line-height: 1.5;
      }

      .row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .hint {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }

      .auth-footnote {
        margin-top: 12px;
      }

      .auth-note {
        margin: 16px 0 0;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--soft);
        color: var(--muted);
        line-height: 1.65;
      }

      .app-shell {
        display: grid;
        gap: 18px;
      }

      .dashboard-hero {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
        gap: 18px;
        align-items: stretch;
        position: relative;
        overflow: hidden;
      }

      .dashboard-hero::after {
        content: '';
        position: absolute;
        inset: auto -80px -110px auto;
        width: 280px;
        height: 280px;
        border-radius: 999px;
        background: radial-gradient(circle, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%);
        pointer-events: none;
      }

      .dashboard-hero-copy {
        position: relative;
        z-index: 1;
      }

      .dashboard-title {
        margin: 0 0 10px;
        font-family: "Sora", "Manrope", sans-serif;
        font-size: clamp(26px, 3vw, 38px);
        line-height: 1.08;
        letter-spacing: -0.04em;
      }

      .dashboard-copy,
      .section-copy {
        margin: 0;
        color: var(--muted);
        line-height: 1.68;
      }

      .dashboard-badges {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }

      .soft-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--soft);
        border: 1px solid var(--border);
        color: var(--ink);
        font-size: 13px;
        font-weight: 700;
      }

      .soft-pill-version {
        background: color-mix(in srgb, var(--accent) 16%, var(--soft));
        border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
        color: color-mix(in srgb, var(--accent-strong) 72%, white 28%);
      }

      .dashboard-hero-stats {
        display: grid;
        gap: 12px;
        position: relative;
        z-index: 1;
      }

      .hero-stat {
        padding: 18px;
        border-radius: 22px;
        border: 1px solid var(--page-stroke);
        background: color-mix(in srgb, var(--panel-strong) 90%, transparent);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      .hero-stat span {
        display: block;
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .hero-stat strong {
        display: block;
        font-size: clamp(20px, 2.2vw, 30px);
        line-height: 1.25;
        letter-spacing: -0.03em;
      }

      .workspace-grid,
      .admin-layout {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .workspace-grid-bottom {
        align-items: start;
      }

      .section-card {
        display: grid;
        gap: 18px;
      }

      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
      }

      .section-head h2,
      .section-head h3,
      .meta-panel h4 {
        margin: 0 0 6px;
        font-family: "Sora", "Manrope", sans-serif;
      }

      .section-kicker {
        margin: 0 0 8px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .section-head-inline {
        align-items: center;
      }

      .connection-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
        gap: 18px;
        align-items: center;
      }

      .connection-label {
        margin: 0 0 8px;
        color: var(--muted);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .connection-value,
      .connection-issue {
        margin: 0 0 14px;
      }

      .qr-shell {
        display: grid;
        place-items: center;
        min-height: 220px;
        border-radius: 24px;
        border: 1px dashed var(--border);
        background: color-mix(in srgb, var(--soft) 92%, transparent);
      }

      .activity-feed,
      .admin-user-list {
        display: grid;
        gap: 10px;
      }

      .activity-feed {
        max-height: 420px;
        overflow: auto;
      }

      .activity-item {
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--group-bg);
      }

      .activity-item strong {
        display: block;
        margin-bottom: 6px;
        font-size: 14px;
      }

      .activity-item p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.55;
      }

      .activity-item[data-level="error"] {
        border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, var(--group-bg));
      }

      .technical-log-shell {
        border-top: 1px solid var(--page-stroke);
        padding-top: 4px;
      }

      .technical-log-shell summary {
        cursor: pointer;
        color: var(--muted);
        font-size: 14px;
        font-weight: 700;
        padding: 6px 0;
      }

      .admin-shell {
        display: grid;
        gap: 18px;
      }

      .admin-head {
        margin-top: 6px;
      }

      .admin-summary-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }

      .admin-search {
        margin: 0;
      }

      .admin-user-list {
        max-height: 620px;
        overflow: auto;
        padding-right: 4px;
      }

      .admin-user-card {
        display: grid;
        gap: 12px;
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--border);
        background: var(--group-bg);
        cursor: pointer;
        width: 100%;
        color: var(--ink);
        text-align: left;
        justify-content: flex-start;
        box-shadow: none;
        transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
      }

      .admin-user-card:hover {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
        box-shadow: none;
      }

      .admin-user-card.active {
        border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
        background: color-mix(in srgb, var(--accent) 10%, var(--group-bg));
        box-shadow: 0 18px 34px color-mix(in srgb, var(--accent) 12%, transparent);
      }

      .admin-user-card-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .admin-user-card-title {
        margin: 0;
        font-size: 16px;
      }

      .admin-user-card-email {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 13px;
        word-break: break-word;
      }

      .admin-user-pills,
      .admin-user-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .mini-pill {
        display: inline-flex;
        align-items: center;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }

      .admin-user-meta span {
        color: var(--muted);
        font-size: 12px;
      }

      .admin-detail-card {
        align-content: start;
      }

      .admin-user-form {
        display: grid;
        gap: 16px;
      }

      .form-grid,
      .admin-detail-meta,
      .admin-insights-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .admin-detail-meta {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .meta-card,
      .meta-panel {
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
      }

      .meta-label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .meta-card strong {
        display: block;
        font-size: 15px;
        line-height: 1.5;
      }

      .meta-panel p {
        margin: 0;
        color: var(--muted);
        line-height: 1.65;
      }

      [hidden] {
        display: none !important;
      }

      @media (max-width: 900px) {
        .topbar {
          flex-direction: column;
          align-items: stretch;
        }

        .topbar-actions {
          justify-content: flex-start;
        }

        h1 {
          font-size: clamp(30px, 10vw, 42px);
        }

        .lead,
        .lead-strong {
          font-size: 15px;
        }

        .lead {
          max-width: none;
        }

        .auth-shell,
        .grid,
        .metrics-grid,
        .workspace-grid,
        .admin-layout,
        .admin-summary-grid,
        .dashboard-hero,
        .connection-layout,
        .form-grid,
        .admin-detail-meta,
        .admin-insights-grid {
          grid-template-columns: 1fr;
        }

        .auth-spotlight {
          min-height: auto;
        }

        .spotlight-meta {
          grid-template-columns: 1fr;
        }

        .tabs {
          width: 100%;
          justify-content: space-between;
        }

        .tab {
          flex: 1;
        }

        .auth-actions {
          align-items: stretch;
        }

        .auth-actions button[type="submit"] {
          width: 100%;
        }

        .section-head,
        .section-head-inline {
          flex-direction: column;
          align-items: stretch;
        }

        .admin-search {
          width: 100%;
        }
      }

      @media (max-width: 640px) {
        main {
          padding: 24px 16px 40px;
        }

        .card {
          padding: 22px 18px;
          border-radius: 24px;
        }

        .auth-title,
        .auth-panel-title {
          font-size: 26px;
        }

        .dashboard-title {
          font-size: 28px;
        }

        .hero-stat strong,
        .metric-value {
          font-size: 26px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="topbar">
        <div class="brand-block">
          <div class="brand-tag">Portal do Afiliado</div>
          <h1>Automatize sua operação Telegram &rarr; WhatsApp em um painel centralizado.</h1>
          <p class="lead-strong">
            Configure sua ponte, gerencie sessões e controle o envio de posts para seus grupos com mais segurança e organização.
          </p>
          <p class="lead">
            Uma experiência mais profissional para acompanhar sua automação, ativar ou pausar fluxos e manter sua operação organizada desde o primeiro acesso.
          </p>
        </div>
        <div class="topbar-actions">
          <div id="user-chip" class="user-chip" hidden></div>
          <button id="logout-button" class="ghost" type="button" hidden>Sair</button>
          <button id="theme-toggle" class="ghost theme-toggle" type="button">Tema escuro</button>
        </div>
      </section>

      <section id="feedback-banner" class="feedback" hidden></section>

      <section id="auth-shell" class="auth-shell">
        <div class="card auth-spotlight">
          <div class="eyebrow">Painel centralizado</div>
          <h2 class="auth-title">Controle completo da sua ponte</h2>
          <p class="auth-copy">
            Conecte posts do Telegram aos seus grupos de WhatsApp, acompanhe sessões e gerencie sua automação em um só lugar.
          </p>
          <div class="spotlight-meta">
            <div class="spotlight-stat">
              <strong>Ativação</strong>
              <span>Ative ou pause a operação quando quiser</span>
            </div>
            <div class="spotlight-stat">
              <strong>Sessões</strong>
              <span>WhatsApp persistente por usuário</span>
            </div>
            <div class="spotlight-stat">
              <strong>Escala</strong>
              <span>Base preparada para clientes e workspaces</span>
            </div>
          </div>
          <ul class="auth-list">
            <li>
              <span class="benefit-icon">01</span>
              <div class="benefit-copy">
                <strong>Ative ou pause a automação quando quiser</strong>
                <span>Tenha controle imediato do fluxo sem precisar reconfigurar toda a ponte.</span>
              </div>
            </li>
            <li>
              <span class="benefit-icon">02</span>
              <div class="benefit-copy">
                <strong>Sessões WhatsApp persistentes</strong>
                <span>Mantenha a operação conectada com mais previsibilidade no dia a dia.</span>
              </div>
            </li>
            <li>
              <span class="benefit-icon">03</span>
              <div class="benefit-copy">
                <strong>Estrutura preparada para múltiplos clientes</strong>
                <span>Organize contas, workspaces e operações de forma mais profissional.</span>
              </div>
            </li>
            <li>
              <span class="benefit-icon">04</span>
              <div class="benefit-copy">
                <strong>Base pronta para planos, cobrança e workspaces</strong>
                <span>Evolua o produto com mais segurança conforme o SaaS crescer.</span>
              </div>
            </li>
            <li>
              <span class="benefit-icon">05</span>
              <div class="benefit-copy">
                <strong>Login seguro por usuário</strong>
                <span>Cada acesso fica isolado para trazer mais clareza e confiança à operação.</span>
              </div>
            </li>
          </ul>
        </div>

        <div class="card auth-card">
          <p class="auth-kicker">Acesso seguro</p>
          <h2 class="auth-panel-title">Entre no seu painel</h2>
          <p class="auth-panel-copy">
            Faça login para configurar sua ponte, acompanhar sessões e gerenciar sua automação com mais clareza.
          </p>
          <div class="tabs">
            <button id="tab-login" class="tab active" type="button">Entrar</button>
            <button id="tab-register" class="tab" type="button">Criar conta</button>
          </div>

          <form id="login-form" class="auth-form">
            <label for="login-email">E-mail</label>
            <input id="login-email" name="email" type="text" autocomplete="email" placeholder="email@empresa.com" />

            <label for="login-password">Senha</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Digite sua senha" />

            <div class="auth-actions">
              <button id="login-submit" type="submit">Entrar no painel</button>
              <button id="forgot-password" class="text-link" type="button">Esqueci minha senha</button>
            </div>
          </form>

          <form id="register-form" class="auth-form" hidden>
            <label for="register-name">Nome</label>
            <input id="register-name" name="name" type="text" autocomplete="name" placeholder="Seu nome" />

            <label for="register-email">E-mail</label>
            <input id="register-email" name="email" type="text" autocomplete="email" placeholder="email@empresa.com" />

            <label for="register-password">Senha</label>
            <input id="register-password" name="password" type="password" autocomplete="new-password" placeholder="Crie uma senha com pelo menos 8 caracteres" />

            <div class="auth-actions">
              <button id="register-submit" type="submit">Criar conta</button>
            </div>
          </form>

          <div id="auth-separator" class="auth-separator"><span>ou continue com</span></div>
          <a id="google-login" class="button-link google-button" href="/auth/google">
            <span class="google-mark">G</span>
            <span>Continuar com Google</span>
          </a>
          <p id="google-hint" class="hint auth-footnote" hidden></p>
          <p class="auth-note">
            Seu acesso fica protegido por autenticação individual e sessões isoladas por usuário.
          </p>
        </div>
      </section>

      <div id="app-shell" class="app-shell" hidden>
        <section class="card dashboard-hero">
          <div class="dashboard-hero-copy">
            <p class="section-kicker">Painel operacional</p>
            <h2 class="dashboard-title">Central de controle da sua automação</h2>
            <p class="dashboard-copy">
              Acompanhe a saúde da ponte, ajuste a origem no Telegram, gerencie os grupos de destino
              e mantenha a operação organizada em uma interface única.
            </p>
            <div class="dashboard-badges">
              <span id="workspace-version-badge" class="soft-pill soft-pill-version">${currentPanelVersion}</span>
              <span id="workspace-plan-badge" class="soft-pill">Plano Beta</span>
              <span id="workspace-account-badge" class="soft-pill">Conta ativa</span>
            </div>
          </div>
          <div class="dashboard-hero-stats">
            <article class="hero-stat">
              <span>Grupos selecionados</span>
              <strong id="hero-group-count">0</strong>
            </article>
            <article class="hero-stat">
              <span>Mensagens encaminhadas</span>
              <strong id="hero-forward-count">0</strong>
            </article>
            <article class="hero-stat">
              <span>Última atividade</span>
              <strong id="hero-last-activity">Sem atividade</strong>
            </article>
          </div>
        </section>

        <section class="metrics-grid">
          <article class="metric-card">
            <span class="metric-label">Mensagens do Telegram</span>
            <strong id="metric-telegram-received" class="metric-value">0</strong>
            <p id="metric-telegram-meta" class="metric-meta">Nenhuma mensagem recebida ainda.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Lotes encaminhados</span>
            <strong id="metric-forward-batches" class="metric-value">0</strong>
            <p id="metric-forward-meta" class="metric-meta">Nenhum envio realizado ainda.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Entregas no WhatsApp</span>
            <strong id="metric-deliveries" class="metric-value">0</strong>
            <p id="metric-deliveries-meta" class="metric-meta">Sem entregas registradas até agora.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Erros e disponibilidade</span>
            <strong id="metric-errors" class="metric-value">0</strong>
            <p id="metric-errors-meta" class="metric-meta">Tudo limpo por enquanto.</p>
          </article>
        </section>

        <section class="workspace-grid">
          <article class="card section-card">
            <div class="section-head">
              <div>
                <p class="section-kicker">Origem</p>
                <h3>Configuração do Telegram</h3>
                <p class="section-copy">
                  Conecte sua conta do Telegram, escolha o grupo de origem e use a ponte sem depender de bot.
                </p>
              </div>
            </div>

            <form id="settings-form">
              <label for="telegramMode">Modo de conexão</label>
              <select id="telegramMode" name="telegramMode">
                <option value="user">Sessão de usuário (sem bot)</option>
                <option value="bot">Bot do Telegram</option>
              </select>

              <div id="telegram-user-fields" class="stacked-fields">
                <label for="telegramApiId">API ID</label>
                <input id="telegramApiId" name="telegramApiId" type="text" placeholder="Ex.: 12345678" />

                <label for="telegramApiHash">API Hash</label>
                <input id="telegramApiHash" name="telegramApiHash" type="password" placeholder="Cole o API Hash da sua conta Telegram" />

                <label for="telegramPhone">Telefone da conta</label>
                <input id="telegramPhone" name="telegramPhone" type="text" placeholder="+55 21 99999-9999" />
              </div>

              <div id="telegram-bot-fields" class="stacked-fields" hidden>
                <label for="telegramBotToken">Token do bot</label>
                <input id="telegramBotToken" name="telegramBotToken" type="password" placeholder="123456:ABC..." />
              </div>

              <label for="telegramChatSelect">Grupo ou canal monitorado</label>
              <select id="telegramChatSelect" name="telegramChatSelect">
                <option value="">Selecione após conectar sua conta</option>
              </select>

              <label for="telegramChannel">ID manual do grupo ou canal</label>
              <input id="telegramChannel" name="telegramChannel" type="text" placeholder="Use este campo só se quiser informar o ID manualmente" />

              <div class="row">
                <button type="submit">Salvar configuração</button>
                <button id="telegram-refresh-chats" class="ghost" type="button">Atualizar grupos do Telegram</button>
              </div>
            </form>

            <div id="telegram-user-auth-panel" class="auth-note">
              <strong>Conectar conta do Telegram</strong>
              <p class="hint">
                Envie um código para o seu Telegram, depois confirme o código recebido. Se sua conta tiver senha em duas etapas, informe a senha no segundo passo.
              </p>
              <div class="row">
                <button id="telegram-send-code" type="button">Enviar código</button>
                <button id="telegram-disconnect" class="ghost" type="button">Desconectar Telegram</button>
              </div>
              <div class="form-grid telegram-auth-grid">
                <div>
                  <label for="telegramLoginCode">Código recebido</label>
                  <input id="telegramLoginCode" type="text" placeholder="Digite o código do Telegram" />
                </div>
                <div>
                  <label for="telegramTwoFactorPassword">Senha em duas etapas</label>
                  <input id="telegramTwoFactorPassword" type="password" placeholder="Preencha apenas se o Telegram pedir" />
                </div>
              </div>
              <div class="row">
                <button id="telegram-complete-auth" class="secondary" type="button">Concluir login no Telegram</button>
              </div>
              <p id="telegram-auth-hint" class="hint">Sua sessão do Telegram ficará salva para reconectar sem bot.</p>
            </div>

            <p class="hint">
              No modo sem bot, a ponte lê as mensagens usando a sua própria conta do Telegram. Escolha o grupo ou canal de origem e o sistema encaminhará as novas mensagens para o WhatsApp.
            </p>
          </article>

          <article class="card section-card">
            <div class="section-head">
              <div>
                <p class="section-kicker">Conexões</p>
                <h3>Saúde da operação</h3>
                <p class="section-copy">
                  Veja o status da ponte, gere um novo QR quando necessário e controle a operação em tempo real.
                </p>
              </div>
            </div>

            <div class="status">
              <div class="pill" id="system-status">Sistema: carregando...</div>
              <div class="pill" id="wa-status">WhatsApp: carregando...</div>
              <div class="pill" id="tg-status">Telegram: carregando...</div>
            </div>

            <div class="connection-layout">
              <div class="connection-copy">
                <p class="connection-label">Sessão atual</p>
                <p class="hint connection-value" id="wa-phone"></p>
                <p class="hint connection-issue" id="wa-issue" hidden></p>
                <div class="row">
                  <button id="system-toggle" type="button">Carregando...</button>
                  <button class="secondary" id="refresh-groups" type="button">Atualizar grupos</button>
                  <button class="secondary" id="whatsapp-action" type="button">WhatsApp</button>
                </div>
              </div>

              <div class="qr-shell">
                <img id="qr" class="qr" alt="QR Code do WhatsApp" />
              </div>
            </div>
          </article>
        </section>

        <section class="workspace-grid workspace-grid-bottom">
          <article class="card section-card">
            <div class="section-head">
              <div>
                <p class="section-kicker">Destinos</p>
                <h3>Grupos do WhatsApp</h3>
                <p class="section-copy">
                  Escolha os grupos que podem receber os posts da sua ponte e filtre rapidamente por nome.
                </p>
              </div>
            </div>

            <input
              id="group-search"
              class="search-input"
              type="text"
              placeholder="Busque um grupo pelo nome"
            />
            <div id="groups" class="groups"></div>
            <div class="row">
              <button id="save-groups" type="button">Salvar grupos selecionados</button>
            </div>
          </article>

          <article class="card section-card">
            <div class="section-head">
              <div>
                <p class="section-kicker">Atividade</p>
                <h3>Histórico recente</h3>
                <p class="section-copy">
                  Acompanhe os eventos mais recentes da sua operação para validar entregas e identificar falhas.
                </p>
              </div>
            </div>

            <div id="activity-feed" class="activity-feed"></div>
            <details class="technical-log-shell">
              <summary>Ver log técnico</summary>
              <pre id="logs">Carregando atividade...</pre>
            </details>
          </article>
        </section>

        <section id="admin-shell" class="admin-shell" hidden>
          <div class="section-head admin-head">
            <div>
              <p class="section-kicker">Administração</p>
              <h2>Controle de contas e acesso</h2>
              <p class="section-copy">
                Gerencie usuários cadastrados, acompanhe a saúde das contas e organize a base para planos e cobrança.
              </p>
            </div>
          </div>

          <section class="admin-summary-grid">
            <article class="metric-card">
              <span class="metric-label">Usuários cadastrados</span>
              <strong id="admin-total-users" class="metric-value">0</strong>
              <p class="metric-meta">Base total de contas com acesso ao painel.</p>
            </article>

            <article class="metric-card">
              <span class="metric-label">Pontes ativas</span>
              <strong id="admin-active-bridges" class="metric-value">0</strong>
              <p class="metric-meta">Contas com automação ligada neste momento.</p>
            </article>

            <article class="metric-card">
              <span class="metric-label">Sessões prontas</span>
              <strong id="admin-ready-sessions" class="metric-value">0</strong>
              <p class="metric-meta">Contas com WhatsApp conectado e pronto para operar.</p>
            </article>

            <article class="metric-card">
              <span class="metric-label">Planos pagos</span>
              <strong id="admin-paid-plans" class="metric-value">0</strong>
              <p class="metric-meta">Contas marcadas como pagas ou em operação comercial.</p>
            </article>
          </section>

          <section class="admin-layout">
            <article class="card section-card">
              <div class="section-head section-head-inline">
                <div>
                  <p class="section-kicker">Clientes</p>
                  <h3>Usuários cadastrados</h3>
                </div>
                <input
                  id="admin-user-search"
                  class="search-input admin-search"
                  type="text"
                  placeholder="Busque por nome ou e-mail"
                />
              </div>

              <div id="admin-user-list" class="admin-user-list"></div>
            </article>

            <article class="card section-card admin-detail-card">
              <div class="section-head">
                <div>
                  <p class="section-kicker">Conta selecionada</p>
                  <h3 id="admin-user-name">Selecione um usuário</h3>
                  <p id="admin-user-email" class="section-copy">
                    Escolha um usuário na lista para gerenciar plano, acesso e observações internas.
                  </p>
                </div>
              </div>

              <form id="admin-user-form" class="admin-user-form">
                <input id="admin-user-id" type="hidden" />

                <div class="form-grid">
                  <div>
                    <label for="admin-user-role">Permissão</label>
                    <select id="admin-user-role"></select>
                  </div>

                  <div>
                    <label for="admin-user-plan">Plano</label>
                    <select id="admin-user-plan"></select>
                  </div>

                  <div>
                    <label for="admin-user-account-status">Status da conta</label>
                    <select id="admin-user-account-status"></select>
                  </div>

                  <div>
                    <label for="admin-user-billing-status">Status de cobrança</label>
                    <select id="admin-user-billing-status"></select>
                  </div>
                </div>

                <label for="admin-user-note">Observação interna</label>
                <textarea
                  id="admin-user-note"
                  rows="5"
                  placeholder="Anotações internas sobre onboarding, cobrança, suporte ou próximos passos."
                ></textarea>

                <div class="row">
                  <button id="admin-save-button" type="submit">Salvar alterações da conta</button>
                </div>
              </form>

              <div class="admin-detail-meta">
                <article class="meta-card">
                  <span class="meta-label">Criada em</span>
                  <strong id="admin-user-created">-</strong>
                </article>

                <article class="meta-card">
                  <span class="meta-label">Último login</span>
                  <strong id="admin-user-last-login">-</strong>
                </article>

                <article class="meta-card">
                  <span class="meta-label">Última atividade</span>
                  <strong id="admin-user-last-activity">-</strong>
                </article>
              </div>

              <div class="admin-insights-grid">
                <article class="meta-panel">
                  <h4>Workspace</h4>
                  <p id="admin-user-workspace">Selecione um usuário para ver o resumo operacional.</p>
                </article>

                <article class="meta-panel">
                  <h4>Desempenho</h4>
                  <p id="admin-user-performance">Selecione um usuário para ver métricas resumidas da operação.</p>
                </article>
              </div>
            </article>
          </section>
        </section>
      </div>
    </main>

    <script>
      const authShell = document.getElementById('auth-shell');
      const appShell = document.getElementById('app-shell');
      const feedbackBanner = document.getElementById('feedback-banner');
      const loginForm = document.getElementById('login-form');
      const registerForm = document.getElementById('register-form');
      const loginTab = document.getElementById('tab-login');
      const registerTab = document.getElementById('tab-register');
      const authSeparator = document.getElementById('auth-separator');
      const googleLoginLink = document.getElementById('google-login');
      const googleHint = document.getElementById('google-hint');
      const loginSubmitButton = document.getElementById('login-submit');
      const registerSubmitButton = document.getElementById('register-submit');
      const forgotPasswordButton = document.getElementById('forgot-password');
      const userChip = document.getElementById('user-chip');
      const logoutButton = document.getElementById('logout-button');
      const form = document.getElementById('settings-form');
      const telegramModeInput = document.getElementById('telegramMode');
      const telegramUserFields = document.getElementById('telegram-user-fields');
      const telegramBotFields = document.getElementById('telegram-bot-fields');
      const telegramApiIdInput = document.getElementById('telegramApiId');
      const telegramApiHashInput = document.getElementById('telegramApiHash');
      const telegramPhoneInput = document.getElementById('telegramPhone');
      const telegramBotTokenInput = document.getElementById('telegramBotToken');
      const telegramChatSelect = document.getElementById('telegramChatSelect');
      const telegramRefreshChatsButton = document.getElementById('telegram-refresh-chats');
      const telegramUserAuthPanel = document.getElementById('telegram-user-auth-panel');
      const telegramSendCodeButton = document.getElementById('telegram-send-code');
      const telegramDisconnectButton = document.getElementById('telegram-disconnect');
      const telegramCompleteAuthButton = document.getElementById('telegram-complete-auth');
      const telegramLoginCodeInput = document.getElementById('telegramLoginCode');
      const telegramTwoFactorPasswordInput = document.getElementById('telegramTwoFactorPassword');
      const telegramAuthHint = document.getElementById('telegram-auth-hint');
      const groupsContainer = document.getElementById('groups');
      const logs = document.getElementById('logs');
      const systemStatus = document.getElementById('system-status');
      const waStatus = document.getElementById('wa-status');
      const tgStatus = document.getElementById('tg-status');
      const metricTelegramReceived = document.getElementById('metric-telegram-received');
      const metricTelegramMeta = document.getElementById('metric-telegram-meta');
      const metricForwardBatches = document.getElementById('metric-forward-batches');
      const metricForwardMeta = document.getElementById('metric-forward-meta');
      const metricDeliveries = document.getElementById('metric-deliveries');
      const metricDeliveriesMeta = document.getElementById('metric-deliveries-meta');
      const metricErrors = document.getElementById('metric-errors');
      const metricErrorsMeta = document.getElementById('metric-errors-meta');
      const workspacePlanBadge = document.getElementById('workspace-plan-badge');
      const workspaceAccountBadge = document.getElementById('workspace-account-badge');
      const heroGroupCount = document.getElementById('hero-group-count');
      const heroForwardCount = document.getElementById('hero-forward-count');
      const heroLastActivity = document.getElementById('hero-last-activity');
      const activityFeed = document.getElementById('activity-feed');
      const waPhone = document.getElementById('wa-phone');
      const waIssue = document.getElementById('wa-issue');
      const qr = document.getElementById('qr');
      const systemToggleButton = document.getElementById('system-toggle');
      const themeToggleButton = document.getElementById('theme-toggle');
      const saveGroupsButton = document.getElementById('save-groups');
      const refreshGroupsButton = document.getElementById('refresh-groups');
      const whatsAppActionButton = document.getElementById('whatsapp-action');
      const groupSearchInput = document.getElementById('group-search');
      const adminShell = document.getElementById('admin-shell');
      const adminTotalUsers = document.getElementById('admin-total-users');
      const adminActiveBridges = document.getElementById('admin-active-bridges');
      const adminReadySessions = document.getElementById('admin-ready-sessions');
      const adminPaidPlans = document.getElementById('admin-paid-plans');
      const adminUserSearchInput = document.getElementById('admin-user-search');
      const adminUserList = document.getElementById('admin-user-list');
      const adminUserForm = document.getElementById('admin-user-form');
      const adminSaveButton = document.getElementById('admin-save-button');
      const adminUserIdInput = document.getElementById('admin-user-id');
      const adminUserName = document.getElementById('admin-user-name');
      const adminUserEmail = document.getElementById('admin-user-email');
      const adminUserRole = document.getElementById('admin-user-role');
      const adminUserPlan = document.getElementById('admin-user-plan');
      const adminUserAccountStatus = document.getElementById('admin-user-account-status');
      const adminUserBillingStatus = document.getElementById('admin-user-billing-status');
      const adminUserNote = document.getElementById('admin-user-note');
      const adminUserCreated = document.getElementById('admin-user-created');
      const adminUserLastLogin = document.getElementById('admin-user-last-login');
      const adminUserLastActivity = document.getElementById('admin-user-last-activity');
      const adminUserWorkspace = document.getElementById('admin-user-workspace');
      const adminUserPerformance = document.getElementById('admin-user-performance');
      let currentState = null;
      let authMode = 'login';
      let selectedGroupIds = new Set();
      let selectedGroupIdsDirty = false;
      let selectedAdminUserId = '';
      let settingsDraftDirty = false;

      async function fetchState() {
        const response = await fetch('/api/state');
        currentState = await response.json();
        render(currentState);
      }

      function render(state) {
        const auth = state.auth || {
          authenticated: false,
          googleEnabled: false,
          user: null
        };

        renderAuth(auth);

        if (!auth.authenticated) {
          authShell.hidden = false;
          appShell.hidden = true;
          adminShell.hidden = true;
          selectedGroupIdsDirty = false;
          selectedGroupIds = new Set();
          selectedAdminUserId = '';
          settingsDraftDirty = false;
          return;
        }

        authShell.hidden = true;
        appShell.hidden = false;

        if (!selectedGroupIdsDirty) {
          selectedGroupIds = new Set(state.config.selectedGroupIds || []);
        }

        if (!settingsDraftDirty) {
          telegramModeInput.value = state.config.telegramMode || 'user';
          telegramApiIdInput.value = state.config.telegramApiId || '';
          telegramApiHashInput.value = state.config.telegramApiHash || '';
          telegramPhoneInput.value = state.config.telegramPhone || '';
          document.getElementById('telegramChannel').value = state.config.telegramChannel || '';
          telegramBotTokenInput.value = '';
        }
        renderTelegramMode(state.config.telegramMode || 'user');
        renderTelegramChats(state.telegram || {}, state.config.telegramChannel || '');
        renderTelegramAuthPanel(state.telegram || {}, state.config || {});
        systemStatus.textContent = 'Sistema: ' + (state.config.bridgeEnabled ? 'ligado' : 'desligado');
        waStatus.textContent = 'WhatsApp: ' + state.whatsAppStatus;
        tgStatus.textContent = 'Telegram: ' + state.telegramStatus;
        const statusDetails = [];
        if (state.whatsAppPhone) {
          statusDetails.push('Sessão ativa: ' + state.whatsAppPhone);
        }
        if ((state.metrics?.pendingTelegramCount || 0) > 0) {
          statusDetails.push(
            'Fila pendente: ' + formatNumber(state.metrics.pendingTelegramCount || 0)
          );
        }
        waPhone.textContent = statusDetails.join(' | ');
        waIssue.hidden = !state.issue?.message;
        waIssue.textContent = humanizeMessage(state.issue?.message || '');
        logs.textContent = state.logs.length ? state.logs.join('\\n') : 'Sem logs ainda.';
        systemToggleButton.textContent = state.config.bridgeEnabled ? 'Desligar sistema' : 'Ligar sistema';
        systemToggleButton.className = state.config.bridgeEnabled ? 'warn' : '';
        refreshGroupsButton.disabled = Boolean(state.metrics?.groupsRefreshing);
        refreshGroupsButton.textContent = state.metrics?.groupsRefreshing
          ? getGroupsRefreshLabel(state.metrics?.groupRefreshProgress)
          : 'Atualizar grupos';
        const whatsAppAction = resolveWhatsAppAction(state);
        whatsAppActionButton.hidden = !whatsAppAction;
        whatsAppActionButton.disabled = !whatsAppAction || Boolean(whatsAppAction.disabled);
        whatsAppActionButton.textContent = whatsAppAction?.label || 'WhatsApp';
        whatsAppActionButton.dataset.action = whatsAppAction?.type || '';
        renderWorkspaceHero(auth, state);
        renderMetrics(state.metrics || {}, state.activity || []);
        renderActivityFeed(state.activity || []);
        renderAdminArea(auth, state.admin || null);

        if (state.qrDataUrl) {
          qr.src = state.qrDataUrl;
          qr.style.display = 'block';
        } else {
          qr.removeAttribute('src');
          qr.style.display = 'none';
        }

        renderGroups(state.groups, groupSearchInput.value);
      }

      function renderMetrics(metrics, activity) {
        metricTelegramReceived.textContent = formatNumber(metrics.totalTelegramReceived || 0);
        metricTelegramMeta.textContent = metrics.lastTelegramMessageAt
          ? 'Última entrada: ' + formatDateTime(metrics.lastTelegramMessageAt)
          : 'Nenhuma mensagem recebida ainda.';

        metricForwardBatches.textContent = formatNumber(metrics.totalForwardBatches || 0);
        metricForwardMeta.textContent = metrics.lastForwardedAt
          ? 'Último envio: ' + formatDateTime(metrics.lastForwardedAt)
          : 'Nenhum envio realizado ainda.';

        metricDeliveries.textContent = formatNumber(metrics.totalWhatsAppDeliveries || 0);
        metricDeliveriesMeta.textContent =
          'Msgs encaminhadas: ' +
          formatNumber(metrics.totalForwardedMessages || 0) +
          ' | grupos selecionados: ' +
          formatNumber(metrics.selectedGroupCount || 0);

        metricErrors.textContent = formatNumber(metrics.totalErrors || 0);
        metricErrorsMeta.textContent = buildErrorMetaWithProgress(metrics, activity);
      }

      function renderTelegramMode(mode) {
        const isUserMode = mode !== 'bot';
        telegramUserFields.hidden = !isUserMode;
        telegramBotFields.hidden = isUserMode;
        telegramUserAuthPanel.hidden = !isUserMode;
      }

      function renderTelegramChats(telegramState, selectedChannel) {
        const chats = Array.isArray(telegramState.availableChats) ? telegramState.availableChats : [];
        const currentValue = normalizeTelegramChannelValue(selectedChannel || '');
        telegramChatSelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = chats.length
          ? 'Selecione um grupo ou canal'
          : 'Conecte sua conta para carregar os grupos';
        telegramChatSelect.appendChild(placeholder);

        chats.forEach((chat) => {
          const option = document.createElement('option');
          option.value = chat.id;
          option.textContent = chat.name + ' (' + (chat.type === 'channel' ? 'canal' : 'grupo') + ')';
          telegramChatSelect.appendChild(option);
        });

        if (settingsDraftDirty && telegramChatSelect.value) {
          return;
        }

        const selectedChat = chats.find(
          (chat) => normalizeTelegramChannelValue(chat.id) === currentValue
        );

        if (selectedChat) {
          telegramChatSelect.value = String(selectedChat.id);
        }
      }

      function renderTelegramAuthPanel(telegramState, config) {
        const isUserMode = (config.telegramMode || 'user') !== 'bot';

        telegramUserAuthPanel.hidden = !isUserMode;

        if (!isUserMode) {
          return;
        }

        const authPhase = telegramState.authPhase || 'idle';
        const status = currentState?.telegramStatus || 'not_configured';
        const userLabel = telegramState.user?.name
          ? 'Conta conectada: ' + telegramState.user.name + (telegramState.user.username ? ' (' + telegramState.user.username + ')' : '') + '.'
          : '';

        telegramAuthHint.textContent =
          userLabel ||
          (authPhase === 'password_required'
            ? 'O Telegram pediu a senha em duas etapas para concluir o login.'
            : authPhase === 'code_required'
              ? 'Digite o código recebido no Telegram para concluir a conexão.'
              : status === 'listening'
                ? 'Sua sessão do Telegram está ativa e pronta para ler mensagens sem bot.'
                : 'Sua sessão do Telegram ficará salva para reconectar sem bot.');

        telegramLoginCodeInput.disabled = authPhase === 'password_required' ? true : false;
        telegramCompleteAuthButton.textContent =
          authPhase === 'password_required'
            ? 'Enviar senha em duas etapas'
            : 'Concluir login no Telegram';
      }

      function renderWorkspaceHero(auth, state) {
        const user = auth.user || {};
        const metrics = state.metrics || {};

        workspacePlanBadge.textContent = 'Plano ' + humanizePlan(user.plan);
        workspaceAccountBadge.textContent = 'Conta ' + humanizeAccountStatus(user.accountStatus);
        heroGroupCount.textContent = formatNumber(metrics.selectedGroupCount || 0);
        heroForwardCount.textContent = formatNumber(metrics.totalForwardedMessages || 0);
        heroLastActivity.textContent = metrics.lastActivityAt
          ? formatDateTime(metrics.lastActivityAt)
          : 'Sem atividade';
      }

      function renderActivityFeed(activity) {
        activityFeed.innerHTML = '';

        if (!Array.isArray(activity) || !activity.length) {
          activityFeed.innerHTML = '<div class="activity-item"><strong>Nenhuma atividade recente</strong><p>Assim que sua ponte começar a operar, os eventos aparecerão aqui.</p></div>';
          return;
        }

        activity.slice(0, 12).forEach((event) => {
          const item = document.createElement('article');
          item.className = 'activity-item';
          item.dataset.level = event.level || 'info';
          item.innerHTML = \`
            <strong>\${escapeHtml(humanizeMessage(event.message || 'Evento registrado'))}</strong>
            <p>\${escapeHtml(humanizeActivityMeta(event))}</p>
          \`;
          activityFeed.appendChild(item);
        });
      }

      function renderAdminArea(auth, admin) {
        const isAdmin = auth.user?.role === 'admin';

        adminShell.hidden = !isAdmin;

        if (!isAdmin || !admin) {
          return;
        }

        renderAdminSummary(admin.summary || {});
        populateAdminOptions(admin.options || {});
        renderAdminUsers(admin.users || []);
      }

      function renderAdminSummary(summary) {
        adminTotalUsers.textContent = formatNumber(summary.totalUsers || 0);
        adminActiveBridges.textContent = formatNumber(summary.activeBridges || 0);
        adminReadySessions.textContent = formatNumber(summary.readySessions || 0);
        adminPaidPlans.textContent = formatNumber(summary.paidPlans || 0);
      }

      function populateAdminOptions(options) {
        populateSelect(adminUserRole, options.roles || []);
        populateSelect(adminUserPlan, options.plans || []);
        populateSelect(adminUserAccountStatus, options.accountStatuses || []);
        populateSelect(adminUserBillingStatus, options.billingStatuses || []);
      }

      function populateSelect(selectElement, values) {
        const currentValue = selectElement.value;
        selectElement.innerHTML = '';

        values.forEach((value) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = humanizeAdminOption(selectElement.id, value);
          selectElement.appendChild(option);
        });

        if (values.includes(currentValue)) {
          selectElement.value = currentValue;
        }
      }

      function renderAdminUsers(users) {
        const query = normalize(adminUserSearchInput.value);
        const filteredUsers = query
          ? users.filter((user) => normalize(user.name).includes(query) || normalize(user.email).includes(query))
          : users;

        if (!selectedAdminUserId || !filteredUsers.some((user) => user.id === selectedAdminUserId)) {
          selectedAdminUserId = filteredUsers[0]?.id || '';
        }

        adminUserList.innerHTML = '';

        if (!filteredUsers.length) {
          adminUserList.innerHTML = '<div class="activity-item"><strong>Nenhum usuário encontrado</strong><p>Tente outro termo de busca para localizar a conta desejada.</p></div>';
          renderAdminUserDetail(null);
          return;
        }

        filteredUsers.forEach((user) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'admin-user-card' + (user.id === selectedAdminUserId ? ' active' : '');
          item.innerHTML = \`
            <div class="admin-user-card-header">
              <div>
                <p class="admin-user-card-title">\${escapeHtml(user.name || user.email)}</p>
                <p class="admin-user-card-email">\${escapeHtml(user.email)}</p>
              </div>
              <span class="mini-pill">\${escapeHtml(humanizeRole(user.role))}</span>
            </div>
            <div class="admin-user-pills">
              <span class="mini-pill">\${escapeHtml(humanizePlan(user.plan))}</span>
              <span class="mini-pill">\${escapeHtml(humanizeAccountStatus(user.accountStatus))}</span>
              <span class="mini-pill">\${escapeHtml(humanizeBillingStatus(user.billingStatus))}</span>
            </div>
            <div class="admin-user-meta">
              <span>Último login: \${escapeHtml(user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca')}</span>
              <span>WhatsApp: \${escapeHtml(humanizeStatusToken(user.workspace?.whatsAppStatus))}</span>
            </div>
          \`;
          item.addEventListener('click', () => {
            selectedAdminUserId = user.id;
            renderAdminUsers(users);
          });
          adminUserList.appendChild(item);
        });

        renderAdminUserDetail(filteredUsers.find((user) => user.id === selectedAdminUserId) || null);
      }

      function renderAdminUserDetail(user) {
        const hasUser = Boolean(user);

        adminUserIdInput.value = user?.id || '';
        adminUserName.textContent = user?.name || 'Selecione um usuário';
        adminUserEmail.textContent = user
          ? user.email
          : 'Escolha um usuário na lista para gerenciar plano, acesso e observações internas.';

        adminUserForm.querySelectorAll('select, textarea, button').forEach((element) => {
          element.disabled = !hasUser;
        });

        if (!hasUser) {
          adminUserRole.value = '';
          adminUserPlan.value = '';
          adminUserAccountStatus.value = '';
          adminUserBillingStatus.value = '';
          adminUserNote.value = '';
          adminUserCreated.textContent = '-';
          adminUserLastLogin.textContent = '-';
          adminUserLastActivity.textContent = '-';
          adminUserWorkspace.textContent = 'Selecione um usuário para ver o resumo operacional.';
          adminUserPerformance.textContent = 'Selecione um usuário para ver métricas resumidas da operação.';
          return;
        }

        adminUserRole.value = user.role || 'member';
        adminUserPlan.value = user.plan || 'beta';
        adminUserAccountStatus.value = user.accountStatus || 'active';
        adminUserBillingStatus.value = user.billingStatus || 'beta';
        adminUserNote.value = user.internalNote || '';
        adminUserCreated.textContent = user.createdAt ? formatDateTime(user.createdAt) : '-';
        adminUserLastLogin.textContent = user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca';
        adminUserLastActivity.textContent = user.metrics?.lastActivityAt
          ? formatDateTime(user.metrics.lastActivityAt)
          : 'Sem atividade';
        adminUserWorkspace.textContent = buildAdminWorkspaceCopy(user);
        adminUserPerformance.textContent = buildAdminPerformanceCopy(user);
      }

      function humanizePlan(plan) {
        return ({
          beta: 'Beta',
          starter: 'Starter',
          pro: 'Pro',
          enterprise: 'Enterprise'
        })[String(plan || '').toLowerCase()] || 'Beta';
      }

      function humanizeAccountStatus(status) {
        return ({
          active: 'Ativa',
          trial: 'Trial',
          suspended: 'Suspensa'
        })[String(status || '').toLowerCase()] || 'Ativa';
      }

      function humanizeBillingStatus(status) {
        return ({
          beta: 'Beta',
          pending: 'Pendente',
          paid: 'Em dia',
          overdue: 'Atrasada'
        })[String(status || '').toLowerCase()] || 'Beta';
      }

      function humanizeRole(role) {
        return ({
          admin: 'Administrador',
          member: 'Cliente'
        })[String(role || '').toLowerCase()] || 'Cliente';
      }

      function humanizeStatusToken(status) {
        const map = {
          ready: 'pronto',
          authenticated: 'autenticado',
          connecting: 'conectando',
          qr_required: 'QR pendente',
          reconnecting: 'reconectando',
          disconnected: 'desconectado',
          not_configured: 'não configurado',
          listening: 'escutando',
          offline: 'offline',
          browser_closed: 'navegador fechado',
          error: 'com erro'
        };

        return map[String(status || '').toLowerCase()] || humanizeMessage(String(status || '').replaceAll('_', ' '));
      }

      function humanizeAdminOption(selectId, value) {
        if (selectId === 'admin-user-role') {
          return humanizeRole(value);
        }

        if (selectId === 'admin-user-plan') {
          return humanizePlan(value);
        }

        if (selectId === 'admin-user-account-status') {
          return humanizeAccountStatus(value);
        }

        if (selectId === 'admin-user-billing-status') {
          return humanizeBillingStatus(value);
        }

        return humanizeMessage(value);
      }

      function humanizeActivityMeta(event) {
        const parts = [];

        if (event?.type) {
          parts.push('Tipo: ' + humanizeMessage(String(event.type).replaceAll('_', ' ')));
        }

        if (event?.at) {
          parts.push('Horário: ' + formatDateTime(event.at));
        }

        return parts.join(' | ');
      }

      function buildAdminWorkspaceCopy(user) {
        const workspace = user?.workspace || {};
        const parts = [
          'Plano ' + humanizePlan(user?.plan),
          'Conta ' + humanizeAccountStatus(user?.accountStatus),
          'Ponte ' + (workspace.bridgeEnabled ? 'ligada' : 'desligada'),
          'WhatsApp ' + humanizeStatusToken(workspace.whatsAppStatus),
          'Telegram ' + humanizeStatusToken(workspace.telegramStatus)
        ];

        if (workspace.telegramChannel) {
          parts.push('Origem ' + workspace.telegramChannel);
        }

        parts.push(
          (workspace.selectedGroupCount || 0) +
            ' grupo(s) selecionado(s)'
        );

        return parts.join(' • ');
      }

      function buildAdminPerformanceCopy(user) {
        const metrics = user?.metrics || {};

        return [
          formatNumber(metrics.totalTelegramReceived || 0) + ' mensagens recebidas no Telegram',
          formatNumber(metrics.totalForwardedMessages || 0) + ' mensagens encaminhadas',
          formatNumber(metrics.totalWhatsAppDeliveries || 0) + ' entregas no WhatsApp',
          formatNumber(metrics.totalErrors || 0) + ' erro(s) acumulado(s)'
        ].join(' • ');
      }

      function renderAuth(auth) {
        const user = auth.user || null;

        userChip.hidden = !auth.authenticated;
        logoutButton.hidden = !auth.authenticated;
        userChip.textContent = user ? (user.name || user.email) + ' | ' + user.email : '';

        googleLoginLink.hidden = !auth.googleEnabled;
        authSeparator.hidden = !auth.googleEnabled;
        googleLoginLink.setAttribute('aria-disabled', auth.googleEnabled ? 'false' : 'true');
        googleLoginLink.href = auth.googleEnabled ? '/auth/google' : '#';
        googleHint.hidden = false;
        googleHint.textContent = auth.googleEnabled
          ? 'Use sua conta Google para entrar com mais agilidade.'
          : 'Login com Google estará disponível em breve.';

        loginTab.classList.toggle('active', authMode === 'login');
        registerTab.classList.toggle('active', authMode === 'register');
        loginForm.hidden = authMode !== 'login';
        registerForm.hidden = authMode !== 'register';
      }

      function renderGroups(groups, searchValue = '') {
        groupsContainer.innerHTML = '';
        const normalizedSearch = normalize(groupSearchInput.value || searchValue);
        const filteredGroups = normalizedSearch
          ? groups.filter((group) => normalize(group.name).includes(normalizedSearch))
          : groups;

        if (!groups.length) {
          groupsContainer.innerHTML = '<div class="group"><div class="group-name">Nenhum grupo administrado encontrado ainda.</div></div>';
          return;
        }

        if (!filteredGroups.length) {
          groupsContainer.innerHTML = '<div class="group"><div class="group-name">Nenhum grupo encontrado para essa busca.</div></div>';
          return;
        }

        filteredGroups.forEach((group) => {
          const wrapper = document.createElement('label');
          wrapper.className = 'group';
          wrapper.innerHTML = \`
            <input type="checkbox" value="\${group.id}" \${selectedGroupIds.has(group.id) ? 'checked' : ''} />
            <div class="group-name">\${escapeHtml(group.name)}</div>
          \`;
          const checkbox = wrapper.querySelector('input[type="checkbox"]');
          checkbox.addEventListener('change', () => {
            selectedGroupIdsDirty = true;

            if (checkbox.checked) {
              selectedGroupIds.add(group.id);
            } else {
              selectedGroupIds.delete(group.id);
            }
          });
          groupsContainer.appendChild(wrapper);
        });
      }

      async function requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json') ? await response.json() : {};

        if (response.status === 401) {
          currentState = { auth: payload };
          render(currentState);
        }

        if (!response.ok) {
          throw new Error(humanizeMessage(payload.error || 'Não foi possível concluir a solicitação.'));
        }

        return payload;
      }

      function setFeedback(message, tone = 'error') {
        if (!message) {
          feedbackBanner.hidden = true;
          feedbackBanner.textContent = '';
          feedbackBanner.className = 'feedback';
          return;
        }

        feedbackBanner.hidden = false;
        feedbackBanner.textContent = humanizeMessage(message);
        feedbackBanner.className = 'feedback ' + tone;
      }

      function setButtonLoading(button, isLoading, idleLabel, loadingLabel) {
        if (!button) {
          return;
        }

        button.disabled = isLoading;
        button.textContent = isLoading ? loadingLabel : idleLabel;
      }

      function humanizeMessage(message) {
        return String(message || '')
          .replaceAll('Nao foi possivel', 'Não foi possível')
          .replaceAll('concluir a solicitacao', 'concluir a solicitação')
          .replaceAll('Configuracao', 'Configuração')
          .replaceAll('configuracao', 'configuração')
          .replaceAll('Configuracao salva com sucesso.', 'Configuração salva com sucesso.')
          .replaceAll('Email ou senha invalidos.', 'E-mail ou senha inválidos.')
          .replaceAll('Email', 'E-mail')
          .replaceAll('email ou senha invalidos.', 'e-mail ou senha inválidos.')
          .replaceAll('Sessao', 'Sessão')
          .replaceAll('sessao', 'sessão')
          .replaceAll('operacao', 'operação')
          .replaceAll('Operacao', 'Operação')
          .replaceAll('usuario', 'usuário')
          .replaceAll('Usuario', 'Usuário')
          .replaceAll('experiencia', 'experiência')
          .replaceAll('Experiencia', 'Experiência')
          .replaceAll('proxima', 'próxima')
          .replaceAll('Proxima', 'Próxima')
          .replaceAll('Autenticacao', 'Autenticação')
          .replaceAll('autenticacao', 'autenticação')
          .replaceAll('conversao', 'conversão')
          .replaceAll('Conversao', 'Conversão')
          .replaceAll('botao', 'botão')
          .replaceAll('Botao', 'Botão')
          .replaceAll('Fundacao', 'Fundação')
          .replaceAll('fundacao', 'fundação')
          .replaceAll('cobranca', 'cobrança')
          .replaceAll('Cobranca', 'Cobrança')
          .replaceAll('atencao', 'atenção')
          .replaceAll('Ate', 'Até')
          .replaceAll('Ultima', 'Última')
          .replaceAll('Ultimo', 'Último')
          .replaceAll('versao', 'versão')
          .replaceAll('Versao', 'Versão')
          .replaceAll('voce', 'você')
          .replaceAll('Voce', 'Você')
          .replaceAll('sincronizacao', 'sincronização')
          .replaceAll('Sincronizacao', 'Sincronização')
          .replaceAll('recuperacao', 'recuperação')
          .replaceAll('Recuperacao', 'Recuperação')
          .replaceAll('disponivel', 'disponível')
          .replaceAll('Disponivel', 'Disponível');
      }

      function setAuthMode(nextMode) {
        authMode = nextMode;

        if (currentState) {
          renderAuth(currentState.auth || {});
        }
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          const payload = {
            telegramMode: telegramModeInput.value,
            telegramBotToken: telegramBotTokenInput.value.trim(),
            telegramApiId: telegramApiIdInput.value.trim(),
            telegramApiHash: telegramApiHashInput.value.trim(),
            telegramPhone: telegramPhoneInput.value.trim(),
            telegramChannel: document.getElementById('telegramChannel').value.trim()
          };

          currentState = await requestJson('/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });

          settingsDraftDirty = false;
          setFeedback('Configuração salva com sucesso.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      saveGroupsButton.addEventListener('click', async () => {
        try {
          currentState = await requestJson('/api/groups', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ selectedGroupIds: [...selectedGroupIds] })
          });

          selectedGroupIdsDirty = false;
          selectedGroupIds = new Set(currentState.config.selectedGroupIds || []);
          setFeedback('Grupos salvos com sucesso.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      refreshGroupsButton.addEventListener('click', async () => {
        try {
          currentState = await requestJson('/api/refresh-groups', {
            method: 'POST'
          });

          setFeedback('Grupos atualizados.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      whatsAppActionButton.addEventListener('click', async () => {
        const action = whatsAppActionButton.dataset.action;

        if (!action) {
          return;
        }

        if (action === 'reconnect') {
          try {
            currentState = await requestJson('/api/whatsapp/reconnect', {
              method: 'POST'
            });

            setFeedback(
              'Tentando reconectar o WhatsApp. Se a janela foi fechada, ela pode abrir novamente.',
              'success'
            );
            render(currentState);
          } catch (error) {
            setFeedback(error.message, 'error');
          }

          return;
        }

        const confirmed = window.confirm(
          'Isso vai desconectar a conta atual do WhatsApp neste sistema e gerar um novo QR Code. Deseja continuar?'
        );

        if (!confirmed) {
          return;
        }

        try {
          currentState = await requestJson('/api/whatsapp/reset-session', {
            method: 'POST'
          });

          setFeedback(
            'Conta do WhatsApp desconectada neste sistema. Assim que o QR aparecer, escaneie novamente no celular.',
            'success'
          );
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      systemToggleButton.addEventListener('click', async () => {
        try {
          const bridgeEnabled = !(currentState?.config?.bridgeEnabled);

          currentState = await requestJson('/api/system-power', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bridgeEnabled })
          });

          setFeedback(
            bridgeEnabled ? 'Sistema ligado com sucesso.' : 'Sistema desligado com sucesso.',
            'success'
          );
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      telegramModeInput.addEventListener('change', () => {
        settingsDraftDirty = true;
        renderTelegramMode(telegramModeInput.value);
      });

      telegramChatSelect.addEventListener('change', () => {
        settingsDraftDirty = true;
        if (telegramChatSelect.value) {
          document.getElementById('telegramChannel').value = telegramChatSelect.value;
        }
      });

      [
        telegramApiIdInput,
        telegramApiHashInput,
        telegramPhoneInput,
        telegramBotTokenInput,
        document.getElementById('telegramChannel')
      ].forEach((input) => {
        input.addEventListener('input', () => {
          settingsDraftDirty = true;
        });
      });

      telegramRefreshChatsButton.addEventListener('click', async () => {
        try {
          currentState = await requestJson('/api/telegram/refresh-chats', {
            method: 'POST'
          });

          setFeedback('Lista de grupos do Telegram atualizada.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      telegramSendCodeButton.addEventListener('click', async () => {
        setButtonLoading(telegramSendCodeButton, true, 'Enviar código', 'Enviando código...');

        try {
          currentState = await requestJson('/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              telegramMode: telegramModeInput.value,
              telegramApiId: telegramApiIdInput.value.trim(),
              telegramApiHash: telegramApiHashInput.value.trim(),
              telegramPhone: telegramPhoneInput.value.trim(),
              telegramChannel: document.getElementById('telegramChannel').value.trim(),
              telegramBotToken: telegramBotTokenInput.value.trim()
            })
          });

          currentState = await requestJson('/api/telegram/send-code', {
            method: 'POST'
          });

          setFeedback('Código do Telegram enviado. Agora confirme no campo ao lado.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(telegramSendCodeButton, false, 'Enviar código', 'Enviando código...');
        }
      });

      telegramCompleteAuthButton.addEventListener('click', async () => {
        setButtonLoading(
          telegramCompleteAuthButton,
          true,
          'Concluir login no Telegram',
          'Conectando Telegram...'
        );

        try {
          currentState = await requestJson('/api/telegram/complete-auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              code: telegramLoginCodeInput.value.trim(),
              password: telegramTwoFactorPasswordInput.value
            })
          });

          telegramLoginCodeInput.value = '';
          telegramTwoFactorPasswordInput.value = '';
          setFeedback('Conta do Telegram conectada com sucesso.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(
            telegramCompleteAuthButton,
            false,
            'Concluir login no Telegram',
            'Conectando Telegram...'
          );
        }
      });

      telegramDisconnectButton.addEventListener('click', async () => {
        const confirmed = window.confirm(
          'Isso vai desconectar a sessão atual do Telegram nesta conta. Deseja continuar?'
        );

        if (!confirmed) {
          return;
        }

        setButtonLoading(telegramDisconnectButton, true, 'Desconectar Telegram', 'Desconectando...');

        try {
          currentState = await requestJson('/api/telegram/disconnect', {
            method: 'POST'
          });

          telegramLoginCodeInput.value = '';
          telegramTwoFactorPasswordInput.value = '';
          setFeedback('Sessão do Telegram desconectada.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(telegramDisconnectButton, false, 'Desconectar Telegram', 'Desconectando...');
        }
      });

      groupSearchInput.addEventListener('input', () => {
        if (!currentState) {
          return;
        }

        renderGroups(currentState.groups, groupSearchInput.value);
      });

      adminUserSearchInput.addEventListener('input', () => {
        if (!currentState?.admin) {
          return;
        }

        renderAdminUsers(currentState.admin.users || []);
      });

      adminUserForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!adminUserIdInput.value) {
          return;
        }

        setButtonLoading(adminSaveButton, true, 'Salvar alterações da conta', 'Salvando...');

        try {
          currentState = await requestJson('/api/admin/users/' + encodeURIComponent(adminUserIdInput.value), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              role: adminUserRole.value,
              plan: adminUserPlan.value,
              accountStatus: adminUserAccountStatus.value,
              billingStatus: adminUserBillingStatus.value,
              internalNote: adminUserNote.value
            })
          });

          setFeedback('Conta atualizada com sucesso.', 'success');
          render(currentState);
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(adminSaveButton, false, 'Salvar alterações da conta', 'Salvando...');
        }
      });

      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFeedback('');
        setButtonLoading(loginSubmitButton, true, 'Entrar no painel', 'Entrando...');

        try {
          await requestJson('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email: document.getElementById('login-email').value.trim(),
              password: document.getElementById('login-password').value
            })
          });

          loginForm.reset();
          setFeedback('Login realizado com sucesso.', 'success');
          await fetchState();
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(loginSubmitButton, false, 'Entrar no painel', 'Entrando...');
        }
      });

      registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFeedback('');
        setButtonLoading(registerSubmitButton, true, 'Criar conta', 'Criando conta...');

        try {
          await requestJson('/api/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: document.getElementById('register-name').value.trim(),
              email: document.getElementById('register-email').value.trim(),
              password: document.getElementById('register-password').value
            })
          });

          registerForm.reset();
          setFeedback('Conta criada com sucesso.', 'success');
          await fetchState();
        } catch (error) {
          setFeedback(error.message, 'error');
        } finally {
          setButtonLoading(registerSubmitButton, false, 'Criar conta', 'Criando conta...');
        }
      });

      forgotPasswordButton.addEventListener('click', () => {
        setFeedback('A recuperação de senha estará disponível em breve.', 'success');
      });

      logoutButton.addEventListener('click', async () => {
        try {
          await requestJson('/api/auth/logout', {
            method: 'POST'
          });

          setFeedback('Sessão encerrada.', 'success');
          await fetchState();
        } catch (error) {
          setFeedback(error.message, 'error');
        }
      });

      loginTab.addEventListener('click', () => {
        setFeedback('');
        setAuthMode('login');
      });

      registerTab.addEventListener('click', () => {
        setFeedback('');
        setAuthMode('register');
      });

      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function normalize(value) {
        return String(value || '')
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .toLowerCase()
          .trim();
      }

      function formatNumber(value) {
        return Number(value || 0).toLocaleString('pt-BR');
      }

      function formatDateTime(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
          return 'agora';
        }

        return date.toLocaleString('pt-BR');
      }

      function getGroupsRefreshLabel(progress) {
        const safeProgress = progress || {};

        if ((safeProgress.total || 0) > 0) {
          return 'Buscando grupos... ' + formatNumber(safeProgress.percent || 0) + '%';
        }

        if (safeProgress.phase === 'loading_groups') {
          return 'Buscando grupos... preparando';
        }

        return 'Buscando grupos...';
      }

      function normalizeTelegramChannelValue(value) {
        const normalized = String(value || '').trim().toLowerCase();

        if (!normalized || normalized.startsWith('@')) {
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

      function buildErrorMetaWithProgress(metrics, activity) {
        if (metrics.groupsRefreshing) {
          const progress = metrics.groupRefreshProgress || {};

          if ((progress.total || 0) > 0) {
            return (
              'Sincronizando grupos do WhatsApp: ' +
              formatNumber(progress.processed || 0) +
              '/' +
              formatNumber(progress.total || 0) +
              ' verificados (' +
              formatNumber(progress.percent || 0) +
              '%).'
            );
          }

          return 'Buscando grupos do WhatsApp. Aguarde enquanto a lista inicial é carregada.';
        }

        return buildErrorMeta(metrics, activity);
      }

      function buildErrorMeta(metrics, activity) {
        if (metrics.groupsRefreshing) {
          return 'Buscando grupos do WhatsApp. Na primeira sincronização isso pode levar alguns minutos.';
        }

        if ((metrics.pendingTelegramCount || 0) > 0) {
          return (
            formatNumber(metrics.pendingTelegramCount || 0) +
            ' mensagem(ns) aguardando o WhatsApp voltar para concluir o envio.'
          );
        }

        if (metrics.lastErrorAt) {
          return 'Último erro: ' + formatDateTime(metrics.lastErrorAt);
        }

        const lastEvent = Array.isArray(activity) && activity.length ? activity[0] : null;

        if (lastEvent?.at) {
          return 'Última atividade: ' + formatDateTime(lastEvent.at);
        }

        return 'Tudo limpo por enquanto.';
      }

      function resolveWhatsAppAction(state) {
        if (!state || !state.auth?.authenticated) {
          return null;
        }

        if (state.whatsAppStatus === 'reconnecting') {
          return { type: 'reconnect', label: 'Reconectando...', disabled: true };
        }

        if (state.whatsAppStatus === 'resetting') {
          return { type: 'reset', label: 'Gerando novo QR...', disabled: true };
        }

        if (state.issue?.canReconnect || state.whatsAppStatus === 'browser_closed') {
          return { type: 'reconnect', label: 'Reconectar WhatsApp', disabled: false };
        }

        return { type: 'reset', label: 'Trocar conta do WhatsApp', disabled: false };
      }

      function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('bridge-theme', theme);
        themeToggleButton.textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
      }

      themeToggleButton.addEventListener('click', () => {
        const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
      });

      const storedTheme = localStorage.getItem('bridge-theme');
      const preferredTheme = storedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      applyTheme(preferredTheme);

      const authMessage = new URL(window.location.href).searchParams.get('auth');

      if (authMessage === 'google_failed') {
        setFeedback('Não foi possível concluir o login com Google.', 'error');
      } else if (authMessage === 'google_unavailable') {
        setFeedback('Login com Google estará disponível em breve.', 'error');
      }

      if (authMessage) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('auth');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
      }

      fetchState();
      setInterval(() => {
        fetchState().catch(() => {});
      }, 5000);
    </script>
  </body>
</html>`;
}
