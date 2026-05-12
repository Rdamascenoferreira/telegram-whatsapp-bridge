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

const premiumInputClass =
  'w-full rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-200 outline-none transition-all placeholder:text-zinc-500 hover:border-white/20 focus:border-[#25D366] focus:bg-white/[0.04] focus:ring-4 focus:ring-[#25D366]/10 disabled:cursor-not-allowed disabled:opacity-50';

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
      setNotice(error instanceof Error ? error.message : 'Não foi possível concluir o teste de conversão.');
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
      setNotice(error instanceof Error ? error.message : 'Não foi possível salvar as regras de afiliados.');
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
      setNotice(error instanceof Error ? error.message : 'Não foi possível aceitar o termo.');
    } finally {
      setBusy('');
    }
  }

  const affiliatePrimaryButtonClass =
    'inline-flex justify-center items-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 text-sm font-bold text-zinc-950 transition-all hover:bg-[#25D366]/90 hover:shadow-[0_0_15px_rgba(37,211,102,0.2)] disabled:opacity-50 disabled:hover:shadow-none';
  const affiliateSecondaryButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50';

  const affiliateTermsAccepted = Boolean(affiliate.termsAccepted);
  const affiliateAccountLocked = Boolean(affiliate.account?.id) && !affiliateAccountEditing;
  const affiliateAccountFieldsDisabled = readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || affiliateAccountLocked || busy === 'affiliate-account';
  const amazonShortenerGloballyEnabled = Boolean(affiliate.shortener?.amazonEnabled);
  const testLinks = testResult?.convertedUrls || [];
  const testConvertedLinks = testLinks.filter((url) => url.status === 'converted' && url.affiliateUrl);
  const testConvertedCount = testLinks.filter((url) => url.status === 'converted').length;
  const testIgnoredCount = testLinks.filter((url) => url.status === 'ignored').length;
  const testErrorCount = testLinks.filter((url) => url.status === 'error').length;

  const testRewriteLabel = (mode: string) => {
    if (mode === 'groq') return 'IA Groq';
    if (mode === 'groq_fallback_local') return 'Fallback local';
    if (mode === 'link_replace_only') return 'Somente links';
    return 'Local';
  };

  const testStatusClass = (status: string) => {
    if (status === 'converted') return 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]';
    if (status === 'error') return 'border-red-500/20 bg-red-500/10 text-red-400';
    return 'border-amber-500/20 bg-amber-500/10 text-amber-400';
  };

  const testStatusLabel = (status: string) => {
    if (status === 'converted') return 'Convertido';
    if (status === 'error') return 'Erro';
    return 'Mantido';
  };

  return (
    <div className="grid gap-6">
      <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 shadow-xl backdrop-blur-md max-sm:p-5">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Automação de Afiliados</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Links Amazon e Shopee no automático</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Um fluxo separado para ler ofertas do Telegram, converter links elegíveis e entregar a mensagem final nos grupos de WhatsApp escolhidos.
            </p>
          </div>
          <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#25D366]">
            {affiliate.automations?.filter((automation) => automation.isActive).length || 0} ativa(s)
          </span>
        </div>

        {affiliate.error ? (
          <p className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {affiliate.error}
          </p>
        ) : null}

        {!affiliateModuleAllowed ? (
          <p className="mt-5 rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
            Seu plano {planLimits?.label || 'atual'} está em modo ponte simples. A automação de afiliados entra a partir do plano Plus.
          </p>
        ) : null}

        {!affiliate.termsAccepted ? (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
            <p className="text-sm font-semibold text-amber-300">Aceite obrigatório</p>
            <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
              Declaro que tenho autorização para reutilizar, adaptar e republicar as mensagens monitoradas por esta automação. Também sou responsável pelos links de afiliado configurados e pelo cumprimento das políticas dos programas.
            </p>
            <button type="button" disabled={readOnlyAccount || busy === 'affiliate-terms'} onClick={acceptTerms} className={`mt-4 ${affiliatePrimaryButtonClass}`}>
              {busy === 'affiliate-terms' ? 'Liberando módulo...' : 'Aceitar termo e liberar módulo'}
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
        <div className="grid gap-6">
          <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold text-zinc-200">Regras do automatizador</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  As origens e destinos operacionais agora ficam na aba <span className="font-semibold text-white">Fluxos</span>. Aqui você concentra apenas as configurações de afiliado, os testes e o histórico.
                </p>
              </div>
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-400">
                {activeAutomation?.name || 'Fluxo não configurado'}
              </span>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Origem ativa</p>
                <p className="mt-2 text-sm font-semibold text-white">{getTelegramChatName(state, activeAutomation?.telegramSourceGroupId)}</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  O grupo de origem do automatizador de ofertas é configurado na aba Fluxos.
                </p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Destinos ativos</p>
                <p className="mt-2 text-sm font-semibold text-white">{activeAutomation?.destinations?.length || 0} grupo(s)</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Os destinos do automatizador acompanham a seleção feita na aba Fluxos e são aplicados quando o fluxo é salvo.
                </p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04] md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Modo atual de imagem</p>
                <p className="mt-2 text-sm font-semibold text-white">{formatMediaSourceMode(activeAutomation?.mediaSourceMode)}</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Define se o automatizador tenta usar a imagem original do Telegram ou a imagem do link do produto.
                </p>
              </div>
            </div>

            <form onSubmit={(event) => event.preventDefault()} className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-start justify-between gap-4 max-md:flex-col">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">Regras de tratamento</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Defina o que fazer com links que não são Amazon/Shopee e personalize o rodapé das mensagens convertidas.
                  </p>
                </div>
                {!activeAutomation ? (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
                    Configure em Fluxos
                  </span>
                ) : affiliateRulesEditing ? (
                  <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#25D366]">
                    Edição liberada
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400">
                    Travado
                  </span>
                )}
              </div>

              <div className="mt-6 grid items-start gap-5 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Links desconhecidos</span>
                  <select
                    name="unknownLinkBehavior"
                    defaultValue={activeAutomation?.unknownLinkBehavior || 'keep'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className={premiumInputClass}
                  >
                    <option value="keep">Manter link original</option>
                    <option value="remove">Remover link</option>
                    <option value="ignore_message">Ignorar mensagem inteira</option>
                  </select>
                  <span className="text-xs leading-relaxed text-zinc-500">
                    Recomendado: manter o link original para não perder conteúdo quando o marketplace não for reconhecido.
                  </span>
                </label>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Origem da imagem</span>
                  <select
                    name="mediaSourceMode"
                    defaultValue={activeAutomation?.mediaSourceMode || 'telegram_media'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className={premiumInputClass}
                  >
                    <option value="telegram_media">Usar imagem original do Telegram</option>
                    <option value="product_image">Usar imagem do link do produto</option>
                  </select>
                  <span className="text-xs leading-relaxed text-zinc-500">
                    Se o modo escolhido falhar, o sistema usa fallback automático para manter o envio.
                  </span>
                </label>

                <div className="grid gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5">
                  <div className="inline-flex items-start gap-2 text-sm text-zinc-400">
                    <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                    <span>
                      <span className="block font-medium text-zinc-200">Modo de escrita ativo</span>
                      <span className="mt-1 block text-xs leading-relaxed">
                        O sistema preserva a mensagem original e substitui somente os links convertidos, removendo o rodapé antigo antes de aplicar o seu rodapé final.
                      </span>
                    </span>
                  </div>

                  <div className="mt-2 rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Processamento atual</p>
                    <p className="mt-1 text-sm font-medium text-white">Preservar texto original e substituir apenas os links</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      Essa é a única regra de escrita mantida no painel para garantir previsibilidade na saída e evitar conflito entre modos diferentes.
                    </p>
                  </div>
                </div>

                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Rodapé personalizado</span>
                  <textarea
                    name="customFooter"
                    defaultValue={activeAutomation?.customFooter || ''}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    placeholder={`Exemplo:\nVisite nosso Instagram:\n- www.instagram.com/exemplo\nEsperamos por vocês lá`}
                    className={cn(premiumInputClass, "min-h-36 resize-y")}
                  />
                  <span className="text-xs leading-relaxed text-zinc-500">Você pode quebrar linhas livremente nesse rodapé.</span>
                </label>
              </div>

              <div className="mt-6 flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
                <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    name="removeOriginalFooter"
                    defaultChecked={Boolean(activeAutomation?.removeOriginalFooter)}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#25D366] focus:ring-[#25D366]"
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
                  className={cn(affiliatePrimaryButtonClass, "w-auto px-6")}
                >
                  {busy === 'affiliate-rules' ? 'Salvando...' : affiliateRulesEditing ? 'Salvar regras' : 'Editar'}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4 max-md:flex-col">
              <div>
                <p className="text-sm font-semibold text-zinc-200">Simulador de mensagem final</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Cole uma oferta e veja exatamente como ela será entregue, sem enviar nada ao WhatsApp.
                </p>
              </div>
              <button type="button" disabled={readOnlyAccount || busy === 'affiliate-test' || !affiliateModuleAllowed || !affiliateTermsAccepted} onClick={runManualTest} className={affiliateSecondaryButtonClass}>
                {busy === 'affiliate-test' ? 'Testando...' : 'Rodar teste'}
              </button>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-zinc-400">
              <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-sky-400" />
              <span>
                <span className="block font-medium text-zinc-200">Preservar texto original e substituir somente os links</span>
                <span className="mt-1 block text-xs leading-relaxed">
                  Modo fixo do teste: o sistema grava os links convertidos e aplica cada link novo em cima da mensagem recebida, sem reescrever o texto.
                </span>
              </span>
            </div>

            <label className="mt-6 grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Mensagem recebida para teste</span>
              <textarea
                value={testMessage}
                disabled={readOnlyAccount}
                onChange={(event) => setTestMessage(event.target.value)}
                className={cn(premiumInputClass, "min-h-40 resize-y font-mono text-[13px] text-zinc-300")}
              />
            </label>

            {testResult ? (
              <div className="mt-6 grid gap-5">
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                  <div className="flex items-start justify-between gap-4 max-sm:flex-col">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">Resumo do teste</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Conferência rápida do que foi convertido, mantido ou bloqueado antes do envio real.
                      </p>
                    </div>
                    <span className={cn('rounded-full border px-3 py-1 text-xs font-medium capitalize', testStatusClass(testResult.status))}>
                      {testStatusLabel(testResult.status)}
                    </span>
                  </div>

                  {testResult.rewriteMode ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-sky-400">
                        Processamento: {testRewriteLabel(testResult.rewriteMode)}
                      </span>
                      {testResult.rewriteError ? (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
                          {testResult.rewriteError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center transition-colors hover:bg-white/[0.04]">
                      <p className="text-3xl font-bold text-[#25D366]">{testConvertedCount}</p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Convertido(s)</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center transition-colors hover:bg-white/[0.04]">
                      <p className="text-3xl font-bold text-zinc-300">{testIgnoredCount}</p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Mantido(s)</p>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center transition-colors hover:bg-white/[0.04]">
                      <p className="text-3xl font-bold text-red-400">{testErrorCount}</p>
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Erro(s)</p>
                    </div>
                  </div>
                </div>

                {testConvertedLinks.length ? (
                  <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[#25D366]">Links convertidos gravados</p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          Estes são os links finais que serão aplicados em cima do texto original.
                        </p>
                      </div>
                      <span className="rounded-full border border-[#25D366]/30 bg-[#25D366]/20 px-3 py-1 text-xs font-bold text-[#25D366]">
                        {testConvertedLinks.length}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2">
                      {testConvertedLinks.map((url, index) => (
                        <div key={`${url.originalUrl}-converted-${index}`} className="rounded-xl border border-white/5 bg-black/20 p-4 text-xs">
                          <p className="font-semibold capitalize text-[#25D366]">{url.marketplace}</p>
                          <p className="mt-2 break-all text-zinc-400">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all text-zinc-200">Convertido: {url.affiliateUrl}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Entrada original</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/20 p-4 font-mono text-[13px] leading-relaxed text-zinc-400">
                      {testResult.originalMessage}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#25D366]">Saída que será enviada</p>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/20 p-4 font-mono text-[13px] leading-relaxed text-white">
                      {testResult.processedMessage}
                    </pre>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-zinc-200">Links analisados</p>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
                      {testLinks.length} link(s)
                    </span>
                  </div>

                  {testLinks.length ? testLinks.map((url, index) => (
                    <div key={`${url.originalUrl}-${index}`} className={cn('rounded-2xl border p-5 text-xs', testStatusClass(url.status))}>
                      <div className="flex items-start justify-between gap-4 max-sm:flex-col">
                        <div>
                          <p className="font-semibold capitalize text-lg">{url.marketplace} - {testStatusLabel(url.status)}</p>
                          <p className="mt-2 break-all opacity-70">Original: {url.originalUrl}</p>
                          <p className="mt-1 break-all font-medium">Final: {url.affiliateUrl || url.expandedUrl || '-'}</p>
                        </div>
                        <span className="rounded-full border border-current/20 bg-current/10 px-3 py-1 font-semibold uppercase tracking-wider text-[10px]">
                          {url.status}
                        </span>
                      </div>

                      {url.marketplace === 'shopee' && url.affiliateId ? (
                        <p className="mt-3 break-all opacity-70">Affiliate ID aplicado: {url.affiliateId}</p>
                      ) : null}
                      {url.marketplace === 'shopee' && url.subIds ? (
                        <div className="mt-3 grid gap-1.5 rounded-xl border border-current/10 bg-black/20 p-3 opacity-90">
                          <p className="font-semibold">SUBIDs aplicados:</p>
                          {Object.entries(url.subIds).map(([key, value]) => (
                            <p key={key}>{key.replace('subId', 'sub_id_')}: {value}</p>
                          ))}
                          {url.utmContent ? <p className="break-all mt-1">utm_content final: {url.utmContent}</p> : null}
                        </div>
                      ) : null}
                      {url.error ? <p className="mt-3 font-medium text-red-400">Erro: {url.error}</p> : null}
                    </div>
                  )) : (
                    <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-zinc-500 text-center">
                      Nenhum link foi encontrado nessa mensagem.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="grid gap-6">
          <form ref={affiliateAccountFormRef} onSubmit={(event) => event.preventDefault()} className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-zinc-200">Contas de afiliado</p>
              {affiliate.account?.id ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${affiliateAccountEditing ? 'border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366]' : 'border-white/10 bg-white/5 text-zinc-400'}`}>
                  {affiliateAccountEditing ? 'Edição liberada' : 'Travado'}
                </span>
              ) : null}
            </div>
            
            <div className="mt-6 grid gap-4">
              <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-300 cursor-pointer">
                <input 
                  type="checkbox" 
                  name="amazonEnabled" 
                  defaultChecked={Boolean(affiliate.account?.amazonEnabled)} 
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#25D366] focus:ring-[#25D366]" 
                /> 
                Converter Amazon
              </label>
              
              <input 
                name="amazonTag" 
                disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} 
                defaultValue={affiliate.account?.amazonTag || ''} 
                className={premiumInputClass} 
                placeholder={planLimits?.amazonAffiliate ? 'sua-tag-20' : 'Disponível no Plus'} 
              />
              
              <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-300 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  name="amazonShortenerEnabled"
                  defaultChecked={Boolean(affiliate.account?.amazonShortenerEnabled)}
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#25D366] focus:ring-[#25D366]"
                />
                Encurtar links Amazon automaticamente
              </label>
              
              {!amazonShortenerGloballyEnabled ? (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-300">
                  Encurtador global desligado no servidor. Mesmo com esta opção marcada, os testes e envios usam o link Amazon normal com tag.
                </p>
              ) : null}

              <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5">
                <label className="inline-flex items-center gap-3 text-sm font-medium text-sky-100 cursor-pointer">
                  <input 
                    type="checkbox" 
                    name="shopeeEnabled" 
                    defaultChecked={Boolean(affiliate.account?.shopeeEnabled)} 
                    disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate}
                    className="h-4 w-4 rounded border-sky-500/30 bg-white/5 text-sky-500 focus:ring-sky-500" 
                  />
                  Converter Shopee com link curto oficial
                </label>
                <p className="mt-3 text-xs leading-relaxed text-sky-200/70">
                  SUBIDs são opcionais e servem apenas para rastrear de onde veio a venda. O link funciona sem eles, mas recomendamos usar para relatórios.
                </p>
              </div>

              <label className="grid gap-2 mt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Affiliate ID Shopee</span>
                <input 
                  name="shopeeAffiliateId" 
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} 
                  defaultValue={affiliate.account?.shopeeAffiliateId || ''} 
                  className={premiumInputClass} 
                  placeholder={planLimits?.shopeeAffiliate ? 'Ex: 18393040998' : 'Disponível no Pro'} 
                />
                <span className="text-xs leading-relaxed text-zinc-500">Seu ID de afiliado da Shopee. Usado para gerar o link comissionado.</span>
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Prefixo de rastreamento / Campanha padrão</span>
                <input 
                  name="defaultSubId" 
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} 
                  defaultValue={affiliate.account?.defaultSubId || ''} 
                  className={premiumInputClass} 
                  placeholder="Ex: auto" 
                />
                <span className="text-xs leading-relaxed text-zinc-500">Usado no SUBID para identificar origem das conversões. Exemplo: auto, maio2026, grupo-vip.</span>
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">App ID Shopee</span>
                <input 
                  name="shopeeAppId" 
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} 
                  defaultValue={affiliate.account?.shopeeAppId || ''} 
                  className={premiumInputClass} 
                  placeholder="App ID Shopee" 
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Secret/API Secret</span>
                <input 
                  name="shopeeSecret" 
                  disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} 
                  className={premiumInputClass} 
                  placeholder={affiliate.account?.shopeeSecretConfigured ? 'Secret já configurado' : 'Secret/API Secret'} 
                />
                <span className="text-xs leading-relaxed text-zinc-500">
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
                className={`mt-6 ${affiliatePrimaryButtonClass}`}
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
                className={`mt-6 ${affiliatePrimaryButtonClass}`}
              >
                {busy === 'affiliate-account' ? 'Salvando...' : 'Salvar dados'}
              </button>
            )}
          </form>

          <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm">
            <p className="text-sm font-semibold text-zinc-200">Histórico recente</p>
            <div className="mt-5 grid gap-3">
              {affiliate.logs?.length ? affiliate.logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{log.status}</span>
                    <span className="text-[11px] text-zinc-500">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-zinc-400">{log.processedMessage || log.originalMessage}</p>
                  {log.errorMessage ? <p className="mt-3 text-xs font-medium text-red-400">{log.errorMessage}</p> : null}
                </div>
              )) : (
                <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                  Nenhuma mensagem processada ainda.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
