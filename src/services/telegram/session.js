import { Api, TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { getAffiliateState } from '../../affiliate/affiliate-store.js';
import { saveConfigForUser } from '../../configStore.js';

const telegramFallbackPollIntervalMs = normalizeBoundedInt(
  process.env.TELEGRAM_FALLBACK_POLL_INTERVAL_MS,
  12000,
  3000,
  120000
);
const telegramFallbackPollBatchSize = normalizeBoundedInt(
  process.env.TELEGRAM_FALLBACK_POLL_BATCH_SIZE,
  12,
  3,
  50
);

export async function startTelegram(runtime) {
  await stopTelegramTransport(runtime);
  runtime.telegramAvailableChats = [];
  runtime.telegramUserProfile = null;

  await startTelegramUser(runtime);
}

export async function stopTelegramTransport(runtime) {
  stopTelegramFallbackPolling(runtime);

  if (runtime.telegramClient) {
    if (runtime.telegramMessageHandler) {
      runtime.telegramClient.removeEventHandler(runtime.telegramMessageHandler);
    }

    await runtime.telegramClient.disconnect().catch(() => {});
    runtime.telegramClient = null;
    runtime.telegramMessageHandler = null;
  }

  if (runtime.telegramAuthFlow?.client) {
    await runtime.telegramAuthFlow.client.disconnect().catch(() => {});
  }
}

export async function startTelegramUser(runtime) {
  if (!runtime.config.telegramApiId || !runtime.config.telegramApiHash || !runtime.config.telegramPhone) {
    runtime.telegramStatus = 'not_configured';
    runtime.log('Telegram ainda não configurado. Informe API ID, API Hash e telefone para usar a sessão de usuário.', {
      type: 'telegram_not_configured'
    });
    return;
  }

  if (!runtime.config.telegramSession) {
    runtime.telegramStatus = runtime.telegramAuthFlow?.phase === 'code_required' ? 'code_required' : 'auth_required';
    runtime.log('Sessão do Telegram aguardando autenticação por código.', {
      type: 'telegram_auth_required'
    });
    return;
  }

  runtime.telegramStatus = 'connecting';
  const client = createTelegramUserClient(runtime);
  await client.connect();

  const isAuthorized = await client.checkAuthorization();

  if (!isAuthorized) {
    runtime.telegramStatus = 'auth_required';
    runtime.telegramClient = null;
    await client.disconnect().catch(() => {});
    runtime.log('A sessão salva do Telegram expirou. Envie um novo código para autenticar novamente.', {
      level: 'error',
      type: 'telegram_auth_expired',
      increments: { errors: 1 }
    });
    return;
  }

  runtime.telegramClient = client;
  const me = await client.getMe();
  runtime.telegramUserProfile = {
    id: String(me?.id ?? ''),
    name: [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.username || runtime.config.telegramPhone,
    username: me?.username ? '@' + me.username : '',
    phone: me?.phone ? '+' + me.phone : runtime.config.telegramPhone
  };
  await refreshTelegramAvailableChats(runtime);

  runtime.telegramMessageHandler = async (event) => {
    try {
      await runtime.routeTelegramUserMessage(event);
    } catch (error) {
      runtime.log(`Falha ao encaminhar mensagem do Telegram: ${error.message}`, {
        level: 'error',
        type: 'telegram_forward_error',
        increments: { errors: 1 }
      });
    }
  };

  client.addEventHandler(runtime.telegramMessageHandler, new NewMessage({}));
  startTelegramFallbackPolling(runtime);
  runtime.telegramStatus = 'listening';
  runtime.telegramAuthFlow = null;
  runtime.log('Telegram conectado pela sua conta. Agora a ponte pode ler mensagens do grupo sem bot.', {
    type: 'telegram_ready'
  });
}

export function createTelegramUserClient(runtime, session = runtime.config.telegramSession || '') {
  return new TelegramClient(
    new StringSession(session),
    Number(runtime.config.telegramApiId),
    String(runtime.config.telegramApiHash),
    {
      connectionRetries: 5,
      autoReconnect: true,
      useWSS: true
    }
  );
}

export function normalizeTelegramPhone(phone) {
  return String(phone ?? '').trim().replace(/\s+/g, '');
}

export function buildTelegramAuthErrorMessage(error, fallback = 'Não foi possível concluir a autenticação do Telegram.') {
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

export async function sendTelegramUserCode(runtime) {
  const normalizedPhone = normalizeTelegramPhone(runtime.config.telegramPhone);
  if (!runtime.config.telegramApiId || !runtime.config.telegramApiHash || !normalizedPhone) {
    throw new Error('Preencha API ID, API Hash e telefone antes de pedir o código do Telegram.');
  }

  await stopTelegramTransport(runtime);

  const client = createTelegramUserClient(runtime, '');
  try {
    await client.connect();
    const apiCredentials = {
      apiId: Number(runtime.config.telegramApiId),
      apiHash: String(runtime.config.telegramApiHash)
    };
    const sendResult = await client.sendCode(apiCredentials, normalizedPhone);

    runtime.telegramAuthFlow = {
      client,
      phoneNumber: normalizedPhone,
      phoneCodeHash: sendResult.phoneCodeHash,
      isCodeViaApp: Boolean(sendResult.isCodeViaApp),
      passwordRequired: false,
      phase: 'code_required'
    };
    runtime.telegramStatus = 'code_required';
    runtime.log(
      sendResult.isCodeViaApp
        ? 'Código do Telegram enviado para o aplicativo oficial.'
        : 'Código do Telegram enviado por SMS ou outro canal disponível.',
      {
        type: 'telegram_code_sent'
      }
    );
  } catch (error) {
    await client.disconnect().catch(() => {});
    runtime.telegramAuthFlow = null;
    runtime.telegramStatus = 'auth_required';
    const reason = buildTelegramAuthErrorMessage(error, 'Não foi possível enviar o código do Telegram.');
    runtime.log(`Falha ao enviar código do Telegram: ${reason}`, {
      level: 'error',
      type: 'telegram_code_send_error',
      increments: { errors: 1 }
    });
    throw new Error(reason);
  }
}

export async function completeTelegramUserAuth(runtime, { code, password }) {
  if (!runtime.telegramAuthFlow?.client || !runtime.telegramAuthFlow?.phoneCodeHash) {
    throw new Error('Peça um novo código do Telegram antes de concluir a autenticação.');
  }

  const client = runtime.telegramAuthFlow.client;

  try {
    if (runtime.telegramAuthFlow.passwordRequired) {
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
        phoneNumber: runtime.telegramAuthFlow.phoneNumber,
        phoneCodeHash: runtime.telegramAuthFlow.phoneCodeHash,
        phoneCode: code
      }));
    }
  } catch (error) {
    if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      runtime.telegramAuthFlow.passwordRequired = true;
      runtime.telegramAuthFlow.phase = 'password_required';
      runtime.telegramStatus = 'password_required';
      runtime.log('O Telegram pediu a senha em duas etapas para concluir o login.', {
        type: 'telegram_password_required'
      });
      return;
    }

    throw new Error(buildTelegramAuthErrorMessage(error, 'Não foi possível concluir o login do Telegram.'));
  }

  runtime.config = await saveConfigForUser(runtime.userId, {
    ...runtime.config,
    telegramMode: 'user',
    telegramSession: client.session.save()
  });
  runtime.telegramAuthFlow = null;
  await client.disconnect().catch(() => {});
  await startTelegram(runtime);
}

