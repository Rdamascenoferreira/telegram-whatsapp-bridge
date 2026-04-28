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
  Zap
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/utils';

const panelVersion = 'Versao 010';

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
  { key: 'connections', label: 'Conexoes', icon: Settings2 },
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
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-black">
              <Zap size={21} />
            </div>
            <div>
              <p className="text-sm font-semibold">Ponte SaaS</p>
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
    <main className="min-h-screen px-6 py-6 text-[var(--foreground)] max-sm:px-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Ponte Telegram - WhatsApp</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight max-sm:text-3xl">
            Acesse sua central de automacao.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
            Gerencie conexoes, grupos, sessoes e entregas em uma interface preparada para operacao real.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-5xl grid-cols-[1fr_420px] gap-5 max-lg:grid-cols-1">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Produto beta</p>
          <h2 className="mt-3 text-2xl font-semibold">Uma ponte mais organizada para operar no dia a dia.</h2>
          <div className="mt-6 grid gap-3">
            {[
              ['Status claro', 'Veja rapidamente se Telegram, WhatsApp e automacao estao prontos.'],
              ['Controle por conta', 'Cada usuario trabalha com suas proprias sessoes e configuracoes.'],
              ['Base SaaS', 'A estrutura ja prepara admin, planos e cobranca para as proximas etapas.']
            ].map(([title, text]) => (
              <div key={title} className="rounded-md border border-[var(--border)] bg-black/10 p-4">
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6">
          <div className="mb-5 inline-grid grid-cols-2 rounded-md border border-[var(--border)] bg-black/15 p-1">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={cn('rounded px-4 py-2 text-sm font-semibold', mode === 'login' && 'bg-[var(--accent)] text-black')}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={cn('rounded px-4 py-2 text-sm font-semibold', mode === 'register' && 'bg-[var(--accent)] text-black')}
            >
              Criar conta
            </button>
          </div>

          <form onSubmit={submit} className="grid gap-4">
            {mode === 'register' ? (
              <Field label="Nome" name="name" placeholder="Seu nome" autoComplete="name" />
            ) : null}
            <Field label="E-mail" name="email" placeholder="email@empresa.com" autoComplete="email" />
            <Field
              label="Senha"
              name="password"
              type="password"
              placeholder={mode === 'login' ? 'Digite sua senha' : 'Minimo de 8 caracteres'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-[var(--accent)] px-4 py-3 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)]"
            >
              {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            ou
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>

          {googleEnabled ? (
            <a
              href="/auth/google"
              className="flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm font-semibold transition hover:bg-white/5"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-black">G</span>
              Continuar com Google
            </a>
          ) : (
            <p className="rounded-md border border-[var(--border)] bg-black/10 px-4 py-3 text-sm text-[var(--muted)]">
              Login com Google estara disponivel em breve.
            </p>
          )}

          {notice ? <p className="mt-4 rounded-md border border-[var(--border)] bg-black/10 p-3 text-sm">{notice}</p> : null}
        </section>
      </div>
    </main>
  );
}

function Topbar({
  state,
  onLogout
}: {
  state: AppState;
  onLogout: () => Promise<void>;
}) {
  return (
    <header className="mb-5 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
      <div>
        <p className="text-sm text-[var(--muted)]">Central operacional</p>
        <h1 className="text-2xl font-semibold">Ponte Telegram - WhatsApp</h1>
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
  const hasTelegramSource = Boolean(state.config.telegramChannel);
  const hasWhatsAppDestination = (state.config.selectedGroupIds?.length || 0) > 0;
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

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Checklist</p>
            <h2 className="mt-1 text-xl font-semibold">Preparacao da automacao</h2>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {[state.telegramStatus === 'listening', state.whatsAppStatus === 'ready', hasTelegramSource, hasWhatsAppDestination, canEnableAutomation].filter(Boolean).length}/5 concluido
          </span>
        </div>

        <div className="grid grid-cols-5 gap-3 max-2xl:grid-cols-3 max-md:grid-cols-1">
          <SetupStepCard
            step="1"
            title="Telegram conectado"
            description="Conecte sua conta e conclua o login por codigo."
            done={state.telegramStatus === 'listening'}
          />
          <SetupStepCard
            step="2"
            title="WhatsApp conectado"
            description="Escaneie o QR Code e aguarde o status ficar pronto."
            done={state.whatsAppStatus === 'ready'}
          />
          <SetupStepCard
            step="3"
            title="Origem escolhida"
            description="Selecione o grupo ou canal monitorado no Telegram."
            done={hasTelegramSource}
          />
          <SetupStepCard
            step="4"
            title="Destino escolhido"
            description="Selecione ao menos um grupo de destino no WhatsApp."
            done={hasWhatsAppDestination}
          />
          <SetupStepCard
            step="5"
            title="Automacao liberada"
            description={
              state.config.bridgeEnabled
                ? 'Sistema ligado e pronto para encaminhar mensagens.'
                : canEnableAutomation
                  ? 'Tudo pronto. Agora voce ja pode ligar o sistema.'
                  : 'A automacao sera liberada quando as etapas anteriores forem concluidas.'
            }
            done={state.config.bridgeEnabled}
            ready={!state.config.bridgeEnabled && canEnableAutomation}
          />
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
  const groupsProgress = state.metrics.groupRefreshProgress;
  const groupsPercent = Math.max(0, Math.min(100, groupsProgress?.percent || 0));
  const groupsProcessed = groupsProgress?.processed || 0;
  const groupsTotal = groupsProgress?.total || 0;
  const filteredGroups = useMemo(() => {
    const normalized = normalizeText(filter);
    return state.groups.filter((group) => normalizeText(group.name).includes(normalized));
  }, [filter, state.groups]);

  useEffect(() => {
    setSelected(new Set(state.config.selectedGroupIds));
  }, [state.config.selectedGroupIds]);

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
            <span>{groupsTotal ? 'Leitura em andamento' : 'Iniciando sincronizacao'}</span>
            <span>{groupsTotal ? `${groupsProcessed} de ${groupsTotal} grupos verificados` : 'Aguardando contagem total'}</span>
          </div>
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
                }}
              />
              <span className="text-sm">{group.name}</span>
            </label>
          ))
        ) : (
          <p className="p-4 text-sm text-[var(--muted)]">Nenhum grupo encontrado.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-[var(--muted)]">{selected.size} grupo(s) selecionado(s)</p>
        <button
          type="button"
          className={primaryButton}
          onClick={async () => {
            setBusy('save-groups');
            await postJson('/api/groups', { selectedGroupIds: [...selected] });
            await refresh();
            setNotice('Grupos selecionados salvos.');
            setBusy('');
          }}
        >
          Salvar grupos
        </button>
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

function SetupStepCard({
  step,
  title,
  description,
  done,
  ready = false
}: {
  step: string;
  title: string;
  description: string;
  done: boolean;
  ready?: boolean;
}) {
  return (
    <article
      className={cn(
        'rounded-lg border p-4 transition',
        done
          ? 'border-emerald-400/20 bg-emerald-400/8'
          : ready
            ? 'border-sky-400/20 bg-sky-400/8'
            : 'border-[var(--border)] bg-black/10'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold',
              done
                ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-100'
                : ready
                  ? 'border-sky-400/30 bg-sky-400/15 text-sky-100'
                  : 'border-[var(--border)] bg-white/5 text-[var(--muted)]'
            )}
          >
            {done ? <CheckCircle2 size={16} /> : step}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p
              className={cn(
                'mt-1 text-xs font-semibold uppercase tracking-[0.14em]',
                done ? 'text-emerald-100' : ready ? 'text-sky-100' : 'text-[var(--muted)]'
              )}
            >
              {done ? 'Concluido' : ready ? 'Pronto para ativar' : 'Pendente'}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </article>
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
