'use client';

import { AlertCircle, ArrowRight, Bot, CheckCircle2, Clock3, RefreshCcw, Search, Shield, Smartphone, Users, X, Zap } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '../common-ui';
import { InternalSetupChecklist } from '../connections-panel';
import { FlowSaveActionsCard } from '../flow-save-actions-card';
import { ApiRequestError, HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { formatDate, formatOfferStatus, humanize, isWhatsAppConnectedStatus, normalizeRouteSourceId, normalizeText } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState, FlowFieldErrors, ViewKey, WhatsAppGroup } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#25D366]/90 disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-60';

const inputClass =
  'h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 hover:border-white/20 focus:border-[#25D366] focus:bg-black/40 focus:ring-2 focus:ring-[#25D366]/20 disabled:opacity-60 disabled:cursor-not-allowed';

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
  return { label: 'Incompleto', reason: 'Não salvo' };
}

function getTelegramChatName(state: AppState, sourceId?: string | null) {
  const normalizedSourceId = normalizeRouteSourceId(sourceId);
  return (
    state.telegram.availableChats?.find((chat) => normalizeRouteSourceId(chat.id) === normalizedSourceId)?.name ||
    normalizedSourceId ||
    'Nenhuma origem escolhida'
  );
}

function formatMediaSourceMode(value?: string) {
  return String(value || '').toLowerCase() === 'product_image'
    ? 'Imagem do link do produto'
    : 'Imagem original do Telegram';
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
        `Encaminhar para Telegram: ${savedAffiliateForwardEnabled ? getTelegramChatName(state, savedAffiliateForwardDestinationId) : 'Não'} -> ${affiliateTelegramForwardEnabled && nextForwardDestinationId ? getTelegramChatName(state, nextForwardDestinationId) : 'Não'}`
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
      setNotice('Nenhuma alteração detectada no fluxo.');
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
      setNotice(error instanceof Error ? error.message : 'Não foi possível salvar o fluxo.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid gap-8">
      {/* HEADER */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-md max-sm:p-6">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Configuração Estrutural</p>
            <div className="mt-4 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/10 text-[#25D366]">
                <ArrowRight size={24} />
              </div>
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-white">Fluxos da Operação</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Escolha como a conta vai trabalhar: ponte simples para republicar exatamente o que chega do Telegram ou automatizador de ofertas para tratar links de afiliado antes do envio.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-4 py-2 text-xs font-bold text-[#25D366]">
              {selectedWhatsAppDestinationCount} destino(s) ativo(s)
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400">
              {hasSavedSource ? 'Fluxo Salvo' : 'Aguardando Configuração'}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-8">
        <InternalSetupChecklist
          title="Checklist de Preparação"
          steps={flowChecklist}
          complete={flowChecklistComplete}
          completeLabel="Fluxo operacional pronto para rodar"
        />

        <form ref={flowFormRef} onSubmit={(event) => { event.preventDefault(); void saveFlow(); }} className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-sm max-sm:p-6">
          {flowFieldErrors.flow || flowFieldErrors.telegram || flowFieldErrors.destinations ? (
            <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-4 text-sm font-semibold text-red-400">
              {flowFieldErrors.flow || flowFieldErrors.telegram || flowFieldErrors.destinations}
            </div>
          ) : null}

          <div className="mb-8 flex items-start justify-between gap-4 max-md:flex-col border-b border-white/5 pb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Motor de Encaminhamento</p>
              <h3 className="mt-1 text-xl font-bold text-white">Um fluxo ativo por vez</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                A mesma conta pode usar a ponte simples ou o automatizador de ofertas. Apenas um fica ativo por vez para evitar envios duplicados.
              </p>
            </div>
            <span className={cn('rounded-xl border px-3 py-1.5 text-xs font-bold shrink-0', hasTelegramSession ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]' : 'border-amber-500/20 bg-amber-500/10 text-amber-400')}>
              {hasTelegramSession ? 'Telegram Conectado' : 'Conecte o Telegram primeiro'}
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Fluxo 1: Ponte Simples */}
            <div className={cn('rounded-3xl border p-6 transition-all duration-300', telegramFlow === 'bridge' ? 'border-[#25D366]/30 bg-[#25D366]/5 shadow-[0_0_30px_rgba(37,211,102,0.05)]' : 'border-white/5 bg-black/20 hover:bg-white/[0.02]', !isAutomationEditing && 'opacity-70')}>
              <button
                type="button"
                disabled={readOnlyAccount || !isAutomationEditing}
                onClick={() => setTelegramFlow('bridge')}
                className="w-full text-left disabled:cursor-not-allowed"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={cn('text-[10px] font-bold uppercase tracking-wider', telegramFlow === 'bridge' ? 'text-[#25D366]' : 'text-zinc-500')}>Fluxo 1</p>
                    <h4 className="mt-1 text-lg font-bold text-white">Ponte Direta</h4>
                  </div>
                  <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors', telegramFlow === 'bridge' ? 'border-[#25D366] bg-[#25D366]' : 'border-zinc-600')}>
                    {telegramFlow === 'bridge' && <CheckCircle2 size={14} className="text-black" />}
                  </div>
                </div>
                <p className="mt-3 text-xs font-bold text-zinc-400">
                  Status: <span className={bridgeFlowStatus.label === 'Ativo' ? 'text-[#25D366]' : 'text-amber-400'}>{bridgeFlowStatus.label}</span>
                  {bridgeFlowStatus.reason ? ` - ${bridgeFlowStatus.reason}` : ''}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                  Ideal para encaminhar a mensagem do Telegram exatamente como chegou, sem modificações.
                </p>
              </button>

              <div className={cn("mt-6 grid gap-4 transition-opacity", telegramFlow === 'bridge' ? 'opacity-100' : 'opacity-30 pointer-events-none')}>
                <label className="grid gap-2 text-sm font-bold text-zinc-300">
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
                {telegramFlow === 'bridge' && flowFieldErrors.telegramSourceGroupId && (
                  <p className="text-xs font-bold text-red-400">{flowFieldErrors.telegramSourceGroupId}</p>
                )}
              </div>
            </div>

            {/* Fluxo 2: Afiliado */}
            <div className={cn('rounded-3xl border p-6 transition-all duration-300', telegramFlow === 'affiliate' ? 'border-[#25D366]/30 bg-[#25D366]/5 shadow-[0_0_30px_rgba(37,211,102,0.05)]' : 'border-white/5 bg-black/20 hover:bg-white/[0.02]', !isAutomationEditing && 'opacity-70')}>
              <button
                type="button"
                disabled={readOnlyAccount || !isAutomationEditing || !affiliateModuleAllowed}
                onClick={() => setTelegramFlow('affiliate')}
                className="w-full text-left disabled:cursor-not-allowed"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={cn('text-[10px] font-bold uppercase tracking-wider', telegramFlow === 'affiliate' ? 'text-[#25D366]' : 'text-zinc-500')}>Fluxo 2</p>
                    <h4 className="mt-1 text-lg font-bold text-white">Automatizador de Ofertas</h4>
                  </div>
                  <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors', telegramFlow === 'affiliate' ? 'border-[#25D366] bg-[#25D366]' : 'border-zinc-600')}>
                    {telegramFlow === 'affiliate' && <CheckCircle2 size={14} className="text-black" />}
                  </div>
                </div>
                <p className="mt-3 text-xs font-bold text-zinc-400">
                  Status: <span className={affiliateFlowStatus.label === 'Ativo' ? 'text-[#25D366]' : 'text-amber-400'}>{affiliateFlowStatus.label}</span>
                  {affiliateFlowStatus.reason ? ` - ${affiliateFlowStatus.reason}` : ''}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                  Lê a oferta, converte links para o seu ID de afiliado, e só depois envia a mensagem.
                </p>
              </button>

              <div className={cn("mt-6 grid gap-4 transition-opacity", telegramFlow === 'affiliate' ? 'opacity-100' : 'opacity-30 pointer-events-none')}>
                <label className="grid gap-2 text-sm font-bold text-zinc-300">
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
                {telegramFlow === 'affiliate' && flowFieldErrors.telegramSourceGroupId && (
                  <p className="text-xs font-bold text-red-400">{flowFieldErrors.telegramSourceGroupId}</p>
                )}
                
                <label className="mt-2 flex cursor-pointer items-start gap-4 rounded-2xl border border-white/5 bg-black/20 p-4 transition hover:bg-black/40">
                  <div className="relative mt-0.5 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={affiliateTelegramForwardEnabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setAffiliateTelegramForwardEnabled(enabled);
                        if (!enabled) setAffiliateTelegramDestinationId('');
                      }}
                      disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded border-2 border-zinc-600 bg-transparent transition-all checked:border-[#25D366] checked:bg-[#25D366] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <CheckCircle2 size={14} className="absolute pointer-events-none text-black opacity-0 peer-checked:opacity-100" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold text-white">Encaminhar também para Telegram</span>
                    <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                      Opcional. Publica a mensagem já formatada em um canal do Telegram onde você seja admin.
                    </span>
                  </div>
                </label>
                
                {affiliateTelegramForwardEnabled && (
                  <>
                    <label className="grid gap-2 text-sm font-bold text-zinc-300">
                      Destino opcional no Telegram
                      <select
                        value={affiliateTelegramDestinationId}
                        onChange={(event) => setAffiliateTelegramDestinationId(event.target.value)}
                        className={inputClass}
                        disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                      >
                        <option value="">Não encaminhar para Telegram</option>
                        {telegramAdminDestinationChats.map((chat) => (
                          <option key={`forward-${chat.id}`} value={chat.id}>
                            {chat.name} ({chat.type === 'channel' ? 'canal' : 'grupo'})
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="ID manual do destino"
                      value={affiliateTelegramDestinationId}
                      onChange={setAffiliateTelegramDestinationId}
                      placeholder="-100..."
                      disabled={readOnlyAccount || !isAutomationEditing || telegramFlow !== 'affiliate' || !affiliateModuleAllowed}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
            <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
              <p className="text-sm font-bold text-white">
                Resumo Atual: {telegramFlow === 'bridge' ? 'Ponte Direta' : 'Automatizador'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                O fluxo selecionado enviará as mensagens para os {selectedWhatsAppDestinationCount} destinos do WhatsApp configurados abaixo.
              </p>
              
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Ponte Simples</p>
                  <p className="mt-2 text-sm font-bold text-white truncate">{selectedBridgeName}</p>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#25D366]">Automatizador</p>
                  <p className="mt-2 text-sm font-bold text-white truncate">{selectedAffiliateName}</p>
                  <p className="mt-2 text-[11px] font-semibold text-zinc-500 truncate">
                    Telegram extra: {activeAutomation?.telegramForwardEnabled && activeAutomation?.telegramDestinationGroupId ? selectedAffiliateTelegramDestinationName : 'Off'}
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
              telegramForwardLabel={telegramFlow === 'affiliate' && affiliateTelegramForwardEnabled && affiliateTelegramDestinationId ? getTelegramChatName(state, affiliateTelegramDestinationId) : 'Não'}
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
                setNotice('Lista atualizada.');
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
  
  const groupsPhaseLabel =
    groupsPhase === 'loading_groups' ? 'Carregando lista'
      : groupsPhase === 'checking_admins' ? 'Verificando permissão'
      : groupsPhase === 'done' ? 'Atualizado'
      : groupsPhase === 'error' ? 'Falha ao atualizar' : 'Preparando leitura';
  
  const cachedAtLabel = state.metrics.groupCacheRefreshedAt ? formatDate(state.metrics.groupCacheRefreshedAt) : '';
  const selectedGroups = useMemo(() => state.groups.filter((group) => selected.has(group.id)), [selected, state.groups]);
  const savedSelectedSet = useMemo(() => new Set(state.config.selectedGroupIds || []), [state.config.selectedGroupIds]);
  const selectedCount = selected.size;
  const savedCount = savedSelectedSet.size;
  const selectionDelta = selectedCount - savedCount;
  const overPlanLimit = selectedCount > whatsappDestinationLimit;
  const staleSelectedIds = useMemo(() => [...selected].filter((groupId) => !state.groups.some((group) => group.id === groupId)), [selected, state.groups]);
  const hasStaleSelections = staleSelectedIds.length > 0;
  
  const filteredGroups = useMemo(() => {
    const normalized = normalizeText(filter);
    return state.groups
      .filter((group) => {
        if (quickFilter === 'selected') return selected.has(group.id);
        if (quickFilter === 'community') return Boolean(group.isCommunityLinked) && !Boolean(group.isAnnouncement);
        if (quickFilter === 'announcement') return Boolean(group.isAnnouncement);
        return true;
      })
      .filter((group) => normalizeText(group.name).includes(normalized))
      .sort((left, right) => Number(selected.has(right.id)) - Number(selected.has(left.id)));
  }, [filter, quickFilter, selected, state.groups]);

  const visibleSelectableGroupIds = useMemo(() => filteredGroups.map((group) => group.id), [filteredGroups]);

  useEffect(() => {
    if (!state.metrics.groupsRefreshing) return;
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh, state.metrics.groupsRefreshing]);

  return (
    <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-sm max-sm:p-6">
      <div className="mb-8 flex items-start justify-between gap-4 max-md:flex-col border-b border-white/5 pb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Destinos WhatsApp</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Grupos que recebem os fluxos</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Esta seleção vale para a ponte comum e para o Automatizador.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnlyAccount || busy === 'groups' || state.metrics.groupsRefreshing}
          onClick={async () => {
            setBusy('groups');
            setNotice('Sincronização dos grupos iniciada. Pode levar alguns minutos.');
            void postJsonWithOptions('/api/refresh-groups', undefined, { timeoutMs: HTTP_TIMEOUT_MS.LONG })
              .then(async () => { await refresh(); setNotice('Lista de grupos do WhatsApp atualizada.'); })
              .catch(() => { setNotice('Falha ao atualizar os grupos. Tente reconectar o WhatsApp.'); })
              .finally(() => setBusy(''));
            window.setTimeout(() => { void refresh().catch(() => undefined); }, 600);
          }}
          className={cn(secondaryButton, state.metrics.groupsRefreshing && 'animate-pulse')}
        >
          <RefreshCcw size={16} className={state.metrics.groupsRefreshing ? 'animate-spin' : ''} />
          {state.metrics.groupsRefreshing ? `Sincronizando ${groupsPercent}%` : 'Atualizar grupos'}
        </button>
      </div>

      {state.metrics.groupsRefreshing && (
        <div className="mb-6 overflow-hidden rounded-3xl border border-[#25D366]/20 bg-[#25D366]/5 p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4 max-md:flex-col">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#25D366]"></span>
                </span>
                <p className="text-sm font-bold text-white">Sincronizando grupos do WhatsApp</p>
                <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-3 py-1 text-xs font-bold text-[#25D366]">
                  {groupsPhaseLabel}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {groupsTotal ? 'Analisando grupos válidos para envio.' : 'Aguardando lista inicial do WhatsApp...'}
              </p>
            </div>
            <span className="rounded-xl border border-[#25D366]/30 bg-[#25D366]/20 px-4 py-2 text-sm font-black text-[#25D366]">
              {groupsTotal ? `${groupsPercent}%` : 'Preparando'}
            </span>
          </div>
          
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-[#25D366] transition-all duration-700 ease-out" style={{ width: `${groupsTotal ? Math.max(5, groupsPercent) : 10}%` }} />
          </div>
        </div>
      )}

      {!state.metrics.groupsRefreshing && state.metrics.hasCachedGroups && cachedAtLabel && (
        <div className="mb-6 rounded-2xl border border-white/5 bg-white/[0.02] px-5 py-4 text-sm text-zinc-400 flex items-center gap-3">
           <Clock3 size={18} className="text-zinc-500" />
           <span>Última lista salva: <strong className="text-white font-semibold">{cachedAtLabel}</strong></span>
        </div>
      )}

      {/* SEARCH AND FILTERS */}
      <div className="mb-6 grid gap-4 xl:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-2 hover:border-white/20 transition-colors">
          <Search size={18} className="text-zinc-500" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Buscar grupo pelo nome..."
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600 h-10"
          />
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/10 p-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'selected', label: 'Selecionados' },
              { id: 'community', label: 'Comunidades' },
              { id: 'announcement', label: 'Anúncios' }
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setQuickFilter(f.id as any)}
                className={cn(
                  'rounded-xl border px-4 py-2 text-xs font-bold transition-colors',
                  quickFilter === f.id
                    ? 'border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]'
                    : 'border-transparent text-zinc-500 hover:text-white hover:bg-white/5'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 border-l border-white/5 pl-3">
            <button
              type="button"
              disabled={readOnlyAccount || busy === 'save-groups' || visibleSelectableGroupIds.length === 0}
              onClick={() => {
                const next = new Set(selected);
                for (const groupId of visibleSelectableGroupIds) {
                  if (next.has(groupId)) continue;
                  if (next.size >= whatsappDestinationLimit) {
                    setNotice(`Limite de ${whatsappDestinationLimit} destinos atingido.`);
                    break;
                  }
                  next.add(groupId);
                }
                setSelected(next);
                setHasPendingSelectionChanges(true);
              }}
              className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-400 hover:bg-sky-500/20 disabled:opacity-50 transition-colors"
            >
              Selecionar Visíveis
            </button>
            <button
              type="button"
              disabled={readOnlyAccount || busy === 'save-groups' || visibleSelectableGroupIds.length === 0}
              onClick={() => {
                const next = new Set(selected);
                for (const groupId of visibleSelectableGroupIds) next.delete(groupId);
                setSelected(next);
                setHasPendingSelectionChanges(true);
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors"
            >
              Limpar
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-3xl border border-white/5 bg-black/20 p-6">
        <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start mb-4">
          <div>
            <p className="text-sm font-bold text-white">Grupos Selecionados</p>
            <p className="mt-1 text-xs text-zinc-500">
              {selectedGroups.length ? `${selectedGroups.length} destino(s) pronto(s) para receber mensagens.` : 'Nenhum destino selecionado ainda.'}
            </p>
          </div>
          <span className="rounded-xl border border-[#25D366]/20 bg-[#25D366]/10 px-4 py-2 text-xs font-black text-[#25D366]">
            {hasWhatsAppDestinationLimit ? `${selectedGroups.length}/${whatsappDestinationLimit}` : selectedGroups.length}
          </span>
        </div>

        {selectedGroups.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  if (readOnlyAccount) return setNotice('Conta em teste: edições bloqueadas.');
                  const next = new Set(selected);
                  next.delete(group.id);
                  setSelected(next);
                  setHasPendingSelectionChanges(true);
                }}
                className="group flex max-w-full items-center gap-2 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-[#25D366]/20 hover:border-[#25D366]/50"
              >
                <span className="truncate">{group.name}</span>
                <GroupKindBadge group={group} />
                <div className="rounded-full bg-black/20 p-0.5 text-[#25D366] group-hover:bg-red-500 group-hover:text-white transition-colors">
                  <X size={12} />
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="max-h-[500px] overflow-auto rounded-3xl border border-white/5 bg-black/20">
        {filteredGroups.length ? (
          filteredGroups.map((group) => {
            const checked = selected.has(group.id);
            const disabledByLimit = !checked && selected.size >= whatsappDestinationLimit;

            return (
              <label key={group.id} className={cn('flex cursor-pointer items-center gap-4 border-b border-white/5 px-6 py-4 transition-colors hover:bg-white/[0.02] last:border-0', disabledByLimit && 'opacity-50 cursor-not-allowed', checked && 'bg-white/[0.02]')}>
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnlyAccount || disabledByLimit}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) {
                        if (next.size >= whatsappDestinationLimit) return setNotice(`Limite de ${whatsappDestinationLimit} atingido.`);
                        next.add(group.id);
                      } else {
                        next.delete(group.id);
                      }
                      setSelected(next);
                      setHasPendingSelectionChanges(true);
                    }}
                    className="peer h-5 w-5 cursor-pointer appearance-none rounded border-2 border-zinc-600 bg-transparent transition-all checked:border-[#25D366] checked:bg-[#25D366] disabled:cursor-not-allowed"
                  />
                  <CheckCircle2 size={14} className="absolute pointer-events-none text-black opacity-0 peer-checked:opacity-100" />
                </div>
                <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", checked ? "text-white" : "text-zinc-300")}>{group.name}</span>
                <GroupKindBadge group={group} />
              </label>
            );
          })
        ) : (
          <div className="p-12 text-center text-sm text-zinc-500">Nenhum grupo encontrado com este filtro.</div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 max-lg:flex-col max-lg:items-stretch">
        <div className="flex-1 rounded-3xl border border-white/5 bg-black/20 p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Preview antes de salvar</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-bold text-zinc-300">
              Selecionados: <span className="text-white">{selectedCount}</span>
            </span>
            {hasWhatsAppDestinationLimit && (
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-bold text-zinc-300">
                Limite: <span className="text-white">{whatsappDestinationLimit}</span>
              </span>
            )}
            <span className={cn('rounded-xl border px-3 py-1.5 font-bold', selectionDelta === 0 ? 'border-white/10 bg-white/5 text-zinc-400' : selectionDelta > 0 ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-400')}>
              Modificação: {selectionDelta > 0 ? `+${selectionDelta}` : selectionDelta}
            </span>
          </div>
          {overPlanLimit && <p className="mt-3 text-xs font-bold text-red-400">A seleção atual ultrapassa o limite do plano.</p>}
          {hasStaleSelections && <p className="mt-3 text-xs font-bold text-amber-400">{staleSelectedIds.length} destino(s) não aparecem na lista e serão removidos ao salvar.</p>}
        </div>
        
        <div className="flex items-center gap-4 max-sm:flex-col max-sm:items-stretch">
          {hasPendingSelectionChanges && <span className="text-xs font-bold text-amber-400 animate-pulse">Existem alterações não salvas!</span>}
          <button
            type="button"
            disabled={readOnlyAccount || busy === 'save-groups' || overPlanLimit}
            className={cn(primaryButton, "h-14 px-8 text-base")}
            onClick={async () => {
              setBusy('save-groups');
              await postJsonWithOptions('/api/groups', { selectedGroupIds: [...selected] }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
              await refresh();
              setHasPendingSelectionChanges(false);
              setNotice('Grupos de destino salvos com sucesso.');
              setBusy('');
            }}
          >
            Salvar Destinos
          </button>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = formatOfferStatus(status);
  const className =
    status === 'sent' ? 'border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]'
      : status === 'queued' ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
      : status === 'failed' ? 'border-red-500/30 bg-red-500/10 text-red-400'
      : status === 'ignored' ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
      : 'border-sky-500/30 bg-sky-500/10 text-sky-400';

  return <span className={cn('rounded-xl border px-3 py-1 text-[10px] font-bold uppercase tracking-wider', className)}>{label}</span>;
}

function GroupKindBadge({ group }: { group: WhatsAppGroup }) {
  if (group.isAnnouncement) {
    return <span className="shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-400">Avisos</span>;
  }
  if (group.isCommunityLinked) {
    return <span className="shrink-0 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#25D366]">Comunidade</span>;
  }
  return <span className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Grupo</span>;
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
