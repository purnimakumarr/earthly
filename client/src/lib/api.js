const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const send = async (method, path, body) => {
  const isForm = body instanceof FormData;

  try {
    return await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }
};

let refreshing;

// The access cookie lasts minutes; the refresh cookie renews it. Requests that
// fail at the same moment share one refresh call, because each refresh token
// only works once.
const renewSession = () => {
  refreshing ??= send('POST', '/auth/refresh')
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
};

// Thin wrapper over fetch. Sessions live in httpOnly cookies, so there is no
// token handling here beyond asking for a renewal when one has run out.
async function request(method, path, body) {
  let res = await send(method, path, body);

  if (res.status === 401 && !path.startsWith('/auth/') && (await renewSession())) {
    res = await send(method, path, body);
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
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
