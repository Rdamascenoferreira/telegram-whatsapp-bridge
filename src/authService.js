import crypto from 'node:crypto';
import path from 'node:path';
import session from 'express-session';
import createFileStore from 'session-file-store';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import {
  createPasswordUser,
  deleteUserAccount,
  findUserById,
  getUserAvatarFile,
  isPrimaryAdminEmail,
  sanitizeUser,
  updateUserAvatar,
  updateUserPassword,
  updateUserProfile,
  upsertGoogleUser,
  verifyPasswordUser
} from './authStore.js';

const FileStore = createFileStore(session);

export class AuthService {
  constructor(options = {}) {
    this.appBaseUrl = options.appBaseUrl || '';
    this.allowedOriginHosts = buildAllowedOriginHosts(options.allowedOrigins, this.appBaseUrl);
    this.sessionSecret = resolveSessionSecret(options.sessionSecret);
    this.cookieSecure = resolveCookieSecure(this.appBaseUrl);
    this.googleClientId = options.googleClientId || '';
    this.googleClientSecret = options.googleClientSecret || '';
    this.googleCallbackUrl = options.googleCallbackUrl || '';
    this.googleEnabled = Boolean(this.googleClientId && this.googleClientSecret && this.googleCallbackUrl);
    this.onlineWindowMs = 1000 * 20;
    this.authRateLimitWindowMs = 1000 * 60 * 15;
    this.authRateLimitMaxAttempts = 8;
    this.authAttempts = new Map();
    this.sessionStore = createSessionStore({
      storeType: options.sessionStoreType,
      sessionDir: options.sessionDir
    });
    this.onlineSessionsByUserId = new Map();
    this.sessionUserBySessionId = new Map();
    this.sessionSeenAt = new Map();
  }

  configure(app) {
    app.use(this.requireSameOrigin());
    app.use(
      session({
        secret: this.sessionSecret,
        store: this.sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: this.cookieSecure,
          maxAge: 1000 * 60 * 60 * 24 * 30
        }
      })
    );

    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    passport.deserializeUser(async (userId, done) => {
      try {
        const user = await findUserById(userId);
        done(null, user);
      } catch (error) {
        done(error);
      }
    });

    if (this.googleEnabled) {
      passport.use(
        new GoogleStrategy(
          {
            clientID: this.googleClientId,
            clientSecret: this.googleClientSecret,
            callbackURL: this.googleCallbackUrl
          },
          async (_accessToken, _refreshToken, profile, done) => {
            try {
              const user = await upsertGoogleUser(profile);
              done(null, user);
            } catch (error) {
              done(error);
            }
          }
        )
      );
    }

    app.use(passport.initialize());
    app.use(passport.session());
    app.use((request, _response, next) => {
      if (request.user?.id && request.sessionID) {
        this.registerSession(request.sessionID, request.user.id);
        this.touchSessionActivity(request.sessionID);
      }

      next();
    });

    app.get('/api/auth/session', (request, response) => {
      response.json(this.getClientSession(request.user));
    });

    app.post('/api/auth/register', async (request, response) => {
      const rateLimitKey = this.buildAuthRateLimitKey(request, 'register', request.body?.email);

      try {
        this.assertAuthRateLimit(rateLimitKey);
        const user = await createPasswordUser({
          name: request.body?.name,
          email: request.body?.email,
          password: request.body?.password
        });

        await this.login(request, user);
        this.clearAuthRateLimit(rateLimitKey);
        response.json(this.getClientSession(user));
      } catch (error) {
        this.recordAuthFailure(rateLimitKey);
        response.status(error.code === 'AUTH_RATE_LIMITED' ? 429 : 400).json({
          authenticated: false,
          googleEnabled: this.googleEnabled,
          error: error.message || 'Não foi possível criar sua conta.'
        });
      }
    });

    app.post('/api/auth/login', async (request, response) => {
      const rateLimitKey = this.buildAuthRateLimitKey(request, 'login', request.body?.email);

      try {
        this.assertAuthRateLimit(rateLimitKey);
        const user = await verifyPasswordUser({
          email: request.body?.email,
          password: request.body?.password
        });

        if (!user) {
          this.recordAuthFailure(rateLimitKey);
          response.status(401).json({
            authenticated: false,
            googleEnabled: this.googleEnabled,
            error: 'E-mail ou senha inválidos.'
          });
          return;
        }

        await this.login(request, user);
        this.clearAuthRateLimit(rateLimitKey);
        response.json(this.getClientSession(user));
      } catch (error) {
        this.recordAuthFailure(rateLimitKey);
        const isSuspended = String(error.message || '').toLowerCase().includes('suspensa');
        const isRateLimited = error.code === 'AUTH_RATE_LIMITED';
        response.status(isRateLimited ? 429 : isSuspended ? 403 : 500).json({
          authenticated: false,
          googleEnabled: this.googleEnabled,
          error: error.message || 'Não foi possível entrar agora.'
        });
      }
    });

