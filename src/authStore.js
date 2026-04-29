import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {
  createCloudPasswordUser,
  deleteCloudUser,
  ensureCloudUsersSeeded,
  findCloudUserByEmail,
  findCloudUserByGoogleId,
  findCloudUserById,
  isCloudAuthEnabled,
  listCloudUsers,
  touchCloudUserLogin,
  updateCloudUserAdminSettings,
  updateCloudUserAvatar,
  updateCloudUserPassword,
  updateCloudUserProfile,
  upsertCloudGoogleUser
} from './cloudAuthStore.js';
import { getWorkspacePaths } from './configStore.js';

const dataDir = path.resolve(process.cwd(), 'data');
const usersPath = path.join(dataDir, 'users.json');
const avatarUploadsDir = path.join(dataDir, 'profile-uploads');
const primaryAdminEmail = normalizeEmail('rdamascenoferreira@gmail.com');

export const userRoleOptions = ['admin', 'member'];
export const userPlanOptions = ['beta', 'starter', 'pro', 'enterprise'];
export const userAccountStatusOptions = ['active', 'trial', 'suspended'];
export const userBillingStatusOptions = ['beta', 'pending', 'paid', 'overdue'];

async function loadUsers() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(usersPath, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const inputUsers = Array.isArray(parsed.users) ? parsed.users : [];
    const users = inputUsers.map((user, index, list) => normalizeStoredUser(user, index, list));

    if (JSON.stringify(inputUsers) !== JSON.stringify(users)) {
      await saveUsers(users);
    }

    return users;
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveUsers([]);
      return [];
    }

    throw error;
  }
}

async function saveUsers(users) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(usersPath, JSON.stringify({ users }, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isPrimaryAdminEmail(email) {
  return normalizeEmail(email) === primaryAdminEmail;
}

function buildProviders(user) {
  const providers = [];

  if (user.passwordHash) {
    providers.push('password');
  }

  if (user.googleId) {
    providers.push('google');
  }

  return providers;
}

function normalizeStoredUser(user, _index, _users) {
  const normalizedEmail = normalizeEmail(user?.email);
  const normalizedRole = resolveUserRole(user?.role, normalizedEmail);
  const avatarStorage = normalizeAvatarStorage(user?.avatarStorage, Boolean(user?.googleId));
  const avatarFileExt = String(user?.avatarFileExt ?? '').trim().toLowerCase();
  const avatarUpdatedAt = user?.avatarUpdatedAt ? String(user.avatarUpdatedAt) : null;
  const rawAvatarUrl = String(user?.avatarUrl ?? '').trim();

  return {
    id: String(user?.id ?? crypto.randomUUID()),
    name: String(user?.name ?? '').trim() || normalizedEmail || 'Usuario sem nome',
    email: normalizedEmail,
    passwordHash: String(user?.passwordHash ?? ''),
    googleId: String(user?.googleId ?? '').trim(),
    avatarStorage,
    avatarFileExt,
    avatarUpdatedAt,
    avatarUrl: resolveAvatarUrl({
      id: String(user?.id ?? ''),
      avatarStorage,
      avatarFileExt,
      avatarUpdatedAt,
      rawAvatarUrl
    }),
    role: normalizedRole,
    plan: normalizeOption(user?.plan, userPlanOptions, 'beta'),
    accountStatus: normalizeOption(user?.accountStatus, userAccountStatusOptions, 'active'),
    billingStatus: normalizeOption(user?.billingStatus, userBillingStatusOptions, 'beta'),
    internalNote: String(user?.internalNote ?? '').trim(),
    createdAt: String(user?.createdAt ?? new Date().toISOString()),
    updatedAt: String(user?.updatedAt ?? user?.createdAt ?? new Date().toISOString()),
    lastLoginAt: user?.lastLoginAt ? String(user.lastLoginAt) : null
  };
}

function normalizeOption(value, validOptions, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return validOptions.includes(normalized) ? normalized : fallback;
}

function resolveUserRole(_role, email) {
  if (isPrimaryAdminEmail(email)) {
    return 'admin';
  }

  return 'member';
}

function normalizeAvatarStorage(value, hasGoogleId) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'google' || normalized === 'upload' || normalized === 'none') {
    return normalized;
  }

  return hasGoogleId ? 'google' : 'none';
}

