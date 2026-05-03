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
  LogOut,
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
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const panelVersion = 'Versao 0.70';

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
};

type AffiliateAccount = {
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
    groupsRefreshing?: boolean;
    groupRefreshProgress?: {
      total?: number;
      processed?: number;
      percent?: number;
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
    message?: string;
    canReconnect?: boolean;
    canResetSession?: boolean;
  } | null;
};

type ViewKey = 'overview' | 'connections' | 'groups' | 'affiliate' | 'activity' | 'account' | 'admin';

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Gauge }> = [
  { key: 'overview', label: 'Dashboard', icon: Gauge },
  { key: 'connections', label: 'Config. Telegram', icon: Settings2 },
  { key: 'groups', label: 'Config. WhatsApp', icon: Users },
  { key: 'affiliate', label: 'Config. Afiliados', icon: CreditCard },
  { key: 'activity', label: 'Historico', icon: Activity },
  { key: 'account', label: 'Conta', icon: User },
  { key: 'admin', label: 'Admin', icon: Shield }
];

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && state.auth.user?.role !== 'admin';
}

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<ViewKey>('overview');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [affiliateAutomationEditing, setAffiliateAutomationEditing] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.sessionStorage.getItem('affiliate-automation-editing') === 'true';
  });

  async function loadState() {
    const nextState = await requestJson<AppState>('/api/state');
    setState(nextState);
  }

  useEffect(() => {
    void loadState();
    const timer = window.setInterval(() => {
      if (view === 'affiliate' && affiliateAutomationEditing) {
        return;
      }

      void loadState().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [view, affiliateAutomationEditing]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem('affiliate-automation-editing', affiliateAutomationEditing ? 'true' : 'false');
  }, [affiliateAutomationEditing]);

  useEffect(() => {
    if (!state?.auth.authenticated) {
      setView('overview');
    }
  }, [state?.auth.authenticated]);

  if (!state) {
    return <LoadingScreen />;
  }

  if (!state.auth.authenticated) {
    return (
        <AuthScreen
          googleEnabled={state.auth.googleEnabled}
          onAuthenticated={async () => {
            setView('overview');
            await loadState();
          }}
          notice={notice || state.auth.error || ''}
          setNotice={setNotice}
        />
      );
    }

  const isAdmin = state.auth.user?.role === 'admin';
  const readOnlyAccount = isReadOnlyAccount(state);

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
            state={state}
            onLogout={async () => {
              setView('overview');
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
            <Overview state={state} setNotice={setNotice} setBusy={setBusy} busy={busy} refresh={loadState} />
          ) : null}
          {view === 'connections' ? (
            <Connections state={state} setNotice={setNotice} setBusy={setBusy} busy={busy} refresh={loadState} />
          ) : null}
          {view === 'groups' ? (
            <Groups
              state={state}
              filter={groupFilter}
              setFilter={setGroupFilter}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
            />
          ) : null}
          {view === 'affiliate' ? (
            <AffiliateAutomationPanel
              state={state}
              setNotice={setNotice}
              setBusy={setBusy}
              busy={busy}
              refresh={loadState}
              isAutomationEditing={affiliateAutomationEditing}
              setAutomationEditing={setAffiliateAutomationEditing}
            />
          ) : null}
          {view === 'activity' ? <ActivityLog state={state} /> : null}
          {view === 'account' ? <AccountPanel state={state} refresh={loadState} setNotice={setNotice} /> : null}
          {view === 'admin' && isAdmin ? <AdminPanel state={state} refresh={loadState} setNotice={setNotice} /> : null}
        </section>
      </div>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-5 py-4 text-sm text-[var(--muted)]">
        Carregando painel...
      </div>
    </main>
  );
}

function ReadOnlyModeBanner() {
  return (
    <div className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-50">
      <span className="font-semibold">Conta em teste:</span> este acesso esta em modo somente leitura. Voce pode navegar pelos paineis, mas edicoes e configuracoes precisam ser liberadas pelo administrador.
    </div>
  );
}

function AvatarBadge({
  user,
  size = 'lg'
}: {
  user: Partial<Pick<AuthUser, 'name' | 'email' | 'avatarUrl'>> | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'sm'
      ? 'h-10 w-10 rounded-xl'
      : size === 'md'
        ? 'h-10 w-10 rounded-2xl'
        : 'h-20 w-20 rounded-[24px]';
  const iconClass = size === 'lg' ? 'h-10 w-10' : 'h-5 w-5';
  const initials = String(user?.name || user?.email || 'PA')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-emerald-400/20 bg-black/25 text-sm font-semibold text-emerald-50 shadow-[0_0_24px_rgba(43,214,140,0.15)]',
        sizeClass
      )}
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name || 'Avatar'} className="h-full w-full object-cover" />
      ) : (
        <span className="flex items-center justify-center">
          {initials || <User className={iconClass} />}
        </span>
      )}
    </div>
  );
}

