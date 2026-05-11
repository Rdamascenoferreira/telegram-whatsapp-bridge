'use client';

import { CheckCircle2, TrendingUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatNumber, humanize, normalizeRouteSourceId } from '../../../lib/panel-utils';
import type { AppState, ViewKey } from '../../types/panel';

function getActiveAffiliateAutomationCount(state: AppState) {
  return (state.affiliate?.automations || []).filter((automation) => automation.isActive).length;
}

export function PlanUsagePanel({ state, setView }: { state: AppState; setView: (view: ViewKey) => void }) {
  const limits = state.planLimits;
  const currentPlan = String(state.auth.user?.plan || limits?.plan || 'starter').toLowerCase();
  const isAdmin = Boolean(state.auth.user?.isAdmin);
  const whatsappDestinationsUsed = state.config.selectedGroupIds?.length || 0;
  const activeAffiliateAutomationsCount = getActiveAffiliateAutomationCount(state);
  const bridgeSourceUsed = normalizeRouteSourceId(state.config.telegramChannel) ? 1 : 0;
  const affiliateSourcesUsed = (state.affiliate?.automations || []).filter((automation) =>
    normalizeRouteSourceId(automation.telegramSourceGroupId)
  ).length;
  const telegramSourcesUsed = Math.min(
    bridgeSourceUsed + affiliateSourcesUsed,
    Math.max(1, limits?.telegramSources || 1)
  );
  const messageUsage = state.metrics.totalForwardedMessages || state.metrics.totalWhatsAppDeliveries || 0;
  const planTiers = [
    {
      key: 'starter',
      name: 'Starter',
      tone: 'border-white/10 bg-white/[0.03]',
      description: 'Para validar a ponte com poucos destinos.',
      highlights: ['1 origem Telegram', '3 destinos WhatsApp', '100 mensagens/dia', 'Sem afiliados']
    },
    {
      key: 'plus',
      name: 'Plus',
      tone: 'border-emerald-400/20 bg-emerald-400/[0.06]',
      description: 'Primeira camada comercial para Operação real.',
      highlights: ['1 origem Telegram', '10 destinos WhatsApp', 'Amazon afiliado', '500 mensagens/dia']
    },
    {
      key: 'pro',
      name: 'Pro',
      tone: 'border-cyan-400/20 bg-cyan-400/[0.06]',
      description: 'Para escalar ofertas com afiliados e Histórico.',
      highlights: ['3 origens Telegram', '30 destinos WhatsApp', 'Amazon + Shopee', '2.000 mensagens/dia']
    },
    {
      key: 'business',
      name: 'Business',
      tone: 'border-emerald-300/25 bg-[linear-gradient(135deg,rgba(37,211,102,0.08),rgba(34,158,217,0.08))]',
      description: 'Operação robusta com mais bases e volume.',
      highlights: ['10 origens Telegram', '100 destinos WhatsApp', '10 automacoes afiliadas', '10.000 mensagens/dia']
    }
  ];

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(6,26,18,0.96),rgba(4,18,13,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.11),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,158,217,0.1),transparent_28%)] px-6 py-5 max-sm:px-4">
          <div className="flex items-start justify-between gap-4 max-lg:flex-col">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Plano e Uso</p>
              <div className="mt-3 flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                  <TrendingUp size={22} />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.02em]">Limites claros para uma Operação sem surpresa</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                    Veja o plano atual, o consumo operacional e quais recursos já estão liberados para a sua conta.
                  </p>
                </div>
              </div>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100">
              Plano {limits?.label || humanize(currentPlan)}
            </span>
          </div>
        </div>

        <div className="grid gap-5 p-6 max-sm:p-4">
          <PlanUsageCard
            title="Uso do plano atual"
            planLabel={limits?.label || humanize(currentPlan)}
            description="Estes números ajudam o cliente a entender o que já está configurado e o que ainda cabe no plano."
            items={[
              {
                label: 'Destinos WhatsApp',
                used: whatsappDestinationsUsed,
                limit: limits?.whatsappDestinations || 0,
                detail: `${whatsappDestinationsUsed} destino(s) configurado(s) para receber mensagens.`
              },
              {
                label: 'Origens Telegram',
                used: telegramSourcesUsed,
                limit: limits?.telegramSources || 0,
                detail: `${telegramSourcesUsed} origem(ns) ativa(s) entre ponte e afiliados.`
              },
              {
                label: 'Automacoes afiliadas',
                used: state.affiliate?.automations?.length || 0,
                limit: limits?.affiliateAutomations || 0,
                detail: ` automação(oes) ativa(s) no momento.`
              },
              {
                label: 'Uso operacional',
                used: messageUsage,
                limit: limits?.dailyMessages || 0,
                detail: 'Contador operacional atual. A cota diaria real pode ser plugada em Supabase na proxima etapa.'
              }
            ]}
            featureBadges={[
              { label: 'Amazon afiliado', enabled: Boolean(limits?.amazonAffiliate) },
              { label: 'Shopee afiliado', enabled: Boolean(limits?.shopeeAffiliate) },
              { label: 'Histórico', enabled: Boolean((limits?.historyDays || 0) > 1), value: `${limits?.historyDays || 0} dias` },
              { label: 'Mensagens/dia', enabled: true, value: formatNumber(limits?.dailyMessages || 0) }
            ]}
          />

          <section className="grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-4 max-lg:flex-col">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Escada comercial</p>
                <h2 className="mt-1 text-xl font-semibold">Planos recomendados</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                  A ideia aqui e transformar limite em clareza: quando algo estiver bloqueado, o usuário entende qual upgrade libera.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView(isAdmin ? 'admin' : 'account')}
                className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
              >
                {isAdmin ? 'Gerenciar planos no Admin' : 'Ver minha conta'}
              </button>
            </div>

            <div className="grid gap-3 xl:grid-cols-4 md:grid-cols-2">
              {planTiers.map((tier) => (
                <article key={tier.key} className={cn('rounded-2xl border p-4', tier.tone)}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">{tier.name}</h3>
                    {currentPlan === tier.key ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                        Atual
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                        Upgrade
                      </span>
                    )}
                  </div>
                  <p className="mt-2 min-h-[44px] text-sm leading-5 text-[var(--muted)]">{tier.description}</p>
                  <div className="mt-4 grid gap-2">
                    {tier.highlights.map((highlight) => (
                      <div key={highlight} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <CheckCircle2 size={15} className="text-emerald-300" />
                        {highlight}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setView('flows')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Ajustar Fluxos</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Configure ponte simples ou automatizador de ofertas.</p>
            </button>
            <button
              type="button"
              onClick={() => setView('groups')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Revisar WhatsApp</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Veja destinos usados e grupos disponíveis.</p>
            </button>
            <button
              type="button"
              onClick={() => setView('affiliate')}
              className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.05]"
            >
              <p className="font-semibold">Configurar Afiliados</p>
              <p className="mt-2 text-sm leading-5 text-[var(--muted)]">Ative Amazon, Shopee e regras de conversão.</p>
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}


function PlanUsageCard({
  title,
  planLabel,
  description,
  items,
  featureBadges
}: {
  title: string;
  planLabel: string;
  description: string;
  items: Array<{
    label: string;
    used: number;
    limit: number;
    detail: string;
  }>;
  featureBadges: Array<{
    label: string;
    enabled: boolean;
    value?: string;
  }>;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{title}</p>
          <h2 className="mt-1 text-xl font-semibold">{planLabel}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
          Plano ativo
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {items.map((item) => {
          const safeLimit = Math.max(1, item.limit || 0);
          const percent = Math.max(0, Math.min(100, Math.round((item.used / safeLimit) * 100)));

          return (
            <article key={item.label} className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{item.label}</p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                  {item.used}/{item.limit}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#25D366,#229ED9)] transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {featureBadges.map((feature) => (
          <span
            key={feature.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold',
              feature.enabled
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-white/10 bg-white/5 text-[var(--muted)]'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', feature.enabled ? 'bg-[#25D366]' : 'bg-[var(--warning)]')} />
            {feature.label}
            {feature.value ? `: ${feature.value}` : feature.enabled ? ' liberado' : ' bloqueado'}
          </span>
        ))}
      </div>
    </section>
  );
}


