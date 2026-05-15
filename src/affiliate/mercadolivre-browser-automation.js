import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultWorkerScriptPath = path.resolve(currentDir, '..', '..', 'scripts', 'mercadolivre_affiliate_worker.py');
const defaultSessionDir = path.resolve(process.cwd(), 'data', 'mercadolivre-sessions');
const defaultTimeoutMs = 45_000;

export function isMercadoLivreBrowserAutomationEnabled() {
  return parseBoolean(process.env.MERCADOLIVRE_BROWSER_AUTOMATION_ENABLED, false);
}

export function getMercadoLivreStorageStatePath(userId) {
  const baseDir = path.resolve(process.env.MERCADOLIVRE_SESSION_DIR || defaultSessionDir);
  const safeUserId = sanitizePathSegment(userId);
  const targetPath = path.resolve(baseDir, `${safeUserId}.json`);

  if (!isPathInside(targetPath, baseDir)) {
    throw new Error('Invalid Mercado Livre session path');
  }

  return targetPath;
}

export async function hasMercadoLivreStorageState(userId) {
  return await pathExists(getMercadoLivreStorageStatePath(userId));
}

export async function generateMercadoLivreAffiliateUrlWithPython(params = {}) {
  if (!isMercadoLivreBrowserAutomationEnabled()) {
    return {
      success: false,
      error: 'Mercado Livre browser automation disabled'
    };
  }

  const url = String(params.url ?? '').trim();
  const userId = String(params.userId ?? '').trim();
  const storageStatePath = String(params.storageStatePath || getMercadoLivreStorageStatePath(userId)).trim();

  if (!url) {
    return {
      success: false,
      error: 'Mercado Livre URL is empty'
    };
  }

  if (!userId) {
    return {
      success: false,
      error: 'Mercado Livre user id is empty'
    };
  }

  if (!(await pathExists(storageStatePath))) {
    return {
      success: false,
      error: 'Mercado Livre session is not configured for this user'
    };
  }

  const workerScriptPath = path.resolve(process.env.MERCADOLIVRE_WORKER_SCRIPT || defaultWorkerScriptPath);
  if (!(await pathExists(workerScriptPath))) {
    return {
      success: false,
      error: 'Mercado Livre Python worker script not found'
    };
  }

  const timeoutMs = parseInteger(params.timeoutMs || process.env.MERCADOLIVRE_BROWSER_TIMEOUT_MS, defaultTimeoutMs);
  const command = String(process.env.MERCADOLIVRE_PYTHON_COMMAND || process.env.PYTHON || 'python').trim();
  const args = [
    workerScriptPath,
    'generate',
    '--url',
    url,
    '--storage-state',
    storageStatePath,
    '--label',
    String(params.label ?? '').trim(),
    '--headless',
    parseBoolean(process.env.MERCADOLIVRE_BROWSER_HEADLESS, true) ? '1' : '0'
  ];

  return await runPythonJson(command, args, timeoutMs);
}

async function runPythonJson(command, args, timeoutMs) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: safeErrorText(error.message || 'Mercado Livre Python worker failed to start')
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          success: false,
          error: `Mercado Livre browser automation timed out after ${timeoutMs}ms`
        });
        return;
      }

      const parsed = parseJsonOutput(stdout);
      if (parsed) {
        resolve({
          ...parsed,
          source: parsed.source || 'browser_automation'
        });
        return;
      }

      resolve({
        success: false,
        error: safeErrorText(stderr || stdout || `Mercado Livre Python worker exited with ${code}`)
      });
    });
  });
}

function parseJsonOutput(value) {
  const lines = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {}
  }

  return null;
}

async function pathExists(targetPath) {
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

function sanitizePathSegment(value) {
  const normalized = String(value ?? '').trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 120);
  return normalized || 'anonymous';
}

function isPathInside(targetPath, parentDir) {
  const resolvedTarget = path.resolve(targetPath).toLowerCase();
  const resolvedParent = path.resolve(parentDir).toLowerCase();
  return resolvedTarget === resolvedParent || resolvedTarget.startsWith(`${resolvedParent}${path.sep}`);
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseInteger(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function safeErrorText(value) {
  return String(value ?? '').trim().replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 500);
}
