import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const workspacesDir = path.join(dataDir, 'workspaces');
const migrationsDir = path.join(dataDir, 'migrations');
const legacyConfigPath = path.join(dataDir, 'config.json');
const legacyMigrationPath = path.join(migrationsDir, 'legacy-workspace-owner.json');
const authRootDir = path.resolve(process.cwd(), '.wwebjs_auth');
const legacyAuthSessionDir = path.join(authRootDir, 'session');

export const defaultConfig = {
  telegramMode: 'user',
  telegramBotToken: '',
  telegramApiId: '',
  telegramApiHash: '',
  telegramPhone: '',
  telegramSession: '',
  telegramChannel: '',
  bridgeEnabled: true,
  dashboardViewClearedAt: '',
  selectedGroupIds: [],
  whatsAppGroupCache: {
    groups: [],
    diagnostics: null,
    refreshedAt: ''
  }
};

export function getWorkspacePaths(userId) {
  const normalizedUserId = String(userId ?? '').trim();
  const workspaceDir = path.join(workspacesDir, normalizedUserId);
  const configPath = path.join(workspaceDir, 'config.json');
  const activityPath = path.join(workspaceDir, 'activity.json');
  const authClientId = buildAuthClientId(normalizedUserId);
  const authSessionDir = path.join(authRootDir, `session-${authClientId}`);
  const previousAuthClientId = `user-${normalizedUserId}`.replace(/[^a-z0-9_-]/gi, '-');
  const previousAuthSessionDir = path.join(authRootDir, `session-${previousAuthClientId}`);

  return {
    userId: normalizedUserId,
    workspaceDir,
    configPath,
    activityPath,
    authRootDir,
    authClientId,
    authSessionDir,
    previousAuthSessionDir
  };
}

export async function ensureWorkspaceForUser(userId) {
  const paths = getWorkspacePaths(userId);

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspacesDir, { recursive: true });
  await fs.mkdir(migrationsDir, { recursive: true });
  await fs.mkdir(paths.workspaceDir, { recursive: true });
  await fs.mkdir(authRootDir, { recursive: true });

  await maybeMigrateLegacyWorkspace(paths);

  try {
    await fs.access(paths.configPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await fs.writeFile(paths.configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
  }

  return paths;
}

export async function loadConfigForUser(userId) {
  const paths = await ensureWorkspaceForUser(userId);

  try {
    const raw = await fs.readFile(paths.configPath, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      ...defaultConfig,
      ...parsed,
      selectedGroupIds: Array.isArray(parsed.selectedGroupIds) ? parsed.selectedGroupIds : [],
      whatsAppGroupCache: normalizeWhatsAppGroupCache(parsed.whatsAppGroupCache)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveConfigForUser(userId, defaultConfig);
      return structuredClone(defaultConfig);
    }

    throw error;
  }
}

export async function saveConfigForUser(userId, nextConfig) {
  const paths = await ensureWorkspaceForUser(userId);
  const merged = {
    ...defaultConfig,
    ...nextConfig,
    selectedGroupIds: Array.isArray(nextConfig.selectedGroupIds) ? nextConfig.selectedGroupIds : [],
    whatsAppGroupCache: normalizeWhatsAppGroupCache(nextConfig.whatsAppGroupCache)
  };

  await fs.writeFile(paths.configPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export async function listWorkspaceUserIds() {
  await fs.mkdir(workspacesDir, { recursive: true });
  const entries = await fs.readdir(workspacesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function maybeMigrateLegacyWorkspace(paths) {
  const workspaceExists = await exists(paths.configPath);
  const migration = await readJson(legacyMigrationPath);

  if (workspaceExists || migration?.userId) {
    if (migration?.userId === paths.userId) {
      await maybeMigrateLegacySession(paths);
    }

    return;
  }

  const legacyConfig = await readJson(legacyConfigPath);

  if (!legacyConfig) {
    return;
  }

  const normalizedConfig = {
    ...defaultConfig,
    ...legacyConfig,
    selectedGroupIds: Array.isArray(legacyConfig.selectedGroupIds) ? legacyConfig.selectedGroupIds : []
  };

  await fs.writeFile(paths.configPath, JSON.stringify(normalizedConfig, null, 2), 'utf8');
  await maybeMigrateLegacySession(paths);
  await fs.writeFile(
    legacyMigrationPath,
    JSON.stringify(
      {
        userId: paths.userId,
        migratedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
}

async function maybeMigrateLegacySession(paths) {
  const targetExists = await exists(paths.authSessionDir);
  const previousTargetExists = await exists(paths.previousAuthSessionDir);
  const sourceExists = await exists(legacyAuthSessionDir);

  if (targetExists) {
    return;
  }

  if (previousTargetExists) {
    await moveDirectory(paths.previousAuthSessionDir, paths.authSessionDir);
    return;
  }

  if (!sourceExists) {
    return;
  }

  await fs.cp(legacyAuthSessionDir, paths.authSessionDir, {
    recursive: true,
    errorOnExist: false,
    force: false
  });
}

function buildAuthClientId(userId) {
  const digest = crypto.createHash('sha1').update(String(userId ?? '')).digest('hex').slice(0, 12);
  return `u-${digest}`;
}

async function moveDirectory(sourceDir, targetDir) {
  try {
    await fs.rename(sourceDir, targetDir);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      errorOnExist: false,
      force: false
    });
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readJson(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function normalizeWhatsAppGroupCache(cache) {
  if (!cache || typeof cache !== 'object') {
    return structuredClone(defaultConfig.whatsAppGroupCache);
  }

  return {
    groups: Array.isArray(cache.groups) ? cache.groups : [],
    diagnostics: cache.diagnostics && typeof cache.diagnostics === 'object' ? cache.diagnostics : null,
    refreshedAt: typeof cache.refreshedAt === 'string' ? cache.refreshedAt : ''
  };
}
