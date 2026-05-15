'use client';

import { ArrowRight, CreditCard, Eye, LockKeyhole, Mail, MessageSquare, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Field } from '../common-ui';
import { postJson } from '../../../lib/http';
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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
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
      setNotice(error instanceof Error ? error.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full bg-[var(--background)] text-[var(--foreground)] selection:bg-[#25D366]/20">
      {/* Left Column - Hero/Value Prop */}
      <section className="relative hidden w-full flex-col justify-between overflow-hidden bg-[var(--panel)] p-12 lg:flex lg:max-w-[45%] xl:max-w-[50%] border-r border-white/5">
        {/* Subtle Background Effects */}
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[#25D366]/10 blur-[120px] mix-blend-screen pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[#229ED9]/10 blur-[120px] mix-blend-screen pointer-events-none" />
        
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-sm backdrop-blur-md">
            <img src="/brand/portal-icon.svg" alt="Portal do Afiliado" className="h-7 w-7 object-contain" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-white">Portal do Afiliado</span>
        </div>

        <div className="relative z-10 my-auto w-full max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300 backdrop-blur-md mb-6">
            <span className="flex h-2 w-2 rounded-full bg-[#25D366]"></span>
            Plataforma Oficial
          </div>
          
          <h1 className="text-4xl font-semibold leading-[1.15] text-white xl:text-5xl">
            A ponte definitiva entre <span className="text-[#25D366]">Telegram</span> e <span className="text-[#25D366]">WhatsApp</span>.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-400">
            Gerencie grupos, converta links de afiliados automaticamente e opere suas entregas com previsibilidade e controle absoluto em uma única plataforma SaaS.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <FeatureItem icon={MessageSquare} title="Origem Telegram" text="Monitore canais ou grupos com precisão cirúrgica." />
            <FeatureItem icon={Smartphone} title="Destinos WhatsApp" text="Entregas limpas, controladas e no formato certo." />
            <FeatureItem icon={CreditCard} title="Links Automáticos" text="Integração nativa com Amazon, Shopee e Mercado Livre." />
            <FeatureItem icon={ShieldCheck} title="Painel de Controle" text="Sessões, histórico e testes em um só lugar." />
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-4 text-sm font-medium text-zinc-500">
          <p>© 2026 Portal do Afiliado</p>
          <div className="h-1 w-1 rounded-full bg-zinc-700"></div>
          <p>Operação Escalável</p>
        </div>
      </section>

      {/* Right Column - Auth Form */}
      <section className="flex w-full flex-col items-center justify-center p-6 sm:p-12 lg:w-auto lg:flex-1 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        
        <div className="w-full max-w-[420px] relative z-10">
          {/* Mobile Header (Hidden on Desktop) */}
          <div className="mb-10 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 shadow-sm backdrop-blur-md">
              <img src="/brand/portal-icon.svg" alt="Portal do Afiliado" className="h-7 w-7 object-contain" />
            </div>
            <span className="text-2xl font-semibold tracking-tight text-white">Portal do Afiliado</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
            </h2>
            <p className="mt-2 text-zinc-400 text-sm">
              {mode === 'login' 
                ? 'Insira suas credenciais para acessar o painel de operação.' 
                : 'Configure seu ambiente para automatizar seus grupos hoje mesmo.'}
            </p>
          </div>

          <form onSubmit={submit} className="grid gap-5">
            {mode === 'register' && (
              <Field label="Nome completo" name="name" placeholder="Seu nome" autoComplete="name" icon={Users} />
            )}
            <Field label="E-mail" name="email" placeholder="voce@empresa.com" autoComplete="email" icon={Mail} />
            <Field
              label="Senha"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              icon={LockKeyhole}
              rightSlot={<Eye size={18} className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer" />}
            />

            {mode === 'login' && (
              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setNotice('A recuperação de senha estará disponível em breve.')}
                  className="text-xs font-medium text-zinc-400 transition-colors hover:text-white focus:outline-none focus:underline"
                >
                  Esqueci minha senha
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3.5 text-sm font-semibold text-zinc-950 transition-all hover:bg-[#20bd5a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(37,211,102,0.2)] active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {busy ? 'Processando...' : mode === 'login' ? 'Entrar no Painel' : 'Criar minha conta'}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          {notice && (
            <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300 backdrop-blur-md flex items-center gap-3">
              <div className="h-1.5 w-1.5 rounded-full bg-[#25D366] shrink-0" />
              {notice}
            </div>
          )}

          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-zinc-800/80"></div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Ou continue com</span>
            <div className="h-px flex-1 bg-zinc-800/80"></div>
          </div>

          {googleEnabled ? (
            <a
              href="/auth/google"
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-800 bg-white/[0.02] px-4 py-3.5 text-sm font-medium text-white transition-all hover:bg-white/[0.06] hover:border-zinc-700 active:translate-y-[1px]"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-zinc-900">G</div>
              Entrar com Google
            </a>
          ) : (
            <div className="flex w-full justify-center rounded-xl border border-zinc-800/50 bg-zinc-900/30 px-4 py-3.5 text-sm text-zinc-500">
              Login com Google em breve
            </div>
          )}

          <div className="mt-8 text-center text-sm text-zinc-400">
            {mode === 'login' ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setNotice('');
              }}
              className="font-medium text-white underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-[#25D366] hover:decoration-[#25D366]"
            >
              {mode === 'login' ? 'Criar agora' : 'Faça login'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function FeatureItem({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4 transition-all hover:bg-white/[0.03] hover:border-white/[0.08]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-zinc-800/40 text-zinc-300 shadow-inner">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="font-medium text-zinc-100 text-sm">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{text}</p>
      </div>
    </div>
  );
}