export async function disconnectTelegramUser(runtime) {
  runtime.telegramAuthFlow = null;

  if (runtime.telegramClient) {
    try {
      await runtime.telegramClient.logOut();
    } catch {}
  }

  await stopTelegramTransport(runtime);
  runtime.config = await saveConfigForUser(runtime.userId, {
    ...runtime.config,
    telegramMode: 'user',
    telegramBotToken: '',
    telegramApiId: '',
    telegramApiHash: '',
    telegramPhone: '',
    telegramSession: '',
    telegramChannel: '',
    bridgeEnabled: false
  });
  runtime.telegramAvailableChats = [];
  runtime.telegramUserProfile = null;
  runtime.telegramStatus = 'not_configured';
  runtime.log('Sessão da conta do Telegram desconectada.', {
    type: 'telegram_disconnected'
  });
}

export async function refreshTelegramAvailableChats(runtime) {
  if (!runtime.telegramClient) {
    runtime.telegramAvailableChats = [];
    return;
  }

  const dialogs = await runtime.telegramClient.getDialogs({ limit: 200 });
  runtime.telegramAvailableChats = dialogs
    .filter((dialog) => dialog.isGroup || dialog.isChannel)
    .map((dialog) => ({
      id: String(dialog.id),
      name: String(dialog.title || dialog.name || 'Chat do Telegram'),
      type: dialog.isChannel && !dialog.isGroup ? 'channel' : 'group',
      role: resolveTelegramDialogRole(dialog),
      selected: String(dialog.id) === String(runtime.config.telegramChannel || '')
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
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

function startTelegramFallbackPolling(runtime) {
  stopTelegramFallbackPolling(runtime);

  runtime.telegramSourceCursor = runtime.telegramSourceCursor && typeof runtime.telegramSourceCursor.set === 'function'
    ? runtime.telegramSourceCursor
    : new Map();
  runtime.telegramFallbackPollState = {
    timer: setInterval(() => {
      void pollTelegramSources(runtime);
    }, telegramFallbackPollIntervalMs),
    inProgress: false,
    warmupDoneBySource: new Set()
  };

  void pollTelegramSources(runtime, { primeOnly: true });
}

function stopTelegramFallbackPolling(runtime) {
  if (!runtime.telegramFallbackPollState) {
    return;
  }

  if (runtime.telegramFallbackPollState.timer) {
    clearInterval(runtime.telegramFallbackPollState.timer);
  }

  runtime.telegramFallbackPollState = null;
}

async function pollTelegramSources(runtime, options = {}) {
  const state = runtime.telegramFallbackPollState;

  if (!state || state.inProgress) {
    return;
  }
  if (!runtime.telegramClient || runtime.telegramStatus !== 'listening') {
    return;
  }

  state.inProgress = true;
  const primeOnly = Boolean(options.primeOnly);

  try {
    const sources = await collectOperationalTelegramSources(runtime);

    if (!sources.length) {
      return;
    }

    for (const source of sources) {
      const cursorKey = toTelegramSourceCursorKey(source);
      const cursorMap = runtime.telegramSourceCursor;
      const lastSeenId = Number(cursorMap.get(cursorKey) || 0);
      const messages = await fetchSourceMessages(runtime, source, lastSeenId);

      if (!messages.length) {
        continue;
      }

      const sorted = [...messages]
        .map((message) => ({ message, id: Number(message?.id ?? 0) }))
        .filter((item) => Number.isFinite(item.id) && item.id > 0)
        .sort((left, right) => left.id - right.id);

      if (!sorted.length) {
        continue;
      }

      const highestId = sorted[sorted.length - 1].id;
      cursorMap.set(cursorKey, Math.max(lastSeenId, highestId));

      if (!state.warmupDoneBySource.has(cursorKey)) {
        state.warmupDoneBySource.add(cursorKey);
        if (primeOnly || lastSeenId === 0) {
          continue;
        }
      }

      if (primeOnly) {
        continue;
      }

      const freshMessages = sorted
        .filter((item) => item.id > lastSeenId)
        .map((item) => item.message)
        .filter((message) => message && !message.out);

      for (const message of freshMessages) {
        try {
          await runtime.routeTelegramUserMessage({ message });
        } catch (error) {
          runtime.log(`Falha ao processar fallback de mensagem do Telegram (${source}): ${error.message}`, {
            level: 'error',
            type: 'telegram_poll_forward_error',
            increments: { errors: 1 },
            metadata: {
              sourceId: source
            }
          });
        }
      }
    }
  } catch (error) {
    runtime.log(`Falha no fallback de captura do Telegram: ${error.message}`, {
      level: 'error',
      type: 'telegram_poll_error',
      increments: { errors: 1 }
    });
  } finally {
    state.inProgress = false;
  }
}

async function collectOperationalTelegramSources(runtime) {
  const sources = new Set();
  const bridgeSource = String(runtime.config?.telegramChannel || '').trim();

  if (bridgeSource) {
    sources.add(bridgeSource);
  }

  try {
    const affiliateState = await getAffiliateState(runtime.userId);
    const activeAutomations = Array.isArray(affiliateState?.automations)
      ? affiliateState.automations.filter((automation) => automation?.isActive)
      : [];

    for (const automation of activeAutomations) {
      const sourceId = String(automation?.telegramSourceGroupId || '').trim();
      if (sourceId) {
        sources.add(sourceId);
      }
    }
  } catch {
    // Ignore affiliate state failures: bridge source may still be enough.
  }

  return [...sources];
}

async function fetchSourceMessages(runtime, sourceId, lastSeenId) {
  const candidates = buildSourceCandidates(sourceId);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const params = {
        limit: telegramFallbackPollBatchSize
      };
      if (lastSeenId > 0) {
        params.minId = lastSeenId;
      }

      const messages = await runtime.telegramClient.getMessages(candidate, params);
      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

function buildSourceCandidates(sourceId) {
  const raw = String(sourceId || '').trim();

  if (!raw) {
    return [];
  }

  const candidates = new Set([raw]);
  const normalized = normalizeTelegramSourceRef(raw);

  if (!normalized) {
    return [...candidates];
  }

  if (normalized.startsWith('@')) {
    candidates.add(normalized);
    return [...candidates];
  }

  candidates.add(normalized);
  candidates.add(`-${normalized}`);
  if (/^\d+$/.test(normalized)) {
    candidates.add(`-100${normalized}`);
  }

  return [...candidates];
}

function normalizeTelegramSourceRef(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return '';
  }
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

function toTelegramSourceCursorKey(value) {
  const normalized = normalizeTelegramSourceRef(value);

  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('@')) {
    return `username:${normalized}`;
  }

  return `id:${normalized}`;
}

function normalizeBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}