function resolveAvatarUrl({ id, avatarStorage, avatarFileExt, avatarUpdatedAt, rawAvatarUrl }) {
  if (rawAvatarUrl && /^https?:\/\//i.test(rawAvatarUrl)) {
    return rawAvatarUrl;
  }

  if (avatarStorage === 'upload' && id && avatarFileExt) {
    return `/api/account/avatar/${encodeURIComponent(id)}?v=${encodeURIComponent(avatarUpdatedAt || '1')}`;
  }

  if (avatarStorage === 'google') {
    return rawAvatarUrl;
  }

  return '';
}

function inferAvatarMetaFromDataUrl(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  const subtype = match?.[1]?.toLowerCase();

  if (!subtype) {
    return null;
  }

  const fileExt = subtype === 'jpeg' ? 'jpg' : subtype;
  const mimeType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;

  return { fileExt, mimeType };
}

function getAvatarFilePath(user) {
  if (!user?.id || !user?.avatarFileExt) {
    return '';
  }

  return path.join(avatarUploadsDir, `${user.id}.${user.avatarFileExt}`);
}

async function ensureCloudSeeded() {
  if (!isCloudAuthEnabled()) {
    return;
  }

  const localUsers = await loadUsers();
  await ensureCloudUsersSeeded(localUsers);
}

export function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    avatarStorage: user.avatarStorage || 'none',
    providers: buildProviders(user),
    role: user.role || 'member',
    plan: user.plan || 'beta',
    accountStatus: user.accountStatus || 'active',
    billingStatus: user.billingStatus || 'beta',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

export async function listUsersForAdmin() {
  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const users = await listCloudUsers();

    return users
      .slice()
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
      .map((user) => ({
        ...sanitizeUser(user),
        updatedAt: user.updatedAt || null,
        internalNote: user.internalNote || ''
      }));
  }

  const users = await loadUsers();

  return users
    .slice()
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .map((user) => ({
      ...sanitizeUser(user),
      updatedAt: user.updatedAt || null,
      internalNote: user.internalNote || ''
    }));
}

export async function updateUserAdminSettings(userId, updates = {}) {
  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const user = await updateCloudUserAdminSettings(userId, updates);

    if (!user) {
      throw new Error('Usuario nao encontrado.');
    }

    user.role = resolveUserRole(user.role, user.email);
    return user;
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuario nao encontrado.');
  }

  user.role = resolveUserRole(user.role, user.email);
  user.plan = updates.plan ? normalizeOption(updates.plan, userPlanOptions, user.plan) : user.plan;
  user.accountStatus = updates.accountStatus
    ? normalizeOption(updates.accountStatus, userAccountStatusOptions, user.accountStatus)
    : user.accountStatus;
  user.billingStatus = updates.billingStatus
    ? normalizeOption(updates.billingStatus, userBillingStatusOptions, user.billingStatus)
    : user.billingStatus;
  user.internalNote = String(updates.internalNote ?? user.internalNote ?? '').trim().slice(0, 1200);
  user.updatedAt = new Date().toISOString();

  await saveUsers(users);
  return user;
}

export async function deleteUserAccount(userId) {
  const normalizedUserId = String(userId ?? '').trim();

  if (!normalizedUserId) {
    throw new Error('Usuario nao encontrado.');
  }

  const user = await findUserById(normalizedUserId);

  if (!user) {
    throw new Error('Usuario nao encontrado.');
  }

  if (isPrimaryAdminEmail(user.email)) {
    throw new Error('A conta principal de administrador nao pode ser excluida.');
  }

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    await deleteCloudUser(normalizedUserId);
  } else {
    const users = await loadUsers();
    await saveUsers(users.filter((entry) => entry.id !== normalizedUserId));
  }

  await removeUserWorkspaceArtifacts(user);
  return true;
}

