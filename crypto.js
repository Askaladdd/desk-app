/* Desk crypto helpers (shared by the app and the tests). AES-256-GCM; the key never leaves the phone. */
"use strict";
function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function bytesToB64u(b) {
  let s = ""; new Uint8Array(b).forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function keyFrom(text) { const m = /(?:^|[#&?])k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(text || ""); return m ? m[1] : null; }
async function cryptoKey(k, usage) { return crypto.subtle.importKey("raw", b64uToBytes(k), "AES-GCM", false, [usage]); }

async function gunzip(buf) {
  const ds = new DecompressionStream("gzip");
  return new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
}
async function decryptEnvelope(env, k) {
  const key = await cryptoKey(k, "decrypt");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64uToBytes(env.iv), additionalData: new TextEncoder().encode("desk-state-v1") }, key, b64uToBytes(env.ct));
  const raw = env.alg && env.alg.includes("gzip") ? await gunzip(pt) : pt;
  return JSON.parse(new TextDecoder().decode(raw));
}
async function encryptCompact(obj, k) {
  const key = await cryptoKey(k, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("desk-websub-v1") }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return bytesToB64u(out);
}

if (typeof module !== "undefined") module.exports = { b64uToBytes, bytesToB64u, keyFrom, decryptEnvelope, encryptCompact };
