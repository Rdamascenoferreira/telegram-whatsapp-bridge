'use client';

import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  Camera,
  CheckCircle2,
  Clock3,
  CreditCard,
  Eye,
  Gauge,
  LockKeyhole,
  Mail,
  MessageSquare,
  Power,
  RefreshCcw,
  Rocket,
  Search,
  Send,
  Settings2,
  Shield,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Trash2,
  User,
  Users,
  X,
  Zap
} from 'lucide-react';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarBadge, Field, LoadingScreen, ReadOnlyModeBanner } from './components/common-ui';
import { ConnectionSummary, ConnectionsPanel, InternalSetupChecklist } from './components/connections-panel';
import { FlowSaveActionsCard } from './components/flow-save-actions-card';
import { Topbar } from './components/topbar';
import { usePolledState } from './hooks/usePolledState';
import { useSessionStorageBoolean } from './hooks/useSessionStorageBoolean';
import { ApiRequestError, postJson, requestJson } from '../lib/http';
import {
  formatDate,
  formatNumber,
  formatOfferStatus,
  humanize,
  isWhatsAppConnectedStatus,
  lastLabel,
  normalizeRouteSourceId,
  normalizeText
} from '../lib/panel-utils';
import { cn } from '../lib/utils';

const panelVersion = 'Versão 1.17';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  avatarStorage?: 'none' | 'google' | 'upload';
  providers?: string[];
  role?: 'admin' | 'member';
  plan?: string;
  accountStatus?: string;
  billingStatus?: string;
};

type ActivityEvent = {
  id: string;
  at: string;
  level?: 'info' | 'error';
  type?: string;
  message: string;
  metadata?: Record<string, unknown>;
};

type ActivityOffer = {
  id: string;
  at: string;
  lastUpdatedAt?: string;
  status: 'captured' | 'queued' | 'sent' | 'failed' | 'ignored' | string;
  sourceLabel: string;
  preview: string;
  messageCount: number;
  groupCount: number;
  deliveryCount: number;
  fromQueue?: boolean;
  reason?: string;
};

type WhatsAppGroup = {
  id: string;
  name: string;
  selected?: boolean;
  kind?: 'group' | 'announcement' | 'community_group';
  isAnnouncement?: boolean;
  isCommunityLinked?: boolean;
  parentGroupId?: string | null;
};

type TelegramChat = {
  id: string;
  name: string;
  type: 'group' | 'channel';
  role?: 'admin' | 'member';
};

type AffiliateAccount = {
  id?: string;
  amazonTag?: string;
  shopeeAffiliateId?: string;
  shopeeAppId?: string;
  shopeeSecretConfigured?: boolean;
  defaultSubId?: string;
  amazonEnabled?: boolean;
  shopeeEnabled?: boolean;
};

type AffiliateAutomation = {
  id: string;
  name: string;
  telegramSourceGroupId: string;
  telegramSourceGroupName?: string;
  unknownLinkBehavior?: 'keep' | 'remove' | 'ignore_message';
  customFooter?: string;
  removeOriginalFooter?: boolean;
  messageBeautifierEnabled?: boolean;
  messageBeautifierStyle?: 'clean' | 'sales' | 'urgent' | 'plain';
  aiRewriteEnabled?: boolean;
  aiRewriteStyle?: 'clean' | 'sales' | 'urgent' | 'plain';
  mediaSourceMode?: 'telegram_media' | 'product_image';
  preserveOriginalTextEnabled?: boolean;
  telegramForwardEnabled?: boolean;
  telegramDestinationGroupId?: string;
  telegramDestinationGroupName?: string;
  isActive: boolean;
  destinations: Array<{
    whatsappGroupId: string;
    whatsappGroupName?: string;
  }>;
};

type AffiliateLog = {
  id: string;
  automationId?: string;
  originalMessage: string;
  processedMessage?: string;
  convertedUrls?: Array<{
    originalUrl: string;
    expandedUrl?: string;
    marketplace: 'amazon' | 'shopee' | 'unknown';
    affiliateUrl?: string;
    affiliateId?: string;
    subIds?: Record<string, string>;
    utmContent?: string;
    status: 'converted' | 'ignored' | 'error';
    error?: string;
  }>;
  status: string;
  errorMessage?: string;
  createdAt: string;
};

type AdminUser = AuthUser & {
  providers?: string[];
  isOnline?: boolean;
  planLimits?: PlanLimits;
  workspace?: {
    bridgeEnabled: boolean;
    selectedGroupCount: number;
    whatsAppStatus: string;
    telegramStatus: string;
  };
  metrics?: {
    totalTelegramReceived?: number;
    totalForwardedMessages?: number;
    totalWhatsAppDeliveries?: number;
    totalErrors?: number;
    lastActivityAt?: string | null;
    lastForwardedAt?: string | null;
  };
  supervisor?: SupervisorSession | null;
};

type PlanLimits = {
  plan: string;
  label: string;
  telegramSources: number;
  whatsappDestinations: number;
  affiliateAutomations: number;
  amazonAffiliate: boolean;
  shopeeAffiliate: boolean;
  dailyMessages: number;
  historyDays: number;
};

type SupervisorSession = {
  userId: string;
  telegramStatus: string;
  whatsAppStatus: string;
  whatsAppPhone?: string | null;
  bridgeEnabled?: boolean;
  selectedGroupCount?: number;
  pendingTelegramCount?: number;
  lastActivityAt?: string | null;
  lastForwardedAt?: string | null;
  totalErrors?: number;
  deliveryStats?: {
    skippedDuplicates?: number;
    transientFailures?: number;
    fatalFailures?: number;
  };
  deliveryQueue?: {
    active?: boolean;
    activeJob?: {
      name?: string;
      startedAt?: string;
    } | null;
    queuedCount?: number;
    completedCount?: number;
    failedCount?: number;
    delayMs?: number;
    retryLimit?: number;
    maxQueuedJobs?: number;
    lastCompletedAt?: string | null;
    lastFailedAt?: string | null;
    lastError?: string | null;
  };
};

type AppState = {
  auth: {
    authenticated: boolean;
    googleEnabled: boolean;
    user: AuthUser | null;
    error?: string;
  };
  whatsAppStatus: string;
  whatsAppPhone?: string | null;
  telegramStatus: string;
  planLimits?: PlanLimits;
  qrDataUrl?: string | null;
  config: {
    telegramMode: 'user' | 'bot';
    telegramChannel: string;
    telegramApiId: string;
    telegramApiHash: string;
    telegramPhone: string;
    hasTelegramBotToken: boolean;
    hasTelegramSession: boolean;
    bridgeEnabled: boolean;
    disconnectWhatsAppOnLogout?: boolean;
    dashboardViewClearedAt?: string;
    selectedGroupIds: string[];
  };
  metrics: {
    totalTelegramReceived?: number;
    totalForwardBatches?: number;
    totalForwardedMessages?: number;
    totalWhatsAppDeliveries?: number;
    totalErrors?: number;
    selectedGroupCount?: number;
    availableAdminGroupCount?: number;
    pendingTelegramCount?: number;
    deliveryStats?: {
      skippedDuplicates?: number;
      transientFailures?: number;
      fatalFailures?: number;
    };
    groupsRefreshing?: boolean;
    groupRefreshProgress?: {
      phase?: string;
      total?: number;
      processed?: number;
      percent?: number;
      foundAdmins?: number;
    };
    groupCacheRefreshedAt?: string;
    hasCachedGroups?: boolean;
    lastActivityAt?: string;
    lastTelegramMessageAt?: string;
    lastForwardedAt?: string;
    lastErrorAt?: string;
  };
  telegram: {
    authPhase: string;
    passwordRequired?: boolean;
    availableChats?: TelegramChat[];
    user?: {
      name?: string;
      username?: string;
      phone?: string;
    };
  };
  activity: ActivityEvent[];
  offers?: ActivityOffer[];
  groups: WhatsAppGroup[];
  admin?: {
    users: AdminUser[];
    summary?: Record<string, number>;
    supervisor?: {
      totalRuntimes?: number;
      readyWhatsApp?: number;
      listeningTelegram?: number;
      queuedDeliveries?: number;
      activeDeliveries?: number;
      skippedDuplicates?: number;
      transientFailures?: number;
      fatalFailures?: number;
      healthAlerts?: Array<{
        level?: 'warning' | 'critical' | string;
        code?: string;
        message?: string;
      }>;
      sessions?: SupervisorSession[];
    };
  } | null;
  affiliate?: {
    account: AffiliateAccount | null;
    automations: AffiliateAutomation[];
    logs: AffiliateLog[];
    termsAccepted?: boolean;
    termsVersion?: string;
    error?: string;
  };
  issue?: {
    scope?: string;
    message?: string;
    canReconnect?: boolean;
    canResetSession?: boolean;
  } | null;
  issues?: Array<{
    scope?: string;
    message?: string;
  }>;
};

type ViewKey = 'overview' | 'connections' | 'groups' | 'flows' | 'affiliate' | 'planUsage' | 'activity' | 'account' | 'admin';
type FlowFieldErrors = Partial<Record<'telegram' | 'telegramSourceGroupId' | 'destinations' | 'flow', string>>;

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Gauge }> = [
  { key: 'overview', label: 'Dashboard', icon: Gauge },
  { key: 'connections', label: 'Config. Telegram', icon: Settings2 },
  { key: 'groups', label: 'Config. WhatsApp', icon: Users },
  { key: 'flows', label: 'Fluxos', icon: ArrowRight },
  { key: 'affiliate', label: 'Config. Afiliados', icon: CreditCard },
  { key: 'planUsage', label: 'Plano e Uso', icon: TrendingUp },
  { key: 'activity', label: 'Histórico', icon: Activity },
  { key: 'account', label: 'Conta', icon: User },
  { key: 'admin', label: 'Admin', icon: Shield }
];

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && state.auth.user?.role !== 'admin';
}

function createAuthenticatedShellState(auth: AppState['auth']): AppState {
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
      selectedGroupIds: []
    },
    metrics: {},
    telegram: {
      authPhase: 'loading',
      availableChats: []
    },
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

