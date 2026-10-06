// 极简 API 客户端：token 存 localStorage，401 时清空登录态。

const TOKEN_KEY = 'srt-review-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, { body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = form; // FormData：浏览器自动加 multipart 边界
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401 && path !== '/api/auth/login') {
    clearToken();
    window.dispatchEvent(new Event('auth:expired'));
  }

  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && data.error) || `请求失败（HTTP ${res.status}）`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) =>
    request('POST', '/api/auth/login', { body: { username, password } }),
  list: () => request('GET', '/api/subtitles'),
  importSrt: (formData) => request('POST', '/api/subtitles/import', { form: formData }),
  exportUrl: () => '/api/subtitles/export.srt',
  propose: (id, patch) => request('POST', `/api/subtitles/${id}/proposals`, { body: patch }),
  accept: (id) => request('POST', `/api/proposals/${id}/accept`),
  reject: (id, reason) => request('POST', `/api/proposals/${id}/reject`, { body: { reason } }),
};

// 带鉴权头的 SRT 下载（fetch 拿到 blob，触发浏览器保存）。
export async function downloadAcceptedSrt() {
  const res = await fetch(api.exportUrl(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `导出失败（HTTP ${res.status}）`);
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