export async function findUserById(userId) {
  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    return await findCloudUserById(userId);
  }

  const users = await loadUsers();
  return users.find((user) => user.id === userId) || null;
}

export async function createPasswordUser({ name, email, password }) {
  const normalizedName = String(name ?? '').trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password ?? '');

  if (!normalizedName) {
    throw new Error('Informe seu nome.');
  }

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Informe um e-mail valido.');
  }

  if (normalizedPassword.length < 8) {
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const existingUser = await findCloudUserByEmail(normalizedEmail);

    if (existingUser) {
      throw new Error('Ja existe uma conta com esse e-mail.');
    }

    const now = new Date().toISOString();
    return await createCloudPasswordUser({
      id: crypto.randomUUID(),
      name: normalizedName,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(normalizedPassword, 10),
      role: resolveUserRole('', normalizedEmail),
      plan: 'beta',
      accountStatus: 'active',
      billingStatus: 'beta',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    });
  }

  const users = await loadUsers();
  const existingUser = users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    throw new Error('Ja existe uma conta com esse e-mail.');
  }

  const now = new Date().toISOString();
  const nextUser = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(normalizedPassword, 10),
    googleId: '',
    avatarUrl: '',
    avatarStorage: 'none',
    avatarFileExt: '',
    avatarUpdatedAt: null,
    role: resolveUserRole('', normalizedEmail),
    plan: 'beta',
    accountStatus: 'active',
    billingStatus: 'beta',
    internalNote: '',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  users.push(nextUser);
  await saveUsers(users);
  return nextUser;
}

export async function verifyPasswordUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const candidatePassword = String(password ?? '');

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const user = await findCloudUserByEmail(normalizedEmail);

    if (!user?.passwordHash) {
      return null;
    }

    if (user.accountStatus === 'suspended') {
      throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
    }

    const isValid = await bcrypt.compare(candidatePassword, user.passwordHash);

    if (!isValid) {
      return null;
    }

    return await touchCloudUserLogin(user.id);
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.email === normalizedEmail);

  if (!user?.passwordHash) {
    return null;
  }

  if (user.accountStatus === 'suspended') {
    throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
  }

  const isValid = await bcrypt.compare(candidatePassword, user.passwordHash);

  if (!isValid) {
    return null;
  }

  return await touchUserLogin(user.id);
}

