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

  getRuntimeSnapshots() {
    return [...this.runtimes.values()].map((runtime) => runtime.getSupervisorSnapshot?.()).filter(Boolean);
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

  async restartRuntimeForUserId(userId) {
    const normalizedUserId = String(userId ?? '').trim();

    if (!normalizedUserId) {
      throw new Error('Usuario invalido para reiniciar a sessao.');
    }

    await this.destroyRuntimeForUserId(normalizedUserId);
    return await this.getRuntimeForUserId(normalizedUserId);
  }
}
