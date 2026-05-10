'use client';

import { Mail, User, type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function LoadingScreen({
  error,
  onRetry
}: {
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
      <div className="min-w-[280px] rounded-lg border border-[var(--border)] bg-[var(--panel)] px-5 py-4 text-sm text-[var(--muted)]">
        <div>Carregando painel...</div>
        {error ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {error}
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Tentar novamente
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function ReadOnlyModeBanner() {
  return (
    <div className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-50">
      <span className="font-semibold">Conta em teste:</span> este acesso esta em modo somente leitura. Voce pode navegar pelos paineis, mas edicoes e configuracoes precisam ser liberadas pelo administrador.
    </div>
  );
}

export function AvatarBadge({
  user,
  size = 'lg'
}: {
  user: { name?: string; email?: string; avatarUrl?: string } | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'sm'
      ? 'h-10 w-10 rounded-xl'
      : size === 'md'
        ? 'h-10 w-10 rounded-2xl'
        : 'h-20 w-20 rounded-[24px]';
  const iconClass = size === 'lg' ? 'h-10 w-10' : 'h-5 w-5';
  const initials = String(user?.name || user?.email || 'PA')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-emerald-400/20 bg-black/25 text-sm font-semibold text-emerald-50 shadow-[0_0_24px_rgba(43,214,140,0.15)]',
        sizeClass
      )}
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name || 'Avatar'} className="h-full w-full object-cover" />
      ) : (
        <span className="flex items-center justify-center">
          {initials || <User className={iconClass} />}
        </span>
      )}
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
  value,
  onChange,
  icon: Icon,
  rightSlot,
  inputClass
}: {
  label: string;
  name?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  icon?: LucideIcon;
  rightSlot?: ReactNode;
  inputClass?: string;
}) {
  const resolvedInputClass =
    inputClass ||
    'h-[58px] w-full rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 text-base text-[#F8FAFC] outline-none transition placeholder:text-[#6D7C75] hover:border-[rgba(255,255,255,0.14)] focus:border-[#25D366] focus:bg-[rgba(255,255,255,0.05)] focus:ring-2 focus:ring-[rgba(37,211,102,0.14)]';

  return (
    <label className="grid gap-2.5 text-sm font-semibold text-[#F8FAFC]">
      {label}
      <span className="relative block">
        {Icon ? (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7D8D86]">
            <Icon size={20} />
          </span>
        ) : null}
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          className={cn(resolvedInputClass, Icon ? 'pl-12' : '', rightSlot ? 'pr-12' : '')}
        />
        {rightSlot ? (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">{rightSlot}</span>
        ) : null}
      </span>
    </label>
  );
}

export function StatusBadge({ label, value }: { label: string; value: string }) {
  const good = ['ready', 'listening', 'authenticated'].includes(value);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold',
        good ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-[var(--border)] bg-black/10 text-[var(--muted)]'
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', good ? 'bg-[var(--accent)]' : 'bg-[var(--warning)]')} />
      {label}: {value}
    </span>
  );
}

export const mailIcon = Mail;
