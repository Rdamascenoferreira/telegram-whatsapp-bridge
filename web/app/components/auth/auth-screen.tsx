'use client';

import { ArrowRight, Clock3, CreditCard, Eye, Gauge, LockKeyhole, Mail, Rocket, Send, ShieldCheck, Smartphone, TrendingUp, Users, Zap } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Field } from '../common-ui';
import { postJson } from '../../../lib/http';
import { cn } from '../../../lib/utils';
import type { AppState } from '../../types/panel';

export function AuthScreen({
  googleEnabled,
  onAuthenticated,
  notice,
  setNotice
}: {
  googleEnabled: boolean;
  onAuthenticated: (auth: AppState['auth']) => void | Promise<void>;
  notice: string;
  setNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice('');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const auth = await postJson<AppState['auth']>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', payload);
      void onAuthenticated(auth);
      setNotice('Login realizado com sucesso.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#03130D] px-6 py-8 text-[var(--foreground)] max-sm:px-4">
      <div className="mx-auto max-w-[1480px]">
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.16fr)_460px] lg:items-start">
          <div className="pointer-events-none absolute inset-x-[12%] top-8 hidden h-[420px] rounded-full bg-[radial-gradient(circle,rgba(37,211,102,0.1),transparent_58%)] blur-3xl lg:block" />
          <div className="pointer-events-none absolute right-[24%] top-20 hidden h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(34,158,217,0.08),transparent_60%)] blur-3xl lg:block" />

          <section className="relative z-10 overflow-hidden rounded-[28px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(6,24,17,0.96),rgba(3,19,13,0.98))] p-7 shadow-[0_24px_64px_rgba(0,0,0,0.34)] max-xl:p-6 max-sm:rounded-[22px] max-sm:p-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,211,102,0.08),transparent_24%),radial-gradient(circle_at_right,rgba(34,158,217,0.08),transparent_22%)]" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.18)] bg-[rgba(5,24,17,0.74)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#DDFCEF] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <Zap size={14} className="text-[#25D366]" />
                  Operação automatizada com <span className="text-[#25D366]">Telegram</span> + <span className="text-[#229ED9]">WhatsApp</span> + afiliados
              </span>

              <div className="mt-6 grid gap-5 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start max-sm:grid-cols-1">
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[22px] border border-[rgba(37,211,102,0.24)] bg-[linear-gradient(180deg,rgba(6,22,16,0.95),rgba(8,30,22,0.92))] shadow-[0_14px_28px_rgba(0,0,0,0.24),0_0_0_1px_rgba(255,255,255,0.03)] max-sm:h-16 max-sm:w-16">
                  <img src="/brand/portal-icon.svg" alt="Portal do Afiliado" className="h-11 w-11 object-contain max-sm:h-9 max-sm:w-9" />
                </div>
                <div className="min-w-0">
                  <div className="grid gap-1">
                    <span className="text-sm font-semibold uppercase tracking-[0.34em] text-[#9FD0B7]">Portal do</span>
                    <span className="text-[3.25rem] font-semibold leading-none text-[#F8FAFC] max-xl:text-[2.8rem] max-sm:text-[2.35rem]">
                      Afiliado
                    </span>
                  </div>

                  <h1 className="mt-5 max-w-4xl text-[4rem] font-semibold leading-[0.98] text-[#F8FAFC] max-xl:max-w-3xl max-xl:text-[3.4rem] max-lg:text-[3rem] max-sm:text-[2.5rem]">
                    Sua oferta entra no Telegram,
                    <br />
                    o painel organiza tudo
                    <br />
                    <span className="bg-[linear-gradient(90deg,#25D366,#229ED9)] bg-clip-text text-transparent">e sai pronta para vender.</span>
                  </h1>

                  <p className="mt-4 max-w-3xl text-[1.08rem] leading-8 text-[#AAB8B0] max-sm:text-base max-sm:leading-7">
                    Centralize origem, destinos, sessões, Histórico e testes em um painel pensado para Operação real. Quando quiser, ative o módulo de afiliados para tratar links Amazon e Shopee antes do envio e manter a mensagem pronta para conversão.
                  </p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <AuthMetricPill label="Origem Telegram" value="Conta própria" accentClassName="text-[#25D366]" />
                    <AuthMetricPill label="Entrega" value="WhatsApp controlado" accentClassName="text-[#229ED9]" />
                    <AuthMetricPill label="Afiliados" value="Amazon + Shopee" accentClassName="text-[#7EE59F]" />
                    <AuthMetricPill label="Operação" value="Histórico e testes" accentClassName="text-[#9FD7FF]" />
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-[rgba(37,211,102,0.18)] bg-[linear-gradient(135deg,rgba(8,34,24,0.9),rgba(6,24,17,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                    <Rocket size={19} className="text-[#25D366]" />
                  </div>
                  <p className="text-base leading-7 text-[#DBEAE1]">
                    O cliente escolhe a origem no Telegram, define os destinos no WhatsApp, valida o fluxo antes de ativar e acompanha tudo no painel. Sem cópia e cola manual, sem perder contexto e com visibilidade clara do que foi captado, tratado e entregue.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(9,27,19,0.88),rgba(5,18,13,0.94))] p-5 shadow-[0_12px_34px_rgba(0,0,0,0.22)] lg:grid-cols-3">
                <AuthFlowStep
                  icon={Send}
                  title="1. Conecte a origem"
                  text="Faça login no Telegram com sua própria conta e escolha o grupo ou canal que será monitorado."
                />
                <AuthFlowStep
                  icon={Smartphone}
                  title="2. Defina os destinos"
                  text="Conecte o WhatsApp, escolha os grupos de entrega e salve o fluxo da Operação em poucos passos."
                />
                <AuthFlowStep
                  icon={CreditCard}
                  title="3. Ative afiliados quando quiser"
                  text="Trate links, adicione rodapé próprio, rode testes e publique a saída final de forma mais profissional."
                />
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(7,26,18,0.92),rgba(4,18,13,0.96))] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#5DE0A0]">Central de Operação</p>
                  <h2 className="mt-3 max-w-lg text-[2.3rem] font-semibold leading-[1.04] text-[#F8FAFC] max-sm:text-[1.9rem]">
                    Uma estrutura pronta para rodar todo dia.
                  </h2>
                  <p className="mt-3 max-w-lg text-[0.98rem] leading-7 text-[#AAB8B0]">
                    O Portal do Afiliado conecta sua conta do Telegram, mantém a sessão do WhatsApp, organiza grupos de destino, registra Histórico, oferece teste manual e separa a Operação comum da automação de afiliados. O resultado é mais controle, menos retrabalho e uma rotina comercial muito mais previsível.
                  </p>

                  <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[#C8D7D0]">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.16)] bg-[rgba(37,211,102,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7F3C0]">
                      <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                      Leitura de origem no Telegram
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(34,158,217,0.16)] bg-[rgba(34,158,217,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7E5FF]">
                      <span className="h-2 w-2 rounded-full bg-[#229ED9]" />
                      Entrega controlada no WhatsApp
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,211,102,0.16)] bg-[rgba(37,211,102,0.08)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#A7F3C0]">
                      <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                      Modulo de afiliados separado
                    </span>
                    <span className="text-[#8FA69C]">Cada fluxo tem regra própria, com rastreabilidade do que entrou, do que foi tratado e para onde a mensagem saiu.</span>
                  </div>
                </div>

                <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(circle_at_top,rgba(34,158,217,0.08),transparent_32%),linear-gradient(180deg,rgba(8,29,21,0.82),rgba(4,18,13,0.92))] p-6">
                  <div className="pointer-events-none absolute inset-y-5 left-[14%] w-px bg-[linear-gradient(180deg,transparent,rgba(37,211,102,0.38),transparent)]" />
                  <div className="pointer-events-none absolute inset-y-8 right-[18%] w-px bg-[linear-gradient(180deg,transparent,rgba(34,158,217,0.34),transparent)]" />
                  <div className="pointer-events-none absolute left-14 top-10 h-2 w-2 rounded-full bg-[#25D366] shadow-[0_0_18px_rgba(37,211,102,0.9)]" />
                  <div className="pointer-events-none absolute right-20 top-16 h-2 w-2 rounded-full bg-[#229ED9] shadow-[0_0_18px_rgba(34,158,217,0.9)]" />
                  <div className="pointer-events-none absolute right-14 bottom-12 h-2 w-2 rounded-full bg-[#25D366] shadow-[0_0_18px_rgba(37,211,102,0.8)]" />

                  <div className="relative w-full max-w-[360px] rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(18,32,28,0.95),rgba(7,20,16,0.92))] p-4 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8BA39A]">Painel operacional</p>
                        <p className="mt-1 text-sm text-[#DCE9E2]">Operação acompanhada em tempo real</p>
                      </div>
                      <div className="rounded-full border border-[rgba(37,211,102,0.2)] bg-[rgba(37,211,102,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[#9CF0BF]">
                        Em monitoramento
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2.5">
                      <AuthDashboardStat label="Origens" value="07" />
                      <AuthDashboardStat label="Destinos" value="82" />
                      <AuthDashboardStat label="Fluxos" value="05" />
                    </div>

                    <div className="mt-4 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
                      <div className="flex items-end gap-2">
                        {[34, 46, 42, 58, 74, 68, 82].map((height, index) => (
                          <div key={index} className="flex-1">
                            <div
                              className="rounded-t-full bg-[linear-gradient(180deg,rgba(37,211,102,0.95),rgba(34,158,217,0.88))]"
                              style={{ height }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-[#7E9088]">
                        <span>Entrega monitorada</span>
                        <span>Visão operacional</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2">
                      <AuthDashboardRow label="Mensagens captadas" value="29.300" />
                      <AuthDashboardRow label="Entregas concluidas" value="4.190" />
                      <AuthDashboardRow label="Conversoes de links" value="1.284" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <AuthMiniSignal
                        icon={Smartphone}
                        title="WhatsApp"
                        detail="sessão valida"
                        accentClassName="text-[#25D366]"
                        panelClassName="border-[rgba(37,211,102,0.14)] bg-[rgba(37,211,102,0.06)]"
                      />
                      <AuthMiniSignal
                        icon={Send}
                        title="Telegram"
                        detail="Escuta ativa"
                        accentClassName="text-[#229ED9]"
                        panelClassName="border-[rgba(34,158,217,0.14)] bg-[rgba(34,158,217,0.06)]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <AuthBenefitCard
                  icon={Gauge}
                  iconClassName="text-[#25D366]"
                  title="Origem controlada"
                  text="Escolha exatamente qual grupo ou canal será monitorado. A Operação parte de uma origem definida, com menos erro e mais consistência."
                />
                <AuthBenefitCard
                  icon={Clock3}
                  iconClassName="text-[#229ED9]"
                  title="Teste antes do envio real"
                  text="Simule mensagens, revise a saída final e ative a automação só quando o fluxo estiver validado. Mais segurança e menos tentativa no escuro."
                />
                <AuthBenefitCard
                  icon={ShieldCheck}
                  iconClassName="text-[#76E599]"
                  title="Afiliados integrados"
                  text="Converta links Amazon, organize a Operação da Shopee e mantenha o módulo de afiliados separado da ponte comum entre Telegram e WhatsApp."
                />
              </div>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-[rgba(37,211,102,0.16)] bg-[linear-gradient(180deg,rgba(8,29,21,0.9),rgba(4,18,13,0.96))] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.24)] lg:grid-cols-3">
                <AuthTrustItem
                  icon={TrendingUp}
                  title="Histórico auditavel"
                  label="veja o que entrou, o que foi processado, para onde saiu e quando cada entrega aconteceu."
                  accentClassName="text-[#25D366]"
                />
                <AuthTrustItem
                  icon={ShieldCheck}
                  title="Sessões sempre visiveis"
                  label="o painel mostra o estado do Telegram e do WhatsApp para a equipe agir rápido quando precisar."
                  accentClassName="text-[#77E6A0]"
                />
                <AuthTrustItem
                  icon={Users}
                  title="Estrutura de SaaS real"
                  label="conta, grupos, fluxos, afiliados, Histórico e administração no mesmo ambiente."
                  accentClassName="text-[#51CFFF]"
                />
              </div>
            </div>
          </section>

          <section className="relative z-10 rounded-[30px] border border-[rgba(255,255,255,0.1)] bg-[linear-gradient(180deg,rgba(7,26,18,0.98),rgba(4,18,13,0.99))] p-6 shadow-[0_24px_72px_rgba(0,0,0,0.36)] max-sm:rounded-[24px] max-sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[2.1rem] font-semibold leading-[1.08] text-[#F8FAFC]">Entrar na plataforma</h2>
                <p className="mt-3 max-w-sm text-[1.05rem] leading-8 text-[#AAB8B0]">
                  Acesse o painel para configurar suas conexões, organizar os fluxos, validar as entregas e operar sua estrutura de Telegram, WhatsApp e afiliados em um só lugar.
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(34,158,217,0.18)] bg-[rgba(34,158,217,0.08)] shadow-[0_12px_26px_rgba(0,0,0,0.2)]">
                <LockKeyhole size={22} className="text-[#7ED4FF]" />
              </div>
            </div>

            <div className="mt-7 grid w-full grid-cols-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-1.5">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={cn(
                  'rounded-xl px-4 py-3 text-base font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.16)]',
                  mode === 'login'
                    ? 'bg-[linear-gradient(90deg,#25D366,#21C0B7)] text-[#03130D] shadow-[0_10px_26px_rgba(37,211,102,0.2)]'
                    : 'text-[#AAB8B0] hover:bg-white/[0.03] hover:text-[#F8FAFC]'
                )}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={cn(
                  'rounded-xl px-4 py-3 text-base font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgba(34,158,217,0.14)]',
                  mode === 'register'
                    ? 'bg-[linear-gradient(90deg,#25D366,#21C0B7)] text-[#03130D] shadow-[0_10px_26px_rgba(37,211,102,0.2)]'
                    : 'text-[#AAB8B0] hover:bg-white/[0.03] hover:text-[#F8FAFC]'
                )}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={submit} className="mt-7 grid gap-5">
              {mode === 'register' ? (
                <Field label="Nome" name="name" placeholder="Seu nome" autoComplete="name" icon={Users} />
              ) : null}
              <Field label="E-mail" name="email" placeholder="você@empresa.com" autoComplete="email" icon={Mail} />
              <Field
                label="Senha"
                name="password"
                type="password"
                placeholder="********"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                icon={LockKeyhole}
                rightSlot={<Eye size={18} className="text-[#7D8D86]" />}
              />

              <div className="-mt-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setNotice('Recuperação de senha estará disponível em breve.')}
                  className="text-sm font-semibold text-[#32D07C] transition hover:text-[#5EE19C] focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.16)]"
                >
                  Esqueci minha senha
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-3 rounded-[18px] bg-[linear-gradient(90deg,#25D366,#21C0B7)] px-5 py-4 text-xl font-semibold text-[#03130D] transition hover:translate-y-[-1px] hover:shadow-[0_18px_34px_rgba(37,211,102,0.18)] focus:outline-none focus:ring-2 focus:ring-[rgba(37,211,102,0.2)] active:translate-y-0 disabled:translate-y-0 disabled:opacity-60"
              >
                {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no painel' : 'Criar conta'}
                {!busy ? <ArrowRight size={22} /> : null}
              </button>
            </form>

            <div className="mt-6 rounded-[20px] border border-[rgba(34,158,217,0.14)] bg-[linear-gradient(180deg,rgba(8,24,18,0.7),rgba(7,20,16,0.82))] px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[rgba(34,158,217,0.18)] bg-[rgba(34,158,217,0.08)]">
                  <Gauge size={18} className="text-[#7ED4FF]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#E8F6EF]">O que você encontra depois do login</p>
                  <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#AAB8B0]">
                    <li>configuração separada para Telegram, WhatsApp, Fluxos e Afiliados.</li>
                    <li>Histórico operacional com mensagens, entregas e eventos recentes.</li>
                    <li>Teste manual para validar a saída antes de ligar a automação.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="my-8 flex items-center gap-4 text-sm text-[#7A8B83]">
              <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
              ou continue com
              <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
            </div>

            {googleEnabled ? (
              <a
                href="/auth/google"
                className="flex items-center justify-center gap-3 rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-lg font-medium transition hover:border-[rgba(34,158,217,0.22)] hover:bg-[rgba(34,158,217,0.06)] focus:outline-none focus:ring-2 focus:ring-[rgba(34,158,217,0.18)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-black">G</span>
                Continuar com Google
              </a>
            ) : (
              <p className="rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-sm text-[#AAB8B0]">
                Login com Google estará disponível em breve.
              </p>
            )}

            <div className="mt-8 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[rgba(37,211,102,0.18)] bg-[rgba(37,211,102,0.08)]">
                  <ShieldCheck size={18} className="text-[#46E285]" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[#E8F6EF]">Painel feito para Operação diaria</p>
                  <p className="mt-1 text-sm leading-6 text-[#AAB8B0]">
                    Login, sessões, grupos, fluxos, Histórico e afiliados centralizados em uma experiência única para quem precisa publicar, acompanhar e ajustar rápido.
                  </p>
                </div>
              </div>
            </div>

            {notice ? (
              <p className="mt-5 rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3.5 text-sm text-[#F8FAFC]">
                {notice}
              </p>
            ) : null}
          </section>
        </div>

        <footer className="mt-6 text-center text-xs leading-6 text-[#6F8178]">
          Copyright 2026 Portal do Afiliado. Todos os direitos reservados. Proibida a cópia, distribuição ou reprodução sem autorização. Criado por Rodrigo Damasceno.
        </footer>
      </div>
    </main>
  );
}

function AuthDashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[#7B8D85]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[#F8FAFC]">{value}</p>
    </div>
  );
}

function AuthMetricPill({
  label,
  value,
  accentClassName
}: {
  label: string;
  value: string;
  accentClassName: string;
}) {
  return (
    <div className="rounded-[18px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7F9289]">{label}</p>
      <p className={cn('mt-2 text-sm font-semibold', accentClassName)}>{value}</p>
    </div>
  );
}

function AuthFlowStep({
  icon: Icon,
  title,
  text
}: {
  icon: typeof Send;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[20px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] p-4">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={18} className="text-[#DDFCEF]" />
      </div>
      <p className="mt-4 text-base font-semibold text-[#F8FAFC]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#AAB8B0]">{text}</p>
    </div>
  );
}

function AuthDashboardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.025)] px-3 py-2.5">
      <p className="text-sm text-[#B8C7C0]">{label}</p>
      <p className="text-sm font-semibold text-[#F8FAFC]">{value}</p>
    </div>
  );
}

