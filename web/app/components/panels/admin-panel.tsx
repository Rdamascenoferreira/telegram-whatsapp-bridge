'use client';

import { RefreshCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { HTTP_TIMEOUT_MS, postJsonWithOptions, requestJson } from '../../../lib/http';
import { formatDate, humanize, normalizeText } from '../../../lib/panel-utils';
import { cn } from '../../../lib/utils';
import type { AppState } from '../../types/panel';

type AdminPanelProps = {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
};

const adminSelectClass =
  'h-[58px] w-full rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 text-base text-[#F8FAFC] outline-none transition placeholder:text-[#6D7C75] hover:border-[rgba(255,255,255,0.14)] focus:border-[#25D366] focus:bg-[rgba(255,255,255,0.05)] focus:ring-2 focus:ring-[rgba(37,211,102,0.14)]';

export function AdminPanel({ state, refresh, setNotice }: AdminPanelProps) {
  const [search, setSearch] = useState('');
  const supervisor = state.admin?.supervisor;
  const users = (state.admin?.users || []).filter((user) =>
    normalizeText(`${user.name} ${user.email}`).includes(normalizeText(search))
  );
  const auditEvents = (state.activity || []).filter((event) => event.type === 'audit_admin').slice(0, 10);

  return (
    <section className="grid gap-5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-5 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Administracao</p>
          <h2 className="mt-1 text-xl font-semibold">Contas e acesso</h2>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-black/10 px-3 py-2">
          <Search size={17} className="text-[var(--muted)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar usuário"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-8">
        <AdminSupervisorMetric label="Runtimes" value={supervisor?.totalRuntimes || 0} />
        <AdminSupervisorMetric label="Telegram OK" value={supervisor?.listeningTelegram || 0} tone="success" />
        <AdminSupervisorMetric label="WhatsApp OK" value={supervisor?.readyWhatsApp || 0} tone="success" />
        <AdminSupervisorMetric label="Filas ativas" value={supervisor?.activeDeliveries || 0} tone="info" />
        <AdminSupervisorMetric label="Aguardando" value={supervisor?.queuedDeliveries || 0} tone="warning" />
        <AdminSupervisorMetric label="Duplicados" value={supervisor?.skippedDuplicates || 0} tone="info" />
        <AdminSupervisorMetric label="Falhas transit." value={supervisor?.transientFailures || 0} tone="warning" />
        <AdminSupervisorMetric label="Falhas fatais" value={supervisor?.fatalFailures || 0} tone="default" />
      </div>

      {(supervisor?.healthAlerts || []).length > 0 ? (
        <div className="grid gap-2">
          {(supervisor?.healthAlerts || []).map((alert, index) => (
            <div
              key={`${alert.code || 'alert'}-${index}`}
              className={cn(
                'rounded-md border px-3 py-2 text-xs',
                alert.level === 'critical'
                  ? 'border-red-400/20 bg-red-400/10 text-red-100'
                  : 'border-amber-400/20 bg-amber-400/10 text-amber-100'
              )}
            >
              {alert.message || 'Alerta operacional ativo.'}
            </div>
          ))}
        </div>
      ) : null}

      <section className="rounded-md border border-[var(--border)] bg-black/10 p-4">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Auditoria</p>
          <h3 className="mt-1 text-sm font-semibold">Acoes admin recentes</h3>
        </div>
        <div className="grid gap-2">
          {auditEvents.length ? (
            auditEvents.map((event) => {
              const action = String(event?.metadata?.action || 'admin.ação');
              const outcome = String(event?.metadata?.outcome || 'unknown');
              const target = String(event?.metadata?.targetUserId || '-');

              return (
                <article key={event.id} className="rounded border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-xs">
                  <p className="font-semibold">{action} - {outcome}</p>
                  <p className="mt-1 text-[var(--muted)]">alvo: {target} | {formatDate(event.at)}</p>
                </article>
              );
            })
          ) : (
            <p className="text-xs text-[var(--muted)]">Sem eventos de auditoria recentes.</p>
          )}
        </div>
      </section>

      <div className="grid gap-3">
        {users.map((user) => (
          <article key={user.id} className="grid grid-cols-[1fr_auto] gap-4 rounded-md border border-[var(--border)] bg-black/10 p-4 max-lg:grid-cols-1">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{user.name}</p>
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    user.isOnline
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : 'border-red-400/20 bg-red-400/10 text-red-100'
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', user.isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
                  {user.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-white/5 px-2 py-1">Plano {humanize(user.plan || 'beta')}</span>
                <span className="rounded bg-white/5 px-2 py-1">Conta {humanize(user.accountStatus || 'active')}</span>
                <span className="rounded bg-white/5 px-2 py-1">{user.workspace?.selectedGroupCount || 0} grupo(s)</span>
                <AdminRuntimeStatusPill label="Telegram" value={user.supervisor?.telegramStatus || user.workspace?.telegramStatus || 'offline'} />
                <AdminRuntimeStatusPill label="WhatsApp" value={user.supervisor?.whatsAppStatus || user.workspace?.whatsAppStatus || 'offline'} />
              </div>
              <div className="mt-4 grid gap-2 rounded-md border border-[var(--border)] bg-white/[0.03] p-3 text-xs text-[var(--muted)] md:grid-cols-6">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.deliveryQueue?.queuedCount || 0}</p>
                  <p>Na fila</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.pendingTelegramCount || 0}</p>
                  <p>Telegram pendente</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.metrics?.totalWhatsAppDeliveries || 0}</p>
                  <p>Entregas</p>
                </div>
                <div>
                  <p className={cn('font-semibold', (user.supervisor?.totalErrors || user.metrics?.totalErrors || 0) > 0 ? 'text-red-100' : 'text-[var(--foreground)]')}>
                    {user.supervisor?.totalErrors || user.metrics?.totalErrors || 0}
                  </p>
                  <p>Erros</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{user.supervisor?.deliveryStats?.skippedDuplicates || 0}</p>
                  <p>Duplicados evitados</p>
                </div>
                <div>
                  <p className={cn('font-semibold', (user.supervisor?.deliveryStats?.fatalFailures || 0) > 0 ? 'text-red-100' : 'text-[var(--foreground)]')}>
                    {user.supervisor?.deliveryStats?.fatalFailures || 0}
                  </p>
                  <p>Falhas fatais</p>
                </div>
                {user.supervisor?.deliveryQueue?.lastError ? (
                  <p className="col-span-full rounded border border-red-400/20 bg-red-400/10 px-3 py-2 text-red-100">
                    Ultimo erro da fila: {user.supervisor.deliveryQueue.lastError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-2">
              <select
                defaultValue={user.plan || 'beta'}
                className={adminSelectClass}
                onChange={async (event) => {
                  await postJsonWithOptions(`/api/admin/users/${encodeURIComponent(user.id)}`, { plan: event.target.value }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice('Plano atualizado.');
                }}
              >
                <option value="beta">Beta</option>
                <option value="starter">Starter</option>
                <option value="plus">Plus</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <select
                defaultValue={user.accountStatus || 'active'}
                className={adminSelectClass}
                onChange={async (event) => {
                  await postJsonWithOptions(`/api/admin/users/${encodeURIComponent(user.id)}`, { accountStatus: event.target.value }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice(
                    event.target.value === 'suspended'
                      ? 'Conta suspensa e sessão encerrada imediatamente.'
                      : 'Status da conta atualizado.'
                  );
                }}
              >
                <option value="active">Ativa</option>
                <option value="trial">Em teste</option>
                <option value="suspended">Suspensa</option>
              </select>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/15"
                onClick={async () => {
                  await postJsonWithOptions(`/api/admin/users/${encodeURIComponent(user.id)}/restart-runtime`, undefined, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setNotice(`sessão de ${user.name} reiniciada sem apagar dados.`);
                }}
              >
                <RefreshCcw size={16} />
                Reiniciar sessão
              </button>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-400/15"
                onClick={async () => {
                  const confirmed = window.confirm(
                    `Deseja realmente excluir a conta de ${user.name}? Essa ação remove o acesso, o perfil e os dados locais dessa conta.`
                  );

                  if (!confirmed) {
                    return;
                  }

                  try {
                    await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
                      method: 'DELETE',
                      timeoutMs: HTTP_TIMEOUT_MS.MEDIUM
                    });
                    await refresh();
                    setNotice('Conta excluida com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possível excluir a conta.');
                  }
                }}
              >
                <Trash2 size={16} />
                Excluir conta
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AdminSupervisorMetric({
  label,
  value,
  tone = 'default'
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'info';
}) {
  const toneClass = {
    default: 'border-white/10 bg-white/[0.03] text-[var(--foreground)]',
    success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
    warning: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
    info: 'border-sky-400/20 bg-sky-400/10 text-sky-100'
  }[tone];

  return (
    <div className={cn('rounded-md border p-3', toneClass)}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{label}</p>
    </div>
  );
}

function AdminRuntimeStatusPill({ label, value }: { label: string; value: string }) {
  const normalized = String(value || '').toLowerCase();
  const healthy = ['ready', 'listening', 'authenticated'].includes(normalized);
  const waiting = ['connecting', 'qr_required', 'auth_required', 'code_required', 'password_required', 'reconnecting'].includes(normalized);
  const className = healthy
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
    : waiting
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
      : 'border-red-400/20 bg-red-400/10 text-red-100';

  return (
    <span className={cn('rounded border px-2 py-1', className)}>
      {label}: {humanize(value || 'offline')}
    </span>
  );
}
