const TOKEN_KEY = 'sp_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(method, url, body, { raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData) && !raw) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });

  if (res.status === 401) {
    clearToken();
    if (!url.endsWith('/api/login')) {
      window.dispatchEvent(new CustomEvent('sp:unauthorized'));
    }
  }

  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const message = (data && data.error) || `请求失败（${res.status}）`;
    const error = new Error(message);
    error.status = res.status;
    error.code = data && data.code;
    throw error;
  }
  return data;
}

export const api = {
  login: (username, password) => request('POST', '/api/login', { username, password }),
  me: () => request('GET', '/api/me'),
  state: () => request('GET', '/api/state'),
  importSrt: (content) => request('POST', '/api/import', { content }),
  createProposal: (cueId, payload) => request('POST', `/api/cues/${cueId}/proposals`, payload),
  accept: (id) => request('POST', `/api/proposals/${id}/accept`, {}),
  reject: (id, reason) => request('POST', `/api/proposals/${id}/reject`, { reason }),
  async exportSrt() {
    const res = await fetch('/api/export', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && data.error) || '导出失败');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'accepted.srt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
};
