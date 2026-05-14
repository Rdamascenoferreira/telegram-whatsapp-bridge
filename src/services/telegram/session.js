import { Api, TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { saveConfigForUser } from '../../configStore.js';

export async function startTelegram(runtime) {
  await stopTelegramTransport(runtime);
  runtime.telegramAvailableChats = [];
  runtime.telegramUserProfile = null;

  await startTelegramUser(runtime);
}

export async function stopTelegramTransport(runtime) {
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
