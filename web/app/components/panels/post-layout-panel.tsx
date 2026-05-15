'use client';

import { Image as ImageIcon, Palette, Save, Sparkles } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Field } from '../common-ui';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import type { AppState, PostLayoutConfig } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[var(--accent)] to-[var(--accent-strong)] px-6 py-3.5 text-sm font-bold text-black shadow-[0_0_20px_rgba(37,211,102,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(37,211,102,0.5)] active:scale-95 disabled:pointer-events-none disabled:opacity-50';

const secondaryInput =
  'h-[58px] w-full rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 text-base text-[#F8FAFC] outline-none transition placeholder:text-[#6D7C75] hover:border-[rgba(255,255,255,0.14)] focus:border-[var(--accent)] focus:bg-[rgba(255,255,255,0.05)] focus:ring-2 focus:ring-[rgba(37,211,102,0.14)]';

const defaults: PostLayoutConfig = {
  enabled: false,
  brandName: '',
  headline: 'Ofertas selecionadas',
  footerText: 'Seleção premium de ofertas',
  primaryColor: '#0f172a',
  accentColor: '#25D366',
  backgroundColor: '#ffffff',
  textColor: '#111827',
  maxProducts: 4
};
const footerTextLimit = 44;

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

export function PostLayoutPanel({
  state,
  refresh,
  setNotice
}: {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const current = { ...defaults, ...(state.config.postLayout || {}) };
  const [enabled, setEnabled] = useState(Boolean(current.enabled));
  const [brandName, setBrandName] = useState(current.brandName || '');
  const [headline, setHeadline] = useState(current.headline || defaults.headline);
  const [footerText, setFooterText] = useState(current.footerText || defaults.footerText);
  const [primaryColor, setPrimaryColor] = useState(current.primaryColor || defaults.primaryColor);
  const [accentColor, setAccentColor] = useState(current.accentColor || defaults.accentColor);
  const [textColor, setTextColor] = useState(current.textColor || defaults.textColor);
  const [maxProducts, setMaxProducts] = useState(String(current.maxProducts || defaults.maxProducts));
  const [busy, setBusy] = useState(false);
  const previewCount = Math.max(1, Math.min(4, Number(maxProducts) || defaults.maxProducts));
  const previewSlots = buildPreviewSlots(previewCount);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);

    try {
      await postJsonWithOptions(
        '/api/post-layout',
        {
          enabled,
          brandName,
          headline,
          footerText,
          primaryColor,
          accentColor,
          textColor,
          maxProducts: Number(maxProducts)
        },
        { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM }
      );
      await refresh();
      setNotice('Layout de postagem atualizado.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel salvar o layout de postagem.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
      <section className="relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.05)] bg-[#101014] p-6 shadow-2xl sm:p-8">
        <div className="pointer-events-none absolute left-0 top-0 h-[300px] w-full bg-gradient-to-b from-[var(--accent)]/5 to-transparent" />
        
        <div className="relative z-10 mb-8 flex items-start gap-4">
          <div className="relative mt-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--accent)]/20 bg-black/40 text-[var(--accent)] shadow-[0_0_15px_rgba(37,211,102,0.1)]">
            <div className="absolute inset-0 rounded-2xl bg-[var(--accent)]/10 blur-xl" />
            <ImageIcon size={28} className="relative z-10" />
          </div>
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              <Sparkles size={14} />
              Layout de Postagem
            </p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-white">Arte limpa para ofertas</h2>
            <p className="mt-2 max-w-2xl text-base leading-relaxed text-[#8D9C96]">
              Gere uma imagem super premium a partir das ofertas convertidas, sem reaproveitar marca, QR code ou redes sociais da origem.
            </p>
          </div>
        </div>

        <form className="relative z-10 grid gap-6" onSubmit={save}>
          <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-[20px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] p-5 transition-all hover:border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.04)]">
            <span>
              <span className="block text-base font-semibold text-white">Ativar arte limpa</span>
              <span className="mt-1 block text-sm leading-relaxed text-[#8D9C96]">
                Quando a regra buscar imagem na Amazon/Shopee/Mercado Livre, o sistema tenta gerar a arte antes dos fallbacks atuais.
              </span>
            </span>
            <div className={`relative flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-300 ease-in-out ${enabled ? 'bg-[var(--accent)]' : 'border border-[rgba(255,255,255,0.1)] bg-zinc-800'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-300 ease-in-out ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          </label>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Nome exibido" value={brandName} onChange={setBrandName} placeholder="Ex.: Achadinhos VIP" disabled={readOnlyAccount} />
            <Field label="Chamada" value={headline} onChange={setHeadline} placeholder="Ofertas selecionadas" disabled={readOnlyAccount} />
          </div>

          <label className="grid gap-2 text-sm font-semibold text-[#F8FAFC]">
            Mensagem do rodapé
            <input
              value={footerText}
              disabled={readOnlyAccount}
              maxLength={footerTextLimit}
              onChange={(event) => setFooterText(event.target.value)}
              className={secondaryInput}
              placeholder="Seleção premium de ofertas"
            />
            <span className="text-xs font-normal text-[#8D9C96]">
              {footerText.length}/{footerTextLimit} caracteres
            </span>
          </label>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            <ColorField label="Cor principal" value={primaryColor} onChange={setPrimaryColor} disabled={readOnlyAccount} />
            <ColorField label="Cor de destaque" value={accentColor} onChange={setAccentColor} disabled={readOnlyAccount} />
            <ColorField label="Texto" value={textColor} onChange={setTextColor} disabled={readOnlyAccount} />
          </div>

          <label className="grid gap-2 text-sm font-semibold text-[#F8FAFC]">
            Limite máximo automático
            <div className="relative">
              <select
                value={maxProducts}
                disabled={readOnlyAccount}
                onChange={(event) => setMaxProducts(event.target.value)}
                className={`${secondaryInput} appearance-none pr-10`}
              >
                <option value="1">Até 1 produto</option>
                <option value="2">Até 2 produtos</option>
                <option value="3">Até 3 produtos</option>
                <option value="4">Até 4 produtos</option>
              </select>
              <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400">
                <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <span className="mt-1 text-sm font-normal leading-relaxed text-[#8D9C96]">
              O sistema escolhe automaticamente quantos cards usar pela quantidade de links convertidos da mensagem.
            </span>
          </label>

          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={readOnlyAccount || busy} className={primaryButton}>
              <Save size={18} />
              {busy ? 'Salvando...' : 'Salvar layout'}
            </button>
          </div>
        </form>
      </section>

      <aside className="relative flex flex-col gap-5 rounded-[24px] border border-[rgba(255,255,255,0.05)] bg-[#101014] p-6 shadow-2xl sm:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-sm font-bold tracking-wide text-white">
            <Palette size={18} className="text-[var(--accent)]" />
            PREVIEW AO VIVO
          </div>
        </div>
        
        <div className="flex flex-1 items-center justify-center rounded-[20px] bg-black/40 p-4 sm:p-6 border border-white/[0.02]">
          <div className="relative w-full max-w-[360px] overflow-hidden rounded-[20px] border border-white/10 bg-[#060d24] shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(37,211,102,0.15),transparent_56%),radial-gradient(circle_at_88%_80%,rgba(34,158,217,0.14),transparent_44%)]" />
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:24px_24px]" />
            <div className="relative z-10">
              <div className="relative overflow-hidden px-5 py-5" style={{ backgroundColor: primaryColor }}>
                <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-white/10 to-transparent" />
                <p className="relative text-[22px] font-black tracking-tight" style={{ color: textColor }}>{brandName || 'Oferta do dia'}</p>
                <p className="relative mt-1 text-sm font-bold" style={{ color: `${textColor}CC` }}>{headline || defaults.headline}</p>
              </div>
              <div className="h-[3px] w-full" style={{ backgroundColor: accentColor }} />

              <div className="relative h-[360px] bg-[#ffffffeb]">
                {previewSlots.map((slot, index) => (
                  <div
                    key={index}
                    className="absolute rounded-2xl border border-[#0b173433] bg-[#0b17331a] px-3 py-2"
                    style={{
                      left: `${slot.x}%`,
                      top: `${slot.y}%`,
                      width: `${slot.w}%`,
                      height: `${slot.h}%`
                    }}
                  >
                    <p className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: accentColor }}>PRODUTO</p>
                    <p className="mt-1 text-[10px] font-black leading-tight" style={{ color: textColor }}>Item {index + 1}</p>
                    <div className="mt-2 h-[calc(100%-40px)] rounded-xl border border-[#0b173433] bg-[#ffffffcc]" />
                  </div>
                ))}
              </div>

              <div className="relative h-[86px] bg-gradient-to-r from-[#07112e] to-[#0a1a42]">
                <p className="absolute left-4 top-1 text-[12px] font-semibold text-white/75">
                  {(footerText || defaults.footerText).slice(0, 34)}
                  {(footerText || defaults.footerText).length > 34 ? '...' : ''}
                </p>
                <p className="absolute left-4 top-4 text-[11px] font-bold text-white/70">a partir de</p>
                <p className="absolute left-4 top-8 text-[30px] font-black leading-none text-[#f7e7a5]">R$ 111,50</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function buildPreviewSlots(count: number) {
  if (count <= 1) {
    return [{ x: 15, y: 7, w: 70, h: 80 }];
  }
  if (count === 2) {
    return [
      { x: 4, y: 10, w: 43, h: 76 },
      { x: 53, y: 10, w: 43, h: 76 }
    ];
  }
  if (count === 3) {
    return [
      { x: 29, y: 4, w: 42, h: 42 },
      { x: 5, y: 51, w: 42, h: 42 },
      { x: 53, y: 51, w: 42, h: 42 }
    ];
  }
  return [
    { x: 5, y: 6, w: 42, h: 42 },
    { x: 53, y: 6, w: 42, h: 42 },
    { x: 5, y: 53, w: 42, h: 42 },
    { x: 53, y: 53, w: 42, h: 42 }
  ];
}

function ColorField({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-[#F8FAFC]">
      {label}
      <span className="flex h-[58px] items-center overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 transition-all hover:border-[rgba(255,255,255,0.14)] focus-within:border-[var(--accent)] focus-within:bg-[rgba(255,255,255,0.05)] focus-within:ring-2 focus-within:ring-[rgba(37,211,102,0.14)]">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-black/40 shadow-sm transition-transform hover:scale-110">
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="absolute -inset-2 h-16 w-16 cursor-pointer border-0 bg-transparent p-0"
          />
        </div>
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-4 text-base font-medium text-zinc-100 outline-none placeholder:text-[#6D7C75]"
        />
      </span>
    </label>
  );
}
