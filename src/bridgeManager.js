import { listWorkspaceUserIds } from './configStore.js';
import { UserBridgeRuntime } from './userBridgeRuntime.js';
import { UserOperationQueue } from './userOperationQueue.js';

export class BridgeManager {
  constructor() {
    this.runtimes = new Map();
    this.runtimePromises = new Map();
    this.operations = new UserOperationQueue();
  }

  async init() {
    const workspaceUserIds = await listWorkspaceUserIds();

    for (const userId of workspaceUserIds) {
      await this.getRuntimeForUserId(userId);
    }
  }

  async getRuntimeForUser(user) {
    return this.getRuntimeForUserId(user.id);
  }

  async runUserOperation(userId, operationName, task) {
    return await this.operations.run(userId, operationName, task);
  }

  getOperationsSnapshot() {
    return this.operations.getSnapshot();
  }

  async getRuntimeForUserId(userId) {
    const normalizedUserId = String(userId ?? '').trim();

    if (this.runtimes.has(normalizedUserId)) {
      return this.runtimes.get(normalizedUserId);
    }

    if (this.runtimePromises.has(normalizedUserId)) {
      return this.runtimePromises.get(normalizedUserId);
    }

    const runtimePromise = (async () => {
      const runtime = new UserBridgeRuntime({ userId: normalizedUserId });
      await runtime.init();
      this.runtimes.set(normalizedUserId, runtime);
      this.runtimePromises.delete(normalizedUserId);
      return runtime;
    })().catch((error) => {
      this.runtimePromises.delete(normalizedUserId);
      throw error;
    });

    this.runtimePromises.set(normalizedUserId, runtimePromise);
    return runtimePromise;
  }

  async destroyRuntimeForUserId(userId) {
    const normalizedUserId = String(userId ?? '').trim();
    const runtime = this.runtimes.get(normalizedUserId);

    this.runtimePromises.delete(normalizedUserId);

    if (!runtime) {
      this.runtimes.delete(normalizedUserId);
      return;
    }

    try {
      runtime.clearWhatsAppRestart?.();
      runtime.clearWhatsAppAutoReconnect?.();
      runtime.clearWhatsAppStartupWatchdog?.();
      await runtime.stopTelegramTransport?.();
      await runtime.stopWhatsAppClient?.();
    } finally {
      this.runtimes.delete(normalizedUserId);
    }
  }
}
