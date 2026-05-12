'use client';

import { Bot, CheckCircle2, Power, RefreshCcw, Search, Shield, Smartphone, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { InternalSetupChecklist } from '../connections-panel';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, isWhatsAppConnectedStatus } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState, WhatsAppGroup } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#25D366]/90 disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-60';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

export function GroupsPanel({
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
  const isAdmin = Boolean(state.auth.user?.isAdmin);
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
    <div className="grid gap-8">
      <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-md max-sm:p-6">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">WhatsApp</p>
            <div className="mt-4 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/10 text-[#25D366]">
                <Smartphone size={24} />
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-white">Central do WhatsApp</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Conecte sua conta, escaneie o QR Code e mantenha a sessão pronta. A escolha dos grupos de destino deve ser feita na aba Fluxos.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-4 py-2 text-xs font-bold text-[#25D366]">
              {whatsAppStatusLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400">
              {state.whatsAppPhone || 'Sem sessão conectada'}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="grid gap-8">
          <InternalSetupChecklist
            title="Checklist de Configuração"
            steps={whatsappInternalChecklist}
            complete={whatsappChecklistComplete}
            completeLabel="WhatsApp 100% conectado"
          />

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/10 text-[#25D366]">
                  <Smartphone size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Conexão</p>
                  <p className="mt-1 text-sm font-bold text-white">{whatsAppConnected ? 'Pronta para uso' : hasQrCode ? 'Aguardando leitura' : 'Desconectada'}</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-400">
                {whatsAppConnected ? 'Sessão autenticada e operando normalmente.' : 'Use o QR Code ao lado para concluir a autenticação.'}
              </p>
            </div>

            <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
                  <Users size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Destinos Salvos</p>
                  <p className="mt-1 text-sm font-bold text-white">{selectedGroups.length} grupo(s)</p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-400">
                A seleção de destinos agora é gerenciada dentro da aba Fluxos.
              </p>
            </div>

            <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-zinc-300">
                  <Shield size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Leitura de Grupos</p>
                  <p className="mt-1 text-sm font-bold text-white">
                    {state.metrics.groupsRefreshing
                      ? `${state.metrics.groupRefreshProgress?.percent || 0}%`
                      : `${state.metrics.availableAdminGroupCount || 0} encontrados`}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-400">
                {state.metrics.groupsRefreshing ? 'Sincronização em andamento...' : 'Grupos detectados com acesso de admin.'}
              </p>
            </div>
          </div>

          {state.issue?.message ? (
            <p className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm font-bold text-red-400">
              {state.issue.message}
            </p>
          ) : null}

          <div className="rounded-3xl border border-white/5 bg-black/20 p-8">
            <div className="flex items-start justify-between gap-4 max-lg:flex-col">
              <div>
                <h3 className="text-xl font-bold text-white">Conexão do WhatsApp</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Use a reconexão para forçar uma nova tentativa sem perder os dados da conta.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-400">
                  Seguro
                </span>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setShowAdvancedActions((current) => !current)}
                    className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs font-bold text-amber-400 transition hover:bg-amber-500/20"
                  >
                    {showAdvancedActions ? 'Ocultar Avançadas' : 'Ações Avançadas'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <button
                type="button"
                disabled={readOnlyAccount || busy === 'wa-reconnect'}
                onClick={async () => {
                  setBusy('wa-reconnect');
                  await postJsonWithOptions('/api/whatsapp/reconnect', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice('Reconexão do WhatsApp solicitada.');
                  setBusy('');
                }}
                className="group rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25D366]/10 text-[#25D366] transition-transform group-hover:scale-110">
                    <RefreshCcw size={20} />
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">Reconectar Sessão</p>
                    <p className="mt-1 text-sm text-zinc-400">Solicita uma nova tentativa de conexão com a mesma conta.</p>
                  </div>
                </div>
              </button>
            </div>

            {isAdmin && showAdvancedActions ? (
              <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
                <div className="flex items-start justify-between gap-4 max-md:flex-col">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Ações Destrutivas</p>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                      Use somente quando precisar trocar a conta ou limpar completamente o ambiente.
                    </p>
                  </div>
                  <span className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400">
                    Admin Only
                  </span>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    disabled={readOnlyAccount || busy === 'wa-reset'}
                    onClick={async () => {
                      if (destructiveConfirmStep !== 'wa-reset') {
                        setDestructiveConfirmStep('wa-reset');
                        return;
                      }

                      setBusy('wa-reset');
                      await postJsonWithOptions('/api/whatsapp/reset-session', undefined, { timeoutMs: HTTP_TIMEOUT_MS.LONG });
                      await refresh();
                      setNotice('Nova sessão preparada.');
                      setBusy('');
                      setDestructiveConfirmStep(null);
                    }}
                    className={cn(
                      'group rounded-2xl border p-5 text-left transition-colors disabled:opacity-50',
                      destructiveConfirmStep === 'wa-reset'
                        ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-110",
                        destructiveConfirmStep === 'wa-reset' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white'
                      )}>
                        <Bot size={20} />
                      </div>
                      <div>
                        <p className={cn("text-base font-bold", destructiveConfirmStep === 'wa-reset' ? 'text-amber-400' : 'text-white')}>
                          {destructiveConfirmStep === 'wa-reset' ? 'Confirmar Troca' : 'Trocar Conta'}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {destructiveConfirmStep === 'wa-reset'
                            ? 'Isso invalidará a sessão atual.'
                            : 'Gera novo QR para outra conta.'}
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
                      await postJsonWithOptions('/api/connections/reset-all', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                      await refresh();
                      setNotice('Reset completo efetuado.');
                      setBusy('');
                      setDestructiveConfirmStep(null);
                    }}
                    className={cn(
                      'group rounded-2xl border p-5 text-left transition-colors disabled:opacity-50',
                      destructiveConfirmStep === 'reset-all'
                        ? 'border-red-500/30 bg-red-500/20 hover:bg-red-500/30'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 transition-transform group-hover:scale-110">
                        <Power size={20} />
                      </div>
                      <div>
                        <p className="text-base font-bold text-red-400">
                          {destructiveConfirmStep === 'reset-all' ? 'Confirmar Reset' : 'Reset Completo'}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {destructiveConfirmStep === 'reset-all'
                            ? 'Remove todas as conexões ativas.'
                            : 'Limpa conexões e configurações.'}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
                {destructiveConfirmStep ? (
                  <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 max-md:flex-col max-md:items-start">
                    <span className="text-sm font-bold text-amber-400">
                      Confirmação em 2 passos ativa.
                    </span>
                    <button
                      type="button"
                      onClick={() => setDestructiveConfirmStep(null)}
                      className="rounded-xl border border-amber-500/30 bg-amber-500/20 px-4 py-1.5 text-xs font-bold text-amber-400 transition hover:bg-amber-500/30"
                    >
                      Cancelar Ação
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 border-t border-white/5 pt-6">
              <h4 className="text-sm font-bold text-white">Comportamento ao sair</h4>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                Recomendamos manter a sessão conectada para facilitar retornos futuros.
              </p>
              
              <label className="mt-4 flex cursor-pointer items-start gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                <div className="relative mt-0.5 flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={disconnectOnLogout}
                    onChange={(event) => setDisconnectOnLogout(event.target.checked)}
                    disabled={readOnlyAccount || busy === 'wa-logout-behavior'}
                    className="peer h-5 w-5 cursor-pointer appearance-none rounded border-2 border-zinc-600 bg-transparent transition-all checked:border-[#25D366] checked:bg-[#25D366] disabled:cursor-not-allowed"
                  />
                  <CheckCircle2 size={14} className="absolute pointer-events-none text-black opacity-0 peer-checked:opacity-100" />
                </div>
                <div>
                  <span className="block text-sm font-bold text-white">Desconectar WhatsApp ao Sair</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-400">
                    Se ativado, ao fazer logout a sessão do WhatsApp será encerrada e um novo QR será exigido no retorno.
                  </span>
                </div>
              </label>
              
              <div className="mt-4">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={readOnlyAccount || busy === 'wa-logout-behavior'}
                  onClick={async () => {
                    setBusy('wa-logout-behavior');
                    try {
                      await postJsonWithOptions('/api/whatsapp/logout-behavior', {
                        disconnectWhatsAppOnLogout: disconnectOnLogout
                      }, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
                      await refresh();
                      setNotice('Preferência de saída salva.');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  Salvar Preferência
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-white">QR Code</h3>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                {hasQrCode
                  ? 'Escaneie para concluir a autenticação.'
                  : whatsAppConnected
                    ? 'Sessão conectada.'
                    : 'Aguarde o carregamento do QR.'}
              </p>
            </div>
            <span className={cn(
              "rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider",
              hasQrCode ? "border-amber-500/20 bg-amber-500/10 text-amber-400" : whatsAppConnected ? "border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]" : "border-white/10 bg-white/5 text-zinc-400"
            )}>
              {hasQrCode ? 'Ler QR Code' : whatsAppConnected ? 'Ativo' : 'Aguarde'}
            </span>
          </div>

          <div className="mt-6 rounded-2xl border border-white/5 bg-black/40 p-6">
            {state.qrDataUrl ? (
              <div className="rounded-xl bg-white p-4 shadow-2xl transition-transform hover:scale-[1.02]">
                <img src={state.qrDataUrl} alt="QR Code do WhatsApp" className="mx-auto h-auto max-w-full rounded-md" />
              </div>
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
                <div className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl border",
                  whatsAppConnected ? "border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]" : "border-white/10 bg-white/5 text-zinc-500"
                )}>
                  {whatsAppConnected ? <Shield size={32} /> : <Smartphone size={32} />}
                </div>
                <p className="text-sm font-semibold text-zinc-400 max-w-[200px]">
                  {whatsAppConnected
                    ? 'Autenticação concluída e segura.'
                    : whatsAppReconnecting
                      ? 'Reconectando sessão salva...'
                      : 'Nenhum QR disponível.'}
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs leading-relaxed text-sky-400 font-semibold">
            <span className="text-sky-300">Dica Prática:</span> Mantenha esta aba aberta apenas para login. Toda a configuração de para onde as mensagens vão acontece na aba Fluxos.
          </div>
        </div>
      </section>

      {/* Legacy hidden component - kept for safety as requested */}
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
              await postJsonWithOptions('/api/refresh-groups', undefined, { timeoutMs: HTTP_TIMEOUT_MS.LONG });
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
                await postJsonWithOptions('/api/groups', { selectedGroupIds: [...selected] }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
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
