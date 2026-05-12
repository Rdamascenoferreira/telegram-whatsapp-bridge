export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  avatarStorage?: 'none' | 'google' | 'upload';
  providers?: string[];
  isAdmin?: boolean;
  plan?: string;
  accountStatus?: string;
  billingStatus?: string;
};

export type ActivityEvent = {
  id: string;
  at: string;
  level: 'info' | 'error';
  type?: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type ActivityOffer = {
  id: string;
  at: string;
  lastUpdatedAt?: string;
  status: 'captured' | 'queued' | 'sent' | 'failed' | 'ignored' | string;
  sourceLabel: string;
  preview: string;
  messageCount: number;
  groupCount: number;
  deliveryCount: number;
  fromQueue?: boolean;
  reason?: string;
  metadata?: {
    channels?: {
      telegram?: {
        status?: string;
        detail?: string;
        destination?: string;
      };
      whatsapp?: {
        status?: string;
        delivered?: number;
        failed?: number;
        skipped?: number;
        targetGroups?: number;
      };
    };
  };
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  selected?: boolean;
  kind?: 'group' | 'announcement' | 'community_group';
  isAnnouncement?: boolean;
  isCommunityLinked?: boolean;
  parentGroupId?: string | null;
};

export type TelegramChat = {
  id: string;
  name: string;
  type: 'group' | 'channel';
  isAdmin?: boolean;
  role?: string;
};

export type AffiliateAccount = {
  id?: string;
  amazonTag?: string;
  amazonShortenerEnabled?: boolean;
  shopeeAffiliateId?: string;
  shopeeAppId?: string;
  shopeeSecretConfigured?: boolean;
  defaultSubId?: string;
  amazonEnabled?: boolean;
  shopeeEnabled?: boolean;
};

export type AffiliateAutomation = {
  id: string;
  name: string;
  telegramSourceGroupId: string;
  telegramSourceGroupName?: string;
  unknownLinkBehavior?: 'keep' | 'remove' | 'ignore_message';
  customFooter?: string;
  removeOriginalFooter?: boolean;
  messageBeautifierEnabled?: boolean;
  messageBeautifierStyle?: 'clean' | 'sales' | 'urgent' | 'plain';
  aiRewriteEnabled?: boolean;
  aiRewriteStyle?: 'clean' | 'sales' | 'urgent' | 'plain';
  mediaSourceMode?: 'telegram_media' | 'product_image';
  preserveOriginalTextEnabled?: boolean;
  telegramForwardEnabled?: boolean;
  telegramDestinationGroupId?: string;
  telegramDestinationGroupName?: string;
  isActive: boolean;
  destinations: Array<{
    whatsappGroupId: string;
    whatsappGroupName?: string;
  }>;
};

export type AffiliateLog = {
  id: string;
  automationId?: string;
  originalMessage: string;
  processedMessage?: string;
  convertedUrls?: Array<{
    originalUrl: string;
    expandedUrl: string;
    marketplace: 'amazon' | 'shopee' | 'unknown';
    affiliateUrl: string;
    affiliateId?: string;
    subIds?: Record<string, string>;
    utmContent?: string;
    status: 'converted' | 'ignored' | 'error';
    error?: string;
  }>;
  status: string;
  errorMessage?: string;
  createdAt: string;
};

export type PlanLimits = {
  plan: string;
  label: string;
  telegramSources: number;
  whatsappDestinations: number;
  affiliateAutomations: number;
  amazonAffiliate: boolean;
  shopeeAffiliate: boolean;
  dailyMessages: number;
  historyDays: number;
};

export type SupervisorSession = {
  userId: string;
  telegramStatus: string;
  whatsAppStatus: string;
  whatsAppPhone?: string | null;
  bridgeEnabled?: boolean;
  selectedGroupCount?: number;
  pendingTelegramCount?: number;
  lastActivityAt?: string | null;
  lastForwardedAt?: string | null;
  totalErrors?: number;
  deliveryStats?: {
    skippedDuplicates?: number;
    transientFailures?: number;
    fatalFailures?: number;
  };
  deliveryQueue?: {
    active?: boolean;
    activeJob?: {
      name?: string;
      startedAt?: string;
    } | null;
    queuedCount?: number;
    completedCount?: number;
    failedCount?: number;
    delayMs?: number;
    retryLimit?: number;
    maxQueuedJobs?: number;
    lastCompletedAt?: string | null;
    lastFailedAt?: string | null;
    lastError?: string | null;
  };
};

export type AdminUser = AuthUser & {
  providers?: string[];
  isOnline?: boolean;
  planLimits?: PlanLimits;
  workspace?: {
    bridgeEnabled: boolean;
    selectedGroupCount: number;
    whatsAppStatus: string;
    telegramStatus: string;
  };
  metrics?: {
    totalTelegramReceived?: number;
    totalForwardedMessages?: number;
    totalWhatsAppDeliveries?: number;
    totalErrors?: number;
    lastActivityAt?: string | null;
    lastForwardedAt?: string | null;
  };
  supervisor?: SupervisorSession | null;
};

export type AppState = {
  auth: {
    authenticated: boolean;
    googleEnabled: boolean;
    user: AuthUser | null;
    error?: string;
  };
  whatsAppStatus: string;
  whatsAppPhone?: string | null;
  telegramStatus: string;
  planLimits?: PlanLimits;
  qrDataUrl: string | null;
  config: {
    telegramMode: 'user' | 'bot';
    telegramChannel: string;
    telegramApiId: string;
    telegramApiHash: string;
    telegramPhone: string;
    hasTelegramBotToken: boolean;
    hasTelegramSession: boolean;
    bridgeEnabled: boolean;
    disconnectWhatsAppOnLogout?: boolean;
    dashboardViewClearedAt?: string;
    selectedGroupIds: string[];
  };
  metrics: {
    totalTelegramReceived?: number;
    totalForwardBatches?: number;
    totalForwardedMessages?: number;
    totalWhatsAppDeliveries?: number;
    totalErrors?: number;
    selectedGroupCount?: number;
    availableAdminGroupCount?: number;
    pendingTelegramCount?: number;
    deliveryStats?: {
      skippedDuplicates?: number;
      transientFailures?: number;
      fatalFailures?: number;
    };
    groupsRefreshing?: boolean;
    groupRefreshProgress?: {
      phase?: string;
      total: number;
      processed?: number;
      percent?: number;
      foundAdmins?: number;
    };
    groupCacheRefreshedAt?: string;
    hasCachedGroups?: boolean;
    lastActivityAt?: string;
    lastTelegramMessageAt?: string;
    lastForwardedAt?: string;
    lastErrorAt?: string;
  };
  telegram: {
    authPhase: string;
    passwordRequired?: boolean;
    availableChats?: TelegramChat[];
    user?: {
      name?: string;
      username?: string;
      phone?: string;
    };
  };
  activity: ActivityEvent[];
  offers?: ActivityOffer[];
  groups: WhatsAppGroup[];
  admin?: {
    users: AdminUser[];
    summary?: Record<string, number>;
    supervisor?: {
      totalRuntimes?: number;
      readyWhatsApp?: number;
      listeningTelegram?: number;
      queuedDeliveries?: number;
      activeDeliveries?: number;
      skippedDuplicates?: number;
      transientFailures?: number;
      fatalFailures?: number;
      healthAlerts?: Array<{
        level: 'warning' | 'critical' | string;
        code?: string;
        message?: string;
      }>;
      sessions?: SupervisorSession[];
    };
  } | null;
  affiliate?: {
    account: AffiliateAccount | null;
    automations: AffiliateAutomation[];
    logs: AffiliateLog[];
    termsAccepted?: boolean;
    termsVersion?: string;
    shortener?: {
      amazonEnabled?: boolean;
    };
    error?: string;
  };
  issue?: {
    scope?: string;
    message?: string;
    canReconnect?: boolean;
    canResetSession?: boolean;
  } | null;
  issues?: Array<{
    scope?: string;
    message?: string;
  }>;
};

export type ViewKey =
  | 'overview'
  | 'connections'
  | 'groups'
  | 'flows'
  | 'affiliate'
  | 'planUsage'
  | 'activity'
  | 'account'
  | 'admin';

export type FlowFieldErrors = Partial<Record<'telegram' | 'telegramSourceGroupId' | 'destinations' | 'flow', string>>;
