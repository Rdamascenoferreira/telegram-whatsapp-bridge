'use client';

import { CheckCircle2, LogOut } from 'lucide-react';
import { StatusBadge } from './common-ui';
import { cn } from '../../lib/utils';

type SetupStep = {
  label: string;
  done: boolean;
  ready?: boolean;
};

export function Topbar({
  telegramStatus,
  whatsAppStatus,
  steps,
  onLogout
}: {
  telegramStatus: string;
  whatsAppStatus: string;
  steps: SetupStep[];
  onLogout: () => Promise<void>;
}) {
  return (
    <header className="mb-5 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
      <div className="min-w-0">
        <p className="text-sm text-[var(--muted)]">Central operacional</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold">Portal do Afiliado</h1>
          <CompactSetupChecklist steps={steps} />
        </div>
      </div>
      <div className="flex items-center gap-2 max-sm:flex-wrap">
        <StatusBadge label="Telegram" value={telegramStatus} />
        <StatusBadge label="WhatsApp" value={whatsAppStatus} />
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-white/5"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>
    </header>
  );
}

function CompactSetupChecklist({
  steps
}: {
  steps: SetupStep[];
}) {
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-black/10 px-2 py-1.5">
      {steps.map((step, index) => (
        <span
          key={step.label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold transition',
            step.done
              ? 'bg-emerald-400/12 text-emerald-100'
              : step.ready
                ? 'bg-sky-400/12 text-sky-100'
                : 'text-[var(--muted)]'
          )}
          title={step.done ? `${step.label}: concluído` : step.ready ? `${step.label}: pronto` : `${step.label}: pendente`}
        >
          <span
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border text-[10px]',
              step.done
                ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-100'
                : step.ready
                  ? 'border-sky-400/30 bg-sky-400/15 text-sky-100'
                  : 'border-white/15 bg-white/5 text-[var(--muted)]'
            )}
          >
            {step.done ? <CheckCircle2 size={11} /> : index + 1}
          </span>
          <span className="max-sm:hidden">{step.label}</span>
        </span>
      ))}
      <span className="ml-1 rounded bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-100">
        {doneCount}/5
      </span>
    </div>
  );
}
