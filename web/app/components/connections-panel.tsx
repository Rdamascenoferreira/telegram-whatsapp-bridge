import { Bot, CheckCircle2, MessageSquare, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Field } from './common-ui';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../lib/http';
import { cn } from '../../lib/utils';
import { humanize } from '../../lib/panel-utils';

type ConnectionsPanelState = {
  telegramStatus: string;
  whatsAppStatus: string;
  whatsAppPhone?: string | null;
  config: {
    telegramChannel: string;
    telegramApiId: string;
    telegramApiHash: string;
    telegramPhone: string;
    hasTelegramSession: boolean;
  };
  telegram: {
    authPhase?: string;
    user?: {
      name?: string;
      username?: string;
      phone?: string;
    };
  };
  issue?: {
    message?: string;
  } | null;
};

type ConnectionsPanelProps = {
  state: ConnectionsPanelState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
  readOnlyAccount: boolean;
  primaryButtonClassName: string;
  secondaryButtonClassName: string;
};

export function ConnectionsPanel({
  state,
  setNotice,
  setBusy,
  busy,
  refresh,
  readOnlyAccount,
  primaryButtonClassName,
  secondaryButtonClassName
}: ConnectionsPanelProps) {
  const [telegramChannel, setTelegramChannel] = useState(state.config.telegramChannel || '');
  const [telegramApiId, setTelegramApiId] = useState(state.config.telegramApiId || '');
  const [telegramApiHash, setTelegramApiHash] = useState(state.config.telegramApiHash || '');
  const [telegramPhone, setTelegramPhone] = useState(state.config.telegramPhone || '');
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramPassword, setTelegramPassword] = useState('');
  const hasSavedCredentials = Boolean(state.config.telegramApiId && state.config.telegramApiHash && state.config.telegramPhone);
  const hasTelegramSession = Boolean(state.config.hasTelegramSession || state.telegramStatus === 'listening');
  const [credentialsEditing, setCredentialsEditing] = useState(!hasSavedCredentials);
  const effectiveCredentialsEditing = !hasSavedCredentials || credentialsEditing;

  function restoreSavedCredentials() {
    setTelegramApiId(state.config.telegramApiId || '');
    setTelegramApiHash(state.config.telegramApiHash || '');
    setTelegramPhone(state.config.telegramPhone || '');
  }

  const authPhase = state.telegram.authPhase || 'idle';
  const effectiveTelegramPassword = authPhase === 'password_required' ? telegramPassword : '';
  const effectiveTelegramCode = authPhase === 'idle' || authPhase === 'auth_required' ? '' : telegramCode;
  const telegramStatusLabel = humanize(state.telegramStatus || 'not_configured');
  const telegramUserLabel = state.telegram.user?.name
    ? state.telegram.user.name + (state.telegram.user.username ? ` (${state.telegram.user.username})` : '')
    : '';
  const hasTelegramConnection = state.telegramStatus === 'listening' || Boolean(state.telegram.user?.name);
  const canUseAuthStep = hasSavedCredentials && !effectiveCredentialsEditing && !hasTelegramSession;
  const credentialsLocked = hasTelegramSession || (!effectiveCredentialsEditing && hasSavedCredentials);
  const telegramCodeSent = hasTelegramSession || authPhase === 'code_required' || authPhase === 'password_required';
  const telegramInternalChecklist = [
    { label: 'Salvar credenciais', done: hasSavedCredentials, ready: credentialsEditing && Boolean(telegramApiId && telegramApiHash && telegramPhone) },
    { label: 'Enviar código', done: telegramCodeSent, ready: canUseAuthStep, blockedReason: hasSavedCredentials ? undefined : 'Salve as credenciais antes' },
    { label: 'Concluir login no Telegram', done: hasTelegramSession, ready: telegramCodeSent && !hasTelegramSession, blockedReason: telegramCodeSent ? undefined : 'Envie o código primeiro' }
  ];
  const telegramChecklistComplete = telegramInternalChecklist.every((step) => step.done);
  const telegramHeroStatusLabel = hasTelegramSession
    ? 'Sessão ativa'
    : authPhase === 'password_required'
      ? 'Senha pendente'
      : authPhase === 'code_required'
        ? 'Código pendente'
        : hasSavedCredentials
          ? 'Credenciais salvas'
          : 'Não configurado';
  const telegramHeroSessionLabel = hasTelegramConnection
    ? telegramUserLabel || state.telegram.user?.phone || 'Sessão conectada'
    : 'Sessão de usuário';

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="grid gap-8">
        {/* HEADER */}
        <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-md max-sm:p-6">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Telegram</p>
              <div className="mt-4 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
                  <MessageSquare size={24} />
                </div>
                <div>
                  <h2 className="text-3xl font-bold tracking-tight text-white">Central do Telegram</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Conecte sua conta, valide o código de acesso e mantenha a sessão do Telegram pronta para alimentar os fluxos da operação.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-400">
                {telegramHeroStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400">
                {telegramHeroSessionLabel}
              </span>
            </div>
          </div>
        </section>

        <section className="grid gap-8">
          <InternalSetupChecklist
            title="Checklist de Configuração"
            steps={telegramInternalChecklist}
            complete={telegramChecklistComplete}
            completeLabel="Telegram 100% conectado"
          />

          <div className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-sm max-sm:p-6">
            <div className="mb-8 flex items-start justify-between gap-4 max-md:flex-col border-b border-white/5 pb-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">Etapa 1</p>
                <h3 className="mt-1 text-xl font-bold text-white">Entrar na conta do Telegram</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                  Primeiro conecte sua conta. Depois a aba Fluxos liberará a escolha da origem que vai alimentar a ponte ou o automatizador.
                </p>
              </div>
              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-400 shrink-0">
                {telegramStatusLabel}
              </span>
            </div>

            <form
              className="grid gap-6"
              onSubmit={async (event) => {
                event.preventDefault();
                if (readOnlyAccount) {
                  setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
                  return;
                }
                setBusy('settings');
                await postJsonWithOptions('/api/settings', {
                  telegramMode: 'user',
                  telegramChannel: state.config.telegramChannel,
                  telegramApiId,
                  telegramApiHash,
                  telegramPhone,
                  telegramBotToken: ''
                }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                await refresh();
                setNotice('Credenciais do Telegram salvas.');
                setCredentialsEditing(false);
                setBusy('');
              }}
            >
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Modo de Conexão</p>
                <p className="mt-1 text-sm font-bold text-white">Sessão de Usuário</p>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <Field label="API ID" value={telegramApiId} onChange={setTelegramApiId} placeholder="12345678" disabled={readOnlyAccount || credentialsLocked} />
                <Field label="API Hash" value={telegramApiHash} onChange={setTelegramApiHash} placeholder="Cole o API Hash" disabled={readOnlyAccount || credentialsLocked} />
                <Field label="Telefone" value={telegramPhone} onChange={setTelegramPhone} placeholder="+55 21 99999-9999" disabled={readOnlyAccount || credentialsLocked} />
              </div>

              <div className="flex flex-wrap gap-4">
                {effectiveCredentialsEditing ? (
                  <button
                    type="submit"
                    disabled={readOnlyAccount || busy === 'settings' || hasTelegramSession}
                    className={primaryButtonClassName}
                  >
                    Salvar credenciais
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={readOnlyAccount || busy === 'settings' || hasTelegramSession}
                    className={primaryButtonClassName}
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

            <div className="mt-8 pt-8 border-t border-white/5">
              <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
                <div>
                  <button
                    type="button"
                    disabled={readOnlyAccount || busy === 'telegram-send-code' || busy === 'settings' || !canUseAuthStep}
                    onClick={async () => {
                      setBusy('telegram-send-code');
                      try {
                        await postJsonWithOptions('/api/settings', {
                          telegramMode: 'user',
                          telegramChannel: state.config.telegramChannel,
                          telegramApiId,
                          telegramApiHash,
                          telegramPhone,
                          telegramBotToken: ''
                        }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                        await postJsonWithOptions('/api/telegram/send-code', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                        await refresh();
                        setNotice('Código enviado para o Telegram.');
                      } catch (error) {
                        setNotice(error instanceof Error ? error.message : 'Não foi possível enviar o código do Telegram.');
                      } finally {
                        setBusy('');
                      }
                    }}
                    className={cn(primaryButtonClassName, "w-full h-[58px]")}
                  >
                    Enviar código
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
                  <Field
                    label="Código Recebido"
                    value={effectiveTelegramCode}
                    onChange={setTelegramCode}
                    placeholder="Digite o código do Telegram"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase === 'auth_required' || authPhase === 'idle'}
                  />
                  <Field
                    label="Senha em Duas Etapas"
                    value={effectiveTelegramPassword}
                    onChange={setTelegramPassword}
                    placeholder="Somente se solicitado"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase !== 'password_required'}
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-4">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-complete-auth' || (authPhase !== 'code_required' && authPhase !== 'password_required')}
                  onClick={async () => {
                    setBusy('telegram-complete-auth');
                    try {
                      await postJsonWithOptions('/api/telegram/complete-auth', {
                        code: effectiveTelegramCode,
                        password: effectiveTelegramPassword
                      }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                      await refresh();
                      setNotice(
                        authPhase === 'password_required'
                          ? 'Senha enviada. Conta do Telegram conectada.'
                          : 'Login do Telegram concluído.'
                      );
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir o login do Telegram.');
                    } finally {
                      setBusy('');
                    }
                  }}
                  className="inline-flex h-[58px] items-center justify-center gap-2 rounded-[18px] bg-sky-500 px-6 font-bold text-white transition hover:bg-sky-400 disabled:opacity-50"
                >
                  {authPhase === 'password_required' ? 'Enviar senha' : 'Concluir login'}
                </button>

                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-disconnect' || !hasSavedCredentials}
                  onClick={async () => {
                    setBusy('telegram-disconnect');
                    await postJsonWithOptions('/api/telegram/disconnect', undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                    setTelegramApiId('');
                    setTelegramApiHash('');
                    setTelegramPhone('');
                    setTelegramChannel('');
                    setTelegramCode('');
                    setTelegramPassword('');
                    await refresh();
                    setNotice('Telegram desconectado.');
                    setBusy('');
                  }}
                  className={cn(secondaryButtonClassName, "h-[58px]")}
                >
                  Desconectar Telegram
                </button>
              </div>

              <p className="mt-6 text-sm text-zinc-400">
                {telegramUserLabel
                  ? <span className="font-semibold text-white">Conta conectada: {telegramUserLabel}</span>
                  : authPhase === 'password_required'
                    ? <span className="text-amber-400">O Telegram pediu a senha em duas etapas para concluir a conexão.</span>
                    : authPhase === 'code_required'
                      ? 'Digite o código enviado para concluir a conexão.'
                      : authPhase === 'auth_required'
                        ? 'Envie um código para iniciar a conexão da sua conta.'
                        : 'Sua sessão do Telegram ficará salva para reconectar depois sem bot.'}
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/5 bg-black/20 p-6">
            <div className="flex items-start justify-between gap-4 max-md:flex-col">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Próximo Passo</p>
                <h3 className="mt-1 text-lg font-bold text-white">Defina os fluxos na aba dedicada</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                  Depois de concluir o login, use a aba <span className="font-bold text-white">Fluxos</span> para escolher se esta conta vai operar a ponte simples ou o automatizador de ofertas.
                </p>
              </div>
              <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 shrink-0">
                {hasTelegramConnection ? 'Sessão Pronta' : 'Aguardando Login'}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="self-start">
        <ConnectionSummary state={state} />
      </div>
    </div>
  );
}

export function ConnectionSummary({ state }: { state: ConnectionsPanelState }) {
  return (
    <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-xl backdrop-blur-md">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Resumo de Conexões</p>
      <div className="mt-6 grid gap-4">
        <ConnectionRow icon={Bot} label="Telegram" status={state.telegramStatus} detail={state.telegram.user?.name || state.config.telegramChannel || 'Aguardando configuração'} />
        <ConnectionRow icon={Smartphone} label="WhatsApp" status={state.whatsAppStatus} detail={state.whatsAppPhone || 'Sessão pendente'} />
      </div>

      {state.issue?.message ? (
        <p className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-400">
          {state.issue.message}
        </p>
      ) : null}
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
    <div className="rounded-2xl border border-white/5 bg-black/20 p-4 transition-colors hover:bg-white/[0.02]">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
        <Icon size={14} />
        {label}
      </div>
      <p className="mt-2 text-sm font-bold text-white">{humanize(status)}</p>
      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

export function InternalSetupChecklist({
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
    blockedReason?: string;
  }>;
  complete: boolean;
  completeLabel: string;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const progressPercent = Math.round((doneCount / Math.max(steps.length, 1)) * 100);
  const nextStep = steps.find((step) => !step.done);
  const blockedStep = steps.find((step) => !step.done && !step.ready && Boolean(step.blockedReason));

  return (
    <section
      className={cn(
        'rounded-3xl border p-6 transition-all duration-500',
        complete
          ? 'border-[#25D366]/30 bg-[#25D366]/5 shadow-[0_0_30px_rgba(37,211,102,0.05)]'
          : 'border-white/5 bg-zinc-900/40 backdrop-blur-sm'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{title}</p>
          <p className={cn('mt-1 text-base font-bold', complete ? 'text-[#25D366]' : 'text-white')}>
            {complete ? completeLabel : 'Complete as etapas para liberar a configuração.'}
          </p>
          {!complete && nextStep ? (
            <p className="mt-1 text-xs font-semibold text-zinc-400">
              Próximo Passo: <span className="text-white">{nextStep.label}</span>
            </p>
          ) : null}
          {!complete && blockedStep?.blockedReason ? (
            <p className="mt-1 text-xs font-bold text-amber-400">
              Bloqueio: {blockedStep.blockedReason}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            'rounded-full px-4 py-2 text-xs font-bold',
            complete
              ? 'bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20'
              : 'bg-white/5 text-zinc-400 border border-white/10'
          )}
        >
          {doneCount}/{steps.length} ({progressPercent}%)
        </span>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/40">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700 ease-out',
            complete ? 'bg-[#25D366]' : 'bg-gradient-to-r from-zinc-600 to-zinc-400'
          )}
          style={{ width: progressPercent + '%' }}
        />
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const blocked = !step.done && !step.ready && Boolean(step.blockedReason);

          return (
            <div
              key={step.label}
              className={cn(
                'rounded-2xl border p-4 transition-colors',
                step.done
                  ? 'border-[#25D366]/30 bg-[#25D366]/5'
                  : step.ready
                    ? 'border-sky-500/30 bg-sky-500/5'
                    : blocked
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-white/5 bg-white/[0.02]'
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                    step.done
                      ? 'bg-[#25D366] text-black'
                      : step.ready
                        ? 'bg-sky-500/20 text-sky-400'
                        : blocked
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-white/10 text-zinc-500'
                  )}
                >
                  {step.done ? <CheckCircle2 size={16} /> : index + 1}
                </span>
                <div>
                  <p className={cn("text-sm font-bold", step.done ? "text-[#25D366]" : "text-white")}>{step.label}</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    {step.done ? 'Concluído' : step.ready ? 'Aguardando' : blocked ? 'Bloqueada' : 'Pendente'}
                  </p>
                </div>
              </div>
              {blocked && step.blockedReason && (
                <p className="mt-3 text-xs font-semibold text-amber-400/80">{step.blockedReason}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
