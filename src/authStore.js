import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve(process.cwd(), 'data');
const usersPath = path.join(dataDir, 'users.json');

async function loadUsers() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(usersPath, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));

    return Array.isArray(parsed.users) ? parsed.users : [];
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

export function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    providers: buildProviders(user),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
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
    throw new Error('Informe um email valido.');
  }

  if (normalizedPassword.length < 8) {
    throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  }

  const users = await loadUsers();
  const existingUser = users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    throw new Error('Ja existe uma conta com esse email.');
  }

  const now = new Date().toISOString();
  const nextUser = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(normalizedPassword, 10),
    googleId: '',
    avatarUrl: '',
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
    throw new Error('Nao foi possivel identificar a conta Google.');
  }

  if (!email) {
    throw new Error('Sua conta Google nao retornou um email valido.');
  }

  const users = await loadUsers();
  const now = new Date().toISOString();
  const existingByGoogle = users.find((user) => user.googleId === googleId);

  if (existingByGoogle) {
    existingByGoogle.name = name || existingByGoogle.name;
    existingByGoogle.email = email || existingByGoogle.email;
    existingByGoogle.avatarUrl = avatarUrl || existingByGoogle.avatarUrl;
    existingByGoogle.updatedAt = now;
    existingByGoogle.lastLoginAt = now;
    await saveUsers(users);
    return existingByGoogle;
  }

  const existingByEmail = users.find((user) => user.email === email);

  if (existingByEmail) {
    existingByEmail.googleId = googleId;
    existingByEmail.name = name || existingByEmail.name;
    existingByEmail.avatarUrl = avatarUrl || existingByEmail.avatarUrl;
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
