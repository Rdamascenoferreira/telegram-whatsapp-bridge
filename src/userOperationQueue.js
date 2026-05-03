export class UserOperationQueue {
  constructor() {
    this.chains = new Map();
    this.activeOperations = new Map();
    this.queuedCounts = new Map();
  }

  async run(userId, operationName, task) {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedOperationName = String(operationName ?? 'operation').trim() || 'operation';

    if (!normalizedUserId) {
      return await task();
    }

    const previous = this.chains.get(normalizedUserId) ?? Promise.resolve();
    this.incrementQueued(normalizedUserId);

    const runPromise = previous
      .catch(() => undefined)
      .then(async () => {
        this.decrementQueued(normalizedUserId);
        this.activeOperations.set(normalizedUserId, {
          name: normalizedOperationName,
          startedAt: new Date().toISOString()
        });

        try {
          return await task();
        } finally {
          this.activeOperations.delete(normalizedUserId);
        }
      });

    const storedPromise = runPromise.catch(() => undefined);
    this.chains.set(normalizedUserId, storedPromise);
    storedPromise.finally(() => {
      if (this.chains.get(normalizedUserId) === storedPromise) {
        this.chains.delete(normalizedUserId);
      }
    });

    return await runPromise;
  }

  getSnapshot() {
    return {
      activeCount: this.activeOperations.size,
      queuedCount: [...this.queuedCounts.values()].reduce((total, count) => total + count, 0),
      active: [...this.activeOperations.entries()].map(([userId, operation]) => ({
        userId,
        ...operation
      }))
    };
  }

  incrementQueued(userId) {
    this.queuedCounts.set(userId, (this.queuedCounts.get(userId) ?? 0) + 1);
  }

  decrementQueued(userId) {
    const nextCount = Math.max(0, (this.queuedCounts.get(userId) ?? 0) - 1);

    if (nextCount === 0) {
      this.queuedCounts.delete(userId);
      return;
    }

    this.queuedCounts.set(userId, nextCount);
  }
}
