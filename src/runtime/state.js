import { normalizePostLayoutConfig } from '../affiliate/post-layout-config.js';

export function buildRuntimeState(runtime) {
  const selected = new Set(runtime.config.selectedGroupIds);
  const dashboardViewClearedAt = String(runtime.config.dashboardViewClearedAt || '');
  const visibleEvents = filterDashboardItemsByTimestamp(runtime.activity.events, dashboardViewClearedAt, 'at');
  const visibleOffers = filterDashboardItemsByTimestamp(runtime.activity.offers, dashboardViewClearedAt, 'lastUpdatedAt');

  return {
    whatsAppStatus: runtime.whatsAppStatus,
    whatsAppPhone: runtime.whatsAppPhone,
    qrDataUrl: runtime.qrDataUrl,
    telegramStatus: runtime.telegramStatus,
    config: {
      telegramMode: 'user',
      telegramChannel: runtime.config.telegramChannel,
      telegramApiId: runtime.config.telegramApiId,
      telegramApiHash: runtime.config.telegramApiHash,
      telegramPhone: runtime.config.telegramPhone,
      hasTelegramBotToken: false,
      hasTelegramSession: Boolean(runtime.config.telegramSession),
      bridgeEnabled: runtime.config.bridgeEnabled,
      disconnectWhatsAppOnLogout: Boolean(runtime.config.disconnectWhatsAppOnLogout),
      dashboardViewClearedAt,
      selectedGroupIds: runtime.config.selectedGroupIds,
      postLayout: normalizePostLayoutConfig(runtime.config.postLayout)
    },
    metrics: {
      ...runtime.activity.metrics,
      selectedGroupCount: runtime.resolveWhatsAppTargetGroupIds().length,
      availableAdminGroupCount: countAdminGroups(runtime.availableGroups),
      availableGroupCount: runtime.availableGroups.length,
      whatsAppStatus: runtime.whatsAppStatus,
      telegramStatus: runtime.telegramStatus,
      groupsRefreshing: runtime.isRefreshingGroups,
      groupRefreshProgress: runtime.groupRefreshProgress,
      groupCacheRefreshedAt: runtime.groupCacheRefreshedAt,
      hasCachedGroups: runtime.availableGroups.length > 0,
      pendingTelegramCount: runtime.pendingTelegramMessages.length,
      whatsAppDeliveryQueue: runtime.whatsAppDeliveryQueue.getSnapshot(),
      deliveryStats: runtime.deliveryStats,
      canResetWhatsAppSession: Boolean(runtime.whatsAppIssue?.canResetSession),
      canReconnectWhatsApp: runtime.whatsAppStatus !== 'connecting' && !runtime.whatsAppReconnectInProgress
    },
    telegram: {
      authPhase: runtime.telegramAuthFlow?.phase || 'idle',
      phoneNumber: runtime.telegramAuthFlow?.phoneNumber || runtime.config.telegramPhone || '',
      passwordRequired: Boolean(runtime.telegramAuthFlow?.passwordRequired),
      codeSentViaApp: Boolean(runtime.telegramAuthFlow?.isCodeViaApp),
      user: runtime.telegramUserProfile,
      availableChats: runtime.telegramAvailableChats
    },
    issue: runtime.whatsAppIssue,
    activity: visibleEvents.slice(0, 24),
    offers: visibleOffers.slice(0, 80),
    diagnostics: runtime.groupDiagnostics,
    groups: runtime.availableGroups.map((group) => ({
      ...group,
      selected: selected.has(group.id)
    })),
    logs: runtime.logs
  };
}

export function buildSupervisorSnapshot(runtime) {
  return {
    userId: runtime.userId,
    telegramStatus: runtime.telegramStatus,
    whatsAppStatus: runtime.whatsAppStatus,
    whatsAppPhone: runtime.whatsAppPhone,
    bridgeEnabled: Boolean(runtime.config?.bridgeEnabled),
    selectedGroupCount: runtime.resolveWhatsAppTargetGroupIds().length,
    pendingTelegramCount: runtime.pendingTelegramMessages.length,
    deliveryQueue: runtime.whatsAppDeliveryQueue.getSnapshot(),
    deliveryStats: runtime.deliveryStats,
    lastActivityAt: runtime.activity?.metrics?.lastActivityAt || null,
    lastForwardedAt: runtime.activity?.metrics?.lastForwardedAt || null,
    totalErrors: runtime.activity?.metrics?.totalErrors || 0
  };
}

export function buildLogLines(events) {
  return events.map((event) => `[${formatEventDate(event.at)}] ${event.message}`);
}

function formatEventDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('pt-BR');
}

export function countAdminGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return 0;
  }

  return groups.reduce((total, group) => total + (group?.hasAdminAccess ? 1 : 0), 0);
}

export function filterDashboardItemsByTimestamp(items, clearedAt, dateField) {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }

  const baseline = Date.parse(String(clearedAt || ''));

  if (!Number.isFinite(baseline)) {
    return items;
  }

  return items.filter((item) => {
    const rawValue = item?.[dateField] || item?.at || '';
    const value = Date.parse(String(rawValue));

    if (!Number.isFinite(value)) {
      return true;
    }

    return value >= baseline;
  });
}
