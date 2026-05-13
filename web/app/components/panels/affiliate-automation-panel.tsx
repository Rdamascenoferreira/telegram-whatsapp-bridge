'use client';

import { FormEvent, useRef, useState } from 'react';
import { History, MessageSquare, Settings, ShoppingBag, Store, CheckCircle2 } from 'lucide-react';
import { formatDate, normalizeRouteSourceId } from '../../../lib/panel-utils';
import { HTTP_TIMEOUT_MS, postJson, postJsonWithOptions } from '../../../lib/http';
import { cn } from '../../../lib/utils';
import type { AffiliateLog, AppState } from '../../types/panel';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

const premiumInputClass =
  'w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none transition-all placeholder:text-zinc-600 hover:border-white/20 focus:border-[#25D366] focus:bg-white/[0.04] focus:ring-4 focus:ring-[#25D366]/10 disabled:cursor-not-allowed disabled:opacity-50';

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
  const [activeTab, setActiveTab] = useState<'config' | 'simulator' | 'history'>('config');
  const [affiliateRulesEditing, setAffiliateRulesEditing] = useState(false);
  const [affiliateAccountEditing, setAffiliateAccountEditing] = useState(false);
  const affiliateAccountFormRef = useRef<HTMLFormElement>(null);
  const [testMessage, setTestMessage] = useState('Monitor Gamer LG UltraGear 24\n\nCupom: QUINTOUU\nR$ 639,00 a vista\nhttps://amzn.to/3QdY360');
  const [testResult, setTestResult] = useState<{
    originalMessage: string;
    processedMessage: string;
    convertedUrls: AffiliateLog['convertedUrls'];
    status: string;
    rewriteMode?: string;
    rewriteError?: string;
    channelPayloads?: {
      whatsApp?: {
        type: 'text' | 'media';
        text?: string;
        caption?: string;
        mimeType?: string;
        filename?: string;
        mediaPreviewUrl?: string;
      } | null;
      telegram?: {
        type: 'text' | 'media';
        text?: string;
        caption?: string;
        mimeType?: string;
        filename?: string;
        mediaPreviewUrl?: string;
      } | null;
    } | null;
  } | null>(null);

  async function submitAccount(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const formElement = event?.currentTarget || affiliateAccountFormRef.current;
    if (!formElement) return;
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
      setNotice(error instanceof Error ? error.message : 'Não foi possível salvar os dados de afiliado.');
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

  const affiliatePrimaryButtonClass = 'inline-flex justify-center items-center gap-2 rounded-xl bg-[#25D366] px-6 py-3.5 text-sm font-bold text-zinc-950 transition-all hover:bg-[#25D366]/90 hover:shadow-[0_0_15px_rgba(37,211,102,0.2)] disabled:opacity-50 disabled:hover:shadow-none';
  const affiliateSecondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-zinc-300 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50';

  const affiliateTermsAccepted = Boolean(affiliate.termsAccepted);
  const affiliateAccountLocked = Boolean(affiliate.account?.id) && !affiliateAccountEditing;
  const affiliateAccountFieldsDisabled = readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || affiliateAccountLocked || busy === 'affiliate-account';
  const amazonShortenerGloballyEnabled = Boolean(state.affiliate?.shortener?.amazonEnabled);
  
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

  const renderChannelPreview = (label: string, payload: NonNullable<NonNullable<typeof testResult>['channelPayloads']>['whatsApp']) => (
    <div className="grid gap-3">
      <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 px-2">{label}</span>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        {!payload ? (
          <p className="text-xs text-zinc-500">Sem payload disponivel para esta simulacao.</p>
        ) : payload.type === 'media' ? (
          <div className="grid gap-3">
            {payload.mediaPreviewUrl ? (
              <img
                src={payload.mediaPreviewUrl}
                alt={`Preview ${label}`}
                className="max-h-72 w-full rounded-xl border border-white/10 bg-black/20 object-contain"
              />
            ) : null}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Modo: media {payload.mimeType ? `| ${payload.mimeType}` : ''}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/20 p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
              {payload.caption || ''}
            </pre>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Modo: texto</p>
            <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/20 p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
              {payload.text || ''}
            </pre>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid gap-8">
      {/* HEADER SECTION */}
      <section className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 shadow-xl backdrop-blur-md max-sm:p-6">
        <div className="flex items-start justify-between gap-4 max-lg:flex-col">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#25D366]">
                <Settings size={20} />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Configuração de Conversão</p>
            </div>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white">Automação de Afiliados</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Transforme automaticamente links de produtos em links comissionados da Amazon e Shopee antes de enviar para seus grupos de WhatsApp.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-300">
            {affiliate.automations?.filter((a) => a.isActive).length || 0} fluxo(s) rodando
          </span>
        </div>

        {affiliate.error ? (
          <p className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-300">
            {affiliate.error}
          </p>
        ) : null}

        {!affiliateModuleAllowed ? (
          <p className="mt-6 rounded-xl border border-sky-500/20 bg-sky-500/10 px-5 py-4 text-sm text-sky-300">
            Seu plano {planLimits?.label || 'atual'} está em modo ponte simples. A automação de afiliados entra a partir do plano Plus.
          </p>
        ) : null}

        {!affiliate.termsAccepted && affiliateModuleAllowed ? (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
            <div className="flex items-start gap-4">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <div>
                <p className="text-base font-semibold text-amber-300">Aceite obrigatório para iniciar</p>
                <p className="mt-2 text-sm leading-relaxed text-amber-200/80">
                  Declaro que tenho autorização para reutilizar, adaptar e republicar as mensagens monitoradas por esta automação. Também sou responsável pelos links de afiliado configurados e pelo cumprimento das políticas dos programas.
                </p>
                <button type="button" disabled={readOnlyAccount || busy === 'affiliate-terms'} onClick={acceptTerms} className={`mt-5 ${affiliatePrimaryButtonClass}`}>
                  {busy === 'affiliate-terms' ? 'Liberando...' : 'Aceitar termo e continuar'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* TABS NAVIGATION */}
      <div className="flex items-center gap-8 border-b border-white/5 px-4 overflow-x-auto">
        <button 
          onClick={() => setActiveTab('config')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'config' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <Settings size={18} />
          Contas e Regras
        </button>
        <button 
          onClick={() => setActiveTab('simulator')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'simulator' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <MessageSquare size={18} />
          Simulador de Mensagens
        </button>
        <button 
          onClick={() => setActiveTab('history')} 
          className={cn('flex items-center gap-2 border-b-2 px-2 py-4 text-sm font-medium transition-colors whitespace-nowrap', activeTab === 'history' ? 'border-[#25D366] text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <History size={18} />
          Histórico Recente
        </button>
      </div>

      {/* TAB CONTENT: CONFIGURATIONS */}
      {activeTab === 'config' ? (
        <div className="grid gap-8 xl:grid-cols-[400px_1fr]">
          
          {/* CREDENCIAIS COLUMN */}
          <div className="grid gap-6">
            <h3 className="text-xl font-semibold tracking-tight text-white px-2">Suas Credenciais</h3>
            
            <form ref={affiliateAccountFormRef} onSubmit={(event) => event.preventDefault()} className="grid gap-6">
              
              {/* AMAZON CARD */}
              <div className="rounded-3xl border border-[#FF9900]/20 bg-[#FF9900]/5 p-6 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <ShoppingBag size={24} className="text-[#FF9900]" />
                  <h4 className="text-lg font-semibold text-white">Amazon Associates</h4>
                </div>
                
                <div className="mt-6 grid gap-4">
                  <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-300 cursor-pointer">
                    <input 
                      type="checkbox" name="amazonEnabled" defaultChecked={Boolean(affiliate.account?.amazonEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate}
                      className="h-4 w-4 rounded border-white/20 bg-black/20 text-[#FF9900] focus:ring-[#FF9900]" 
                    /> 
                    Ativar conversão Amazon
                  </label>
                  
                  <label className="grid gap-2 mt-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Tag de Associado</span>
                    <input name="amazonTag" disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate} defaultValue={affiliate.account?.amazonTag || ''} className={premiumInputClass} placeholder={planLimits?.amazonAffiliate ? 'Ex: seunome-20' : 'Disponível no Plus'} />
                  </label>
                  
                  <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-400 cursor-pointer mt-2">
                    <input
                      type="checkbox" name="amazonShortenerEnabled" defaultChecked={Boolean(affiliate.account?.amazonShortenerEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.amazonAffiliate}
                      className="h-4 w-4 rounded border-white/20 bg-black/20 text-[#FF9900] focus:ring-[#FF9900]"
                    />
                    Gerar link encurtado
                  </label>
                  
                  {!amazonShortenerGloballyEnabled ? (
                    <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] leading-relaxed text-amber-300">
                      Encurtador global desligado no servidor. O sistema usará o link extenso.
                    </p>
                  ) : null}
                </div>
              </div>

              {/* SHOPEE CARD */}
              <div className="rounded-3xl border border-[#EE4D2D]/20 bg-[#EE4D2D]/5 p-6 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <Store size={24} className="text-[#EE4D2D]" />
                  <h4 className="text-lg font-semibold text-white">Shopee Afiliados</h4>
                </div>

                <div className="mt-6 grid gap-4">
                  <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-300 cursor-pointer">
                    <input 
                      type="checkbox" name="shopeeEnabled" defaultChecked={Boolean(affiliate.account?.shopeeEnabled)} disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate}
                      className="h-4 w-4 rounded border-white/20 bg-black/20 text-[#EE4D2D] focus:ring-[#EE4D2D]" 
                    />
                    Ativar conversão Shopee
                  </label>

                  <label className="grid gap-2 mt-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Affiliate ID</span>
                    <input name="shopeeAffiliateId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAffiliateId || ''} className={premiumInputClass} placeholder={planLimits?.shopeeAffiliate ? 'Ex: 18393040998' : 'Disponível no Pro'} />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Prefixo de Rastreamento (SUBID)</span>
                    <input name="defaultSubId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.defaultSubId || ''} className={premiumInputClass} placeholder="Ex: grupo-vip" />
                  </label>

                  <div className="mt-4 border-t border-white/5 pt-4 grid gap-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Credenciais Avançadas (Opcional)</p>
                    <label className="grid gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">App ID</span>
                      <input name="shopeeAppId" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} defaultValue={affiliate.account?.shopeeAppId || ''} className={premiumInputClass} />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">App Secret</span>
                      <input name="shopeeSecret" disabled={affiliateAccountFieldsDisabled || !planLimits?.shopeeAffiliate} className={premiumInputClass} placeholder={affiliate.account?.shopeeSecretConfigured ? 'Já configurado (deixe em branco para manter)' : 'API Secret'} />
                    </label>
                  </div>
                </div>
              </div>

              {/* SAVE CREDENTIALS BUTTON */}
              {affiliateAccountLocked ? (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setAffiliateAccountEditing(true); }}
                  disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                  className={affiliateSecondaryButtonClass}
                >
                  Editar Credenciais
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); void submitAccount(); }}
                  disabled={readOnlyAccount || busy === 'affiliate-account' || !affiliateModuleAllowed || !affiliateTermsAccepted}
                  className={affiliatePrimaryButtonClass}
                >
                  {busy === 'affiliate-account' ? 'Salvando...' : 'Salvar Credenciais'}
                </button>
              )}
            </form>
          </div>

          {/* REGRAS COLUMN */}
          <div className="grid gap-6">
            <div className="flex items-center justify-between px-2">
               <h3 className="text-xl font-semibold tracking-tight text-white">Regras de Tratamento</h3>
               {!activeAutomation ? (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                    Falta Configurar Fluxo
                  </span>
                ) : affiliateRulesEditing ? (
                  <span className="rounded-full border border-[#25D366]/20 bg-[#25D366]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#25D366]">
                    Edição Aberta
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Bloqueado para Edição
                  </span>
                )}
            </div>
            
            <form onSubmit={(event) => event.preventDefault()} className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm shadow-lg">
              <div className="grid gap-6">
                
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-zinc-200">Comportamento de Links Desconhecidos</span>
                  <span className="text-xs leading-relaxed text-zinc-500 mb-1">O que fazer com links do AliExpress, Magalu, etc.</span>
                  <select
                    name="unknownLinkBehavior"
                    defaultValue={activeAutomation?.unknownLinkBehavior || 'keep'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className={premiumInputClass}
                  >
                    <option value="keep">Manter o link original (Recomendado)</option>
                    <option value="remove">Apagar o link do texto</option>
                    <option value="ignore_message">Descartar a mensagem inteira</option>
                  </select>
                </label>

                <label className="grid gap-2 mt-2">
                  <span className="text-sm font-semibold text-zinc-200">Origem da Imagem</span>
                  <span className="text-xs leading-relaxed text-zinc-500 mb-1">Escolha entre imagem original, imagem do produto ou layout proprio do sistema.</span>
                  <select
                    name="mediaSourceMode"
                    defaultValue={activeAutomation?.mediaSourceMode || 'telegram_media'}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className={premiumInputClass}
                  >
                    <option value="telegram_media">Usar imagem original do Telegram</option>
                    <option value="product_image">Buscar imagem direto da Amazon/Shopee</option>
                    <option value="system_layout">Usar layout proprio do sistema</option>
                  </select>
                </label>

                <div className="mt-4 grid gap-2">
                  <span className="text-sm font-semibold text-zinc-200">Rodapé Automático</span>
                  <span className="text-xs leading-relaxed text-zinc-500 mb-1">Este texto será adicionado ao final de todas as ofertas.</span>
                  <textarea
                    name="customFooter"
                    defaultValue={activeAutomation?.customFooter || ''}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    placeholder={`Visite nosso Instagram:\n@promos_top`}
                    className={cn(premiumInputClass, "min-h-40 resize-y font-mono text-[13px]")}
                  />
                </div>

                <label className="inline-flex items-center gap-3 text-sm font-medium text-zinc-300 cursor-pointer mt-2 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                  <input
                    type="checkbox"
                    name="removeOriginalFooter"
                    defaultChecked={Boolean(activeAutomation?.removeOriginalFooter)}
                    disabled={readOnlyAccount || !affiliateModuleAllowed || !affiliateTermsAccepted || !activeAutomation || !affiliateRulesEditing || busy === 'affiliate-rules'}
                    className="h-4 w-4 rounded border-white/20 bg-black/20 text-[#25D366] focus:ring-[#25D366]"
                  />
                  Remover o rodapé original da mensagem recebida
                </label>

                <div className="mt-4 pt-6 border-t border-white/5 flex items-center justify-end">
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
                    className={affiliateRulesEditing ? affiliatePrimaryButtonClass : affiliateSecondaryButtonClass}
                  >
                    {busy === 'affiliate-rules' ? 'Salvando...' : affiliateRulesEditing ? 'Salvar Regras de Tratamento' : 'Editar Regras'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* TAB CONTENT: SIMULATOR */}
      {activeTab === 'simulator' ? (
        <div className="max-w-5xl mx-auto w-full grid gap-8">
           <div className="text-center px-4">
              <h3 className="text-2xl font-bold tracking-tight text-white">Simulador de Conversão</h3>
              <p className="mt-2 text-sm text-zinc-400">Cole uma mensagem de oferta abaixo para testar as suas configurações na prática, sem enviar nada pro WhatsApp.</p>
           </div>

           <div className="rounded-3xl border border-white/5 bg-zinc-900/40 p-8 backdrop-blur-sm shadow-xl">
              <label className="grid gap-3">
                <span className="text-sm font-semibold text-zinc-200">Cole a mensagem que veio do Telegram:</span>
                <textarea
                  value={testMessage}
                  disabled={readOnlyAccount}
                  onChange={(event) => setTestMessage(event.target.value)}
                  className={cn(premiumInputClass, "min-h-32 resize-y font-mono text-[13px]")}
                />
              </label>

              <div className="mt-6 flex justify-end">
                <button type="button" disabled={readOnlyAccount || busy === 'affiliate-test' || !affiliateModuleAllowed || !affiliateTermsAccepted} onClick={runManualTest} className={affiliatePrimaryButtonClass}>
                  {busy === 'affiliate-test' ? 'Processando...' : 'Rodar Simulação'}
                </button>
              </div>

              {testResult ? (
                <div className="mt-8 border-t border-white/5 pt-8 grid gap-8">
                  <div className="flex items-center justify-between gap-4 max-sm:flex-col">
                    <h4 className="text-xl font-semibold text-white">Resultado da Simulação</h4>
                    <span className={cn('rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wider', testStatusClass(testResult.status))}>
                      {testStatusLabel(testResult.status)}
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-5 text-center">
                      <p className="text-4xl font-black tracking-tighter text-[#25D366]">{testConvertedCount}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#25D366]/70">Convertidos</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-center">
                      <p className="text-4xl font-black tracking-tighter text-zinc-300">{testIgnoredCount}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Mantidos</p>
                    </div>
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-center">
                      <p className="text-4xl font-black tracking-tighter text-red-400">{testErrorCount}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-red-400/70">Erros</p>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="grid gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 px-2">Como vai chegar no WhatsApp</span>
                      <pre className="h-full overflow-auto whitespace-pre-wrap rounded-2xl border border-[#25D366]/20 bg-[#25D366]/5 p-6 font-mono text-[13px] leading-relaxed text-zinc-200">
                        {testResult.processedMessage}
                      </pre>
                    </div>
                    <div className="grid gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 px-2">Links Analisados</span>
                      <div className="grid gap-3">
                         {testLinks.length ? testLinks.map((url, index) => (
                          <div key={`${url.originalUrl}-${index}`} className={cn('rounded-2xl border p-4 text-xs', testStatusClass(url.status))}>
                             <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="font-bold uppercase tracking-wider">{url.marketplace}</span>
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">{url.status}</span>
                             </div>
                             <div className="grid gap-1 mt-3">
                                <p className="opacity-70 truncate" title={url.originalUrl}>De: {url.originalUrl}</p>
                                <p className="font-medium truncate" title={url.affiliateUrl || url.expandedUrl || '-'}>Para: {url.affiliateUrl || url.expandedUrl || '-'}</p>
                             </div>
                          </div>
                         )) : (
                          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-center text-sm text-zinc-500">
                            Nenhum link encontrado
                          </div>
                         )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    {renderChannelPreview('Simulacao real de saida - WhatsApp', testResult.channelPayloads?.whatsApp || null)}
                    {renderChannelPreview('Simulacao real de saida - Telegram', testResult.channelPayloads?.telegram || null)}
                  </div>
                </div>
              ) : null}
           </div>
        </div>
      ) : null}

      {/* TAB CONTENT: HISTORY */}
      {activeTab === 'history' ? (
        <div className="max-w-4xl mx-auto w-full grid gap-6">
          <div className="flex items-center justify-between px-2">
             <h3 className="text-xl font-semibold tracking-tight text-white">Histórico de Processamento</h3>
             <span className="text-sm text-zinc-500">{affiliate.logs?.length || 0} registros recentes</span>
          </div>
          
          <div className="grid gap-4">
            {affiliate.logs?.length ? affiliate.logs.map((log) => (
              <div key={log.id} className="rounded-3xl border border-white/5 bg-zinc-900/40 p-6 backdrop-blur-sm transition-all hover:bg-white/[0.04] hover:border-white/10">
                <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-4 mb-4">
                  <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest", 
                    log.status === 'converted' ? 'bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20' : 
                    log.status === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                    'bg-white/5 text-zinc-400 border border-white/10'
                  )}>
                    {log.status}
                  </span>
                  <span className="text-xs font-medium text-zinc-500 flex items-center gap-1">
                     <History size={12} />
                     {formatDate(log.createdAt)}
                  </span>
                </div>
                <p className="line-clamp-3 text-sm leading-relaxed text-zinc-300 font-mono">
                  {log.processedMessage || log.originalMessage}
                </p>
                {log.errorMessage ? (
                  <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                    <p className="text-xs font-medium text-red-400">{log.errorMessage}</p>
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
                <History className="mx-auto text-zinc-600 mb-4" size={32} />
                <p className="text-sm font-medium text-zinc-400">Nenhuma mensagem processada ainda.</p>
                <p className="text-xs mt-2 text-zinc-600">Os registros aparecerão aqui quando o fluxo rodar.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

    </div>
  );
}

