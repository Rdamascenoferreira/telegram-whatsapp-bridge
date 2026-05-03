const defaultDelayMs = Number(process.env.WHATSAPP_DELIVERY_DELAY_MS ?? 2200);
const defaultRetryLimit = Number(process.env.WHATSAPP_DELIVERY_RETRY_LIMIT ?? 3);
const defaultRetryBaseDelayMs = Number(process.env.WHATSAPP_DELIVERY_RETRY_BASE_DELAY_MS ?? 1200);
const defaultMaxQueuedJobs = Number(process.env.WHATSAPP_DELIVERY_MAX_QUEUED_JOBS ?? 120);

export class WhatsAppDeliveryQueue {
  constructor(options = {}) {
    this.userId = String(options.userId ?? '').trim();
    this.delayMs = normalizePositiveNumber(options.delayMs, defaultDelayMs);
    this.retryLimit = normalizePositiveNumber(options.retryLimit, defaultRetryLimit);
    this.retryBaseDelayMs = normalizePositiveNumber(options.retryBaseDelayMs, defaultRetryBaseDelayMs);
    this.maxQueuedJobs = normalizePositiveNumber(options.maxQueuedJobs, defaultMaxQueuedJobs);
    this.chain = Promise.resolve();
    this.activeJob = null;
    this.queuedCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.lastCompletedAt = null;
    this.lastFailedAt = null;
    this.lastError = null;
  }

  async enqueue(jobName, task) {
    const normalizedJobName = String(jobName ?? 'whatsapp-delivery').trim() || 'whatsapp-delivery';

    if (this.queuedCount >= this.maxQueuedJobs) {
      throw new Error('Fila de envio do WhatsApp cheia. Aguarde as entregas atuais terminarem.');
    }

    this.queuedCount += 1;
    const previous = this.chain;

    const runPromise = previous
      .catch(() => undefined)
      .then(async () => {
        this.queuedCount = Math.max(0, this.queuedCount - 1);
        this.activeJob = {
          name: normalizedJobName,
          startedAt: new Date().toISOString()
        };

        try {
          const result = await task({
            sendWithRetry: this.sendWithRetry.bind(this),
            waitBetweenDeliveries: this.waitBetweenDeliveries.bind(this)
          });
          this.completedCount += 1;
          this.lastCompletedAt = new Date().toISOString();
          this.lastError = null;
          return result;
        } catch (error) {
          this.failedCount += 1;
          this.lastFailedAt = new Date().toISOString();
          this.lastError = error?.message || 'Falha desconhecida na fila de envio';
          throw error;
        } finally {
          this.activeJob = null;
        }
      });

    this.chain = runPromise.catch(() => undefined);
    return await runPromise;
  }

  async sendWithRetry(send, options = {}) {
    const retryLimit = normalizePositiveNumber(options.retryLimit, this.retryLimit);
    let lastError = null;

    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      try {
        await send(attempt);
        return { ok: true, attempt };
      } catch (error) {
        lastError = error;

        if (attempt < retryLimit) {
          await wait(this.retryBaseDelayMs * attempt);
        }
      }
    }

    return {
      ok: false,
      attempt: retryLimit,
      error: lastError?.message || 'Falha desconhecida no envio'
    };
  }

  async waitBetweenDeliveries() {
    await wait(this.delayMs);
  }

  getSnapshot() {
    return {
      active: Boolean(this.activeJob),
      activeJob: this.activeJob,
      queuedCount: this.queuedCount,
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      delayMs: this.delayMs,
      retryLimit: this.retryLimit,
      maxQueuedJobs: this.maxQueuedJobs,
      lastCompletedAt: this.lastCompletedAt,
      lastFailedAt: this.lastFailedAt,
      lastError: this.lastError
    };
  }
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.round(number);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
