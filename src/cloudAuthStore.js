import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const r2AccountId = String(process.env.R2_ACCOUNT_ID ?? '').trim();
const r2BucketName = String(process.env.R2_BUCKET_NAME ?? '').trim();
const r2AccessKeyId = String(process.env.R2_ACCESS_KEY_ID ?? '').trim();
const r2SecretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY ?? '').trim();
const r2PublicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');

const cloudEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const r2Enabled = Boolean(r2AccountId && r2BucketName && r2AccessKeyId && r2SecretAccessKey && r2PublicBaseUrl);
const dataDir = path.resolve(process.cwd(), 'data');
const avatarUploadsDir = path.join(dataDir, 'profile-uploads');

const r2Client = r2Enabled
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey
      }
    })
  : null;

let seedPromise = null;

export function isCloudAuthEnabled() {
  return cloudEnabled;
}

export async function ensureCloudUsersSeeded(localUsers = []) {
  if (!cloudEnabled) {
    return;
  }

  if (!seedPromise) {
    seedPromise = seedCloudUsers(localUsers).catch((error) => {
      seedPromise = null;
      throw error;
    });
  }

  await seedPromise;
}

export async function listCloudUsers() {
  const rows = await supabaseRequest('/rest/v1/users', {
    searchParams: {
      select:
        'id,email,name,role,plan,account_status,password_hash,google_id,auth_provider,created_at,updated_at,user_profiles(avatar_url,updated_at)',
      order: 'created_at.desc'
    }
  });

  return rows.map(mapCloudUser);
}

export async function findCloudUserById(userId) {
  const row = await fetchSingleUser({
    id: `eq.${String(userId ?? '').trim()}`
  });

  return row ? mapCloudUser(row) : null;
}

export async function findCloudUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const row = await fetchSingleUser({
    email: `eq.${normalizedEmail}`
  });

  return row ? mapCloudUser(row) : null;
}

export async function findCloudUserByGoogleId(googleId) {
  const normalizedGoogleId = String(googleId ?? '').trim();
  const row = await fetchSingleUser({
    google_id: `eq.${normalizedGoogleId}`
  });

  return row ? mapCloudUser(row) : null;
}

export async function createCloudPasswordUser({ id, name, email, passwordHash, role, plan, accountStatus, billingStatus, createdAt, updatedAt, lastLoginAt }) {
  const row = await insertUserRow({
    id,
    name,
    email,
    password_hash: passwordHash,
    google_id: null,
    auth_provider: 'email',
    role,
    plan,
    account_status: accountStatus,
    created_at: createdAt,
    updated_at: updatedAt || createdAt
  });

  return mapCloudUser(row);
}

export async function touchCloudUserLogin(userId) {
  const updatedAt = new Date().toISOString();
  const row = await patchUserRow(userId, {
    updated_at: updatedAt
  });

  return row ? mapCloudUser(row) : null;
}

export async function upsertCloudGoogleUser({ id, email, name, googleId, avatarUrl, role, plan, accountStatus, billingStatus, createdAt, updatedAt, lastLoginAt }) {
  const row = await insertUserRow({
    id,
    name,
    email,
    password_hash: null,
    google_id: googleId,
    auth_provider: 'google',
    role,
    plan,
    account_status: accountStatus,
    created_at: createdAt,
    updated_at: updatedAt || createdAt
  });

  if (avatarUrl) {
    await upsertProfileRow(row.id, {
      avatar_url: avatarUrl,
      updated_at: row.updated_at || new Date().toISOString()
    });
  }

  return mapCloudUser({
    ...row,
    user_profiles: avatarUrl ? [{ avatar_url: avatarUrl, updated_at: row.updated_at || new Date().toISOString() }] : []
  });
}

export async function updateCloudUserProfile(userId, updates = {}) {
  const row = await patchUserRow(userId, {
    name: String(updates.name ?? '').trim(),
    updated_at: new Date().toISOString()
  });

  return row ? mapCloudUser(row) : null;
}

