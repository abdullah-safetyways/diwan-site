/* أداة ديوان القضايا — جمع القضايا من حساب ناجز
   تعمل داخل صفحة najiz.sa بعد تسجيل الدخول: من إشارة «تحديث الديوان» في شريط الإشارات، أو بلصقها في Console.
   تقرأ قائمة قضايا الحساب وتفاصيلها وأطرافها وجلساتها وأحكامها من واجهات ناجز نفسها التي تستعملها الصفحة، ثم تسلّم النتيجة
   إلى نافذة الديوان التي فتحتها مباشرة؛ وإلا تنسخها إلى الحافظة أو تنزّلها ملفاً يُرفع في «ربط ناجز».
   لا ترسل شيئاً إلى أي جهة أخرى، ولا تغيّر شيئاً في ناجز. */
(() => {
  if (window.__diwanNajiz) { window.__diwanNajiz.show(); return; }
  if (!/najiz\.sa$/.test(location.hostname)) { alert("افتح هذه الأداة في صفحة najiz.sa بعد تسجيل الدخول."); return; }
  const TOOL = "diwan-najiz-tool/5";
  const BASE = "/applications/lawsuit//lawsuit/";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const getJ = async (u) => { for (let t = 0; t < 3; t++) { try { const r = await fetch(u, {credentials: "include"}); if (r.ok) return await r.json(); if (r.status === 404 || r.status === 403) return {__status: r.status}; } catch {} await sleep(800 * (t + 1)); } return {__err: 1}; };
  // طلبات التنفيذ (تطبيق «التنفيذ» في ناجز): القائمة ثم تفاصيل كل طلب ومراحله وقراراته — قراءة فقط
  const EXB = "/applications/iexecution/";
  const exJ = async (u) => { const r = await getJ(EXB + u); return typeof r === "string" ? (() => { try { return JSON.parse(r); } catch { return null; } })() : r; };
  const exPick = (o, ks) => { const z = {}; if (o) for (const k of ks) if (o[k] !== null && o[k] !== undefined && o[k] !== "") z[k] = o[k]; return z; };
  const exParty = (p) => exPick(p, ["PartyRoleName","PartyTypeName","IdentityTypeName","IdentityId","UnifiedNo","CRNumber","PartyName","NationalityName","MobileNo","DueAmount","IsApplicant"]);
  async function collectExec(onProg){
    const q = {pageSize: 500, pageIndex: 1, sortBy: "SubmittedDate", sortDirection: "Desc", resultCount: 500, searchType: 1, searchString: "", requestStatusIds: [], requestTypeIds: [], partyRoleIds: [], isDraft: false};
    const L = await exJ("Request/GetDashboardRequests?data=" + encodeURIComponent(JSON.stringify(q)));
    const list = (L && Array.isArray(L.data)) ? L.data : []; const out = {}; let i = 0, done = 0;
    const worker = async () => { while (i < list.length) { const x = list[i++];
      const d = await exJ("Request/Get?data=" + encodeURIComponent(JSON.stringify({requestId: x.id, documentTypeId: x.documentTypeId})));
      const st = await exJ("Request/GetRequestSteps?requestId=" + encodeURIComponent(x.id));
      const dec = await exJ("Request/GetDecisionList?data=" + encodeURIComponent(JSON.stringify({requestId: x.id})));
      const ok = d && !d.__err && !d.__status;
      out[String(x.code)] = {code: String(x.code), list: exPick(x, ["requestTypeName","submittedDateHijri","courtName","respondantName","requestStatusId","requestStatusName","documentTypeId","documentTypeName"]),
        d: ok ? {...exPick(d, ["RequestTypeName","DocumentTypeName","DocumentTypeGroupName","CourtName","RegionName","CourtDepartmentName","RequestStatusName","RequestInternalStatusName","CreatedDate","ModifiedDate","SubmittedDate"]),
          applicants: (d.Requesters || []).map(exParty), submitters: (d.Applicants || []).map(p => exPick(p, ["PartyName","PartyRoleId","IdentityId","PartyTypeName"])), respondents: (d.Respondents || []).map(exParty),
          docs: (d.Documents || []).map(o => exPick(o, ["DocumentNo","OriginalAmount","ReceivedAmount","RequiredAmount","CurrencyName","RightDescription","DocumentDate","OriginalDocumentTypeName","ContractEndDate","ContractActualEndDate","RentDuration","RentDayCost","LateHours","TotalLateHoursCost","DamageCost","FinalTotal","Paid","Remaining"]))} : null,
        steps: st && Array.isArray(st.requestSteps) ? st.requestSteps.filter(z => z.isExists).map(z => exPick(z, ["stepDescription","stepStatus","date","stepDate"])) : null,
        decisions: Array.isArray(dec) ? dec.map(z => exPick(z, ["DecisionName","DecisionCode","DecisionStatusName","DecisionDate","DecisionTime"])) : null};
      done++; onProg && onProg(done, list.length); await sleep(120); } };
    await Promise.all([1, 2, 3].map(worker));
    return out;
  }
  const page = async (path) => { const out = []; for (let i = 0; i < 20; i++) { const r = await getJ(`${BASE}${path}?pageSize=500&pageIndex=${i}`); const list = Array.isArray(r) ? r : (r && r.list) || []; out.push(...list); if (list.length < 500) break; } return out; };
  // the Diwan that opened this tab names it «diwan-najiz:<token>»; the result goes back to it without a file
  const nm = String(window.name || ""); const parts = nm.startsWith("diwan-najiz:") ? nm.slice(12).split(":") : []; const token = parts[0] || null;
  const dec = (x) => { try { return x ? decodeURIComponent(x) : ""; } catch { return x || ""; } };
  const acct = dec(parts[1]), acctLabel = dec(parts[2]) || dec(parts[1]);
  const diwan = token && window.opener && !window.opener.closed ? window.opener : null;
  // ---- the little window
  const box = document.createElement("div"); box.dir = "rtl"; box.lang = "ar";
  box.style.cssText = "position:fixed;top:16px;left:16px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);background:#fff;color:#171838;border:1px solid #d9d8e2;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.6 system-ui,'Segoe UI',Tahoma,sans-serif;padding:14px 16px";
  const BTN = "background:#151547;color:#fff;border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer";
  const BTN2 = "background:#fff;color:#151547;border:1px solid #d9d8e2;border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer";
  box.innerHTML = `<div style="font-weight:700;font-size:15px;margin-bottom:4px">ديوان القضايا — تحديث من ناجز</div>
    <div id="dnz-step1"><div style="color:#484a66;font-size:13px;margin-bottom:8px">اسم هذا الحساب كما يظهر في الديوان (مثل: ناجز محامين، ناجز أفراد، شركة كذا).</div>
      <input id="dnz-name" style="width:100%;box-sizing:border-box;border:1px solid #d9d8e2;border-radius:8px;padding:7px 10px;font:inherit" placeholder="اسم الحساب">
      <label style="display:flex;gap:6px;align-items:center;margin:8px 0 0;font-size:13px"><input type="checkbox" id="dnz-req" checked> جمع صحائف الدعاوى (الطلبات) أيضاً</label>
      <label style="display:flex;gap:6px;align-items:center;margin:4px 0 8px;font-size:13px"><input type="checkbox" id="dnz-exec" checked> جمع طلبات التنفيذ (السندات والمبالغ والقرارات)</label>
      <button id="dnz-go" style="${BTN}">ابدأ الجمع</button></div>
    <div id="dnz-prog" hidden><div id="dnz-msg" style="margin:6px 0">…</div><div style="height:6px;background:#ecebf0;border-radius:4px;overflow:hidden"><div id="dnz-bar" style="height:100%;width:0;background:#151547;transition:width .3s"></div></div></div>
    <div id="dnz-done" hidden><div id="dnz-sum" style="margin:6px 0"></div><div id="dnz-sent" style="margin:6px 0;color:#2f7d4f;font-weight:700" hidden></div>
      <div id="dnz-alt" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button id="dnz-copy" style="${BTN}">نسخ البيانات للديوان</button><button id="dnz-dl" style="${BTN2}">تنزيل الملف</button></div>
      <div id="dnz-hint" style="color:#484a66;font-size:12px;margin-top:8px">في الديوان: المزامنة والإضافة ← ربط ناجز ← «لصق من الحافظة» (أو ارفع الملف).</div></div>
    <div id="dnz-err" hidden style="color:#b3261e;margin-top:6px"></div>
      <details style="margin-top:10px;border-top:1px solid #ecebf0;padding-top:8px;font-size:12px;color:#484a66"><summary style="cursor:pointer">تعرّف على صفحة الوكالات (لا يقرأ أي بيانات)</summary>
        <div style="margin-top:6px">١) افتح «الوكالات» في ناجز كما تفتحها عادة واعرض قائمتها وتفاصيل وكالة واحدة. ٢) شغّل إشارة «تحديث الديوان» مرة أخرى إن اختفت هذه النافذة. ٣) اضغط الزر: يعرض <b>عناوين</b> الصفحات التي طلبتها صفحة ناجز نفسها فقط — بلا أسماء ولا أرقام ولا محتوى (الأرقام تُستبدل بـ#) — فتنسخها للديوان.</div>
        <button id="dnz-learn" style="${BTN2};margin-top:6px">اعرض العناوين</button>
        <textarea id="dnz-paths" hidden readonly style="width:100%;box-sizing:border-box;height:120px;margin-top:6px;font:12px monospace;direction:ltr"></textarea>
        <button id="dnz-pcopy" hidden style="${BTN2};margin-top:6px">نسخ العناوين</button>
        <div style="margin-top:10px">ثم: اضغط «ابدأ المراقبة»، وفي صفحة الوكالات اضغط البحث، وافتح وكالة، واضغط تنزيلها أو طباعتها كما تفعل عادة، ثم «أوقف وانسخ». تُسجَّل <b>أسماء الحقول وأنواعها فقط</b> في كل طلب ورد — لا قيمة ولا اسم ولا رقم.</div>
        <button id="dnz-watch" style="${BTN2};margin-top:6px">ابدأ المراقبة</button> <span id="dnz-wn" style="font-size:12px"></span>
        <div style="margin-top:10px;border-top:1px dashed #d9d8e2;padding-top:8px"><b>جمع الوكالات للديوان:</b> ابدأ المراقبة، واعرض في ناجز قائمة الوكالات التي أنت فيها <b>وكيل</b> واضغط البحث، ثم اضغط الزر. يكرر طلب الصفحة نفسه صفحةً صفحةً بتمهل (قراءة فقط)، ثم ينسخ القائمة فتلصقها في الديوان: المزامنة ← ربط ناجز ← «لصق من الحافظة».</div>
        <button id="dnz-poas" style="${BTN};margin-top:6px">جمع الوكالات</button> <span id="dnz-pn" style="font-size:12px"></span></details>
    <button id="dnz-x" title="إغلاق" style="position:absolute;top:8px;left:10px;background:none;border:0;font-size:18px;cursor:pointer;color:#6f718a">×</button>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector("#" + id);
  const api = {show: () => { box.hidden = false; }};
  window.__diwanNajiz = api;
  $("dnz-x").onclick = () => { box.hidden = true; };
  // (17/11) learning the POA page: only the addresses (paths) of the requests the Najiz page itself made — no query values, no response,
  // every run of 4+ digits masked — so the office can say which of Najiz's own pages hold its powers of attorney. Nothing is sent anywhere.
  $("dnz-learn").onclick = () => {
    const seen = new Set();
    for (const e of performance.getEntriesByType("resource")) { let u; try { u = new URL(e.name); } catch { continue; }
      if (u.origin !== location.origin || !["fetch", "xmlhttprequest"].includes(e.initiatorType)) continue;
      seen.add(u.pathname.split("/").map(x => /\d{3,}|[0-9a-f]{8,}|^[0-9a-f-]{20,}$|^[A-Za-z0-9+_=-]{8,}$/i.test(x) && !/^[a-z]+$|^[A-Z][a-z]+([A-Z][a-z]+)*$/.test(x) || /[^\x00-\x7f]|%/.test(x) ? "#" : x).join("/") + (u.search ? "?…" : "")); }
    const t = $("dnz-paths"); t.hidden = false; t.value = [maskPath(location.pathname), ...[...seen].sort()].join("\n") || "(لا عناوين — افتح صفحة الوكالات أولاً)";
    $("dnz-pcopy").hidden = false; };
  // (17/11) watch mode: while the lawyer uses the POA page himself, the shape of each request the page sends and of each reply — method,
  // masked path, field names and types (string/number/…), never a value. Only addresses under /applications/wekalat/ are noted.
  const shape = (v, d = 0) => { if (v === null) return "null"; if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : []; if (typeof v === "object") { if (d > 4) return "{…}"; const o = {}; for (const k of Object.keys(v).slice(0, 60)) o[k] = shape(v[k], d + 1); return o; } return typeof v; };
  const maskPath = (p) => p.split("/").map(x => /\d{3,}|[0-9a-f]{8,}|^[0-9a-f-]{20,}$|^[A-Za-z0-9+_=-]{8,}$/i.test(x) && !/^[a-z]+$|^[A-Z][a-z]+([A-Z][a-z]+)*$/.test(x) || /[^\x00-\x7f]|%/.test(x) ? "#" : x).join("/");
  const jshape = (t) => { try { return shape(JSON.parse(t)); } catch { return t ? "(" + typeof t + ", " + String(t).length + " حرفاً)" : ""; } };
  const watched = []; let watching = false; const origFetch = window.fetch, origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send, origSetH = XMLHttpRequest.prototype.setRequestHeader;
  // kept in this page's memory only, never shown or copied: the page's own list request (to repeat it page by page) and the last
  // replies (to tell, by comparing values here, which list field a detail or download request uses — only the field's name is reported)
  let lastSearch = null; const rawSeen = {search: [], user: null};
  const b64 = (v) => { try { return btoa(unescape(encodeURIComponent(String(v)))); } catch { return null; } };
  const relOf = (val) => { if (val == null || val === "") return []; const v = String(val); const out = new Set();
    for (const it of rawSeen.search) for (const [k, x] of Object.entries(it)) if (x != null && x !== "" && typeof x !== "object") { if (String(x) === v) out.add("searchResult." + k); else if (b64(x) === v) out.add("base64(searchResult." + k + ")"); }
    if (rawSeen.user) for (const [k, x] of Object.entries(rawSeen.user)) if (x != null && x !== "" && typeof x !== "object" && String(x) === v) out.add("UserInfo." + k);
    return [...out]; };
  const relations = (u, body) => { const r = {}; u.pathname.split("/").forEach((x, i) => { const m = relOf(decodeURIComponent(x)); if (m.length) r["path[" + i + "]"] = m; });
    let j = null; try { j = typeof body === "string" ? JSON.parse(body) : null; } catch {}
    if (j && typeof j === "object") for (const [k, x] of Object.entries(j)) { const m = relOf(x); if (m.length) r["body." + k] = m; }
    return r; };
  const rawNote = (method, u, body, headers, text) => {
    if (/\/Procuration\/search$/.test(u.pathname) && method.toUpperCase() === "POST") { lastSearch = {url: u.pathname, body, headers: headers || {}};
      try { rawSeen.search = (JSON.parse(text)?.data?.searchResult || []).slice(0, 200); } catch {} }
    if (/\/api\/UserInfo$/.test(u.pathname)) { try { rawSeen.user = JSON.parse(text); } catch {} } };
  const note = (method, url, body, status, ctype, resp, headers, text) => { try { const u = new URL(url, location.href); if (watching && u.origin === location.origin && /^\/applications\/wekalat\//.test(u.pathname)) rawNote(method, u, body, headers, text); } catch {}
    noteShape(method, url, body, status, ctype, resp); };
  const noteShape = (method, url, body, status, ctype, resp) => { let u; try { u = new URL(url, location.href); } catch { return; } if (!watching || u.origin !== location.origin || !/^\/applications\/wekalat\//.test(u.pathname)) return;
    watched.push({method, path: maskPath(u.pathname), query: [...u.searchParams.keys()], relations: relations(u, body), body: body == null ? null : typeof body === "string" ? jshape(body) : "(" + (body.constructor?.name || typeof body) + ")", status, type: (ctype || "").split(";")[0], reply: resp});
    $("dnz-wn").textContent = `سُجّل ${watched.length} طلب`; };
  const startWatch = () => {
    window.fetch = async function (input, init) { const r = await origFetch.apply(this, arguments); try { const url = typeof input === "string" ? input : input.url; const ct = r.headers.get("content-type") || "";
        const txt = /json/.test(ct) ? await r.clone().text() : ""; let hd = {}; try { hd = Object.fromEntries(new Headers((init && init.headers) || {}).entries()); } catch {}
        note((init && init.method) || (input && input.method) || "GET", url, init && init.body, r.status, ct, /json/.test(ct) ? jshape(txt) : "(" + ct + ")", hd, txt); } catch {} return r; };
    XMLHttpRequest.prototype.open = function (m, u) { this.__dnz = {m, u, h: {}}; return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__dnz) this.__dnz.h[k] = v; return origSetH.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) { const x = this; x.addEventListener("loadend", () => { try { const ct = x.getResponseHeader("content-type") || "";
        const txt = /json/.test(ct) && (x.responseType === "" || x.responseType === "text") ? x.responseText : /json/.test(ct) && x.responseType === "json" ? JSON.stringify(x.response) : "";
        note(x.__dnz?.m || "GET", x.__dnz?.u || "", body, x.status, ct, txt ? jshape(txt) : "(" + ct + ")", x.__dnz?.h, txt); } catch {} }); return origSend.apply(this, arguments); };
    watching = true; };
  const stopWatch = () => { watching = false; window.fetch = origFetch; XMLHttpRequest.prototype.open = origOpen; XMLHttpRequest.prototype.send = origSend; XMLHttpRequest.prototype.setRequestHeader = origSetH; };
  $("dnz-watch").onclick = async () => { if (!watching) { watched.length = 0; startWatch(); $("dnz-watch").textContent = "أوقف وانسخ"; $("dnz-wn").textContent = "يراقب… استعمل صفحة الوكالات الآن"; return; }
    stopWatch(); $("dnz-watch").textContent = "ابدأ المراقبة"; const t = $("dnz-paths"); t.hidden = false; t.value = JSON.stringify(watched, null, 1); $("dnz-pcopy").hidden = false;
    try { await navigator.clipboard.writeText(t.value); $("dnz-wn").textContent = `نُسخ ${watched.length} طلب — الصقها للديوان`; } catch { t.select(); } };
  // «جمع الوكالات»: the page's own list request, repeated page by page with only pageIndex changed, one at a time with a pause;
  // what goes to the Diwan is the list of POAs where the lawyer is a party (the page's filter): number, type, status, dates, the other party
  const pickDate = (x, disp) => { const t = String(x || disp?.gregDate || ""); const m = /(\d{4})-(\d{2})-(\d{2})/.exec(t) || /(\d{2})\/(\d{2})\/(\d{4})/.exec(t); return m ? (m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`) : null; };
  const poaRow = (it) => ({code: it.code != null ? String(it.code) : null, type: it.procurationTypeName || null, status: it.status || null, statusId: it.statusId ?? null,
    issued: pickDate(it.issueDateGreg, it.issueDateDisp), issuedHijri: it.issueDateDisp?.hijriDate || it.issueDate || null, expires: pickDate(it.expiryDate, it.expireDateDisp), expiresHijri: it.expireDateDisp?.hijriDate || null,
    party: it.otherPartyName || null, partyType: it.partyType ?? null, requestType: it.requestType || null, source: it.issueSource || null, terminable: !!it.terminable});
  $("dnz-poas").onclick = async () => {
    const say = (t) => { $("dnz-pn").textContent = t; };
    if (!lastSearch) { say("ابدأ المراقبة ثم اضغط البحث في صفحة الوكالات أولاً."); return; }
    let base; try { base = JSON.parse(lastSearch.body); } catch { say("لم أفهم طلب البحث الذي أرسلته الصفحة."); return; }
    const first = Number(base.pageIndex) || 0; const out = new Map(); let total = null;
    const post = (body) => new Promise((res) => { const x = new XMLHttpRequest(); origOpen.call(x, "POST", lastSearch.url); for (const [k, v] of Object.entries(lastSearch.headers || {})) try { origSetH.call(x, k, v); } catch {}
      x.onloadend = () => { let j = null; try { j = JSON.parse(x.responseText); } catch {} res({status: x.status, j}); }; origSend.call(x, JSON.stringify(body)); });
    $("dnz-poas").disabled = true;
    try { for (let i = 0; i < 100; i++) {
        const r = await post({...base, pageIndex: first + i}); if (r.status !== 200 || !r.j?.data) { say(`توقف: ردّ ناجز ${r.status}. ما جُمع: ${out.size}.`); break; }
        total = r.j.data.totalCount ?? total; const items = r.j.data.searchResult || []; for (const it of items) { const p = poaRow(it); if (p.code) out.set(p.code, p); }
        say(`جُمعت ${out.size}${total ? " من " + total : ""} وكالة…`); if (!items.length || (total && out.size >= total)) break; await sleep(1500); }
      const payload = {kind: "diwan-najiz-poas", tool: TOOL, exportedAt: new Date().toISOString(), total, items: [...out.values()]};
      const t = JSON.stringify(payload); let ok = false; try { await navigator.clipboard.writeText(t); ok = true; } catch {}
      if (!ok) { const ta = $("dnz-paths"); ta.hidden = false; ta.value = t; ta.select(); try { ok = document.execCommand("copy"); } catch {} }
      say(ok ? `نُسخت ${out.size} وكالة — الصقها في الديوان: المزامنة ← ربط ناجز ← «لصق من الحافظة».` : `جُمعت ${out.size}؛ انسخ النص من المربع والصقه في الديوان.`); }
    finally { $("dnz-poas").disabled = false; } };
  $("dnz-pcopy").onclick = async () => { try { await navigator.clipboard.writeText($("dnz-paths").value); $("dnz-pcopy").textContent = "نُسخت"; } catch { $("dnz-paths").select(); } };
  const guessName = () => { const t = (document.querySelector("[class*=user-name],[class*=username],.user-info,.profile-name") || {}).textContent || ""; return t.trim().slice(0, 40); };
  let remembered = ""; try { remembered = localStorage.getItem("diwan.najiz.name") || ""; } catch {}
  $("dnz-name").value = acct || remembered || guessName();
  let result = null;
  const deliver = () => new Promise((resolve) => {
    if (!diwan) { resolve(false); return; }
    let done = false; const onAck = (e) => { if (e.data && e.data.type === "diwan-najiz-ack" && e.data.token === token) { done = true; window.removeEventListener("message", onAck); resolve(true); } };
    window.addEventListener("message", onAck);
    try { diwan.postMessage({type: "diwan-najiz-export", token, payload: result}, "*"); } catch { resolve(false); return; }
    setTimeout(() => { if (!done) { window.removeEventListener("message", onAck); resolve(false); } }, 4000);
  });
  $("dnz-go").onclick = async () => {
    const name = ($("dnz-name").value || "").trim() || "ناجز"; const withReq = $("dnz-req").checked; const withExec = $("dnz-exec").checked;
    try { localStorage.setItem("diwan.najiz.name", name); } catch {}
    $("dnz-step1").hidden = true; $("dnz-prog").hidden = false; $("dnz-err").hidden = true;
    const msg = (t, pct) => { $("dnz-msg").textContent = t; if (pct != null) $("dnz-bar").style.width = Math.round(pct) + "%"; };
    try {
      msg("يقرأ قائمة القضايا…", 2);
      const list = await page("ocelot/api/my-cases");
      let execs = {};
      if (withExec) { msg("يقرأ طلبات التنفيذ…", 3); try { execs = await collectExec((d, n) => msg(`يقرأ طلبات التنفيذ… ${d} من ${n}`, 3 + (list.length ? 20 : 90) * d / n)); } catch { execs = {}; } }
      if (!list.length && !Object.keys(execs).length) throw new Error("لم تُقرأ أي قضية ولا طلب تنفيذ. تأكد أنك مسجّل الدخول في ناجز بالحساب المطلوب، ثم أعد المحاولة.");
      let reqs = [];
      if (withReq) { msg("يقرأ صحائف الدعاوى…", 4); try { reqs = await page("requests/api/lawsuit-requests/my-requests"); } catch { reqs = []; } }
      const cases = {}; let i = 0, done = 0, err = 0;
      const worker = async () => { while (i < list.length) { const c = list[i++]; const k = c.objectKey; const base = BASE + "icms/api/cases/" + k;
          const [d, p, s, j] = await Promise.all([getJ(base), getJ(base + "/parties-details"), getJ(base + "/sessions"), getJ(base + "/judgments")]);
          cases[String(c.caseCode)] = {accts: [name], list: c, detail: d, parties: p, sess: s, judg: j};
          if (d && d.__err) err++; done++; msg(`يقرأ تفاصيل القضايا… ${done} من ${list.length}${err ? ` (تعذّر ${err})` : ""}`, 25 + 70 * done / list.length); } };
      await Promise.all([1, 2, 3, 4].map(worker));
      result = {exportedAt: new Date().toISOString(), tool: TOOL, account: name, cases, lists: {[name]: list.map(c => String(c.caseCode))}, reqs: {[name]: reqs}, execs, execLists: {[name]: Object.keys(execs)}};
      const nEx = Object.keys(execs).length;
      msg("اكتمل الجمع.", 100); $("dnz-prog").hidden = true; $("dnz-done").hidden = false;
      $("dnz-sum").textContent = `${list.length} قضية${withReq ? ` و${reqs.length} صحيفة` : ""}${withExec ? ` و${nEx} طلب تنفيذ` : ""} من حساب «${name}»${err ? `، وتعذّرت قراءة تفاصيل ${err} منها (تُعاد في المرة القادمة)` : ""}.`;
      if (diwan) { msg("يسلّم البيانات إلى الديوان…", 100); const ok = await deliver();
        if (ok) { $("dnz-sent").hidden = false; $("dnz-sent").textContent = "وصلت البيانات إلى الديوان ✓ — ارجع إلى نافذته واضغط «اعتماد التحديث». يمكنك إغلاق هذه النافذة."; $("dnz-alt").hidden = true; $("dnz-alt").style.display = "none"; $("dnz-hint").hidden = true; return; } }
      $("dnz-hint").textContent = diwan ? "لم تصل البيانات إلى نافذة الديوان؛ انسخها ثم اضغط «لصق من الحافظة» هناك، أو نزّلها ملفاً وارفعه." : "في الديوان: المزامنة والإضافة ← ربط ناجز ← «لصق من الحافظة» (أو ارفع الملف).";
    } catch (e) { $("dnz-prog").hidden = true; $("dnz-step1").hidden = false; $("dnz-err").hidden = false; $("dnz-err").textContent = e && e.message ? e.message : "تعذّر الجمع. أعد المحاولة."; }
  };
  $("dnz-copy").onclick = async () => { if (!result) return; const t = JSON.stringify(result); let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch { try { const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch {} }
    $("dnz-sent").hidden = false; $("dnz-sent").style.color = ok ? "#2f7d4f" : "#b3261e"; $("dnz-sent").textContent = ok ? "نُسخت البيانات ✓ — في الديوان اضغط «لصق من الحافظة»." : "لم يسمح المتصفح بالنسخ؛ نزّل الملف وارفعه في الديوان."; };
  if (acct && diwan) { const n = document.createElement("div"); n.style.cssText = "color:#484a66;font-size:12px;margin:0 0 6px"; n.textContent = `فتحه الديوان لحساب «${acctLabel}» — تأكد أنه الحساب النشط في ناجز.`; $("dnz-step1").prepend(n); setTimeout(() => { if (!$("dnz-step1").hidden) $("dnz-go").click(); }, 1200); }
  $("dnz-dl").onclick = () => { if (!result) return; const day = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(result)], {type: "application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ناجز - ${result.account} - ${day}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
})();
