export const BACKEND = import.meta.env.VITE_BACKEND_URL;
export const CONTRACT = import.meta.env.VITE_CONTRACT_ADDRESS;
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID);

async function req(path, init) {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  config: () => req('/api/config'),
  activity: (limit = 50) => req(`/api/activity?limit=${limit}`),
  tokenLimit: (token) => req(`/api/limit/${token}`),
  userAllowance: (address, token) => req(`/api/user/${address}/allowance/${token}`),
  userStatus: (address, token) => req(`/api/user/${address}/status/${token}`),
  approvedUsers: () => req('/api/admin/approved-users'),
  recordApproval: (data) =>
    req('/api/user/record-approval', { method: 'POST', body: JSON.stringify(data) }),
  recordConnect: (address) =>
    req('/api/user/record-connect', { method: 'POST', body: JSON.stringify({ address }) }),

  nonce: (address) =>
    req('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) }),
  verify: (address, signature) =>
    req('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature }) }),

  setDuration: (duration, token) =>
    req('/api/admin/duration', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ duration }),
    }),
  setLimit: (tokenAddress, limit, token) =>
    req('/api/admin/limit', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ token: tokenAddress, limit }),
    }),
  pull: (body, token) =>
    req('/api/admin/pull', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  txStatus: (hash, token) =>
    req(`/api/admin/tx/${hash}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
};