function normalizeAppState(nextState: AppState): AppState {
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

export default function Home() {
  const [view, setView] = useState<ViewKey>('overview');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [affiliateAutomationEditing, setAffiliateAutomationEditing] = useSessionStorageBoolean('affiliate-automation-editing');
  const { state, setState, bootError, setBootError, reload } = usePolledState<AppState>({
    fetcher: async () => await requestJson<AppState>('/api/state'),
    normalize: normalizeAppState,
    defaultErrorMessage: 'não foi possivel carregar o painel agora. Tente novamente.',
    pausePolling: view === 'flows' && affiliateAutomationEditing,
    pollIntervalMs: 5000
  });
  const loadState = useCallback(async () => {
    await reload({ suppressBootError: true });
  }, [reload]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!state) {
    return (
      <LoadingScreen
        error={bootError}
        onRetry={() => {
          setBootError('');
          void reload().catch(() => undefined);
        }}
      />
    );
  }

  if (!state.auth.authenticated) {
    return (
        <AuthScreen
          googleEnabled={state.auth.googleEnabled}
          onAuthenticated={(auth) => {
            setView('overview');
            setState(createAuthenticatedShellState(auth));
            void loadState().catch((error) => {
              setNotice(
                error instanceof Error
                  ? `Login realizado, mas o painel completo demorou para carregar: ${error.message}`
                  : 'Login realizado, mas não foi possivel carregar o painel completo.'
              );
            });
          }}
          notice={notice || state.auth.error || ''}
          setNotice={setNotice}
        />
      );
    }

  const isAdmin = state.auth.user?.role === 'admin';
  const readOnlyAccount = isReadOnlyAccount(state);
  const flowsPanelKey = affiliateAutomationEditing
    ? 'editing'
    : `${state.config.telegramChannel || ''}:${state.affiliate?.automations?.[0]?.id || 'no-automation'}:${state.affiliate?.automations?.[0]?.telegramSourceGroupId || ''}:${(state.config.selectedGroupIds || []).join(',')}`;
  const connectionsPanelKey = `${state.config.telegramApiId || ''}:${state.config.telegramApiHash || ''}:${state.config.telegramPhone || ''}:${String(Boolean(state.config.hasTelegramSession))}:${state.telegram.authPhase || ''}:${state.telegramStatus || ''}`;
  const groupsPanelKey = `${(state.config.selectedGroupIds || []).join(',')}:${String(Boolean(state.config.disconnectWhatsAppOnLogout))}`;
  const affiliatePanelKey = `${state.affiliate?.account?.id || 'no-account'}:${state.affiliate?.automations?.[0]?.id || 'no-automation'}`;
  const accountPanelKey = `${state.auth.user?.id || 'anonymous'}:${state.auth.user?.name || ''}:${state.auth.user?.avatarUrl || ''}`;
  const topbarHasTelegramSource = hasOperationalTelegramSource(state);
  const topbarHasWhatsAppDestination = hasOperationalWhatsAppDestination(state);
  const topbarWhatsAppConnected = isWhatsAppConnectedStatus(state.whatsAppStatus);
  const topbarCanEnableAutomation = canEnableAutomationState(state);
  const topbarEffectiveBridgeEnabled = state.config.bridgeEnabled && topbarCanEnableAutomation;
  const topbarSteps = [
    { label: 'Telegram', done: state.telegramStatus === 'listening' },
    { label: 'WhatsApp', done: topbarWhatsAppConnected },
    { label: 'Origem', done: topbarHasTelegramSource },
    { label: 'Destino', done: topbarHasWhatsAppDestination },
    { label: 'Ativo', done: topbarEffectiveBridgeEnabled, ready: !topbarEffectiveBridgeEnabled && topbarCanEnableAutomation }
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen grid-cols-[260px_1fr] max-lg:grid-cols-1">
        <aside className="border-r border-[var(--border)] bg-black/15 px-4 py-5 max-lg:border-b max-lg:border-r-0">
          <div className="mb-7 flex items-center gap-3 px-2">
            <AvatarBadge user={state.auth.user} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Portal do Afiliado</p>
              <p className="truncate text-xs text-[var(--muted)]">
                {state.auth.user?.name || panelVersion}
              </p>
            </div>
          </div>

          <nav className="grid gap-1">
            {navItems
              .filter((item) => item.key !== 'admin' || isAdmin)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setView(item.key)}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-[var(--muted)] transition',
                      view === item.key
                        ? 'bg-[var(--panel-strong)] text-[var(--foreground)]'
                        : 'hover:bg-white/5 hover:text-[var(--foreground)]'
                    )}
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
          </nav>
        </aside>

        <section className="min-w-0 px-6 py-5 max-sm:px-4">
          <Topbar
            telegramStatus={state.telegramStatus}
            whatsAppStatus={state.whatsAppStatus}
            steps={topbarSteps}
            onLogout={async () => {
              setView('overview');
              try {
                await postJson('/api/whatsapp/logout-action');
              } catch {}
              await postJson('/api/auth/logout');
              await loadState();
            }}
          />

          {notice ? (
            <div className="mb-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

          {readOnlyAccount ? <ReadOnlyModeBanner /> : null}

          {view === 'overview' ? (
            <Overview state={state} setNotice={setNotice} setBusy={setBusy} busy={busy} refresh={loadState} setView={setView} />
          ) : null}
          {view === 'connections' ? (
            <ConnectionsPanel
              key={connectionsPanelKey}
              state={state}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
              readOnlyAccount={readOnlyAccount}
              primaryButtonClassName={primaryButton}
              secondaryButtonClassName={secondaryButton}
            />
          ) : null}
          {view === 'groups' ? (
            <Groups
              key={groupsPanelKey}
              state={state}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
            />
          ) : null}
          {view === 'flows' ? (
            <FlowsPanel
              key={flowsPanelKey}
              state={state}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
              groupFilter={groupFilter}
              setGroupFilter={setGroupFilter}
              isAutomationEditing={affiliateAutomationEditing}
              setAutomationEditing={setAffiliateAutomationEditing}
            />
          ) : null}
          {view === 'affiliate' ? (
            <AffiliateAutomationPanel
              key={affiliatePanelKey}
              state={state}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
            />
          ) : null}
          {view === 'planUsage' ? <PlanUsagePanel state={state} setView={setView} /> : null}
          {view === 'activity' ? <ActivityLog state={state} /> : null}
          {view === 'account' ? <AccountPanel key={accountPanelKey} state={state} refresh={loadState} setNotice={setNotice} /> : null}
          {view === 'admin' && isAdmin ? <AdminPanel state={state} refresh={loadState} setNotice={setNotice} /> : null}
        </section>
      </div>
    </main>
  );
}

function AuthScreen({
  googleEnabled,
  onAuthenticated,
  notice,
  setNotice
}: {
  googleEnabled: boolean;
  onAuthenticated: (auth: AppState['auth']) => void | Promise<void>;
  notice: string;
  setNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const auth = await postJson<AppState['auth']>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', payload);
      void onAuthenticated(auth);
      setNotice('Login realizado com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possivel continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#03130D] px-6 py-8 text-[var(--foreground)] max-sm:px-4">
      <div className="mx-auto max-w-[1480px]">
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.16fr)_460px] lg:items-start">
          <div className="pointer-events-none absolute inset-x-[12%] top-8 hidden h-[420px] rounded-full bg-[radial-gradient(circle,rgba(37,211,102,0.1),transparent_58%)] blur-3xl lg:block" />
          <div className="pointer-events-none absolute right-[24%] top-20 hidden h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(34,158,217,0.08),transparent_60%)] blur-3xl lg:block" />

          <section className="relative z-10 overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(6,24,17,0.96),rgba(3,19,13,0.98))] p-7 shadow-[0_24px_64px_rgba(0,0,0,0.34)] max-xl:p-6 max-sm:rounded-[22px] max-sm:p-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_24%),radial-gradient(circle_at_right,rgba(34,158,217,0.08),transparent_22%)]" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.18)] bg-[rgba(5,24,17,0.74)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#DDFCEF] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <Zap size={14} className="text-[#25D366]" />
                  Operação automatizada com <span className="text-[#25D366]">Telegram</span> + <span className="text-[#229ED9]">WhatsApp</span> + afiliados
              </span>

              <div className="mt-6 grid gap-5 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start max-sm:grid-cols-1">
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[22px] border border-[rgba(37,211,102,0.24)] bg-[linear-gradient(180deg,rgba(6,22,16,0.95),rgba(8,30,22,0.92))] shadow-[0_14px_28px_rgba(0,0,0,0.24),0_0_0_1px_rgba(255,255,255,0.03)] max-sm:h-16 max-sm:w-16">
                  <img src="/brand/portal-icon.svg" alt="Portal do Afiliado" className="h-11 w-11 object-contain max-sm:h-9 max-sm:w-9" />
                </div>
                <div className="min-w-0">
                  <div className="grid gap-1">
                    <span className="text-sm font-semibold uppercase tracking-[0.34em] text-[#9FD0B7]">Portal do</span>
                    <span className="text-[3.25rem] font-semibold leading-none text-[#F8FAFC] max-xl:text-[2.8rem] max-sm:text-[2.35rem]">
                      Afiliado
                    </span>
                  </div>

                  <h1 className="mt-5 max-w-4xl text-[4rem] font-semibold leading-[0.98] text-[#F8FAFC] max-xl:max-w-3xl max-xl:text-[3.4rem] max-lg:text-[3rem] max-sm:text-[2.5rem]">
                    Sua oferta entra no Telegram,
                    <br />
                    o painel organiza tudo
                    <br />
                    <span className="bg-[linear-gradient(90deg,#25D366,#229ED9)] bg-clip-text text-transparent">e sai pronta para vender.</span>
                  </h1>

                  <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#AAB8B0] max-sm:text-base max-sm:leading-7">
                    Centralize origem, destinos, sessoes, Histórico e testes em um painel pensado para Operação real. Quando quiser, ative o modulo de afiliados para tratar links Amazon e Shopee antes do envio e manter a mensagem pronta para conversao.
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <AuthMetricPill label="Origem Telegram" value="Conta propria" accentClassName="text-[#25D366]" />
                    <AuthMetricPill label="Entrega" value="WhatsApp controlado" accentClassName="text-[#229ED9]" />
                    <AuthMetricPill label="Afiliados" value="Amazon + Shopee" accentClassName="text-[#7EE59F]" />
                    <AuthMetricPill label="Operação" value="Histórico e testes" accentClassName="text-[#9FD7FF]" />
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-[rgba(37,211,102,0.18)] bg-[linear-gradient(135deg,rgba(8,34,24,0.9),rgba(6,24,17,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                    <Rocket size={19} className="text-[#25D366]" />
                  </div>
                  <p className="text-base leading-7 text-[#DBEAE1]">
                    O cliente escolhe a origem no Telegram, define os destinos no WhatsApp, valida o fluxo antes de ativar e acompanha tudo no painel. Sem copia e cola manual, sem perder contexto e com visibilidade clara do que foi captado, tratado e entregue.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(9,27,19,0.88),rgba(5,18,13,0.94))] p-5 shadow-[0_12px_34px_rgba(0,0,0,0.22)] lg:grid-cols-3">
                <AuthFlowStep
                  icon={Send}
                  title="1. Conecte a origem"
                  text="FaÃ§a login no Telegram com sua propria conta e escolha o grupo ou canal que será monitorado."
                />
                <AuthFlowStep
                  icon={Smartphone}
                  title="2. Defina os destinos"
                  text="Conecte o WhatsApp, escolha os grupos de entrega e salve o fluxo da Operação em poucos passos."
                />
                <AuthFlowStep
                  icon={CreditCard}
                  title="3. Ative afiliados quando quiser"
                  text="Trate links, adicione rodape proprio, rode testes e publique a saida final de forma mais profissional."
                />
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(7,26,18,0.92),rgba(4,18,13,0.96))] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#5DE0A0]">Central de Operação</p>
                  <h2 className="mt-3 max-w-lg text-[2.3rem] font-semibold leading-[1.04] text-[#F8FAFC] max-sm:text-[1.9rem]">
                    Uma estrutura pronta para rodar todo dia.
                  </h2>
                  <p className="mt-3 max-w-lg text-[0.98rem] leading-7 text-[#AAB8B0]">
                    O Portal do Afiliado conecta sua conta do Telegram, mantem a sessão do WhatsApp, organiza grupos de destino, registra Histórico, oferece teste manual e separa a Operação comum da automação de afiliados. O resultado e mais controle, menos retrabalho e uma rotina comercial muito mais previsivel.
                  </p>

                  <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#C8D7D0]">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.16)] bg-[rgba(37,211,102,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7F3C0]">
                      <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                      Leitura de origem no Telegram
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(34,158,217,0.16)] bg-[rgba(34,158,217,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7E5FF]">
                      <span className="h-2 w-2 rounded-full bg-[#229ED9]" />
                      Entrega controlada no WhatsApp
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.16)] bg-[rgba(37,211,102,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7F3C0]">
                      <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                      Modulo de afiliados separado
                    </span>
                    <span className="text-[#8FA69C]">Cada fluxo tem regra propria, com rastreabilidade do que entrou, do que foi tratado e para onde a mensagem saiu.</span>
                  </div>
                </div>

                <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(circle_at_top,rgba(34,158,217,0.08),transparent_32%),linear-gradient(180deg,rgba(8,29,21,0.82),rgba(4,18,13,0.92))] p-6">
                  <div className="pointer-events-none absolute inset-y-5 left-[14%] w-px bg-[linear-gradient(180deg,transparent,rgba(37,211,102,0.38),transparent)]" />
                  <div className="pointer-events-none absolute inset-y-8 right-[18%] w-px bg-[linear-gradient(180deg,transparent,rgba(34,158,217,0.34),transparent)]" />
                  <div className="pointer-events-none absolute left-14 top-10 h-2 w-2 rounded-full bg-[#25D366] shadow-[0_0_18px_rgba(37,211,102,0.9)]" />
                  <div className="pointer-events-none absolute right-20 top-16 h-2 w-2 rounded-full bg-[#229ED9] shadow-[0_0_18px_rgba(34,158,217,0.9)]" />
                  <div className="pointer-events-none absolute right-14 bottom-12 h-2 w-2 rounded-full bg-[#25D366] shadow-[0_0_18px_rgba(37,211,102,0.8)]" />

                  <div className="relative w-full max-w-[360px] rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(18,32,28,0.95),rgba(7,20,16,0.92))] p-4 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8BA39A]">Painel operacional</p>
                        <p className="mt-1 text-sm text-[#DCE9E2]">Operação acompanhada em tempo real</p>
                      </div>
                      <div className="rounded-full border border-[rgba(37,211,102,0.2)] bg-[rgba(37,211,102,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[#9CF0BF]">
                        Em monitoramento
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2.5">
                      <AuthDashboardStat label="Origens" value="07" />
                      <AuthDashboardStat label="Destinos" value="82" />
                      <AuthDashboardStat label="Fluxos" value="05" />
                    </div>

                    <div className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
                      <div className="flex items-end gap-2">
                        {[34, 46, 42, 58, 74, 68, 82].map((height, index) => (
                          <div key={index} className="flex-1">
                            <div
                              className="rounded-t-full bg-[linear-gradient(180deg,rgba(37,211,102,0.95),rgba(34,158,217,0.88))]"
                              style={{ height }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-[#7E9088]">
                        <span>Entrega monitorada</span>
                        <span>Visão operacional</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2">
                      <AuthDashboardRow label="Mensagens captadas" value="29.300" />
                      <AuthDashboardRow label="Entregas concluidas" value="4.190" />
                      <AuthDashboardRow label="Conversoes de links" value="1.284" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <AuthMiniSignal
                        icon={Smartphone}
                        title="WhatsApp"
                        detail="sessão valida"
                        accentClassName="text-[#25D366]"
                        panelClassName="border-[rgba(37,211,102,0.14)] bg-[rgba(37,211,102,0.06)]"
                      />
                      <AuthMiniSignal
                        icon={Send}
                        title="Telegram"
                        detail="Escuta ativa"
                        accentClassName="text-[#229ED9]"
                        panelClassName="border-[rgba(34,158,217,0.14)] bg-[rgba(34,158,217,0.06)]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <AuthBenefitCard
                  icon={Gauge}
                  iconClassName="text-[#25D366]"
                  title="Origem controlada"
                  text="Escolha exatamente qual grupo ou canal será monitorado. A Operação parte de uma origem definida, com menos erro e mais consistencia."
                />
                <AuthBenefitCard
                  icon={Clock3}
                  iconClassName="text-[#229ED9]"
                  title="Teste antes do envio real"
                  text="Simule mensagens, revise a saida final e ative a automação so quando o fluxo estiver validado. Mais seguranca e menos tentativa no escuro."
                />
                <AuthBenefitCard
                  icon={ShieldCheck}
                  iconClassName="text-[#76E599]"
                  title="Afiliados integrados"
                  text="Converta links Amazon, organize a Operação da Shopee e mantenha o modulo de afiliados separado da ponte comum entre Telegram e WhatsApp."
                />
              </div>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-[rgba(37,211,102,0.16)] bg-[linear-gradient(180deg,rgba(8,29,21,0.9),rgba(4,18,13,0.96))] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.24)] lg:grid-cols-3">
                <AuthTrustItem
                  icon={TrendingUp}
                  title="Histórico auditavel"
                  label="veja o que entrou, o que foi processado, para onde saiu e quando cada entrega aconteceu."
                  accentClassName="text-[#25D366]"
                />
                <AuthTrustItem
                  icon={ShieldCheck}
                  title="Sessoes sempre visiveis"
                  label="o painel mostra o estado do Telegram e do WhatsApp para a equipe agir rápido quando precisar."
                  accentClassName="text-[#77E6A0]"
                />
                <AuthTrustItem
                  icon={Users}
                  title="Estrutura de SaaS real"
                  label="conta, grupos, fluxos, afiliados, Histórico e administracao no mesmo ambiente."
                  accentClassName="text-[#51CFFF]"
                />
              </div>
            </div>
          </section>

          <section className="relative z-10 rounded-[30px] border border-[rgba(255,255,255,0.1)] bg-[linear-gradient(180deg,rgba(7,26,18,0.98),rgba(4,18,13,0.99))] p-6 shadow-[0_24px_72px_rgba(0,0,0,0.36)] max-sm:rounded-[24px] max-sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[2.1rem] font-semibold leading-[1.08] text-[#F8FAFC]">Entrar na plataforma</h2>
                <p className="mt-3 max-w-sm text-[1.05rem] leading-8 text-[#AAB8B0]">
                  Acesse o painel para configurar suas conexões, organizar os fluxos, validar as entregas e operar sua estrutura de Telegram, WhatsApp e afiliados em um so lugar.
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(34,158,217,0.18)] bg-[rgba(34,158,217,0.08)] shadow-[0_12px_26px_rgba(0,0,0,0.2)]">
                <LockKeyhole size={22} className="text-[#7ED4FF]" />
              </div>
            </div>

            <div className="mt-7 grid w-full grid-cols-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-1.5">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={cn(
                  'rounded-xl px-4 py-3 text-base font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.16)]',
                  mode === 'login'
                    ? 'bg-[linear-gradient(90deg,#25D366,#21C0B7)] text-[#03130D] shadow-[0_10px_26px_rgba(37,211,102,0.2)]'
                    : 'text-[#AAB8B0] hover:bg-white/[0.03] hover:text-[#F8FAFC]'
                )}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={cn(
                  'rounded-xl px-4 py-3 text-base font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgba(34,158,217,0.14)]',
                  mode === 'register'
                    ? 'bg-[linear-gradient(90deg,#25D366,#21C0B7)] text-[#03130D] shadow-[0_10px_26px_rgba(37,211,102,0.2)]'
                    : 'text-[#AAB8B0] hover:bg-white/[0.03] hover:text-[#F8FAFC]'
                )}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={submit} className="mt-7 grid gap-5">
              {mode === 'register' ? (
                <Field label="Nome" name="name" placeholder="Seu nome" autoComplete="name" icon={Users} />
              ) : null}
              <Field label="E-mail" name="email" placeholder="você@empresa.com" autoComplete="email" icon={Mail} />
              <Field
                label="Senha"
                name="password"
                type="password"
                placeholder="********"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                icon={LockKeyhole}
                rightSlot={<Eye size={18} className="text-[#7D8D86]" />}
              />

              <div className="-mt-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setNotice('Recuperação de senha estará disponivel em breve.')}
                  className="text-sm font-semibold text-[#32D07C] transition hover:text-[#5EE19C] focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.16)]"
                >
                  Esqueci minha senha
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-3 rounded-[18px] bg-[linear-gradient(90deg,#25D366,#21C0B7)] px-5 py-4 text-xl font-semibold text-[#03130D] transition hover:translate-y-[-1px] hover:shadow-[0_18px_34px_rgba(37,211,102,0.18)] focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.2)] active:translate-y-0 disabled:translate-y-0 disabled:opacity-60"
              >
                {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta'}
                {!busy ? <ArrowRight size={22} /> : null}
              </button>
            </form>

            <div className="mt-6 rounded-[20px] border border-[rgba(34,158,217,0.14)] bg-[linear-gradient(180deg,rgba(8,24,18,0.7),rgba(7,20,16,0.82))] px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[rgba(34,158,217,0.18)] bg-[rgba(34,158,217,0.08)]">
                  <Gauge size={18} className="text-[#7ED4FF]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#E8F6EF]">O que você encontra depois do login</p>
                  <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#AAB8B0]">
                    <li>configuração separada para Telegram, WhatsApp, Fluxos e Afiliados.</li>
                    <li>Histórico operacional com mensagens, entregas e eventos recentes.</li>
                    <li>Teste manual para validar a saida antes de ligar a automação.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="my-8 flex items-center gap-4 text-sm text-[#7A8B83]">
              <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
              ou continue com
              <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
            </div>

            {googleEnabled ? (
              <a
                href="/auth/google"
                className="flex items-center justify-center gap-3 rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-lg font-medium transition hover:border-[rgba(34,158,217,0.22)] hover:bg-[rgba(34,158,217,0.06)] focus:outline-none focus:ring-2 focus:ring-[rgba(34,158,217,0.18)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-black">G</span>
                Continuar com Google
              </a>
            ) : (
              <p className="rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-sm text-[#AAB8B0]">
                Login com Google estará disponivel em breve.
              </p>
            )}

            <div className="mt-8 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                  <ShieldCheck size={18} className="text-[#46E285]" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[#E8F6EF]">Painel feito para Operação diaria</p>
                  <p className="mt-1 text-sm leading-6 text-[#AAB8B0]">
                    Login, sessoes, grupos, fluxos, Histórico e afiliados centralizados em uma experiencia unica para quem precisa publicar, acompanhar e ajustar rápido.
                  </p>
                </div>
              </div>
            </div>

            {notice ? (
              <p className="mt-5 rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3.5 text-sm text-[#F8FAFC]">
                {notice}
              </p>
            ) : null}
          </section>
        </div>

        <footer className="mt-6 text-center text-xs leading-6 text-[#6F8178]">
          Copyright 2026 Portal do Afiliado. Todos os direitos reservados. Proibida a copia, distribuicao ou reproducao sem autorizacao. Criado por Rodrigo Damasceno.
        </footer>
      </div>
    </main>
  );
}

function AuthDashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[#7B8D85]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[#F8FAFC]">{value}</p>
    </div>
  );
}

function AuthMetricPill({
  label,
  value,
  accentClassName
}: {
  label: string;
  value: string;
  accentClassName: string;
}) {
  return (
    <div className="rounded-[18px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7F9289]">{label}</p>
      <p className={cn('mt-2 text-sm font-semibold', accentClassName)}>{value}</p>
    </div>
  );
}

function AuthFlowStep({
  icon: Icon,
  title,
  text
}: {
  icon: typeof Send;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[20px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] p-4">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={18} className="text-[#DDFCEF]" />
      </div>
      <p className="mt-4 text-base font-semibold text-[#F8FAFC]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#AAB8B0]">{text}</p>
    </div>
  );
}

function AuthDashboardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.025)] px-3 py-2.5">
      <p className="text-sm text-[#B8C7C0]">{label}</p>
      <p className="text-sm font-semibold text-[#F8FAFC]">{value}</p>
    </div>
  );
}

function AuthMiniSignal({
  icon: Icon,
  title,
  detail,
  accentClassName,
  panelClassName
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  accentClassName: string;
  panelClassName: string;
}) {
  return (
    <div className={cn('rounded-2xl border px-3 py-3', panelClassName)}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.04)]">
          <Icon size={20} className={accentClassName} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#F8FAFC]">{title}</p>
          <p className="text-xs text-[#AAB8B0]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function AuthBenefitCard({
  icon: Icon,
  iconClassName,
  title,
  text
}: {
  icon: typeof Smartphone;
  iconClassName: string;
  title: string;
  text: string;
}) {
  return (
    <article className="flex min-h-[152px] flex-col rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:border-[rgba(37,211,102,0.18)] hover:bg-[rgba(255,255,255,0.04)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={20} className={iconClassName} />
      </div>
      <p className="mt-4 text-[1.05rem] font-semibold leading-6 text-[#F8FAFC]">{title}</p>
      <p className="mt-2 text-[0.95rem] leading-7 text-[#AAB8B0]">{text}</p>
    </article>
  );
}

function AuthTrustItem({
  icon: Icon,
  title,
  label,
  accentClassName
}: {
  icon: typeof TrendingUp;
  title: string;
  label: string;
  accentClassName: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-4 transition hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.03)]">
      <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={22} className={accentClassName} />
      </div>
      <div className="min-w-0">
        <p className="text-[1.18rem] font-semibold leading-6 text-[#F8FAFC]">{title}</p>
        <p className="mt-1 max-w-[16rem] text-sm leading-6 text-[#AAB8B0]">{label}</p>
      </div>
    </div>
  );
}

