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
import { AdminPanel } from './components/panels/admin-panel';
import { GroupsPanel } from './components/panels/groups-panel';
import { OverviewPanel } from './components/panels/overview-panel';
import { FlowsPanel } from './components/panels/flows-panel';
import { PlanUsagePanel } from './components/panels/plan-usage-panel';
import { AffiliateAutomationPanel } from './components/panels/affiliate-automation-panel';
import { ActivityLogPanel } from './components/panels/activity-log-panel';
import { AccountPanel } from './components/panels/account-panel';
import { AuthScreen } from './components/auth/auth-screen';
import type { AppState, ViewKey } from './types/panel';
import { AvatarBadge, Field, LoadingScreen, ReadOnlyModeBanner } from './components/common-ui';
import { ConnectionSummary, ConnectionsPanel, InternalSetupChecklist } from './components/connections-panel';
import { FlowSaveActionsCard } from './components/flow-save-actions-card';
import { Topbar } from './components/topbar';
import { usePolledState } from './hooks/usePolledState';
import { useSessionStorageBoolean } from './hooks/useSessionStorageBoolean';
import { ApiRequestError, HTTP_TIMEOUT_MS, postJsonWithOptions, requestJson } from '../lib/http';
import { canEnableAutomationState, hasOperationalTelegramSource, hasOperationalWhatsAppDestination } from './lib/automation-health';
import { createAuthenticatedShellState, normalizeAppState } from './lib/state-normalizers';
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

const panelVersion = 'Versão 2.01';

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
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

export default function Home() {
  const [view, setView] = useState<ViewKey>('overview');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [affiliateAutomationEditing, setAffiliateAutomationEditing] = useSessionStorageBoolean('affiliate-automation-editing');
  const { state, setState, bootError, setBootError, reload } = usePolledState<AppState>({
    fetcher: async () =>
      await requestJson<AppState>(view === 'admin' ? '/api/state?includeAdmin=1' : '/api/state'),
    normalize: normalizeAppState,
    defaultErrorMessage: 'Não foi possível carregar o painel agora. Tente novamente.',
    pausePolling: view === 'flows' && affiliateAutomationEditing,
    pollIntervalMs: 5000
  });
  const loadState = useCallback(async () => {
    await reload({ suppressBootError: true });
  }, [reload]);
  const loadAdminState = useCallback(async () => {
    const adminState = await requestJson<AppState['admin']>('/api/admin/state', {
      timeoutMs: HTTP_TIMEOUT_MS.MEDIUM
    });
    setState((previous) => (previous ? { ...previous, admin: adminState } : previous));
    return adminState;
  }, [setState]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  const isAdmin = Boolean(state?.auth.user?.isAdmin);

  useEffect(() => {
    if (!state?.auth.authenticated || !isAdmin || view !== 'admin') {
      return;
    }

    let cancelled = false;

    const syncAdminState = async () => {
      try {
        await loadAdminState();
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : 'Não foi possível atualizar o painel admin.');
        }
      }
    };

    void syncAdminState();

    const interval = window.setInterval(() => {
      void syncAdminState();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isAdmin, loadAdminState, setNotice, state?.auth.authenticated, view]);

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
                  : 'Login realizado, mas não foi possível carregar o painel completo.'
              );
            });
          }}
          notice={notice || state.auth.error || ''}
          setNotice={setNotice}
        />
      );
    }

  const refreshAdminPanel = async () => {
    await loadState();
    if (isAdmin) {
      await loadAdminState();
    }
  };
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid min-h-screen grid-cols-[280px_1fr] max-lg:grid-cols-1">
        <aside className="border-r border-white/5 bg-zinc-950 px-5 py-6 max-lg:border-b max-lg:border-r-0">
          <div className="mb-8 flex items-center gap-3 px-3">
            <AvatarBadge user={state.auth.user} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-200">Portal do Afiliado</p>
              <p className="truncate text-xs text-zinc-500">
                {state.auth.user?.name || panelVersion}
              </p>
            </div>
          </div>

          <nav className="grid gap-1">
            {navItems
              .filter((item) => item.key !== 'admin' || isAdmin)
              .map((item) => {
                const Icon = item.icon;
                const isActive = view === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setView(item.key)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all',
                      isActive
                        ? 'bg-[#25D366]/10 text-[#25D366]'
                        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                    )}
                  >
                    <Icon size={18} className={cn('transition-colors', isActive ? 'text-[#25D366]' : 'text-zinc-500')} />
                    {item.label}
                  </button>
                );
              })}
          </nav>
        </aside>

        <section className="min-w-0 px-10 py-8 max-sm:px-5">
          <Topbar
            telegramStatus={state.telegramStatus}
            whatsAppStatus={state.whatsAppStatus}
            steps={topbarSteps}
            onLogout={async () => {
              setView('overview');
              try {
                await postJsonWithOptions('/api/whatsapp/logout-action', undefined, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
              } catch {}
              await postJsonWithOptions('/api/auth/logout', undefined, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
              await loadState();
            }}
          />

          {notice ? (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-5 py-4 text-sm font-medium text-[#25D366]">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          ) : null}

          {readOnlyAccount ? <ReadOnlyModeBanner /> : null}

          {view === 'overview' ? (
            <OverviewPanel state={state} setNotice={setNotice} setBusy={setBusy} busy={busy} refresh={loadState} setView={setView} />
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
            <GroupsPanel
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
          {view === 'activity' ? <ActivityLogPanel state={state} /> : null}
          {view === 'account' ? <AccountPanel key={accountPanelKey} state={state} refresh={loadState} setNotice={setNotice} /> : null}
          {view === 'admin' && isAdmin ? <AdminPanel state={state} refresh={refreshAdminPanel} setNotice={setNotice} /> : null}
        </section>
      </div>
    </main>
  );
}

const inputClass =
  'h-12 w-full rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm text-zinc-200 outline-none transition-all placeholder:text-zinc-500 hover:border-white/20 focus:border-[#25D366] focus:bg-white/[0.04] focus:ring-4 focus:ring-[#25D366]/10';

const primaryButton =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 text-sm font-bold text-zinc-950 transition-all hover:bg-[#25D366]/90 hover:shadow-[0_0_15px_rgba(37,211,102,0.2)] disabled:opacity-50 disabled:hover:shadow-none';

const secondaryButton =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50';

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';

      if (!result) {
        reject(new Error('não foi possível ler a imagem selecionada.'));
        return;
      }

      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error('não foi possível ler a imagem selecionada.'));
    };

    reader.readAsDataURL(file);
  });
}
