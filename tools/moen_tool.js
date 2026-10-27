/* أداة ديوان القضايا — قضايا ومواعيد ديوان المظالم من منصة معين
   تعمل من إشارة «تحديث الديوان من معين» في شريط الإشارات، وأنت في صفحة «قضاياي» أو «مواعيدي» بعد تسجيل الدخول.
   تقرأ الجدول المعروض أمامك في الصفحة فقط (لا تطلب شيئاً من المنصة ولا تغيّر فيها شيئاً)، وتجمع الصفحتين معاً
   في هذا التبويب، ثم تسلّم النتيجة إلى نافذة الديوان التي فتحتها؛ وإلا تنسخها إلى الحافظة لتُلصق في الديوان. */
(() => {
  if (window.__diwanMoen) { window.__diwanMoen.run(); return; }
  if (!/(^|\.)bog\.gov\.sa$/.test(location.hostname)) { alert("افتح هذه الأداة في منصة معين (moen.bog.gov.sa) بعد تسجيل الدخول، في صفحة «قضاياي» أو «مواعيدي»."); return; }
  const TOOL = "diwan-moen-tool/1";
  const KEY = "diwan.moen";
  const dig = (s) => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  const clean = (s) => dig(s).replace(/\s+/g, " ").trim();
  // each result row is a set of cells, and each cell carries its own heading («رقم الدعوى الموحد», «الدائرة»…) and value
  const rowsOf = (root) => [...root.querySelectorAll(".gv-row")].map(r => { const o = {};
    r.querySelectorAll(".cell").forEach(c => { const t = clean(c.querySelector(".title")?.textContent); const v = clean(c.querySelector(".content")?.textContent); if (t && t !== "التفاصيل") o[t] = v; });
    return o; }).filter(o => Object.keys(o).length > 2);
  const paged = (root) => !!root && [...root.querySelectorAll("pagination-controls,ngb-pagination,mat-paginator,.pagination,[class*=paginat]")].some(e => /[2-9٢-٩]/.test(e.textContent || ""));
  const isCaseRow = (o) => "رقم الطلب" in o || "الصفة" in o;
  const isApptRow = (o) => "تاريخ الموعد ميلادي" in o || "تاريخ الموعد هجري" in o;
  const rowKey = (o, kind) => kind === "cases" ? [o["رقم الدعوى الموحد"], o["رقم الطلب"], o["عام الطلب"]].join("|") : [o["رقم الدعوى الموحد"], o["تاريخ الموعد ميلادي"], o["وقت الموعد"]].join("|");
  function readPage(){
    const cEl = document.querySelector("my-cases-result"), aEl = document.querySelector("my-appointments-result");
    let cases = cEl ? rowsOf(cEl) : [], appts = aEl ? rowsOf(aEl) : [];
    if (!cEl && !aEl) { const all = rowsOf(document); cases = all.filter(isCaseRow); appts = all.filter(isApptRow); }
    cases = cases.filter(o => o["رقم الدعوى الموحد"]); appts = appts.filter(o => o["رقم الدعوى الموحد"] && isApptRow(o));
    return {cases, appts, casesPaged: paged(cEl), apptsPaged: paged(aEl), onCases: !!cEl || cases.length > 0, onAppts: !!aEl || appts.length > 0};
  }
  // what was read on the two pages stays together in this tab until it is handed over
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null") || {}; } catch { return {}; } };
  const save = (st) => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  function absorb(st, kind, rows, isPaged){
    // a page without more pages is the whole list: it replaces what was read before (a moved hearing does not linger)
    const prev = isPaged ? (st[kind] || {}) : {}; const next = {...prev};
    for (const o of rows) next[rowKey(o, kind)] = o;
    st[kind] = next; st[kind + "At"] = new Date().toISOString(); st[kind + "Paged"] = !!isPaged;
  }
  const nm = String(window.name || ""); const token = nm.startsWith("diwan-moen:") ? nm.slice(11).split(":")[0] : null;
  const diwan = () => token && window.opener && !window.opener.closed ? window.opener : null;
  // ---- the little window
  const box = document.createElement("div"); box.dir = "rtl"; box.lang = "ar";
  box.style.cssText = "position:fixed;top:16px;left:16px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);background:#fff;color:#171838;border:1px solid #d9d8e2;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px/1.6 system-ui,'Segoe UI',Tahoma,sans-serif;padding:14px 16px";
  const BTN = "background:#151547;color:#fff;border:0;border-radius:8px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer";
  const BTN2 = "background:#fff;color:#151547;border:1px solid #d9d8e2;border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer";
  box.innerHTML = `<div style="font-weight:700;font-size:15px;margin-bottom:4px">ديوان القضايا — تحديث من معين</div>
    <div id="dmn-sum" style="margin:6px 0"></div><div id="dmn-next" style="color:#484a66;font-size:13px;margin:4px 0"></div>
    <div id="dmn-sent" style="margin:6px 0;font-weight:700" hidden></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button id="dmn-send" style="${BTN}">تسليم للديوان</button><button id="dmn-copy" style="${BTN2}">نسخ البيانات للديوان</button><button id="dmn-clear" style="${BTN2}">بدء جديد</button></div>
    <div style="color:#6f718a;font-size:12px;margin-top:8px">تقرأ الأداة ما يظهر في الصفحة فقط، ولا ترسل شيئاً إلى غير نافذة الديوان.</div>
    <button id="dmn-x" title="إغلاق" style="position:absolute;top:8px;left:10px;background:none;border:0;font-size:18px;cursor:pointer;color:#6f718a">×</button>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector("#" + id);
  $("dmn-x").onclick = () => { box.hidden = true; };
  const payload = (st) => ({exportedAt: new Date().toISOString(), tool: TOOL, source: "moen",
    cases: Object.values(st.cases || {}), appts: st.appts ? Object.values(st.appts) : null,
    casesAt: st.casesAt || null, apptsAt: st.apptsAt || null, casesPaged: !!st.casesPaged, apptsPaged: !!st.apptsPaged});
  const say = (t, ok) => { const e = $("dmn-sent"); e.hidden = false; e.style.color = ok ? "#2f7d4f" : "#b3261e"; e.textContent = t; };
  const deliver = (p) => new Promise((resolve) => {
    const w = diwan(); if (!w) { resolve(false); return; }
    let done = false; const onAck = (e) => { if (e.data && e.data.type === "diwan-moen-ack" && e.data.token === token) { done = true; window.removeEventListener("message", onAck); resolve(true); } };
    window.addEventListener("message", onAck);
    try { w.postMessage({type: "diwan-moen-export", token, payload: p}, "*"); } catch { resolve(false); return; }
    setTimeout(() => { if (!done) { window.removeEventListener("message", onAck); resolve(false); } }, 4000);
  });
  async function send(){ const st = load(); const p = payload(st);
    if (!p.cases.length && !(p.appts || []).length) { say("لم تُقرأ قضايا ولا مواعيد بعد. افتح «قضاياي» أو «مواعيدي» ثم اضغط الإشارة.", false); return; }
    if (await deliver(p)) say("وصلت البيانات إلى الديوان ✓ — راجع الملخص هناك واضغط «اعتماد التحديث».", true);
    else say(diwan() ? "لم تصل البيانات إلى نافذة الديوان؛ اضغط «نسخ البيانات للديوان» ثم «لصق من الحافظة» هناك." : "لم يفتح الديوانُ هذه النافذة؛ اضغط «نسخ البيانات للديوان» ثم «لصق من الحافظة» في الديوان.", false); }
  $("dmn-send").onclick = send;
  $("dmn-copy").onclick = async () => { const t = JSON.stringify(payload(load())); let ok = false;
    try { await navigator.clipboard.writeText(t); ok = true; } catch { try { const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch {} }
    say(ok ? "نُسخت البيانات ✓ — في الديوان: المزامنة والإضافة ← ربط معين ← «لصق من الحافظة»." : "لم يسمح المتصفح بالنسخ؛ أعد المحاولة.", ok); };
  $("dmn-clear").onclick = () => { save({}); run(); };
  function run(){
    if (!box.isConnected) document.body.appendChild(box);   // the page redrew itself under the window
    box.hidden = false; $("dmn-sent").hidden = true;
    const r = readPage(); const st = load();
    if (r.onCases && r.cases.length) absorb(st, "cases", r.cases, r.casesPaged);
    if (r.onAppts) absorb(st, "appts", r.appts, r.apptsPaged);   // an empty «مواعيدي» is an answer too: no hearings ahead
    save(st);
    const nC = Object.keys(st.cases || {}).length, nA = st.appts ? Object.keys(st.appts).length : null;
    const units = new Set([...Object.values(st.cases || {}), ...Object.values(st.appts || {})].map(o => o["رقم الدعوى الموحد"]));
    $("dmn-sum").innerHTML = `<b>قضاياي:</b> ${st.cases ? nC + " طلب" : "لم تُقرأ بعد"}<br><b>مواعيدي:</b> ${nA != null ? nA + " موعد" : "لم تُقرأ بعد"}<br><span style="color:#484a66;font-size:13px">${units.size} دعوى بأرقامها الموحدة</span>`;
    const next = [];
    if (!r.onCases && !r.onAppts) next.push("هذه الصفحة ليست «قضاياي» ولا «مواعيدي». افتح إحداهما من «الخدمات القضائية» ← «بدء الخدمة»، ثم اضغط الإشارة مرة أخرى.");
    if ((r.onCases && r.casesPaged) || (r.onAppts && r.apptsPaged)) next.push("النتائج على أكثر من صفحة: انتقل إلى كل صفحة واضغط الإشارة فيها، فتُجمع كلها.");
    if (st.cases && nA == null) next.push("الآن افتح «مواعيدي» واضغط الإشارة لتُضاف الجلسات.");
    if (!st.cases && nA != null) next.push("افتح «قضاياي» أيضاً واضغط الإشارة لتُضاف أطراف الدعاوى وصفتك فيها.");
    $("dmn-next").textContent = next.join(" ");
    if (diwan() && (r.cases.length || r.onAppts)) send();
  }
  window.__diwanMoen = {run};
  run();
})();
