'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { formatDate } from '../../../lib/panel-utils';
import type { AppState } from '../../types/panel';

export function ActivityLogPanel({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const dedupedEvents = useMemo(() => {
    return state.activity.filter((event, index, events) => {
      const previous = events[index - 1];
      if (!previous) {
        return true;
      }

      return !(previous.message === event.message && previous.level === event.level);
    });
  }, [state.activity]);
  const events = compact ? dedupedEvents.slice(0, 6) : dedupedEvents;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Histórico</p>
          <h2 className="mt-1 text-xl font-semibold">Atividade recente</h2>
        </div>
      </div>
      <div className="grid gap-2">
        {events.length ? (
          events.map((event) => (
            <article key={event.id} className="rounded-md border border-[var(--border)] bg-black/10 p-3">
              <div className="flex items-start gap-3">
                {event.level === 'error' ? (
                  <AlertCircle size={18} className="mt-0.5 text-[var(--danger)]" />
                ) : (
                  <CheckCircle2 size={18} className="mt-0.5 text-[var(--accent)]" />
                )}
                <div>
                  <p className="text-sm font-semibold">{event.message}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{formatDate(event.at)}</p>
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm text-[var(--muted)]">Sem atividade recente.</p>
        )}
      </div>
    </section>
  );
}