    app.post('/api/auth/logout', (request, response) => {
      const activeSessionId = request.sessionID;
      request.logout((error) => {
        if (error) {
          response.status(500).json({
            authenticated: true,
            googleEnabled: this.googleEnabled,
            error: 'Não foi possível sair agora.'
          });
          return;
        }

        request.session.destroy(() => {
          this.unregisterSession(activeSessionId);
          response.clearCookie('connect.sid');
          response.json(this.getClientSession(null));
        });
      });
    });

    app.post('/api/account/profile', this.requireWriteAccess(), async (request, response) => {
      try {
        const user = await updateUserProfile(request.user.id, {
          name: request.body?.name
        });
        Object.assign(request.user, user);
        response.json(this.getClientSession(user));
      } catch (error) {
        response.status(400).json({
          authenticated: true,
          googleEnabled: this.googleEnabled,
          error: error.message || 'Não foi possível atualizar o perfil.'
        });
      }
    });

    app.post('/api/account/password', this.requireWriteAccess(), async (request, response) => {
      try {
        const user = await updateUserPassword(request.user.id, {
          currentPassword: request.body?.currentPassword,
          nextPassword: request.body?.nextPassword,
          confirmPassword: request.body?.confirmPassword
        });
        Object.assign(request.user, user);
        response.json(this.getClientSession(user));
      } catch (error) {
        response.status(400).json({
          authenticated: true,
          googleEnabled: this.googleEnabled,
          error: error.message || 'Não foi possível atualizar a senha.'
        });
      }
    });

    app.post('/api/account/avatar', this.requireWriteAccess(), async (request, response) => {
      try {
        const user = await updateUserAvatar(request.user.id, {
          avatarDataUrl: request.body?.avatarDataUrl
        });
        Object.assign(request.user, user);
        response.json(this.getClientSession(user));
      } catch (error) {
        response.status(400).json({
          authenticated: true,
          googleEnabled: this.googleEnabled,
          error: error.message || 'Não foi possível atualizar a foto do perfil.'
        });
      }
    });

    app.get('/api/account/avatar/:userId', this.requireAuth(), async (request, response) => {
      const targetUserId = String(request.params.userId ?? '').trim();
      const isSelf = request.user?.id === targetUserId;
      const isAdmin = this.isAdminUser(request.user);

      if (!isSelf && !isAdmin) {
        response.status(403).end();
        return;
      }

      const avatar = await getUserAvatarFile(targetUserId);

      if (!avatar) {
        response.status(404).end();
        return;
      }

      response.setHeader('content-type', avatar.mimeType);
      response.setHeader('cache-control', 'private, max-age=300');
      response.send(avatar.bytes);
    });

    app.get('/auth/google', (request, response, next) => {
      if (!this.googleEnabled) {
        response.redirect('/?auth=google_unavailable');
        return;
      }

      passport.authenticate('google', { scope: ['profile', 'email'] })(request, response, next);
    });

