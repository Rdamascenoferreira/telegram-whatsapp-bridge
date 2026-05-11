'use client';

import { AlertCircle, ArrowRight, Bot, CheckCircle2, Clock3, RefreshCcw, Search, Shield, Smartphone, Users, X, Zap } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Field, InternalSetupChecklist } from '../common-ui';
import { FlowSaveActionsCard } from '../flow-save-actions-card';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, humanize, isWhatsAppConnectedStatus, normalizeRouteSourceId, normalizeText } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState, FlowFieldErrors, ViewKey, WhatsAppGroup } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
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
    activeAffiliateAutomation?.telegramSourceGroupId || state.config.telegramChannel
  );
}

function hasOperationalTelegramSource(state: AppState) {
  return Boolean(getOperationalTelegramSource(state));
}

function hasOperationalWhatsAppDestination(state: AppState) {
  return (state.config.selectedGroupIds?.length || 0) > 0;
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
  if (!requiresPlan) return { label: 'Com erro', reason: 'Plano atual sem suporte' };
  if (!hasTelegramSession) return { label: 'Incompleto', reason: 'Telegram desconectado' };
  if (!String(sourceId || '').trim()) return { label: 'Incompleto', reason: 'Sem origem configurada' };
  if (!hasDestinations) return { label: 'Incompleto', reason: 'Sem destino WhatsApp' };
  if (selected && saved) return { label: 'Ativo', reason: '' };
  if (!selected && saved) return { label: 'Pausado', reason: 'Fluxo alternativo em uso' };
  return { label: 'Incompleto', reason: 'não salvo' };
}

function getTelegramChatName(state: AppState, sourceId?: string | null) {
  const normalizedSourceId = normalizeRouteSourceId(sourceId);
  return (
    state.telegram.availableChats?.find((chat) => normalizeRouteSourceId(chat.id) === normalizedSourceId)?.name ||
    normalizedSourceId ||
    'Nenhuma origem escolhida'
  );
}


export function FlowsPanel({
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
          await postJsonWithOptions(`/api/affiliate/automations/${configuredAffiliateAutomation.id}/toggle`, { isActive: false }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
        }

        await postJsonWithOptions('/api/settings', {
          telegramMode: 'user',
          telegramChannel,
          telegramApiId: state.config.telegramApiId,
          telegramApiHash: state.config.telegramApiHash,
          telegramPhone: state.config.telegramPhone,
          telegramBotToken: ''
        }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
        setNotice('Fluxo Ponte Telegram -> WhatsApp salvo com sucesso.');
      } else {
        await postJsonWithOptions('/api/affiliate/automations', {
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
        }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
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
      setNotice(error instanceof Error ? error.message : 'não foi possível salvar o fluxo.');
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
                    Ideal para ler a oferta, converter links Amazon ou Shopee com suas configurações de afiliado e só depois enviar a mensagem final.
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
                  Os dois fluxos usam os destinos escolhidos aqui em Fluxos. Hoje sua conta está com {selectedWhatsAppDestinationCount} grupo(s) pronto(s) para receber mensagens.
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
                  await postJsonWithOptions('/api/telegram/refresh-chats', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
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
            void postJsonWithOptions('/api/refresh-groups', undefined, { timeoutMs: HTTP_TIMEOUT_MS.LONG })
              .then(async () => {
                await refresh();
                setNotice('Lista de grupos do WhatsApp atualizada.');
              })
              .catch(() => {
                setNotice('não foi possível atualizar os grupos agora. Tente reconectar o WhatsApp e repetir.');
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
                  : 'O WhatsApp ainda está devolvendo a lista inicial. Na primeira sincronização isso pode levar alguns minutos.'}
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
            Anúncios
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
            Selecionar visíveis
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
            Limpar visíveis
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
              A seleção atual ultrapassa o limite do plano. Ajuste antes de salvar.
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
              await postJsonWithOptions('/api/groups', { selectedGroupIds: [...selected] }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
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


