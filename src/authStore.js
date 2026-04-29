import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';

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
    const users = inputUsers.map((user, index) => normalizeStoredUser(user, index, inputUsers));

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

function normalizeStoredUser(user, index, users) {
  const normalizedEmail = normalizeEmail(user?.email);
  const normalizedRole = resolveUserRole(user?.role, normalizedEmail, index, users);
  const avatarStorage = normalizeAvatarStorage(user?.avatarStorage, Boolean(user?.googleId));
  const avatarFileExt = String(user?.avatarFileExt ?? '').trim().toLowerCase();
  const avatarUpdatedAt = user?.avatarUpdatedAt ? String(user.avatarUpdatedAt) : null;
  const rawAvatarUrl = String(user?.avatarUrl ?? '').trim();

  return {
    id: String(user?.id ?? crypto.randomUUID()),
    name: String(user?.name ?? '').trim() || normalizedEmail || 'Usuário sem nome',
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

function resolveUserRole(role, email, index, users) {
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
  if (avatarStorage === 'upload' && id && avatarFileExt) {
    return `/api/account/avatar/${encodeURIComponent(id)}?v=${encodeURIComponent(avatarUpdatedAt || '1')}`;
  }

  if (avatarStorage === 'google') {
    return rawAvatarUrl;
  }

  return '';
}

function inferAvatarFileExtFromDataUrl(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
  const subtype = match?.[1]?.toLowerCase();

  if (!subtype) {
    return '';
  }

  return subtype === 'jpeg' ? 'jpg' : subtype;
}

function getAvatarFilePath(user) {
  if (!user?.id || !user?.avatarFileExt) {
    return '';
  }

  return path.join(avatarUploadsDir, `${user.id}.${user.avatarFileExt}`);
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
  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  user.role = resolveUserRole(user.role, user.email, 0, users);
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

export async function findUserById(userId) {
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
    throw new Error('Informe um e-mail válido.');
  }

  if (normalizedPassword.length < 8) {
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }

  const users = await loadUsers();
  const existingUser = users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    throw new Error('Já existe uma conta com esse e-mail.');
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
    role: resolveUserRole('', normalizedEmail, users.length, users),
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
  const users = await loadUsers();
  const user = users.find((entry) => entry.email === normalizedEmail);

  if (!user?.passwordHash) {
    return null;
  }

  if (user.accountStatus === 'suspended') {
    throw new Error('Sua conta está suspensa no momento. Fale com o administrador.');
  }

  const isValid = await bcrypt.compare(candidatePassword, user.passwordHash);

  if (!isValid) {
    return null;
  }

  return touchUserLogin(user.id);
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
    throw new Error('Não foi possível identificar a conta Google.');
  }

  if (!email) {
    throw new Error('Sua conta Google não retornou um e-mail válido.');
  }

  const users = await loadUsers();
  const now = new Date().toISOString();
  const existingByGoogle = users.find((user) => user.googleId === googleId);

  if (existingByGoogle) {
    if (existingByGoogle.accountStatus === 'suspended') {
      throw new Error('Sua conta está suspensa no momento. Fale com o administrador.');
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
      throw new Error('Sua conta está suspensa no momento. Fale com o administrador.');
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
    role: resolveUserRole('', email, users.length, users),
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
  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  const nextName = String(updates.name ?? '').trim();

  if (!nextName) {
    throw new Error('Informe seu nome.');
  }

  user.name = nextName;
  user.updatedAt = new Date().toISOString();
  await saveUsers(users);
  return user;
}

export async function updateUserPassword(userId, updates = {}) {
  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  if (!user.passwordHash) {
    throw new Error('Essa conta usa login externo e não permite trocar senha por aqui.');
  }

  const currentPassword = String(updates.currentPassword ?? '');
  const nextPassword = String(updates.nextPassword ?? '');
  const confirmPassword = String(updates.confirmPassword ?? '');
  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!isValid) {
    throw new Error('A senha atual está incorreta.');
  }

  if (nextPassword.length < 8) {
    throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
  }

  if (nextPassword !== confirmPassword) {
    throw new Error('A confirmação da nova senha não confere.');
  }

  user.passwordHash = await bcrypt.hash(nextPassword, 10);
  user.updatedAt = new Date().toISOString();
  await saveUsers(users);
  return user;
}

export async function updateUserAvatar(userId, input = {}) {
  const users = await loadUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  if (user.googleId) {
    throw new Error('Contas conectadas com Google usam automaticamente a foto do perfil do Google.');
  }

  const dataUrl = String(input.avatarDataUrl ?? '').trim();
  const fileExt = inferAvatarFileExtFromDataUrl(dataUrl);

  if (!fileExt) {
    throw new Error('Envie uma imagem PNG, JPG ou WEBP.');
  }

  const base64Payload = dataUrl.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
  const buffer = Buffer.from(base64Payload, 'base64');

  if (!buffer.length) {
    throw new Error('Não foi possível processar a imagem enviada.');
  }

  if (buffer.byteLength > 1024 * 1024) {
    throw new Error('A imagem deve ter no máximo 1 MB.');
  }

  await fs.mkdir(avatarUploadsDir, { recursive: true });

  const previousAvatarPath = getAvatarFilePath(user);
  const nextAvatarPath = path.join(avatarUploadsDir, `${user.id}.${fileExt}`);
  await fs.writeFile(nextAvatarPath, buffer);

  if (previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
    await fs.rm(previousAvatarPath, { force: true });
  }

  user.avatarStorage = 'upload';
  user.avatarFileExt = fileExt;
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

  if (!user || user.avatarStorage !== 'upload' || !user.avatarFileExt) {
    return null;
  }

  const filePath = getAvatarFilePath(user);
  const bytes = await fs.readFile(filePath);

  return {
    bytes,
    mimeType: `image/${user.avatarFileExt === 'jpg' ? 'jpeg' : user.avatarFileExt}`
  };
}
