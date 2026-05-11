export class ApiRequestError extends Error {
  code?: string;
  fieldErrors?: Record<string, string>;

  constructor(message: string, options?: { code?: string; fieldErrors?: Record<string, string> }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options?.code;
    this.fieldErrors = options?.fieldErrors;
  }
}

type RequestJsonOptions = RequestInit & {
  timeoutMs?: number;
};

export const HTTP_TIMEOUT_MS = {
  FAST: 10_000,
  DEFAULT: 15_000,
  MEDIUM: 30_000,
  LONG: 180_000
} as const;

export async function requestJson<T>(url: string, options?: RequestJsonOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs ?? HTTP_TIMEOUT_MS.DEFAULT));
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(url, {
      credentials: 'include',
      ...fetchOptions,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A requisicao demorou demais para responder. Tente novamente.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiRequestError(payload?.error || 'Não foi possível concluir a ação.', {
      code: payload?.code,
      fieldErrors: payload?.fieldErrors
    });
  }

  return payload as T;
}

export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  return postJsonWithOptions<T>(url, body);
}

export async function postJsonWithOptions<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<RequestJsonOptions, 'method' | 'headers' | 'body'>
): Promise<T> {
  return requestJson<T>(url, {
    ...options,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
