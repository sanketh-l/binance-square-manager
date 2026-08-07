const enc = new TextEncoder();
const dec = new TextDecoder();

let cachedKey = null;

async function getAesKey(secret) {
  if (cachedKey) return cachedKey;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return cachedKey;
}

export async function encryptPlaintext(secret, plaintext) {
  const key = await getAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return JSON.stringify({ iv: ivB64, ct: ctB64 });
}

export async function decryptCipher(secret, cipherJson) {
  const key = await getAesKey(secret);
  const { iv, ct } = JSON.parse(cipherJson);
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctBytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ctBytes);
  return dec.decode(plain);
}