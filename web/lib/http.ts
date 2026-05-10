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

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  let response: Response;

  try {
    response = await fetch(url, {
      credentials: 'include',
      ...options,
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
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
