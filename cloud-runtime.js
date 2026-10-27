/* ديوان القضايا — النسخة السحابية (Supabase)
   يقدّم للصفحة الواجهة نفسها التي تقدّمها claude.ai (window.claude.use: db وuser وassets وsample) فوق Supabase:
   قاعدة Postgres بجدول واحد للوثائق (مسار لكل وثيقة) وصلاحيات تُفرض في القاعدة نفسها (RLS)، ودخول ببريد وكلمة مرور ورمز تحقق،
   وتحديث فوري عبر Realtime، والملفات المرفوعة في Storage، والمساعد عبر دالة على الخادم (مفتاح Anthropic لا يصل إلى المتصفح).
   يحتاج قبله: supabase.js (UMD) وwindow.__DIWAN_CLOUD = {url, key}. الصفحة نفسها لا تتغير. */
(() => {
  "use strict";
  const CFG = window.__DIWAN_CLOUD || {};
  const sb = window.supabase.createClient(CFG.url, CFG.key, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "diwan.cloud.auth"}});
  const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const T = "docs";
  const parentOf = (p) => p.replace(/\/[^/]*$/, "");
  const idOf = (p) => p.replace(/^.*\//, "");
  const STAFF = "office/staff";

  // ---------------------------------------------------------------- errors in the page's vocabulary
  function err(e){
    if (e && e.code && /^[a-z_]+$/.test(e.code)) return e;
    const c = String(e?.code || ""), m = String(e?.message || e || "");
    const code = c === "42501" || /row-level security|permission denied/i.test(m) ? "permission_denied"
      : c === "P0002" || /not_found/.test(m) ? "not_found"
      : c === "54000" || /too large|payload/i.test(m) ? "too_large"
      : /fetch|network|Failed to fetch|timeout/i.test(m) ? "unavailable" : "unavailable";
    return {code, message: m};
  }

  // ---------------------------------------------------------------- the database («db»)
  const cache = new Map();           // path → data, for every document fetched or watched
  const subs = [];                   // {kind:"doc"|"coll", path, f, filt, lim}
  const snapDoc = (path) => { const v = cache.get(path); return {id: idOf(path), exists: v !== undefined, data: () => clone(v), metadata: {}}; };
  const collDocs = (c) => [...cache.keys()].filter(k => parentOf(k) === c && k !== c).sort((a, b) => idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0).map(snapDoc);
  function emit(path){ const par = parentOf(path); for (const s of [...subs]) if ((s.kind === "doc" && s.path === path) || (s.kind === "coll" && s.path === par)) { try { s.f(); } catch {} } }

  async function fetchDoc(path){
    if (path === STAFF) { const {data, error} = await sb.rpc("staff_doc"); if (error) throw err(error); if (data) cache.set(path, data); else cache.delete(path); return; }
    const {data, error} = await sb.from(T).select("path,data").eq("path", path).maybeSingle();
    if (error) throw err(error);
    if (data) cache.set(path, data.data); else cache.delete(path);
  }
  async function fetchColl(c, filt = [], lim = 0){
    const out = []; const PAGE = 500;
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(T).select("path,data").eq("parent", c);
      for (const [f, op, v] of filt) if (op === "==" && ["string", "number", "boolean"].includes(typeof v)) q = q.eq("data->>" + f, String(v));
      q = q.order("id").range(from, from + PAGE - 1);
      const {data, error} = await q; if (error) throw err(error);
      out.push(...data); if (data.length < PAGE || (lim && out.length >= lim)) break;
    }
    return out;
  }
  const match = (filt) => (s) => filt.every(([f, op, v]) => { const x = s.data()?.[f]; return op === "==" ? x === v : op === "!=" ? x !== v : op === "in" ? (v || []).includes(x) : op === ">=" ? x >= v : op === "<=" ? x <= v : true; });

  // changes from other people arrive by Realtime; the document is read again (the reader's rights apply, and big rows are not cut)
  const pending = new Set(); let flushT = null;
  function changed(path){ if (!subs.some(s => (s.kind === "doc" && s.path === path) || (s.kind === "coll" && s.path === parentOf(path)))) { cache.delete(path); return; } pending.add(path); clearTimeout(flushT); flushT = setTimeout(flush, 120); }
  async function flush(){
    const paths = [...pending]; pending.clear();
    if (paths.includes(STAFF)) { try { await fetchDoc(STAFF); } catch {} emit(STAFF); }
    const rest = paths.filter(p => p !== STAFF);
    for (let i = 0; i < rest.length; i += 100) {
      const chunk = rest.slice(i, i + 100);
      const {data, error} = await sb.from(T).select("path,data").in("path", chunk);
      if (error) continue;
      const got = new Map(data.map(r => [r.path, r.data]));
      for (const p of chunk) { if (got.has(p)) cache.set(p, got.get(p)); else cache.delete(p); emit(p); }
    }
  }
  async function resyncAll(){
    for (const s of [...subs]) {
      try { if (s.kind === "doc") await fetchDoc(s.path);
        else { const rows = await fetchColl(s.path); const keep = new Set(rows.map(r => r.path)); for (const k of [...cache.keys()]) if (parentOf(k) === s.path && !keep.has(k)) cache.delete(k); for (const r of rows) cache.set(r.path, r.data); }
        s.f(); } catch {}
    }
  }
  let channel = null, wasDown = false;
  function listen(){
    channel = sb.channel("diwan-docs").on("postgres_changes", {event: "*", schema: "public", table: T}, (pl) => { const p = pl.new?.path || pl.old?.path; if (p) changed(p); })
      .subscribe((st) => { if (st === "SUBSCRIBED") { if (wasDown) { wasDown = false; resyncAll(); } } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") wasDown = true; });
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wasDown) { wasDown = false; resyncAll(); } });

  const unsub = (f) => () => { const i = subs.findIndex(s => s.f === f); if (i >= 0) subs.splice(i, 1); };
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const db = {
    doc(path){ return {
      get: async () => { await fetchDoc(path); return snapDoc(path); },
      set: async (d) => { const data = clone(d) || {}; const {error} = await sb.from(T).upsert({path, data}, {onConflict: "path"}); if (error) throw err(error); cache.set(path, data); emit(path); },
      update: async (p) => { const patch = clone(p) || {}; const {error} = await sb.rpc("doc_update", {p_path: path, p_patch: patch}); if (error) throw err(error);
        if (cache.has(path) && path !== STAFF) cache.set(path, {...cache.get(path), ...patch}); else await fetchDoc(path).catch(() => {}); emit(path); },
      delete: async () => { const {error} = await sb.from(T).delete().eq("path", path); if (error) throw err(error); cache.delete(path); emit(path); },
      onSnapshot(cb, onErr){ const f = () => cb(snapDoc(path)); subs.push({kind: "doc", path, f});
        // office/staff was read at sign-in: hand it over at once, so the page knows the viewer's role before the cases arrive
        if (path === STAFF && staffAtBoot) { staffAtBoot = false; setTimeout(f, 0); return unsub(f); }
        fetchDoc(path).then(f, (e) => { if (onErr) onErr(err(e)); else f(); }); return unsub(f); },
      collection: (c) => db.collection(path + "/" + c) }; },
    collection(c){ const filt = []; let lim = 0;
      const apply = (docs) => { let out = docs.filter(match(filt)); if (lim) out = out.slice(0, lim); return out; };
      const q = { where(f, op, v){ filt.push([f, op, v]); return q; }, limit(n){ lim = n; return q; }, orderBy(){ return q; },
        get: async () => { const rows = await fetchColl(c, filt, lim); const docs = rows.map(r => { cache.set(r.path, r.data); return snapDoc(r.path); }); return {docs: apply(docs), size: docs.length, empty: !docs.length}; },
        onSnapshot(cb, onErr){ const f = () => { const docs = apply(collDocs(c)); cb({docs, size: docs.length, empty: !docs.length, docChanges: () => []}); };
          subs.push({kind: "coll", path: c, f});
          fetchColl(c).then(rows => { for (const r of rows) cache.set(r.path, r.data); f(); }, (e) => { if (onErr) onErr(err(e)); else f(); }); return unsub(f); },
        add: async (d) => { const id = newId(); await db.doc(c + "/" + id).set(d); return {id}; },
        doc: (id) => db.doc(c + "/" + id) };
      return q; }
  };

  let staffAtBoot = false;
  // ---------------------------------------------------------------- who is viewing («user»)
  let WHO = null, SESSION = null;
  const prof = (id, name) => ({id, name: name || "", avatarUrl: null, color: "#151547", email: id === SESSION?.user?.id ? SESSION.user.email : null, isMe: id === SESSION?.user?.id, guest: false, isOwner: id === SESSION?.user?.id && !!WHO?.owner, canEdit: true});
  const user = {
    id: async () => SESSION.user.id,
    can: async () => true,
    isOwner: async () => !!WHO?.owner,
    canEdit: async () => true,
    me: async () => prof(SESSION.user.id, WHO?.name || SESSION.user.email),
    profiles: async (ids) => { ids = [].concat(ids || []).filter(Boolean); const out = Object.fromEntries(ids.map(i => [i, prof(i, "")]));
      const uu = ids.filter(i => /^[0-9a-f-]{36}$/.test(i)); if (uu.length) { const {data} = await sb.rpc("profile_names", {ids: uu}); for (const r of data || []) out[r.uid] = prof(r.uid, r.name); }
      return out; },
    search: async (q) => { const {data} = await sb.rpc("search_profiles", {q: q || ""}); return (data || []).map(r => ({...prof(r.uid, r.name), email: r.email})); }
  };

  // ---------------------------------------------------------------- uploaded files («assets»): Storage, read by the page at /_blob/<id>
  const BUCKET = "assets";
  const assets = {
    upload: async (blob, o) => { const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""); const type = o?.type || blob.type || "application/octet-stream";
      const {error} = await sb.storage.from(BUCKET).upload(id, blob, {contentType: type, upsert: false}); if (error) throw err(error);
      return {id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: type}; },
    list: async () => { const out = []; for (let off = 0; ; off += 1000) { const {data, error} = await sb.storage.from(BUCKET).list("", {limit: 1000, offset: off}); if (error) throw err(error);
        out.push(...data.filter(x => x.id).map(x => ({id: x.name, contentType: x.metadata?.mimetype || "", sizeBytes: x.metadata?.size || 0}))); if (data.length < 1000) break; }
      return {assets: out, usage: {}}; },
    delete: async (id) => { const {error} = await sb.storage.from(BUCKET).remove([id]); if (error) throw err(error); return {deleted: true}; } };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (u, o) => { const m = /\/_blob\/([0-9a-f]{32})/.exec(String(u)); if (m) { await whenReady(); const {data, error} = await sb.storage.from(BUCKET).download(m[1]);
      return error || !data ? new Response("", {status: 404}) : new Response(data, {status: 200, headers: {"content-type": data.type || "application/octet-stream"}}); } return realFetch(u, o); };

  // ---------------------------------------------------------------- the assistant («sample»): the «sample» function on the server holds the office's key
  const FN = (name) => CFG.url.replace(/\/$/, "") + "/functions/v1/" + name;
  const authHeaders = () => ({"content-type": "application/json", authorization: "Bearer " + SESSION.access_token, apikey: CFG.key});
  async function sampleCore(input, opts = {}){
    const tier = ["quick", "default", "complex"].includes(opts.modelTier) ? opts.modelTier : "default";
    let r; try { r = await realFetch(FN("sample"), {method: "POST", signal: opts.signal, headers: authHeaders(), body: JSON.stringify({input, tier})}); }
    catch (e) { if (e && e.name === "AbortError") throw {code: "cancelled", message: "cancelled"}; throw {code: "network", message: String(e && e.message || e)}; }
    if (!r.ok) { let b = {}; try { b = await r.json(); } catch {} throw {code: b.code || (r.status === 403 ? "not_granted" : r.status === 429 ? "rate_limited" : "unavailable"), message: b.message || ("HTTP " + r.status)}; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", text = "", stop = null;
    try { for (;;) { const {value, done: fin} = await reader.read(); if (fin) break; buf += dec.decode(value, {stream: true}); let i;
        while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split("\n").find(l => l.startsWith("data:")); if (!line) continue; let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; opts.onText && opts.onText({text, delta: ev.delta.text}); }
          else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          else if (ev.type === "error") throw {code: "unavailable", message: ev.error?.message || "stream error", text}; } } }
    catch (e) { if (e && e.name === "AbortError") throw {code: "cancelled", message: "cancelled", text}; throw e; }
    return {text, truncated: stop === "max_tokens", modelTierApplied: tier};
  }
  const sample = Object.assign((input, opts) => sampleCore(input, opts), {
    json: async (input, opts) => { const r = await sampleCore(input, opts); const t = r.text.trim(); const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
      let v = tryParse(t); if (v === undefined) { const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t); if (m) v = tryParse(m[1].trim()); }
      if (v === undefined) { const a = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter(i => i >= 0)); const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")); if (isFinite(a) && b > a) v = tryParse(t.slice(a, b + 1)); }
      if (v === undefined) throw {code: "invalid_json", message: "no json", text: r.text}; return v; },
    limits: async () => ({maxPromptBytes: 262144, tools: false, images: false}) });
  let sampleOn = null;
  async function sampleReady(){ if (sampleOn !== null) return sampleOn; try { const r = await realFetch(FN("sample"), {method: "POST", headers: authHeaders(), body: JSON.stringify({probe: true})}); sampleOn = r.ok; } catch { sampleOn = false; } return sampleOn; }

  // ---------------------------------------------------------------- the owner's accounts panel («admin» function on the server)
  async function admin(body){ const r = await realFetch(FN("admin"), {method: "POST", headers: authHeaders(), body: JSON.stringify(body)}); let b = {}; try { b = await r.json(); } catch {} if (!r.ok) throw new Error(b.message || ("HTTP " + r.status)); return b; }

  // ---------------------------------------------------------------- sign-in: email + password, then the authenticator code
  const css = `#dcGate{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#f4f3ef;font:15px/1.6 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#151547;padding:16px}
    #dcGate .box{width:min(380px,100%);background:#fff;border:1px solid #e3e0d6;border-radius:10px;padding:24px;box-shadow:0 6px 24px rgba(21,21,71,.08)}
    #dcGate h1{font-size:20px;margin:0 0 4px} #dcGate p{margin:0 0 14px;color:#555;font-size:14px}
    #dcGate label{display:block;font-size:13px;margin:10px 0 4px} #dcGate input{width:100%;box-sizing:border-box;border:1px solid #c9c5b8;border-radius:6px;padding:8px 10px;font:inherit}
    #dcGate input.ltr{direction:ltr;text-align:left} #dcGate button{margin-top:16px;width:100%;background:#151547;color:#fff;border:0;border-radius:6px;padding:10px;font:inherit;font-weight:700;cursor:pointer}
    #dcGate button.link{background:none;color:#151547;font-weight:400;text-decoration:underline;margin-top:8px;padding:4px} #dcGate .msg{color:#a32020;font-size:13px;min-height:1.2em;margin-top:8px}
    #dcGate img{display:block;margin:8px auto;width:200px;height:200px;background:#fff;padding:8px;border-radius:6px} #dcGate code{direction:ltr;display:block;text-align:center;font-size:12px;word-break:break-all;background:#f4f3ef;padding:6px;border-radius:6px}
    @media (prefers-color-scheme: dark){#dcGate{background:#0e0e24;color:#eee}#dcGate .box{background:#17173a;border-color:#2b2b55}#dcGate p{color:#bbb}#dcGate input{background:#0e0e24;color:#eee;border-color:#3b3b6b}#dcGate button.link{color:#c9a263}#dcGate code{background:#0e0e24}}`;
  let gate = null;
  function screen(html){ if (!gate) { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); gate = document.createElement("div"); gate.id = "dcGate"; gate.dir = "rtl"; document.body.appendChild(gate); }
    gate.innerHTML = `<div class="box"><h1>ديوان القضايا</h1>${html}<div class="msg" id="dcMsg"></div></div>`; const i = gate.querySelector("input"); if (i) i.focus(); }
  const say = (m) => { const e = document.getElementById("dcMsg"); if (e) e.textContent = m; };
  const form = (html, onSubmit) => new Promise((res) => { screen(`<form id="dcF">${html}</form>`); const f = document.getElementById("dcF");
    f.onsubmit = async (e) => { e.preventDefault(); const b = f.querySelector("button[type=submit]"); b.disabled = true; say(""); try { const v = await onSubmit(f); if (v !== false) res(v); } catch (x) { say(x.message || String(x)); } b.disabled = false; }; return f; });
  const AR = (m) => /Invalid login/i.test(m) ? "البريد أو كلمة المرور غير صحيحة" : /Invalid TOTP|invalid.*code|expired/i.test(m) ? "الرمز غير صحيح أو انتهت صلاحيته" : /rate limit/i.test(m) ? "محاولات كثيرة؛ انتظر قليلاً ثم أعد المحاولة" : m;

  async function signIn(){
    await form(`<p>الدخول بحساب المكتب</p><label>البريد الإلكتروني</label><input class="ltr" name="email" type="email" autocomplete="username" required>
      <label>كلمة المرور</label><input class="ltr" name="pw" type="password" autocomplete="current-password" required><button type="submit">دخول</button>`,
      async (f) => { const {error} = await sb.auth.signInWithPassword({email: f.email.value.trim(), password: f.pw.value}); if (error) throw new Error(AR(error.message)); });
  }
  async function secondFactor(){
    const {data: lvl} = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if (lvl?.currentLevel === "aal2") return;
    const {data: fl} = await sb.auth.mfa.listFactors(); const all = fl?.all || []; const ok = (fl?.totp || []).find(f => f.status === "verified");
    if (ok) { await form(`<p>أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة في جوالك</p><input class="ltr" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><button type="submit">تحقق</button>`,
        async (f) => { const {error} = await sb.auth.mfa.challengeAndVerify({factorId: ok.id, code: f.code.value.trim()}); if (error) throw new Error(AR(error.message)); }); return; }
    for (const x of all.filter(f => f.status !== "verified")) await sb.auth.mfa.unenroll({factorId: x.id}).catch(() => {});
    const {data: en, error} = await sb.auth.mfa.enroll({factorType: "totp", friendlyName: "ديوان القضايا " + new Date().toISOString().slice(0, 10)}); if (error) throw error;
    await form(`<p>أول دخول: امسح الرمز بتطبيق مصادقة (Microsoft Authenticator أو Google Authenticator) ثم أدخل الرقم الذي يظهر فيه.</p>
      <img alt="" src="${qrSrc(en.totp.qr_code)}"><code>${en.totp.secret}</code><p style="font-size:12px;margin:6px 0 0">الرمز والمفتاح سرّيان: لا تصوّرهما ولا ترسلهما لأحد.</p><label>الرمز</label><input class="ltr" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><button type="submit">تفعيل والدخول</button>`,
      async (f) => { const {error} = await sb.auth.mfa.challengeAndVerify({factorId: en.id, code: f.code.value.trim()}); if (error) throw new Error(AR(error.message)); });
  }
  // the server gives the QR code as an SVG, raw or as a data: link whose markup is not encoded (its quotes would end the attribute)
  function qrSrc(q){ q = String(q || ""); let svg = /^data:/.test(q) ? q.slice(q.indexOf(",") + 1) : q; if (!svg.includes("<")) { try { svg = decodeURIComponent(svg); } catch {} }
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  async function newPassword(){
    if (!SESSION.user.user_metadata?.must_change_password) return;
    await form(`<p>كلمة المرور الحالية مؤقتة. اختر كلمة مرور جديدة (12 حرفاً على الأقل).</p><label>كلمة المرور الجديدة</label><input class="ltr" name="a" type="password" autocomplete="new-password" minlength="12" required>
      <label>تأكيدها</label><input class="ltr" name="b" type="password" autocomplete="new-password" minlength="12" required><button type="submit">حفظ</button>`,
      async (f) => { if (f.a.value !== f.b.value) throw new Error("كلمتا المرور غير متطابقتين"); const {error} = await sb.auth.updateUser({password: f.a.value, data: {must_change_password: false}}); if (error) throw new Error(AR(error.message)); });
  }
  async function boot(){
    if (!document.body) await new Promise(r => document.addEventListener("DOMContentLoaded", r, {once: true}));
    for (;;) {
      let {data: {session}} = await sb.auth.getSession();
      if (!session) { await signIn(); continue; }
      try { await secondFactor(); } catch (e) { say(AR(e.message || String(e))); await sb.auth.signOut(); continue; }
      ({data: {session}} = await sb.auth.refreshSession()); SESSION = session;
      await newPassword(); ({data: {session}} = await sb.auth.getSession()); SESSION = session;
      break;
    }
    const {data: who, error} = await sb.rpc("whoami"); if (error) throw err(error); WHO = who;
    try { await fetchDoc(STAFF); staffAtBoot = true; } catch {}
    if (WHO?.staff) await loadTemplates();
    if (gate) { gate.remove(); gate = null; }
    sb.auth.onAuthStateChange((ev, s) => { if (s) SESSION = s; if (ev === "SIGNED_OUT") location.reload(); });
    listen(); strip(); sb.rpc("log_event", {p_action: "open", p_detail: {ua: navigator.userAgent.slice(0, 120)}}).then(() => {}, () => {});
  }
  // the fee-contract and letterhead templates are not published with the page (it is hosted publicly): they are read from the
  // private bucket for office members and set where the page looks first (window.__TPL_*), so its own <script src="tpl/…"> never runs.
  // The file is one line, window.__TPL_X="<base64>"; it is parsed, not run.
  async function loadTemplates(){
    await Promise.all([["tpl/fee.js", "__TPL_FEE"], ["tpl/letterhead.js", "__TPL_LETTERHEAD"]].map(async ([file, g]) => {
      try { const {data} = await sb.storage.from("private").download(file); if (!data) return;
        const m = /^\s*window\.(__TPL_[A-Z]+)\s*=\s*"([A-Za-z0-9+/=]*)"\s*;?\s*$/.exec(await data.text());
        if (m && m[1] === g) window[g] = m[2]; } catch {}
    }));
  }
  let ready = null; const whenReady = () => ready || (ready = boot());

  // ---------------------------------------------------------------- the strip at the top: who is signed in, sign out, accounts (owner)
  function strip(){
    const bar = document.createElement("div"); bar.id = "diwanCloudBar"; bar.dir = "rtl";
    bar.style.cssText = "position:relative;z-index:40;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:5px 14px;background:#151547;color:#fff;font:13px/1.5 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif";
    const b = (id, t) => `<button id="${id}" style="background:none;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit">${t}</button>`;
    bar.innerHTML = `<b style="color:#c9a263">${CFG.label || "النسخة السحابية"}</b><span>${(WHO?.name || SESSION.user.email || "").replace(/[<>&"]/g, "")}</span><span style="margin-inline-start:auto;display:flex;gap:6px;flex-wrap:wrap">${WHO?.owner ? b("dcAcc", "الحسابات") : ""}${b("dcOut", "خروج")}</span>`;
    document.body.prepend(bar);
    bar.querySelector("#dcOut").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    const acc = bar.querySelector("#dcAcc"); if (acc) acc.onclick = accounts;
  }
  async function accounts(){
    const wrap = document.createElement("div"); wrap.dir = "rtl"; wrap.style.cssText = "position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.4);display:grid;place-items:center;padding:16px;font:14px/1.6 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif";
    const esc = (s) => String(s ?? "").replace(/[<>&"]/g, c => ({"<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"}[c]));
    const draw = async (note = "") => { const {data} = await sb.rpc("search_profiles", {q: ""});
      wrap.innerHTML = `<div style="background:#fff;color:#151547;border-radius:10px;padding:20px;width:min(560px,100%);max-height:90vh;overflow:auto">
        <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">حسابات الدخول</b><button data-x style="border:0;background:none;font-size:20px;cursor:pointer">×</button></div>
        <p style="color:#555;margin:6px 0 12px">الحساب يتيح الدخول فقط؛ الدور والصلاحيات تُعطى من صفحة «الموظفون والصلاحيات» بعد إنشائه.</p>
        ${note ? `<div style="background:#fff7e0;border:1px solid #e8c66a;border-radius:6px;padding:8px;margin-bottom:10px">${note}</div>` : ""}
        <form data-new style="display:flex;gap:6px;flex-wrap:wrap"><input name="name" placeholder="الاسم" required style="flex:1;min-width:140px;padding:6px;border:1px solid #ccc;border-radius:6px;font:inherit"><input name="email" type="email" placeholder="البريد" required style="flex:1;min-width:180px;padding:6px;border:1px solid #ccc;border-radius:6px;font:inherit;direction:ltr"><button style="background:#151547;color:#fff;border:0;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer">إنشاء حساب</button></form>
        <table style="width:100%;border-collapse:collapse;margin-top:12px">${(data || []).map(p => `<tr style="border-top:1px solid #eee"><td style="padding:6px 0">${esc(p.name)}</td><td style="direction:ltr;text-align:left">${esc(p.email)}</td>
          <td style="white-space:nowrap">${p.uid === SESSION.user.id ? "" : `<button data-pw="${p.uid}" style="font:inherit;font-size:12px">كلمة مرور مؤقتة</button> <button data-mfa="${p.uid}" style="font:inherit;font-size:12px">إعادة رمز التحقق</button>`}</td></tr>`).join("")}</table></div>`;
      wrap.querySelector("[data-x]").onclick = () => wrap.remove();
      wrap.querySelector("[data-new]").onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { const r = await admin({action: "create", name: f.name.value.trim(), email: f.email.value.trim()});
          draw(`أُنشئ الحساب. كلمة المرور المؤقتة (تظهر مرة واحدة، يغيّرها صاحبها عند أول دخول): <code style="direction:ltr;display:inline-block">${esc(r.password)}</code>`); } catch (x) { alert(x.message); } };
      wrap.querySelectorAll("[data-pw]").forEach(btn => btn.onclick = async () => { if (!confirm("إصدار كلمة مرور مؤقتة جديدة لهذا الحساب؟")) return; try { const r = await admin({action: "reset_password", uid: btn.dataset.pw}); draw(`كلمة المرور المؤقتة الجديدة: <code style="direction:ltr;display:inline-block">${esc(r.password)}</code>`); } catch (x) { alert(x.message); } });
      wrap.querySelectorAll("[data-mfa]").forEach(btn => btn.onclick = async () => { if (!confirm("يُلغى رمز التحقق الحالي ويضبطه صاحب الحساب من جديد عند دخوله. متابعة؟")) return; try { await admin({action: "reset_mfa", uid: btn.dataset.mfa}); draw("أُلغي رمز التحقق؛ يُطلب ضبطه عند الدخول القادم."); } catch (x) { alert(x.message); } });
    };
    document.body.appendChild(wrap); await draw();
  }

  window.claude = { use: async (name) => { await whenReady();
    if (name === "db") return db; if (name === "user") return user; if (name === "assets") return WHO?.staff ? assets : null;
    if (name === "sample") return (WHO?.staff && await sampleReady()) ? sample : null; return null; } };
  window.diwanCloud = {sb, db, cache, whoami: () => WHO};
  whenReady().catch((e) => { console.error(e); });
})();