export async function upsertGoogleUser(profile) {
  const googleId = String(profile?.id ?? '').trim();
  const email = normalizeEmail(profile?.emails?.[0]?.value);
  const avatarUrl = String(profile?.photos?.[0]?.value ?? '').trim();
  const name =
    String(profile?.displayName ?? '').trim() ||
    String(profile?.name?.givenName ?? '').trim() ||
    email;

  if (!googleId) {
    throw new Error('Nao foi possivel identificar a conta Google.');
  }

  if (!email) {
    throw new Error('Sua conta Google nao retornou um e-mail valido.');
  }

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const existingByGoogle = await findCloudUserByGoogleId(googleId);

    if (existingByGoogle) {
      if (existingByGoogle.accountStatus === 'suspended') {
        throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
      }

      return await upsertCloudGoogleUser({
        id: existingByGoogle.id,
        email,
        name: name || existingByGoogle.name,
        googleId,
        avatarUrl: avatarUrl || existingByGoogle.avatarUrl,
        role: resolveUserRole(existingByGoogle.role, email),
        plan: existingByGoogle.plan,
        accountStatus: existingByGoogle.accountStatus,
        billingStatus: existingByGoogle.billingStatus,
        createdAt: existingByGoogle.createdAt,
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      });
    }

    const existingByEmail = await findCloudUserByEmail(email);

    if (existingByEmail) {
      if (existingByEmail.accountStatus === 'suspended') {
        throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
      }

      return await upsertCloudGoogleUser({
        id: existingByEmail.id,
        email,
        name: name || existingByEmail.name,
        googleId,
        avatarUrl: avatarUrl || existingByEmail.avatarUrl,
        role: resolveUserRole(existingByEmail.role, email),
        plan: existingByEmail.plan,
        accountStatus: existingByEmail.accountStatus,
        billingStatus: existingByEmail.billingStatus,
        createdAt: existingByEmail.createdAt,
        updatedAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      });
    }

    const now = new Date().toISOString();
    return await upsertCloudGoogleUser({
      id: crypto.randomUUID(),
      email,
      name,
      googleId,
      avatarUrl,
      role: resolveUserRole('', email),
      plan: 'beta',
      accountStatus: 'active',
      billingStatus: 'beta',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    });
  }

  const users = await loadUsers();
  const now = new Date().toISOString();
  const existingByGoogle = users.find((user) => user.googleId === googleId);

  if (existingByGoogle) {
    if (existingByGoogle.accountStatus === 'suspended') {
      throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
    }

    existingByGoogle.name = name || existingByGoogle.name;
    existingByGoogle.email = email || existingByGoogle.email;
    existingByGoogle.avatarStorage = 'google';
    existingByGoogle.avatarUrl = avatarUrl || existingByGoogle.avatarUrl;
    existingByGoogle.avatarFileExt = '';
    existingByGoogle.avatarUpdatedAt = now;
    existingByGoogle.updatedAt = now;
    existingByGoogle.lastLoginAt = now;
    await saveUsers(users);
    return existingByGoogle;
  }

  const existingByEmail = users.find((user) => user.email === email);

  if (existingByEmail) {
    if (existingByEmail.accountStatus === 'suspended') {
      throw new Error('Sua conta esta suspensa no momento. Fale com o administrador.');
    }

    existingByEmail.googleId = googleId;
    existingByEmail.name = name || existingByEmail.name;
    existingByEmail.avatarStorage = 'google';
    existingByEmail.avatarUrl = avatarUrl || existingByEmail.avatarUrl;
    existingByEmail.avatarFileExt = '';
    existingByEmail.avatarUpdatedAt = now;
    existingByEmail.updatedAt = now;
    existingByEmail.lastLoginAt = now;
    await saveUsers(users);
    return existingByEmail;
  }

  const nextUser = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: '',
    googleId,
    avatarUrl,
    avatarStorage: 'google',
    avatarFileExt: '',
    avatarUpdatedAt: now,
    role: resolveUserRole('', email),
    plan: 'beta',
    accountStatus: 'active',
    billingStatus: 'beta',
    internalNote: '',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  users.push(nextUser);
  await saveUsers(users);
  return nextUser;
}

export async function touchUserLogin(userId) {
  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    return await touchCloudUserLogin(userId);
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    return null;
  }

  user.lastLoginAt = new Date().toISOString();
  user.updatedAt = user.lastLoginAt;
  await saveUsers(users);
  return user;
}

export async function updateUserProfile(userId, updates = {}) {
  const nextName = String(updates.name ?? '').trim();

  if (!nextName) {
    throw new Error('Informe seu nome.');
  }

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const user = await updateCloudUserProfile(userId, {
      name: nextName
    });

    if (!user) {
      throw new Error('Usuario nao encontrado.');
    }

    return user;
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuario nao encontrado.');
  }

  user.name = nextName;
  user.updatedAt = new Date().toISOString();
  await saveUsers(users);
  return user;
}

export async function updateUserPassword(userId, updates = {}) {
  const currentPassword = String(updates.currentPassword ?? '');
  const nextPassword = String(updates.nextPassword ?? '');
  const confirmPassword = String(updates.confirmPassword ?? '');

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const user = await findCloudUserById(userId);

    if (!user) {
      throw new Error('Usuario nao encontrado.');
    }

    if (!user.passwordHash) {
      throw new Error('Essa conta usa login externo e nao permite trocar senha por aqui.');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!isValid) {
      throw new Error('A senha atual esta incorreta.');
    }

    if (nextPassword.length < 8) {
      throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
    }

    if (nextPassword !== confirmPassword) {
      throw new Error('A confirmacao da nova senha nao confere.');
    }

    const updatedUser = await updateCloudUserPassword(userId, await bcrypt.hash(nextPassword, 10));

    if (!updatedUser) {
      throw new Error('Usuario nao encontrado.');
    }

    return updatedUser;
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuario nao encontrado.');
  }

  if (!user.passwordHash) {
    throw new Error('Essa conta usa login externo e nao permite trocar senha por aqui.');
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!isValid) {
    throw new Error('A senha atual esta incorreta.');
  }

  if (nextPassword.length < 8) {
    throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
  }

  if (nextPassword !== confirmPassword) {
    throw new Error('A confirmacao da nova senha nao confere.');
  }

  user.passwordHash = await bcrypt.hash(nextPassword, 10);
  user.updatedAt = new Date().toISOString();
  await saveUsers(users);
  return user;
}

