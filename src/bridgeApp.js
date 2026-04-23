import path from 'node:path';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import pkg from 'whatsapp-web.js';
import { BridgeManager } from './bridgeManager.js';

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
    const respondWithState = async (request, response) => {
      const auth = this.auth
        ? this.auth.getClientSession(request.user)
        : { authenticated: true, googleEnabled: false, user: null };
      const runtime = request.user ? await this.manager.getRuntimeForUser(request.user) : null;

      response.json({
        auth,
        ...(runtime ? await runtime.getState() : {})
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
      const incomingTelegramBotToken = String(request.body?.telegramBotToken ?? '').trim();
      const telegramChannel = String(request.body?.telegramChannel ?? '').trim();
      const telegramBotToken = incomingTelegramBotToken || runtime.config.telegramBotToken;

      await runtime.updateSettings({
        telegramBotToken,
        telegramChannel
      });
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

function renderPage() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ponte Telegram -> WhatsApp</title>
    <style>
      :root {
        --bg-top: #f7f5ef;
        --bg: #eef1e7;
        --panel: rgba(255, 253, 248, 0.9);
        --panel-strong: rgba(255, 255, 255, 0.98);
        --ink: #172117;
        --muted: #5f6d61;
        --accent: #1f9254;
        --accent-2: #17698d;
        --border: #d8ddd0;
        --soft: #eef3ea;
        --group-bg: #fcfcf8;
        --input-bg: rgba(255, 255, 255, 0.96);
        --log-bg: #121714;
        --log-ink: #e8f4ea;
        --shadow: rgba(23, 33, 23, 0.08);
        --hero-a: rgba(23, 105, 141, 0.16);
        --hero-b: rgba(31, 146, 84, 0.13);
        --spotlight-bg: linear-gradient(145deg, #17332f 0%, #1e5d57 48%, #0f7a62 100%);
        --spotlight-ink: #f7fff9;
        --spotlight-muted: rgba(242, 250, 246, 0.78);
        --spotlight-border: rgba(255, 255, 255, 0.14);
        --accent-soft: rgba(31, 146, 84, 0.14);
        --page-stroke: rgba(255, 255, 255, 0.72);
      }

      :root[data-theme="dark"] {
        --bg-top: #151d19;
        --bg: #0c120f;
        --panel: rgba(17, 24, 21, 0.92);
        --panel-strong: rgba(21, 29, 25, 0.98);
        --ink: #f4fbf6;
        --muted: #c3d2c8;
        --accent: #2fc57b;
        --accent-2: #2e8ab8;
        --border: #34453b;
        --soft: #1a241f;
        --group-bg: #131a16;
        --input-bg: #0f1512;
        --log-bg: #090d0b;
        --log-ink: #def0e1;
        --shadow: rgba(0, 0, 0, 0.38);
        --hero-a: rgba(46, 138, 184, 0.22);
        --hero-b: rgba(47, 197, 123, 0.18);
        --spotlight-bg: linear-gradient(150deg, #112926 0%, #17433f 54%, #125942 100%);
        --spotlight-ink: #f6fff8;
        --spotlight-muted: rgba(232, 244, 236, 0.82);
        --spotlight-border: rgba(255, 255, 255, 0.1);
        --accent-soft: rgba(47, 197, 123, 0.16);
        --page-stroke: rgba(255, 255, 255, 0.03);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, var(--hero-a), transparent 24%),
          radial-gradient(circle at 85% 15%, var(--hero-b), transparent 30%),
          radial-gradient(circle at 20% 80%, var(--accent-soft), transparent 24%),
          linear-gradient(180deg, var(--bg-top) 0%, var(--bg) 100%);
        font-family: "Trebuchet MS", "Lucida Sans Unicode", "Segoe UI", sans-serif;
        transition: background 180ms ease, color 180ms ease;
      }

      main {
        max-width: 1160px;
        margin: 0 auto;
        padding: 28px 18px 54px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 28px;
      }

      .topbar-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(36px, 5vw, 68px);
        line-height: 0.92;
        letter-spacing: -0.05em;
        color: var(--ink);
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.06);
      }

      .lead {
        max-width: 680px;
        margin: 0 0 24px;
        color: var(--muted);
        line-height: 1.65;
        font-size: 18px;
      }

      .feedback {
        margin: 0 0 18px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--ink);
      }

      .feedback.error {
        border-color: rgba(178, 71, 29, 0.42);
        background: rgba(178, 71, 29, 0.12);
      }

      .feedback.success {
        border-color: rgba(29, 143, 87, 0.34);
        background: rgba(29, 143, 87, 0.12);
      }

      .user-chip {
        padding: 11px 15px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--panel-strong);
        color: var(--ink);
        font-size: 14px;
        box-shadow: 0 12px 28px var(--shadow);
      }

      .auth-shell {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 22px;
      }

      .auth-spotlight {
        position: relative;
        overflow: hidden;
        background: var(--spotlight-bg);
        color: var(--spotlight-ink);
        border: 1px solid var(--spotlight-border);
        min-height: 520px;
      }

      .auth-spotlight::after {
        content: '';
        position: absolute;
        inset: auto -34px -46px auto;
        width: 220px;
        height: 220px;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.12), transparent 68%);
        pointer-events: none;
      }

      .auth-spotlight::before {
        content: '';
        position: absolute;
        inset: -60px auto auto -60px;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(255, 255, 255, 0.18), transparent 70%);
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
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 18px;
      }

      .auth-title {
        margin: 0 0 14px;
        font-size: clamp(32px, 4vw, 48px);
        line-height: 0.98;
        max-width: 11ch;
      }

      .auth-list {
        list-style: none;
        margin: 26px 0 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }

      .auth-list li {
        padding: 15px 16px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.08);
        color: var(--spotlight-ink);
        backdrop-filter: blur(8px);
      }

      .auth-copy {
        max-width: 34ch;
        color: var(--spotlight-muted);
        line-height: 1.7;
        font-size: 16px;
      }

      .spotlight-meta {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin: 22px 0 4px;
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
        padding: 24px;
        box-shadow: 0 18px 40px var(--shadow);
        backdrop-filter: blur(18px);
      }

      .card h2 {
        margin: 0 0 14px;
        font-size: 22px;
      }

      label {
        display: block;
        margin-bottom: 9px;
        font-size: 14px;
        color: var(--muted);
      }

      input[type="text"], input[type="password"] {
        width: 100%;
        padding: 15px 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--input-bg);
        color: var(--ink);
        font: inherit;
        margin-bottom: 14px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
      }

      input[type="text"]:focus,
      input[type="password"]:focus {
        outline: none;
        border-color: color-mix(in srgb, var(--accent) 54%, var(--border));
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
      }

      button,
      .button-link {
        border: 0;
        border-radius: 999px;
        background: var(--accent);
        color: white;
        font: inherit;
        padding: 13px 20px;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-weight: 600;
        box-shadow: 0 14px 28px color-mix(in srgb, var(--accent) 20%, transparent);
      }

      button.secondary,
      .button-link.secondary {
        background: var(--accent-2);
      }

      button.ghost,
      .button-link.ghost {
        background: var(--panel);
        color: var(--ink);
        border: 1px solid var(--border);
        box-shadow: none;
      }

      button.warn {
        background: #b2471d;
      }

      button:disabled,
      .button-link[aria-disabled="true"] {
        cursor: not-allowed;
        opacity: 0.58;
        pointer-events: none;
      }

      .button-link {
        border-radius: 999px;
        width: 100%;
      }

      .google-button {
        background: var(--panel-strong);
        color: var(--ink);
        border: 1px solid var(--border);
        box-shadow: none;
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
        background: var(--panel-strong);
        color: var(--ink);
        border: 1px solid var(--border);
      }

      .auth-form {
        display: grid;
      }

      .auth-panel-title {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1;
      }

      .auth-panel-copy {
        margin: 0 0 22px;
        color: var(--muted);
        line-height: 1.65;
      }

      .auth-separator {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--muted);
        margin: 4px 0 12px;
      }

      .auth-separator::before,
      .auth-separator::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
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
        box-shadow: 0 14px 30px var(--shadow);
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

      [hidden] {
        display: none !important;
      }

      @media (max-width: 900px) {
        .topbar {
          flex-direction: column;
          align-items: stretch;
        }

        h1 {
          font-size: clamp(34px, 9vw, 54px);
        }

        .lead {
          font-size: 16px;
        }

        .auth-shell,
        .grid,
        .metrics-grid {
          grid-template-columns: 1fr;
        }

        .auth-spotlight {
          min-height: auto;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="topbar">
        <div>
          <h1>Ponte Telegram -> WhatsApp</h1>
          <p class="lead">
            Transforme sua ponte em produto: login, operacao centralizada e uma experiencia
            mais profissional para preparar a proxima fase do seu SaaS.
          </p>
        </div>
        <div class="topbar-actions">
          <div id="user-chip" class="user-chip" hidden></div>
          <button id="logout-button" class="ghost" type="button" hidden>Sair</button>
          <button id="theme-toggle" class="ghost" type="button">Dark mode</button>
        </div>
      </section>

      <section id="feedback-banner" class="feedback" hidden></section>

      <section id="auth-shell" class="auth-shell">
        <div class="card auth-spotlight">
          <div class="eyebrow">Etapa 1 · Identidade do usuario</div>
          <h2 class="auth-title">Seu painel agora com cara de produto.</h2>
          <p class="auth-copy">
            Email, senha, sessao persistente e entrada via Google na mesma base.
            Isso prepara o terreno para planos, faturamento e workspaces separados por cliente.
          </p>
          <div class="spotlight-meta">
            <div class="spotlight-stat">
              <strong>Login</strong>
              <span>Email e senha</span>
            </div>
            <div class="spotlight-stat">
              <strong>Google</strong>
              <span>OAuth configuravel</span>
            </div>
            <div class="spotlight-stat">
              <strong>Base</strong>
              <span>Pronta para SaaS</span>
            </div>
          </div>
          <ul class="auth-list">
            <li>Autenticacao pronta para onboarding mais profissional.</li>
            <li>Entrada social preparada para aumentar conversao.</li>
            <li>Fundacao pronta para separar contas, workspaces e cobranca.</li>
          </ul>
        </div>

        <div class="card">
          <h2 class="auth-panel-title">Acesse sua central</h2>
          <p class="auth-panel-copy">
            Entre com sua conta ou crie um novo acesso para continuar configurando a ponte.
          </p>
          <div class="tabs">
            <button id="tab-login" class="tab active" type="button">Entrar</button>
            <button id="tab-register" class="tab" type="button">Criar conta</button>
          </div>

          <form id="login-form" class="auth-form">
            <label for="login-email">Email</label>
            <input id="login-email" name="email" type="text" autocomplete="email" placeholder="voce@empresa.com" />

            <label for="login-password">Senha</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" />

            <div class="row">
              <button type="submit">Entrar no painel</button>
            </div>
          </form>

          <form id="register-form" class="auth-form" hidden>
            <label for="register-name">Nome</label>
            <input id="register-name" name="name" type="text" autocomplete="name" placeholder="Seu nome" />

            <label for="register-email">Email</label>
            <input id="register-email" name="email" type="text" autocomplete="email" placeholder="voce@empresa.com" />

            <label for="register-password">Senha</label>
            <input id="register-password" name="password" type="password" autocomplete="new-password" placeholder="Minimo de 8 caracteres" />

            <div class="row">
              <button type="submit">Criar conta</button>
            </div>
          </form>

          <div class="auth-separator">ou</div>
          <a id="google-login" class="button-link google-button" href="/auth/google">
            <span class="google-mark">G</span>
            <span>Continuar com Google</span>
          </a>
          <p id="google-hint" class="hint auth-footnote" hidden></p>
        </div>
      </section>

      <div id="app-shell" hidden>
        <section class="grid">
          <div class="card">
            <h2>Configuracao do Telegram</h2>
            <form id="settings-form">
              <label for="telegramBotToken">Token do bot</label>
              <input id="telegramBotToken" name="telegramBotToken" type="password" placeholder="123456:ABC..." />

              <label for="telegramChannel">Canal</label>
              <input id="telegramChannel" name="telegramChannel" type="text" placeholder="@seucanal ou -1001234567890" />

              <div class="row">
                <button type="submit">Salvar configuracao</button>
              </div>
            </form>
            <p class="hint">
              Coloque o bot como administrador do canal no Telegram. Nesta primeira versao,
              o programa escuta novos posts do canal e encaminha para os grupos marcados abaixo.
            </p>
          </div>

          <div class="card">
            <h2>Status</h2>
            <div class="status">
              <div class="pill" id="system-status">Sistema: carregando...</div>
              <div class="pill" id="wa-status">WhatsApp: carregando...</div>
              <div class="pill" id="tg-status">Telegram: carregando...</div>
            </div>
            <img id="qr" class="qr" alt="QR Code do WhatsApp" />
            <p class="hint" id="wa-phone"></p>
            <p class="hint" id="wa-issue" hidden></p>
            <div class="row">
              <button id="system-toggle" type="button">Carregando...</button>
              <button class="secondary" id="refresh-groups" type="button">Atualizar grupos</button>
              <button class="secondary" id="whatsapp-action" type="button">WhatsApp</button>
            </div>
          </div>
        </section>

        <section class="metrics-grid">
          <article class="metric-card">
            <span class="metric-label">Mensagens do Telegram</span>
            <strong id="metric-telegram-received" class="metric-value">0</strong>
            <p id="metric-telegram-meta" class="metric-meta">Nenhuma mensagem recebida ainda.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Encaminhamentos</span>
            <strong id="metric-forward-batches" class="metric-value">0</strong>
            <p id="metric-forward-meta" class="metric-meta">Nenhum envio realizado ainda.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Entregas no WhatsApp</span>
            <strong id="metric-deliveries" class="metric-value">0</strong>
            <p id="metric-deliveries-meta" class="metric-meta">Sem entregas registradas ate agora.</p>
          </article>

          <article class="metric-card">
            <span class="metric-label">Erros e disponibilidade</span>
            <strong id="metric-errors" class="metric-value">0</strong>
            <p id="metric-errors-meta" class="metric-meta">Tudo limpo por enquanto.</p>
          </article>
        </section>

        <section class="card" style="margin-top: 18px;">
          <h2>Grupos do WhatsApp onde voce e admin</h2>
          <input
            id="group-search"
            class="search-input"
            type="text"
            placeholder="Buscar grupo pelo nome"
          />
          <div id="groups" class="groups"></div>
          <div class="row">
            <button id="save-groups" type="button">Salvar grupos selecionados</button>
          </div>
        </section>

        <section class="card" style="margin-top: 18px;">
          <h2>Atividade e logs</h2>
          <pre id="logs">Carregando...</pre>
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
      const googleLoginLink = document.getElementById('google-login');
      const googleHint = document.getElementById('google-hint');
      const userChip = document.getElementById('user-chip');
      const logoutButton = document.getElementById('logout-button');
      const form = document.getElementById('settings-form');
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
      const waPhone = document.getElementById('wa-phone');
      const waIssue = document.getElementById('wa-issue');
      const qr = document.getElementById('qr');
      const systemToggleButton = document.getElementById('system-toggle');
      const themeToggleButton = document.getElementById('theme-toggle');
      const saveGroupsButton = document.getElementById('save-groups');
      const refreshGroupsButton = document.getElementById('refresh-groups');
      const whatsAppActionButton = document.getElementById('whatsapp-action');
      const groupSearchInput = document.getElementById('group-search');
      let currentState = null;
      let authMode = 'login';
      let selectedGroupIds = new Set();
      let selectedGroupIdsDirty = false;

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
          selectedGroupIdsDirty = false;
          selectedGroupIds = new Set();
          return;
        }

        authShell.hidden = true;
        appShell.hidden = false;

        if (!selectedGroupIdsDirty) {
          selectedGroupIds = new Set(state.config.selectedGroupIds || []);
        }

        document.getElementById('telegramChannel').value = state.config.telegramChannel || '';
        document.getElementById('telegramBotToken').value = '';
        systemStatus.textContent = 'Sistema: ' + (state.config.bridgeEnabled ? 'ligado' : 'desligado');
        waStatus.textContent = 'WhatsApp: ' + state.whatsAppStatus;
        tgStatus.textContent = 'Telegram: ' + state.telegramStatus;
        const statusDetails = [];
        if (state.whatsAppPhone) {
          statusDetails.push('Sessao ativa: ' + state.whatsAppPhone);
        }
        if ((state.metrics?.pendingTelegramCount || 0) > 0) {
          statusDetails.push(
            'Fila pendente: ' + formatNumber(state.metrics.pendingTelegramCount || 0)
          );
        }
        waPhone.textContent = statusDetails.join(' | ');
        waIssue.hidden = !state.issue?.message;
        waIssue.textContent = state.issue?.message || '';
        logs.textContent = state.logs.length ? state.logs.join('\\n') : 'Sem logs ainda.';
        systemToggleButton.textContent = state.config.bridgeEnabled ? 'Desligar sistema' : 'Ligar sistema';
        systemToggleButton.className = state.config.bridgeEnabled ? 'warn' : '';
        refreshGroupsButton.disabled = Boolean(state.metrics?.groupsRefreshing);
        refreshGroupsButton.textContent = state.metrics?.groupsRefreshing
          ? 'Buscando grupos...'
          : 'Atualizar grupos';
        const whatsAppAction = resolveWhatsAppAction(state);
        whatsAppActionButton.hidden = !whatsAppAction;
        whatsAppActionButton.disabled = !whatsAppAction || Boolean(whatsAppAction.disabled);
        whatsAppActionButton.textContent = whatsAppAction?.label || 'WhatsApp';
        whatsAppActionButton.dataset.action = whatsAppAction?.type || '';
        renderMetrics(state.metrics || {}, state.activity || []);

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
          ? 'Ultima entrada: ' + formatDateTime(metrics.lastTelegramMessageAt)
          : 'Nenhuma mensagem recebida ainda.';

        metricForwardBatches.textContent = formatNumber(metrics.totalForwardBatches || 0);
        metricForwardMeta.textContent = metrics.lastForwardedAt
          ? 'Ultimo envio: ' + formatDateTime(metrics.lastForwardedAt)
          : 'Nenhum envio realizado ainda.';

        metricDeliveries.textContent = formatNumber(metrics.totalWhatsAppDeliveries || 0);
        metricDeliveriesMeta.textContent =
          'Msgs encaminhadas: ' +
          formatNumber(metrics.totalForwardedMessages || 0) +
          ' | grupos selecionados: ' +
          formatNumber(metrics.selectedGroupCount || 0);

        metricErrors.textContent = formatNumber(metrics.totalErrors || 0);
        metricErrorsMeta.textContent = buildErrorMeta(metrics, activity);
      }

      function renderAuth(auth) {
        const user = auth.user || null;

        userChip.hidden = !auth.authenticated;
        logoutButton.hidden = !auth.authenticated;
        userChip.textContent = user ? (user.name || user.email) + ' | ' + user.email : '';

        googleLoginLink.hidden = false;
        googleLoginLink.setAttribute('aria-disabled', auth.googleEnabled ? 'false' : 'true');
        googleLoginLink.href = auth.googleEnabled ? '/auth/google' : '#';
        googleHint.hidden = false;
        googleHint.textContent = auth.googleEnabled
          ? 'Login com Google pronto para uso.'
          : 'O botao do Google so ativa quando o servidor tiver GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALLBACK_URL configurados.';

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
          throw new Error(payload.error || 'Nao foi possivel concluir a solicitacao.');
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
        feedbackBanner.textContent = message;
        feedbackBanner.className = 'feedback ' + tone;
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
            telegramBotToken: document.getElementById('telegramBotToken').value.trim(),
            telegramChannel: document.getElementById('telegramChannel').value.trim()
          };

          currentState = await requestJson('/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });

          setFeedback('Configuracao salva com sucesso.', 'success');
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

      groupSearchInput.addEventListener('input', () => {
        if (!currentState) {
          return;
        }

        renderGroups(currentState.groups, groupSearchInput.value);
      });

      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

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
        }
      });

      registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();

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
        }
      });

      logoutButton.addEventListener('click', async () => {
        try {
          await requestJson('/api/auth/logout', {
            method: 'POST'
          });

          setFeedback('Sessao encerrada.', 'success');
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

      function buildErrorMeta(metrics, activity) {
        if (metrics.groupsRefreshing) {
          return 'Buscando grupos do WhatsApp. Na primeira sincronizacao isso pode levar alguns minutos.';
        }

        if ((metrics.pendingTelegramCount || 0) > 0) {
          return (
            formatNumber(metrics.pendingTelegramCount || 0) +
            ' mensagem(ns) aguardando o WhatsApp voltar para concluir o envio.'
          );
        }

        if (metrics.lastErrorAt) {
          return 'Ultimo erro: ' + formatDateTime(metrics.lastErrorAt);
        }

        const lastEvent = Array.isArray(activity) && activity.length ? activity[0] : null;

        if (lastEvent?.at) {
          return 'Ultima atividade: ' + formatDateTime(lastEvent.at);
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
        themeToggleButton.textContent = theme === 'dark' ? 'Tema claro' : 'Dark mode';
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
        setFeedback('Nao foi possivel concluir o login com Google.', 'error');
      } else if (authMessage === 'google_unavailable') {
        setFeedback('O login com Google ainda nao foi configurado neste servidor.', 'error');
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
