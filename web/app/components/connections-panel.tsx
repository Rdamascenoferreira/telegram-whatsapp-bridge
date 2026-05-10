import { Bot, CheckCircle2, MessageSquare, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Field } from './common-ui';
import { postJson } from '../../lib/http';
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
    { label: 'Enviar código', done: telegramCodeSent, ready: canUseAuthStep },
    { label: 'Concluir login no Telegram', done: hasTelegramSession, ready: telegramCodeSent && !hasTelegramSession }
  ];
  const telegramChecklistComplete = telegramInternalChecklist.every((step) => step.done);
  const telegramHeroStatusLabel = hasTelegramSession
    ? 'Sessao ativa'
    : authPhase === 'password_required'
      ? 'Senha pendente'
      : authPhase === 'code_required'
        ? 'Codigo pendente'
        : hasSavedCredentials
          ? 'Credenciais salvas'
          : 'Não configurado';
  const telegramHeroSessionLabel = hasTelegramConnection
    ? telegramUserLabel || state.telegram.user?.phone || 'Sessao conectada'
    : 'Sessão de usuário';

  return (
    <div className="grid grid-cols-[1fr_380px] gap-5 max-xl:grid-cols-1">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_30%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.08),transparent_26%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Telegram</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                  <MessageSquare size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Central do Telegram</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                    Conecte sua conta, valide o código de acesso e mantenha a sessão do Telegram pronta para alimentar os fluxos da operação.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-100">
                {telegramHeroStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                {telegramHeroSessionLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 px-6 py-6 max-sm:px-4">
          <InternalSetupChecklist
            title="Checklist do Config. Telegram"
            steps={telegramInternalChecklist}
            complete={telegramChecklistComplete}
            completeLabel="Telegram 100% configurado"
          />

          <section className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="mb-4 flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Etapa 1</p>
                <h3 className="mt-1 text-lg font-semibold">Entrar na conta do Telegram</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  Primeiro conecte sua conta. Depois a aba Fluxos libera a escolha da origem que vai alimentar a ponte simples ou o automatizador de ofertas.
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
                if (readOnlyAccount) {
                  setNotice('Conta em teste: edicoes estao bloqueadas ate liberacao do administrador.');
                  return;
                }
                setBusy('settings');
                await postJson('/api/settings', {
                  telegramMode: 'user',
                  telegramChannel: state.config.telegramChannel,
                  telegramApiId,
                  telegramApiHash,
                  telegramPhone,
                  telegramBotToken: ''
                });
                await refresh();
                setNotice('Credenciais do Telegram salvas.');
                setCredentialsEditing(false);
                setBusy('');
              }}
            >
              <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Modo de conexao</p>
                <p className="mt-1 text-sm font-semibold">Sessão de usuário</p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="API ID" value={telegramApiId} onChange={setTelegramApiId} placeholder="12345678" disabled={readOnlyAccount || credentialsLocked} />
                <Field label="API Hash" value={telegramApiHash} onChange={setTelegramApiHash} placeholder="Cole o API Hash" disabled={readOnlyAccount || credentialsLocked} />
                <Field label="Telefone" value={telegramPhone} onChange={setTelegramPhone} placeholder="+55 21 99999-9999" disabled={readOnlyAccount || credentialsLocked} />
              </div>

              <div className="flex flex-wrap gap-2">
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

            <>
              <div className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr]">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-send-code' || busy === 'settings' || !canUseAuthStep}
                  onClick={async () => {
                    setBusy('telegram-send-code');
                    try {
                      await postJson('/api/settings', {
                        telegramMode: 'user',
                        telegramChannel: state.config.telegramChannel,
                        telegramApiId,
                        telegramApiHash,
                        telegramPhone,
                        telegramBotToken: ''
                      });
                      await postJson('/api/telegram/send-code');
                      await refresh();
                      setNotice('Codigo enviado para o Telegram.');
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : 'Não foi possível enviar o código do Telegram.');
                    } finally {
                      setBusy('');
                    }
                  }}
                  className={primaryButtonClassName}
                >
                  Enviar código
                </button>

                <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                  <Field
                    label="Codigo recebido"
                    value={effectiveTelegramCode}
                    onChange={setTelegramCode}
                    placeholder="Digite o código do Telegram"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase === 'auth_required' || authPhase === 'idle'}
                  />
                  <Field
                    label="Senha em duas etapas"
                    value={effectiveTelegramPassword}
                    onChange={setTelegramPassword}
                    placeholder="Preencha apenas se o Telegram pedir"
                    disabled={readOnlyAccount || !canUseAuthStep || authPhase !== 'password_required'}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-complete-auth' || (authPhase !== 'code_required' && authPhase !== 'password_required')}
                  onClick={async () => {
                    setBusy('telegram-complete-auth');
                    try {
                      await postJson('/api/telegram/complete-auth', {
                        code: effectiveTelegramCode,
                        password: effectiveTelegramPassword
                      });
                      await refresh();
                      setNotice(
                        authPhase === 'password_required'
                          ? 'Senha enviada. Conta do Telegram conectada.'
                          : 'Login do Telegram concluido.'
                      );
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir o login do Telegram.');
                    } finally {
                      setBusy('');
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-400 disabled:opacity-60"
                >
                  {authPhase === 'password_required' ? 'Enviar senha em duas etapas' : 'Concluir login no Telegram'}
                </button>
                <button
                  type="button"
                  disabled={readOnlyAccount || busy === 'telegram-disconnect' || !hasSavedCredentials}
                  onClick={async () => {
                    setBusy('telegram-disconnect');
                    await postJson('/api/telegram/disconnect');
                    setTelegramApiId('');
                    setTelegramApiHash('');
                    setTelegramPhone('');
                    setTelegramChannel('');
                    setTelegramCode('');
                    setTelegramPassword('');
                    await refresh();
                    setNotice('Telegram desconectado e configura??es removidas.');
                    setBusy('');
                  }}
                  className={secondaryButtonClassName}
                >
                  Desconectar Telegram
                </button>
              </div>

              <p className="mt-4 text-sm text-[var(--muted)]">
                {telegramUserLabel
                  ? `Conta conectada: ${telegramUserLabel}.`
                  : authPhase === 'password_required'
                    ? 'O Telegram pediu a senha em duas etapas para concluir a conexao.'
                    : authPhase === 'code_required'
                      ? 'Digite o código enviado para concluir a conexão.'
                      : authPhase === 'auth_required'
                        ? 'Envie um código para iniciar a conexão da sua conta.'
                        : 'Sua sessao do Telegram ficara salva para reconectar depois sem bot.'}
              </p>
            </>
          </section>

          <section className="mt-5 rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Proximo passo</p>
                <h3 className="mt-1 text-lg font-semibold">Defina os fluxos na aba dedicada</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  Depois de concluir o login, use a aba <span className="font-semibold text-[var(--foreground)]">Fluxos</span> para escolher se esta conta vai operar a ponte simples ou o automatizador de ofertas.
                </p>
              </div>
              <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                {hasTelegramConnection ? 'Sessao pronta' : 'Aguardando login'}
              </span>
            </div>
          </section>
        </div>
      </section>

      <ConnectionSummary state={state} />
    </div>
  );
}

export function ConnectionSummary({ state }: { state: ConnectionsPanelState }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Conexoes</p>
      <div className="mt-4 grid gap-3">
        <ConnectionRow icon={Bot} label="Telegram" status={state.telegramStatus} detail={state.telegram.user?.name || state.config.telegramChannel || 'Aguardando configuração'} />
        <ConnectionRow icon={Smartphone} label="WhatsApp" status={state.whatsAppStatus} detail={state.whatsAppPhone || 'Sessão ainda não conectada'} />
      </div>

      {state.issue?.message ? (
        <p className="mt-4 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
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
    <div className="rounded-md border border-[var(--border)] bg-black/10 p-3">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <Icon size={14} />
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{humanize(status)}</p>
      <p className="text-xs text-[var(--muted)]">{detail}</p>
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
  }>;
  complete: boolean;
  completeLabel: string;
}) {
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section
      className={cn(
        'rounded-2xl border p-4 transition',
        complete
          ? 'border-emerald-300/40 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_34%),rgba(16,185,129,0.08)] shadow-[0_0_0_1px_rgba(34,197,94,0.08),0_18px_45px_rgba(16,185,129,0.12)]'
          : 'border-[var(--border)] bg-black/10'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</p>
          <p className={cn('mt-1 text-sm font-semibold', complete ? 'text-emerald-100' : 'text-[var(--foreground)]')}>
            {complete ? completeLabel : 'Complete as etapas para liberar a configuração.'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1.5 text-sm font-bold',
            complete
              ? 'bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-300/30 animate-pulse'
              : 'bg-white/5 text-[var(--muted)] ring-1 ring-white/10'
          )}
        >
          {doneCount}/{steps.length}
        </span>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={cn(
              'rounded-xl border px-3 py-3 transition',
              step.done
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50'
                : step.ready
                  ? 'border-sky-400/25 bg-sky-400/10 text-sky-50'
                  : 'border-white/10 bg-white/[0.03] text-[var(--muted)]'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold',
                  step.done
                    ? 'border-emerald-300/40 bg-emerald-400/20 text-emerald-100'
                    : step.ready
                      ? 'border-sky-300/40 bg-sky-400/20 text-sky-100'
                      : 'border-white/15 bg-white/5 text-[var(--muted)]'
                )}
              >
                {step.done ? <CheckCircle2 size={14} /> : index + 1}
              </span>
              <p className="text-sm font-semibold">{step.label}</p>
            </div>
            <p className="mt-2 text-xs leading-5 opacity-80">
              {step.done ? 'Concluido' : step.ready ? 'Pronto para executar' : 'Pendente'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
