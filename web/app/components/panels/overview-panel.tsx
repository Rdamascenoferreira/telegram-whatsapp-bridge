'use client';

import { Activity, AlertCircle, CheckCircle2, Clock3, Gauge, MessageSquare, Power, RefreshCcw, Send, ShieldCheck, Trash2, TrendingUp, Users, LayoutDashboard, Wrench, CreditCard } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConnectionSummary } from '../connections-panel';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, formatNumber, formatOfferStatus, humanize, isWhatsAppConnectedStatus, lastLabel, normalizeRouteSourceId } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { ActivityOffer, AppState, ViewKey } from '../../types/panel';

const panelVersion = 'Versão 2.01';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-[#25D366]/90 disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-60';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

export function OverviewPanel({
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
  const isAdmin = Boolean(state.auth.user?.isAdmin);
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
  const [activeTab, setActiveTab] = useState<'geral' | 'tecnico' | 'plano'>('geral');
  
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
      detail: 'A captura de mensagens está pausada até concluir o login.',
      cta: 'Revisar conexão',
      goTo: 'connections'
    });
  }

  if (state.whatsAppStatus !== 'ready') {
    criticalAlerts.push({
      id: 'whatsapp-session',
      title: 'WhatsApp não está pronto',
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
    <div className="grid gap-8">
      {/* HEADER SECTION */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-md max-sm:p-6">
        <div className="flex items-start justify-between gap-4 max-md:flex-col">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-2.5 py-1 text-xs font-medium text-[#25D366]">
                {panelVersion}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300">
                Plano {state.planLimits?.label || humanize(state.auth.user?.plan || 'starter')}
              </span>
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white">Visão Geral</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Acompanhe o fluxo de mensagens e controle sua automação.
            </p>
          </div>
          
          <div className="grid min-w-[320px] gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-5 shadow-inner">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status do Motor</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {effectiveBridgeEnabled ? 'Automação Ativa' : 'Automação Pausada'}
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
                  await postJsonWithOptions('/api/system-power', { bridgeEnabled: nextValue }, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
                  await refresh();
                  setNotice(nextValue ? 'Sistema ligado.' : 'Sistema desligado.');
                  setBusy('');
                }}
              />
            </div>

            {readOnlyAccount ? (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
                Conta em teste: visualização apenas.
              </p>
            ) : !canEnableAutomation ? (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
                Ligue assim que configurar as Conexões e os Fluxos.
              </p>
            ) : null}

            {isAdmin ? (
              <button
                type="button"
                disabled={readOnlyAccount || busy === 'reset-all'}
                onClick={async () => {
                  const confirmed = window.confirm('Isso vai limpar conexões e automações. Deseja continuar?');
                  if (!confirmed) return;

                  setBusy('reset-all');
                  await postJsonWithOptions('/api/connections/reset-all', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice('Conexões resetadas. Configure tudo de novo.');
                  setBusy('');
                }}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-[13px] font-semibold text-red-400 transition hover:bg-red-500/20 hover:text-red-300 disabled:opacity-60"
              >
                <Power size={14} />
                Reset de Emergência
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* TABS NAVIGATION */}
      <div className="flex items-center gap-8 border-b border-white/5 px-4 overflow-x-auto">
        <button 
          onClick={() => setActiveTab('geral')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'geral' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <LayoutDashboard size={18} />
          Resumo Geral
        </button>
        <button 
          onClick={() => setActiveTab('tecnico')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'tecnico' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <Wrench size={18} />
          Saúde Técnica
        </button>
        <button 
          onClick={() => setActiveTab('plano')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'plano' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <CreditCard size={18} />
          Meu Plano
        </button>
      </div>

      {/* TAB CONTENT: GERAL */}
      {activeTab === 'geral' && (
        <div className="grid gap-8">
          <section className="grid gap-4 xl:grid-cols-4 max-xl:grid-cols-2 max-md:grid-cols-1">
            <Metric icon={MessageSquare} label="Recebidas" value={state.metrics.totalTelegramReceived || 0} detail="Mensagens do Telegram" />
            <Metric icon={Send} label="Enviadas" value={state.metrics.totalForwardedMessages || 0} detail="Encaminhamentos pro WhatsApp" />
            <Metric icon={Clock3} label="Fila Pendente" value={queuedCount} detail={queuedCount > 0 ? 'Aguardando envio' : 'Tudo em dia'} />
            <Metric icon={Users} label="Grupos Ativos" value={state.metrics.selectedGroupCount || 0} detail="Recebendo mensagens" />
          </section>

          {criticalAlerts.length > 0 && (
            <section className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-bold text-red-400">
                  <AlertCircle size={20} />
                  Atenção Necessária
                </h3>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy === 'overview-refresh'}
                  onClick={async () => {
                    setBusy('overview-refresh');
                    try { await refresh(); setNotice('Dashboard atualizada.'); } finally { setBusy(''); }
                  }}
                >
                  <RefreshCcw size={15} />
                  Atualizar
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {criticalAlerts.map((alert) => (
                  <article key={alert.id} className="rounded-2xl border border-red-500/20 bg-black/20 p-5 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-red-300">{alert.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-red-200/70">{alert.detail}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setView(alert.goTo)}
                        className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/20 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-500/40"
                      >
                        {alert.cta}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-[1fr_360px] gap-6 max-xl:grid-cols-1">
            <OffersPanel state={state} compact refresh={refresh} setNotice={setNotice} setBusy={setBusy} busy={busy} />
            <ConnectionSummary state={state} />
          </section>
        </div>
      )}

      {/* TAB CONTENT: TÉCNICO */}
      {activeTab === 'tecnico' && (
        <div className="grid gap-8">
          <section className="grid gap-4 xl:grid-cols-3 max-xl:grid-cols-1">
            <article className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-lg backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#25D366]">
                  <TrendingUp size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Qualidade</p>
                  <p className="text-lg font-bold text-white">{successRate}% Sucesso</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Métrica baseada no volume atual, contra {errorRate}% de erros absolutos.
              </p>
            </article>

            <article className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-lg backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <Activity size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Estabilidade</p>
                  <p className="text-lg font-bold text-white">{retriesShare}% Retentativas</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Falhas transientes (recuperáveis) representam essa parcela do fluxo.
              </p>
            </article>

            <article className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-lg backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
                  <Gauge size={20} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Eficiência</p>
                  <p className="text-lg font-bold text-white">{automationScore}/100 Score</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Saúde geral considerando tempo de resposta e fatalidades.
              </p>
            </article>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <article className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Diagnóstico de Fluxos</p>
                  <p className="mt-1 text-xs text-zinc-400">Status interno da Ponte vs Automatizador.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setView('flows')}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Abrir Fluxos
                </button>
              </div>

              <div className="mt-6 grid gap-4">
                <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-200">Ponte Direta</p>
                    <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider', bridgeHealth.label === 'Ativo' ? 'bg-[#25D366]/10 text-[#25D366]' : bridgeHealth.label === 'Pausado' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400')}>
                      {bridgeHealth.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{bridgeHealth.reason || 'Operando normalmente.'}</p>
                </div>

                <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-200">Automatizador Afiliados</p>
                    <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider', affiliateHealth.label === 'Ativo' ? 'bg-[#25D366]/10 text-[#25D366]' : affiliateHealth.label === 'Pausado' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400')}>
                      {affiliateHealth.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{affiliateHealth.reason || 'Operando normalmente.'}</p>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm shadow-xl">
              <div className="flex items-start justify-between gap-3 max-md:flex-col">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Timeline Técnica</p>
                  <p className="mt-1 text-xs text-zinc-400">Logs brutos do sistema para investigação.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setTimelineFilter('all')} className={cn('rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors', timelineFilter === 'all' ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>All</button>
                  <button type="button" onClick={() => setTimelineFilter('errors')} className={cn('rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors', timelineFilter === 'errors' ? 'border-red-500/20 bg-red-500/10 text-red-400' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>Err</button>
                </div>
              </div>

              <div className="mt-6 grid gap-2">
                {timelineEvents.length ? (
                  timelineEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-white/5 bg-black/20 p-3 transition-colors hover:bg-white/[0.04]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          {event.level === 'error' ? (
                            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                          ) : (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#25D366]" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-zinc-300 font-mono">{event.message}</p>
                          </div>
                        </div>
                        <p className="shrink-0 text-[10px] text-zinc-500">{formatDate(event.at)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500 text-center">
                    Nenhum log encontrado.
                  </p>
                )}
              </div>
            </article>
          </section>

          <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Drill-down de Erros</p>
              </div>
              <button
                type="button"
                onClick={() => setView('activity')}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Abrir Histórico Completo
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-2xl border border-white/5 bg-black/20 p-5">
                <div className="flex items-center gap-3 text-sky-400 mb-2">
                  <ShieldCheck size={20} />
                  <p className="text-sm font-bold">Duplicados Evitados</p>
                </div>
                <p className="text-3xl font-black text-white">{deliveryStats.skippedDuplicates || 0}</p>
                <p className="mt-2 text-xs text-zinc-500">Repetições ignoradas.</p>
              </article>
              
              <article className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                <div className="flex items-center gap-3 text-amber-400 mb-2">
                  <Clock3 size={20} />
                  <p className="text-sm font-bold">Falhas Transientes</p>
                </div>
                <p className="text-3xl font-black text-white">{transientFailures}</p>
                <p className="mt-2 text-xs text-zinc-500">Instabilidade de rede.</p>
              </article>

              <article className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                <div className="flex items-center gap-3 text-red-400 mb-2">
                  <AlertCircle size={20} />
                  <p className="text-sm font-bold">Falhas Fatais</p>
                </div>
                <p className="text-3xl font-black text-white">{fatalFailures}</p>
                <p className="mt-2 text-xs text-zinc-500">Exigem revisão manual.</p>
              </article>
            </div>
          </section>
        </div>
      )}

      {/* TAB CONTENT: PLANO */}
      {activeTab === 'plano' && (
        <div className="grid gap-6">
          <PlanUsageCard
            title="Uso e Limites"
            planLabel={state.planLimits?.label || humanize(state.auth.user?.plan || 'starter')}
            description="Acompanhe o que está liberado no seu plano e quanto da estrutura atual já está em uso."
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
                label: 'Automações de afiliados',
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
              { label: 'Mercado Livre', enabled: Boolean(state.planLimits?.mercadoLivreAffiliate) },
              { label: 'Histórico', enabled: Boolean((state.planLimits?.historyDays || 0) > 1), value: `${state.planLimits?.historyDays || 0} dias` },
              { label: 'Mensagens/dia', enabled: true, value: formatNumber(state.planLimits?.dailyMessages || 0) }
            ]}
          />
        </div>
      )}
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
  const allOffers = state.offers || [];
  const [offersTab, setOffersTab] = useState<'sent' | 'ignored'>('sent');
  const sentOffersRaw = allOffers.filter((offer) => String(offer.status || '').toLowerCase() === 'sent');
  const ignoredOffersRaw = allOffers.filter((offer) => String(offer.status || '').toLowerCase() === 'ignored');
  const sentOffers = compact ? sentOffersRaw.slice(0, 6) : sentOffersRaw;
  const ignoredOffers = compact ? ignoredOffersRaw.slice(0, 6) : ignoredOffersRaw;
  const offers = offersTab === 'sent' ? sentOffers : ignoredOffers;
  const readOnlyAccount = isReadOnlyAccount(state);
  const dashboardViewClearedAt = state.config.dashboardViewClearedAt || '';
  const canClearDashboard = Boolean(refresh && setNotice && setBusy);

  return (
    <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 backdrop-blur-sm shadow-xl max-sm:p-6">
      <div className="mb-8 flex items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Últimos Envios</h2>
          <p className="mt-2 text-sm text-zinc-400">
            {offersTab === 'sent'
              ? 'Mensagens encaminhadas com sucesso.'
              : 'Mensagens ignoradas e o motivo da exclusao do fluxo.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setOffersTab('sent')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                offersTab === 'sent'
                  ? 'bg-[#25D366]/20 text-[#25D366]'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              Ultimos envios
            </button>
            <button
              type="button"
              onClick={() => setOffersTab('ignored')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                offersTab === 'ignored'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              Mensagens ignoradas
            </button>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-zinc-300">
            {formatNumber(offers.length)} ofertas
          </span>
          {canClearDashboard && !readOnlyAccount && (
            <button
              type="button"
              disabled={busy === 'clear-dashboard'}
              onClick={async () => {
                if (window.confirm('Limpar visualização de envios? Isso não apaga histórico real.')) {
                  try {
                    setBusy?.('clear-dashboard');
                    await postJsonWithOptions('/api/dashboard/clear-view', undefined, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
                    await refresh?.();
                    setNotice?.('Painel limpo.');
                  } finally {
                    setBusy?.('');
                  }
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              <Trash2 size={16} />
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {offers.length ? (
          offers.map((offer) => (
            <article key={offer.id} className="group rounded-2xl border border-white/5 bg-black/20 p-5 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-start justify-between gap-4 max-sm:flex-col">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <StatusPill status={offer.status} />
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {offer.sourceLabel}
                    </span>
                    <ChannelStatusPill channel="Telegram" status={String(offer.metadata?.channels?.telegram?.status || 'received')} />
                    <ChannelStatusPill channel="WhatsApp" status={String(offer.metadata?.channels?.whatsapp?.status || 'captured')} />
                    {offer.fromQueue && (
                      <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-sky-400">
                        Fila
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Mensagem de saida</p>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-200 whitespace-pre-wrap break-words">{offer.preview}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold text-zinc-500">{formatDate(offer.lastUpdatedAt || offer.at)}</p>
                  <p className="mt-2 text-xs font-semibold text-[#25D366]">{offer.groupCount} Grupo(s)</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>WhatsApp: {formatOfferDeliverySummary(offer)}</span>
                <span>Telegram: {formatOfferTelegramSummary(offer)}</span>
              </div>
              {offer.reason && (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-200/80">Motivo: {describeOfferReason(offer)}</p>
                </div>
              )}
              {!offer.reason && offer.status === 'ignored' ? (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-200/80">Motivo: Mensagem ignorada por regra de fluxo.</p>
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 p-12 text-center">
             <MessageSquare className="mx-auto mb-4 text-zinc-600" size={32} />
             <p className="text-base font-semibold text-zinc-300">
               {offersTab === 'sent' ? 'Nenhum envio concluido' : 'Nenhuma mensagem ignorada'}
             </p>
             <p className="mt-2 text-sm text-zinc-500">
               {offersTab === 'sent'
                 ? 'As mensagens encaminhadas com sucesso aparecerao aqui.'
                 : 'As mensagens ignoradas e seus motivos aparecerao aqui.'}
             </p>
             {dashboardViewClearedAt ? (
               <p className="mt-2 text-xs text-zinc-500">
                 Visualizacao filtrada desde {formatDate(dashboardViewClearedAt)}. Novos envios aparecerao apos essa data.
               </p>
             ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function ChannelStatusPill({ channel, status }: { channel: string; status: string }) {
  const normalized = String(status || '').toLowerCase();
  const color =
    normalized === 'sent' || normalized === 'received'
      ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]'
      : normalized === 'partial'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
        : normalized === 'queued' || normalized === 'captured'
          ? 'border-sky-500/20 bg-sky-500/10 text-sky-400'
          : 'border-red-500/20 bg-red-500/10 text-red-400';

  return (
    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest', color)}>
      {channel} {humanize(normalized || 'unknown')}
    </span>
  );
}

function formatOfferDeliverySummary(offer: ActivityOffer) {
  const summary = offer.metadata?.channels?.whatsapp;
  if (!summary) {
    return `${offer.deliveryCount || 0} entregue(s)`;
  }

  const delivered = Number(summary.delivered || offer.deliveryCount || 0);
  const failed = Number(summary.failed || 0);
  const skipped = Number(summary.skipped || 0);
  const parts = [`${delivered} entregue(s)`];
  if (failed > 0) parts.push(`${failed} falha(s)`);
  if (skipped > 0) parts.push(`${skipped} duplicado(s)`);
  return parts.join(' | ');
}

function formatOfferTelegramSummary(offer: ActivityOffer) {
  const telegram = offer.metadata?.channels?.telegram;
  if (!telegram) {
    return 'Recebido';
  }

  const status = humanize(String(telegram.status || 'received'));
  const detail = String(telegram.detail || '').trim();
  return detail ? `${status} (${detail})` : status;
}

function describeOfferReason(offer: ActivityOffer) {
  const reason = String(offer.reason || '').trim().toLowerCase();
  if (!reason) {
    return 'Nao informado.';
  }

  const mapped: Record<string, string> = {
    bridge_disabled: 'O sistema estava desligado no momento do recebimento.',
    no_groups_selected: 'Nenhum destino do WhatsApp estava selecionado.',
    qr_required: 'O WhatsApp estava aguardando leitura do QR Code.',
    authenticated: 'O WhatsApp ainda estava autenticando.',
    connecting: 'O WhatsApp estava conectando.',
    reconnecting: 'O WhatsApp estava reconectando.',
    disconnected: 'A sessao do WhatsApp estava desconectada.',
    browser_closed: 'A janela do WhatsApp estava fechada ou reiniciando.',
    recoverable_target_error: 'Falha temporaria na sessao do WhatsApp; mensagem enviada para fila.',
    duplicate_delivery_key: 'Mensagem duplicada detectada e ignorada para evitar reenvio.'
  };

  if (mapped[reason]) {
    return mapped[reason];
  }

  if (reason.startsWith('telegram indisponivel')) {
    return 'O Telegram estava indisponivel para encaminhamento complementar.';
  }

  return humanize(offer.reason || '');
}

function StatusPill({ status }: { status: string }) {
  const label = formatOfferStatus(status);
  const className =
    status === 'sent'
      ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]'
      : status === 'queued'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
        : status === 'failed'
          ? 'border-red-500/20 bg-red-500/10 text-red-400'
          : status === 'ignored'
            ? 'border-zinc-600/20 bg-zinc-600/10 text-zinc-400'
            : 'border-sky-500/20 bg-sky-500/10 text-sky-400';

  return <span className={cn('rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider', className)}>{label}</span>;
}

function SystemPowerSwitch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (nextValue: boolean) => Promise<void>; }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => void onChange(!checked)}
      className={cn(
        'relative inline-flex h-10 w-20 shrink-0 items-center rounded-full border-2 transition-all duration-300',
        checked ? 'border-[#25D366]/30 bg-[#25D366]/10 shadow-[0_0_20px_rgba(37,211,102,0.2)]' : 'border-white/10 bg-black/40',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-1 w-7 rounded-full transition-all duration-300',
          checked ? 'left-[calc(100%-2.2rem)] bg-[#25D366] shadow-[0_0_15px_rgba(37,211,102,0.6)]' : 'left-1.5 bg-zinc-500'
        )}
      />
    </button>
  );
}

function getFlowHealthStatus({ selected, saved, hasTelegramSession, sourceId, requiresPlan = true, hasDestinations = true }: { selected: boolean; saved: boolean; hasTelegramSession: boolean; sourceId: string; requiresPlan?: boolean; hasDestinations?: boolean; }) {
  if (!requiresPlan) return { label: 'Com erro', reason: 'Plano atual sem suporte' };
  if (!hasTelegramSession) return { label: 'Incompleto', reason: 'Telegram desconectado' };
  if (!String(sourceId || '').trim()) return { label: 'Incompleto', reason: 'Sem origem configurada' };
  if (!hasDestinations) return { label: 'Incompleto', reason: 'Sem destino WhatsApp' };
  if (selected && saved) return { label: 'Ativo', reason: '' };
  if (!selected && saved) return { label: 'Pausado', reason: 'Fluxo alternativo em uso' };
  return { label: 'Incompleto', reason: 'Não salvo' };
}

function getActiveAffiliateAutomation(state: AppState) { return (state.affiliate?.automations || []).find((a) => a.isActive) || null; }

function getOperationalTelegramSource(state: AppState) {
  if (state.telegramStatus !== 'listening') return '';
  return normalizeRouteSourceId(getActiveAffiliateAutomation(state)?.telegramSourceGroupId || state.config.telegramChannel);
}

function hasOperationalTelegramSource(state: AppState) { return Boolean(getOperationalTelegramSource(state)); }

function hasOperationalWhatsAppDestination(state: AppState) { return (state.config.selectedGroupIds?.length || 0) > 0; }

function canEnableAutomationState(state: AppState) {
  return state.telegramStatus === 'listening' && isWhatsAppConnectedStatus(state.whatsAppStatus) && hasOperationalTelegramSource(state) && hasOperationalWhatsAppDestination(state);
}

function getAutomationLockReason(state: AppState) {
  if (state.telegramStatus !== 'listening') return 'Conecte e conclua o login no Telegram para liberar a automação.';
  if (!isWhatsAppConnectedStatus(state.whatsAppStatus)) return 'Conecte o WhatsApp e aguarde o status ficar pronto para liberar a automação.';
  if (!hasOperationalTelegramSource(state)) return 'Escolha e salve uma origem no fluxo ativo antes de ligar o sistema.';
  if (!hasOperationalWhatsAppDestination(state)) return 'Escolha ao menos um destino do WhatsApp antes de ligar o sistema.';
  return '';
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Gauge; label: string; value: number; detail: string; }) {
  return (
    <article className="group rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:bg-white/[0.04]">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25D366]/10 text-[#25D366] transition-colors group-hover:bg-[#25D366]/20">
          <Icon size={24} />
        </div>
        <div>
          <p className="text-3xl font-black tracking-tight text-white">{formatNumber(value)}</p>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">{label}</p>
        </div>
      </div>
      <p className="mt-4 text-xs font-medium text-zinc-400">{detail}</p>
    </article>
  );
}

function PlanUsageCard({ title, planLabel, description, items, featureBadges }: { title: string; planLabel: string; description: string; items: Array<{ label: string; used: number; limit: number; detail: string; }>; featureBadges: Array<{ label: string; enabled: boolean; value?: string; }>; }) {
  return (
    <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-sm max-sm:p-6">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={18} className="text-[#25D366]" />
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">{title}</p>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white">{planLabel}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
        <span className="rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-4 py-2 text-sm font-bold text-[#25D366]">Plano Ativo</span>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {items.map((item) => {
          const safeLimit = Math.max(1, item.limit || 0);
          const percent = Math.max(0, Math.min(100, Math.round((item.used / safeLimit) * 100)));
          return (
            <article key={item.label} className="rounded-2xl border border-white/5 bg-black/20 p-6 transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-zinc-200">{item.label}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-400">{item.used}/{item.limit}</span>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-[#25D366] transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-5 text-xs font-medium leading-relaxed text-zinc-500">{item.detail}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-8 pt-6 border-t border-white/5 flex flex-wrap gap-3">
        {featureBadges.map((feature) => (
          <span key={feature.label} className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-wider', feature.enabled ? 'border-[#25D366]/20 bg-[#25D366]/5 text-zinc-200' : 'border-white/5 bg-black/20 text-zinc-500')}>
            <span className={cn('h-2 w-2 rounded-full shadow-[0_0_10px_rgba(0,0,0,0)]', feature.enabled ? 'bg-[#25D366] shadow-[#25D366]/50' : 'bg-zinc-600')} />
            {feature.label}
            {feature.value ? `: ${feature.value}` : feature.enabled ? ' Liberado' : ' Bloqueado'}
          </span>
        ))}
      </div>
    </section>
  );
}
