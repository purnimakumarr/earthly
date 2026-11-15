const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Thin wrapper over fetch. The session lives in an httpOnly cookie, so there
// is no token handling here: the browser attaches it to same-origin requests.
async function request(method, path, body) {
  const isForm = body instanceof FormData;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(payload?.message || 'Something went wrong.', res.status);
  }

  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
