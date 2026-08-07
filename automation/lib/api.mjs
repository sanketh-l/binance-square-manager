const API_URL = process.env.API_URL || 'http://localhost:8787';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Token': BOT_TOKEN,
      ...(options.headers || {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) throw new Error(`API ${path} => ${res.status}: ${json.error || text}`);
  return json;
}

export async function fetchAccounts() {
  const { accounts } = await request('/api/accounts');
  return accounts;
}

export async function fetchDecryptedKey(accountId) {
  const { key } = await request('/api/accounts/key', { method: 'POST', body: { id: accountId } });
  return key;
}

export async function reportPost(record) {
  const body = {
    accountId: record.accountId,
    coin: record.coin,
    text: record.text,
    imageUrl: record.imageUrl,
    postUrl: record.postUrl,
    contentId: record.contentId,
    status: record.status,
    error: record.error,
    format: record.format,
    hook: record.hook,
    qualityScore: record.qualityScore,
    postedAt: new Date().toISOString()
  };
  const res = await request('/api/posts', { method: 'POST', body });
  return res;
}