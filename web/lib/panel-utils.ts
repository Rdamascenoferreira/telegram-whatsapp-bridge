export function formatNumber(value: number) {
  return Number(value || 0).toLocaleString('pt-BR');
}

export function formatDate(value?: string) {
  if (!value) {
    return 'Sem registro';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sem registro';
  }

  return date.toLocaleString('pt-BR');
}

export function lastLabel(value?: string) {
  return value ? `Ultimo: ${formatDate(value)}` : 'Sem registro';
}

export function humanize(value: string) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function formatOfferStatus(value: string) {
  switch (String(value || '').toLowerCase()) {
    case 'sent':
      return 'Entregue';
    case 'queued':
      return 'Na fila';
    case 'failed':
      return 'Falhou';
    case 'ignored':
      return 'Ignorada';
    case 'captured':
      return 'Captada';
    default:
      return humanize(value || 'captured');
  }
}

export function isWhatsAppConnectedStatus(value: string) {
  return ['ready'].includes(String(value ?? '').trim().toLowerCase());
}

export function normalizeRouteSourceId(value?: string | null) {
  return String(value ?? '').trim();
}