export async function updateCloudUserPassword(userId, passwordHash) {
  const row = await patchUserRow(userId, {
    password_hash: passwordHash,
    updated_at: new Date().toISOString()
  });

  return row ? mapCloudUser(row) : null;
}

export async function updateCloudUserAdminSettings(userId, updates = {}) {
  const payload = {
    updated_at: new Date().toISOString()
  };

  if (updates.plan) {
    payload.plan = updates.plan;
  }

  if (updates.accountStatus) {
    payload.account_status = updates.accountStatus;
  }

  const row = await patchUserRow(userId, payload);
  return row ? mapCloudUser(row) : null;
}

export async function updateCloudUserAvatar(userId, { buffer, fileExt, mimeType }) {
  if (!r2Client) {
    throw new Error('O armazenamento de avatar no R2 ainda nao foi configurado.');
  }

  const safeExt = String(fileExt ?? '').trim().toLowerCase();
  const objectKey = `avatars/${userId}.${safeExt}`;
  await r2Client.send(
    new PutObjectCommand({
      Bucket: r2BucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType
    })
  );

  const avatarUrl = `${r2PublicBaseUrl}/${objectKey}`;
  const updatedAt = new Date().toISOString();
  await upsertProfileRow(userId, {
    avatar_url: avatarUrl,
    updated_at: updatedAt
  });
  const row = await patchUserRow(userId, {
    updated_at: updatedAt
  });

  return row
    ? mapCloudUser({
        ...row,
        user_profiles: [{ avatar_url: avatarUrl, updated_at: updatedAt }]
      })
    : null;
}

async function seedCloudUsers(localUsers) {
  if (!Array.isArray(localUsers) || localUsers.length === 0) {
    return;
  }

  const existingUsers = await listCloudUsers();
  const usersById = new Map(existingUsers.map((user) => [user.id, user]));
  const usersByEmail = new Map(existingUsers.map((user) => [normalizeEmail(user.email), user]));

  for (const localUser of localUsers) {
    const existing = usersById.get(localUser.id) || usersByEmail.get(normalizeEmail(localUser.email));

    if (!existing) {
      const inserted = await insertUserRow({
        id: localUser.id,
        email: localUser.email,
        name: localUser.name,
        role: localUser.role,
        plan: localUser.plan,
        account_status: localUser.accountStatus,
        password_hash: localUser.passwordHash || null,
        google_id: localUser.googleId || null,
        auth_provider: localUser.googleId ? 'google' : 'email',
        created_at: localUser.createdAt,
        updated_at: localUser.updatedAt || localUser.createdAt
      });

      let avatarUrl = '';

      if (localUser.avatarStorage === 'upload' && localUser.avatarFileExt) {
        avatarUrl = await maybeMigrateLocalAvatar(localUser);
      } else if (localUser.avatarStorage === 'google' && localUser.avatarUrl) {
        avatarUrl = localUser.avatarUrl;
      }

      if (avatarUrl) {
        await upsertProfileRow(inserted.id, {
          avatar_url: avatarUrl,
          updated_at: localUser.avatarUpdatedAt || localUser.updatedAt || localUser.createdAt
        });
      }

      continue;
    }

    if ((!existing.avatarUrl || existing.avatarStorage === 'none') && localUser.avatarStorage === 'upload' && localUser.avatarFileExt) {
      const avatarUrl = await maybeMigrateLocalAvatar(localUser);

      if (avatarUrl) {
        await upsertProfileRow(existing.id, {
          avatar_url: avatarUrl,
          updated_at: localUser.avatarUpdatedAt || localUser.updatedAt || localUser.createdAt
        });
      }
    }
  }
}

