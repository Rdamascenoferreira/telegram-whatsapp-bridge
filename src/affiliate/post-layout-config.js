export const defaultPostLayoutConfig = {
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

export function normalizePostLayoutConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    enabled: Boolean(source.enabled),
    brandName: cleanText(source.brandName, 48),
    headline: cleanText(source.headline, 64) || defaultPostLayoutConfig.headline,
    footerText: cleanText(source.footerText, 44) || defaultPostLayoutConfig.footerText,
    primaryColor: normalizeHexColor(source.primaryColor, defaultPostLayoutConfig.primaryColor),
    accentColor: normalizeHexColor(source.accentColor, defaultPostLayoutConfig.accentColor),
    // Background is intentionally fixed to white for a clean and consistent layout.
    backgroundColor: defaultPostLayoutConfig.backgroundColor,
    textColor: normalizeHexColor(source.textColor, defaultPostLayoutConfig.textColor),
    maxProducts: clampInteger(source.maxProducts, 1, 4, defaultPostLayoutConfig.maxProducts)
  };
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeHexColor(value, fallback) {
  const normalized = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(number)));
}
