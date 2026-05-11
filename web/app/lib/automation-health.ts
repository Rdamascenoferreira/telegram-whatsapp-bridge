import type { AppState } from '../types/panel';
import { isWhatsAppConnectedStatus, normalizeRouteSourceId } from '../../lib/panel-utils';

function getActiveAffiliateAutomation(state: AppState) {
  return (state.affiliate?.automations || []).find((automation) => automation.isActive) || null;
}

function getOperationalTelegramSource(state: AppState) {
  if (state.telegramStatus !== 'listening') {
    return '';
  }

  const activeAffiliateAutomation = getActiveAffiliateAutomation(state);

  return normalizeRouteSourceId(activeAffiliateAutomation?.telegramSourceGroupId || state.config.telegramChannel);
}

export function hasOperationalTelegramSource(state: AppState) {
  return Boolean(getOperationalTelegramSource(state));
}

export function hasOperationalWhatsAppDestination(state: AppState) {
  return (state.config.selectedGroupIds?.length || 0) > 0;
}

export function canEnableAutomationState(state: AppState) {
  return (
    state.telegramStatus === 'listening' &&
    isWhatsAppConnectedStatus(state.whatsAppStatus) &&
    hasOperationalTelegramSource(state) &&
    hasOperationalWhatsAppDestination(state)
  );
}