function Overview({
  state,
  setNotice,
  setBusy,
  busy,
  refresh,
  setView
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
  setView: (view: ViewKey) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const isAdmin = state.auth.user?.role === 'admin';
  const progress = state.metrics.groupRefreshProgress;
  const canEnableAutomation = canEnableAutomationState(state);
  const effectiveBridgeEnabled = state.config.bridgeEnabled && canEnableAutomation;
  const whatsappDestinationsUsed = state.config.selectedGroupIds?.length || 0;
  const automationLockReason = getAutomationLockReason(state);
  const groupProgressText =
    state.metrics.groupsRefreshing && progress?.total
      ? `${progress.processed || 0}/${progress.total} grupos (${progress.percent || 0}%)`
      : `${state.metrics.availableAdminGroupCount || 0} grupos disponíveis`;
  const deliveryStats = state.metrics.deliveryStats || {};
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'errors' | 'delivery' | 'auth'>('all');
  const totalForwarded = state.metrics.totalForwardedMessages || 0;
  const totalErrors = state.metrics.totalErrors || 0;
  const transientFailures = deliveryStats.transientFailures || 0;
  const fatalFailures = deliveryStats.fatalFailures || 0;
  const successRate = totalForwarded > 0
    ? Math.max(0, Math.min(100, Math.round(((totalForwarded - totalErrors) / totalForwarded) * 100)))
    : 100;
  const pendingTelegramCount = state.metrics.pendingTelegramCount || 0;
  const queuedCount = state.metrics.pendingTelegramCount || 0;
  const errorRate = totalForwarded > 0 ? Math.round((totalErrors / totalForwarded) * 100) : 0;
  const retriesShare = totalForwarded > 0 ? Math.round((transientFailures / totalForwarded) * 100) : 0;
  const automationScore = Math.max(0, 100 - Math.min(100, errorRate + Math.round(fatalFailures / 2)));
  const activeAffiliateAutomation = getActiveAffiliateAutomation(state);
  const savedAffiliateSourceId = normalizeRouteSourceId(activeAffiliateAutomation?.telegramSourceGroupId);
  const savedFlowMode: 'bridge' | 'affiliate' = state.config.telegramChannel ? 'bridge' : savedAffiliateSourceId ? 'affiliate' : 'bridge';
  const hasDestinationsReady = (state.config.selectedGroupIds?.length || 0) > 0;
  const bridgeHealth = getFlowHealthStatus({
    selected: savedFlowMode === 'bridge',
    saved: Boolean(normalizeRouteSourceId(state.config.telegramChannel)),
    hasTelegramSession: state.telegramStatus === 'listening',
    sourceId: state.config.telegramChannel,
    hasDestinations: hasDestinationsReady
  });
  const affiliateHealth = getFlowHealthStatus({
    selected: savedFlowMode === 'affiliate',
    saved: Boolean(savedAffiliateSourceId),
    hasTelegramSession: state.telegramStatus === 'listening',
    sourceId: savedAffiliateSourceId,
    requiresPlan: (state.planLimits?.affiliateAutomations ?? 0) > 0,
    hasDestinations: hasDestinationsReady
  });
  const timelineEvents = useMemo(() => {
    const deduped = state.activity.filter((event, index, events) => {
      const previous = events[index - 1];
      if (!previous) {
        return true;
      }
      return !(previous.message === event.message && previous.level === event.level);
    });

    return deduped.filter((event) => {
      if (timelineFilter === 'all') {
        return true;
      }
      if (timelineFilter === 'errors') {
        return event.level === 'error';
      }

      const typeText = String(event.type || '').toLowerCase();
      const messageText = String(event.message || '').toLowerCase();

      if (timelineFilter === 'delivery') {
        return (
          typeText.includes('delivery') ||
          messageText.includes('envio') ||
          messageText.includes('encaminh') ||
          messageText.includes('fila')
        );
      }

      return (
        typeText.includes('auth') ||
        typeText.includes('telegram') ||
        typeText.includes('whatsapp') ||
        messageText.includes('login') ||
        messageText.includes('sessão') ||
        messageText.includes('telegram') ||
        messageText.includes('whatsapp')
      );
    }).slice(0, 8);
  }, [state.activity, timelineFilter]);
  const criticalAlerts: Array<{ id: string; title: string; detail: string; cta: string; goTo: ViewKey }> = [];

  if (state.telegramStatus !== 'listening') {
    criticalAlerts.push({
      id: 'telegram-session',
      title: 'Telegram desconectado',
      detail: 'A captura de mensagens esta pausada até concluir o login.',
      cta: 'Revisar conexao',
      goTo: 'connections'
    });
  }

  if (state.whatsAppStatus !== 'ready') {
    criticalAlerts.push({
      id: 'whatsapp-session',
      title: 'WhatsApp não esta pronto',
      detail: 'As entregas podem falhar enquanto a sessão não estiver autenticada.',
      cta: 'Abrir config. WhatsApp',
      goTo: 'groups'
    });
  }

  if (!hasOperationalTelegramSource(state) || !state.config.selectedGroupIds?.length) {
    criticalAlerts.push({
      id: 'flow-config',
      title: 'Fluxo incompleto',
      detail: 'Falta origem Telegram ou destino WhatsApp para a Operação completa.',
      cta: 'Configurar fluxo',
      goTo: 'flows'
    });
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[linear-gradient(180deg,rgba(8,20,16,0.98),rgba(8,20,16,0.92))] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.2)]">
        <div className="flex items-start justify-between gap-4 max-md:flex-col">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                {panelVersion}
              </span>
              <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold">
                Plano {state.planLimits?.label || humanize(state.auth.user?.plan || 'starter')}
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold">Operação da ponte</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Acompanhe a saúde das conexões, controle a automação e valide se as mensagens estão fluindo.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 rounded-xl border border-[var(--border)] bg-black/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">automação ativa</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {effectiveBridgeEnabled
                    ? 'A ponte pode encaminhar mensagens normalmente.'
                    : state.config.bridgeEnabled
                      ? 'A automação foi pausada porque nem todas as conexões estão prontas.'
                    : canEnableAutomation
                      ? 'As mensagens recebidas ficam sem encaminhamento até você ligar de novo.'
                      : automationLockReason}
                </p>
              </div>
              <SystemPowerSwitch
                checked={effectiveBridgeEnabled}
                disabled={readOnlyAccount || busy === 'power' || !canEnableAutomation}
                onChange={async (nextValue) => {
                  if (readOnlyAccount) {
                    setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
                    return;
                  }

                  if (nextValue && !canEnableAutomation) {
                    setNotice(automationLockReason);
                    return;
                  }

                  setBusy('power');
                  await postJson('/api/system-power', { bridgeEnabled: nextValue });
                  await refresh();
                  setNotice(nextValue ? 'Sistema ligado.' : 'Sistema desligado.');
                  setBusy('');
                }}
              />
            </div>

            {readOnlyAccount ? (
              <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                Conta em teste: a automação fica somente para visualizacao até o administrador liberar.
              </p>
              ) : !canEnableAutomation ? (
                <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  O interruptor será liberado assim que Telegram, WhatsApp, origem e destino estiverem prontos.
                </p>
              ) : null}

            {isAdmin ? (
              <button
                type="button"
                disabled={readOnlyAccount || busy === 'reset-all'}
                onClick={async () => {
                  const confirmed = window.confirm(
                    'Isso vai limpar Telegram, WhatsApp, grupos selecionados e desligar a automação. Deseja continuar?'
                  );

                  if (!confirmed) {
                    return;
                  }

                  setBusy('reset-all');
                  await postJson('/api/connections/reset-all');
                  await refresh();
                  setNotice('conexões resetadas. Agora você pode configurar tudo de novo.');
                  setBusy('');
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-400/15 disabled:opacity-60"
              >
                <Power size={16} />
                Comecar do zero
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        <Metric
          icon={TrendingUp}
          label="Taxa de sucesso"
          value={successRate}
          detail={`${formatNumber(totalForwarded)} envio(s) monitorado(s) - percentual`}
        />
        <Metric
          icon={Clock3}
          label="Fila pendente"
          value={queuedCount}
          detail={queuedCount > 0 ? 'Mensagens aguardando processamento' : 'Fila operacional em dia'}
        />
        <Metric
          icon={Activity}
          label="Pendências Telegram"
          value={pendingTelegramCount}
          detail={pendingTelegramCount > 0 ? 'Mensagens aguardando encaminhamento' : 'Sem backlog no Telegram'}
        />
        <Metric
          icon={AlertCircle}
          label="Alertas ativos"
          value={criticalAlerts.length}
          detail={criticalAlerts.length > 0 ? 'Requer ação da Operação' : 'Sem alertas críticos no momento'}
        />
      </section>

      <section className="grid gap-3 xl:grid-cols-3 max-xl:grid-cols-1">
        <article className="rounded-xl border border-[var(--border)] bg-[var(--panel)]/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Comparativo rápido</p>
          <p className="mt-2 text-sm font-semibold">Qualidade de entrega</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Sucesso {successRate}% vs erros {errorRate}% com base no volume atual.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--panel)]/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Comparativo rápido</p>
          <p className="mt-2 text-sm font-semibold">Pressão de retries</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Falhas transientes representam {retriesShare}% do fluxo monitorado.
          </p>
        </article>
        <article className="rounded-xl border border-[var(--border)] bg-[var(--panel)]/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Comparativo rápido</p>
          <p className="mt-2 text-sm font-semibold">Score operacional</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Score atual {automationScore}/100 considerando erros e severidade.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Atenção agora</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Itens que podem bloquear entrega ou captura em tempo real.</p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy === 'overview-refresh'}
            onClick={async () => {
              setBusy('overview-refresh');
              try {
                await refresh();
                setNotice('Dashboard atualizada.');
              } finally {
                setBusy('');
              }
            }}
          >
            <RefreshCcw size={15} />
            Atualizar agora
          </button>
        </div>

        <div className="mt-3 grid gap-3">
          {criticalAlerts.length ? (
            criticalAlerts.slice(0, 4).map((alert) => (
              <article key={alert.id} className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                <div className="flex items-start justify-between gap-3 max-md:flex-col">
                  <div>
                    <p className="text-sm font-semibold text-amber-100">{alert.title}</p>
                    <p className="mt-1 text-xs leading-5 text-amber-100/90">{alert.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView(alert.goTo)}
                    className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-300/20"
                  >
                    {alert.cta}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-3 text-sm text-emerald-100">
              Operação estável: conexões, fluxo e destinos estão prontos.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr] max-xl:grid-cols-1">
        <PlanUsageCard
          title="Plano e limites"
          planLabel={state.planLimits?.label || humanize(state.auth.user?.plan || 'starter')}
          description="Acompanhe o que esta liberado no seu plano e quanto da estrutura atual já esta em uso."
          items={[
            {
              label: 'Destinos WhatsApp',
              used: whatsappDestinationsUsed,
              limit: state.planLimits?.whatsappDestinations || 0,
              detail: `${whatsappDestinationsUsed} grupo(s) selecionado(s) em Fluxos`
            },
            {
              label: 'Origens Telegram',
              used: hasOperationalTelegramSource(state) ? 1 : 0,
              limit: state.planLimits?.telegramSources || 0,
              detail: hasOperationalTelegramSource(state) ? 'Uma origem ativa no fluxo atual' : 'Nenhuma origem salva no momento'
            },
            {
              label: 'Automacoes de afiliados',
              used: state.affiliate?.automations?.length || 0,
              limit: state.planLimits?.affiliateAutomations || 0,
              detail:
                (state.affiliate?.automations?.length || 0) > 0
                  ? `${state.affiliate?.automations?.length || 0} regra(s) criada(s)`
                  : 'Nenhuma automação criada ainda'
            }
          ]}
          featureBadges={[
            { label: 'Amazon', enabled: Boolean(state.planLimits?.amazonAffiliate) },
            { label: 'Shopee', enabled: Boolean(state.planLimits?.shopeeAffiliate) },
            { label: 'Histórico', enabled: Boolean((state.planLimits?.historyDays || 0) > 1), value: `${state.planLimits?.historyDays || 0} dias` },
            { label: 'Mensagens/dia', enabled: true, value: formatNumber(state.planLimits?.dailyMessages || 0) }
          ]}
        />

        <section className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Metric icon={MessageSquare} label="Telegram" value={state.metrics.totalTelegramReceived || 0} detail={lastLabel(state.metrics.lastTelegramMessageAt)} />
          <Metric icon={Send} label="Encaminhadas" value={state.metrics.totalForwardedMessages || 0} detail={lastLabel(state.metrics.lastForwardedAt)} />
          <Metric icon={Users} label="Grupos" value={state.metrics.selectedGroupCount || 0} detail={groupProgressText} />
        </section>

        <section className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Metric
            icon={ShieldCheck}
            label="Duplicados evitados"
            value={deliveryStats.skippedDuplicates || 0}
            detail="Mensagens repetidas ignoradas automaticamente"
          />
          <Metric
            icon={Clock3}
            label="Falhas transientes"
            value={deliveryStats.transientFailures || 0}
            detail="Falhas recuperaveis durante os envios"
          />
          <Metric
            icon={AlertCircle}
            label="Falhas fatais"
            value={deliveryStats.fatalFailures || 0}
            detail="Erros definitivos que exigem Atenção operacional"
          />
        </section>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">saúde dos fluxos</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Visão rapida da Ponte e do Automatizador de Ofertas.</p>
            </div>
            <button
              type="button"
              onClick={() => setView('flows')}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-white/10"
            >
              Abrir Fluxos
            </button>
          </div>

          <div className="mt-3 grid gap-3">
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Ponte Telegram -&gt; WhatsApp</p>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    bridgeHealth.label === 'Ativo'
                      ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : bridgeHealth.label === 'Pausado'
                        ? 'border border-amber-400/20 bg-amber-400/10 text-amber-100'
                        : 'border border-red-400/20 bg-red-400/10 text-red-100'
                  )}
                >
                  {bridgeHealth.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">{bridgeHealth.reason || 'Fluxo pronto e em Operação.'}</p>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Automatizador de Ofertas</p>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    affiliateHealth.label === 'Ativo'
                      ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : affiliateHealth.label === 'Pausado'
                        ? 'border border-amber-400/20 bg-amber-400/10 text-amber-100'
                        : 'border border-red-400/20 bg-red-400/10 text-red-100'
                  )}
                >
                  {affiliateHealth.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">{affiliateHealth.reason || 'Fluxo pronto e em Operação.'}</p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Timeline operacional</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Últimos eventos com filtro rápido para investigação.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTimelineFilter('all')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', timelineFilter === 'all' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-[var(--muted)]')}>Todos</button>
              <button type="button" onClick={() => setTimelineFilter('errors')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', timelineFilter === 'errors' ? 'border-red-400/20 bg-red-400/10 text-red-100' : 'border-white/10 bg-white/5 text-[var(--muted)]')}>Erros</button>
              <button type="button" onClick={() => setTimelineFilter('delivery')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', timelineFilter === 'delivery' ? 'border-sky-400/20 bg-sky-400/10 text-sky-100' : 'border-white/10 bg-white/5 text-[var(--muted)]')}>Entrega</button>
              <button type="button" onClick={() => setTimelineFilter('auth')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', timelineFilter === 'auth' ? 'border-amber-400/20 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-[var(--muted)]')}>Autenticação</button>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {timelineEvents.length ? (
              timelineEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-white/10 bg-black/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      {event.level === 'error' ? (
                        <AlertCircle size={16} className="mt-0.5 text-red-300" />
                      ) : (
                        <CheckCircle2 size={16} className="mt-0.5 text-emerald-300" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{event.message}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{humanize(event.type || 'atividade')}</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-[11px] text-[var(--muted)]">{formatDate(event.at)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--muted)]">
                Nenhum evento encontrado para esse filtro.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-start justify-between gap-3 max-md:flex-col">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Drill-down de falhas</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Separação por tipo para acelerar correção operacional.</p>
          </div>
          <button
            type="button"
            onClick={() => setView('activity')}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-white/10"
          >
            Abrir Histórico completo
          </button>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <article className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-amber-100">Falhas transientes</p>
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100">
                {transientFailures}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-amber-100/90">
              Geralmente ligadas a instabilidade de sessão/rede. Recomendado: revisar conexões e repetir sincronização.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setView('connections')}
                className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-300/20"
              >
                Revisar conexões
              </button>
              <button
                type="button"
                onClick={() => setView('flows')}
                className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-300/20"
              >
                Validar fluxo
              </button>
            </div>
          </article>

          <article className="rounded-lg border border-red-400/20 bg-red-400/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-red-100">Falhas fatais</p>
              <span className="rounded-full border border-red-300/30 bg-red-300/10 px-2.5 py-1 text-xs font-semibold text-red-100">
                {fatalFailures}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-red-100/90">
              Erros que pedem ação imediata. Recomendado: checar Histórico detalhado e regras de envio/credenciais.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setView('activity')}
                className="rounded-md border border-red-300/30 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-50 hover:bg-red-300/20"
              >
                Investigar eventos
              </button>
              <button
                type="button"
                onClick={() => setView('groups')}
                className="rounded-md border border-red-300/30 bg-red-300/10 px-3 py-1.5 text-xs font-semibold text-red-50 hover:bg-red-300/20"
              >
                Revisar destinos
              </button>
            </div>
          </article>
        </div>
      </section>

      <section className="grid grid-cols-[1fr_360px] gap-5 max-xl:grid-cols-1">
        <OffersPanel state={state} compact refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
        <ConnectionSummary state={state} />
      </section>
    </div>
  );
}

function PlanUsagePanel({ state, setView }: { state: AppState; setView: (view: ViewKey) => void }) {
  const limits = state.planLimits;
  const currentPlan = String(state.auth.user?.plan || limits?.plan || 'starter').toLowerCase();
  const isAdmin = state.auth.user?.role === 'admin';
  const whatsappDestinationsUsed = state.config.selectedGroupIds?.length || 0;
  const activeAffiliateAutomations = (state.affiliate?.automations || []).filter((automation) => automation.isActive);
  const bridgeSourceUsed = normalizeRouteSourceId(state.config.telegramChannel) ? 1 : 0;
  const affiliateSourcesUsed = (state.affiliate?.automations || []).filter((automation) =>
    normalizeRouteSourceId(automation.telegramSourceGroupId)
  ).length;
  const telegramSourcesUsed = Math.min(
    bridgeSourceUsed + affiliateSourcesUsed,
    Math.max(1, limits?.telegramSources || 1)
  );
  const messageUsage = state.metrics.totalForwardedMessages || state.metrics.totalWhatsAppDeliveries || 0;
  const planTiers = [
    {
      key: 'starter',
      name: 'Starter',
      tone: 'border-white/10 bg-white/[0.03]',
      description: 'Para validar a ponte com poucos destinos.',
      highlights: ['1 origem Telegram', '3 destinos WhatsApp', '100 mensagens/dia', 'Sem afiliados']
    },
    {
      key: 'plus',
      name: 'Plus',
      tone: 'border-emerald-400/20 bg-emerald-400/[0.06]',
      description: 'Primeira camada comercial para Operação real.',
      highlights: ['1 origem Telegram', '10 destinos WhatsApp', 'Amazon afiliado', '500 mensagens/dia']
    },
    {
      key: 'pro',
      name: 'Pro',
      tone: 'border-cyan-400/20 bg-cyan-400/[0.06]',
      description: 'Para escalar ofertas com afiliados e Histórico.',
      highlights: ['3 origens Telegram', '30 destinos WhatsApp', 'Amazon + Shopee', '2.000 mensagens/dia']
    },
    {
      key: 'business',
      name: 'Business',
      tone: 'border-emerald-300/25 bg-[linear-gradient(135deg,rgba(37,211,102,0.08),rgba(34,158,217,0.08))]',
      description: 'Operação robusta com mais bases e volume.',
      highlights: ['10 origens Telegram', '100 destinos WhatsApp', '10 automacoes afiliadas', '10.000 mensagens/dia']
    }
  ];

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.11),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.1),transparent_28%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Plano e Uso</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                  <TrendingUp size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Limites claros para uma Operação sem surpresa</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                    Veja o plano atual, o consumo operacional e quais recursos já estão liberados para a sua conta.
                  </p>
                </div>
              </div>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              Plano {limits?.label || humanize(currentPlan)}
            </span>
          </div>
        </div>

        <div className="grid gap-5 p-6 max-sm:p-4">
          <PlanUsageCard
            title="Uso do plano atual"
            planLabel={limits?.label || humanize(currentPlan)}
            description="Estes numeros ajudam o cliente a entender o que já esta configurado e o que ainda cabe no plano."
            items={[
              {
                label: 'Destinos WhatsApp',
                used: whatsappDestinationsUsed,
                limit: limits?.whatsappDestinations || 0,
                detail: `${whatsappDestinationsUsed} destino(s) configurado(s) para receber mensagens.`
              },
              {
                label: 'Origens Telegram',
                used: telegramSourcesUsed,
                limit: limits?.telegramSources || 0,
                detail: `${telegramSourcesUsed} origem(ns) ativa(s) entre ponte e afiliados.`
              },
              {
                label: 'Automacoes afiliadas',
                used: state.affiliate?.automations?.length || 0,
                limit: limits?.affiliateAutomations || 0,
                detail: `${activeAffiliateAutomations.length} automação(oes) ativa(s) no momento.`
              },
              {
                label: 'Uso operacional',
                used: messageUsage,
                limit: limits?.dailyMessages || 0,
                detail: 'Contador operacional atual. A cota diaria real pode ser plugada em Supabase na proxima etapa.'
              }
            ]}
            featureBadges={[
              { label: 'Amazon afiliado', enabled: Boolean(limits?.amazonAffiliate) },
              { label: 'Shopee afiliado', enabled: Boolean(limits?.shopeeAffiliate) },
              { label: 'Histórico', enabled: Boolean((limits?.historyDays || 0) > 1), value: `${limits?.historyDays || 0} dias` },
              { label: 'Mensagens/dia', enabled: true, value: formatNumber(limits?.dailyMessages || 0) }
            ]}
          />

          <section className="grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-4 max-lg:flex-col">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Escada comercial</p>
                <h2 className="mt-1 text-xl font-semibold">Planos recomendados</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                  A ideia aqui e transformar limite em clareza: quando algo estiver bloqueado, o usuario entende qual upgrade libera.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView(isAdmin ? 'admin' : 'account')}
                className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
              >
                {isAdmin ? 'Gerenciar planos no Admin' : 'Ver minha conta'}
              </button>
            </div>

            <div className="grid gap-3 xl:grid-cols-4 md:grid-cols-2">
              {planTiers.map((tier) => (
                <article key={tier.key} className={cn('rounded-2xl border p-4', tier.tone)}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">{tier.name}</h3>
                    {currentPlan === tier.key ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                        Atual
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                        Upgrade
                      </span>
                    )}
                  </div>
                  <p className="mt-2 min-h-[44px] text-sm leading-5 text-[var(--muted)]">{tier.description}</p>
                  <div className="mt-4 grid gap-2">
                    {tier.highlights.map((highlight) => (
                      <div key={highlight} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <CheckCircle2 size={15} className="text-emerald-300" />
                        {highlight}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setView('flows')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Ajustar Fluxos</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Configure ponte simples ou automatizador de ofertas.</p>
            </button>
            <button
              type="button"
              onClick={() => setView('groups')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Revisar WhatsApp</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Veja destinos usados e grupos disponíveis.</p>
            </button>
            <button
              type="button"
              onClick={() => setView('affiliate')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Configurar Afiliados</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Ative Amazon, Shopee e regras de conversao.</p>
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}

function OffersPanel({
  state,
  compact = false,
  refresh,
  setNotice,
  setBusy,
  busy
}: {
  state: AppState;
  compact?: boolean;
  refresh?: () => Promise<void>;
  setNotice?: (message: string) => void;
  setBusy?: (value: string) => void;
  busy?: string;
}) {
  const offers = compact ? (state.offers || []).slice(0, 6) : state.offers || [];
  const readOnlyAccount = isReadOnlyAccount(state);
  const dashboardViewClearedAt = state.config.dashboardViewClearedAt || '';
  const canClearDashboard = Boolean(refresh && setNotice && setBusy);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Entregas</p>
          <h2 className="mt-1 text-xl font-semibold">Ofertas captadas</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Isso limpa apenas a visualizacao do painel. Suas cotas, metricas reais e Histórico tecnico continuam intactos.
          </p>
          {dashboardViewClearedAt ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">Ultima limpeza visual: {formatDate(dashboardViewClearedAt)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
            {formatNumber(state.offers?.length || 0)} recente(s)
          </span>
          {canClearDashboard ? (
            <button
              type="button"
              disabled={readOnlyAccount || busy === 'clear-dashboard'}
              onClick={async () => {
                if (readOnlyAccount) {
                  setNotice?.('Conta em teste: edições estão bloqueadas até liberação do administrador.');
                  return;
                }

                const confirmed = window.confirm(
                  'Isso vai limpar apenas a visualizacao de ofertas e atividade recente deste painel. Deseja continuar?'
                );

                if (!confirmed) {
                  return;
                }

                try {
                  setBusy?.('clear-dashboard');
                  await postJson('/api/dashboard/clear-view');
                  await refresh?.();
                  setNotice?.('Painel visual limpo com sucesso.');
                } catch (error) {
                  setNotice?.(error instanceof Error ? error.message : 'não foi possivel limpar o painel.');
                } finally {
                  setBusy?.('');
                }
              }}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:border-emerald-400/30 hover:text-white disabled:opacity-60"
            >
              <Trash2 size={14} />
              Limpar painel
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        {offers.length ? (
          offers.map((offer) => (
            <article key={offer.id} className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={offer.status} />
                    {offer.fromQueue ? (
                      <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                        Reprocessada
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6 text-[var(--foreground)]">{offer.preview}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-[var(--muted)]">
                  <p>{formatDate(offer.lastUpdatedAt || offer.at)}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{offer.sourceLabel}</span>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                  {offer.messageCount} mensagem(ns)
                </span>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                  {offer.groupCount} grupo(s)
                </span>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1">
                  {offer.deliveryCount} entrega(s)
                </span>
              </div>

              {offer.reason ? (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Motivo: <span className="text-[var(--foreground)]">{humanize(offer.reason)}</span>
                </p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-black/10 p-4 text-sm text-[var(--muted)]">
            Quando uma oferta entrar pelo Telegram, ela vai aparecer aqui com status, horario e alcance da entrega.
          </div>
        )}
      </div>
    </section>
  );
}

function FlowsPanel({
  state,
  setNotice,
  setBusy,
  busy,
  refresh,
  groupFilter,
  setGroupFilter,
  isAutomationEditing,
  setAutomationEditing
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
  groupFilter: string;
  setGroupFilter: (value: string) => void;
  isAutomationEditing: boolean;
  setAutomationEditing: (value: boolean) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const planLimits = state.planLimits;
  const activeAutomation = state.affiliate?.automations?.[0] || null;
  const configuredAffiliateAutomation =
    state.affiliate?.automations?.find((automation) => normalizeRouteSourceId(automation.telegramSourceGroupId)) ||
    activeAutomation;
  const savedAffiliateSource = configuredAffiliateAutomation?.telegramSourceGroupId || '';
  const savedTelegramFlow: 'bridge' | 'affiliate' = state.config.telegramChannel ? 'bridge' : savedAffiliateSource ? 'affiliate' : 'bridge';
  const hasSavedSource = Boolean(state.config.telegramChannel || savedAffiliateSource);
  const [telegramFlow, setTelegramFlow] = useState<'bridge' | 'affiliate'>(savedTelegramFlow);
  const [telegramChannel, setTelegramChannel] = useState(state.config.telegramChannel || '');
  const [affiliateTelegramChannel, setAffiliateTelegramChannel] = useState(savedAffiliateSource);
  const [affiliateTelegramForwardEnabled, setAffiliateTelegramForwardEnabled] = useState(
    Boolean(activeAutomation?.telegramForwardEnabled && activeAutomation?.telegramDestinationGroupId)
  );
  const [affiliateTelegramDestinationId, setAffiliateTelegramDestinationId] = useState(
    activeAutomation?.telegramDestinationGroupId || ''
  );
  const [flowFieldErrors, setFlowFieldErrors] = useState<FlowFieldErrors>({});
  const [reviewBeforeSave, setReviewBeforeSave] = useState(false);
  const flowFormRef = useRef<HTMLFormElement | null>(null);
  const selectedWhatsAppDestinations = state.groups
    .filter((group) => (state.config.selectedGroupIds || []).includes(group.id))
    .map((group) => ({ whatsappGroupId: group.id, whatsappGroupName: group.name }));
  const selectedWhatsAppDestinationCount = selectedWhatsAppDestinations.length;
  const selectedRouteSource = telegramFlow === 'bridge' ? telegramChannel : affiliateTelegramChannel;
  const telegramAdminDestinationChats = useMemo(
    () => (state.telegram.availableChats || []).filter((chat) => chat.role === 'admin'),
    [state.telegram.availableChats]
  );
  const hasTelegramSession = Boolean(state.config.hasTelegramSession || state.telegramStatus === 'listening');
  const canChooseTelegramSource = hasTelegramSession;
  const affiliateModuleAllowed = (planLimits?.affiliateAutomations ?? 0) > 0;
  const selectedBridgeName = getTelegramChatName(state, state.config.telegramChannel);
  const selectedAffiliateName = getTelegramChatName(state, savedAffiliateSource);
  const selectedAffiliateTelegramDestinationName = getTelegramChatName(
    state,
    activeAutomation?.telegramDestinationGroupId
  );
  const savedBridgeSourceId = normalizeRouteSourceId(state.config.telegramChannel);
  const savedAffiliateSourceId = normalizeRouteSourceId(savedAffiliateSource);
  const savedAffiliateForwardEnabled = Boolean(
    configuredAffiliateAutomation?.telegramForwardEnabled &&
      normalizeRouteSourceId(configuredAffiliateAutomation?.telegramDestinationGroupId)
  );
  const savedAffiliateForwardDestinationId = normalizeRouteSourceId(
    configuredAffiliateAutomation?.telegramDestinationGroupId
  );
  const nextRouteSourceId = normalizeRouteSourceId(selectedRouteSource);
  const pendingFlowChanges: string[] = [];

  if (telegramFlow !== savedTelegramFlow) {
    pendingFlowChanges.push(
      `Modo: ${savedTelegramFlow === 'bridge' ? 'Ponte Telegram -> WhatsApp' : 'Automatizador de Ofertas'} -> ${telegramFlow === 'bridge' ? 'Ponte Telegram -> WhatsApp' : 'Automatizador de Ofertas'}`
    );
  }

  if (telegramFlow === 'bridge') {
    if (nextRouteSourceId !== savedBridgeSourceId) {
      pendingFlowChanges.push(
        `Origem da ponte: ${getTelegramChatName(state, savedBridgeSourceId)} -> ${getTelegramChatName(state, nextRouteSourceId)}`
      );
    }
  } else {
    if (nextRouteSourceId !== savedAffiliateSourceId) {
      pendingFlowChanges.push(
        `Origem das ofertas: ${getTelegramChatName(state, savedAffiliateSourceId)} -> ${getTelegramChatName(state, nextRouteSourceId)}`
      );
    }

    const nextForwardDestinationId = affiliateTelegramForwardEnabled
      ? normalizeRouteSourceId(affiliateTelegramDestinationId)
      : '';
    if (affiliateTelegramForwardEnabled !== savedAffiliateForwardEnabled || nextForwardDestinationId !== savedAffiliateForwardDestinationId) {
      pendingFlowChanges.push(
        `Encaminhar para Telegram: ${savedAffiliateForwardEnabled ? getTelegramChatName(state, savedAffiliateForwardDestinationId) : 'não'} -> ${affiliateTelegramForwardEnabled && nextForwardDestinationId ? getTelegramChatName(state, nextForwardDestinationId) : 'não'}`
      );
    }
  }
  const hasPendingFlowChanges = pendingFlowChanges.length > 0;
  const flowChecklist = [
    { label: 'Telegram conectado', done: hasTelegramSession, ready: Boolean(state.config.telegramApiId) },
    { label: 'Destinos WhatsApp prontos', done: selectedWhatsAppDestinationCount > 0, ready: state.groups.length > 0 },
    { label: 'Fluxo escolhido', done: hasSavedSource, ready: canChooseTelegramSource && selectedWhatsAppDestinationCount > 0 }
  ];
  const flowChecklistComplete = flowChecklist.every((step) => step.done);
  const bridgeFlowStatus = getFlowHealthStatus({
    selected: telegramFlow === 'bridge',
    saved: Boolean(state.config.telegramChannel),
    hasTelegramSession,
    sourceId: telegramChannel || state.config.telegramChannel
  });
  const affiliateFlowStatus = getFlowHealthStatus({
    selected: telegramFlow === 'affiliate',
    saved: Boolean(savedAffiliateSource),
    hasTelegramSession,
    sourceId: affiliateTelegramChannel || savedAffiliateSource,
    requiresPlan: affiliateModuleAllowed,
    hasDestinations: selectedWhatsAppDestinationCount > 0
  });

  useEffect(() => {
    if (!hasSavedSource && !readOnlyAccount) {
      setAutomationEditing(true);
    }
  }, [hasSavedSource, readOnlyAccount, setAutomationEditing]);

  const shouldShowFlowReview = reviewBeforeSave && isAutomationEditing && hasPendingFlowChanges;

  async function saveFlow() {
    const nextFieldErrors: FlowFieldErrors = {};

    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }

    if (!hasTelegramSession) {
      nextFieldErrors.telegram = 'Conclua o login do Telegram antes de configurar um fluxo.';
    }

    if (!selectedWhatsAppDestinationCount) {
      nextFieldErrors.destinations = 'Escolha ao menos um destino WhatsApp nesta tela antes de salvar o fluxo.';
    }

    if (!selectedRouteSource.trim()) {
      nextFieldErrors.telegramSourceGroupId = 'Escolha uma origem do Telegram antes de salvar o fluxo.';
    }

    if (telegramFlow === 'affiliate' && !affiliateModuleAllowed) {
      nextFieldErrors.flow = `O plano ${planLimits?.label || 'atual'} ainda não inclui Automatizador de Ofertas.`;
    }

    if (telegramFlow === 'affiliate' && !state.affiliate?.termsAccepted) {
      nextFieldErrors.flow = 'Aceite os termos na aba Afiliados antes de ativar o Automatizador de Ofertas.';
    }

    if (Object.keys(nextFieldErrors).length) {
      setFlowFieldErrors(nextFieldErrors);
      setReviewBeforeSave(false);
      setNotice('Revise os campos destacados antes de salvar o fluxo.');
      return;
    }

    setFlowFieldErrors({});

    if (!hasPendingFlowChanges) {
      setReviewBeforeSave(false);
      setNotice('Nenhuma alteracao detectada no fluxo.');
      return;
    }

    if (!shouldShowFlowReview) {
      setReviewBeforeSave(true);
      setNotice('Revise o resumo e confirme para salvar o fluxo.');
      return;
    }

    setBusy('save-source');

    try {
      if (telegramFlow === 'bridge') {
        if (configuredAffiliateAutomation?.id && configuredAffiliateAutomation.isActive) {
          await postJson(`/api/affiliate/automations/${configuredAffiliateAutomation.id}/toggle`, { isActive: false });
        }

        await postJson('/api/settings', {
          telegramMode: 'user',
          telegramChannel,
          telegramApiId: state.config.telegramApiId,
          telegramApiHash: state.config.telegramApiHash,
          telegramPhone: state.config.telegramPhone,
          telegramBotToken: ''
        });
        setNotice('Fluxo Ponte Telegram -> WhatsApp salvo com sucesso.');
      } else {
        await postJson('/api/affiliate/automations', {
          id: configuredAffiliateAutomation?.id || undefined,
          name: configuredAffiliateAutomation?.name || 'Automatizador de Ofertas',
          telegramSourceGroupId: affiliateTelegramChannel,
          telegramSourceGroupName: getTelegramChatName(state, affiliateTelegramChannel),
          destinations: selectedWhatsAppDestinations,
          unknownLinkBehavior: configuredAffiliateAutomation?.unknownLinkBehavior || 'keep',
          customFooter: configuredAffiliateAutomation?.customFooter || '',
          removeOriginalFooter: Boolean(configuredAffiliateAutomation?.removeOriginalFooter),
          mediaSourceMode: configuredAffiliateAutomation?.mediaSourceMode || 'telegram_media',
          telegramForwardEnabled: affiliateTelegramForwardEnabled,
          telegramDestinationGroupId: affiliateTelegramForwardEnabled ? affiliateTelegramDestinationId : '',
          telegramDestinationGroupName:
            affiliateTelegramForwardEnabled && affiliateTelegramDestinationId
              ? getTelegramChatName(state, affiliateTelegramDestinationId)
              : '',
          replaceTelegramBridgeSource: true,
          isActive: true
        });
        setNotice('Fluxo Automatizador de Ofertas salvo com sucesso.');
      }

      await refresh();
      setReviewBeforeSave(false);
      setAutomationEditing(false);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const apiFieldErrors = (error.fieldErrors || {}) as FlowFieldErrors;
        if (Object.keys(apiFieldErrors).length) {
          setFlowFieldErrors(apiFieldErrors);
          setReviewBeforeSave(false);
        }
      }
      setNotice(error instanceof Error ? error.message : 'não foi possivel salvar o fluxo.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.08),transparent_26%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Fluxos</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                  <ArrowRight size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Fluxos da Operação</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    Escolha como a conta vai trabalhar: ponte simples para republicar exatamente o que chega do Telegram ou automatizador de ofertas para tratar links de afiliado antes do envio.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                {selectedWhatsAppDestinationCount} destino(s) ativo(s)
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {hasSavedSource ? 'Fluxo salvo' : 'Aguardando configuração'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-6 max-sm:px-4">
          <InternalSetupChecklist
            title="Checklist dos Fluxos"
            steps={flowChecklist}
            complete={flowChecklistComplete}
            completeLabel="Fluxo operacional pronto para rodar"
          />

          <form ref={flowFormRef} onSubmit={(event) => { event.preventDefault(); void saveFlow(); }} className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            {flowFieldErrors.flow || flowFieldErrors.telegram || flowFieldErrors.destinations ? (
              <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100">
                {flowFieldErrors.flow || flowFieldErrors.telegram || flowFieldErrors.destinations}
              </div>
            ) : null}
            <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Escolha de Operação</p>
                <h3 className="mt-1 text-lg font-semibold">Um fluxo ativo por vez</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  A mesma conta pode usar a ponte simples ou o automatizador de ofertas, mas apenas um deles fica ativo por vez para evitar envio duplicado.
                </p>
              </div>
              <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                {hasTelegramSession ? 'Telegram pronto' : 'Conecte o Telegram primeiro'}
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className={cn('rounded-2xl border p-4 transition', telegramFlow === 'bridge' ? 'border-emerald-400/50 bg-emerald-400/10 shadow-[0_18px_45px_rgba(16,185,129,0.08)]' : 'border-[var(--border)] bg-black/10', !isAutomationEditing && 'opacity-90')}>
                <button
                  type="button"
                  disabled={readOnlyAccount || !isAutomationEditing}
                  onClick={() => setTelegramFlow('bridge')}
                  className="w-full text-left disabled:cursor-not-allowed"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">Fluxo 1</p>
                      <h4 className="mt-1 text-base font-semibold">Ponte Telegram -&gt; WhatsApp</h4>
                    </div>
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', telegramFlow === 'bridge' ? 'bg-emerald-400/15 text-emerald-100' : 'bg-white/5 text-[var(--muted)]')}>
                      {telegramFlow === 'bridge' ? 'Selecionado' : 'Escolher'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-emerald-100">
                    Status: {bridgeFlowStatus.label}
                    {bridgeFlowStatus.reason ? ` - ${bridgeFlowStatus.reason}` : ''}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    Ideal para quem quer apenas encaminhar a mensagem do Telegram exatamente como ela chegou para os grupos já salvos no WhatsApp.
                  </p>
                </button>

                <div className="mt-4 grid gap-3">
                  <label className="grid gap-2 text-sm font-semibold">
                    Origem da ponte
                    <select
                      value={telegramChannel}
                      onChange={(event) => {
                        setTelegramChannel(event.target.value);
                        setFlowFieldErrors((current) => ({ ...current, telegramSourceGroupId: '' }));
                      }}
                      className={inputClass}
                      disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'bridge'}
                    >
                      <option value="">Selecione uma origem</option>
                      {(state.telegram.availableChats || []).map((chat) => (
                        <option key={chat.id} value={chat.id}>
                          {chat.name} ({chat.type === 'channel' ? 'canal' : 'grupo'})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="ID manual da origem"
                    value={telegramChannel}
                    onChange={(value) => {
                      setTelegramChannel(value);
                      setFlowFieldErrors((current) => ({ ...current, telegramSourceGroupId: '' }));
                    }}
                    placeholder="-100..."
                    disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'bridge'}
                  />
                  {telegramFlow === 'bridge' && flowFieldErrors.telegramSourceGroupId ? (
                    <p className="text-xs font-semibold text-amber-100">{flowFieldErrors.telegramSourceGroupId}</p>
                  ) : null}
                </div>
              </div>

              <div className={cn('rounded-2xl border p-4 transition', telegramFlow === 'affiliate' ? 'border-cyan-300/50 bg-cyan-400/10 shadow-[0_18px_45px_rgba(34,158,217,0.08)]' : 'border-[var(--border)] bg-black/10', !isAutomationEditing && 'opacity-90')}>
                <button
                  type="button"
                  disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                  onClick={() => setTelegramFlow('affiliate')}
                  className="w-full text-left disabled:cursor-not-allowed"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Fluxo 2</p>
                      <h4 className="mt-1 text-base font-semibold">Automatizador de Ofertas</h4>
                    </div>
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', telegramFlow === 'affiliate' ? 'bg-cyan-400/15 text-cyan-100' : 'bg-white/5 text-[var(--muted)]')}>
                      {telegramFlow === 'affiliate' ? 'Selecionado' : 'Escolher'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-cyan-100">
                    Status: {affiliateFlowStatus.label}
                    {affiliateFlowStatus.reason ? ` - ${affiliateFlowStatus.reason}` : ''}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    Ideal para ler a oferta, converter links Amazon ou Shopee com suas configuracoes de afiliado e so depois enviar a mensagem final.
                  </p>
                </button>

                <div className="mt-4 grid gap-3">
                  <label className="grid gap-2 text-sm font-semibold">
                    Origem das ofertas
                    <select
                      value={affiliateTelegramChannel}
                      onChange={(event) => {
                        setAffiliateTelegramChannel(event.target.value);
                        setFlowFieldErrors((current) => ({ ...current, telegramSourceGroupId: '' }));
                      }}
                      className={inputClass}
                      disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                    >
                      <option value="">Selecione uma origem</option>
                      {(state.telegram.availableChats || []).map((chat) => (
                        <option key={chat.id} value={chat.id}>
                          {chat.name} ({chat.type === 'channel' ? 'canal' : 'grupo'})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="ID manual da origem"
                    value={affiliateTelegramChannel}
                    onChange={(value) => {
                      setAffiliateTelegramChannel(value);
                      setFlowFieldErrors((current) => ({ ...current, telegramSourceGroupId: '' }));
                    }}
                    placeholder="-100..."
                    disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                  />
                  {telegramFlow === 'affiliate' && flowFieldErrors.telegramSourceGroupId ? (
                    <p className="text-xs font-semibold text-amber-100">{flowFieldErrors.telegramSourceGroupId}</p>
                  ) : null}
                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm leading-6 text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={affiliateTelegramForwardEnabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setAffiliateTelegramForwardEnabled(enabled);
                        if (!enabled) {
                          setAffiliateTelegramDestinationId('');
                        }
                      }}
                      disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                      className="mt-1 h-4 w-4 rounded border-white/15 bg-transparent accent-emerald-400"
                    />
                    <span>
                      <span className="block font-semibold text-white">Encaminhar tambem para Telegram</span>
                      <span className="mt-1 block text-xs leading-5">
                        Opcional. Depois de tratar a oferta com seu link de afiliado, a SaaS tambem pode publicar a mensagem final em um grupo ou canal do Telegram onde sua conta tenha permissao.
                      </span>
                    </span>
                  </label>
                  <label className="grid gap-2 text-sm font-semibold">
                    Destino opcional no Telegram
                    <select
                      value={affiliateTelegramDestinationId}
                      onChange={(event) => setAffiliateTelegramDestinationId(event.target.value)}
                      className={inputClass}
                      disabled={
                        readOnlyAccount ||
                        !isAutomationEditing ||
                        telegramFlow !== 'affiliate' ||
                        !affiliateModuleAllowed ||
                        !affiliateTelegramForwardEnabled
                      }
                    >
                      <option value="">não encaminhar para Telegram</option>
                      {telegramAdminDestinationChats.map((chat) => (
                        <option key={`forward-${chat.id}`} value={chat.id}>
                          {chat.name} ({chat.type === 'channel' ? 'canal' : 'grupo'})
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-normal text-[var(--muted)]">
                      Lista restrita a grupos/canais em que sua conta e admin.
                    </span>
                  </label>
                  <Field
                    label="ID manual do destino opcional"
                    value={affiliateTelegramDestinationId}
                    onChange={setAffiliateTelegramDestinationId}
                    placeholder="-100..."
                    disabled={
                      readOnlyAccount ||
                      !isAutomationEditing ||
                      telegramFlow !== 'affiliate' ||
                      !affiliateModuleAllowed ||
                      !affiliateTelegramForwardEnabled
                    }
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 px-4 py-4">
                <p className="text-sm font-semibold">
                  Fluxo atual: {telegramFlow === 'bridge' ? 'Ponte Telegram -> WhatsApp' : 'Automatizador de Ofertas'}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Os dois fluxos usam os destinos escolhidos aqui em Fluxos. Hoje sua conta esta com {selectedWhatsAppDestinationCount} grupo(s) pronto(s) para receber mensagens.
                </p>
                {flowFieldErrors.destinations ? (
                  <p className="mt-2 text-xs font-semibold text-amber-100">{flowFieldErrors.destinations}</p>
                ) : null}
                {telegramFlow === 'affiliate' ? (
                  <p className="mt-2 text-xs font-semibold text-cyan-100">
                    Modo de imagem: {formatMediaSourceMode(activeAutomation?.mediaSourceMode)}
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs">
                    <p className="font-semibold text-emerald-100">Ponte simples salva</p>
                    <p className="mt-1 leading-5 text-[var(--muted)]">{selectedBridgeName}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs">
                    <p className="font-semibold text-cyan-100">Automatizador salvo</p>
                    <p className="mt-1 leading-5 text-[var(--muted)]">{selectedAffiliateName}</p>
                    <p className="mt-2 leading-5 text-[var(--muted)]">
                      Telegram opcional:{' '}
                      {activeAutomation?.telegramForwardEnabled && activeAutomation?.telegramDestinationGroupId
                        ? selectedAffiliateTelegramDestinationName
                        : 'desligado'}
                    </p>
                  </div>
                </div>
              </div>

              <FlowSaveActionsCard
                readOnlyAccount={readOnlyAccount}
                busy={busy}
                isAutomationEditing={isAutomationEditing || !hasSavedSource}
                selectedRouteSource={selectedRouteSource}
                hasPendingFlowChanges={hasPendingFlowChanges}
                shouldShowFlowReview={shouldShowFlowReview}
                telegramFlow={telegramFlow}
                selectedSourceName={getTelegramChatName(state, selectedRouteSource)}
                selectedWhatsAppDestinationCount={selectedWhatsAppDestinationCount}
                telegramForwardLabel={
                  telegramFlow === 'affiliate' && affiliateTelegramForwardEnabled && affiliateTelegramDestinationId
                    ? getTelegramChatName(state, affiliateTelegramDestinationId)
                    : 'não'
                }
                pendingFlowChanges={pendingFlowChanges}
                onEditOrSubmit={() => {
                  if (!isAutomationEditing && hasSavedSource) {
                    setAutomationEditing(true);
                    return;
                  }
                  flowFormRef.current?.requestSubmit();
                }}
                onCancelReview={() => setReviewBeforeSave(false)}
                onRefreshOrigins={async () => {
                  setBusy('telegram-chats');
                  await postJson('/api/telegram/refresh-chats');
                  await refresh();
                  setNotice('Lista de grupos e canais do Telegram atualizada.');
                  setBusy('');
                }}
                primaryButtonClassName={primaryButton}
                secondaryButtonClassName={secondaryButton}
              />
            </div>
          </form>

          <WhatsAppDestinationSelector
            state={state}
            filter={groupFilter}
            setFilter={setGroupFilter}
            setNotice={setNotice}
            setBusy={setBusy}
            busy={busy}
            refresh={refresh}
          />
        </div>
      </section>
    </div>
  );
}

function WhatsAppDestinationSelector({
  state,
  filter,
  setFilter,
  setNotice,
  setBusy,
  busy,
  refresh
}: {
  state: AppState;
  filter: string;
  setFilter: (value: string) => void;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const planLimits = state.planLimits;
  const whatsappDestinationLimit = planLimits?.whatsappDestinations ?? Number.POSITIVE_INFINITY;
  const hasWhatsAppDestinationLimit = Number.isFinite(whatsappDestinationLimit);
  const [selected, setSelected] = useState(new Set(state.config.selectedGroupIds));
  const [hasPendingSelectionChanges, setHasPendingSelectionChanges] = useState(false);
  const [quickFilter, setQuickFilter] = useState<'all' | 'selected' | 'community' | 'announcement'>('all');
  const groupsProgress = state.metrics.groupRefreshProgress;
  const groupsPhase = groupsProgress?.phase || 'idle';
  const groupsPercent = Math.max(0, Math.min(100, groupsProgress?.percent || 0));
  const groupsProcessed = groupsProgress?.processed || 0;
  const groupsTotal = groupsProgress?.total || 0;
  const groupsFoundAdmins = groupsProgress?.foundAdmins ?? state.metrics.availableAdminGroupCount ?? 0;
  const groupsPhaseLabel =
    groupsPhase === 'loading_groups'
      ? 'Carregando lista de conversas'
      : groupsPhase === 'checking_admins'
        ? 'Verificando permissao de envio'
        : groupsPhase === 'done'
          ? 'Lista atualizada'
          : groupsPhase === 'error'
            ? 'Falha ao atualizar'
            : 'Preparando leitura';
  const groupsProgressLabel = groupsTotal
    ? `${groupsProcessed}/${groupsTotal} verificados`
    : groupsPhase === 'loading_groups'
      ? 'Buscando grupos no WhatsApp'
      : 'Aguardando total';
  const cachedAtLabel = state.metrics.groupCacheRefreshedAt
    ? formatDate(state.metrics.groupCacheRefreshedAt)
    : '';
  const selectedGroups = useMemo(
    () => state.groups.filter((group) => selected.has(group.id)),
    [selected, state.groups]
  );
  const savedSelectedSet = useMemo(
    () => new Set(state.config.selectedGroupIds || []),
    [state.config.selectedGroupIds]
  );
  const selectedCount = selected.size;
  const savedCount = savedSelectedSet.size;
  const selectionDelta = selectedCount - savedCount;
  const overPlanLimit = selectedCount > whatsappDestinationLimit;
  const staleSelectedIds = useMemo(
    () =>
      [...selected].filter((groupId) => !state.groups.some((group) => group.id === groupId)),
    [selected, state.groups]
  );
  const hasStaleSelections = staleSelectedIds.length > 0;
  const filteredGroups = useMemo(() => {
    const normalized = normalizeText(filter);
    return state.groups
      .filter((group) => {
        if (quickFilter === 'selected') {
          return selected.has(group.id);
        }
        if (quickFilter === 'community') {
          return Boolean(group.isCommunityLinked) && !Boolean(group.isAnnouncement);
        }
        if (quickFilter === 'announcement') {
          return Boolean(group.isAnnouncement);
        }
        return true;
      })
      .filter((group) => normalizeText(group.name).includes(normalized))
      .sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
  }, [filter, quickFilter, selected, state.groups]);

  const visibleSelectableGroupIds = useMemo(
    () => filteredGroups.map((group) => group.id),
    [filteredGroups]
  );

  useEffect(() => {
    if (!state.metrics.groupsRefreshing) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [refresh, state.metrics.groupsRefreshing]);

  return (
    <section className="rounded-[24px] border border-[var(--border)] bg-black/10 p-5">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos WhatsApp</p>
          <h2 className="mt-1 text-xl font-semibold">Grupos que recebem os fluxos</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            Esta selecao vale para a ponte comum e para o Automatizador de Ofertas. A Autenticação do WhatsApp continua em Config. WhatsApp.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnlyAccount || busy === 'groups' || state.metrics.groupsRefreshing}
          onClick={async () => {
            setBusy('groups');
            setNotice('sincronização dos grupos iniciada. Pode levar alguns minutos na primeira leitura.');
            void postJson('/api/refresh-groups')
              .then(async () => {
                await refresh();
                setNotice('Lista de grupos do WhatsApp atualizada.');
              })
              .catch(() => {
                setNotice('não foi possivel atualizar os grupos agora. Tente reconectar o WhatsApp e repetir.');
              })
              .finally(() => setBusy(''));
            window.setTimeout(() => {
              void refresh().catch(() => undefined);
            }, 600);
          }}
          className={cn(secondaryButton, state.metrics.groupsRefreshing && 'animate-pulse')}
        >
          <RefreshCcw size={16} className={state.metrics.groupsRefreshing ? 'animate-spin' : ''} />
          {state.metrics.groupsRefreshing
            ? `Sincronizando ${groupsPercent}%`
            : 'Atualizar grupos'}
        </button>
      </div>

      {state.metrics.groupsRefreshing ? (
        <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-400/20 bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.14),transparent_34%),rgba(16,185,129,0.08)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          <div className="flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
                <p className="text-sm font-semibold text-emerald-100">Sincronizando grupos do WhatsApp</p>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                  {groupsPhaseLabel}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {groupsTotal
                  ? 'Estamos analisando seus grupos e separando apenas os destinos validos para envio.'
                  : 'O WhatsApp ainda esta devolvendo a lista inicial. Na primeira sincronização isso pode levar alguns minutos.'}
              </p>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-100">
              {groupsTotal ? `${groupsPercent}%` : 'Preparando'}
            </span>
          </div>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-lime-300 transition-[width] duration-700 ease-out"
              style={{ width: `${groupsTotal ? Math.max(8, groupsPercent) : 14}%` }}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Progresso real</p>
              <p className="mt-1 text-sm font-semibold">{groupsProgressLabel}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos validos</p>
              <p className="mt-1 text-sm font-semibold">{groupsFoundAdmins} encontrado(s)</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Lista anterior</p>
              <p className="mt-1 text-sm font-semibold">{cachedAtLabel || 'Ainda sem cache'}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)] max-sm:flex-col max-sm:items-start">
            <span>você pode continuar no painel enquanto a sincronização roda em segundo plano.</span>
            <span>{groupsTotal ? `${groupsProcessed} de ${groupsTotal} conversas analisadas` : 'Aguardando o WhatsApp informar o total'}</span>
          </div>

          <div className="hidden">
            <span>
              {groupsTotal ? 'Leitura em andamento' : 'Iniciando sincronização'}
              {state.metrics.hasCachedGroups && cachedAtLabel ? ` Â· exibindo lista salva de ${cachedAtLabel}` : ''}
            </span>
            <span>{groupsTotal ? `${groupsProcessed} de ${groupsTotal} grupos verificados` : 'Aguardando contagem total'}</span>
          </div>
        </div>
      ) : null}

      {!state.metrics.groupsRefreshing && state.metrics.hasCachedGroups && cachedAtLabel ? (
        <div className="mb-4 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-[var(--muted)]">
          Ultima lista salva: <span className="font-semibold text-[var(--foreground)]">{cachedAtLabel}</span>. você pode usar essa lista imediatamente enquanto uma nova sincronização não for necessaria.
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
        <Search size={17} className="text-[var(--muted)]" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar grupo pelo nome"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-black/10 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickFilter('all')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              quickFilter === 'all'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06]'
            )}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter('selected')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              quickFilter === 'selected'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06]'
            )}
          >
            Selecionados
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter('community')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              quickFilter === 'community'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06]'
            )}
          >
            Comunidades
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter('announcement')}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              quickFilter === 'announcement'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.03] text-[var(--muted)] hover:bg-white/[0.06]'
            )}
          >
            AnÃºncios
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={readOnlyAccount || busy === 'save-groups' || visibleSelectableGroupIds.length === 0}
            onClick={() => {
              const next = new Set(selected);

              for (const groupId of visibleSelectableGroupIds) {
                if (next.has(groupId)) {
                  continue;
                }

                if (next.size >= whatsappDestinationLimit) {
                  setNotice(`Seu plano permite até ${whatsappDestinationLimit} destino(s) WhatsApp.`);
                  break;
                }

                next.add(groupId);
              }

              setSelected(next);
              setHasPendingSelectionChanges(true);
            }}
            className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15 disabled:opacity-60"
          >
            Selecionar visÃ­veis
          </button>
          <button
            type="button"
            disabled={readOnlyAccount || busy === 'save-groups' || visibleSelectableGroupIds.length === 0}
            onClick={() => {
              const next = new Set(selected);
              for (const groupId of visibleSelectableGroupIds) {
                next.delete(groupId);
              }
              setSelected(next);
              setHasPendingSelectionChanges(true);
            }}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-[var(--muted)] transition hover:bg-white/[0.06] disabled:opacity-60"
          >
            Limpar visÃ­veis
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-[var(--border)] bg-black/10 p-3">
        <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start">
          <div>
            <p className="text-sm font-semibold">Grupos selecionados</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {selectedGroups.length
                ? `${selectedGroups.length} destino(s) pronto(s) para receber mensagens.`
                : 'Nenhum destino selecionado ainda.'}
              {hasWhatsAppDestinationLimit ? ` Limite do plano ${planLimits?.label}: ${whatsappDestinationLimit}.` : ''}
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {hasWhatsAppDestinationLimit ? `${selectedGroups.length}/${whatsappDestinationLimit}` : selectedGroups.length}
          </span>
        </div>

        {selectedGroups.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  if (readOnlyAccount) {
                    setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
                    return;
                  }
                  const next = new Set(selected);
                  next.delete(group.id);
                  setSelected(next);
                  setHasPendingSelectionChanges(true);
                }}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-left text-xs font-semibold text-emerald-50 transition hover:bg-emerald-400/15"
                title="Remover dos selecionados"
              >
                <span className="truncate">{group.name}</span>
                <GroupKindBadge group={group} />
                <X size={13} className="text-emerald-100/70" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="max-h-[560px] overflow-auto rounded-md border border-[var(--border)]">
        {filteredGroups.length ? (
          filteredGroups.map((group) => {
            const checked = selected.has(group.id);
            const disabledByLimit = !checked && selected.size >= whatsappDestinationLimit;

            return (
              <label key={group.id} className={cn('flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-white/5', disabledByLimit && 'opacity-55')}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={readOnlyAccount || disabledByLimit}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) {
                      if (next.size >= whatsappDestinationLimit) {
                        setNotice(`Seu plano permite até ${whatsappDestinationLimit} destino(s) WhatsApp.`);
                        return;
                      }
                      next.add(group.id);
                    } else {
                      next.delete(group.id);
                    }
                    setSelected(next);
                    setHasPendingSelectionChanges(true);
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
                <GroupKindBadge group={group} />
              </label>
            );
          })
        ) : (
          <p className="p-4 text-sm text-[var(--muted)]">Nenhum grupo encontrado.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <div className="flex-1 rounded-md border border-[var(--border)] bg-black/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Preview antes de salvar</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              Selecionados: <span className="font-semibold text-[var(--foreground)]">{selectedCount}</span>
            </span>
            {hasWhatsAppDestinationLimit ? (
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                Limite plano {planLimits?.label}: <span className="font-semibold text-[var(--foreground)]">{whatsappDestinationLimit}</span>
              </span>
            ) : null}
            <span
              className={cn(
                'rounded-full border px-2.5 py-1',
                selectionDelta === 0
                  ? 'border-white/10 bg-white/[0.03] text-[var(--muted)]'
                  : selectionDelta > 0
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                    : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
              )}
            >
              Delta vs salvo: {selectionDelta > 0 ? `+${selectionDelta}` : selectionDelta}
            </span>
          </div>
          {overPlanLimit ? (
            <p className="mt-2 text-xs text-red-100">
              A seleÃ§Ã£o atual ultrapassa o limite do plano. Ajuste antes de salvar.
            </p>
          ) : null}
          {hasStaleSelections ? (
            <p className="mt-2 text-xs text-amber-100">
              {staleSelectedIds.length} destino(s) selecionado(s) não aparece(m) na lista atual e pode(m) ser removido(s) ao salvar.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          {hasPendingSelectionChanges ? (
            <span className="text-xs font-semibold text-amber-200">Selecao alterada. Clique em salvar para manter esses destinos.</span>
          ) : null}
          <button
            type="button"
            disabled={readOnlyAccount || busy === 'save-groups' || overPlanLimit}
            className={primaryButton}
            onClick={async () => {
              setBusy('save-groups');
              await postJson('/api/groups', { selectedGroupIds: [...selected] });
              await refresh();
              setHasPendingSelectionChanges(false);
              setNotice('Grupos de destino salvos no fluxo.');
              setBusy('');
            }}
          >
            Salvar destinos
          </button>
        </div>
      </div>
    </section>
  );
}

function Groups({
  state,
  setNotice,
  setBusy,
  busy,
  refresh
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const isAdmin = state.auth.user?.role === 'admin';
  const filter = '';
  const setFilter = (_value: string) => undefined;
  const planLimits = state.planLimits;
  const whatsappDestinationLimit = planLimits?.whatsappDestinations ?? Number.POSITIVE_INFINITY;
  const hasWhatsAppDestinationLimit = Number.isFinite(whatsappDestinationLimit);
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  const [destructiveConfirmStep, setDestructiveConfirmStep] = useState<'wa-reset' | 'reset-all' | null>(null);
  const [disconnectOnLogout, setDisconnectOnLogout] = useState(Boolean(state.config.disconnectWhatsAppOnLogout));
  const [selected, setSelected] = useState(new Set(state.config.selectedGroupIds));
  const [hasPendingSelectionChanges, setHasPendingSelectionChanges] = useState(false);
  const groupsProgress = state.metrics.groupRefreshProgress;
  const groupsPercent = Math.max(0, Math.min(100, groupsProgress?.percent || 0));
  const groupsProcessed = groupsProgress?.processed || 0;
  const groupsTotal = groupsProgress?.total || 0;
  const cachedAtLabel = state.metrics.groupCacheRefreshedAt
    ? formatDate(state.metrics.groupCacheRefreshedAt)
    : '';
  const whatsAppConnected = isWhatsAppConnectedStatus(state.whatsAppStatus);
  const hasQrCode = Boolean(state.qrDataUrl);
  const whatsAppReconnecting = ['connecting', 'authenticated', 'reconnecting'].includes(String(state.whatsAppStatus || '').toLowerCase());
  const whatsAppStatusLabel = whatsAppConnected ? 'Conectado' : hasQrCode ? 'QR pronto' : whatsAppReconnecting ? 'Reconectando' : 'Sem sessão';
  const selectedGroups = useMemo(
    () => state.groups.filter((group) => (state.config.selectedGroupIds || []).includes(group.id)),
    [state.config.selectedGroupIds, state.groups]
  );
  const hasSavedDestinations = selectedGroups.length > 0;
  const whatsappInternalChecklist = [
    { label: 'Iniciar sessão', done: hasQrCode || whatsAppConnected, ready: whatsAppReconnecting || !whatsAppConnected },
    { label: 'Escanear QR Code', done: whatsAppConnected, ready: hasQrCode && !whatsAppConnected },
    { label: 'Atualizar grupos', done: Boolean(state.metrics.hasCachedGroups), ready: whatsAppConnected },
    { label: 'Salvar destinos em Fluxos', done: hasSavedDestinations, ready: Boolean(state.metrics.hasCachedGroups) && !hasSavedDestinations }
  ];
  const whatsappChecklistComplete = whatsappInternalChecklist.every((step) => step.done);
  const filteredGroups = useMemo(() => {
    return state.groups
      .sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
  }, [selected, state.groups]);

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.08),transparent_26%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">WhatsApp</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                  <Smartphone size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Central do WhatsApp</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    Conecte sua conta, acompanhe o QR Code e mantenha a sessão pronta. A escolha dos grupos de destino agora fica concentrada na aba Fluxos.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                {whatsAppStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {state.whatsAppPhone || 'Sem sessão conectada'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-6 xl:grid-cols-[minmax(0,1.25fr)_330px] max-sm:px-4">
          <div className="grid gap-5">
            <InternalSetupChecklist
              title="Checklist do Config. WhatsApp"
              steps={whatsappInternalChecklist}
              complete={whatsappChecklistComplete}
              completeLabel="WhatsApp 100% configurado"
            />

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                    <Smartphone size={18} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Conexao</p>
                    <p className="mt-1 text-base font-semibold">{whatsAppConnected ? 'Pronta para uso' : hasQrCode ? 'Aguardando leitura' : 'não conectada'}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  {whatsAppConnected ? 'sessão autenticada e pronta para uso no painel.' : 'Use o QR Code ao lado para concluir a Autenticação da conta.'}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-200">
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Destinos salvos</p>
                    <p className="mt-1 text-base font-semibold">{selectedGroups.length} grupo(s)</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  A selecao de destinos agora e feita na aba Fluxos.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[var(--foreground)]">
                    <Shield size={18} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Leitura de grupos</p>
                    <p className="mt-1 text-base font-semibold">
                      {state.metrics.groupsRefreshing
                        ? `${state.metrics.groupRefreshProgress?.percent || 0}%`
                        : `${state.metrics.availableAdminGroupCount || 0} encontrados`}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  {state.metrics.groupsRefreshing ? 'sincronização em andamento.' : 'Grupos detectados com acesso administrativo.'}
                </p>
              </div>
            </div>

            {state.issue?.message ? (
              <p className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                {state.issue.message}
              </p>
            ) : null}

            <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-start justify-between gap-4 max-lg:flex-col">
                <div>
                  <p className="text-sm font-semibold">Conexao do WhatsApp</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Use a reconexao para tentar recuperar a sessão sem apagar dados do cliente.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                    Operação segura
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => setShowAdvancedActions((current) => !current)}
                      className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-400/15"
                    >
                      {showAdvancedActions ? 'Ocultar avancadas' : 'Acoes avancadas'}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'wa-reconnect'}
                  onClick={async () => {
                    setBusy('wa-reconnect');
                    await postJson('/api/whatsapp/reconnect');
                    await refresh();
                    setNotice('Reconexao do WhatsApp solicitada.');
                    setBusy('');
                  }}
                  className="group rounded-2xl border border-[var(--border)] bg-white/[0.03] px-4 py-4 text-left transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.06] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 transition group-hover:scale-[1.02]">
                      <RefreshCcw size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Reconectar</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">Solicita uma nova tentativa de conexao.</p>
                    </div>
                  </div>
                </button>
              </div>

              {isAdmin && showAdvancedActions ? (
                <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-400/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3 max-md:flex-col">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">Area de suporte</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Use somente quando precisar trocar a conta conectada ou limpar todo o ambiente do cliente.
                      </p>
                    </div>
                    <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold text-sky-100">
                      Admin
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'wa-reset'}
                  onClick={async () => {
                    if (destructiveConfirmStep !== 'wa-reset') {
                      setDestructiveConfirmStep('wa-reset');
                      return;
                    }

                    setBusy('wa-reset');
                    await postJson('/api/whatsapp/reset-session');
                    await refresh();
                    setNotice('Nova sessão do WhatsApp preparada.');
                    setBusy('');
                    setDestructiveConfirmStep(null);
                  }}
                  className={cn(
                    'group rounded-2xl border px-4 py-4 text-left transition disabled:opacity-60',
                    destructiveConfirmStep === 'wa-reset'
                      ? 'border-amber-400/20 bg-amber-400/[0.08] hover:bg-amber-400/[0.12]'
                      : 'border-[var(--border)] bg-white/[0.03] hover:border-sky-400/20 hover:bg-sky-400/[0.06]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-200 transition group-hover:scale-[1.02]">
                      <Bot size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {destructiveConfirmStep === 'wa-reset' ? 'Confirmar troca de conta' : 'Trocar conta'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {destructiveConfirmStep === 'wa-reset'
                          ? 'Clique novamente para confirmar. Isso invalida a sessão atual.'
                          : 'Gera uma nova sessão para autenticar outra conta.'}
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'reset-all'}
                  onClick={async () => {
                    if (destructiveConfirmStep !== 'reset-all') {
                      setDestructiveConfirmStep('reset-all');
                      return;
                    }

                    setBusy('reset-all');
                    await postJson('/api/connections/reset-all');
                    await refresh();
                    setNotice('Tudo foi resetado. O painel voltou ao estado inicial de conexao.');
                    setBusy('');
                    setDestructiveConfirmStep(null);
                  }}
                  className={cn(
                    'group rounded-2xl border px-4 py-4 text-left transition disabled:opacity-60',
                    destructiveConfirmStep === 'reset-all'
                      ? 'border-red-400/35 bg-red-400/[0.16] hover:bg-red-400/[0.2]'
                      : 'border-red-400/20 bg-red-400/[0.08] hover:bg-red-400/[0.12]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-100 transition group-hover:scale-[1.02]">
                      <Power size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-50">
                        {destructiveConfirmStep === 'reset-all' ? 'Confirmar reset completo' : 'Reset completo'}
                      </p>
                      <p className="mt-1 text-xs text-red-100/75">
                        {destructiveConfirmStep === 'reset-all'
                          ? 'Clique novamente para confirmar. Esta ação remove todas as conexões ativas.'
                          : 'Limpa conexões e volta o painel ao estado inicial.'}
                      </p>
                    </div>
                  </div>
                </button>
                  </div>
                  {destructiveConfirmStep ? (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100 max-md:flex-col max-md:items-start">
                      <span>
                        Confirmacao em 2 passos ativa para ação destrutiva.
                      </span>
                      <button
                        type="button"
                        onClick={() => setDestructiveConfirmStep(null)}
                        className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-300/20"
                      >
                        Cancelar confirmacao
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <p className="text-sm font-semibold">Comportamento ao sair</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                Recomendado manter a sessão conectada para reconexao mais rapida ao voltar.
              </p>
              <label className="mt-3 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm leading-6 text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={disconnectOnLogout}
                  onChange={(event) => setDisconnectOnLogout(event.target.checked)}
                  disabled={readOnlyAccount || busy === 'wa-logout-behavior'}
                  className="mt-1 h-4 w-4 rounded border-white/15 bg-transparent accent-emerald-400"
                />
                <span>
                  <span className="block font-semibold text-white">Desconectar WhatsApp ao sair</span>
                  <span className="mt-1 block text-xs leading-5">
                    Quando ativado, ao clicar em Sair o sistema derruba a sessão do WhatsApp e exige novo QR no proximo login.
                  </span>
                </span>
              </label>
              <div className="mt-3">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={readOnlyAccount || busy === 'wa-logout-behavior'}
                  onClick={async () => {
                    setBusy('wa-logout-behavior');
                    try {
                      await postJson('/api/whatsapp/logout-behavior', {
                        disconnectWhatsAppOnLogout: disconnectOnLogout
                      });
                      await refresh();
                      setNotice('Preferencia de logout do WhatsApp salva.');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Salvar preferencia
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(8,20,16,0.98),rgba(8,20,16,0.9))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">QR Code do WhatsApp</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {hasQrCode
                    ? 'Escaneie com o seu WhatsApp para concluir a Autenticação.'
                    : whatsAppConnected
                      ? 'Sua sessão já esta conectada. O QR Code não e mais necessario.'
                      : 'Quando uma nova Autenticação for exigida, o QR Code será exibido aqui automaticamente.'}
                </p>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                {hasQrCode ? 'Disponivel' : whatsAppConnected ? 'Conectado' : 'Aguardando'}
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-white/[0.04] p-4">
              {state.qrDataUrl ? (
                <div className="rounded-2xl bg-white p-4 shadow-[0_20px_40px_rgba(0,0,0,0.12)]">
                  <img src={state.qrDataUrl} alt="QR Code do WhatsApp" className="mx-auto h-auto max-w-full rounded-lg" />
                </div>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 px-6 text-center text-sm text-[var(--muted)]">
                  {whatsAppConnected
                    ? 'sessão autenticada com sucesso.'
                    : whatsAppReconnecting
                      ? 'Reconectando com a sessão salva. Se demorar, use Reconectar WhatsApp.'
                      : 'Nenhum QR Code disponivel no momento.'}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 px-4 py-3 text-xs leading-5 text-[var(--muted)]">
              Dica: mantenha esta tela aberta apenas quando for autenticar ou trocar a conta. Depois disso, configure origens e destinos diretamente em Fluxos.
            </div>
          </div>
        </div>
      </section>

      <section className="hidden">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos</p>
          <h2 className="mt-1 text-xl font-semibold">Grupos do WhatsApp</h2>
        </div>
        <button
          type="button"
          disabled={readOnlyAccount || busy === 'groups' || state.metrics.groupsRefreshing}
          onClick={async () => {
            setBusy('groups');
            await postJson('/api/refresh-groups');
            await refresh();
            setNotice('Atualizacao dos grupos iniciada.');
            setBusy('');
          }}
          className={secondaryButton}
        >
          <RefreshCcw size={16} />
          {state.metrics.groupsRefreshing
            ? `Buscando ${state.metrics.groupRefreshProgress?.percent || 0}%`
            : 'Atualizar grupos'}
        </button>
      </div>

      {state.metrics.groupsRefreshing ? (
        <div className="mb-4 rounded-lg border border-emerald-400/15 bg-emerald-500/8 p-4">
          <div className="flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-sm font-semibold text-emerald-100">Sincronizando grupos do WhatsApp</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {groupsTotal
                  ? `Verificando seus grupos administrados. ${groupsProcessed}/${groupsTotal} analisados até agora.`
                  : 'Preparando a leitura dos grupos. Na primeira sincronização isso pode levar alguns minutos.'}
              </p>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-100">
              {groupsTotal ? `${groupsPercent}%` : 'Preparando'}
            </span>
          </div>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-lime-300 transition-[width] duration-500 ease-out"
              style={{ width: `${groupsTotal ? groupsPercent : 12}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)] max-sm:flex-col max-sm:items-start">
            <span>
              {groupsTotal ? 'Leitura em andamento' : 'Iniciando sincronização'}
              {state.metrics.hasCachedGroups && cachedAtLabel ? ` Â· exibindo lista salva de ${cachedAtLabel}` : ''}
            </span>
            <span>{groupsTotal ? `${groupsProcessed} de ${groupsTotal} grupos verificados` : 'Aguardando contagem total'}</span>
          </div>
        </div>
      ) : null}

      {!state.metrics.groupsRefreshing && state.metrics.hasCachedGroups && cachedAtLabel ? (
        <div className="mb-4 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-[var(--muted)]">
          Ultima lista salva: <span className="font-semibold text-[var(--foreground)]">{cachedAtLabel}</span>. você pode usar essa lista imediatamente enquanto uma nova sincronização não for necessaria.
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
        <Search size={17} className="text-[var(--muted)]" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar grupo pelo nome"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="mb-4 rounded-md border border-[var(--border)] bg-black/10 p-3">
        <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-start">
          <div>
            <p className="text-sm font-semibold">Grupos selecionados</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {selectedGroups.length
                ? `${selectedGroups.length} destino(s) pronto(s) para receber mensagens.`
                : 'Nenhum destino selecionado ainda.'}
              {hasWhatsAppDestinationLimit ? ` Limite do plano ${planLimits?.label}: ${whatsappDestinationLimit}.` : ''}
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {hasWhatsAppDestinationLimit ? `${selectedGroups.length}/${whatsappDestinationLimit}` : selectedGroups.length}
          </span>
        </div>

        {selectedGroups.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  if (readOnlyAccount) {
                    setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
                    return;
                  }
                  const next = new Set(selected);
                  next.delete(group.id);
                  setSelected(next);
                  setHasPendingSelectionChanges(true);
                }}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-left text-xs font-semibold text-emerald-50 transition hover:bg-emerald-400/15"
                title="Remover dos selecionados"
              >
                <span className="truncate">{group.name}</span>
                <GroupKindBadge group={group} />
                <X size={13} className="text-emerald-100/70" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="max-h-[560px] overflow-auto rounded-md border border-[var(--border)]">
        {filteredGroups.length ? (
          filteredGroups.map((group) => {
            const checked = selected.has(group.id);
            const disabledByLimit = !checked && selected.size >= whatsappDestinationLimit;

            return (
              <label key={group.id} className={cn('flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-white/5', disabledByLimit && 'opacity-55')}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={readOnlyAccount || disabledByLimit}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) {
                      if (next.size >= whatsappDestinationLimit) {
                        setNotice(`Seu plano permite até ${whatsappDestinationLimit} destino(s) WhatsApp.`);
                        return;
                      }
                      next.add(group.id);
                    } else {
                      next.delete(group.id);
                    }
                    setSelected(next);
                    setHasPendingSelectionChanges(true);
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
                <GroupKindBadge group={group} />
              </label>
            );
          })
        ) : (
          <p className="p-4 text-sm text-[var(--muted)]">Nenhum grupo encontrado.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-[var(--muted)]">
          {selected.size} grupo(s) selecionado(s)
          {hasWhatsAppDestinationLimit ? ` de ${whatsappDestinationLimit} liberado(s) no plano ${planLimits?.label}` : ''}
        </p>
        <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          {hasPendingSelectionChanges ? (
            <span className="text-xs font-semibold text-amber-200">Selecao alterada. Clique em salvar para manter esses destinos.</span>
          ) : null}
          <button
            type="button"
            disabled={readOnlyAccount || busy === 'save-groups'}
            className={primaryButton}
            onClick={async () => {
              setBusy('save-groups');
              await postJson('/api/groups', { selectedGroupIds: [...selected] });
              await refresh();
              setHasPendingSelectionChanges(false);
              setNotice('Grupos selecionados salvos.');
              setBusy('');
            }}
          >
            Salvar grupos
          </button>
        </div>
      </div>
      </section>
    </div>
  );
}


function StatusPill({ status }: { status: string }) {
  const label = formatOfferStatus(status);
  const className =
    status === 'sent'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
      : status === 'queued'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
        : status === 'failed'
          ? 'border-red-400/20 bg-red-400/10 text-red-100'
          : status === 'ignored'
            ? 'border-zinc-400/20 bg-zinc-400/10 text-zinc-200'
            : 'border-sky-400/20 bg-sky-400/10 text-sky-100';

  return <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', className)}>{label}</span>;
}

function GroupKindBadge({ group }: { group: WhatsAppGroup }) {
  if (group.isAnnouncement) {
    return (
      <span className="shrink-0 rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
        Avisos
      </span>
    );
  }

  if (group.isCommunityLinked) {
    return (
      <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
        Comunidade
      </span>
    );
  }

  return (
    <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
      Grupo
    </span>
  );
}

function SystemPowerSwitch({
  checked,
  disabled,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (nextValue: boolean) => Promise<void>;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => void onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-16 shrink-0 items-center rounded-full border px-1 transition',
        checked
          ? 'border-emerald-400/20 bg-emerald-400/20'
          : 'border-[var(--border)] bg-white/8',
        disabled && 'opacity-60'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-1 w-6 rounded-full bg-white shadow transition',
          checked ? 'left-[calc(100%-1.75rem)] bg-[var(--accent)]' : 'left-1 bg-white/90'
        )}
      />
      <span className="relative z-10 flex w-full justify-between px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--foreground)]">
        <span className={cn(checked ? 'opacity-100' : 'opacity-30')}>On</span>
        <span className={cn(checked ? 'opacity-30' : 'opacity-100')}>Off</span>
      </span>
    </button>
  );
}

function AffiliateAutomationPanel({
  state,
  setNotice,
  setBusy,
  busy,
  refresh
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const planLimits = state.planLimits;
  const affiliateAutomationLimit = planLimits?.affiliateAutomations ?? Number.POSITIVE_INFINITY;
  const affiliateModuleAllowed = affiliateAutomationLimit > 0;
  const affiliate = state.affiliate || { account: null, automations: [], logs: [], termsAccepted: false };
  const firstAutomation = affiliate.automations?.[0];
  const activeAutomation = firstAutomation;
  const [affiliateRulesEditing, setAffiliateRulesEditing] = useState(false);
  const [affiliateAccountEditing, setAffiliateAccountEditing] = useState(false);
  const affiliateAccountFormRef = useRef<HTMLFormElement>(null);
  const [testMessage, setTestMessage] = useState('Monitor Gamer LG UltraGear 24\n\nCupom: QUINTOUU\nR$ 639,00 a vista\nhttps://amzn.to/3QdY360');
  const testPreserveOriginalText = true;
  const [testResult, setTestResult] = useState<{
    originalMessage: string;
    processedMessage: string;
    convertedUrls: AffiliateLog['convertedUrls'];
    status: string;
    rewriteMode?: string;
    rewriteError?: string;
  } | null>(null);

  async function submitAccount(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const formElement = event?.currentTarget || affiliateAccountFormRef.current;
    if (!formElement) {
      return;
    }
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de salvar as credenciais.');
      return;
    }
    setBusy('affiliate-account');
    const form = new FormData(formElement);

    try {
      await postJson('/api/affiliate/account', {
        amazonEnabled: form.get('amazonEnabled') === 'on',
        amazonTag: form.get('amazonTag'),
        shopeeEnabled: form.get('shopeeEnabled') === 'on',
        shopeeAffiliateId: form.get('shopeeAffiliateId'),
        defaultSubId: form.get('defaultSubId'),
        shopeeAppId: form.get('shopeeAppId'),
        shopeeSecret: form.get('shopeeSecret')
      });

      await refresh();
      setAffiliateAccountEditing(false);
      setNotice('Dados de afiliado salvos.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possivel salvar os dados de afiliado.');
    } finally {
      setBusy('');
    }
  }

  async function runManualTest() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de rodar o teste.');
      return;
    }

    setBusy('affiliate-test');
    try {
      const draftAutomation = {
        ...(activeAutomation || {
          name: 'Teste manual',
          telegramSourceGroupId: state.telegram.availableChats?.[0]?.id || '',
          unknownLinkBehavior: 'keep',
          removeOriginalFooter: false,
          customFooter: '',
          messageBeautifierEnabled: false,
          messageBeautifierStyle: 'clean',
          aiRewriteEnabled: false,
          aiRewriteStyle: 'clean',
          mediaSourceMode: 'telegram_media'
        }),
        preserveOriginalTextEnabled: true,
        messageBeautifierEnabled: false,
        aiRewriteEnabled: false
      };
      const result = await postJson<typeof testResult>('/api/affiliate/test', {
        automationId: '',
        automation: draftAutomation,
        message: testMessage
      });
      setTestResult(result);
      setNotice('Teste de conversao concluido.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possivel concluir o teste de conversao.');
    } finally {
      setBusy('');
    }
  }

  async function saveAffiliateRules(formElement: HTMLFormElement) {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de salvar as regras.');
      return;
    }
    if (!activeAutomation?.id || !activeAutomation.telegramSourceGroupId) {
      setNotice('Configure primeiro o Automatizador de Ofertas na aba Fluxos.');
      return;
    }

    setBusy('affiliate-rules');
    try {
      const form = new FormData(formElement);
      await postJson(`/api/affiliate/automations/${activeAutomation.id}/rules`, {
        unknownLinkBehavior: form.get('unknownLinkBehavior'),
        customFooter: form.get('customFooter'),
        removeOriginalFooter: form.get('removeOriginalFooter') === 'on',
        mediaSourceMode: form.get('mediaSourceMode'),
        messageBeautifierEnabled: false,
        messageBeautifierStyle: 'clean',
        aiRewriteEnabled: false,
        aiRewriteStyle: 'clean',
        preserveOriginalTextEnabled: true
      });
      await refresh();
      setAffiliateRulesEditing(false);
      setNotice('Regras de afiliados salvas.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possivel salvar as regras de afiliados.');
    } finally {
      setBusy('');
    }
  }

  async function acceptTerms() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }

    setBusy('affiliate-terms');
    try {
      await postJson('/api/affiliate/terms/accept', {});
      await refresh();
      setNotice('Termo de uso aceito.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possivel aceitar o termo.');
    } finally {
      setBusy('');
    }
  }

  const affiliatePrimaryButtonClass =
    'rounded-xl border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(37,211,102,0.96),rgba(34,158,217,0.92))] px-5 py-3 font-semibold text-slate-950 shadow-[0_14px_30px_rgba(25,140,102,0.28)] transition hover:-translate-y-[1px] hover:shadow-[0_18px_38px_rgba(25,140,102,0.36)] disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none';
  const affiliateSecondaryButtonClass =
    'rounded-xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(34,158,217,0.2))] px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-cyan-300/30 hover:bg-[linear-gradient(135deg,rgba(16,185,129,0.24),rgba(34,158,217,0.28))] hover:text-white disabled:opacity-60';
  const affiliateTermsAccepted = Boolean(affiliate.termsAccepted);
  const affiliateAccountLocked = Boolean(affiliate.account?.id) && !affiliateAccountEditing;
  const affiliateAccountFieldsDisabled = readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || affiliateAccountLocked || busy === 'affiliate-account';
  const testLinks = testResult?.convertedUrls || [];
  const testConvertedLinks = testLinks.filter((url) => url.status === 'converted' && url.affiliateUrl);
  const testConvertedCount = testLinks.filter((url) => url.status === 'converted').length;
  const testIgnoredCount = testLinks.filter((url) => url.status === 'ignored').length;
  const testErrorCount = testLinks.filter((url) => url.status === 'error').length;
  const testRewriteLabel = (mode: string) => {
    if (mode === 'groq') {
      return 'IA Groq';
    }
    if (mode === 'groq_fallback_local') {
      return 'Fallback local';
    }
    if (mode === 'link_replace_only') {
      return 'Somente links';
    }
    return 'Local';
  };
  const testStatusClass = (status: string) => {
    if (status === 'converted') {
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
    }
    if (status === 'error') {
      return 'border-red-400/25 bg-red-400/10 text-red-100';
    }
    return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  };
  const testStatusLabel = (status: string) => {
    if (status === 'converted') {
      return 'Convertido';
    }
    if (status === 'error') {
      return 'Erro';
    }
    return 'Mantido';
  };

  return (
    <div className="grid gap-5">
      <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] max-sm:p-4">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">automação de Afiliados</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Links Amazon e Shopee no automatico</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Um fluxo separado para ler ofertas do Telegram, converter links elegiveis e entregar a mensagem final nos grupos de WhatsApp escolhidos.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
            {affiliate.automations?.filter((automation) => automation.isActive).length || 0} ativa(s)
          </span>
        </div>

        {affiliate.error ? (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {affiliate.error}
          </p>
        ) : null}

        {!affiliateModuleAllowed ? (
          <p className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            Seu plano {planLimits?.label || 'atual'} esta em modo ponte simples. automação de Afiliados entra a partir do plano Plus.
          </p>
        ) : null}

        {!affiliate.termsAccepted ? (
          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
            <p className="text-sm font-semibold text-amber-50">Aceite obrigatorio</p>
            <p className="mt-2 text-xs leading-5 text-amber-100/80">
              Declaro que tenho autorizacao para reutilizar, adaptar e republicar as mensagens monitoradas por esta automação. Tambem sou responsavel pelos links de afiliado configurados e pelo cumprimento das politicas dos programas.
            </p>
            <button type="button" disabled={readOnlyAccount || busy === 'affiliate-terms'} onClick={acceptTerms} className={`mt-3 ${affiliatePrimaryButtonClass}`}>
              {busy === 'affiliate-terms' ? 'Liberando modulo...' : 'Aceitar termo e liberar modulo'}
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="grid gap-5">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Regras do automatizador</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  As origens e destinos operacionais agora ficam na aba <span className="font-semibold text-[var(--foreground)]">Fluxos</span>. Aqui você concentra apenas as configuracoes de afiliado, os testes e o Histórico.
                </p>
              </div>
              <span className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100">
                {activeAutomation?.name || 'Fluxo não configurado'}
              </span>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Origem ativa</p>
                <p className="mt-2 text-sm font-semibold">{getTelegramChatName(state, activeAutomation?.telegramSourceGroupId)}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  O grupo de origem do automatizador de ofertas e configurado na aba Fluxos.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos ativos</p>
                <p className="mt-2 text-sm font-semibold">{activeAutomation?.destinations?.length || 0} grupo(s)</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Os destinos do automatizador acompanham a selecao feita na aba Fluxos e sao aplicados quando o fluxo e salvo.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Modo atual de imagem</p>
                <p className="mt-2 text-sm font-semibold">{formatMediaSourceMode(activeAutomation?.mediaSourceMode)}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Define se o automatizador tenta usar a imagem original do Telegram ou a imagem do link do produto.
                </p>
              </div>
            </div>

            <form onSubmit={(event) => event.preventDefault()} className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3 max-md:flex-col">
                <div>
                  <p className="text-sm font-semibold">Regras de tratamento</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Defina o que fazer com links que não sao Amazon/Shopee e personalize o rodape das mensagens convertidas.
                  </p>
                </div>
                {!activeAutomation ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
                    Configure em Fluxos
                  </span>
                ) : affiliateRulesEditing ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                    Edicao liberada
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                    Travado
                  </span>
                )}
              </div>

              <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Links desconhecidos</span>
                  <select
                    name="unknownLinkBehavior"
                    defaultValue={activeAutomation?.unknownLinkBehavior || 'keep'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <option value="keep">Manter link original</option>
                    <option value="remove">Remover link</option>
                    <option value="ignore_message">Ignorar mensagem inteira</option>
                  </select>
                  <span className="text-xs leading-5 text-[var(--muted)]">
                    Recomendado: manter o link original para não perder conteudo quando o marketplace não for reconhecido.
                  </span>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Origem da imagem</span>
                  <select
                    name="mediaSourceMode"
                    defaultValue={activeAutomation?.mediaSourceMode || 'telegram_media'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <option value="telegram_media">Usar imagem original do Telegram</option>
                    <option value="product_image">Usar imagem do link do produto</option>
                  </select>
                  <span className="text-xs leading-5 text-[var(--muted)]">
                    Se o modo escolhido falhar, o sistema usa fallback automatico para manter o envio.
                  </span>
                </label>

                <div className="grid gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4">
                  <div className="inline-flex items-start gap-2 text-sm text-[var(--muted)]">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" />
                    <span>
                      <span className="block font-semibold text-[var(--foreground)]">Modo de escrita ativo</span>
                      <span className="mt-1 block text-xs leading-5">
                        O sistema preserva a mensagem original e substitui somente os links convertidos, removendo o rodape antigo antes de aplicar o seu rodape final.
                      </span>
                    </span>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Processamento atual</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">Preservar texto original e substituir apenas os links</p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      Essa e a unica regra de escrita mantida no painel para garantir previsibilidade na saida e evitar conflito entre modos diferentes.
                    </p>
                  </div>
                </div>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Rodape personalizado</span>
                  <textarea
                    name="customFooter"
                    defaultValue={activeAutomation?.customFooter || ''}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    placeholder={`Exemplo:\nVisite nosso Instagram:\n- www.instagram.com/exemplo\nEsperamos por voces la`}
                    className="min-h-32 rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm leading-6 outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-65"
                  />
                  <span className="text-xs leading-5 text-[var(--muted)]">você pode quebrar linhas livremente nesse rodape.</span>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input
                    type="checkbox"
                    name="removeOriginalFooter"
                    defaultChecked={Boolean(activeAutomation?.removeOriginalFooter)}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                  />
                  Remover rodape original da mensagem captada
                </label>
                <button
                  type="button"
                  onClick={(event) => {
                    if (!affiliateRulesEditing) {
                      setAffiliateRulesEditing(true);
                      return;
                    }

                    if (event.currentTarget.form) {
                      void saveAffiliateRules(event.currentTarget.form);
                    }
                  }}
                  disabled={readOnlyAccount || busy === 'affiliate-rules' || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation}
                  className={affiliatePrimaryButtonClass}
                >
                  {busy === 'affiliate-rules' ? 'Salvando...' : affiliateRulesEditing ? 'Salvar regras' : 'Editar'}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Simulador de mensagem final</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Cole uma oferta e veja exatamente como ela será entregue, sem enviar nada ao WhatsApp.
                </p>
              </div>
              <button type="button" disabled={readOnlyAccount || busy === 'affiliate-test' || !affiliateModuleAllowed || !affiliateTermsAccepted} onClick={runManualTest} className={affiliateSecondaryButtonClass}>
                {busy === 'affiliate-test' ? 'Testando...' : 'Rodar teste'}
              </button>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4 text-sm text-[var(--muted)]">
              <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" />
              <span>
                <span className="block font-semibold text-[var(--foreground)]">Preservar texto original e substituir somente os links</span>
                <span className="mt-1 block text-xs leading-5">
                  Modo fixo do teste: o sistema grava os links convertidos e aplica cada link novo em cima da mensagem recebida, sem reescrever o texto.
                </span>
              </span>
            </div>

            <label className="mt-4 grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Mensagem recebida para teste</span>
              <textarea
                value={testMessage}
                disabled={readOnlyAccount}
                onChange={(event) => setTestMessage(event.target.value)}
                className="min-h-40 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-65"
              />
            </label>

            {testResult ? (
              <div className="mt-5 grid gap-4">
                <div className="rounded-2xl border border-emerald-400/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(34,158,217,0.08))] p-4">
                  <div className="flex items-start justify-between gap-3 max-sm:flex-col">
                    <div>
                      <p className="text-sm font-semibold">Resumo do teste</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Conferencia rapida do que foi convertido, mantido ou bloqueado antes do envio real.
                      </p>
                    </div>
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold capitalize', testStatusClass(testResult.status))}>
                      {testStatusLabel(testResult.status)}
                    </span>
                  </div>

                  {testResult.rewriteMode ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                        Processamento: {testRewriteLabel(testResult.rewriteMode)}
                      </span>
                      {testResult.rewriteError ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-100">
                          {testResult.rewriteError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-emerald-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-emerald-100">{testConvertedCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Convertido(s)</p>
                    </div>
                    <div className="rounded-xl border border-amber-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-amber-100">{testIgnoredCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Mantido(s)</p>
                    </div>
                    <div className="rounded-xl border border-red-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-red-100">{testErrorCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Erro(s)</p>
                    </div>
                  </div>
                </div>

                {testConvertedLinks.length ? (
                  <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Links convertidos gravados</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          Estes sao os links finais que serao aplicados em cima do texto original.
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                        {testConvertedLinks.length}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {testConvertedLinks.map((url, index) => (
                        <div key={`${url.originalUrl}-converted-${index}`} className="rounded-xl border border-white/10 bg-black/15 p-3 text-xs">
                          <p className="font-semibold capitalize text-emerald-100">{url.marketplace}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all text-emerald-50/90">Convertido: {url.affiliateUrl}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-black/15 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Entrada original</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-[var(--muted)]">
                      {testResult.originalMessage}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">Saida que será enviada</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-emerald-400/15 bg-black/20 p-4 text-xs leading-5 text-emerald-50/90">
                      {testResult.processedMessage}
                    </pre>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Links analisados</p>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[var(--muted)]">
                      {testLinks.length} link(s)
                    </span>
                  </div>

                  {testLinks.length ? testLinks.map((url, index) => (
                    <div key={`${url.originalUrl}-${index}`} className={cn('rounded-2xl border p-4 text-xs', testStatusClass(url.status))}>
                      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
                        <div>
                          <p className="font-semibold capitalize">{url.marketplace} - {testStatusLabel(url.status)}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Final: {url.affiliateUrl || url.expandedUrl || '-'}</p>
                        </div>
                        <span className="rounded-full border border-current/20 px-3 py-1 font-semibold">
                          {url.status}
                        </span>
                      </div>

                      {url.marketplace === 'shopee' && url.affiliateId ? (
                        <p className="mt-3 break-all text-[var(--muted)]">Affiliate ID aplicado: {url.affiliateId}</p>
                      ) : null}
                      {url.marketplace === 'shopee' && url.subIds ? (
                        <div className="mt-3 grid gap-1 rounded-xl border border-white/10 bg-black/15 p-3 text-[var(--muted)]">
                          <p className="font-semibold text-[var(--foreground)]">SUBIDs aplicados:</p>
                          {Object.entries(url.subIds).map(([key, value]) => (
                            <p key={key}>{key.replace('subId', 'sub_id_')}: {value}</p>
                          ))}
                          {url.utmContent ? <p className="break-all">utm_content final: {url.utmContent}</p> : null}
                        </div>
                      ) : null}
                      {url.error ? <p className="mt-3 text-amber-100">Erro: {url.error}</p> : null}
                    </div>
                  )) : (
                    <p className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
                      Nenhum link foi encontrado nessa mensagem.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-5">
          <form ref={affiliateAccountFormRef} onSubmit={(event) => event.preventDefault()} className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">Contas de afiliado</p>
              {affiliate.account?.id ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${affiliateAccountEditing ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-[var(--muted)]'}`}>
                  {affiliateAccountEditing ? 'Edicao liberada' : 'Travado'}
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" name="amazonEnabled" defaultChecked={Boolean(affiliate.account?.amazonEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} /> Converter Amazon</label>
              <input name="amazonTag" disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} defaultValue={affiliate.account?.amazonTag || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.amazonAffiliate ? 'sua-tag-20' : 'Disponivel no Plus'} />

              <div className="mt-2 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] p-4">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input type="checkbox" name="shopeeEnabled" defaultChecked={Boolean(affiliate.account?.shopeeEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} />
                  Converter Shopee com link curto oficial
                </label>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  SUBIDs sao opcionais e servem apenas para rastrear de onde veio a venda. O link funciona sem eles, mas recomendamos usar para relatorios.
                </p>
              </div>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Affiliate ID Shopee</span>
                <input name="shopeeAffiliateId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAffiliateId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.shopeeAffiliate ? 'Ex: 18393040998' : 'Disponivel no Pro'} />
                <span className="text-xs leading-5 text-[var(--muted)]">Seu ID de afiliado da Shopee. Usado para gerar o link comissionado.</span>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Prefixo de rastreamento / Campanha padrao</span>
                <input name="defaultSubId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.defaultSubId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="Ex: auto" />
                <span className="text-xs leading-5 text-[var(--muted)]">Usado no SUBID para identificar origem das conversoes. Exemplo: auto, maio2026, grupo-vip.</span>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">App ID Shopee</span>
                <input name="shopeeAppId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAppId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="App ID Shopee" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Secret/API Secret</span>
                <input name="shopeeSecret" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={affiliate.account?.shopeeSecretConfigured ? 'Secret já configurado' : 'Secret/API Secret'} />
                <span className="text-xs leading-5 text-[var(--muted)]">
                  Usado apenas na comunicacao segura com a Shopee. Se já estiver configurado, deixe em branco para manter o secret atual.
                </span>
              </label>
            </div>
            {affiliateAccountLocked ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setAffiliateAccountEditing(true);
                }}
                disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                className={`mt-4 w-full ${affiliatePrimaryButtonClass}`}
              >
                Editar
              </button>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void submitAccount();
                }}
                disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                className={`mt-4 w-full ${affiliatePrimaryButtonClass}`}
              >
                {busy === 'affiliate-account' ? 'Salvando...' : 'Salvar dados'}
              </button>
            )}
          </form>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <p className="text-sm font-semibold">Histórico recente</p>
            <div className="mt-4 grid gap-3">
              {affiliate.logs?.length ? affiliate.logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{log.status}</span>
                    <span className="text-[11px] text-[var(--muted)]">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{log.processedMessage || log.originalMessage}</p>
                  {log.errorMessage ? <p className="mt-2 text-xs text-red-100">{log.errorMessage}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">Nenhuma mensagem processada ainda.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ActivityLog({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const dedupedEvents = useMemo(() => {
    return state.activity.filter((event, index, events) => {
      const previous = events[index - 1];
      if (!previous) {
        return true;
      }

      return !(previous.message === event.message && previous.level === event.level);
    });
  }, [state.activity]);
  const events = compact ? dedupedEvents.slice(0, 6) : dedupedEvents;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Histórico</p>
          <h2 className="mt-1 text-xl font-semibold">Atividade recente</h2>
        </div>
      </div>
      <div className="grid gap-2">
        {events.length ? (
          events.map((event) => (
            <article key={event.id} className="rounded-md border border-[var(--border)] bg-black/10 p-3">
              <div className="flex items-start gap-3">
                {event.level === 'error' ? (
                  <AlertCircle size={18} className="mt-0.5 text-[var(--danger)]" />
                ) : (
                  <CheckCircle2 size={18} className="mt-0.5 text-[var(--accent)]" />
                )}
                <div>
                  <p className="text-sm font-semibold">{event.message}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{formatDate(event.at)}</p>
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm text-[var(--muted)]">Sem atividade recente.</p>
        )}
      </div>
    </section>
  );
}

function AccountPanel({
  state,
  refresh,
  setNotice
}: {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const user = state.auth.user;
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [previewAvatar, setPreviewAvatar] = useState(user?.avatarUrl || '');
  const [profileEditing, setProfileEditing] = useState(false);

  const providers = user?.providers || [];
  const usesGoogleAvatar = providers.includes('google');
  const canChangePassword = providers.includes('password');

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Conta</p>
          <h2 className="mt-1 text-2xl font-semibold">Perfil e acesso</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Atualize seu nome, gerencie a senha e personalize a foto do perfil quando a conta usar login por e-mail.
          </p>
        </div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
              <div>
                <p className="text-sm font-semibold">Dados do perfil</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Essas informaÃ§Ãµes aparecem no seu painel e ajudam a identificar a conta conectada.
                </p>
              </div>

              <div className="flex items-center gap-2 max-sm:w-full">
                {profileEditing ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      setName(user?.name || '');
                      setProfileEditing(false);
                    }}
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  className={profileEditing ? secondaryButton : primaryButton}
                  disabled={readOnlyAccount}
                  onClick={() => {
                    if (!profileEditing) {
                      setProfileEditing(true);
                    }
                  }}
                >
                  {profileEditing ? 'Editando perfil' : 'Editar'}
                </button>
              </div>
            </div>

            <form
              className="mt-4 grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();

                if (!profileEditing) {
                  return;
                }

                setBusy('profile');

                try {
                  await postJson('/api/account/profile', { name });
                  await refresh();
                  setProfileEditing(false);
                  setNotice('Perfil atualizado com sucesso.');
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : 'não foi possivel atualizar o perfil.');
                } finally {
                  setBusy('');
                }
              }}
            >
              <Field label="Nome" value={name} onChange={setName} disabled={readOnlyAccount || !profileEditing} icon={User} />
              <Field label="E-mail" value={user?.email || ''} disabled icon={Mail} />
              {profileEditing ? (
                <div className="flex justify-end">
                  <button type="submit" className={primaryButton} disabled={readOnlyAccount || busy === 'profile'}>
                    Salvar perfil
                  </button>
                </div>
              ) : null}
            </form>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Seguranca da conta</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {canChangePassword
                    ? 'Use uma senha forte e atualize o acesso sempre que necessario.'
                    : 'Esta conta usa Autenticação externa e a senha e gerenciada fora do Portal do Afiliado.'}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {canChangePassword ? 'Senha local' : 'Login externo'}
              </span>
            </div>

            {canChangePassword ? (
              <form
                className="mt-4 grid gap-4 md:grid-cols-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy('password');

                  try {
                    await postJson('/api/account/password', {
                      currentPassword,
                      nextPassword,
                      confirmPassword
                    });
                    setCurrentPassword('');
                    setNextPassword('');
                    setConfirmPassword('');
                    await refresh();
                    setNotice('Senha atualizada com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possivel atualizar a senha.');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Field
                  label="Senha atual"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  icon={LockKeyhole}
                  disabled={readOnlyAccount}
                />
                <div className="hidden md:block" />
                <Field
                  label="Nova senha"
                  type="password"
                  autoComplete="new-password"
                  value={nextPassword}
                  onChange={setNextPassword}
                  icon={Shield}
                  disabled={readOnlyAccount}
                />
                <Field
                  label="Confirmar nova senha"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  icon={ShieldCheck}
                  disabled={readOnlyAccount}
                />
                <div className="md:col-span-2 flex justify-end">
                  <button type="submit" className={primaryButton} disabled={readOnlyAccount || busy === 'password'}>
                    Alterar senha
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-4 rounded-md border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-50">
                A senha desta conta e gerenciada pelo provedor de login conectado.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Foto do perfil</p>
        <h2 className="mt-1 text-xl font-semibold">Identidade da conta</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {usesGoogleAvatar
            ? 'Sua foto esta sincronizada com o Google e e atualizada automaticamente.'
            : 'Envie uma foto clara para identificar esta conta dentro do painel.'}
        </p>

        <div className="mt-5 flex flex-col items-center rounded-2xl border border-[var(--border)] bg-black/10 px-5 py-6 text-center">
          <AvatarBadge
            user={{
              ...(user || {}),
              avatarUrl: previewAvatar || user?.avatarUrl || ''
            }}
            size="lg"
          />
          <p className="mt-4 text-lg font-semibold">{user?.name || 'Usuario'}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{user?.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {providers.map((provider) => (
              <span key={provider} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {provider === 'google' ? 'Google' : 'Email e senha'}
              </span>
            ))}
          </div>
        </div>

        {usesGoogleAvatar ? (
          <div className="mt-4 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
            Como esta conta usa Google, a foto de perfil vem diretamente do Google do usuario.
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <p className="text-sm font-semibold">Enviar nova foto</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Aceitamos PNG, JPG ou WEBP com até 1 MB.
            </p>
            <label className={cn('mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-400/20 bg-emerald-400/5 px-4 py-6 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/10', readOnlyAccount && 'cursor-not-allowed opacity-60')}>
              <Camera size={18} />
              Selecionar imagem
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={readOnlyAccount}
                onChange={async (event) => {
                  const file = event.target.files?.[0];

                  if (!file) {
                    return;
                  }

                  try {
                    if (file.size > 1024 * 1024) {
                      throw new Error('A imagem deve ter no mÃ¡ximo 1 MB.');
                    }

                    const avatarDataUrl = await readFileAsDataUrl(file);
                    setBusy('avatar');
                    setPreviewAvatar(avatarDataUrl);
                    await postJson('/api/account/avatar', { avatarDataUrl });
                    setBusy('');
                    await refresh();
                    setNotice('Foto do perfil atualizada com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possivel atualizar a foto do perfil.');
                  } finally {
                    event.currentTarget.value = '';
                    setBusy('');
                  }
                }}
              />
            </label>
            {busy === 'avatar' ? (
              <p className="mt-3 text-xs font-semibold text-emerald-100">Enviando nova foto...</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminPanel({
  state,
  refresh,
  setNotice
}: {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const supervisor = state.admin?.supervisor;
  const users = (state.admin?.users || []).filter((user) =>
    normalizeText(`${user.name} ${user.email}`).includes(normalizeText(search))
  );
  const auditEvents = (state.activity || []).filter((event) => event.type === 'audit_admin').slice(0, 10);

  return (
    <section className="grid gap-5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Administracao</p>
          <h2 className="mt-1 text-xl font-semibold">Contas e acesso</h2>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
          <Search size={17} className="text-[var(--muted)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar usuario"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-8">
        <AdminSupervisorMetric label="Runtimes" value={supervisor?.totalRuntimes || 0} />
        <AdminSupervisorMetric label="Telegram OK" value={supervisor?.listeningTelegram || 0} tone="success" />
        <AdminSupervisorMetric label="WhatsApp OK" value={supervisor?.readyWhatsApp || 0} tone="success" />
        <AdminSupervisorMetric label="Filas ativas" value={supervisor?.activeDeliveries || 0} tone="info" />
        <AdminSupervisorMetric label="Aguardando" value={supervisor?.queuedDeliveries || 0} tone="warning" />
        <AdminSupervisorMetric label="Duplicados" value={supervisor?.skippedDuplicates || 0} tone="info" />
        <AdminSupervisorMetric label="Falhas transit." value={supervisor?.transientFailures || 0} tone="warning" />
        <AdminSupervisorMetric label="Falhas fatais" value={supervisor?.fatalFailures || 0} tone="default" />
      </div>

      {(supervisor?.healthAlerts || []).length > 0 ? (
        <div className="grid gap-2">
          {(supervisor?.healthAlerts || []).map((alert, index) => (
            <div
              key={`${alert.code || 'alert'}-${index}`}
              className={cn(
                'rounded-md border px-3 py-2 text-xs',
                alert.level === 'critical'
                  ? 'border-red-400/20 bg-red-400/10 text-red-100'
                  : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
              )}
            >
              {alert.message || 'Alerta operacional ativo.'}
            </div>
          ))}
        </div>
      ) : null}

      <section className="rounded-md border border-[var(--border)] bg-black/10 p-4">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Auditoria</p>
          <h3 className="mt-1 text-sm font-semibold">Acoes admin recentes</h3>
        </div>
        <div className="grid gap-2">
          {auditEvents.length ? (
            auditEvents.map((event) => {
              const action = String(event?.metadata?.action || 'admin.ação');
              const outcome = String(event?.metadata?.outcome || 'unknown');
              const target = String(event?.metadata?.targetUserId || '-');

              return (
                <article key={event.id} className="rounded border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-xs">
                  <p className="font-semibold">{action} - {outcome}</p>
                  <p className="mt-1 text-[var(--muted)]">alvo: {target} | {formatDate(event.at)}</p>
                </article>
              );
            })
          ) : (
            <p className="text-xs text-[var(--muted)]">Sem eventos de auditoria recentes.</p>
          )}
        </div>
      </section>

      <div className="grid gap-3">
        {users.map((user) => (
          <article key={user.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-md border border-[var(--border)] bg-black/10 p-4 max-lg:grid-cols-1">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{user.name}</p>
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    user.isOnline
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : 'border-red-400/20 bg-red-400/10 text-red-100'
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', user.isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                  {user.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-white/5 px-2 py-1">Plano {humanize(user.plan || 'beta')}</span>
                <span className="rounded bg-white/5 px-2 py-1">Conta {humanize(user.accountStatus || 'active')}</span>
                <span className="rounded bg-white/5 px-2 py-1">{user.workspace?.selectedGroupCount || 0} grupo(s)</span>
                <AdminRuntimeStatusPill label="Telegram" value={user.supervisor?.telegramStatus || user.workspace?.telegramStatus || 'offline'} />
                <AdminRuntimeStatusPill label="WhatsApp" value={user.supervisor?.whatsAppStatus || user.workspace?.whatsAppStatus || 'offline'} />
              </div>
              <div className="mt-4 grid gap-2 rounded-md border border-[var(--border)] bg-white/[0.03] p-3 text-xs text-[var(--muted)] md:grid-cols-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.deliveryQueue?.queuedCount || 0}</p>
                  <p>Na fila</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.pendingTelegramCount || 0}</p>
                  <p>Telegram pendente</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.metrics?.totalWhatsAppDeliveries || 0}</p>
                  <p>Entregas</p>
                </div>
                <div>
                  <p className={cn('font-semibold', (user.supervisor?.totalErrors || user.metrics?.totalErrors || 0) > 0 ? 'text-red-100' : 'text-[var(--foreground)]')}>
                    {user.supervisor?.totalErrors || user.metrics?.totalErrors || 0}
                  </p>
                  <p>Erros</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.deliveryStats?.skippedDuplicates || 0}</p>
                  <p>Duplicados evitados</p>
                </div>
                <div>
                  <p className={cn('font-semibold', (user.supervisor?.deliveryStats?.fatalFailures || 0) > 0 ? 'text-red-100' : 'text-[var(--foreground)]')}>
                    {user.supervisor?.deliveryStats?.fatalFailures || 0}
                  </p>
                  <p>Falhas fatais</p>
                </div>
                {user.supervisor?.deliveryQueue?.lastError ? (
                  <p className="col-span-full rounded border border-red-400/20 bg-red-400/10 px-3 py-2 text-red-100">
                    Ultimo erro da fila: {user.supervisor.deliveryQueue.lastError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-2">
              <select
                defaultValue={user.plan || 'beta'}
                className={inputClass}
                onChange={async (event) => {
                  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}`, { plan: event.target.value });
                  await refresh();
                  setNotice('Plano atualizado.');
                }}
              >
                <option value="beta">Beta</option>
                <option value="starter">Starter</option>
                <option value="plus">Plus</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <select
                defaultValue={user.accountStatus || 'active'}
                className={inputClass}
                onChange={async (event) => {
                  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}`, { accountStatus: event.target.value });
                  await refresh();
                  setNotice(
                    event.target.value === 'suspended'
                      ? 'Conta suspensa e sessão encerrada imediatamente.'
                      : 'Status da conta atualizado.'
                  );
                }}
              >
                <option value="active">Ativa</option>
                <option value="trial">Em teste</option>
                <option value="suspended">Suspensa</option>
              </select>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/15"
                onClick={async () => {
                  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/restart-runtime`);
                  await refresh();
                  setNotice(`sessão de ${user.name} reiniciada sem apagar dados.`);
                }}
              >
                <RefreshCcw size={16} />
                Reiniciar sessão
              </button>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-400/15"
                onClick={async () => {
                  const confirmed = window.confirm(
                    `Deseja realmente excluir a conta de ${user.name}? Essa ação remove o acesso, o perfil e os dados locais dessa conta.`
                  );

                  if (!confirmed) {
                    return;
                  }

                  try {
                    await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
                      method: 'DELETE'
                    });
                    await refresh();
                    setNotice('Conta excluida com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possivel excluir a conta.');
                  }
                }}
              >
                <Trash2 size={16} />
                Excluir conta
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminSupervisorMetric({
  label,
  value,
  tone = 'default'
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'info';
}) {
  const toneClass = {
    default: 'border-white/10 bg-white/[0.03] text-[var(--foreground)]',
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
    warning: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
    info: 'border-sky-400/20 bg-sky-400/10 text-sky-100'
  }[tone];

  return (
    <div className={cn('rounded-md border p-3', toneClass)}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{label}</p>
    </div>
  );
}

function AdminRuntimeStatusPill({ label, value }: { label: string; value: string }) {
  const normalized = String(value || '').toLowerCase();
  const healthy = ['ready', 'listening', 'authenticated'].includes(normalized);
  const waiting = ['connecting', 'qr_required', 'auth_required', 'code_required', 'password_required', 'reconnecting'].includes(normalized);
  const className = healthy
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
    : waiting
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
      : 'border-red-400/20 bg-red-400/10 text-red-100';

  return (
    <span className={cn('rounded border px-2 py-1', className)}>
      {label}: {humanize(value || 'offline')}
    </span>
  );
}

function getFlowHealthStatus({
  selected,
  saved,
  hasTelegramSession,
  sourceId,
  requiresPlan = true,
  hasDestinations = true
}: {
  selected: boolean;
  saved: boolean;
  hasTelegramSession: boolean;
  sourceId: string;
  requiresPlan?: boolean;
  hasDestinations?: boolean;
}) {
  if (!requiresPlan) {
    return { label: 'Com erro', reason: 'Plano atual sem suporte' };
  }
  if (!hasTelegramSession) {
    return { label: 'Incompleto', reason: 'Telegram desconectado' };
  }
  if (!String(sourceId || '').trim()) {
    return { label: 'Incompleto', reason: 'Sem origem configurada' };
  }
  if (!hasDestinations) {
    return { label: 'Incompleto', reason: 'Sem destino WhatsApp' };
  }
  if (selected && saved) {
    return { label: 'Ativo', reason: '' };
  }
  if (!selected && saved) {
    return { label: 'Pausado', reason: 'Fluxo alternativo em uso' };
  }
  return { label: 'Incompleto', reason: 'não salvo' };
}

function getActiveAffiliateAutomation(state: AppState) {
  return (state.affiliate?.automations || []).find((automation) => automation.isActive) || null;
}

function getOperationalTelegramSource(state: AppState) {
  if (state.telegramStatus !== 'listening') {
    return '';
  }

  const activeAffiliateAutomation = getActiveAffiliateAutomation(state);

  return normalizeRouteSourceId(
    activeAffiliateAutomation?.telegramSourceGroupId ||
      state.config.telegramChannel
  );
}

function hasOperationalTelegramSource(state: AppState) {
  return Boolean(getOperationalTelegramSource(state));
}

function hasOperationalWhatsAppDestination(state: AppState) {
  return (state.config.selectedGroupIds?.length || 0) > 0;
}

function canEnableAutomationState(state: AppState) {
  return (
    state.telegramStatus === 'listening' &&
    isWhatsAppConnectedStatus(state.whatsAppStatus) &&
    hasOperationalTelegramSource(state) &&
    hasOperationalWhatsAppDestination(state)
  );
}

function getAutomationLockReason(state: AppState) {
  if (state.telegramStatus !== 'listening') {
    return 'Conecte e conclua o login no Telegram para liberar a automação.';
  }
  if (!isWhatsAppConnectedStatus(state.whatsAppStatus)) {
    return 'Conecte o WhatsApp e aguarde o status ficar pronto para liberar a automação.';
  }
  if (!hasOperationalTelegramSource(state)) {
    return 'Escolha e salve uma origem no fluxo ativo antes de ligar o sistema.';
  }
  if (!hasOperationalWhatsAppDestination(state)) {
    return 'Escolha ao menos um destino do WhatsApp antes de ligar o sistema.';
  }
  return '';
}

function formatMediaSourceMode(value?: string) {
  return String(value || '').toLowerCase() === 'product_image'
    ? 'Imagem do link do produto'
    : 'Imagem original do Telegram';
}

function getTelegramChatName(state: AppState, sourceId?: string | null) {
  const normalizedSourceId = normalizeRouteSourceId(sourceId);

  return (
    state.telegram.availableChats?.find((chat) => normalizeRouteSourceId(chat.id) === normalizedSourceId)?.name ||
    normalizedSourceId ||
    'Nenhuma origem escolhida'
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail
}: {
  icon: typeof Gauge;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--muted)]">{label}</span>
        <Icon size={18} className="text-[var(--accent)]" />
      </div>
      <strong className="mt-4 block text-3xl font-semibold">{formatNumber(value)}</strong>
      <p className="mt-2 text-xs text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function PlanUsageCard({
  title,
  planLabel,
  description,
  items,
  featureBadges
}: {
  title: string;
  planLabel: string;
  description: string;
  items: Array<{
    label: string;
    used: number;
    limit: number;
    detail: string;
  }>;
  featureBadges: Array<{
    label: string;
    enabled: boolean;
    value?: string;
  }>;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{title}</p>
          <h2 className="mt-1 text-xl font-semibold">{planLabel}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
          Plano ativo
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {items.map((item) => {
          const safeLimit = Math.max(1, item.limit || 0);
          const percent = Math.max(0, Math.min(100, Math.round((item.used / safeLimit) * 100)));

          return (
            <article key={item.label} className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{item.label}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                  {item.used}/{item.limit}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#25D366,#229ED9)] transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {featureBadges.map((feature) => (
          <span
            key={feature.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold',
              feature.enabled
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/5 text-[var(--muted)]'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', feature.enabled ? 'bg-[#25D366]' : 'bg-[var(--warning)]')} />
            {feature.label}
            {feature.value ? `: ${feature.value}` : feature.enabled ? ' liberado' : ' bloqueado'}
          </span>
        ))}
      </div>
    </section>
  );
}

const inputClass =
  'h-[58px] w-full rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 text-base text-[#F8FAFC] outline-none transition placeholder:text-[#6D7C75] hover:border-[rgba(255,255,255,0.14)] focus:border-[#25D366] focus:bg-[rgba(255,255,255,0.05)] focus:ring-2 focus:ring-[rgba(37,211,102,0.14)]';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60';

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';

      if (!result) {
        reject(new Error('não foi possivel ler a imagem selecionada.'));
        return;
      }

      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error('não foi possivel ler a imagem selecionada.'));
    };

    reader.readAsDataURL(file);
  });
}