function AuthScreen({
  googleEnabled,
  onAuthenticated,
  notice,
  setNotice
}: {
  googleEnabled: boolean;
  onAuthenticated: () => Promise<void>;
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
      await postJson(mode === 'login' ? '/api/auth/login' : '/api/auth/register', payload);
      await onAuthenticated();
      setNotice('Login realizado com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel continuar.');
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
                  Operacao real com <span className="text-[#25D366]">Telegram</span> + <span className="text-[#229ED9]">WhatsApp</span> + afiliados
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
                    Sua oferta nasce no Telegram,
                    <br />
                    passa pelo painel
                    <br />
                    <span className="bg-[linear-gradient(90deg,#25D366,#229ED9)] bg-clip-text text-transparent">e chega pronta no WhatsApp.</span>
                  </h1>

                  <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#AAB8B0] max-sm:text-base max-sm:leading-7">
                    Configure a origem no Telegram, selecione os destinos no WhatsApp, acompanhe status de sessao, historico, testes manuais e, quando quiser, ative o modulo de afiliados para converter links Amazon e preparar a operacao com Shopee.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-[rgba(37,211,102,0.18)] bg-[linear-gradient(135deg,rgba(8,34,24,0.9),rgba(6,24,17,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                    <Rocket size={19} className="text-[#25D366]" />
                  </div>
                  <p className="text-base leading-7 text-[#DBEAE1]">
                    O cliente escolhe um grupo de origem no Telegram, define quais grupos de WhatsApp vao receber a mensagem, testa o fluxo antes de ativar e acompanha tudo no painel. Nao e gambiarra de disparo: e operacao guiada, com controle real de origem, destino e entrega.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(7,26,18,0.92),rgba(4,18,13,0.96))] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#5DE0A0]">Central de operacao</p>
                  <h2 className="mt-3 max-w-lg text-[2.3rem] font-semibold leading-[1.04] text-[#F8FAFC] max-sm:text-[1.9rem]">
                    Tudo o que sua ponte precisa, no mesmo painel.
                  </h2>
                  <p className="mt-3 max-w-lg text-[0.98rem] leading-7 text-[#AAB8B0]">
                    O Portal do Afiliado conecta a conta do Telegram, mantem a sessao do WhatsApp, organiza grupos de destino, registra historico, oferece teste manual e abre um fluxo separado para automacao de afiliados. A equipe sabe o que entrou, o que saiu e o que realmente foi entregue.
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
                    <span className="text-[#8FA69C]">Telegram comum, ponte para WhatsApp e automacao de afiliados trabalham com regras separadas, sem misturar fluxos e sem perder rastreabilidade.</span>
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
                        <p className="mt-1 text-sm text-[#DCE9E2]">Fluxos ativos em acompanhamento</p>
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
                        <span>Fila de entrega acompanhada</span>
                        <span>Painel em tempo real</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2">
                      <AuthDashboardRow label="Mensagens monitoradas" value="29.300" />
                      <AuthDashboardRow label="Envios concluidos" value="4.190" />
                      <AuthDashboardRow label="Links convertidos" value="1.284" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <AuthMiniSignal
                        icon={Smartphone}
                        title="WhatsApp"
                        detail="Sessao valida"
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
                  title="Telegram como origem oficial"
                  text="Escolha exatamente qual grupo ou canal sera monitorado. A ponte trabalha a partir dessa origem, com fluxo claro e sem improviso."
                />
                <AuthBenefitCard
                  icon={Clock3}
                  iconClassName="text-[#229ED9]"
                  title="Teste antes de ativar"
                  text="Simule mensagens, revise a saida final e ative a automacao quando a operacao estiver redonda. Mais previsibilidade, menos tentativa no escuro."
                />
                <AuthBenefitCard
                  icon={ShieldCheck}
                  iconClassName="text-[#76E599]"
                  title="Afiliados sem remendo manual"
                  text="Converta links Amazon, prepare o fluxo para Shopee e mantenha o modulo de afiliados separado da ponte comum Telegram para WhatsApp."
                />
              </div>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-[rgba(37,211,102,0.16)] bg-[linear-gradient(180deg,rgba(8,29,21,0.9),rgba(4,18,13,0.96))] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.24)] lg:grid-cols-3">
                <AuthTrustItem
                  icon={TrendingUp}
                  title="Historico auditavel"
                  label="consulte o que entrou, o que foi processado, para onde saiu e quando aconteceu."
                  accentClassName="text-[#25D366]"
                />
                <AuthTrustItem
                  icon={ShieldCheck}
                  title="Sessoes e conexoes visiveis"
                  label="o painel mostra o estado do Telegram e do WhatsApp para a equipe agir rapido quando precisar."
                  accentClassName="text-[#77E6A0]"
                />
                <AuthTrustItem
                  icon={Users}
                  title="Operacao pronta para cliente"
                  label="conta, perfil, admin, suspensao, grupos, afiliados e historico no mesmo ambiente."
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
                  Entre no painel para configurar sua origem no Telegram, os destinos no WhatsApp, acompanhar sessoes, rodar testes e ativar o modulo de afiliados quando fizer sentido para sua operacao.
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
              <Field label="E-mail" name="email" placeholder="voce@empresa.com" autoComplete="email" icon={Mail} />
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
                  onClick={() => setNotice('Recuperacao de senha estara disponivel em breve.')}
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
                Login com Google estara disponivel em breve.
              </p>
            )}

            <div className="mt-8 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                  <ShieldCheck size={18} className="text-[#46E285]" />
                </div>
                <p className="text-base text-[#C5D4CD]">Um oferecimento MC8MB e BAD MEME VIBES.</p>
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

function Topbar({
  state,
  onLogout
}: {
  state: AppState;
  onLogout: () => Promise<void>;
}) {
  const hasTelegramSource = Boolean(state.config.telegramChannel);
  const hasWhatsAppDestination = (state.config.selectedGroupIds?.length || 0) > 0;
  const whatsAppConnected = isWhatsAppConnectedStatus(state.whatsAppStatus);
  const canEnableAutomation = state.telegramStatus === 'listening' && state.whatsAppStatus === 'ready';
  const effectiveBridgeEnabled = state.config.bridgeEnabled && canEnableAutomation;

  return (
    <header className="mb-5 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
      <div className="min-w-0">
        <p className="text-sm text-[var(--muted)]">Central operacional</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold">Portal do Afiliado</h1>
          <CompactSetupChecklist
            steps={[
              { label: 'Telegram', done: state.telegramStatus === 'listening' },
              { label: 'WhatsApp', done: whatsAppConnected },
              { label: 'Origem', done: hasTelegramSource },
              { label: 'Destino', done: hasWhatsAppDestination },
              { label: 'Ativo', done: effectiveBridgeEnabled, ready: !effectiveBridgeEnabled && canEnableAutomation }
            ]}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 max-sm:flex-wrap">
        <StatusBadge label="Telegram" value={state.telegramStatus} />
        <StatusBadge label="WhatsApp" value={state.whatsAppStatus} />
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-white/5"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </header>
  );
}

function Overview({
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
  const progress = state.metrics.groupRefreshProgress;
  const canEnableAutomation = state.telegramStatus === 'listening' && state.whatsAppStatus === 'ready';
  const effectiveBridgeEnabled = state.config.bridgeEnabled && canEnableAutomation;
  const whatsappDestinationsUsed = state.config.selectedGroupIds?.length || 0;
  const automationLockReason =
    state.telegramStatus !== 'listening'
      ? 'Conecte e conclua o login no Telegram para liberar a automacao.'
      : state.whatsAppStatus !== 'ready'
        ? 'Conecte o WhatsApp e aguarde o status ficar pronto para liberar a automacao.'
        : '';
  const groupProgressText =
    state.metrics.groupsRefreshing && progress?.total
      ? `${progress.processed || 0}/${progress.total} grupos (${progress.percent || 0}%)`
      : `${state.metrics.availableAdminGroupCount || 0} grupos disponiveis`;

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
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
            <h2 className="mt-4 text-2xl font-semibold">Operacao da ponte</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Acompanhe a saude das conexoes, controle a automacao e valide se as mensagens estao fluindo.
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Automacao ativa</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {effectiveBridgeEnabled
                    ? 'A ponte pode encaminhar mensagens normalmente.'
                    : state.config.bridgeEnabled
                      ? 'A automacao foi pausada porque nem todas as conexoes estao prontas.'
                    : canEnableAutomation
                      ? 'As mensagens recebidas ficam sem encaminhamento ate voce ligar de novo.'
                      : automationLockReason}
                </p>
              </div>
              <SystemPowerSwitch
                checked={effectiveBridgeEnabled}
                disabled={readOnlyAccount || busy === 'power' || !canEnableAutomation}
                onChange={async (nextValue) => {
                  if (readOnlyAccount) {
                    setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
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
                Conta em teste: a automacao fica somente para visualizacao ate o administrador liberar.
              </p>
            ) : !canEnableAutomation ? (
              <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                O interruptor sera liberado assim que Telegram e WhatsApp estiverem conectados.
              </p>
            ) : null}

            {isAdmin ? (
              <button
                type="button"
                disabled={readOnlyAccount || busy === 'reset-all'}
                onClick={async () => {
                  const confirmed = window.confirm(
                    'Isso vai limpar Telegram, WhatsApp, grupos selecionados e desligar a automacao. Deseja continuar?'
                  );

                  if (!confirmed) {
                    return;
                  }

                  setBusy('reset-all');
                  await postJson('/api/connections/reset-all');
                  await refresh();
                  setNotice('Conexoes resetadas. Agora voce pode configurar tudo de novo.');
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

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr] max-xl:grid-cols-1">
        <PlanUsageCard
          title="Plano e limites"
          planLabel={state.planLimits?.label || humanize(state.auth.user?.plan || 'starter')}
          description="Acompanhe o que esta liberado no seu plano e quanto da estrutura atual ja esta em uso."
          items={[
            {
              label: 'Destinos WhatsApp',
              used: whatsappDestinationsUsed,
              limit: state.planLimits?.whatsappDestinations || 0,
              detail: `${whatsappDestinationsUsed} grupo(s) selecionado(s) no Config. WhatsApp`
            },
            {
              label: 'Origens Telegram',
              used: state.config.telegramChannel ? 1 : 0,
              limit: state.planLimits?.telegramSources || 0,
              detail: state.config.telegramChannel ? 'Uma origem ativa no fluxo atual' : 'Nenhuma origem salva no momento'
            },
            {
              label: 'Automacoes de afiliados',
              used: state.affiliate?.automations?.length || 0,
              limit: state.planLimits?.affiliateAutomations || 0,
              detail:
                (state.affiliate?.automations?.length || 0) > 0
                  ? `${state.affiliate?.automations?.length || 0} regra(s) criada(s)`
                  : 'Nenhuma automacao criada ainda'
            }
          ]}
          featureBadges={[
            { label: 'Amazon', enabled: Boolean(state.planLimits?.amazonAffiliate) },
            { label: 'Shopee', enabled: Boolean(state.planLimits?.shopeeAffiliate) },
            { label: 'Historico', enabled: Boolean((state.planLimits?.historyDays || 0) > 1), value: `${state.planLimits?.historyDays || 0} dias` },
            { label: 'Mensagens/dia', enabled: true, value: formatNumber(state.planLimits?.dailyMessages || 0) }
          ]}
        />

        <section className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Metric icon={MessageSquare} label="Telegram" value={state.metrics.totalTelegramReceived || 0} detail={lastLabel(state.metrics.lastTelegramMessageAt)} />
          <Metric icon={Send} label="Encaminhadas" value={state.metrics.totalForwardedMessages || 0} detail={lastLabel(state.metrics.lastForwardedAt)} />
          <Metric icon={Users} label="Grupos" value={state.metrics.selectedGroupCount || 0} detail={groupProgressText} />
        </section>
      </section>

      <section className="grid grid-cols-[1fr_360px] gap-5 max-xl:grid-cols-1">
        <OffersPanel state={state} compact refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
        <ConnectionSummary state={state} refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
      </section>

      <ActivityLog state={state} compact />
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
            Isso limpa apenas a visualizacao do painel. Suas cotas, metricas reais e historico tecnico continuam intactos.
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
                  setNotice?.('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
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
                  setNotice?.(error instanceof Error ? error.message : 'Nao foi possivel limpar o painel.');
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

function Connections({
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
  const [telegramChannel, setTelegramChannel] = useState(state.config.telegramChannel || '');
  const [telegramApiId, setTelegramApiId] = useState(state.config.telegramApiId || '');
  const [telegramApiHash, setTelegramApiHash] = useState(state.config.telegramApiHash || '');
  const [telegramPhone, setTelegramPhone] = useState(state.config.telegramPhone || '');
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramPassword, setTelegramPassword] = useState('');
  const hasSavedCredentials = Boolean(state.config.telegramApiId && state.config.telegramApiHash && state.config.telegramPhone);
  const hasTelegramSession = Boolean(state.config.hasTelegramSession || state.telegramStatus === 'listening');
  const activeAffiliateAutomation = state.affiliate?.automations?.[0] || null;
  const savedAffiliateSource = activeAffiliateAutomation?.isActive ? activeAffiliateAutomation.telegramSourceGroupId || '' : '';
  const savedTelegramFlow: 'bridge' | 'affiliate' = savedAffiliateSource ? 'affiliate' : 'bridge';
  const hasSavedSource = Boolean(state.config.telegramChannel || savedAffiliateSource);
  const [telegramFlow, setTelegramFlow] = useState<'bridge' | 'affiliate'>(savedTelegramFlow);
  const [affiliateTelegramChannel, setAffiliateTelegramChannel] = useState(savedAffiliateSource);
  const [credentialsEditing, setCredentialsEditing] = useState(!hasSavedCredentials);
  const [sourceEditing, setSourceEditing] = useState(!hasSavedSource);
  const credentialsEditingRef = useRef(credentialsEditing);
  const sourceEditingRef = useRef(sourceEditing);
  const previousTelegramSessionRef = useRef(hasTelegramSession);

  useEffect(() => {
    credentialsEditingRef.current = credentialsEditing;
  }, [credentialsEditing]);

  useEffect(() => {
    sourceEditingRef.current = sourceEditing;
  }, [sourceEditing]);

  function restoreSavedCredentials() {
    setTelegramApiId(state.config.telegramApiId || '');
    setTelegramApiHash(state.config.telegramApiHash || '');
    setTelegramPhone(state.config.telegramPhone || '');
  }

  function restoreSavedSource() {
    setTelegramChannel(state.config.telegramChannel || '');
    setAffiliateTelegramChannel(savedAffiliateSource);
    setTelegramFlow(savedTelegramFlow);
  }

  useEffect(() => {
    const telegramSessionJustConnected = !previousTelegramSessionRef.current && hasTelegramSession;
    previousTelegramSessionRef.current = hasTelegramSession;

    if (!sourceEditingRef.current) {
      setTelegramChannel(state.config.telegramChannel || '');
      setAffiliateTelegramChannel(savedAffiliateSource);
      setTelegramFlow(savedTelegramFlow);
    }

    if (!credentialsEditingRef.current) {
      setTelegramApiId(state.config.telegramApiId || '');
      setTelegramApiHash(state.config.telegramApiHash || '');
      setTelegramPhone(state.config.telegramPhone || '');
    }

    if (telegramSessionJustConnected) {
      setCredentialsEditing(false);
    } else if (!hasSavedCredentials) {
      setCredentialsEditing(true);
    }

    if (!hasSavedSource) {
      setSourceEditing(true);
    }
  }, [
    state.config.telegramChannel,
    state.config.telegramApiId,
    state.config.telegramApiHash,
    state.config.telegramPhone,
    savedAffiliateSource,
    savedTelegramFlow,
    hasSavedCredentials,
    hasTelegramSession,
    hasSavedSource
  ]);

  useEffect(() => {
    if (state.telegram.authPhase !== 'password_required') {
      setTelegramPassword('');
    }

    if (state.telegram.authPhase === 'idle' || state.telegram.authPhase === 'auth_required') {
      setTelegramCode('');
    }
  }, [state.telegram.authPhase]);

  const authPhase = state.telegram.authPhase || 'idle';
  const telegramStatusLabel = humanize(state.telegramStatus || 'not_configured');
  const telegramUserLabel = state.telegram.user?.name
    ? state.telegram.user.name + (state.telegram.user.username ? ` (${state.telegram.user.username})` : '')
    : '';
  const hasTelegramConnection = state.telegramStatus === 'listening' || Boolean(state.telegram.user?.name);
  const canChooseTelegramSource = hasTelegramConnection;
  const canUseAuthStep = hasSavedCredentials && !credentialsEditing && !hasTelegramSession;
  const credentialsLocked = hasTelegramSession || (!credentialsEditing && hasSavedCredentials);
  const selectedWhatsAppDestinations = state.groups
    .filter((group) => (state.config.selectedGroupIds || []).includes(group.id))
    .map((group) => ({ whatsappGroupId: group.id, whatsappGroupName: group.name }));
  const selectedWhatsAppDestinationCount = selectedWhatsAppDestinations.length;
  const selectedRouteSource = telegramFlow === 'bridge' ? telegramChannel : affiliateTelegramChannel;
  const telegramCodeSent = hasTelegramSession || authPhase === 'code_required' || authPhase === 'password_required';
  const telegramInternalChecklist = [
    { label: 'Salvar credenciais', done: hasSavedCredentials, ready: credentialsEditing && Boolean(telegramApiId && telegramApiHash && telegramPhone) },
    { label: 'Enviar codigo', done: telegramCodeSent, ready: canUseAuthStep },
    { label: 'Concluir login no Telegram', done: hasTelegramSession, ready: telegramCodeSent && !hasTelegramSession },
    { label: 'Escolher fluxo de origem', done: hasSavedSource, ready: hasTelegramSession && sourceEditing && Boolean(selectedRouteSource.trim()) }
  ];
  const telegramChecklistComplete = telegramInternalChecklist.every((step) => step.done);
  const telegramHeroStatusLabel = hasTelegramSession
    ? 'Sessao ativa'
    : authPhase === 'password_required'
      ? 'Senha pendente'
      : authPhase === 'code_required'
        ? 'Codigo pendente'
        : hasSavedCredentials
          ? 'Credenciais salvas'
          : 'Nao configurado';
  const telegramHeroSessionLabel = hasTelegramConnection
    ? telegramUserLabel || state.telegram.user?.phone || 'Sessao conectada'
    : 'Sessao de usuario';

  function getTelegramSourceName(sourceId: string) {
    const normalizedSourceId = normalizeRouteSourceId(sourceId);
    return (
      state.telegram.availableChats?.find((chat) => normalizeRouteSourceId(chat.id) === normalizedSourceId)?.name ||
      sourceId ||
      'Nenhuma origem escolhida'
    );
  }

  async function saveTelegramRoute() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
      return;
    }

    if (!selectedRouteSource.trim()) {
      setNotice('Escolha uma origem do Telegram antes de salvar o fluxo.');
      return;
    }

    setBusy('save-source');

    try {
      if (telegramFlow === 'bridge') {
        if (activeAffiliateAutomation?.id && activeAffiliateAutomation.isActive) {
          await postJson(`/api/affiliate/automations/${activeAffiliateAutomation.id}/toggle`, { isActive: false });
        }

        await postJson('/api/settings', {
          telegramMode: 'user',
          telegramChannel,
          telegramApiId,
          telegramApiHash,
          telegramPhone,
          telegramBotToken: ''
        });
        setNotice('Ponte Telegram -> WhatsApp salva. O automatizador de ofertas foi desativado para evitar conflito.');
      } else {
        const sourceName = getTelegramSourceName(affiliateTelegramChannel);

        await postJson('/api/settings', {
          telegramMode: 'user',
          telegramChannel: '',
          telegramApiId,
          telegramApiHash,
          telegramPhone,
          telegramBotToken: ''
        });

        await postJson('/api/affiliate/automations', {
          id: activeAffiliateAutomation?.id || undefined,
          name: activeAffiliateAutomation?.name || 'Automatizador de Ofertas',
          telegramSourceGroupId: affiliateTelegramChannel,
          telegramSourceGroupName: sourceName,
          destinations: selectedWhatsAppDestinations,
          unknownLinkBehavior: activeAffiliateAutomation?.unknownLinkBehavior || 'keep',
          customFooter: activeAffiliateAutomation?.customFooter || '',
          removeOriginalFooter: Boolean(activeAffiliateAutomation?.removeOriginalFooter),
          isActive: true
        });
        setNotice('Automatizador de Ofertas salvo. A ponte simples foi desligada para evitar envio duplicado.');
      }

      await refresh();
      setSourceEditing(false);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid grid-cols-[1fr_380px] gap-5 max-xl:grid-cols-1">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.08),transparent_26%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Telegram</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                  <MessageSquare size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Central do Telegram</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    Conecte sua conta, valide o codigo de acesso e defina qual fluxo do Telegram vai alimentar sua operacao com seguranca.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100">
                {telegramHeroStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {telegramHeroSessionLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-6 max-sm:px-4">
          <InternalSetupChecklist
            title="Checklist do Config. Telegram"
            steps={telegramInternalChecklist}
            complete={telegramChecklistComplete}
            completeLabel="Telegram 100% configurado"
          />

          <section className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
          <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Etapa 1</p>
              <h3 className="mt-1 text-lg font-semibold">Entrar na conta do Telegram</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                Primeiro conecte sua conta. Depois a tela libera a escolha do grupo ou canal monitorado.
              </p>
            </div>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
              {telegramStatusLabel}
            </span>
          </div>

          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (readOnlyAccount) {
                setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
                return;
              }
              setBusy('settings');
              await postJson('/api/settings', {
                telegramMode: 'user',
                telegramChannel,
                telegramApiId,
                telegramApiHash,
                telegramPhone,
                telegramBotToken: ''
              });
              await refresh();
              setNotice('Credenciais do Telegram salvas.');
              setCredentialsEditing(false);
              setBusy('');
            }}
          >
            <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Modo de conexao</p>
              <p className="mt-1 text-sm font-semibold">Sessao de usuario</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="API ID" value={telegramApiId} onChange={setTelegramApiId} placeholder="12345678" disabled={readOnlyAccount || credentialsLocked} />
              <Field label="API Hash" value={telegramApiHash} onChange={setTelegramApiHash} placeholder="Cole o API Hash" disabled={readOnlyAccount || credentialsLocked} />
              <Field label="Telefone" value={telegramPhone} onChange={setTelegramPhone} placeholder="+55 21 99999-9999" disabled={readOnlyAccount || credentialsLocked} />
            </div>

            <div className="flex flex-wrap gap-2">
              {credentialsEditing || !hasSavedCredentials ? (
                <button
                  type="submit"
                  disabled={readOnlyAccount || busy === 'settings' || hasTelegramSession}
                  className={primaryButton}
                >
                  Salvar credenciais
                </button>
              ) : (
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'settings' || hasTelegramSession}
                  className={primaryButton}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    restoreSavedCredentials();
                    setTelegramCode('');
                    setTelegramPassword('');
                    setCredentialsEditing(true);
                  }}
                >
                  Editar credenciais
                </button>
              )}
              </div>
            </form>

            <>
              <div className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr]">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-send-code' || busy === 'settings' || !canUseAuthStep}
                  onClick={async () => {
                    setBusy('telegram-send-code');
                    await postJson('/api/settings', {
                      telegramMode: 'user',
                      telegramChannel,
                      telegramApiId,
                      telegramApiHash,
                      telegramPhone,
                      telegramBotToken: ''
                    });
                    await postJson('/api/telegram/send-code');
                    await refresh();
                    setNotice('Codigo enviado para o Telegram.');
                    setBusy('');
                  }}
                  className={primaryButton}
                >
                  Enviar codigo
                </button>

                <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                  <Field
                    label="Codigo recebido"
                    value={telegramCode}
                    onChange={setTelegramCode}
                    placeholder="Digite o codigo do Telegram"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase === 'auth_required' || authPhase === 'idle'}
                  />
                  <Field
                    label="Senha em duas etapas"
                    value={telegramPassword}
                    onChange={setTelegramPassword}
                    placeholder="Preencha apenas se o Telegram pedir"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase !== 'password_required'}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-complete-auth' || (authPhase !== 'code_required' && authPhase !== 'password_required')}
                  onClick={async () => {
                    setBusy('telegram-complete-auth');
                    await postJson('/api/telegram/complete-auth', {
                      code: telegramCode,
                      password: telegramPassword
                    });
                    await refresh();
                    setNotice(
                      authPhase === 'password_required'
                        ? 'Senha enviada. Conta do Telegram conectada.'
                        : 'Login do Telegram concluido.'
                    );
                    setBusy('');
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-400 disabled:opacity-60"
                >
                  {authPhase === 'password_required' ? 'Enviar senha em duas etapas' : 'Concluir login no Telegram'}
                </button>
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-disconnect' || !hasSavedCredentials}
                  onClick={async () => {
                    setBusy('telegram-disconnect');
                    await postJson('/api/telegram/disconnect');
                    setTelegramApiId('');
                    setTelegramApiHash('');
                    setTelegramPhone('');
                    setTelegramChannel('');
                    setTelegramCode('');
                    setTelegramPassword('');
                    await refresh();
                    setNotice('Telegram desconectado e configuracoes removidas.');
                    setBusy('');
                  }}
                  className={secondaryButton}
                >
                  Desconectar Telegram
                </button>
              </div>

              <p className="mt-4 text-sm text-[var(--muted)]">
                {telegramUserLabel
                  ? `Conta conectada: ${telegramUserLabel}.`
                  : authPhase === 'password_required'
                    ? 'O Telegram pediu a senha em duas etapas para concluir a conexao.'
                    : authPhase === 'code_required'
                      ? 'Digite o codigo enviado para concluir a conexao.'
                      : authPhase === 'auth_required'
                        ? 'Envie um codigo para iniciar a conexao da sua conta.'
                    : 'Sua sessao do Telegram ficara salva para reconectar depois sem bot.'}
              </p>
            </>
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-black/10 p-4">
          <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Etapa 2</p>
              <h3 className="mt-1 text-lg font-semibold">Escolher fluxo e origem do Telegram</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                Escolha se esta conta vai apenas repostar mensagens ou se vai tratar ofertas com links de afiliado. Um fluxo fica ativo por vez para evitar envio duplicado.
              </p>
            </div>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
              {canChooseTelegramSource ? 'Liberado' : 'Aguardando login'}
            </span>
          </div>

          {canChooseTelegramSource ? (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <div
                  className={`rounded-2xl border p-4 transition ${
                    telegramFlow === 'bridge'
                      ? 'border-emerald-400/50 bg-emerald-400/10 shadow-[0_18px_45px_rgba(16,185,129,0.08)]'
                      : 'border-[var(--border)] bg-black/10'
                  } ${!sourceEditing ? 'opacity-80' : ''}`}
                >
                  <button
                    type="button"
                    disabled={readOnlyAccount || !sourceEditing}
                    onClick={() => setTelegramFlow('bridge')}
                    className="w-full text-left disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">Bloco 1</p>
                        <h4 className="mt-1 text-base font-semibold">Ponte Telegram -&gt; WhatsApp</h4>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${telegramFlow === 'bridge' ? 'bg-emerald-400/15 text-emerald-100' : 'bg-white/5 text-[var(--muted)]'}`}>
                        {telegramFlow === 'bridge' ? 'Selecionado' : 'Escolher'}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      Reposta a mensagem exatamente como chegou no Telegram para os destinos configurados no WhatsApp.
                    </p>
                  </button>

                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2 text-sm font-semibold">
                      Origem da ponte
                      <select
                        value={telegramChannel}
                        onChange={(event) => setTelegramChannel(event.target.value)}
                        className={inputClass}
                        disabled={readOnlyAccount || !sourceEditing || telegramFlow !== 'bridge'}
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
                      onChange={setTelegramChannel}
                      placeholder="-100..."
                      disabled={readOnlyAccount || !sourceEditing || telegramFlow !== 'bridge'}
                    />
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 transition ${
                    telegramFlow === 'affiliate'
                      ? 'border-cyan-300/50 bg-cyan-400/10 shadow-[0_18px_45px_rgba(34,158,217,0.08)]'
                      : 'border-[var(--border)] bg-black/10'
                  } ${!sourceEditing ? 'opacity-80' : ''}`}
                >
                  <button
                    type="button"
                    disabled={readOnlyAccount || !sourceEditing}
                    onClick={() => setTelegramFlow('affiliate')}
                    className="w-full text-left disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Bloco 2</p>
                        <h4 className="mt-1 text-base font-semibold">Automatizador de Ofertas</h4>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${telegramFlow === 'affiliate' ? 'bg-cyan-400/15 text-cyan-100' : 'bg-white/5 text-[var(--muted)]'}`}>
                        {telegramFlow === 'affiliate' ? 'Selecionado' : 'Escolher'}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      Le a oferta, converte links elegiveis com a configuracao de afiliados e envia a mensagem final aos destinos do WhatsApp.
                    </p>
                  </button>

                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2 text-sm font-semibold">
                      Origem das ofertas
                      <select
                        value={affiliateTelegramChannel}
                        onChange={(event) => setAffiliateTelegramChannel(event.target.value)}
                        className={inputClass}
                        disabled={readOnlyAccount || !sourceEditing || telegramFlow !== 'affiliate'}
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
                      onChange={setAffiliateTelegramChannel}
                      placeholder="-100..."
                      disabled={readOnlyAccount || !sourceEditing || telegramFlow !== 'affiliate'}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 px-4 py-3">
                <p className="text-sm font-semibold">
                  Rota atual: {telegramFlow === 'bridge' ? 'Ponte Telegram -> WhatsApp' : 'Automatizador de Ofertas'}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Plano atual liberado para 1 origem neste fluxo. Os destinos usados sao os {selectedWhatsAppDestinationCount} grupo(s) escolhidos em Config. WhatsApp.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={readOnlyAccount || busy === 'save-source' || (sourceEditing && !selectedRouteSource.trim())}
                    onClick={async () => {
                      if (!sourceEditing) {
                        restoreSavedSource();
                        setSourceEditing(true);
                        return;
                      }

                      await saveTelegramRoute();
                    }}
                    className={primaryButton}
                  >
                    {sourceEditing || !hasSavedSource ? 'Salvar fluxo' : 'Editar fluxo'}
                  </button>
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-chats'}
                  onClick={async () => {
                    setBusy('telegram-chats');
                    await postJson('/api/telegram/refresh-chats');
                    await refresh();
                    setNotice('Lista de grupos e canais do Telegram atualizada.');
                    setBusy('');
                  }}
                  className={secondaryButton}
                >
                  <RefreshCcw size={16} />
                  Atualizar origens
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-md border border-[var(--border)] bg-black/15 px-4 py-3 text-sm text-[var(--muted)]">
              Conclua o login do Telegram na etapa 1 para liberar o dropdown de origem.
            </p>
          )}
          </section>
        </div>
      </section>

      <ConnectionSummary state={state} refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
    </div>
  );
}

function Groups({
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
  const isAdmin = state.auth.user?.role === 'admin';
  const planLimits = state.planLimits;
  const whatsappDestinationLimit = planLimits?.whatsappDestinations ?? Number.POSITIVE_INFINITY;
  const hasWhatsAppDestinationLimit = Number.isFinite(whatsappDestinationLimit);
  const [showAdvancedActions, setShowAdvancedActions] = useState(false);
  const [selected, setSelected] = useState(new Set(state.config.selectedGroupIds));
  const [hasPendingSelectionChanges, setHasPendingSelectionChanges] = useState(false);
  const groupsProgress = state.metrics.groupRefreshProgress;
  const groupsPercent = Math.max(0, Math.min(100, groupsProgress?.percent || 0));
  const groupsProcessed = groupsProgress?.processed || 0;
  const groupsTotal = groupsProgress?.total || 0;
  const cachedAtLabel = state.metrics.groupCacheRefreshedAt
    ? formatDate(state.metrics.groupCacheRefreshedAt)
    : '';
  const whatsAppReady = state.whatsAppStatus === 'ready';
  const whatsAppConnected = isWhatsAppConnectedStatus(state.whatsAppStatus);
  const hasQrCode = Boolean(state.qrDataUrl);
  const whatsAppReconnecting = ['connecting', 'authenticated', 'reconnecting'].includes(String(state.whatsAppStatus || '').toLowerCase());
  const whatsAppStatusLabel = whatsAppConnected ? 'Conectado' : hasQrCode ? 'QR pronto' : whatsAppReconnecting ? 'Reconectando' : 'Sem sessao';
  const selectedGroups = useMemo(
    () => state.groups.filter((group) => selected.has(group.id)),
    [selected, state.groups]
  );
  const hasSavedDestinations = selectedGroups.length > 0;
  const whatsappInternalChecklist = [
    { label: 'Iniciar sessao', done: hasQrCode || whatsAppConnected, ready: whatsAppReconnecting || !whatsAppConnected },
    { label: 'Escanear QR Code', done: whatsAppConnected, ready: hasQrCode && !whatsAppConnected },
    { label: 'Atualizar grupos', done: Boolean(state.metrics.hasCachedGroups), ready: whatsAppConnected },
    { label: 'Salvar destinos', done: hasSavedDestinations, ready: Boolean(state.metrics.hasCachedGroups) && !hasSavedDestinations }
  ];
  const whatsappChecklistComplete = whatsappInternalChecklist.every((step) => step.done);
  const filteredGroups = useMemo(() => {
    const normalized = normalizeText(filter);
    return state.groups
      .filter((group) => normalizeText(group.name).includes(normalized))
      .sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
  }, [filter, selected, state.groups]);

  useEffect(() => {
    const nextSelected = new Set(state.config.selectedGroupIds);

    setSelected((currentSelected) => {
      if (hasPendingSelectionChanges && !areSameSet(currentSelected, nextSelected)) {
        return currentSelected;
      }

      if (areSameSet(currentSelected, nextSelected)) {
        return currentSelected;
      }

      return nextSelected;
    });

    if (hasPendingSelectionChanges && areSameSet(selected, nextSelected)) {
      setHasPendingSelectionChanges(false);
    }
  }, [hasPendingSelectionChanges, selected, state.config.selectedGroupIds]);

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
                    Conecte sua conta, acompanhe o QR Code e gerencie todos os grupos de destino em um fluxo unico, limpo e pronto para operacao.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                {whatsAppStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {state.whatsAppPhone || 'Sem sessao conectada'}
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
                    <p className="mt-1 text-base font-semibold">{whatsAppConnected ? 'Pronta para uso' : hasQrCode ? 'Aguardando leitura' : 'Nao conectada'}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  {whatsAppConnected ? 'Sessao autenticada e pronta para uso no painel.' : 'Use o QR Code ao lado para concluir a autenticacao da conta.'}
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
                  Grupos prontos para receber as mensagens encaminhadas pela ponte.
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
                  {state.metrics.groupsRefreshing ? 'Sincronizacao em andamento.' : 'Grupos detectados com acesso administrativo.'}
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
                    Use a reconexao para tentar recuperar a sessao sem apagar dados do cliente.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                    Operacao segura
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
                    setBusy('wa-reset');
                    await postJson('/api/whatsapp/reset-session');
                    await refresh();
                    setNotice('Nova sessao do WhatsApp preparada.');
                    setBusy('');
                  }}
                  className="group rounded-2xl border border-[var(--border)] bg-white/[0.03] px-4 py-4 text-left transition hover:border-sky-400/20 hover:bg-sky-400/[0.06] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-200 transition group-hover:scale-[1.02]">
                      <Bot size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Trocar conta</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">Gera uma nova sessao para autenticar outra conta.</p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'reset-all'}
                  onClick={async () => {
                    const confirmed = window.confirm(
                      'Isso vai esquecer Telegram, WhatsApp, grupos selecionados e desligar a automacao. Deseja continuar?'
                    );

                    if (!confirmed) {
                      return;
                    }

                    setBusy('reset-all');
                    await postJson('/api/connections/reset-all');
                    await refresh();
                    setNotice('Tudo foi resetado. O painel voltou ao estado inicial de conexao.');
                    setBusy('');
                  }}
                  className="group rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-4 py-4 text-left transition hover:bg-red-400/[0.12] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-100 transition group-hover:scale-[1.02]">
                      <Power size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-50">Reset completo</p>
                      <p className="mt-1 text-xs text-red-100/75">Limpa conexoes e volta o painel ao estado inicial.</p>
                    </div>
                  </div>
                </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(8,20,16,0.98),rgba(8,20,16,0.9))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">QR Code do WhatsApp</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {hasQrCode
                    ? 'Escaneie com o seu WhatsApp para concluir a autenticacao.'
                    : whatsAppConnected
                      ? 'Sua sessao ja esta conectada. O QR Code nao e mais necessario.'
                      : 'Quando uma nova autenticacao for exigida, o QR Code sera exibido aqui automaticamente.'}
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
                    ? 'Sessao autenticada com sucesso.'
                    : whatsAppReconnecting
                      ? 'Reconectando com a sessao salva. Se demorar, use Reconectar WhatsApp.'
                      : 'Nenhum QR Code disponivel no momento.'}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 px-4 py-3 text-xs leading-5 text-[var(--muted)]">
              Dica: mantenha esta tela aberta apenas quando for autenticar ou trocar a conta. Depois disso, basta gerenciar os grupos e deixar a automacao seguir normalmente.
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
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
                  ? `Verificando seus grupos administrados. ${groupsProcessed}/${groupsTotal} analisados ate agora.`
                  : 'Preparando a leitura dos grupos. Na primeira sincronizacao isso pode levar alguns minutos.'}
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
              {groupsTotal ? 'Leitura em andamento' : 'Iniciando sincronizacao'}
              {state.metrics.hasCachedGroups && cachedAtLabel ? ` · exibindo lista salva de ${cachedAtLabel}` : ''}
            </span>
            <span>{groupsTotal ? `${groupsProcessed} de ${groupsTotal} grupos verificados` : 'Aguardando contagem total'}</span>
          </div>
        </div>
      ) : null}

      {!state.metrics.groupsRefreshing && state.metrics.hasCachedGroups && cachedAtLabel ? (
        <div className="mb-4 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-[var(--muted)]">
          Ultima lista salva: <span className="font-semibold text-[var(--foreground)]">{cachedAtLabel}</span>. Voce pode usar essa lista imediatamente enquanto uma nova sincronizacao nao for necessaria.
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
                    setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
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
                        setNotice(`Seu plano permite ate ${whatsappDestinationLimit} destino(s) WhatsApp.`);
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

function ConnectionSummary({
  state,
  refresh,
  setNotice,
  setBusy,
  busy
}: {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Conexoes</p>
      <div className="mt-4 grid gap-3">
        <ConnectionRow icon={Bot} label="Telegram" status={state.telegramStatus} detail={state.telegram.user?.name || state.config.telegramChannel || 'Aguardando configuracao'} />
        <ConnectionRow icon={Smartphone} label="WhatsApp" status={state.whatsAppStatus} detail={state.whatsAppPhone || 'Sessao ainda nao conectada'} />
      </div>

      {state.issue?.message ? (
        <p className="mt-4 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
          {state.issue.message}
        </p>
      ) : null}
    </section>
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

function CompactSetupChecklist({
  steps
}: {
  steps: Array<{
    label: string;
    done: boolean;
    ready?: boolean;
  }>;
}) {
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-black/10 px-2 py-1.5">
      {steps.map((step, index) => (
        <span
          key={step.label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold transition',
            step.done
              ? 'bg-emerald-400/12 text-emerald-100'
              : step.ready
                ? 'bg-sky-400/12 text-sky-100'
                : 'text-[var(--muted)]'
          )}
          title={step.done ? `${step.label}: concluido` : step.ready ? `${step.label}: pronto` : `${step.label}: pendente`}
        >
          <span
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
              step.done
                ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-100'
                : step.ready
                  ? 'border-sky-400/30 bg-sky-400/15 text-sky-100'
                  : 'border-white/15 bg-white/5 text-[var(--muted)]'
            )}
          >
            {step.done ? <CheckCircle2 size={11} /> : index + 1}
          </span>
          <span className="max-sm:hidden">{step.label}</span>
        </span>
      ))}
      <span className="ml-1 rounded bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-100">
        {doneCount}/5
      </span>
    </div>
  );
}

function InternalSetupChecklist({
  title,
  steps,
  complete,
  completeLabel
}: {
  title: string;
  steps: Array<{
    label: string;
    done: boolean;
    ready?: boolean;
  }>;
  complete: boolean;
  completeLabel: string;
}) {
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section
      className={cn(
        'rounded-2xl border p-4 transition',
        complete
          ? 'border-emerald-300/40 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_34%),rgba(16,185,129,0.08)] shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_18px_45px_rgba(16,185,129,0.12)]'
          : 'border-[var(--border)] bg-black/10'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</p>
          <p className={cn('mt-1 text-sm font-semibold', complete ? 'text-emerald-100' : 'text-[var(--foreground)]')}>
            {complete ? completeLabel : 'Complete as etapas para liberar a configuracao.'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-bold',
            complete
              ? 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-300/30 animate-pulse'
              : 'bg-white/5 text-[var(--muted)] ring-1 ring-white/10'
          )}
        >
          {doneCount}/{steps.length}
        </span>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={cn(
              'rounded-xl border px-3 py-3 transition',
              step.done
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50'
                : step.ready
                  ? 'border-sky-400/25 bg-sky-400/10 text-sky-50'
                  : 'border-white/10 bg-white/[0.03] text-[var(--muted)]'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold',
                  step.done
                    ? 'border-emerald-300/40 bg-emerald-400/20 text-emerald-100'
                    : step.ready
                      ? 'border-sky-300/40 bg-sky-400/20 text-sky-100'
                      : 'border-white/15 bg-white/5 text-[var(--muted)]'
                )}
              >
                {step.done ? <CheckCircle2 size={14} /> : index + 1}
              </span>
              <p className="text-sm font-semibold">{step.label}</p>
            </div>
            <p className="mt-2 text-xs leading-5 opacity-80">
              {step.done ? 'Concluido' : step.ready ? 'Pronto para executar' : 'Pendente'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AffiliateAutomationPanel({
  state,
  setNotice,
  setBusy,
  busy,
  refresh,
  isAutomationEditing,
  setAutomationEditing
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
  isAutomationEditing: boolean;
  setAutomationEditing: (value: boolean) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const planLimits = state.planLimits;
  const affiliateAutomationLimit = planLimits?.affiliateAutomations ?? Number.POSITIVE_INFINITY;
  const affiliateModuleAllowed = affiliateAutomationLimit > 0;
  const whatsappDestinationLimit = planLimits?.whatsappDestinations ?? Number.POSITIVE_INFINITY;
  const affiliate = state.affiliate || { account: null, automations: [], logs: [], termsAccepted: false };
  const firstAutomation = affiliate.automations?.[0];
  const activeAutomation = firstAutomation;
  const automationFormRef = useRef<HTMLFormElement | null>(null);
  const telegramBridgeSourceId = normalizeRouteSourceId(state.config.telegramChannel);
  const affiliateSourceReservedByTelegram =
    Boolean(telegramBridgeSourceId) &&
    normalizeRouteSourceId(activeAutomation?.telegramSourceGroupId) === telegramBridgeSourceId;
  const [testMessage, setTestMessage] = useState('Monitor Gamer LG UltraGear 24\n\nCupom: QUINTOUU\nR$ 639,00 a vista\nhttps://amzn.to/3QdY360');
  const [testResult, setTestResult] = useState<{
    originalMessage: string;
    processedMessage: string;
    convertedUrls: AffiliateLog['convertedUrls'];
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!firstAutomation && !readOnlyAccount) {
      setAutomationEditing(true);
    }
  }, [firstAutomation, readOnlyAccount, setAutomationEditing]);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnlyAccount) {
      setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda nao inclui Automacao de Afiliados.`);
      return;
    }
    setBusy('affiliate-account');
    const form = new FormData(event.currentTarget);

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
    setNotice('Dados de afiliado salvos.');
    setBusy('');
  }

  async function submitAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnlyAccount) {
      setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda nao inclui Automacao de Afiliados.`);
      return;
    }
    setBusy('affiliate-automation');
    const form = new FormData(event.currentTarget);
    const sourceId = String(form.get('telegramSourceGroupId') ?? '');
    const source = state.telegram.availableChats?.find((chat) => chat.id === sourceId);
    const selectedDestinationIds = new Set(form.getAll('destinations').map(String));
    const destinations = state.groups
      .filter((group) => selectedDestinationIds.has(group.id))
      .map((group) => ({ whatsappGroupId: group.id, whatsappGroupName: group.name }));
    if (destinations.length > whatsappDestinationLimit) {
      setBusy('');
      setNotice(`Seu plano permite ate ${whatsappDestinationLimit} destino(s) WhatsApp por automacao.`);
      return;
    }

    await postJson('/api/affiliate/automations', {
      id: form.get('automationId') || undefined,
      name: form.get('name'),
      telegramSourceGroupId: sourceId,
      telegramSourceGroupName: source?.name || '',
      destinations,
      unknownLinkBehavior: form.get('unknownLinkBehavior'),
      customFooter: form.get('customFooter'),
      removeOriginalFooter: form.get('removeOriginalFooter') === 'on',
      isActive: activeAutomation?.isActive ?? true
    });

    await refresh();
    setNotice('Automacao de afiliados salva.');
    setAutomationEditing(false);
    setBusy('');
  }

  async function runManualTest() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda nao inclui Automacao de Afiliados.`);
      return;
    }

    setBusy('affiliate-test');
    const result = await postJson<typeof testResult>('/api/affiliate/test', {
      automationId: activeAutomation?.id || '',
      automation: activeAutomation || {
        name: 'Teste manual',
        telegramSourceGroupId: state.telegram.availableChats?.[0]?.id || '',
        unknownLinkBehavior: 'keep',
        removeOriginalFooter: false,
        customFooter: ''
      },
      message: testMessage
    });
    setTestResult(result);
    setNotice('Teste de conversao concluido.');
    setBusy('');
  }

  async function acceptTerms() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
      return;
    }

    setBusy('affiliate-terms');
    await postJson('/api/affiliate/terms/accept');
    await refresh();
    setNotice('Termo de uso aceito.');
    setBusy('');
  }

  const affiliatePrimaryButtonClass =
    'rounded-xl border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(37,211,102,0.96),rgba(34,158,217,0.92))] px-5 py-3 font-semibold text-slate-950 shadow-[0_14px_30px_rgba(25,140,102,0.28)] transition hover:-translate-y-[1px] hover:shadow-[0_18px_38px_rgba(25,140,102,0.36)] disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none';
  const affiliateSecondaryButtonClass =
    'rounded-xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(34,158,217,0.2))] px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-cyan-300/30 hover:bg-[linear-gradient(135deg,rgba(16,185,129,0.24),rgba(34,158,217,0.28))] hover:text-white disabled:opacity-60';

  return (
    <div className="grid gap-5">
      <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] max-sm:p-4">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Automacao de Afiliados</p>
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
            Banco de afiliados ainda nao preparado. Rode o SQL em scripts/supabase-affiliate-automation.sql no Supabase.
          </p>
        ) : null}

        {!affiliateModuleAllowed ? (
          <p className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            Seu plano {planLimits?.label || 'atual'} esta em modo ponte simples. Automacao de Afiliados entra a partir do plano Plus.
          </p>
        ) : null}

        {!affiliate.termsAccepted ? (
          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
            <p className="text-sm font-semibold text-amber-50">Aceite obrigatorio</p>
            <p className="mt-2 text-xs leading-5 text-amber-100/80">
              Declaro que tenho autorizacao para reutilizar, adaptar e republicar as mensagens monitoradas por esta automacao. Tambem sou responsavel pelos links de afiliado configurados e pelo cumprimento das politicas dos programas.
            </p>
            <button type="button" disabled={readOnlyAccount || busy === 'affiliate-terms'} onClick={acceptTerms} className={`mt-3 ${affiliatePrimaryButtonClass}`}>
              Aceitar termo e liberar modulo
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="grid gap-5">
          <form ref={automationFormRef} onSubmit={submitAutomation} className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Fluxo da automacao</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Escolha uma origem Telegram e os destinos WhatsApp desta regra.</p>
              </div>
              <span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100">
                {activeAutomation?.name || 'Nova automacao'}
              </span>
            </div>

            <input type="hidden" name="automationId" value={activeAutomation?.id || ''} />
            <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold">
                Nome da automacao
                <input
                  name="name"
                  disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                  defaultValue={activeAutomation?.name || ''}
                  className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 disabled:cursor-not-allowed disabled:opacity-65"
                  placeholder="Ofertas Amazon"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Grupo Telegram origem
                <select
                  name="telegramSourceGroupId"
                  disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                  defaultValue={activeAutomation?.telegramSourceGroupId || ''}
                  className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  <option value="">Selecione uma origem</option>
                  {state.telegram.availableChats?.map((chat) => {
                    const reservedByTelegram = telegramBridgeSourceId === normalizeRouteSourceId(chat.id);

                    return (
                      <option key={chat.id} value={chat.id} disabled={reservedByTelegram}>
                        {chat.name}
                        {reservedByTelegram ? ' - usado no Telegram normal' : ''}
                      </option>
                    );
                  })}
                </select>
                {affiliateSourceReservedByTelegram ? (
                  <span className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs font-normal leading-5 text-amber-100">
                    Esta origem tambem esta configurada na aba Telegram. Escolha outro grupo para evitar envio duplicado.
                  </span>
                ) : null}
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <p className="text-sm font-semibold">Destinos WhatsApp</p>
              <div className="mt-3 grid max-h-64 gap-2 overflow-auto pr-1 md:grid-cols-2">
                {state.groups.map((group) => {
                  const checked = Boolean(activeAutomation?.destinations?.some((destination) => destination.whatsappGroupId === group.id));
                  return (
                    <label key={group.id} className={cn('flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-xs', (!isAutomationEditing || readOnlyAccount || !affiliateModuleAllowed) && 'opacity-65')}>
                      <input type="checkbox" name="destinations" value={group.id} defaultChecked={checked} disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed} />
                      <span className="truncate">{group.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
              <label className="grid self-start gap-2 text-sm font-semibold">
                Links desconhecidos
                <select
                  name="unknownLinkBehavior"
                  disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                  defaultValue={activeAutomation?.unknownLinkBehavior || 'keep'}
                  className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  <option value="keep">Manter link original</option>
                  <option value="remove">Remover link</option>
                  <option value="ignore_message">Ignorar mensagem inteira</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Rodape personalizado
                <textarea
                  name="customFooter"
                  disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                  defaultValue={activeAutomation?.customFooter || ''}
                  className="min-h-28 rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 leading-6 disabled:cursor-not-allowed disabled:opacity-65"
                  placeholder={'Visite nosso Instagram:\n- www.instagram.com/exemplo\nEsperamos por voces la'}
                />
                <span className="text-xs font-normal text-[var(--muted)]">Voce pode quebrar linhas livremente nesse rodape.</span>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm text-[var(--muted)]">
                <label className={cn('inline-flex items-center gap-2', (!isAutomationEditing || readOnlyAccount || !affiliateModuleAllowed) && 'opacity-65')}><input type="checkbox" name="removeOriginalFooter" defaultChecked={Boolean(activeAutomation?.removeOriginalFooter)} disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed} /> Remover rodape original</label>
              </div>
              <button
                type="button"
                disabled={readOnlyAccount || busy === 'affiliate-automation' || !affiliateModuleAllowed}
                onClick={() => {
                  if (!isAutomationEditing) {
                    setAutomationEditing(true);
                    return;
                  }

                  automationFormRef.current?.requestSubmit();
                }}
                className={affiliatePrimaryButtonClass}
              >
                {isAutomationEditing ? 'Salvar automacao' : 'Editar'}
              </button>
            </div>
          </form>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Testar conversao</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Simule a conversao sem enviar ao WhatsApp.</p>
              </div>
              <button type="button" disabled={readOnlyAccount || busy === 'affiliate-test'} onClick={runManualTest} className={affiliateSecondaryButtonClass}>Rodar teste</button>
            </div>
            <textarea value={testMessage} disabled={readOnlyAccount} onChange={(event) => setTestMessage(event.target.value)} className="mt-4 min-h-40 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-65" />
            {testResult ? (
              <div className="mt-4 grid gap-3">
                <p className="text-sm font-semibold">Resultado: {testResult.status}</p>
                <pre className="whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-black/20 p-4 text-xs leading-5 text-[var(--muted)]">{testResult.processedMessage}</pre>
                {testResult.convertedUrls?.map((url, index) => (
                  <div key={`${url.originalUrl}-${index}`} className="rounded-xl border border-[var(--border)] bg-white/[0.03] p-3 text-xs">
                    <p className="font-semibold">{url.marketplace} - {url.status}</p>
                    <p className="mt-1 break-all text-[var(--muted)]">Original: {url.originalUrl}</p>
                    <p className="mt-1 break-all text-[var(--muted)]">Final: {url.affiliateUrl || url.expandedUrl || '-'}</p>
                    {url.error ? <p className="mt-1 text-amber-100">{url.error}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-5">
          <form onSubmit={submitAccount} className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <p className="text-sm font-semibold">Contas de afiliado</p>
            <div className="mt-4 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" name="amazonEnabled" defaultChecked={Boolean(affiliate.account?.amazonEnabled)} disabled={readOnlyAccount || !planLimits?.amazonAffiliate} /> Converter Amazon</label>
              <input name="amazonTag" disabled={readOnlyAccount || !planLimits?.amazonAffiliate} defaultValue={affiliate.account?.amazonTag || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.amazonAffiliate ? 'sua-tag-20' : 'Disponivel no Plus'} />
              <label className="inline-flex items-center gap-2 pt-2 text-sm text-[var(--muted)]"><input type="checkbox" name="shopeeEnabled" defaultChecked={Boolean(affiliate.account?.shopeeEnabled)} disabled={readOnlyAccount || !planLimits?.shopeeAffiliate} /> Preparar Shopee</label>
              <input name="shopeeAffiliateId" disabled={readOnlyAccount || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAffiliateId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.shopeeAffiliate ? 'ID/SubID Shopee' : 'Disponivel no Pro'} />
              <input name="defaultSubId" disabled={readOnlyAccount || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.defaultSubId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="SubID padrao" />
              <input name="shopeeAppId" disabled={readOnlyAccount || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAppId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="App ID Shopee" />
              <input name="shopeeSecret" disabled={readOnlyAccount || !planLimits?.shopeeAffiliate} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={affiliate.account?.shopeeSecretConfigured ? 'Secret ja configurado' : 'Secret Shopee'} />
            </div>
            <button type="submit" disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed} className={`mt-4 w-full ${affiliatePrimaryButtonClass}`}>Salvar dados</button>
          </form>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <p className="text-sm font-semibold">Historico recente</p>
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
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Historico</p>
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
  const [previewAvatar, setPreviewAvatar] = useState('');
  const [profileEditing, setProfileEditing] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setPreviewAvatar(user?.avatarUrl || '');
    setProfileEditing(false);
  }, [user?.name, user?.avatarUrl]);

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
                  Essas informações aparecem no seu painel e ajudam a identificar a conta conectada.
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
                  setNotice(error instanceof Error ? error.message : 'Nao foi possivel atualizar o perfil.');
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
                    : 'Esta conta usa autenticacao externa e a senha e gerenciada fora do Portal do Afiliado.'}
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
                    setNotice(error instanceof Error ? error.message : 'Nao foi possivel atualizar a senha.');
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
              Aceitamos PNG, JPG ou WEBP com ate 1 MB.
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
                      throw new Error('A imagem deve ter no máximo 1 MB.');
                    }

                    const avatarDataUrl = await readFileAsDataUrl(file);
                    setBusy('avatar');
                    setPreviewAvatar(avatarDataUrl);
                    await postJson('/api/account/avatar', { avatarDataUrl });
                    setBusy('');
                    await refresh();
                    setNotice('Foto do perfil atualizada com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'Nao foi possivel atualizar a foto do perfil.');
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

      <div className="grid gap-3 md:grid-cols-5">
        <AdminSupervisorMetric label="Runtimes" value={supervisor?.totalRuntimes || 0} />
        <AdminSupervisorMetric label="Telegram OK" value={supervisor?.listeningTelegram || 0} tone="success" />
        <AdminSupervisorMetric label="WhatsApp OK" value={supervisor?.readyWhatsApp || 0} tone="success" />
        <AdminSupervisorMetric label="Filas ativas" value={supervisor?.activeDeliveries || 0} tone="info" />
        <AdminSupervisorMetric label="Aguardando" value={supervisor?.queuedDeliveries || 0} tone="warning" />
      </div>

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
              <div className="mt-4 grid gap-2 rounded-md border border-[var(--border)] bg-white/[0.03] p-3 text-xs text-[var(--muted)] md:grid-cols-4">
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
                      ? 'Conta suspensa e sessao encerrada imediatamente.'
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
                  setNotice(`Sessao de ${user.name} reiniciada sem apagar dados.`);
                }}
              >
                <RefreshCcw size={16} />
                Reiniciar sessao
              </button>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-400/15"
                onClick={async () => {
                  const confirmed = window.confirm(
                    `Deseja realmente excluir a conta de ${user.name}? Essa acao remove o acesso, o perfil e os dados locais dessa conta.`
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
                    setNotice(error instanceof Error ? error.message : 'Nao foi possivel excluir a conta.');
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

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
  value,
  onChange,
  icon: Icon,
  rightSlot
}: {
  label: string;
  name?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  icon?: typeof Mail;
  rightSlot?: ReactNode;
}) {
  return (
    <label className="grid gap-2.5 text-sm font-semibold text-[#F8FAFC]">
      {label}
      <span className="relative block">
        {Icon ? (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7D8D86]">
            <Icon size={20} />
          </span>
        ) : null}
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          className={cn(inputClass, Icon ? 'pl-12' : '', rightSlot ? 'pr-12' : '')}
        />
        {rightSlot ? (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">{rightSlot}</span>
        ) : null}
      </span>
    </label>
  );
}

function StatusBadge({ label, value }: { label: string; value: string }) {
  const good = ['ready', 'listening', 'authenticated'].includes(value);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold',
        good ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-[var(--border)] bg-black/10 text-[var(--muted)]'
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', good ? 'bg-[var(--accent)]' : 'bg-[var(--warning)]')} />
      {label}: {value}
    </span>
  );
}

function isWhatsAppConnectedStatus(value: string) {
  return ['authenticated', 'ready'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeRouteSourceId(value?: string | null) {
  return String(value ?? '').trim();
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

function ConnectionRow({
  icon: Icon,
  label,
  status,
  detail
}: {
  icon: typeof Bot;
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-black/10 p-3">
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-[var(--accent)]" />
        <div className="min-w-0">
          <p className="font-semibold">{label}</p>
          <p className="truncate text-sm text-[var(--muted)]">{detail}</p>
        </div>
        <span className="ml-auto text-xs font-semibold text-[var(--muted)]">{status}</span>
      </div>
    </div>
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
        reject(new Error('Nao foi possivel ler a imagem selecionada.'));
        return;
      }

      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error('Nao foi possivel ler a imagem selecionada.'));
    };

    reader.readAsDataURL(file);
  });
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  let response: Response;

  try {
    response = await fetch(url, {
      credentials: 'include',
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A requisicao demorou demais para responder. Tente novamente.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || 'Nao foi possivel concluir a acao.');
  }

  return payload as T;
}

async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function formatDate(value?: string) {
  if (!value) {
    return 'Sem registro';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sem registro';
  }

  return date.toLocaleString('pt-BR');
}

function lastLabel(value?: string) {
  return value ? `Ultimo: ${formatDate(value)}` : 'Sem registro';
}

function formatOfferStatus(value: string) {
  switch (String(value || '').toLowerCase()) {
    case 'sent':
      return 'Entregue';
    case 'queued':
      return 'Na fila';
    case 'failed':
      return 'Falhou';
    case 'ignored':
      return 'Ignorada';
    case 'captured':
      return 'Captada';
    default:
      return humanize(value || 'captured');
  }
}

function areSameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function humanize(value: string) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
