'use client';

import { Activity, AlertCircle, CheckCircle2, Clock3, Gauge, MessageSquare, Power, RefreshCcw, Send, ShieldCheck, Trash2, TrendingUp, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConnectionSummary } from '../connections-panel';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, formatNumber, formatOfferStatus, humanize, isWhatsAppConnectedStatus, lastLabel, normalizeRouteSourceId } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState, ViewKey } from '../../types/panel';

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
    <div className="grid gap-6">
      <section className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 shadow-xl backdrop-blur-md">
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
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Operação da ponte</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Acompanhe a saúde das conexões, controle a automação e valide se as mensagens estão fluindo de forma eficiente.
            </p>
          </div>
          <div className="grid min-w-[300px] gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-5 shadow-inner">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status da automação</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {effectiveBridgeEnabled ? 'Automação ativa' : 'Automação pausada'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
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
                  await postJsonWithOptions('/api/system-power', { bridgeEnabled: nextValue }, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
                  await refresh();
                  setNotice(nextValue ? 'Sistema ligado.' : 'Sistema desligado.');
                  setBusy('');
                }}
              />
            </div>

            {readOnlyAccount ? (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
                Conta em teste: a automação fica somente para visualização até o administrador liberar.
              </p>
              ) : !canEnableAutomation ? (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
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
                  await postJsonWithOptions('/api/connections/reset-all', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice('Conexões resetadas. Agora você pode configurar tudo de novo.');
                  setBusy('');
                }}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/20 hover:text-red-300 disabled:opacity-60"
              >
                <Power size={16} />
                Começar do zero
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
        <article className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 transition-colors hover:bg-white/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Entrega</p>
          <p className="mt-2 text-sm font-medium text-zinc-200">Qualidade de entrega</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Sucesso {successRate}% vs erros {errorRate}% com base no volume atual.
          </p>
        </article>
        <article className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 transition-colors hover:bg-white/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Estabilidade</p>
          <p className="mt-2 text-sm font-medium text-zinc-200">Pressão de retries</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Falhas transientes representam {retriesShare}% do fluxo monitorado.
          </p>
        </article>
        <article className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 transition-colors hover:bg-white/[0.03]">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Eficiência</p>
          <p className="mt-2 text-sm font-medium text-zinc-200">Score operacional</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Score atual {automationScore}/100 considerando erros e severidade.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3 max-md:flex-col max-md:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Atenção agora</p>
            <p className="mt-1 text-sm text-zinc-400">Itens que podem bloquear entrega ou captura em tempo real.</p>
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

        <div className="mt-5 grid gap-3">
          {criticalAlerts.length ? (
            criticalAlerts.slice(0, 4).map((alert) => (
              <article key={alert.id} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 transition-colors hover:bg-amber-500/15">
                <div className="flex items-start justify-between gap-3 max-md:flex-col">
                  <div>
                    <p className="text-sm font-semibold text-amber-300">{alert.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-200/80">{alert.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView(alert.goTo)}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 hover:text-amber-100"
                  >
                    {alert.cta}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-[#25D366]/20 bg-[#25D366]/10 px-4 py-4 text-sm font-medium text-[#25D366]">
              <div className="h-2 w-2 rounded-full bg-[#25D366] shrink-0" />
              Operação estável: conexões, fluxo e destinos estão prontos.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr] max-xl:grid-cols-1">
        <PlanUsageCard
          title="Plano e limites"
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
        <article className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Saúde dos fluxos</p>
              <p className="mt-1 text-sm text-zinc-400">Visão rápida da Ponte e do Automatizador de Ofertas.</p>
            </div>
            <button
              type="button"
              onClick={() => setView('flows')}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Abrir Fluxos
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">Ponte Telegram &rarr; WhatsApp</p>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium',
                    bridgeHealth.label === 'Ativo'
                      ? 'border border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]'
                      : bridgeHealth.label === 'Pausado'
                        ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                        : 'border border-red-500/20 bg-red-500/10 text-red-400'
                  )}
                >
                  {bridgeHealth.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{bridgeHealth.reason || 'Fluxo pronto e em Operação.'}</p>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-200">Automatizador de Ofertas</p>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium',
                    affiliateHealth.label === 'Ativo'
                      ? 'border border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]'
                      : affiliateHealth.label === 'Pausado'
                        ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                        : 'border border-red-500/20 bg-red-500/10 text-red-400'
                  )}
                >
                  {affiliateHealth.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{affiliateHealth.reason || 'Fluxo pronto e em Operação.'}</p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3 max-md:flex-col">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Timeline operacional</p>
              <p className="mt-1 text-sm text-zinc-400">Últimos eventos com filtro rápido para investigação.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTimelineFilter('all')} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', timelineFilter === 'all' ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>Todos</button>
              <button type="button" onClick={() => setTimelineFilter('errors')} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', timelineFilter === 'errors' ? 'border-red-500/20 bg-red-500/10 text-red-400' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>Erros</button>
              <button type="button" onClick={() => setTimelineFilter('delivery')} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', timelineFilter === 'delivery' ? 'border-sky-500/20 bg-sky-500/10 text-sky-400' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>Entrega</button>
              <button type="button" onClick={() => setTimelineFilter('auth')} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', timelineFilter === 'auth' ? 'border-amber-500/20 bg-amber-500/10 text-amber-400' : 'border-white/5 bg-white/[0.02] text-zinc-500 hover:text-zinc-300')}>Autenticação</button>
            </div>
          </div>

          <div className="mt-5 grid gap-2">
            {timelineEvents.length ? (
              timelineEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      {event.level === 'error' ? (
                        <AlertCircle size={16} className="mt-0.5 text-red-400" />
                      ) : (
                        <CheckCircle2 size={16} className="mt-0.5 text-[#25D366]" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-200">{event.message}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">{humanize(event.type || 'atividade')}</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-[11px] text-zinc-500">{formatDate(event.at)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500 text-center">
                Nenhum evento encontrado para esse filtro.
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3 max-md:flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Drill-down de falhas</p>
            <p className="mt-1 text-sm text-zinc-400">Separação por tipo para acelerar correção operacional.</p>
          </div>
          <button
            type="button"
            onClick={() => setView('activity')}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Abrir Histórico completo
          </button>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          <article className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 transition-colors hover:bg-amber-500/15">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-amber-300">Falhas transientes</p>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-200">
                {transientFailures}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
              Geralmente ligadas a instabilidade de sessão/rede. Recomendado: revisar conexões e repetir sincronização.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setView('connections')}
                className="rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30 hover:text-white"
              >
                Revisar conexões
              </button>
              <button
                type="button"
                onClick={() => setView('flows')}
                className="rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30 hover:text-white"
              >
                Validar fluxo
              </button>
            </div>
          </article>

          <article className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 transition-colors hover:bg-red-500/15">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-red-400">Falhas fatais</p>
              <span className="rounded-full border border-red-500/30 bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-200">
                {fatalFailures}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-red-200/80">
              Erros que pedem ação imediata. Recomendado: checar Histórico detalhado e regras de envio/credenciais.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setView('activity')}
                className="rounded-lg border border-red-500/30 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/30 hover:text-white"
              >
                Investigar eventos
              </button>
              <button
                type="button"
                onClick={() => setView('groups')}
                className="rounded-lg border border-red-500/30 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/30 hover:text-white"
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
    <section className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Entregas</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Ofertas captadas</h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Isso limpa apenas a visualização do painel. Suas cotas, métricas reais e Histórico técnico continuam intactos.
          </p>
          {dashboardViewClearedAt ? (
            <p className="mt-1 text-[11px] text-zinc-500">Última limpeza visual: {formatDate(dashboardViewClearedAt)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300">
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
                  'Isso vai limpar apenas a visualização de ofertas e atividade recente deste painel. Deseja continuar?'
                );

                if (!confirmed) {
                  return;
                }

                try {
                  setBusy?.('clear-dashboard');
                  await postJsonWithOptions('/api/dashboard/clear-view', undefined, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
                  await refresh?.();
                  setNotice?.('Painel visual limpo com sucesso.');
                } catch (error) {
                  setNotice?.(error instanceof Error ? error.message : 'Não foi possível limpar o painel.');
                } finally {
                  setBusy?.('');
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60"
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
            <article key={offer.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={offer.status} />
                    {offer.fromQueue ? (
                      <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-400">
                        Reprocessada
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-medium leading-relaxed text-zinc-200">{offer.preview}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-zinc-500">
                  <p>{formatDate(offer.lastUpdatedAt || offer.at)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1">{offer.sourceLabel}</span>
                <span className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1">
                  {offer.messageCount} mensagem(ns)
                </span>
                <span className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1">
                  {offer.groupCount} grupo(s)
                </span>
                <span className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1">
                  {offer.deliveryCount} entrega(s)
                </span>
              </div>

              {offer.reason ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Motivo: <span className="text-zinc-300">{humanize(offer.reason)}</span>
                </p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500 text-center">
            Quando uma oferta entrar pelo Telegram, ela vai aparecer aqui com status, horário e alcance da entrega.
          </div>
        )}
      </div>
    </section>
  );
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

  return <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', className)}>{label}</span>;
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
        'relative inline-flex h-9 w-[4.5rem] shrink-0 items-center rounded-full border px-1.5 transition-all duration-300',
        checked
          ? 'border-[#25D366]/30 bg-[#25D366]/20 shadow-[0_0_15px_rgba(37,211,102,0.15)]'
          : 'border-white/10 bg-zinc-800',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-1.5 w-6 rounded-full transition-all duration-300',
          checked 
            ? 'left-[calc(100%-1.85rem)] bg-[#25D366] shadow-[0_0_10px_rgba(37,211,102,0.5)]' 
            : 'left-1.5 bg-zinc-400'
        )}
      />
      <span className="relative z-10 flex w-full justify-between px-1.5 text-[10px] font-bold uppercase tracking-wider">
        <span className={cn('transition-opacity duration-300', checked ? 'text-[#25D366] opacity-100' : 'opacity-0')}>On</span>
        <span className={cn('transition-opacity duration-300', checked ? 'opacity-0' : 'text-zinc-500 opacity-100')}>Off</span>
      </span>
    </button>
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
  return { label: 'Incompleto', reason: 'Não salvo' };
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
    <article className="group rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:bg-white/[0.04]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/50 text-[#25D366] transition-colors group-hover:bg-[#25D366]/10">
          <Icon size={16} />
        </div>
      </div>
      <strong className="mt-5 block text-4xl font-semibold tracking-tight text-white">{formatNumber(value)}</strong>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{detail}</p>
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
    <section className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{planLabel}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
        <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#25D366]">
          Plano ativo
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {items.map((item) => {
          const safeLimit = Math.max(1, item.limit || 0);
          const percent = Math.max(0, Math.min(100, Math.round((item.used / safeLimit) * 100)));

          return (
            <article key={item.label} className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-zinc-200">{item.label}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400">
                  {item.used}/{item.limit}
                </span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-[#25D366] transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-500">{item.detail}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {featureBadges.map((feature) => (
          <span
            key={feature.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
              feature.enabled
                ? 'border-[#25D366]/20 bg-[#25D366]/10 text-zinc-200'
                : 'border-white/5 bg-white/[0.02] text-zinc-500'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', feature.enabled ? 'bg-[#25D366]' : 'bg-zinc-600')} />
            {feature.label}
            {feature.value ? `: ${feature.value}` : feature.enabled ? ' liberado' : ' bloqueado'}
          </span>
        ))}
      </div>
    </section>
  );
}