    app.get('/auth/google/callback', (request, response, next) => {
      passport.authenticate('google', async (error, user) => {
        if (error) {
          const reason = String(error.message || '').toLowerCase().includes('suspensa') ? 'account_suspended' : 'google_failed';
          response.redirect(`/?auth=${reason}`);
          return;
        }

        if (!user) {
          response.redirect('/?auth=google_failed');
          return;
        }

        try {
          await this.login(request, user);
          response.redirect('/');
        } catch (_loginError) {
          response.redirect('/?auth=google_failed');
        }
      })(request, response, next);
    });
  }

  getOnlineUserIds() {
    return new Set(this.onlineSessionsByUserId.keys());
  }

  isUserOnline(userId) {
    const normalizedUserId = String(userId ?? '').trim();
    const sessions = this.onlineSessionsByUserId.get(normalizedUserId);

    if (!normalizedUserId || !sessions?.size) {
      return false;
    }

    const now = Date.now();

    for (const sessionId of sessions) {
      const lastSeenAt = this.sessionSeenAt.get(sessionId) ?? 0;

      if (now - lastSeenAt <= this.onlineWindowMs) {
        return true;
      }
    }

    return false;
  }

  async forceLogoutUser(userId) {
    const normalizedUserId = String(userId ?? '').trim();
    const sessionIds = [...(this.onlineSessionsByUserId.get(normalizedUserId) ?? [])];

    await Promise.all(
      sessionIds.map(
        (sessionId) =>
          new Promise((resolve) => {
            this.sessionStore.destroy(sessionId, () => {
              this.unregisterSession(sessionId);
              resolve();
            });
          })
      )
    );
  }

  requireAuth() {
    return (request, response, next) => {
      if (!request.user) {
        response.status(401).json({
          authenticated: false,
          googleEnabled: this.googleEnabled,
          error: 'Faça login para continuar.'
        });
        return;
      }

      next();
    };
  }

  requireWriteAccess() {
    return (request, response, next) => {
      if (!request.user) {
        response.status(401).json({
          authenticated: false,
          googleEnabled: this.googleEnabled,
          error: 'Faça login para continuar.'
        });
        return;
      }

      if (this.isReadOnlyUser(request.user)) {
        response.status(403).json({
          authenticated: true,
          googleEnabled: this.googleEnabled,
          error: 'Sua conta está em modo teste. Você pode visualizar os painéis, mas edições precisam ser liberadas pelo administrador.'
        });
        return;
      }

      next();
    };
  }

  requireAdmin() {
    return (request, response, next) => {
      if (!request.user) {
        response.status(401).json({
          authenticated: false,
          googleEnabled: this.googleEnabled,
          error: 'Faça login para continuar.'
        });
        return;
      }

      if (!this.isAdminUser(request.user)) {
        response.status(403).json({
          authenticated: true,
          googleEnabled: this.googleEnabled,
          error: 'Acesso restrito ao administrador.'
        });
        return;
      }

      next();
    };
  }

  isAdminUser(user) {
    return isPrimaryAdminEmail(user?.email);
  }

  isReadOnlyUser(user) {
    return Boolean(user) && !this.isAdminUser(user) && user.accountStatus === 'trial';
  }

  getClientSession(user) {
    return {
      authenticated: Boolean(user),
      googleEnabled: this.googleEnabled,
      user: sanitizeUser(user)
    };
  }

  async login(request, user) {
    await new Promise((resolve, reject) => {
      request.login(user, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    if (request.session) {
      await new Promise((resolve, reject) => {
        request.session.save((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (request.sessionID && user?.id) {
      this.registerSession(request.sessionID, user.id);
    }
  }

  async deleteAccount(userId) {
    await this.forceLogoutUser(userId);
    return await deleteUserAccount(userId);
  }

  registerSession(sessionId, userId) {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const normalizedUserId = String(userId ?? '').trim();

    if (!normalizedSessionId || !normalizedUserId) {
      return;
    }

    const previousUserId = this.sessionUserBySessionId.get(normalizedSessionId);

    if (previousUserId && previousUserId !== normalizedUserId) {
      this.unregisterSession(normalizedSessionId);
    }

    this.sessionUserBySessionId.set(normalizedSessionId, normalizedUserId);
    this.sessionSeenAt.set(normalizedSessionId, Date.now());

    if (!this.onlineSessionsByUserId.has(normalizedUserId)) {
      this.onlineSessionsByUserId.set(normalizedUserId, new Set());
    }

    this.onlineSessionsByUserId.get(normalizedUserId)?.add(normalizedSessionId);
  }

  unregisterSession(sessionId) {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const userId = this.sessionUserBySessionId.get(normalizedSessionId);

    if (!userId) {
      return;
    }

    this.sessionUserBySessionId.delete(normalizedSessionId);
    this.sessionSeenAt.delete(normalizedSessionId);
    const sessions = this.onlineSessionsByUserId.get(userId);

    if (!sessions) {
      return;
    }

    sessions.delete(normalizedSessionId);

    if (!sessions.size) {
      this.onlineSessionsByUserId.delete(userId);
    }
  }

  touchSessionActivity(sessionId) {
    const normalizedSessionId = String(sessionId ?? '').trim();

    if (!normalizedSessionId || !this.sessionUserBySessionId.has(normalizedSessionId)) {
      return;
    }

    this.sessionSeenAt.set(normalizedSessionId, Date.now());
  }

  requireSameOrigin() {
    return (request, response, next) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        next();
        return;
      }

      const source = request.headers.origin || request.headers.referer;

      if (!source) {
        response.status(403).json({
          authenticated: Boolean(request.user),
          googleEnabled: this.googleEnabled,
          error: 'Cabeçalho de origem ausente. Recarregue o painel e tente novamente.'
        });
        return;
      }

      if (this.isAllowedRequestSource(source, getRequestHosts(request))) {
        next();
        return;
      }

      response.status(403).json({
        authenticated: Boolean(request.user),
        googleEnabled: this.googleEnabled,
        error: 'Origem da requisição não autorizada.'
      });
    };
  }

  isAllowedRequestSource(source, requestHosts = []) {
    try {
      const sourceUrl = new URL(String(source));
      const allowedHosts = new Set(
        [...requestHosts, ...this.allowedOriginHosts]
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
      );

      return allowedHosts.has(sourceUrl.host.toLowerCase());
    } catch {
      return false;
    }
  }

  buildAuthRateLimitKey(request, action, email) {
    const ipAddress = String(request.ip || request.socket?.remoteAddress || 'unknown').trim();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    return `${action}:${ipAddress}:${normalizedEmail}`;
  }

  assertAuthRateLimit(key) {
    const entry = this.authAttempts.get(key);
    const now = Date.now();

    if (!entry || entry.expiresAt <= now) {
      this.authAttempts.delete(key);
      return;
    }

    if (entry.count < this.authRateLimitMaxAttempts) {
      return;
    }

    const error = new Error('Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.');
    error.code = 'AUTH_RATE_LIMITED';
    throw error;
  }

  recordAuthFailure(key) {
    const now = Date.now();
    const current = this.authAttempts.get(key);

    if (!current || current.expiresAt <= now) {
      this.authAttempts.set(key, {
        count: 1,
        expiresAt: now + this.authRateLimitWindowMs
      });
      return;
    }

    current.count += 1;
  }

  clearAuthRateLimit(key) {
    this.authAttempts.delete(key);
  }
}

function resolveSessionSecret(value) {
  const explicitSecret = String(value ?? '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (explicitSecret && explicitSecret !== 'bridge-dev-session-secret') {
    return explicitSecret;
  }

  if (isProduction) {
    throw new Error('Defina SESSION_SECRET com um valor forte antes de iniciar em produção.');
  }

  console.warn('SESSION_SECRET não definido. Usando segredo temporario apenas para desenvolvimento local.');
  return crypto.randomBytes(32).toString('hex');
}

function resolveCookieSecure(appBaseUrl) {
  const override = String(process.env.SESSION_COOKIE_SECURE ?? '').trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(override)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(override)) {
    return false;
  }

  return String(appBaseUrl || '').trim().toLowerCase().startsWith('https://') ? 'auto' : false;
}

function getRequestHosts(request) {
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return [
    request.headers.host,
    request.hostname,
    ...forwardedHost
  ];
}

function createSessionStore(options = {}) {
  const storeType = String(options.storeType ?? process.env.SESSION_STORE ?? 'file').trim().toLowerCase();

  if (storeType === 'memory') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_STORE=memory não e permitido em produção. Use SESSION_STORE=file ou um store persistente.');
    }

    console.warn('SESSION_STORE=memory está ativo apenas para desenvolvimento local.');
    return new session.MemoryStore();
  }

  if (storeType && storeType !== 'file') {
    throw new Error(`SESSION_STORE inválido: ${storeType}. Use "file" ou "memory".`);
  }

  const sessionDir = path.resolve(
    process.cwd(),
    String(options.sessionDir ?? process.env.SESSION_FILE_STORE_DIR ?? 'data/sessions').trim() || 'data/sessions'
  );

  return new FileStore({
    path: sessionDir,
    ttl: 60 * 60 * 24 * 30,
    retries: 1,
    reapInterval: 60 * 60,
    logFn: () => {}
  });
}

function buildAllowedOriginHosts(values = [], appBaseUrl = '') {
  const urls = Array.isArray(values) ? values : [values];
  const hosts = [];

  for (const value of [appBaseUrl, ...urls]) {
    const text = String(value ?? '').trim();

    if (!text) {
      continue;
    }

    try {
      hosts.push(new URL(text).host);
    } catch {
      hosts.push(text);
    }
  }

  return [...new Set(hosts)];
}
