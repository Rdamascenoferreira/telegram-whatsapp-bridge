'use client';

import { FormEvent, useRef, useState } from 'react';
import { formatDate, normalizeRouteSourceId } from '../../../lib/panel-utils';
import { HTTP_TIMEOUT_MS, postJson, postJsonWithOptions } from '../../../lib/http';
import { cn } from '../../../lib/utils';
import type { AffiliateLog, AppState } from '../../types/panel';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

function formatMediaSourceMode(value?: string) {
  return String(value || '').toLowerCase() === 'product_image'
    ? 'Imagem do link do produto'
    : 'Imagem original do Telegram';
}

function getTelegramChatName(state: AppState, sourceId?: string | null) {
  const normalizedSourceId = normalizeRouteSourceId(sourceId);

  return (
    state.telegram.availableChats?.find((chat) => normalizeRouteSourceId(chat.id) === normalizedSourceId)?.name ||
    normalizedSourceId ||
    'Nenhuma origem escolhida'
  );
}

export function AffiliateAutomationPanel({
  state,
  setNotice,
  setBusy,
  busy,
  refresh
}: {
  state: AppState;
  setNotice: (message: string) => void;
  setBusy: (value: string) => void;
  busy: string;
  refresh: () => Promise<void>;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const planLimits = state.planLimits;
  const affiliateAutomationLimit = planLimits?.affiliateAutomations ?? Number.POSITIVE_INFINITY;
  const affiliateModuleAllowed = affiliateAutomationLimit > 0;
  const affiliate = state.affiliate || { account: null, automations: [], logs: [], termsAccepted: false };
  const firstAutomation = affiliate.automations?.[0];
  const activeAutomation = firstAutomation;
  const [affiliateRulesEditing, setAffiliateRulesEditing] = useState(false);
  const [affiliateAccountEditing, setAffiliateAccountEditing] = useState(false);
  const affiliateAccountFormRef = useRef<HTMLFormElement>(null);
  const [testMessage, setTestMessage] = useState('Monitor Gamer LG UltraGear 24\n\nCupom: QUINTOUU\nR$ 639,00 a vista\nhttps://amzn.to/3QdY360');
  const testPreserveOriginalText = true;
  const [testResult, setTestResult] = useState<{
    originalMessage: string;
    processedMessage: string;
    convertedUrls: AffiliateLog['convertedUrls'];
    status: string;
    rewriteMode?: string;
    rewriteError?: string;
  } | null>(null);

  async function submitAccount(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const formElement = event?.currentTarget || affiliateAccountFormRef.current;
    if (!formElement) {
      return;
    }
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de salvar as credenciais.');
      return;
    }
    setBusy('affiliate-account');
    const form = new FormData(formElement);

    try {
      await postJsonWithOptions('/api/affiliate/account', {
        amazonEnabled: form.get('amazonEnabled') === 'on',
        amazonTag: form.get('amazonTag'),
        amazonShortenerEnabled: form.get('amazonShortenerEnabled') === 'on',
        shopeeEnabled: form.get('shopeeEnabled') === 'on',
        shopeeAffiliateId: form.get('shopeeAffiliateId'),
        defaultSubId: form.get('defaultSubId'),
        shopeeAppId: form.get('shopeeAppId'),
        shopeeSecret: form.get('shopeeSecret')
      }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });

      await refresh();
      setAffiliateAccountEditing(false);
      setNotice('Dados de afiliado salvos.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possível salvar os dados de afiliado.');
    } finally {
      setBusy('');
    }
  }

  async function runManualTest() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de rodar o teste.');
      return;
    }

    setBusy('affiliate-test');
    try {
      const draftAutomation = {
        ...(activeAutomation || {
          name: 'Teste manual',
          telegramSourceGroupId: state.telegram.availableChats?.[0]?.id || '',
          unknownLinkBehavior: 'keep',
          removeOriginalFooter: false,
          customFooter: '',
          messageBeautifierEnabled: false,
          messageBeautifierStyle: 'clean',
          aiRewriteEnabled: false,
          aiRewriteStyle: 'clean',
          mediaSourceMode: 'telegram_media'
        }),
        preserveOriginalTextEnabled: true,
        messageBeautifierEnabled: false,
        aiRewriteEnabled: false
      };
      const result = await postJson<typeof testResult>('/api/affiliate/test', {
        automationId: '',
        automation: draftAutomation,
        message: testMessage
      });
      setTestResult(result);
      setNotice('Teste de conversão concluído.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possível concluir o teste de conversão.');
    } finally {
      setBusy('');
    }
  }

  async function saveAffiliateRules(formElement: HTMLFormElement) {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }
    if (!affiliateModuleAllowed) {
      setNotice(`O plano ${planLimits?.label || 'atual'} ainda não inclui automação de Afiliados.`);
      return;
    }
    if (!affiliate.termsAccepted) {
      setNotice('Aceite os termos de afiliados antes de salvar as regras.');
      return;
    }
    if (!activeAutomation?.id || !activeAutomation.telegramSourceGroupId) {
      setNotice('Configure primeiro o Automatizador de Ofertas na aba Fluxos.');
      return;
    }

    setBusy('affiliate-rules');
    try {
      const form = new FormData(formElement);
      await postJsonWithOptions(`/api/affiliate/automations/${activeAutomation.id}/rules`, {
        unknownLinkBehavior: form.get('unknownLinkBehavior'),
        customFooter: form.get('customFooter'),
        removeOriginalFooter: form.get('removeOriginalFooter') === 'on',
        mediaSourceMode: form.get('mediaSourceMode'),
        messageBeautifierEnabled: false,
        messageBeautifierStyle: 'clean',
        aiRewriteEnabled: false,
        aiRewriteStyle: 'clean',
        preserveOriginalTextEnabled: true
      }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
      await refresh();
      setAffiliateRulesEditing(false);
      setNotice('Regras de afiliados salvas.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possível salvar as regras de afiliados.');
    } finally {
      setBusy('');
    }
  }

  async function acceptTerms() {
    if (readOnlyAccount) {
      setNotice('Conta em teste: edições estão bloqueadas até liberação do administrador.');
      return;
    }

    setBusy('affiliate-terms');
    try {
      await postJsonWithOptions('/api/affiliate/terms/accept', {}, { timeoutMs: HTTP_TIMEOUT_MS.FAST });
      await refresh();
      setNotice('Termo de uso aceito.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'não foi possível aceitar o termo.');
    } finally {
      setBusy('');
    }
  }

  const affiliatePrimaryButtonClass =
    'rounded-xl border border-emerald-300/20 bg-[linear-gradient(135deg,rgba(37,211,102,0.96),rgba(34,158,217,0.92))] px-5 py-3 font-semibold text-slate-950 shadow-[0_14px_30px_rgba(25,140,102,0.28)] transition hover:-translate-y-[1px] hover:shadow-[0_18px_38px_rgba(25,140,102,0.36)] disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none';
  const affiliateSecondaryButtonClass =
    'rounded-xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),rgba(34,158,217,0.2))] px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-cyan-300/30 hover:bg-[linear-gradient(135deg,rgba(16,185,129,0.24),rgba(34,158,217,0.28))] hover:text-white disabled:opacity-60';
  const affiliateTermsAccepted = Boolean(affiliate.termsAccepted);
  const affiliateAccountLocked = Boolean(affiliate.account?.id) && !affiliateAccountEditing;
  const affiliateAccountFieldsDisabled = readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || affiliateAccountLocked || busy === 'affiliate-account';
  const testLinks = testResult?.convertedUrls || [];
  const testConvertedLinks = testLinks.filter((url) => url.status === 'converted' && url.affiliateUrl);
  const testConvertedCount = testLinks.filter((url) => url.status === 'converted').length;
  const testIgnoredCount = testLinks.filter((url) => url.status === 'ignored').length;
  const testErrorCount = testLinks.filter((url) => url.status === 'error').length;
  const testRewriteLabel = (mode: string) => {
    if (mode === 'groq') {
      return 'IA Groq';
    }
    if (mode === 'groq_fallback_local') {
      return 'Fallback local';
    }
    if (mode === 'link_replace_only') {
      return 'Somente links';
    }
    return 'Local';
  };
  const testStatusClass = (status: string) => {
    if (status === 'converted') {
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100';
    }
    if (status === 'error') {
      return 'border-red-400/25 bg-red-400/10 text-red-100';
    }
    return 'border-amber-400/25 bg-amber-400/10 text-amber-100';
  };
  const testStatusLabel = (status: string) => {
    if (status === 'converted') {
      return 'Convertido';
    }
    if (status === 'error') {
      return 'Erro';
    }
    return 'Mantido';
  };

  return (
    <div className="grid gap-5">
      <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] max-sm:p-4">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">automação de Afiliados</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Links Amazon e Shopee no automatico</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Um fluxo separado para ler ofertas do Telegram, converter links elegiveis e entregar a mensagem final nos grupos de WhatsApp escolhidos.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
            {affiliate.automations?.filter((automation) => automation.isActive).length || 0} ativa(s)
          </span>
        </div>

        {affiliate.error ? (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {affiliate.error}
          </p>
        ) : null}

        {!affiliateModuleAllowed ? (
          <p className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            Seu plano {planLimits?.label || 'atual'} está em modo ponte simples. automação de Afiliados entra a partir do plano Plus.
          </p>
        ) : null}

        {!affiliate.termsAccepted ? (
          <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
            <p className="text-sm font-semibold text-amber-50">Aceite obrigatorio</p>
            <p className="mt-2 text-xs leading-5 text-amber-100/80">
              Declaro que tenho autorização para reutilizar, adaptar e republicar as mensagens monitoradas por esta automação. Também sou responsável pelos links de afiliado configurados e pelo cumprimento das políticas dos programas.
            </p>
            <button type="button" disabled={readOnlyAccount || busy === 'affiliate-terms'} onClick={acceptTerms} className={`mt-3 ${affiliatePrimaryButtonClass}`}>
              {busy === 'affiliate-terms' ? 'Liberando módulo...' : 'Aceitar termo e liberar módulo'}
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="grid gap-5">
          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Regras do automatizador</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  As origens e destinos operacionais agora ficam na aba <span className="font-semibold text-[var(--foreground)]">Fluxos</span>. Aqui você concentra apenas as configurações de afiliado, os testes e o Histórico.
                </p>
              </div>
              <span className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100">
                {activeAutomation?.name || 'Fluxo não configurado'}
              </span>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Origem ativa</p>
                <p className="mt-2 text-sm font-semibold">{getTelegramChatName(state, activeAutomation?.telegramSourceGroupId)}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  O grupo de origem do automatizador de ofertas e configurado na aba Fluxos.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Destinos ativos</p>
                <p className="mt-2 text-sm font-semibold">{activeAutomation?.destinations?.length || 0} grupo(s)</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Os destinos do automatizador acompanham a selecao feita na aba Fluxos e sao aplicados quando o fluxo e salvo.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Modo atual de imagem</p>
                <p className="mt-2 text-sm font-semibold">{formatMediaSourceMode(activeAutomation?.mediaSourceMode)}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Define se o automatizador tenta usar a imagem original do Telegram ou a imagem do link do produto.
                </p>
              </div>
            </div>

            <form onSubmit={(event) => event.preventDefault()} className="mt-4 rounded-2xl border border-[var(--border)] bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3 max-md:flex-col">
                <div>
                  <p className="text-sm font-semibold">Regras de tratamento</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    Defina o que fazer com links que não sao Amazon/Shopee e personalize o rodapé das mensagens convertidas.
                  </p>
                </div>
                {!activeAutomation ? (
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
                    Configure em Fluxos
                  </span>
                ) : affiliateRulesEditing ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                    Edicao liberada
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                    Travado
                  </span>
                )}
              </div>

              <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Links desconhecidos</span>
                  <select
                    name="unknownLinkBehavior"
                    defaultValue={activeAutomation?.unknownLinkBehavior || 'keep'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <option value="keep">Manter link original</option>
                    <option value="remove">Remover link</option>
                    <option value="ignore_message">Ignorar mensagem inteira</option>
                  </select>
                  <span className="text-xs leading-5 text-[var(--muted)]">
                    Recomendado: manter o link original para não perder conteudo quando o marketplace não for reconhecido.
                  </span>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Origem da imagem</span>
                  <select
                    name="mediaSourceMode"
                    defaultValue={activeAutomation?.mediaSourceMode || 'telegram_media'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <option value="telegram_media">Usar imagem original do Telegram</option>
                    <option value="product_image">Usar imagem do link do produto</option>
                  </select>
                  <span className="text-xs leading-5 text-[var(--muted)]">
                    Se o modo escolhido falhar, o sistema usa fallback automatico para manter o envio.
                  </span>
                </label>

                <div className="grid gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4">
                  <div className="inline-flex items-start gap-2 text-sm text-[var(--muted)]">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" />
                    <span>
                      <span className="block font-semibold text-[var(--foreground)]">Modo de escrita ativo</span>
                      <span className="mt-1 block text-xs leading-5">
                        O sistema preserva a mensagem original e substitui somente os links convertidos, removendo o rodapé antigo antes de aplicar o seu rodapé final.
                      </span>
                    </span>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Processamento atual</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">Preservar texto original e substituir apenas os links</p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      Essa e a única regra de escrita mantida no painel para garantir previsibilidade na saída e evitar conflito entre modos diferentes.
                    </p>
                  </div>
                </div>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Rodape personalizado</span>
                  <textarea
                    name="customFooter"
                    defaultValue={activeAutomation?.customFooter || ''}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    placeholder={`Exemplo:\nVisite nosso Instagram:\n- www.instagram.com/exemplo\nEsperamos por vocês lá`}
                    className="min-h-32 rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm leading-6 outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-65"
                  />
                  <span className="text-xs leading-5 text-[var(--muted)]">você pode quebrar linhas livremente nesse rodapé.</span>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input
                    type="checkbox"
                    name="removeOriginalFooter"
                    defaultChecked={Boolean(activeAutomation?.removeOriginalFooter)}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                  />
                  Remover rodapé original da mensagem captada
                </label>
                <button
                  type="button"
                  onClick={(event) => {
                    if (!affiliateRulesEditing) {
                      setAffiliateRulesEditing(true);
                      return;
                    }

                    if (event.currentTarget.form) {
                      void saveAffiliateRules(event.currentTarget.form);
                    }
                  }}
                  disabled={readOnlyAccount || busy === 'affiliate-rules' || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation}
                  className={affiliatePrimaryButtonClass}
                >
                  {busy === 'affiliate-rules' ? 'Salvando...' : affiliateRulesEditing ? 'Salvar regras' : 'Editar'}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold">Simulador de mensagem final</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Cole uma oferta e veja exatamente como ela será entregue, sem enviar nada ao WhatsApp.
                </p>
              </div>
              <button type="button" disabled={readOnlyAccount || busy === 'affiliate-test' || !affiliateModuleAllowed || !affiliateTermsAccepted} onClick={runManualTest} className={affiliateSecondaryButtonClass}>
                {busy === 'affiliate-test' ? 'Testando...' : 'Rodar teste'}
              </button>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.05] p-4 text-sm text-[var(--muted)]">
              <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" />
              <span>
                <span className="block font-semibold text-[var(--foreground)]">Preservar texto original e substituir somente os links</span>
                <span className="mt-1 block text-xs leading-5">
                  Modo fixo do teste: o sistema grava os links convertidos e aplica cada link novo em cima da mensagem recebida, sem reescrever o texto.
                </span>
              </span>
            </div>

            <label className="mt-4 grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Mensagem recebida para teste</span>
              <textarea
                value={testMessage}
                disabled={readOnlyAccount}
                onChange={(event) => setTestMessage(event.target.value)}
                className="min-h-40 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm leading-6 disabled:cursor-not-allowed disabled:opacity-65"
              />
            </label>

            {testResult ? (
              <div className="mt-5 grid gap-4">
                <div className="rounded-2xl border border-emerald-400/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(34,158,217,0.08))] p-4">
                  <div className="flex items-start justify-between gap-3 max-sm:flex-col">
                    <div>
                      <p className="text-sm font-semibold">Resumo do teste</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Conferencia rapida do que foi convertido, mantido ou bloqueado antes do envio real.
                      </p>
                    </div>
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold capitalize', testStatusClass(testResult.status))}>
                      {testStatusLabel(testResult.status)}
                    </span>
                  </div>

                  {testResult.rewriteMode ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                        Processamento: {testRewriteLabel(testResult.rewriteMode)}
                      </span>
                      {testResult.rewriteError ? (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-100">
                          {testResult.rewriteError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-emerald-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-emerald-100">{testConvertedCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Convertido(s)</p>
                    </div>
                    <div className="rounded-xl border border-amber-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-amber-100">{testIgnoredCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Mantido(s)</p>
                    </div>
                    <div className="rounded-xl border border-red-400/15 bg-black/15 p-3">
                      <p className="text-2xl font-semibold text-red-100">{testErrorCount}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Erro(s)</p>
                    </div>
                  </div>
                </div>

                {testConvertedLinks.length ? (
                  <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Links convertidos gravados</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          Estes sao os links finais que serao aplicados em cima do texto original.
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                        {testConvertedLinks.length}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {testConvertedLinks.map((url, index) => (
                        <div key={`${url.originalUrl}-converted-${index}`} className="rounded-xl border border-white/10 bg-black/15 p-3 text-xs">
                          <p className="font-semibold capitalize text-emerald-100">{url.marketplace}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all text-emerald-50/90">Convertido: {url.affiliateUrl}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-black/15 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Entrada original</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-[var(--muted)]">
                      {testResult.originalMessage}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100">Saida que será enviada</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-emerald-400/15 bg-black/20 p-4 text-xs leading-5 text-emerald-50/90">
                      {testResult.processedMessage}
                    </pre>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Links analisados</p>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[var(--muted)]">
                      {testLinks.length} link(s)
                    </span>
                  </div>

                  {testLinks.length ? testLinks.map((url, index) => (
                    <div key={`${url.originalUrl}-${index}`} className={cn('rounded-2xl border p-4 text-xs', testStatusClass(url.status))}>
                      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
                        <div>
                          <p className="font-semibold capitalize">{url.marketplace} - {testStatusLabel(url.status)}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all text-[var(--muted)]">Final: {url.affiliateUrl || url.expandedUrl || '-'}</p>
                        </div>
                        <span className="rounded-full border border-current/20 px-3 py-1 font-semibold">
                          {url.status}
                        </span>
                      </div>

                      {url.marketplace === 'shopee' && url.affiliateId ? (
                        <p className="mt-3 break-all text-[var(--muted)]">Affiliate ID aplicado: {url.affiliateId}</p>
                      ) : null}
                      {url.marketplace === 'shopee' && url.subIds ? (
                        <div className="mt-3 grid gap-1 rounded-xl border border-white/10 bg-black/15 p-3 text-[var(--muted)]">
                          <p className="font-semibold text-[var(--foreground)]">SUBIDs aplicados:</p>
                          {Object.entries(url.subIds).map(([key, value]) => (
                            <p key={key}>{key.replace('subId', 'sub_id_')}: {value}</p>
                          ))}
                          {url.utmContent ? <p className="break-all">utm_content final: {url.utmContent}</p> : null}
                        </div>
                      ) : null}
                      {url.error ? <p className="mt-3 text-amber-100">Erro: {url.error}</p> : null}
                    </div>
                  )) : (
                    <p className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
                      Nenhum link foi encontrado nessa mensagem.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-5">
          <form ref={affiliateAccountFormRef} onSubmit={(event) => event.preventDefault()} className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">Contas de afiliado</p>
              {affiliate.account?.id ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${affiliateAccountEditing ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/[0.04] text-[var(--muted)]'}`}>
                  {affiliateAccountEditing ? 'Edicao liberada' : 'Travado'}
                </span>
              ) : null}
            </div>
            <div className="mt-4 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" name="amazonEnabled" defaultChecked={Boolean(affiliate.account?.amazonEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} /> Converter Amazon</label>
              <input name="amazonTag" disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} defaultValue={affiliate.account?.amazonTag || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.amazonAffiliate ? 'sua-tag-20' : 'Disponivel no Plus'} />
              <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                <input
                  type="checkbox"
                  name="amazonShortenerEnabled"
                  defaultChecked={Boolean(affiliate.account?.amazonShortenerEnabled)}
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate}
                />
                Encurtar links Amazon automaticamente
              </label>

              <div className="mt-2 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] p-4">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input type="checkbox" name="shopeeEnabled" defaultChecked={Boolean(affiliate.account?.shopeeEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} />
                  Converter Shopee com link curto oficial
                </label>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  SUBIDs sao opcionais e servem apenas para rastrear de onde veio a venda. O link funciona sem eles, mas recomendamos usar para relatórios.
                </p>
              </div>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Affiliate ID Shopee</span>
                <input name="shopeeAffiliateId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAffiliateId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={planLimits?.shopeeAffiliate ? 'Ex: 18393040998' : 'Disponivel no Pro'} />
                <span className="text-xs leading-5 text-[var(--muted)]">Seu ID de afiliado da Shopee. Usado para gerar o link comissionado.</span>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Prefixo de rastreamento / Campanha padrão</span>
                <input name="defaultSubId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.defaultSubId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="Ex: auto" />
                <span className="text-xs leading-5 text-[var(--muted)]">Usado no SUBID para identificar origem das conversoes. Exemplo: auto, maio2026, grupo-vip.</span>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">App ID Shopee</span>
                <input name="shopeeAppId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAppId || ''} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder="App ID Shopee" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Secret/API Secret</span>
                <input name="shopeeSecret" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} className="rounded-2xl border border-[var(--border)] bg-white/[0.04] px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-65" placeholder={affiliate.account?.shopeeSecretConfigured ? 'Secret já configurado' : 'Secret/API Secret'} />
                <span className="text-xs leading-5 text-[var(--muted)]">
                  Usado apenas na comunicação segura com a Shopee. Se já estiver configurado, deixe em branco para manter o secret atual.
                </span>
              </label>
            </div>
            {affiliateAccountLocked ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setAffiliateAccountEditing(true);
                }}
                disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                className={`mt-4 w-full ${affiliatePrimaryButtonClass}`}
              >
                Editar
              </button>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void submitAccount();
                }}
                disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                className={`mt-4 w-full ${affiliatePrimaryButtonClass}`}
              >
                {busy === 'affiliate-account' ? 'Salvando...' : 'Salvar dados'}
              </button>
            )}
          </form>

          <section className="rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5">
            <p className="text-sm font-semibold">Histórico recente</p>
            <div className="mt-4 grid gap-3">
              {affiliate.logs?.length ? affiliate.logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{log.status}</span>
                    <span className="text-[11px] text-[var(--muted)]">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">{log.processedMessage || log.originalMessage}</p>
                  {log.errorMessage ? <p className="mt-2 text-xs text-red-100">{log.errorMessage}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">Nenhuma mensagem processada ainda.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}


