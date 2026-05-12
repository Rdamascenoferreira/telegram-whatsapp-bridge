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
    <header className="mb-8 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Central operacional</p>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Portal do Afiliado</h1>
          <CompactSetupChecklist steps={steps} />
        </div>
      </div>
      <div className="flex items-center gap-3 max-sm:flex-wrap">
        <StatusBadge label="Telegram" value={telegramStatus} />
        <StatusBadge label="WhatsApp" value={whatsAppStatus} />
        <div className="h-6 w-px bg-white/10 max-sm:hidden"></div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
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
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] px-2 py-1.5 backdrop-blur-sm">
      {steps.map((step, index) => (
        <span
          key={step.label}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all',
            step.done
              ? 'bg-[#25D366]/10 text-[#25D366]'
              : step.ready
                ? 'bg-sky-500/10 text-sky-400'
                : 'text-zinc-500'
          )}
          title={step.done ? `${step.label}: concluído` : step.ready ? `${step.label}: pronto` : `${step.label}: pendente`}
        >
          <span
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full text-[10px] transition-colors',
              step.done
                ? 'bg-[#25D366] text-zinc-950'
                : step.ready
                  ? 'bg-sky-500/20 text-sky-400'
                  : 'bg-zinc-800 text-zinc-500'
            )}
          >
            {step.done ? <CheckCircle2 size={10} className="text-zinc-950" /> : index + 1}
          </span>
          <span className="max-sm:hidden">{step.label}</span>
        </span>
      ))}
      <div className="ml-1 pl-2 border-l border-white/5">
        <span className="rounded-md bg-[#25D366]/10 px-2 py-1 text-xs font-semibold text-[#25D366]">
          {doneCount}/{steps.length}
        </span>
      </div>
    </div>
  );
}
