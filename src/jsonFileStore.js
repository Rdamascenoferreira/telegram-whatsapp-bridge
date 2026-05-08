import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fileQueues = new Map();

export async function writeJsonFileAtomic(filePath, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextFileAtomic(filePath, payload);
}

export async function writeTextFileAtomic(filePath, payload) {
  await runFileOperation(filePath, async () => {
    const absolutePath = path.resolve(filePath);
    const directory = path.dirname(absolutePath);
    const basename = path.basename(absolutePath);
    const tempPath = path.join(directory, `.${basename}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;

    await fs.mkdir(directory, { recursive: true });

    try {
      handle = await fs.open(tempPath, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, absolutePath);
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }

      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function waitForFileOperations(filePath) {
  await runFileOperation(filePath, async () => {});
}

async function runFileOperation(filePath, task) {
  const key = path.resolve(filePath);
  const previous = fileQueues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate, () => gate);

  fileQueues.set(key, next);

  try {
    await previous.catch(() => {});
    return await task();
  } finally {
    release();

    if (fileQueues.get(key) === next) {
      fileQueues.delete(key);
    }
  }
}
