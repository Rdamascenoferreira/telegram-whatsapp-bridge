'use client';

import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  CreditCard,
  Gauge,
  LogOut,
  MessageSquare,
  Power,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  Shield,
  Smartphone,
  Users,
  X
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';

const panelVersion = 'Versão 0.24';

type AuthUser = {
  id: string;
  name: string;
  email: string;
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

type AdminUser = AuthUser & {
  providers?: string[];
  workspace?: {
    bridgeEnabled: boolean;
    selectedGroupCount: number;
    whatsAppStatus: string;
    telegramStatus: string;
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
  groups: WhatsAppGroup[];
  admin?: {
    users: AdminUser[];
    summary?: Record<string, number>;
  } | null;
  issue?: {
    message?: string;
    canReconnect?: boolean;
    canResetSession?: boolean;
  } | null;
};

type ViewKey = 'overview' | 'connections' | 'groups' | 'activity' | 'admin';

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Gauge }> = [
  { key: 'overview', label: 'Visao geral', icon: Gauge },
  { key: 'connections', label: 'Telegram', icon: Settings2 },
  { key: 'groups', label: 'Grupos', icon: Users },
  { key: 'activity', label: 'Historico', icon: Activity },
  { key: 'admin', label: 'Admin', icon: Shield }
];

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<ViewKey>('overview');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  async function loadState() {
    const nextState = await requestJson<AppState>('/api/state');
    setState(nextState);
  }

  useEffect(() => {
    void loadState();
    const timer = window.setInterval(() => {
      void loadState().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (!state) {
    return <LoadingScreen />;
  }

  if (!state.auth.authenticated) {
    return (
        <AuthScreen
          googleEnabled={state.auth.googleEnabled}
          onAuthenticated={loadState}
          notice={notice || state.auth.error || ''}
          setNotice={setNotice}
        />
      );
    }

  const isAdmin = state.auth.user?.role === 'admin';

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen grid-cols-[260px_1fr] max-lg:grid-cols-1">
        <aside className="border-r border-[var(--border)] bg-black/15 px-4 py-5 max-lg:border-b max-lg:border-r-0">
          <div className="mb-7 flex items-center gap-3 px-2">
            <div className="h-10 w-10 overflow-hidden rounded-2xl border border-emerald-400/20 bg-black/25 shadow-[0_0_24px_rgba(43,214,140,0.15)]">
              <img src="/brand/portal-icon.svg" alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-semibold">Portal do Afiliado</p>
              <p className="text-xs text-[var(--muted)]">{panelVersion}</p>
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
              await postJson('/api/auth/logout');
              await loadState();
            }}
          />

          {notice ? (
            <div className="mb-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

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
          {view === 'activity' ? <ActivityLog state={state} /> : null}
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
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,158,217,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(37,211,102,0.12),transparent_28%),#03130D] px-6 py-6 text-[var(--foreground)] max-sm:px-4">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_420px]">
          <section className="relative overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(7,26,18,0.96),rgba(3,19,13,0.98))] p-7 shadow-[0_18px_50px_rgba(0,0,0,0.28)] max-sm:p-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,158,217,0.08),transparent_30%),radial-gradient(circle_at_top_left,rgba(37,211,102,0.12),transparent_32%)]" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(34,158,217,0.26)] bg-[rgba(34,158,217,0.12)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#7ED4FF]">
                <span className="h-2 w-2 rounded-full bg-[#229ED9]" />
                Automação SaaS
              </span>

              <div className="mt-6 flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-[rgba(37,211,102,0.18)] bg-[linear-gradient(180deg,rgba(5,22,15,0.9),rgba(8,28,20,0.9))] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_14px_24px_rgba(0,0,0,0.2)]">
                  <img src="/brand/portal-icon.svg" alt="" className="h-11 w-11 object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">Portal do Afiliado</p>
                  <h1 className="mt-3 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-[#F8FAFC] max-xl:text-4xl max-sm:text-3xl">
                    Central inteligente para automação no WhatsApp e Telegram
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-[#AAB8B0]">
                    Gerencie conexões, sessões, grupos e entregas em uma plataforma segura, rápida e pronta para escalar.
                  </p>
                </div>
              </div>

              <div className="mt-8 rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(135deg,rgba(6,30,21,0.94),rgba(7,26,18,0.92))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(37,211,102,0.2)] bg-[rgba(3,19,13,0.75)]">
                    <img src="/brand/portal-icon.svg" alt="" className="h-10 w-10 object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#AAB8B0]">Plataforma de automação</p>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[#F8FAFC] max-sm:text-2xl">Portal do</h2>
                      <h2 className="bg-[linear-gradient(90deg,#25D366,#229ED9)] bg-clip-text text-3xl font-semibold tracking-[-0.03em] text-transparent max-sm:text-2xl">
                        Afiliado
                      </h2>
                    </div>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[#AAB8B0]">
                      Um ambiente profissional para operar integrações, conexões e fluxos com mais previsibilidade.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <AuthStatusMiniCard
                    icon={Smartphone}
                    iconClassName="text-[#25D366]"
                    title="WhatsApp conectado"
                    detail="Sessão pronta"
                    badgeClassName="border-[rgba(37,211,102,0.22)] bg-[rgba(37,211,102,0.12)] text-[#A7F3C0]"
                  />
                  <AuthStatusMiniCard
                    icon={Send}
                    iconClassName="text-[#229ED9]"
                    title="Telegram ativo"
                    detail="Origem monitorada"
                    badgeClassName="border-[rgba(34,158,217,0.24)] bg-[rgba(34,158,217,0.12)] text-[#A7E5FF]"
                  />
                  <AuthStatusMiniCard
                    icon={Shield}
                    iconClassName="text-[#25D366]"
                    title="Sessões online"
                    detail="Sincronização estável"
                    badgeClassName="border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)] text-[#C3F7D8]"
                  />
                  <AuthStatusMiniCard
                    icon={Activity}
                    iconClassName="text-[#229ED9]"
                    title="Entregas automatizadas"
                    detail="Fluxos em execução"
                    badgeClassName="border-[rgba(34,158,217,0.18)] bg-[rgba(34,158,217,0.08)] text-[#BEEBFF]"
                  />
                </div>
              </div>

              <div className="mt-7 grid gap-3 md:grid-cols-3">
                <AuthBenefitCard
                  title="Operação centralizada"
                  text="Controle tudo num só painel, com visão clara de conexões, grupos e estado das entregas."
                />
                <AuthBenefitCard
                  title="Gestão por conta"
                  text="Cada utilizador trabalha com as próprias sessões, regras e configurações sem misturar ambientes."
                />
                <AuthBenefitCard
                  title="Estrutura escalável"
                  text="Preparado para crescer com planos, clientes, workspaces e novas automações."
                />
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(7,26,18,0.98),rgba(4,18,13,0.98))] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.28)] max-sm:p-5">
            <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.08)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#F8FAFC]">Entrar na plataforma</h2>
                  <p className="mt-1 text-sm text-[#AAB8B0]">Acesse o seu painel de automação.</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(34,158,217,0.22)] bg-[rgba(34,158,217,0.1)]">
                  <Bot size={18} className="text-[#7ED4FF]" />
                </div>
              </div>

              <div className="mt-5 inline-grid w-full grid-cols-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.16)] p-1">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={cn(
                    'rounded-xl px-4 py-2.5 text-sm font-semibold transition',
                    mode === 'login'
                      ? 'bg-[linear-gradient(90deg,#25D366,#128C7E)] text-[#03130D] shadow-[0_8px_18px_rgba(37,211,102,0.18)]'
                      : 'text-[#AAB8B0] hover:text-[#F8FAFC]'
                  )}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={cn(
                    'rounded-xl px-4 py-2.5 text-sm font-semibold transition',
                    mode === 'register'
                      ? 'bg-[linear-gradient(90deg,#25D366,#128C7E)] text-[#03130D] shadow-[0_8px_18px_rgba(37,211,102,0.18)]'
                      : 'text-[#AAB8B0] hover:text-[#F8FAFC]'
                  )}
                >
                  Criar conta
                </button>
              </div>

              <form onSubmit={submit} className="mt-5 grid gap-4">
                {mode === 'register' ? (
                  <Field label="Nome" name="name" placeholder="Seu nome" autoComplete="name" />
                ) : null}
                <Field label="E-mail" name="email" placeholder="email@empresa.com" autoComplete="email" />
                <Field
                  label="Senha"
                  name="password"
                  type="password"
                  placeholder="Digite sua senha"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setNotice('Recuperação de senha estará disponível em breve.')}
                    className="text-sm font-medium text-[#AAB8B0] transition hover:text-[#F8FAFC]"
                  >
                    Esqueci minha senha
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-2xl bg-[linear-gradient(90deg,#25D366,#128C7E)] px-4 py-3.5 text-sm font-bold text-[#03130D] transition hover:translate-y-[-1px] hover:shadow-[0_14px_24px_rgba(37,211,102,0.18)] disabled:translate-y-0 disabled:opacity-60"
                >
                  {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta'}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-[#6F7E77]">
                <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
                ou continue com
                <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
              </div>

              {googleEnabled ? (
                <a
                  href="/auth/google"
                  className="flex items-center justify-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm font-semibold transition hover:border-[rgba(34,158,217,0.22)] hover:bg-[rgba(34,158,217,0.06)]"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-black">G</span>
                  Continuar com Google
                </a>
              ) : (
                <p className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#AAB8B0]">
                  Login com Google estará disponível em breve.
                </p>
              )}

              {notice ? (
                <p className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3 text-sm text-[#F8FAFC]">
                  {notice}
                </p>
              ) : null}

              <p className="mt-5 text-center text-xs text-[#6F7E77]">Ambiente seguro para gestão de automações.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function AuthStatusMiniCard({
  icon: Icon,
  iconClassName,
  title,
  detail,
  badgeClassName
}: {
  icon: typeof Smartphone;
  iconClassName: string;
  title: string;
  detail: string;
  badgeClassName: string;
}) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border border-white/5 bg-black/15', badgeClassName)}>
          <Icon size={16} className={iconClassName} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#F8FAFC]">{title}</p>
          <p className="truncate text-xs text-[#AAB8B0]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function AuthBenefitCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <p className="text-base font-semibold text-[#F8FAFC]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#AAB8B0]">{text}</p>
    </article>
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
  const canEnableAutomation = state.telegramStatus === 'listening' && state.whatsAppStatus === 'ready';

  return (
    <header className="mb-5 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
      <div className="min-w-0">
        <p className="text-sm text-[var(--muted)]">Central operacional</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold">Portal do Afiliado</h1>
          <CompactSetupChecklist
            steps={[
              { label: 'Telegram', done: state.telegramStatus === 'listening' },
              { label: 'WhatsApp', done: state.whatsAppStatus === 'ready' },
              { label: 'Origem', done: hasTelegramSource },
              { label: 'Destino', done: hasWhatsAppDestination },
              { label: 'Ativo', done: state.config.bridgeEnabled, ready: !state.config.bridgeEnabled && canEnableAutomation }
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
  const progress = state.metrics.groupRefreshProgress;
  const canEnableAutomation = state.telegramStatus === 'listening' && state.whatsAppStatus === 'ready';
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
                Plano {humanize(state.auth.user?.plan || 'beta')}
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
                  {state.config.bridgeEnabled
                    ? 'A ponte pode encaminhar mensagens normalmente.'
                    : canEnableAutomation
                      ? 'As mensagens recebidas ficam sem encaminhamento ate voce ligar de novo.'
                      : automationLockReason}
                </p>
              </div>
              <SystemPowerSwitch
                checked={state.config.bridgeEnabled}
                disabled={busy === 'power' || (!canEnableAutomation && !state.config.bridgeEnabled)}
                onChange={async (nextValue) => {
                  setBusy('power');
                  await postJson('/api/system-power', { bridgeEnabled: nextValue });
                  await refresh();
                  setNotice(nextValue ? 'Sistema ligado.' : 'Sistema desligado.');
                  setBusy('');
                }}
              />
            </div>

            {!canEnableAutomation && !state.config.bridgeEnabled ? (
              <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
                O interruptor sera liberado assim que Telegram e WhatsApp estiverem conectados.
              </p>
            ) : null}

            <button
              type="button"
              disabled={busy === 'reset-all'}
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
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <Metric icon={MessageSquare} label="Telegram" value={state.metrics.totalTelegramReceived || 0} detail={lastLabel(state.metrics.lastTelegramMessageAt)} />
        <Metric icon={Send} label="Encaminhadas" value={state.metrics.totalForwardedMessages || 0} detail={lastLabel(state.metrics.lastForwardedAt)} />
        <Metric icon={Users} label="Grupos" value={state.metrics.selectedGroupCount || 0} detail={groupProgressText} />
        <Metric icon={AlertCircle} label="Erros" value={state.metrics.totalErrors || 0} detail={lastLabel(state.metrics.lastErrorAt)} />
      </section>

      <section className="grid grid-cols-[1fr_360px] gap-5 max-xl:grid-cols-1">
        <ActivityLog state={state} compact />
        <ConnectionSummary state={state} refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
      </section>
    </div>
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
  const [telegramMode, setTelegramMode] = useState(state.config.telegramMode || 'user');
  const [telegramChannel, setTelegramChannel] = useState(state.config.telegramChannel || '');
  const [telegramApiId, setTelegramApiId] = useState(state.config.telegramApiId || '');
  const [telegramApiHash, setTelegramApiHash] = useState(state.config.telegramApiHash || '');
  const [telegramPhone, setTelegramPhone] = useState(state.config.telegramPhone || '');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramPassword, setTelegramPassword] = useState('');

  useEffect(() => {
    setTelegramMode(state.config.telegramMode || 'user');
    setTelegramChannel(state.config.telegramChannel || '');
    setTelegramApiId(state.config.telegramApiId || '');
    setTelegramApiHash(state.config.telegramApiHash || '');
    setTelegramPhone(state.config.telegramPhone || '');
  }, [
    state.config.telegramMode,
    state.config.telegramChannel,
    state.config.telegramApiId,
    state.config.telegramApiHash,
    state.config.telegramPhone
  ]);

  useEffect(() => {
    if (state.telegram.authPhase !== 'password_required') {
      setTelegramPassword('');
    }

    if (state.telegram.authPhase === 'idle' || state.telegram.authPhase === 'auth_required') {
      setTelegramCode('');
    }
  }, [state.telegram.authPhase]);

  const isUserMode = telegramMode === 'user';
  const authPhase = state.telegram.authPhase || 'idle';
  const telegramStatusLabel = humanize(state.telegramStatus || 'not_configured');
  const telegramUserLabel = state.telegram.user?.name
    ? state.telegram.user.name + (state.telegram.user.username ? ` (${state.telegram.user.username})` : '')
    : '';
  const showTelegramAuthPanel = isUserMode;
  const hasTelegramConnection = state.telegramStatus === 'listening' || Boolean(state.telegram.user?.name);
  const canChooseTelegramSource = !isUserMode || hasTelegramConnection;

  return (
    <div className="grid grid-cols-[1fr_380px] gap-5 max-xl:grid-cols-1">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Origem</p>
            <h2 className="mt-1 text-xl font-semibold">Telegram</h2>
          </div>
          <StatusBadge label="Status" value={state.telegramStatus} />
        </div>

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
              setBusy('settings');
              await postJson('/api/settings', {
                telegramMode,
                telegramChannel,
                telegramApiId,
                telegramApiHash,
                telegramPhone,
                telegramBotToken
              });
              await refresh();
              setNotice('Credenciais do Telegram salvas.');
              setBusy('');
            }}
          >
            <label className="grid gap-2 text-sm font-semibold">
              Modo de conexao
              <select value={telegramMode} onChange={(event) => setTelegramMode(event.target.value as 'user' | 'bot')} className={inputClass}>
                <option value="user">Sessao de usuario</option>
                <option value="bot">Bot do Telegram</option>
              </select>
            </label>

            {telegramMode === 'user' ? (
              <>
                <Field label="API ID" value={telegramApiId} onChange={setTelegramApiId} placeholder="12345678" />
                <Field label="API Hash" value={telegramApiHash} onChange={setTelegramApiHash} placeholder="Cole o API Hash" />
                <Field label="Telefone" value={telegramPhone} onChange={setTelegramPhone} placeholder="+55 21 99999-9999" />
              </>
            ) : (
              <Field label="Token do bot" value={telegramBotToken} onChange={setTelegramBotToken} placeholder={state.config.hasTelegramBotToken ? 'Token ja configurado' : 'Cole o token do bot'} />
            )}

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy === 'settings'} className={primaryButton}>
                Salvar credenciais
              </button>
            </div>
          </form>

          {showTelegramAuthPanel ? (
            <>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === 'telegram-send-code' || busy === 'settings'}
                  onClick={async () => {
                    setBusy('telegram-send-code');
                    await postJson('/api/settings', {
                      telegramMode,
                      telegramChannel,
                      telegramApiId,
                      telegramApiHash,
                      telegramPhone,
                      telegramBotToken
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
                <button
                  type="button"
                  disabled={busy === 'telegram-disconnect'}
                  onClick={async () => {
                    setBusy('telegram-disconnect');
                    await postJson('/api/telegram/disconnect');
                    await refresh();
                    setNotice('Conta do Telegram desconectada.');
                    setBusy('');
                  }}
                  className={secondaryButton}
                >
                  Desconectar Telegram
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
                <Field
                  label="Codigo recebido"
                  value={telegramCode}
                  onChange={setTelegramCode}
                  placeholder="Digite o codigo do Telegram"
                />
                <Field
                  label="Senha em duas etapas"
                  value={telegramPassword}
                  onChange={setTelegramPassword}
                  placeholder="Preencha apenas se o Telegram pedir"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === 'telegram-complete-auth' || (authPhase !== 'code_required' && authPhase !== 'password_required')}
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
          ) : null}
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-black/10 p-4">
          <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Etapa 2</p>
              <h3 className="mt-1 text-lg font-semibold">Escolher grupo ou canal monitorado</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                Depois que a conta estiver conectada, selecione a origem que a ponte deve monitorar.
              </p>
            </div>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
              {canChooseTelegramSource ? 'Liberado' : 'Aguardando login'}
            </span>
          </div>

          {canChooseTelegramSource ? (
            <>
              <label className="grid gap-2 text-sm font-semibold">
                Grupo ou canal monitorado
                <select
                  value={telegramChannel}
                  onChange={(event) => {
                    const nextChannelId = event.target.value;
                    setTelegramChannel(nextChannelId);
                  }}
                  className={inputClass}
                >
                  <option value="">Selecione uma origem</option>
                  {(state.telegram.availableChats || []).map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {chat.name} ({chat.type === 'channel' ? 'canal' : 'grupo'})
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 grid gap-4">
                <Field label="ID manual da origem" value={telegramChannel} onChange={setTelegramChannel} placeholder="-100..." />
                <p className="text-xs text-[var(--muted)]">
                  Quando voce escolher uma origem no menu acima, este ID sera preenchido automaticamente.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === 'save-source'}
                  onClick={async () => {
                    setBusy('save-source');
                    await postJson('/api/settings', {
                      telegramMode,
                      telegramChannel,
                      telegramApiId,
                      telegramApiHash,
                      telegramPhone,
                      telegramBotToken
                    });
                    await refresh();
                    setNotice('Origem monitorada salva.');
                    setBusy('');
                  }}
                  className={primaryButton}
                >
                  Salvar origem
                </button>
                <button
                  type="button"
                  disabled={busy === 'telegram-chats'}
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
  const [selected, setSelected] = useState(new Set(state.config.selectedGroupIds));
  const [hasPendingSelectionChanges, setHasPendingSelectionChanges] = useState(false);
  const groupsProgress = state.metrics.groupRefreshProgress;
  const groupsPercent = Math.max(0, Math.min(100, groupsProgress?.percent || 0));
  const groupsProcessed = groupsProgress?.processed || 0;
  const groupsTotal = groupsProgress?.total || 0;
  const cachedAtLabel = state.metrics.groupCacheRefreshedAt
    ? formatDate(state.metrics.groupCacheRefreshedAt)
    : '';
  const selectedGroups = useMemo(
    () => state.groups.filter((group) => selected.has(group.id)),
    [selected, state.groups]
  );
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
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos</p>
          <h2 className="mt-1 text-xl font-semibold">Grupos do WhatsApp</h2>
        </div>
        <button
          type="button"
          disabled={busy === 'groups' || state.metrics.groupsRefreshing}
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
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {selectedGroups.length}
          </span>
        </div>

        {selectedGroups.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
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
          filteredGroups.map((group) => (
            <label key={group.id} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-white/5">
              <input
                type="checkbox"
                checked={selected.has(group.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) {
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
          ))
        ) : (
          <p className="p-4 text-sm text-[var(--muted)]">Nenhum grupo encontrado.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-[var(--muted)]">{selected.size} grupo(s) selecionado(s)</p>
        <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-stretch">
          {hasPendingSelectionChanges ? (
            <span className="text-xs font-semibold text-amber-200">Selecao alterada. Clique em salvar para manter esses destinos.</span>
          ) : null}
          <button
            type="button"
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

      {state.qrDataUrl ? (
        <div className="mt-4 rounded-md border border-[var(--border)] bg-white p-3">
          <img src={state.qrDataUrl} alt="QR Code do WhatsApp" className="mx-auto h-auto max-w-full" />
        </div>
      ) : null}

      {state.issue?.message ? (
        <p className="mt-4 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
          {state.issue.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy === 'wa-reconnect'}
          onClick={async () => {
            setBusy('wa-reconnect');
            await postJson('/api/whatsapp/reconnect');
            await refresh();
            setNotice('Reconexao do WhatsApp solicitada.');
            setBusy('');
          }}
          className={secondaryButton}
        >
          Reconectar WhatsApp
        </button>
        <button
          type="button"
          disabled={busy === 'wa-reset'}
          onClick={async () => {
            setBusy('wa-reset');
            await postJson('/api/whatsapp/reset-session');
            await refresh();
            setNotice('Nova sessao do WhatsApp preparada.');
            setBusy('');
          }}
          className={secondaryButton}
        >
          Trocar conta
        </button>
        <button
          type="button"
          disabled={busy === 'reset-all'}
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
          className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-400/15 disabled:opacity-60"
        >
          <Power size={16} />
          Reset completo
        </button>
      </div>
    </section>
  );
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

function ActivityLog({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const events = compact ? state.activity.slice(0, 6) : state.activity;

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
  const users = (state.admin?.users || []).filter((user) =>
    normalizeText(`${user.name} ${user.email}`).includes(normalizeText(search))
  );

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Administracao</p>
          <h2 className="mt-1 text-xl font-semibold">Contas e planos</h2>
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

      <div className="grid gap-3">
        {users.map((user) => (
          <article key={user.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-md border border-[var(--border)] bg-black/10 p-4 max-lg:grid-cols-1">
            <div>
              <p className="font-semibold">{user.name}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-white/5 px-2 py-1">Plano {humanize(user.plan || 'beta')}</span>
                <span className="rounded bg-white/5 px-2 py-1">Conta {humanize(user.accountStatus || 'active')}</span>
                <span className="rounded bg-white/5 px-2 py-1">{user.workspace?.selectedGroupCount || 0} grupo(s)</span>
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
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <select
                defaultValue={user.accountStatus || 'active'}
                className={inputClass}
                onChange={async (event) => {
                  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}`, { accountStatus: event.target.value });
                  await refresh();
                  setNotice('Status atualizado.');
                }}
              >
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="blocked">Bloqueada</option>
              </select>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  autoComplete,
  value,
  onChange
}: {
  label: string;
  name?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={inputClass}
      />
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
  'w-full rounded-md border border-[var(--border)] bg-black/15 px-3 py-2.5 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(57,217,138,0.15)]';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options
  });
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