function AuthMiniSignal({
  icon: Icon,
  title,
  detail,
  accentClassName,
  panelClassName
}: {
  icon: typeof Smartphone;
  title: string;
  detail: string;
  accentClassName: string;
  panelClassName: string;
}) {
  return (
    <div className={cn('rounded-2xl border px-3 py-3', panelClassName)}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(255,255,255,0.04)]">
          <Icon size={20} className={accentClassName} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#F8FAFC]">{title}</p>
          <p className="text-xs text-[#AAB8B0]">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function AuthBenefitCard({
  icon: Icon,
  iconClassName,
  title,
  text
}: {
  icon: typeof Smartphone;
  iconClassName: string;
  title: string;
  text: string;
}) {
  return (
    <article className="flex min-h-[152px] flex-col rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition hover:border-[rgba(37,211,102,0.18)] hover:bg-[rgba(255,255,255,0.04)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={20} className={iconClassName} />
      </div>
      <p className="mt-4 text-[1.05rem] font-semibold leading-6 text-[#F8FAFC]">{title}</p>
      <p className="mt-2 text-[0.95rem] leading-7 text-[#AAB8B0]">{text}</p>
    </article>
  );
}

function AuthTrustItem({
  icon: Icon,
  title,
  label,
  accentClassName
}: {
  icon: typeof TrendingUp;
  title: string;
  label: string;
  accentClassName: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-4 transition hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.03)]">
      <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
        <Icon size={22} className={accentClassName} />
      </div>
      <div className="min-w-0">
        <p className="text-[1.18rem] font-semibold leading-6 text-[#F8FAFC]">{title}</p>
        <p className="mt-1 max-w-[16rem] text-sm leading-6 text-[#AAB8B0]">{label}</p>
      </div>
    </div>
  );
}


