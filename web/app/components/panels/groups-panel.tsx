'use client';

import { Bot, Power, RefreshCcw, Search, Shield, Smartphone, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { InternalSetupChecklist } from '../connections-panel';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, isWhatsAppConnectedStatus } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState, WhatsAppGroup } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60';

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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Conexão</p>
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
                  <p className="text-sm font-semibold">Conexão do WhatsApp</p>
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
                    await postJsonWithOptions('/api/whatsapp/reconnect', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
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
                      <p className="mt-1 text-xs text-[var(--muted)]">Solicita uma nova tentativa de conexão.</p>
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
                    await postJsonWithOptions('/api/whatsapp/reset-session', undefined, { timeoutMs: HTTP_TIMEOUT_MS.LONG });
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
                          ? 'Clique novamente para confirmar. Isso inválida a sessão atual.'
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
                    await postJsonWithOptions('/api/connections/reset-all', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                    await refresh();
                    setNotice('Tudo foi resetado. O painel voltou ao estado inicial de conexão.');
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
                    Quando ativado, ao clicar em Sair o sistema derruba a sessão do WhatsApp e exige novo QR no próximo login.
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
                      await postJsonWithOptions('/api/whatsapp/logout-behavior', {
                        disconnectWhatsAppOnLogout: disconnectOnLogout
                      }, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
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
                      ? 'Sua sessão já está conectada. O QR Code não é mais necessário.'
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
                      : 'Nenhum QR Code disponível no momento.'}
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

