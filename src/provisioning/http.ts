// L9_META: layer=provisioning, role=http_guard, status=active, version=1.0.0

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ProvisioningHttpError extends Error {
  constructor(
    public readonly provider: 'github' | 'vercel',
    public readonly status: number,
    message: string,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'ProvisioningHttpError';
  }
}

export async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

export async function requestJson<T>(
  fetchImpl: FetchLike,
  provider: 'github' | 'vercel',
  url: string,
  init: RequestInit,
  expected: number[],
): Promise<{ status: number; body: T }> {
  const response = await fetchImpl(url, init);
  const body = await responseBody(response);
  if (!expected.includes(response.status)) {
    const detail = typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message?: unknown }).message)
      : typeof body === 'object' && body !== null && 'error' in body
        ? JSON.stringify((body as { error?: unknown }).error)
        : String(body ?? `HTTP ${response.status}`);
    throw new ProvisioningHttpError(provider, response.status, `${provider} request failed (${response.status}): ${detail}`, body);
  }
  return { status: response.status, body: body as T };
}