async function maybeMigrateLocalAvatar(localUser) {
  if (!r2Client || !localUser?.id || !localUser?.avatarFileExt) {
    return '';
  }

  const filePath = path.join(avatarUploadsDir, `${localUser.id}.${localUser.avatarFileExt}`);

  try {
    const buffer = await fs.readFile(filePath);
    const mimeType = `image/${localUser.avatarFileExt === 'jpg' ? 'jpeg' : localUser.avatarFileExt}`;
    await updateCloudUserAvatar(localUser.id, {
      buffer,
      fileExt: localUser.avatarFileExt,
      mimeType
    });

    return `${r2PublicBaseUrl}/avatars/${localUser.id}.${localUser.avatarFileExt}`;
  } catch {
    return '';
  }
}

async function fetchSingleUser(filters = {}) {
  const rows = await supabaseRequest('/rest/v1/users', {
    searchParams: {
      select:
        'id,email,name,role,plan,account_status,password_hash,google_id,auth_provider,created_at,updated_at,user_profiles(avatar_url,updated_at)',
      limit: '1',
      ...filters
    }
  });

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function insertUserRow(payload) {
  const rows = await supabaseRequest('/rest/v1/users', {
    method: 'POST',
    searchParams: {
      on_conflict: 'id',
      select:
        'id,email,name,role,plan,account_status,password_hash,google_id,auth_provider,created_at,updated_at,user_profiles(avatar_url,updated_at)'
    },
    headers: {
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: [payload]
  });

  return rows[0];
}

async function patchUserRow(userId, payload) {
  const rows = await supabaseRequest('/rest/v1/users', {
    method: 'PATCH',
    searchParams: {
      id: `eq.${String(userId ?? '').trim()}`,
      select:
        'id,email,name,role,plan,account_status,password_hash,google_id,auth_provider,created_at,updated_at,user_profiles(avatar_url,updated_at)'
    },
    headers: {
      Prefer: 'return=representation'
    },
    body: payload
  });

  return rows[0] || null;
}

async function upsertProfileRow(userId, payload) {
  await supabaseRequest('/rest/v1/user_profiles', {
    method: 'POST',
    searchParams: {
      on_conflict: 'user_id'
    },
    headers: {
      Prefer: 'return=minimal,resolution=merge-duplicates'
    },
    body: [
      {
        user_id: userId,
        ...payload
      }
    ]
  });
}

async function supabaseRequest(endpoint, options = {}) {
  if (!cloudEnabled) {
    throw new Error('Supabase nao configurado.');
  }

  const url = new URL(`${supabaseUrl}${endpoint}`);
  const searchParams = options.searchParams || {};

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(`Falha ao acessar o Supabase (${response.status}). ${payload}`.trim());
  }

  if (response.status === 204) {
    return [];
  }

  return await response.json();
}

function mapCloudUser(row) {
  const profile = Array.isArray(row?.user_profiles) ? row.user_profiles[0] : row?.user_profiles;
  const googleId = String(row?.google_id ?? '').trim();
  const passwordHash = String(row?.password_hash ?? '');
  const avatarUrl = String(profile?.avatar_url ?? '').trim();
  const avatarStorage = avatarUrl ? (googleId ? 'google' : 'upload') : 'none';

  return {
    id: String(row?.id ?? ''),
    name: String(row?.name ?? '').trim() || normalizeEmail(row?.email) || 'Usuario sem nome',
    email: normalizeEmail(row?.email),
    passwordHash,
    googleId,
    avatarStorage,
    avatarFileExt: '',
    avatarUpdatedAt: profile?.updated_at ? String(profile.updated_at) : null,
    avatarUrl,
    role: String(row?.role ?? 'member'),
    plan: String(row?.plan ?? 'beta'),
    accountStatus: String(row?.account_status ?? 'active'),
    billingStatus: 'beta',
    internalNote: '',
    createdAt: String(row?.created_at ?? new Date().toISOString()),
    updatedAt: String(row?.updated_at ?? row?.created_at ?? new Date().toISOString()),
    lastLoginAt: row?.updated_at ? String(row.updated_at) : null
  };
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}
