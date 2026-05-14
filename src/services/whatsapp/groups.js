import { saveConfigForUser } from '../../configStore.js';
import { countAdminGroups } from '../../runtime/state.js';

export function isGroupCacheStale(runtime, { groupCacheMaxAgeMs }) {
  if (!runtime.groupCacheRefreshedAt) {
    return true;
  }

  const cachedAt = new Date(runtime.groupCacheRefreshedAt).getTime();
  if (!Number.isFinite(cachedAt)) {
    return true;
  }

  return Date.now() - cachedAt > groupCacheMaxAgeMs;
}

export function getGroupsPage(runtime, { search = '', page = 1, pageSize = 50, filter = 'all' } = {}, options = {}) {
  const selected = new Set(runtime.config.selectedGroupIds);
  let groups = runtime.availableGroups;

  if (filter === 'selected') {
    groups = groups.filter((group) => selected.has(group.id));
  } else if (filter === 'community') {
    groups = groups.filter((group) => Boolean(group.isCommunityLinked) && !Boolean(group.isAnnouncement));
  } else if (filter === 'announcement') {
    groups = groups.filter((group) => Boolean(group.isAnnouncement));
  } else if (filter === 'admin') {
    groups = groups.filter((group) => group.hasAdminAccess === true);
  }

  if (search) {
    const normalized = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    groups = groups.filter((group) => {
      const name = (group.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return name.includes(normalized);
    });
  }

  groups = [...groups].sort((left, right) => {
    const leftSelected = selected.has(left.id) ? 1 : 0;
    const rightSelected = selected.has(right.id) ? 1 : 0;
    if (leftSelected !== rightSelected) return rightSelected - leftSelected;
    return left.name.localeCompare(right.name, 'pt-BR');
  });

  const total = groups.length;
  const clampedPage = Math.max(1, Math.min(page, Math.ceil(total / pageSize) || 1));
  const start = (clampedPage - 1) * pageSize;
  const paged = groups.slice(start, start + pageSize);

  return {
    groups: paged.map((group) => ({ ...group, selected: selected.has(group.id) })),
    pagination: {
      page: clampedPage,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1
    },
    meta: {
      refreshing: runtime.isRefreshingGroups,
      progress: runtime.groupRefreshProgress,
      cachedAt: runtime.groupCacheRefreshedAt,
      cacheStale: isGroupCacheStale(runtime, options),
      selectedGroupIds: runtime.config.selectedGroupIds || [],
      adminGroupCount: countAdminGroups(runtime.availableGroups),
      totalAvailable: runtime.availableGroups.length
    }
  };
}

export async function refreshAvailableGroups(runtime, options = {}, serviceOptions = {}) {
  const waitForCompletion = options.waitForCompletion !== false;

  if (runtime.groupRefreshPromise) {
    if (waitForCompletion) {
      await runtime.groupRefreshPromise;
    }
    return;
  }

  const refreshPromise = performAvailableGroupsRefresh(runtime, serviceOptions)
    .catch((err) => {
      runtime.log(`Erro ao atualizar grupos: ${err.message}`, { level: 'error' });
    })
    .finally(() => {
      if (runtime.groupRefreshPromise === refreshPromise) {
        runtime.groupRefreshPromise = null;
      }
    });
  runtime.groupRefreshPromise = refreshPromise;

  if (waitForCompletion) {
    await refreshPromise;
  }
}

export async function performAvailableGroupsRefresh(runtime, options = {}) {
  const groupAdminCheckBatchSize = Number(options.groupAdminCheckBatchSize || 12);
  const defaultWhatsAppProtocolTimeoutMs = Number(options.defaultWhatsAppProtocolTimeoutMs || 600000);

  if (!runtime.whatsAppClient || runtime.whatsAppStatus !== 'ready') {
    throw new Error('O WhatsApp ainda está finalizando a conexão. Aguarde o status "Pronto" e tente atualizar os grupos novamente.');
  }

  if (!runtime.isWhatsAppBrowserAlive()) {
    runtime.markWhatsAppBrowserClosed('listar grupos');
    return;
  }

  runtime.isRefreshingGroups = true;
  runtime.groupRefreshProgress = {
    phase: 'loading_groups',
    total: 0,
    processed: 0,
    percent: 5,
    foundAdmins: 0
  };

  try {
    runtime.log('Atualizando grupos do WhatsApp... Na primeira sincronizacao isso pode levar 1 a 3 minutos.', {
      type: 'groups_refresh_started'
    });
    const groups = await fetchGroupSummaries(runtime);
    const provisionalGroups = groups
      .map((chat) => ({
        id: chat.id,
        name: chat.name || 'Grupo sem nome',
        kind: chat.kind,
        isAnnouncement: chat.isAnnouncement,
        isCommunityLinked: chat.isCommunityLinked,
        parentGroupId: chat.parentGroupId,
        hasAdminAccess: null
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    runtime.availableGroups = provisionalGroups;
    runtime.groupRefreshProgress = {
      phase: 'checking_admins',
      total: groups.length,
      processed: 0,
      percent: groups.length ? 10 : 100,
      foundAdmins: 0
    };
    const myId = runtime.whatsAppClient.info?.wid;
    const myCanonicalIds = buildCanonicalIds(myId);
    const groupsWithAdminFlag = [];
    const diagnosticSample = [];
    let foundAdmins = 0;

    const cachedMap = new Map(runtime.availableGroups.map((group) => [group.id, group]));

    for (let index = 0; index < groups.length; index += 1) {
      const chat = groups[index];
      const cached = cachedMap.get(chat.id);
      const participants = chat.participants;

      let isAdmin = cached?.hasAdminAccess;

      if (isAdmin === undefined || isAdmin === null) {
        const adminParticipant = participants.find((participant) => {
          const participantIds = buildCanonicalIds(participant.id);
          return (
            intersects(participantIds, myCanonicalIds) &&
            (participant.isAdmin || participant.isSuperAdmin)
          );
        });
        isAdmin = Boolean(adminParticipant);
      }

      if (diagnosticSample.length < 6) {
        diagnosticSample.push({
          name: chat.name || 'Grupo sem nome',
          id: chat.id,
          participantCount: participants.length,
          matchedAdmin: isAdmin,
          sampleParticipantIds: participants.slice(0, 5).map((participant) => ({
            id: serializeWid(participant.id),
            canonical: [...buildCanonicalIds(participant.id)],
            isAdmin: Boolean(participant.isAdmin),
            isSuperAdmin: Boolean(participant.isSuperAdmin)
          }))
        });
      }

      const processed = index + 1;
      const shouldUpdateProgress =
        processed === groups.length ||
        processed === 1 ||
        processed % 5 === 0;

      groupsWithAdminFlag.push({
        id: chat.id,
        name: chat.name || 'Grupo sem nome',
        kind: chat.kind,
        isAnnouncement: chat.isAnnouncement,
        isCommunityLinked: chat.isCommunityLinked,
        parentGroupId: chat.parentGroupId,
        hasAdminAccess: isAdmin
      });
      if (isAdmin) {
        foundAdmins += 1;
      }

      if (shouldUpdateProgress) {
        runtime.groupRefreshProgress = {
          phase: 'checking_admins',
          total: groups.length,
          processed,
          percent: groups.length
            ? Math.max(10, Math.min(99, Math.round((processed / groups.length) * 100)))
            : 100,
          foundAdmins
        };
      }

      if ((index + 1) % groupAdminCheckBatchSize === 0 && index + 1 < groups.length) {
        await wait(0);
      }
    }

    runtime.availableGroups = groupsWithAdminFlag.sort((left, right) =>
      left.name.localeCompare(right.name, 'pt-BR')
    );
    const groupsWithAdminMatch = countAdminGroups(runtime.availableGroups);
    runtime.groupCacheRefreshedAt = new Date().toISOString();
    runtime.groupRefreshProgress = {
      phase: 'done',
      total: groups.length,
      processed: groups.length,
      percent: 100,
      foundAdmins: groupsWithAdminMatch
    };
    runtime.groupDiagnostics = {
      totalGroupsSeen: groups.length,
      groupsWithAdminMatch,
      myCanonicalIds: [...myCanonicalIds],
      sample: diagnosticSample
    };
    await persistGroupCache(runtime, runtime.availableGroups, runtime.groupDiagnostics, runtime.groupCacheRefreshedAt);

    runtime.log(
      `Lista de grupos atualizada. Total vistos: ${groups.length}. Grupos com admin detectado: ${groupsWithAdminMatch}.`,
      {
        type: 'groups_refresh_success',
        increments: { groupRefreshes: 1 },
        metadata: {
          totalGroupsSeen: groups.length,
          groupsWithAdminMatch
        }
      }
    );
  } catch (error) {
    runtime.groupRefreshProgress = {
      ...runtime.groupRefreshProgress,
      phase: 'error'
    };
    if (isRecoverableWhatsAppTargetError(error)) {
      runtime.markWhatsAppBrowserClosed('listar grupos', error);
      return;
    }

    if (isProtocolTimeoutError(error)) {
      runtime.log(
        `A leitura dos grupos do WhatsApp excedeu o tempo limite de ${Math.round(
          defaultWhatsAppProtocolTimeoutMs / 1000
        )}s. Tente novamente ou aumente WHATSAPP_PROTOCOL_TIMEOUT_MS no servidor.`,
        {
          level: 'error',
          type: 'groups_refresh_timeout',
          increments: { errors: 1 },
          metadata: {
            protocolTimeoutMs: defaultWhatsAppProtocolTimeoutMs
          }
        }
      );
      return;
    }

    runtime.log(`Falha ao listar grupos do WhatsApp: ${error.message}`, {
      level: 'error',
      type: 'groups_refresh_error',
      increments: { errors: 1 }
    });
  } finally {
    runtime.isRefreshingGroups = false;
  }
}

export async function fetchGroupSummaries(runtime) {
  const chats = await runtime.whatsAppClient.getChats();

  return chats
    .filter((chat) => chat.isGroup)
    .map((chat) => {
      const groupKind = getWhatsAppGroupKind(chat);

      return {
        id: serializeWid(chat.id),
        name: chat.name || 'Grupo sem nome',
        participants: getGroupParticipants(chat).map((participant) => ({
          id: serializeWid(participant.id),
          isAdmin: Boolean(participant.isAdmin),
          isSuperAdmin: Boolean(participant.isSuperAdmin)
        })),
        kind: groupKind.kind,
        isAnnouncement: groupKind.isAnnouncement,
        isCommunityLinked: groupKind.isCommunityLinked,
        parentGroupId: groupKind.parentGroupId
      };
    });
}

export function hydrateGroupCache(runtime) {
  const cache = runtime.config?.whatsAppGroupCache;

  if (!cache || !Array.isArray(cache.groups) || cache.groups.length === 0) {
    runtime.availableGroups = [];
    runtime.groupCacheRefreshedAt = '';
    return;
  }

  runtime.availableGroups = cache.groups
    .map((group) => ({
      id: String(group.id ?? ''),
      name: String(group.name ?? 'Grupo sem nome'),
      kind: group.kind ?? 'group',
      isAnnouncement: Boolean(group.isAnnouncement),
      isCommunityLinked: Boolean(group.isCommunityLinked),
      parentGroupId: group.parentGroupId ? String(group.parentGroupId) : null,
      hasAdminAccess:
        group.hasAdminAccess === null || group.hasAdminAccess === undefined
          ? null
          : Boolean(group.hasAdminAccess)
    }))
    .filter((group) => group.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  runtime.groupCacheRefreshedAt = typeof cache.refreshedAt === 'string' ? cache.refreshedAt : '';

  if (cache.diagnostics && typeof cache.diagnostics === 'object') {
    runtime.groupDiagnostics = cache.diagnostics;
  }
}

export async function persistGroupCache(runtime, groups, diagnostics, refreshedAt) {
  runtime.config = await saveConfigForUser(runtime.userId, {
    ...runtime.config,
    whatsAppGroupCache: {
      groups,
      diagnostics,
      refreshedAt
    }
  });
}

function serializeWid(wid) {
  if (!wid) {
    return null;
  }

  if (typeof wid === 'string') {
    return wid;
  }

  if (wid._serialized) {
    return wid._serialized;
  }

  if (wid.user && wid.server) {
    return `${wid.user}@${wid.server}`;
  }

  return String(wid);
}

function getGroupParticipants(chat) {
  if (Array.isArray(chat.participants) && chat.participants.length > 0) {
    return chat.participants;
  }

  if (Array.isArray(chat.groupMetadata?.participants) && chat.groupMetadata.participants.length > 0) {
    return chat.groupMetadata.participants;
  }

  return [];
}

function getWhatsAppGroupKind(chat) {
  const metadata = chat?.groupMetadata || {};
  const parentGroupId = serializeWid(
    metadata.parentGroupId ||
      metadata.parentGroupWid ||
      metadata.linkedParent ||
      metadata.linkedParentId ||
      metadata.communityId ||
      metadata.communityParentId ||
      metadata.parentGroup ||
      metadata.linkedParentWid ||
      metadata.linkedParentGroupId
  );
  const isAnnouncement = Boolean(
    metadata.announce ||
      metadata.isAnnounceGrp ||
      metadata.announcement ||
      metadata.isAnnouncementGroup ||
      metadata.announceGrp ||
      chat?.isReadOnly
  );
  const explicitCommunityFlag = Boolean(
    metadata.isCommunity ||
      metadata.isCommunityGroup ||
      metadata.community ||
      metadata.isParentGroup ||
      metadata.isParentCommunity
  );
  const isCommunityLinked = Boolean(parentGroupId || explicitCommunityFlag);

  return {
    kind: isAnnouncement ? 'announcement' : isCommunityLinked ? 'community_group' : 'group',
    isAnnouncement,
    isCommunityLinked,
    parentGroupId
  };
}

function buildCanonicalIds(wid) {
  const values = new Set();
  const serialized = serializeWid(wid);

  if (serialized) {
    values.add(serialized.toLowerCase());
    values.add(serialized.replace(/@.+$/, '').toLowerCase());
    values.add(serialized.replace(/\D/g, ''));
  }

  if (wid && typeof wid === 'object') {
    if (wid.user) {
      values.add(String(wid.user).toLowerCase());
      values.add(String(wid.user).replace(/\D/g, ''));
    }

    if (wid.server && wid.user) {
      values.add(`${String(wid.user).toLowerCase()}@${String(wid.server).toLowerCase()}`);
    }

    if (wid._serialized) {
      values.add(String(wid._serialized).toLowerCase());
      values.add(String(wid._serialized).replace(/@.+$/, '').toLowerCase());
      values.add(String(wid._serialized).replace(/\D/g, ''));
    }
  }

  values.delete('');
  return values;
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

function isRecoverableWhatsAppTargetError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('target closed') ||
    message.includes('session closed') ||
    message.includes('execution context was destroyed') ||
    message.includes('most likely because of a navigation')
  );
}

function isProtocolTimeoutError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return message.includes('runtime.callfunctionon timed out');
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
