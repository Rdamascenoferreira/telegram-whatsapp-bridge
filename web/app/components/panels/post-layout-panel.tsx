'use client';

import { Image as ImageIcon, Palette, Save } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Field } from '../common-ui';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import type { AppState, PostLayoutConfig } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryInput =
  'h-12 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 text-sm text-zinc-100 outline-none transition hover:border-white/20 focus:border-[var(--accent)]';

const defaults: PostLayoutConfig = {
  enabled: false,
  brandName: '',
  headline: 'Ofertas selecionadas',
  primaryColor: '#0f172a',
  accentColor: '#25D366',
  backgroundColor: '#f8fafc',
  textColor: '#111827',
  maxProducts: 2
};

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
  const [primaryColor, setPrimaryColor] = useState(current.primaryColor || defaults.primaryColor);
  const [accentColor, setAccentColor] = useState(current.accentColor || defaults.accentColor);
  const [backgroundColor, setBackgroundColor] = useState(current.backgroundColor || defaults.backgroundColor);
  const [textColor, setTextColor] = useState(current.textColor || defaults.textColor);
  const [maxProducts, setMaxProducts] = useState(String(current.maxProducts || defaults.maxProducts));
  const [busy, setBusy] = useState(false);

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
          primaryColor,
          accentColor,
          backgroundColor,
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
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-5 flex items-start gap-3">
          <span className="mt-1 rounded-md border border-[var(--border)] bg-black/20 p-2 text-[var(--accent)]">
            <ImageIcon size={20} />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Layout de Postagem</p>
            <h2 className="mt-1 text-2xl font-semibold">Arte limpa para ofertas</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Gere uma imagem propria a partir das ofertas convertidas, sem reaproveitar marca, QR code ou redes sociais da origem.
            </p>
          </div>
        </div>

        <form className="grid gap-5" onSubmit={save}>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-black/10 px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-white">Ativar arte limpa</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                Quando a regra buscar imagem na Amazon/Shopee, o sistema tenta gerar a arte antes dos fallbacks atuais.
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={readOnlyAccount}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome exibido" value={brandName} onChange={setBrandName} placeholder="Ex.: Achadinhos VIP" disabled={readOnlyAccount} />
            <Field label="Chamada" value={headline} onChange={setHeadline} placeholder="Ofertas selecionadas" disabled={readOnlyAccount} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ColorField label="Cor principal" value={primaryColor} onChange={setPrimaryColor} disabled={readOnlyAccount} />
            <ColorField label="Cor de destaque" value={accentColor} onChange={setAccentColor} disabled={readOnlyAccount} />
            <ColorField label="Fundo" value={backgroundColor} onChange={setBackgroundColor} disabled={readOnlyAccount} />
            <ColorField label="Texto" value={textColor} onChange={setTextColor} disabled={readOnlyAccount} />
          </div>

          <label className="grid gap-2 text-sm font-semibold text-white">
            Produtos na arte
            <select
              value={maxProducts}
              disabled={readOnlyAccount}
              onChange={(event) => setMaxProducts(event.target.value)}
              className={secondaryInput}
            >
              <option value="1">1 produto</option>
              <option value="2">2 produtos</option>
              <option value="3">3 produtos</option>
              <option value="4">4 produtos</option>
            </select>
          </label>

          <div className="flex justify-end">
            <button type="submit" disabled={readOnlyAccount || busy} className={primaryButton}>
              <Save size={16} />
              {busy ? 'Salvando...' : 'Salvar layout'}
            </button>
          </div>
        </form>
      </section>

      <aside className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <Palette size={18} className="text-[var(--accent)]" />
          Preview
        </div>
        <div className="overflow-hidden rounded-lg border border-black/10" style={{ backgroundColor }}>
          <div className="px-5 py-5" style={{ backgroundColor: primaryColor }}>
            <p className="text-xl font-black text-white">{brandName || 'Oferta do dia'}</p>
            <p className="mt-1 text-sm font-bold text-white/70">{headline || defaults.headline}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {[0, 1].slice(0, Math.min(2, Number(maxProducts) || 2)).map((item) => (
              <div key={item} className="rounded-md bg-white p-3">
                <div className="mb-3 h-24 rounded-md bg-zinc-100" />
                <p className="text-xs font-black" style={{ color: textColor }}>Produto em oferta</p>
                <div className="mt-3 rounded-md px-3 py-2" style={{ backgroundColor: primaryColor }}>
                  <p className="text-[10px] font-bold text-white/70">a partir de</p>
                  <p className="text-lg font-black text-white">R$ 111,50</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
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
    <label className="grid gap-2 text-sm font-semibold text-white">
      {label}
      <span className="flex overflow-hidden rounded-md border border-[var(--border)] bg-black/20">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-14 border-0 bg-transparent p-1"
        />
        <input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-zinc-100 outline-none"
        />
      </span>
    </label>
  );
}
