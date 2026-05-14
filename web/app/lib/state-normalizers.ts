import type { AppState } from '../types/panel';

export function createAuthenticatedShellState(auth: AppState['auth']): AppState {
  return {
    auth,
    whatsAppStatus: 'loading',
    telegramStatus: 'loading',
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
      postLayout: {
        enabled: false,
        brandName: '',
        headline: 'Ofertas selecionadas',
        footerText: 'Seleção premium de ofertas',
        primaryColor: '#0f172a',
        accentColor: '#25D366',
        backgroundColor: '#ffffff',
        textColor: '#111827',
        maxProducts: 2
      },
      selectedGroupIds: []
    },
    metrics: {},
    telegram: {
      authPhase: 'loading',
      availableChats: []
    },
    qrDataUrl: null,
    activity: [],
    offers: [],
    groups: [],
    admin: null,
    affiliate: {
      account: null,
      automations: [],
      logs: [],
      termsAccepted: false
    },
    issue: null
  };
}

export function normalizeAppState(nextState: AppState): AppState {
  if (!nextState.auth.authenticated) {
    return nextState;
  }

  const shell = createAuthenticatedShellState(nextState.auth);
  const fallbackAffiliate = shell.affiliate || {
    account: null,
    automations: [],
    logs: [],
    termsAccepted: false
  };

  return {
    ...shell,
    ...nextState,
    config: {
      ...shell.config,
      ...(nextState.config || {})
    },
    metrics: {
      ...shell.metrics,
      ...(nextState.metrics || {})
    },
    telegram: {
      ...shell.telegram,
      ...(nextState.telegram || {}),
      availableChats: Array.isArray(nextState.telegram?.availableChats)
        ? nextState.telegram.availableChats
        : shell.telegram.availableChats
    },
    activity: Array.isArray(nextState.activity) ? nextState.activity : shell.activity,
    offers: Array.isArray(nextState.offers) ? nextState.offers : shell.offers,
    groups: Array.isArray(nextState.groups) ? nextState.groups : shell.groups,
    affiliate: {
      ...fallbackAffiliate,
      ...(nextState.affiliate || {}),
      account: nextState.affiliate?.account ?? fallbackAffiliate.account,
      automations: Array.isArray(nextState.affiliate?.automations)
        ? nextState.affiliate.automations
        : fallbackAffiliate.automations,
      logs: Array.isArray(nextState.affiliate?.logs)
        ? nextState.affiliate.logs
        : fallbackAffiliate.logs
    },
    admin: nextState.admin ?? shell.admin
  };
}
