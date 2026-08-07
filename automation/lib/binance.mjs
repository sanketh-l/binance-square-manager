import fs from 'fs';

const V1 = 'https://www.binance.com/bapi/composite/v1/public/pgc/openApi';
const V2 = 'https://www.binance.com/bapi/composite/v2/public/pgc/openApi';

async function api(endpoint, apiKey, body, baseUrl = V1) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'X-Square-OpenAPI-Key': apiKey,
      'Content-Type': 'application/json',
      clienttype: 'binanceSkill'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Non-JSON (${res.status}): ${text.substring(0, 150)}`);
  }
  if (json.code !== '000000') {
    throw new Error(`API [${json.code}]: ${json.message || json.messageDetail || JSON.stringify(json).substring(0, 100)}`);
  }
  return json.data;
}

export async function uploadImage(apiKey, imagePath) {
  const imageName = imagePath.split(/[/\\]/).pop();
  const { presignedUrl, fileTicket } = await api('/image/presignedUrl', apiKey, { imageName }, V2);
  if (!presignedUrl) throw new Error('No presignedUrl returned');
  const buf = fs.readFileSync(imagePath);
  const ext = imageName.split('.').pop().toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/png';
  const s3res = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: buf, signal: AbortSignal.timeout(30000) });
  if (!s3res.ok) throw new Error(`S3 upload failed: ${s3res.status}`);
  for (let i = 0; i < 15; i++) {
    const st = await api('/image/imageStatus', apiKey, { fileTicket }, V2);
    if (st.status === 1) return st.imageUrl;
    if (st.status === 2) throw new Error(`Processing failed: ${st.failedReason}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Upload timed out');
}

export async function publishPost(apiKey, text, imageUrl) {
  const body = { contentType: 1, bodyTextOnly: text };
  if (imageUrl) body.imageList = [imageUrl];
  const data = await api('/content/add', apiKey, body, V1);
  const id = data?.id || 'UNKNOWN';
  return {
    contentId: String(id),
    postUrl: id && id !== 'UNKNOWN' ? `https://www.binance.com/square/post/${id}` : 'N/A',
    publishedAt: new Date().toISOString()
  };
}