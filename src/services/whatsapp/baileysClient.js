import EventEmitter from 'node:events';
import {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  makeWASocket,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

export async function createBaileysWhatsAppClient(options = {}) {
  const authDir = options.authDir;

  if (!authDir) {
    throw new Error('Diretorio de sessao do Baileys nao configurado.');
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  return new BaileysWhatsAppClient({
    auth: state,
    saveCreds,
    defaultQueryTimeoutMs: options.defaultQueryTimeoutMs
  });
}

export class BaileysWhatsAppClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.provider = 'baileys';
    this.auth = options.auth;
    this.saveCreds = options.saveCreds;
    this.defaultQueryTimeoutMs = options.defaultQueryTimeoutMs;
    this.sock = null;
    this.info = null;
    this.ready = false;
    this.closed = false;
  }

  initialize() {
    if (this.sock) {
      return Promise.resolve();
    }

    this.closed = false;
    this.sock = makeWASocket({
      auth: this.auth,
      browser: Browsers.macOS('Chrome'),
      logger: baileysLogger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      defaultQueryTimeoutMs: this.defaultQueryTimeoutMs,
      shouldSyncHistoryMessage: () => false
    });

    this.sock.ev.on('creds.update', this.saveCreds);
    this.sock.ev.on('connection.update', (update) => {
      if (this.closed) {
        return;
      }

      if (update.qr) {
        this.emit('qr', update.qr);
      }

      if (update.connection === 'open') {
        this.ready = true;
        this.info = { wid: normalizeJid(this.sock?.user?.id || this.auth?.creds?.me?.id) };
        this.emit('authenticated');
        this.emit('ready');
        return;
      }

      if (update.connection === 'close') {
        this.ready = false;
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        const reason = statusCode ? `baileys:${statusCode}` : 'baileys:closed';

        if (statusCode === DisconnectReason.loggedOut) {
          this.emit('auth_failure', reason);
          return;
        }

        this.emit('disconnected', reason);
      }
    });

    return Promise.resolve();
  }

  async getChats() {
    this.assertReady();
    const groupMap = await this.sock.groupFetchAllParticipating();

    return Object.values(groupMap).map((group) => ({
      id: group.id,
      name: group.subject || group.notify || 'Grupo sem nome',
      isGroup: true,
      isReadOnly: Boolean(group.announce),
      participants: (group.participants || []).map((participant) => ({
        id: normalizeJid(participant.id),
        isAdmin: participant.admin === 'admin' || Boolean(participant.isAdmin),
        isSuperAdmin: participant.admin === 'superadmin' || Boolean(participant.isSuperAdmin)
      })),
      groupMetadata: {
        ...group,
        parentGroupId: group.linkedParent || null,
        announce: Boolean(group.announce),
        isCommunity: Boolean(group.isCommunity),
        isCommunityAnnounce: Boolean(group.isCommunityAnnounce)
      }
    }));
  }

  async sendMessage(jid, content, options = {}) {
    this.assertReady();

    if (typeof content === 'string') {
      return await this.sock.sendMessage(jid, { text: content });
    }

    return await this.sock.sendMessage(jid, content, options);
  }

  async sendMediaMessage(jid, payload = {}) {
    const buffer = Buffer.from(String(payload.base64 || ''), 'base64');
    const mimeType = String(payload.mimeType || 'application/octet-stream').toLowerCase();
    const caption = payload.caption || undefined;

    if (mimeType === 'image/gif') {
      return await this.sendMessage(jid, {
        video: buffer,
        mimetype: mimeType,
        caption,
        gifPlayback: true
      });
    }

    if (mimeType.startsWith('image/')) {
      return await this.sendMessage(jid, {
        image: buffer,
        mimetype: mimeType,
        caption
      });
    }

    if (mimeType.startsWith('video/')) {
      return await this.sendMessage(jid, {
        video: buffer,
        mimetype: mimeType,
        caption
      });
    }

    if (mimeType.startsWith('audio/')) {
      return await this.sendMessage(jid, {
        audio: buffer,
        mimetype: mimeType
      });
    }

    return await this.sendMessage(jid, {
      document: buffer,
      mimetype: mimeType,
      fileName: payload.filename || 'arquivo',
      caption
    });
  }

  async destroy() {
    this.closed = true;
    this.ready = false;

    try {
      this.sock?.ev?.removeAllListeners?.();
    } catch {
      // Ignore listener cleanup errors during shutdown.
    }

    try {
      this.sock?.ws?.close?.();
    } catch {
      // Ignore socket close errors; the next connection will create a fresh socket.
    }

    this.sock = null;
  }

  isAlive() {
    return Boolean(this.sock && !this.closed);
  }

  assertReady() {
    if (!this.sock || !this.ready) {
      throw new Error('WhatsApp Baileys ainda nao esta pronto.');
    }
  }
}

function normalizeJid(value) {
  if (!value) {
    return null;
  }

  try {
    return jidNormalizedUser(String(value));
  } catch {
    return String(value);
  }
}