export async function updateUserAvatar(userId, input = {}) {
  const dataUrl = String(input.avatarDataUrl ?? '').trim();
  const avatarMeta = inferAvatarMetaFromDataUrl(dataUrl);

  if (!avatarMeta) {
    throw new Error('Envie uma imagem PNG, JPG ou WEBP.');
  }

  const base64Payload = dataUrl.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const buffer = Buffer.from(base64Payload, 'base64');

  if (!buffer.length) {
    throw new Error('Nao foi possivel processar a imagem enviada.');
  }

  if (buffer.byteLength > 1024 * 1024) {
    throw new Error('A imagem deve ter no maximo 1 MB.');
  }

  if (isCloudAuthEnabled()) {
    await ensureCloudSeeded();
    const user = await findCloudUserById(userId);

    if (!user) {
      throw new Error('Usuario nao encontrado.');
    }

    if (user.googleId) {
      throw new Error('Contas conectadas com Google usam automaticamente a foto do perfil do Google.');
    }

    const updatedUser = await updateCloudUserAvatar(userId, {
      buffer,
      fileExt: avatarMeta.fileExt,
      mimeType: avatarMeta.mimeType
    });

    if (!updatedUser) {
      throw new Error('Usuario nao encontrado.');
    }

    return updatedUser;
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuario nao encontrado.');
  }

  if (user.googleId) {
    throw new Error('Contas conectadas com Google usam automaticamente a foto do perfil do Google.');
  }

  await fs.mkdir(avatarUploadsDir, { recursive: true });

  const previousAvatarPath = getAvatarFilePath(user);
  const nextAvatarPath = path.join(avatarUploadsDir, `${user.id}.${avatarMeta.fileExt}`);
  await fs.writeFile(nextAvatarPath, buffer);

  if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
    await fs.rm(previousAvatarPath, { force: true });
  }

  user.avatarStorage = 'upload';
  user.avatarFileExt = avatarMeta.fileExt;
  user.avatarUpdatedAt = new Date().toISOString();
  user.avatarUrl = resolveAvatarUrl({
    id: user.id,
    avatarStorage: user.avatarStorage,
    avatarFileExt: user.avatarFileExt,
    avatarUpdatedAt: user.avatarUpdatedAt,
    rawAvatarUrl: ''
  });
  user.updatedAt = user.avatarUpdatedAt;
  await saveUsers(users);
  return user;
}

export async function getUserAvatarFile(userId) {
  const user = await findUserById(userId);

  if (!user || user.avatarStorage !== 'upload' || !user.avatarFileExt || /^https?:\/\//i.test(user.avatarUrl || '')) {
    return null;
  }

  const filePath = getAvatarFilePath(user);
  const bytes = await fs.readFile(filePath);

  return {
    bytes,
    mimeType: `image/${user.avatarFileExt === 'jpg' ? 'jpeg' : user.avatarFileExt}`
  };
}

async function removeUserWorkspaceArtifacts(user) {
  const paths = getWorkspacePaths(user.id);
  const avatarFilePath = getAvatarFilePath(user);

  await Promise.all([
    avatarFilePath ? fs.rm(avatarFilePath, { force: true }).catch(() => {}) : Promise.resolve(),
    fs.rm(paths.workspaceDir, { recursive: true, force: true }).catch(() => {}),
    fs.rm(paths.authSessionDir, { recursive: true, force: true }).catch(() => {}),
    fs.rm(paths.previousAuthSessionDir, { recursive: true, force: true }).catch(() => {})
  ]);
}
