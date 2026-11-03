/* Desk PWA. Read-only view of the desk's encrypted state. The AES key lives only in this phone's localStorage
   (it arrives in the #fragment of the link the desk sent on Telegram, which browsers never send to servers).
   FOMO links are used exactly as the desk built them (links.py); this file never builds or rewrites one. */
"use strict";
const CFG = window.DESK_CONFIG || {};
const KEY_LS = "desk_key_v1";
const POLL_MS = 60000;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let STATE = null, TAB = "desk", ETAG = null, RAW_UNTIL = 0, LAST_FETCH = 0, ERR = null;

// ---------- key ----------
function getKey() {
  const k = keyFrom(location.hash);
  if (k) localStorage.setItem(KEY_LS, k);     // the #k= stays in the address bar so Add to Home Screen keeps it
  return localStorage.getItem(KEY_LS);
}
// ---------- data ----------
function sources() {
  if (CFG.dataUrls) return CFG.dataUrls.map((u) => ({ url: u, raw: true }));
  const api = { url: `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}?ref=${CFG.branch}`, api: true };
  const raw = { url: `https://raw.githubusercontent.com/${CFG.owner}/${CFG.repo}/${CFG.branch}/${CFG.path}`, raw: true };
  return Date.now() < RAW_UNTIL ? [raw] : [api, raw];
}
async function fetchEnvelope() {
  let lastErr = null;
  for (const s of sources()) {
    try {
      const h = s.api ? { Accept: "application/vnd.github.raw+json" } : {};
      if (s.api && ETAG) h["If-None-Match"] = ETAG;
      const url = s.raw ? s.url + (s.url.includes("?") ? "&" : "?") + "t=" + Date.now() : s.url;
      const r = await fetch(url, { headers: h, cache: "no-store", referrerPolicy: "no-referrer" });
      if (s.api) {
        const rem = Number(r.headers.get("x-ratelimit-remaining"));
        if (r.status === 403 || r.status === 429 || (!isNaN(rem) && rem < 3)) RAW_UNTIL = Date.now() + 15 * 60000;
        if (r.status === 304) return null;
        if (r.ok) ETAG = r.headers.get("etag");
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no data source");
}
async function refresh(force) {
  const k = getKey();
  if (!k) return renderNoKey();
  if (!force && Date.now() - LAST_FETCH < 5000) return;
  LAST_FETCH = Date.now();
  try {
    const env = await fetchEnvelope();
    if (env) {
      try { STATE = await decryptEnvelope(env, k); ERR = null; }
      catch (_) { ERR = "key"; }
    }
  } catch (e) { ERR = STATE ? "offline" : "fetch"; }
  render();
}

// ---------- formatting ----------
const money = (v, sign) => v == null ? "–" : (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2);
const pct = (v, sign = true) => v == null ? "–" : (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1) + "%";
const cls = (v) => v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "";
const price = (v) => v == null ? "–" : Number(v).toPrecision(5).replace(/\.?0+$/, "");
const hm = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–";
const dhm = (ts) => ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
function ago(s) { s = Math.max(0, Math.round(s)); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : Math.round(s / 3600) + "h"; }
function tg(text) { return `https://t.me/${encodeURIComponent(STATE.bot)}?text=${encodeURIComponent(text)}`; }
function coinLink(it, label) { return it && it.url ? `<a class="btn sm" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(label)}</a>` : ""; }
function setDisp(key, v) {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (key === "risk.stop_pct") return "−" + v + "%";
  if (/_pct(_h1)?$/.test(key)) return v + "%";
  if (/_usd$|_stack$/.test(key) || key === "analyst.alive_volume_h1") return "$" + Number(v).toLocaleString();
  return String(v);
}

// ---------- views ----------
function spark(series) {
  if (!series || series.length < 2) return "";
  const ys = series.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), w = 340, h = 56, span = hi - lo || 1;
  const pts = series.map((p, i) => `${(i / (series.length - 1) * w).toFixed(1)},${(h - 4 - (p[1] - lo) / span * (h - 8)).toFixed(1)}`).join(" ");
  const up = ys[ys.length - 1] >= ys[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" class="${up ? "up" : "down"}"/></svg>`;
}
function viewDesk(s) {
  const names = [...s.agents, "telegram", "desk"];
  const chips = names.map((n) => {
    const a = s.heartbeats[n], paused = s.paused.includes(n);
    const st = paused ? "paused" : a == null ? "bad" : a < 60 ? "ok" : a < 120 ? "warn" : "bad";
    return `<div class="chip ${st}"><i></i>${esc(n)}<small>${paused ? "paused" : a == null ? "–" : ago(a)}</small></div>`;
  }).join("");
  const hr = s.hour;
  return `
  <section class="card hero">
    <div class="label">${esc(s.mode)} balance</div>
    <div class="big">${money(s.balance)}</div>
    <div class="row"><span>Free ${money(s.free)}</span><span class="${cls(s.pnl_session)}">Tonight ${money(s.pnl_session, true)}</span></div>
    ${spark(s.balance_series)}
    <div class="row muted"><span>${s.trades_session} trade${s.trades_session === 1 ? "" : "s"} tonight · ${s.wins_session} won</span><span>${s.positions.length} open</span></div>
  </section>
  <section class="card">
    <h3>Last hour</h3>
    <div class="funnel">
      <div><b>${hr.migrations}</b><span>new coins</span></div>
      <div><b>${hr.scans}</b><span>scans</span></div>
      <div><b>${hr.scan_passes}</b><span>scanner ✓</span></div>
      <div><b>${hr.audit_passes}</b><span>auditor ✓</span></div>
    </div>
    <div class="row muted"><span>Waiting room ${s.waiting_room}</span><span>${hr.rejects} rejected</span></div>
  </section>
  <section class="card">
    <h3>Agents <span class="muted small">${s.ws_connected ? "PumpPortal connected" : "PumpPortal down"}</span></h3>
    <div class="chips">${chips}</div>
    <div class="row muted small"><span>Loop lag max ${s.loop_lag_max_s == null ? "–" : s.loop_lag_max_s.toFixed(2) + "s"}</span><span>${s.push_subs} phone${s.push_subs === 1 ? "" : "s"} with alerts</span></div>
  </section>
  <section class="actions">
    <a class="btn" href="${tg("status")}">Status in Telegram</a>
    <a class="btn ghost" href="${tg("report")}">Last report</a>
    <button class="btn ghost" id="notif">${s.push_subs ? "Re-enable notifications" : "Enable notifications"}</button>
  </section>`;
}
function viewPositions(s) {
  if (!s.positions.length) return `<div class="empty">No open positions.<br><span class="muted">When the desk buys, it shows up here with a Sell on FOMO button.</span></div>`;
  return s.positions.map((p) => `
  <section class="card pos">
    <div class="row"><b class="coin">${esc(p.label)}</b><span class="pill ${cls(p.chg_pct)}">${pct(p.chg_pct)}</span></div>
    <div class="grid">
      <div><span>Size</span>${money(p.size)}</div><div><span>Entry</span>${price(p.entry)}</div>
      <div><span>Last</span>${price(p.last)}</div><div><span>Stop</span>−${p.stop_pct}%${p.trail ? " · trail" : ""}</div>
    </div>
    <div class="row muted small"><span>Opened ${hm(p.opened_at)} · ${esc(p.mode)}</span><span>${p.last_ts ? "priced " + ago(s.ts - p.last_ts) + " ago" : ""}</span></div>
    <div class="row gap">${coinLink(p, "Sell on FOMO")}<a class="btn sm ghost" href="${tg("why " + p.mint)}">Why?</a></div>
  </section>`).join("");
}
function viewTrades(s) {
  const tot = s.trades.reduce((a, t) => a + (t.pnl || 0), 0);
  const head = `<section class="card"><div class="row"><span>Last ${s.trades.length} closed</span><b class="${cls(tot)}">${money(tot, true)}</b></div><div class="muted small">P&amp;L after fees</div></section>`;
  if (!s.trades.length) return head + `<div class="empty">No closed trades yet.</div>`;
  return head + s.trades.map((t) => `
  <section class="card trade">
    <div class="row"><b class="coin">${esc(t.label)}</b><b class="${cls(t.pnl)}">${money(t.pnl, true)} <small>${pct(t.pnl_pct)}</small></b></div>
    <div class="row muted small"><span>${price(t.entry)} → ${price(t.exit)} · ${esc(t.reason || "")}</span><span>${dhm(t.closed_at)}</span></div>
    <div class="row muted small"><span>${money(t.size)} · fees ${money(t.fees)}</span>${coinLink(t, "View on FOMO")}</div>
  </section>`).join("");
}
const KIND = { reject: "✕", scan_pass: "✓", audit_pass: "✓✓", migration: "＋", drop: "–", signal: "$", buy: "$", sell: "↓" };
function viewFeed(s) {
  if (!s.activity.length) return `<div class="empty">Nothing yet.</div>`;
  return `<section class="card feed">` + s.activity.map((a) => `
    <div class="item k-${esc(a.kind)}">
      <div class="ico">${esc(KIND[a.kind] || "•")}</div>
      <div class="txt"><div>${esc(a.title)}</div><div class="muted small">${esc(a.sub)}</div></div>
      <div class="meta"><span class="muted small">${hm(a.ts)}</span>${a.url ? `<a class="lnk" href="${esc(a.url)}" target="_blank" rel="noopener">FOMO</a>` : ""}</div>
    </div>`).join("") + `</section>`;
}
function viewSettings(s) {
  const groups = {};
  s.settings.forEach((x) => { const g = x.key.split(".")[0]; (groups[g] = groups[g] || []).push(x); });
  const rows = Object.entries(groups).map(([g, xs]) => `
    <section class="card"><h3>${esc(g[0].toUpperCase() + g.slice(1))}</h3>
    ${xs.map((x) => {
      const name = s.aliases[x.key] || x.key;
      const ro = x.key === "desk.mode";
      return `<a class="set" ${ro ? "" : `href="${tg("set " + name + " to ")}"`}><span>${esc(x.key.split(".")[1].replace(/_/g, " "))}</span><b>${esc(setDisp(x.key, x.value))}</b>${ro ? "" : "<i>›</i>"}</a>`;
    }).join("")}</section>`).join("");
  const agents = s.agents.map((a) => {
    const p = s.paused.includes(a);
    return `<a class="btn sm ${p ? "" : "ghost"}" href="${tg((p ? "resume " : "pause ") + a)}">${p ? "Resume" : "Pause"} ${esc(a)}</a>`;
  }).join("");
  return `
  <section class="card"><h3>How changes work</h3><div class="muted small">Tap a setting: Telegram opens with the command typed for you. Add the new value and send. The desk replies and this app updates within a minute. Mode stays ${esc(s.mode)}.</div></section>
  <section class="card"><h3>Agents</h3><div class="row wrap gap">${agents}</div></section>
  ${rows}
  <section class="card"><h3>FOMO</h3><div class="row wrap gap"><a class="btn sm ghost" href="${esc(s.links.profile)}" target="_blank" rel="noopener">My FOMO profile</a><a class="btn sm ghost" href="${esc(s.links.signup)}" target="_blank" rel="noopener">Invite link</a></div></section>
  <section class="card"><h3>This phone</h3><div class="row wrap gap"><button class="btn sm ghost" id="notif">Enable notifications</button><button class="btn sm danger" id="forget">Forget key</button></div></section>`;
}
function renderNoKey() {
  $("#tabs").hidden = true; $("#mode").textContent = "locked"; $("#age").textContent = "";
  $("#view").innerHTML = `
  <section class="card lock"><div class="big">🔒</div><h3>Open your link from Telegram</h3>
  <p class="muted">This app only works with the private link the desk sent you on Telegram. If you opened Desk from the Home Screen and see this, copy that link (long-press it in Telegram → Copy) and paste it here.</p>
  <input id="paste" placeholder="Paste the link here" autocomplete="off" autocapitalize="off" spellcheck="false">
  <button class="btn" id="usekey">Unlock</button><p id="pmsg" class="muted small"></p></section>`;
  $("#usekey").onclick = () => {
    const k = keyFrom($("#paste").value);
    if (!k) { $("#pmsg").textContent = "That isn't the desk link."; return; }
    localStorage.setItem(KEY_LS, k); refresh(true);
  };
}
function render() {
  if (!STATE) {
    $("#tabs").hidden = true;
    $("#view").innerHTML = ERR === "key"
      ? `<section class="card lock"><h3>Key doesn't match</h3><p class="muted">Open the newest link from Telegram (send <b>app</b> to the bot to get it again).</p><button class="btn danger" id="forget">Forget key</button></section>`
      : ERR ? `<section class="card lock"><h3>Can't reach the desk data</h3><p class="muted">Check your connection. Retrying every minute.</p></section>` : `<div class="center muted">Loading…</div>`;
    bind(); return;
  }
  const s = STATE;
  $("#tabs").hidden = false;
  $("#mode").textContent = s.mode; $("#mode").className = "badge " + (s.mode === "PAPER" ? "paper" : "live");
  const age = Date.now() / 1000 - s.ts;
  $("#age").innerHTML = `<span class="${age > 300 ? "stale" : ""}">${ERR === "offline" ? "offline · " : ""}updated ${ago(age)} ago</span>`;
  const v = { desk: viewDesk, positions: viewPositions, trades: viewTrades, feed: viewFeed, settings: viewSettings }[TAB];
  $("#view").innerHTML = (age > 300 ? `<div class="banner">The desk hasn't published for ${ago(age)}. It may be paused or offline.</div>` : "") + v(s);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === TAB));
  bind();
}
function bind() {
  const n = document.querySelectorAll("#notif"); n.forEach((b) => (b.onclick = enableNotifications));
  const f = $("#forget"); if (f) f.onclick = () => { if (confirm("Remove the key from this phone?")) { localStorage.removeItem(KEY_LS); STATE = null; history.replaceState(null, "", location.pathname); renderNoKey(); } };
}

// ---------- notifications (iOS 16.4+: only from the Home Screen app) ----------
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
async function enableNotifications() {
  const box = document.createElement("section"); box.className = "card notice";
  const show = (html) => { box.innerHTML = html; $("#view").prepend(box); window.scrollTo(0, 0); };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !standalone()) {
    return show(`<h3>Add Desk to your Home Screen first</h3><p class="muted">iPhone only allows notifications for web apps opened from the Home Screen: in Safari tap Share → Add to Home Screen, then open Desk from there and tap this again.</p>`);
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return show(`<h3>Notifications are blocked</h3><p class="muted">Settings → Notifications → Desk → Allow Notifications, then try again.</p>`);
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(STATE.vapid_public) });
    const j = sub.toJSON();
    const code = await encryptCompact({ endpoint: j.endpoint, keys: j.keys, device: (navigator.platform || "phone") }, getKey());
    const text = "websub " + code;
    show(`<h3>One more tap</h3><p class="muted">Telegram is opening with a message for your desk. Tap <b>Send</b>. The desk replies and sends a test notification.</p>
      <a class="btn" href="${tg(text)}">Open Telegram</a>
      <details><summary class="muted small">Telegram didn't open?</summary><p class="muted small">Copy this and send it to @${esc(STATE.bot)}:</p><textarea readonly rows="4">${esc(text)}</textarea><button class="btn sm ghost" id="cp">Copy</button></details>`);
    const cp = $("#cp"); if (cp) cp.onclick = () => navigator.clipboard.writeText(text).then(() => (cp.textContent = "Copied"));
    location.href = tg(text);
  } catch (e) {
    show(`<h3>Couldn't turn on notifications</h3><p class="muted">${esc(e && e.message || e)}</p>`);
  }
}

// ---------- boot ----------
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { TAB = b.dataset.tab; render(); window.scrollTo(0, 0); }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
if (CFG.tab) TAB = CFG.tab;
const t = /[#&]tab=(\w+)/.exec(location.hash); if (t) TAB = t[1];
refresh(true);
setInterval(() => { if (document.visibilityState === "visible") refresh(true); }, POLL_MS);
