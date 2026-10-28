/* ديوان القضايا — المستندات في السحابة (الخطوة 2)
   ملفات المكتب في Supabase بالمسارات نفسها التي كانت في ون درايف («Law Firm/…»)، ويقدّم للصفحة أدوات «Microsoft 365» الأربع
   (read_resource، sharepoint_search، sharepoint_folder_search، sharepoint_upload_file) بالصيغ نفسها، فيعمل كل ما في الديوان من
   مستندات (ربط المجلد برقم القضية، القارئ، حفظ الوورد في مجلد القضية، استخراج بيانات الموكل، بحث المساعد) دون تغيير فيه.
   نص كل ملف يُستخرج مرة واحدة في المتصفح ويُحفظ معه: PDF ووورد بقارئي الصفحة نفسها، والممسوح والصور بقارئ نصوص مجاني (Tesseract،
   عربي) يعمل في المتصفح بلا أي خدمة مدفوعة. وفيه لوحة «ملفات المكتب»: استيراد الأرشيف من الجهاز، والقراءة المجانية للممسوح.
   يحتاج قبله cloud-runtime.js (window.diwanCloud). */
(() => {
  "use strict";
  const C = window.diwanCloud; if (!C) return;
  const sb = C.sb, T = "files", BUCKET = "files", DRIVE = "diwan", SERVER = "Microsoft 365";
  const BASE = new URL(".", location.href).href;
  const OPEN = new Set(["active", "judged", "appeal", "supreme", "execution"]);
  const PAGE_SEP = "\n\f\n";
  const esc = (s) => String(s ?? "").replace(/[<>&"']/g, c => ({"<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"}[c]));
  const uriOf = (id) => `file:///${DRIVE}/${id}`;
  const idOf = (uri) => (/^file:\/\/\/diwan\/([0-9a-f-]{36})$/.exec(String(uri || "")) || [])[1] || null;
  // the page reads a folder's path from what follows «/Documents/» in its webUrl, as it did with OneDrive links
  const webUrlOf = (path) => BASE + "open.html#/Documents/" + String(path).split("/").map(encodeURIComponent).join("/");
  const extOf = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]{1,6})$/) || [])[1] || "";
  const MIME = {pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain", md: "text/plain", csv: "text/csv", rtf: "application/rtf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", gif: "image/gif", webp: "image/webp",
    tif: "image/tiff", tiff: "image/tiff", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", wav: "audio/wav", zip: "application/zip"};
  const mimeOf = (name, given) => given && given !== "application/octet-stream" ? given : (MIME[extOf(name)] || "application/octet-stream");
  const isImg = (name) => ["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff"].includes(extOf(name));
  const cleanName = (n) => String(n || "").replace(/[\/\\\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "ملف";
  const JUNK = (n) => /^(~\$|\.~lock)|^\.DS_Store$|^Thumbs\.db$|^desktop\.ini$|^\._/i.test(n);
  const tErr = (e) => ({code: e?.code && /^[a-z_]+$/.test(e.code) ? e.code : "tool_error", message: String(e?.message || e?.msg || e || "")});
  const COLS = "id,path,parent,name,is_folder,size,mime,case_id,internal,text_how,pages,modified_at,sha256,deleted_at";

  // the page hands over its own text readers (the same PDF/Word extraction the Diwan already tunes for Arabic)
  const F = window.diwanCloudFiles = {extractor: null};

  async function rowById(id, withText){
    const {data, error} = await sb.from(T).select(COLS + (withText ? ",text" : "")).eq("id", id).maybeSingle();
    if (error) throw tErr(error); return data;
  }
  async function rowByPath(path){ const {data} = await sb.from(T).select(COLS).eq("path", path).maybeSingle(); return data || null; }
  async function download(row){ const {data, error} = await sb.storage.from(BUCKET).download(row.id); if (error || !data) throw tErr(error || "download"); return data; }

  // ---------------------------------------------------------------- the text of a file, once
  const DIRECT = new Set(["pdf", "docx", "txt", "md", "csv"]);
  async function readText(name, bytes){
    const x = extOf(name), E = F.extractor;
    if (x === "pdf") { if (!E?.pdfText) return null; const r = await E.pdfText(bytes);
      const scanned = r.pages && (r.stats?.empty || 0) / r.pages > 0.5;
      return {text: r.text || "", how: scanned ? "none" : "pdf", pages: r.pages || null}; }
    if (x === "docx") { if (!E?.docxText) return null; return {text: await E.docxText(bytes), how: "docx", pages: 1}; }
    if (x === "txt" || x === "md" || x === "csv") return {text: new TextDecoder().decode(bytes), how: "plain", pages: 1};
    if (isImg(name)) return {text: "", how: "none", pages: 1};
    return {text: null, how: "na", pages: null};
  }
  async function extract(row, bytes){
    try { if (!bytes) bytes = new Uint8Array(await (await download(row)).arrayBuffer());
      const r = await readText(row.name, bytes); if (!r) return null;
      const {error} = await sb.from(T).update({text: r.text, text_how: r.how, pages: r.pages, text_at: new Date().toISOString()}).eq("id", row.id);
      if (error) throw error; return r;
    } catch (e) { await sb.from(T).update({text_how: "error", text_at: new Date().toISOString()}).eq("id", row.id); return {text: null, how: "error", error: e}; }
  }

  // ---------------------------------------------------------------- the four tools, as Microsoft 365 answers them
  const text = (t) => ({content: [{type: "text", text: t}]});
  const asItem = (r) => ({name: r.name, uri: uriOf(r.id), webUrl: webUrlOf(r.path), id: r.id, driveId: DRIVE, size: r.size, lastModifiedDateTime: r.modified_at});
  async function readResource({uri, startPage, endPage}){
    const id = idOf(uri); if (!id) throw {code: "tool_error", message: "unknown uri"};
    let row = await rowById(id, true); if (!row || row.deleted_at) throw {code: "tool_error", message: "not found"};
    if (row.is_folder) {
      const out = [];
      for (let off = 0; ; off += 1000) { const {data, error} = await sb.from(T).select("id,name,is_folder,size").eq("parent", row.path).is("deleted_at", null).order("is_folder", {ascending: false}).order("name").range(off, off + 999);
        if (error) throw tErr(error); out.push(...data); if (data.length < 1000) break; }
      return text(out.map(r => `${r.name.replace(/:/g, "&#x3a;")} (${r.is_folder ? "folder" : "file"}, ${r.size || 0} bytes) ${uriOf(r.id)}`).join("\n"));
    }
    if (row.text_how == null && DIRECT.has(extOf(row.name))) { const r = await extract(row); if (r) row = {...row, text: r.text, text_how: r.how}; }
    if (isImg(row.name) && !(row.text || "").trim()) {
      const b = new Uint8Array(await (await download(row)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return {content: [{type: "image", mimeType: row.mime || "image/jpeg", data: btoa(s)}]};
    }
    if (!(row.text || "").trim()) return text(JSON.stringify({note: "No text could be extracted from this file" + (row.text_how === "none" ? " (scanned; waiting for the free reader)" : "") + "."}));
    const pages = String(row.text).split(PAGE_SEP), n = pages.length;
    const a = Math.max(1, +startPage || 1), b = Math.min(n, +endPage || n);
    return text(pages.slice(a - 1, b).join("\n\n") + (b < n ? `\n[truncated: pages ${a}-${b} of ${n}]` : ""));
  }
  async function search(q, limit, folders){
    const {data, error} = await sb.rpc("files_search", {q: String(q || ""), lim: limit || 25, folders: !!folders});
    if (error) throw tErr(error);
    return {content: (data || []).map(r => ({type: "text", text: JSON.stringify(asItem(r))}))};
  }
  async function uploadTool({parentItemId, filename, contentBase64, conflictBehavior}){
    const parent = await rowById(parentItemId); if (!parent?.is_folder) throw {code: "tool_error", message: "parent folder not found"};
    const bin = atob(String(contentBase64 || "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const row = await F.uploadFile(parent.path, new Blob([bytes], {type: mimeOf(filename)}), filename, {conflict: conflictBehavior === "replace" ? "replace" : "rename", bytes});
    return text(JSON.stringify(asItem(row)));
  }
  F.mcp = {
    cloud: true,
    async callTool(server, tool, args = {}){
      if (server !== SERVER) throw {code: "server_not_connected", message: server};
      try {
        if (tool === "read_resource") return await readResource(args);
        if (tool === "sharepoint_search") return await search(args.query, args.limit, false);
        if (tool === "sharepoint_folder_search") return await search(args.name, args.limit, true);
        if (tool === "sharepoint_upload_file") return await uploadTool(args);
        throw {code: "tool_error", message: "unknown tool " + tool};
      } catch (e) { throw tErr(e); }
    }
  };

  // ---------------------------------------------------------------- writing files
  const folderCache = new Map();
  F.ensureFolder = async (path) => {
    path = String(path).split("/").map(cleanName).join("/");
    if (folderCache.has(path)) return folderCache.get(path);
    const {data, error} = await sb.rpc("files_ensure_folder", {p: path}); if (error) throw tErr(error);
    folderCache.set(path, data); return data;
  };
  // one file into a folder; «rename» keeps both on a clash (name (2).ext), «replace» overwrites, «skip» returns the existing row
  F.uploadFile = async (folderPath, blob, name, {conflict = "rename", bytes = null, extract: doExtract = true, internal = false} = {}) => {
    name = cleanName(name); const folder = await F.ensureFolder(folderPath);
    let path = folder.path + "/" + name, existing = await rowByPath(path);
    if (existing && conflict === "skip") return existing;
    if (existing && conflict === "rename") { const m = /^(.*?)(\.[^.]+)?$/.exec(name); for (let k = 2; existing; k++) { path = `${folder.path}/${m[1]} (${k})${m[2] || ""}`; existing = await rowByPath(path); } }
    const mime = mimeOf(name, blob.type);
    if (!bytes && blob.size <= 150e6) bytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = bytes ? await F.sha256(bytes) : null;
    let row;
    if (existing) { const {data, error} = await sb.from(T).update({size: blob.size, mime, sha256, text: null, text_how: null, pages: null, deleted_at: null}).eq("id", existing.id).select(COLS).single(); if (error) throw tErr(error); row = data; }
    else { const {data, error} = await sb.from(T).insert({path, size: blob.size, mime, sha256, internal}).select(COLS).single(); if (error) throw tErr(error); row = data; }
    const {error: ue} = await sb.storage.from(BUCKET).upload(row.id, blob, {contentType: mime, upsert: !!existing});
    if (ue) { if (!existing) await sb.from(T).delete().eq("id", row.id); throw tErr(ue); }
    if (doExtract && (DIRECT.has(extOf(name)) || isImg(name)) && blob.size < 60e6) {
      const r = await extract(row, bytes || new Uint8Array(await blob.arrayBuffer())); if (r) Object.assign(row, {text_how: r.how, pages: r.pages});
    } else if (!DIRECT.has(extOf(name)) && !isImg(name)) await sb.from(T).update({text_how: "na"}).eq("id", row.id);
    return {...row, uri: uriOf(row.id), webUrl: webUrlOf(row.path)};
  };
  F.uriOf = uriOf; F.webUrlOf = webUrlOf; F.idOf = idOf;
  F.sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");

  // ---------------------------------------------------------------- a client's papers, shared by their cases (no copies)
  // the client's folder of a case folder, as the page finds it (parts/extract.js: xUpPath) and as the database does (client_folder_of)
  F.clientFolderOf = (p) => { const s = String(p || "").split("/"); if (s.length < 3) return null; const up = s.slice(0, -1); if (/^\s*\d{2}\s*-\s*القضايا\s*$/.test(up.at(-1))) up.pop(); return up.length >= 3 ? up.join("/") : null; };
  F.clientDocs = async (caseId) => { const {data, error} = await sb.rpc("files_client_docs", {p_case: caseId}); if (error) throw tErr(error);
    return (data || []).filter(r => !JUNK(r.name)).map(r => ({...r, uri: uriOf(r.id), webUrl: webUrlOf(r.path)})); };
  // a documents.files entry, as the page keeps them in a case
  const entryOf = (r, kindOf) => ({name: r.name, uri: uriOf(r.id), size: r.size, webUrl: webUrlOf(r.path), path: r.path, modified: r.modified_at || new Date().toISOString(), kind: kindOf ? kindOf(r.name) : undefined, src: "user"});
  async function addToCase(caseId, entries){
    const c = C.cache.get("cases/" + caseId); if (!c) throw {code: "not_found", message: "القضية غير موجودة"};
    const have = new Set((c.documents?.files || []).map(f => f.uri)); const add = entries.filter(e => !have.has(e.uri)); if (!add.length) return 0;
    await C.db.doc("cases/" + caseId).update({documents: {...(c.documents || {}), files: [...add, ...(c.documents?.files || [])].slice(0, 300)}}); return add.length;
  }
  // shown in another case as well, without a copy: a link the database knows (what a representative may read) and an entry in the case
  F.linkFile = async (row, caseId, kindOf) => {
    const {error} = await sb.from("file_links").upsert({file_id: row.id, case_id: caseId}, {onConflict: "file_id,case_id", ignoreDuplicates: true}); if (error) throw tErr(error);
    return addToCase(caseId, [entryOf(row, kindOf)]);
  };
  F.unlinkFile = async (fileId, caseId) => {
    await sb.from("file_links").delete().eq("file_id", fileId).eq("case_id", caseId);
    const c = C.cache.get("cases/" + caseId); if (!c) return;
    const files = (c.documents?.files || []).filter(f => f.uri !== uriOf(fileId)); if (files.length !== (c.documents?.files || []).length) await C.db.doc("cases/" + caseId).update({documents: {...c.documents, files}});
  };

  // ---------------------------------------------------------------- identical files: one is kept, the others hidden (restorable)
  F.duplicates = async () => { const {data, error} = await sb.rpc("files_duplicates", {lim: 200}); if (error) throw tErr(error); return data || []; };
  // the copy to keep by default: the one in a client's folder (shared by the cases), else the one with the shortest path
  F.keepOf = (g) => { const items = g.items; const paper = items.find(it => { const parts = it.path.split("/"); return !parts.slice(0, -1).some(x => /^\s*\d{6,}/.test(x) || /^\s*\d{2}\s*-\s*القضايا\s*$/.test(x)); }); return (paper || items[0]).id; };
  F.dedupe = async (g, keepId, kindOf) => {
    const kept = g.items.find(it => it.id === keepId); if (!kept) throw {code: "invalid_argument", message: "keep"};
    const {data: keptRow} = await sb.from(T).select(COLS).eq("id", keepId).single(); let moved = 0;
    for (const it of g.items) { if (it.id === keepId) continue;
      const uri = uriOf(it.id), cases = new Set();
      // every case that showed the hidden copy shows the kept one instead
      for (const [k, c] of C.cache) { if (!/^cases\/[^/]+$/.test(k)) continue; const fs = c.documents?.files || []; if (!fs.some(f => f.uri === uri)) continue;
        const keepE = entryOf(keptRow, kindOf); const next = fs.some(f => f.uri === keepE.uri) ? fs.filter(f => f.uri !== uri) : fs.map(f => f.uri === uri ? {...f, ...keepE} : f);
        await C.db.doc(k).update({documents: {...c.documents, files: next}}); cases.add(k.slice(6)); }
      if (it.case_id && it.case_id !== keptRow.case_id) cases.add(it.case_id);
      const {data: links} = await sb.from("file_links").select("case_id").eq("file_id", it.id); for (const l of links || []) cases.add(l.case_id);
      for (const cid of cases) if (cid !== keptRow.case_id) await sb.from("file_links").upsert({file_id: keepId, case_id: cid}, {onConflict: "file_id,case_id", ignoreDuplicates: true});
      const {error} = await sb.from(T).update({deleted_at: new Date().toISOString()}).eq("id", it.id); if (error) throw tErr(error); moved++;
    }
    return moved;
  };
  F.hidden = async () => { const {data} = await sb.from(T).select("id,path,name,size,deleted_at").not("deleted_at", "is", null).order("deleted_at", {ascending: false}).limit(200); return data || []; };
  F.restore = async (id) => { const {error} = await sb.from(T).update({deleted_at: null}).eq("id", id); if (error) throw tErr(error); };
  // a folder's files the way the page lists a case folder (its own files, then up to six sub-folders), as documents.files entries
  F.listForCase = async (folderPath, kindOf) => {
    const {data, error} = await sb.from(T).select("id,path,parent,name,is_folder,size,modified_at").is("deleted_at", null).or(`parent.eq."${folderPath.replace(/"/g, '\\"')}",parent.like."${(folderPath + "/%").replace(/"/g, '\\"')}"`).eq("is_folder", false).order("modified_at", {ascending: false}).limit(500);
    if (error) throw tErr(error);
    const depth = folderPath.split("/").length;
    return (data || []).filter(r => r.parent.split("/").length <= depth + 1 && !JUNK(r.name)).slice(0, 120)
      .map(r => ({name: r.name, uri: uriOf(r.id), size: r.size, webUrl: webUrlOf(r.path), path: r.path, modified: r.modified_at, kind: kindOf ? kindOf(r.name) : undefined}));
  };

  // ---------------------------------------------------------------- the free reader for scans and photos (Tesseract, Arabic, in this browser)
  let ocrWorker = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  async function ocrReady(){
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) await loadScript(BASE + "ocr/tesseract.min.js");
    ocrWorker = await window.Tesseract.createWorker("ara", 1, {workerPath: BASE + "ocr/worker.min.js", corePath: BASE + "ocr/", langPath: BASE + "ocr/", gzip: true});
    return ocrWorker;
  }
  const ocrClean = (t) => String(t || "").replace(/[‎‏‪-‮]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  async function ocrRow(row, onPage){
    const w = await ocrReady(); const blob = await download(row); const out = [];
    if (extOf(row.name) === "pdf") {
      const lib = F.extractor?.needPdf ? await F.extractor.needPdf() : null; if (!lib) throw new Error("pdf.js");
      const pdf = await lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false}).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i); const vp = page.getViewport({scale: 2}); const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
        await page.render({canvasContext: cv.getContext("2d"), viewport: vp}).promise; page.cleanup?.();
        out.push(ocrClean((await w.recognize(cv)).data.text)); cv.width = cv.height = 0; onPage?.(i, pdf.numPages);
        if (F.ocr.stop && i < pdf.numPages) return {pages: out, complete: false};
      }
    } else { out.push(ocrClean((await w.recognize(blob)).data.text)); onPage?.(1, 1); }
    return {pages: out, complete: true};
  }
  // the queue: files never read yet (Word/PDF/text) first, then scans waiting for the free reader; open cases before the rest
  F.ocr = {running: false, stop: false, done: 0, pages: 0, failed: 0, current: null, left: null};
  async function queue(){
    const sel = "id,path,name,case_id,text_how,size";
    const [a, b] = await Promise.all([sb.from(T).select(sel).is("text_how", null).eq("is_folder", false).is("deleted_at", null).limit(1000), sb.from(T).select(sel).eq("text_how", "none").is("deleted_at", null).limit(1000)]);
    const rows = [...(a.data || []), ...(b.data || [])].filter(r => r.text_how === "none" || DIRECT.has(extOf(r.name)) || isImg(r.name));
    const open = (r) => { const c = r.case_id && C.cache.get("cases/" + r.case_id); return c && OPEN.has(c.status) ? 0 : r.case_id ? 1 : 2; };
    return rows.sort((x, y) => (x.text_how === "none") - (y.text_how === "none") || open(x) - open(y));
  }
  F.runReader = async (onChange) => {
    const st = F.ocr; if (st.running) return; Object.assign(st, {running: true, stop: false, done: 0, pages: 0, failed: 0, started: Date.now()});
    const seen = new Set();   // tried in this run (a file the page cannot read yet stays as it is, and is not tried again)
    try {
      for (;;) {
        const q = (await queue()).filter(r => !seen.has(r.id)); st.left = q.length; onChange?.(); if (!q.length || st.stop) break;
        for (const r of q.slice(0, 50)) {
          if (st.stop) break; seen.add(r.id); st.current = r.name; onChange?.();
          try {
            if (r.text_how == null) { if (!await extract({...r})) continue; }
            else { const o = await ocrRow(r, (i, n) => { st.page = `${i}/${n}`; st.pages++; onChange?.(); });
              if (!o.complete) break;   // stopped half way through a document: nothing is saved for it
              await sb.from(T).update({text: o.pages.join(PAGE_SEP), text_how: "ocr", pages: o.pages.length, text_at: new Date().toISOString()}).eq("id", r.id); }
            st.done++;
          } catch (e) { st.failed++; await sb.from(T).update({text_how: "error", text_at: new Date().toISOString()}).eq("id", r.id); }
          st.left = Math.max(0, st.left - 1); st.page = null; onChange?.();
        }
      }
    } finally { st.running = false; st.current = null; onChange?.(); }
  };

  // ---------------------------------------------------------------- archive import: the «Law Firm» folder from this computer
  const caseIndex = () => { const by = new Map();
    for (const [k, c] of C.cache) { if (!/^cases\/[^/]+$/.test(k) || c.deleted || (c.kind || "case") !== "case") continue; const id = k.slice(6);
      for (const n of [c.caseNo, ...(c.otherCaseNos || [])]) if (n && /^\d{6,}$/.test(String(n)) && !by.has(String(n))) by.set(String(n), id); }
    return by; };
  async function existingIndex(){ const m = new Map();
    for (let off = 0; ; off += 1000) { const {data, error} = await sb.from(T).select("path,size").eq("is_folder", false).order("path").range(off, off + 999); if (error) throw tErr(error);
      for (const r of data) m.set(r.path, r.size); if (data.length < 1000) break; }
    return m; }
  F.planImport = async (fileList) => {
    const files = [...fileList].filter(f => f.webkitRelativePath && !JUNK(f.name) && !f.webkitRelativePath.split("/").some(s => s.startsWith(".")));
    const byNo = caseIndex(), have = await existingIndex();
    const folders = new Map();     // case folder path → {no, caseId, files, bytes}
    const items = files.map(f => { const seg = f.webkitRelativePath.split("/"); seg[0] = "Law Firm"; const path = seg.map(cleanName).join("/");
      let cf = null; for (let i = 1; i < seg.length - 1; i++) { const m = /^\s*(\d{6,})/.exec(seg[i]); if (m) { cf = {path: seg.slice(0, i + 1).map(cleanName).join("/"), no: m[1]}; break; } }
      if (cf) { const g = folders.get(cf.path) || {path: cf.path, no: cf.no, caseId: byNo.get(cf.no) || null, files: 0, bytes: 0}; g.files++; g.bytes += f.size; folders.set(cf.path, g); }
      return {file: f, path, folder: cf?.path || null, done: have.get(path) === f.size}; });
    return {items, folders: [...folders.values()], total: items.length, bytes: items.reduce((s, x) => s + x.file.size, 0), done: items.filter(x => x.done).length};
  };
  F.runImport = async (plan, onChange) => {
    const st = plan.st = plan.st || {running: false, stop: false, ok: 0, failed: [], bytes: 0};
    if (st.running) return; st.running = true; st.stop = false;
    const cases = new Map(plan.folders.filter(g => g.caseId).map(g => [g.path, g.caseId]));
    const rank = (x) => { const id = x.folder && cases.get(x.folder); const c = id && C.cache.get("cases/" + id); return c && OPEN.has(c.status) ? 0 : id ? 1 : 2; };
    const todo = plan.items.filter(x => !x.done).sort((a, b) => rank(a) - rank(b));
    let i = 0;
    const worker = async () => { while (!st.stop && i < todo.length) { const x = todo[i++]; st.current = x.path; onChange?.();
        for (let tries = 0; ; tries++) {
          // upload only: reading the text of thousands of documents (large judgment collections among them) is heavy work for the
          // browser and slowed the upload to a crawl (28/10) — it is done afterwards by «ابدأ القراءة» (the queue takes unread files first)
          try { const dir = x.path.split("/").slice(0, -1).join("/"); await F.uploadFile(dir, x.file, x.file.name, {conflict: "replace", extract: false}); x.done = true; st.ok++; st.bytes += x.file.size; break; }
          catch (e) { if (tries >= 2) { st.failed.push({path: x.path, error: e.message || e.code}); break; } await new Promise(r => setTimeout(r, 1500 * (tries + 1))); }
        }
        onChange?.(); } };
    try { await Promise.all([worker(), worker(), worker()]); } finally { st.running = false; st.current = null; onChange?.(); }
  };
  // each case folder found by number (or chosen by hand) becomes its case's documents folder, and cases still pointing at
  // an OneDrive folder whose path was imported move to it
  F.linkCases = async (plan, kindOf) => {
    const res = {linked: 0, kept: 0};
    const pairs = new Map(plan.folders.filter(g => g.caseId).map(g => [g.caseId, g.path]));
    for (const [k, c] of C.cache) { if (!/^cases\/[^/]+$/.test(k) || c.deleted || pairs.has(k.slice(6))) continue; const p = c.documents?.folder?.path; if (p && !idOf(c.documents.folder.uri) && await rowByPath(p)) pairs.set(k.slice(6), p); }
    for (const [id, path] of pairs) {
      const c = C.cache.get("cases/" + id); if (!c) continue; const row = await rowByPath(path); if (!row) continue;
      // already in a folder of this archive (the same one, or one chosen by hand): left as it is
      if (idOf(c.documents?.folder?.uri)) { res.kept++; continue; }
      const files = await F.listForCase(path, kindOf);
      const documents = {...(c.documents || {}), folder: {name: row.name, path, uri: uriOf(row.id), webUrl: webUrlOf(path), itemId: row.id, itemIdFor: uriOf(row.id)}, files,
        confidence: "high", method: "رقم القضية في اسم المجلد", note: null, src: "import", scannedAt: new Date().toISOString()};
      await C.db.doc("cases/" + id).update({documents}); res.linked++;
    }
    return res;
  };

  // ---------------------------------------------------------------- the «ملفات المكتب» panel (office members)
  const fmtB = (n) => n > 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB";
  const ar = (n) => Number(n || 0).toLocaleString("ar-SA-u-nu-latn");
  let panel = null, plan = null, dup = null, hid = null;
  async function draw(){
    if (!panel) return;
    const {data: s} = await sb.rpc("files_stats"); const by = s?.by_how || {};
    const waitingText = (by.pending || 0), waitingScan = (by.none || 0);
    const o = F.ocr, ps = plan?.st;
    const speed = o.running && o.started ? Math.round(o.pages / Math.max(1, (Date.now() - o.started) / 60000)) : 0;
    panel.querySelector(".body").innerHTML = `
      <section><h3>في الديوان الآن</h3>
        <p>${ar(s?.files)} ملف · ${fmtB(s?.bytes || 0)} · ${ar(s?.with_case)} منها داخل مجلد قضية مربوطة</p>
        <p class="sub">نص مقروء: ${ar((by.pdf || 0) + (by.docx || 0) + (by.plain || 0))} مباشرة · ${ar(by.ocr || 0)} بالقراءة المجانية${by.ai ? ` · ${ar(by.ai)} بالمساعد` : ""} · بانتظار القراءة: ${ar(waitingText + waitingScan)}${by.error ? ` · تعذّرت قراءة ${ar(by.error)}` : ""}</p></section>
      <section><h3>استيراد الأرشيف من هذا الجهاز</h3>
        <p class="sub">نزّل مجلد «Law Firm» من ون درايف إلى جهازك (وفك ضغطه)، ثم اختره هنا. يُرفع كل شيء بمساراته نفسها، ويُربط مجلد كل قضية بقضيته برقمها، والقضايا المفتوحة أولاً. يمكن الإيقاف والعودة لاحقاً: ما رُفع لا يُرفع مرة ثانية. نص المستندات يُقرأ بعد الرفع من «ابدأ القراءة» أدناه.</p>
        <label class="pick"><input type="file" id="dfPick" webkitdirectory directory multiple ${ps?.running ? "disabled" : ""}> اختيار مجلد «Law Firm»</label>
        ${plan ? `<div class="plan">
          <p><b>${ar(plan.total)}</b> ملف (${fmtB(plan.bytes)}) · مرفوع سابقاً: ${ar(plan.done + (ps?.ok || 0))} · مجلدات قضايا: ${ar(plan.folders.length)} — عُرف منها ${ar(plan.folders.filter(g => g.caseId).length)} برقم القضية</p>
          ${plan.folders.some(g => !g.caseId) ? `<details><summary>مجلدات تبدأ برقم لا قضية به في الديوان (${ar(plan.folders.filter(g => !g.caseId).length)}) — اختر قضيتها أو اتركها بلا ربط</summary>
            ${plan.folders.filter(g => !g.caseId).slice(0, 300).map((g, i) => `<div class="row"><span class="nm" title="${esc(g.path)}">${esc(g.path.split("/").pop())}</span><span class="sub">${ar(g.files)} ملف</span>
              <input class="inp" data-unk="${esc(g.path)}" placeholder="رقم القضية أو معرّفها" value="${esc(g.manual || "")}"></div>`).join("")}</details>` : ""}
          ${ps ? `<p>${ps.running ? `يرفع… ${esc(ps.current || "")}` : "متوقف"} — رُفع ${ar(ps.ok)} (${fmtB(ps.bytes)})${ps.failed.length ? ` · تعذّر ${ar(ps.failed.length)}` : ""}</p>` : ""}
          <div class="btns">${ps?.running ? `<button id="dfStop">إيقاف</button>` : `<button id="dfGo" class="pri">${ps ? "متابعة الرفع" : "ابدأ الرفع"}</button>`}
            <button id="dfLink" ${ps?.running ? "disabled" : ""}>ربط المجلدات بالقضايا</button></div>
          ${ps?.failed?.length ? `<details><summary>ما تعذّر رفعه</summary>${ps.failed.slice(0, 200).map(f => `<div class="sub">${esc(f.path)} — ${esc(f.error)}</div>`).join("")}</details>` : ""}
          <p id="dfLinkOut" class="sub">${esc(plan.linkMsg || "")}</p></div>` : ""}</section>
      <section><h3>القراءة المجانية للمستندات الممسوحة والصور</h3>
        <p class="sub">تقرأ الصكوك والمستندات المصوّرة في هذا المتصفح بلا أي تكلفة (قارئ نصوص عربي)، فيجدها البحث ويقرؤها المساعد. دقتها أقل من المساعد، وتكفي للبحث في الغالب. تعمل ما دامت الصفحة مفتوحة، والقضايا المفتوحة أولاً.</p>
        <p>${o.running ? `يقرأ: ${esc(o.current || "")}${o.page ? ` (صفحة ${esc(o.page)})` : ""} — أُنجز ${ar(o.done)} ملف، ${ar(o.pages)} صفحة${speed ? `، نحو ${ar(speed)} صفحة في الدقيقة` : ""}، بقي ${ar(o.left)}` : `بانتظار القراءة: ${ar(waitingScan)} ممسوح، و${ar(waitingText)} لم يُقرأ بعد`}</p>
        <div class="btns">${o.running ? `<button id="ocStop">إيقاف</button>` : `<button id="ocGo" class="pri" ${waitingText + waitingScan ? "" : "disabled"}>ابدأ القراءة</button>`}</div></section>
      <section><h3>الملفات المكررة</h3>
        <p class="sub">ملفات محتواها واحد حرفياً (مثل وكالة نُسخت في مجلد كل قضية). تُبقي نسخة واحدة — المقترحة هي التي في مجلد الموكل، فتظهر في كل قضاياه — وتُخفى الباقية: كل قضية كانت تعرض نسخة مخفية تعرض المحفوظة بدلها، ولا يُحذف شيء نهائياً (تُستعاد من «المخفية»).</p>
        ${dup?.groups ? (dup.groups.length ? dup.groups.map((g, gi) => `<div class="grp"><p><b>${esc(g.items[0].name)}</b> <span class="sub">${ar(g.n)} نسخ · ${fmtB(g.bytes)} لكل نسخة</span></p>
          ${g.items.map(it => `<label class="row"><input type="radio" name="dk${gi}" value="${esc(it.id)}" ${(dup.keep[g.sha256] || F.keepOf(g)) === it.id ? "checked" : ""}><span class="nm" title="${esc(it.path)}">${esc(it.path.replace(/^Law Firm\//, ""))}</span></label>`).join("")}
          <div class="btns"><button data-dkeep="${gi}">أبقِ المختارة وأخفِ ${ar(g.n - 1)}</button></div></div>`).join("") : `<p>لا ملفات مكررة.</p>`) : ""}
        ${dup?.msg ? `<p class="sub">${esc(dup.msg)}</p>` : ""}
        <div class="btns"><button id="dupFind">${dup?.groups ? "أعد البحث" : "ابحث عن المكرر"}</button></div></section>
      <section><h3>المخفية</h3>
        <p class="sub">ما أُخفي من الملفات (المكرر وغيره) باقٍ في المخزن ويُستعاد بضغطة.</p>
        ${hid ? (hid.length ? hid.map(h => `<div class="row"><span class="nm" title="${esc(h.path)}">${esc(h.path.replace(/^Law Firm\//, ""))}</span><button data-restore="${esc(h.id)}">استعادة</button></div>`).join("") : `<p>لا شيء مخفي.</p>`) : ""}
        <div class="btns"><button id="hidShow">${hid ? "حدّث" : `اعرض المخفية (${ar(s?.hidden || 0)})`}</button></div></section>`;
    const pick = panel.querySelector("#dfPick"); if (pick) pick.onchange = () => F.importFiles(pick.files);
    panel.querySelectorAll("[data-unk]").forEach(inp => inp.onchange = () => { const g = plan.folders.find(x => x.path === inp.dataset.unk); const v = inp.value.trim(); g.manual = v;
      const byNo = caseIndex(); g.caseId = byNo.get(v) || (C.cache.get("cases/" + v) ? v : null); inp.style.borderColor = g.caseId ? "#2e7d32" : v ? "#c62828" : ""; });
    const go = panel.querySelector("#dfGo"); if (go) go.onclick = () => { F.runImport(plan, schedule); draw(); };
    const stop = panel.querySelector("#dfStop"); if (stop) stop.onclick = () => { plan.st.stop = true; };
    // the outcome lives in the plan, so the panel's redraws keep it
    const link = panel.querySelector("#dfLink"); if (link) link.onclick = async () => { plan.linkMsg = "يربط…"; draw();
      try { const r = await F.linkCases(plan, F.extractor?.docKind); plan.linkMsg = `رُبطت ${ar(r.linked)} قضية بمجلدها${r.kept ? `، و${ar(r.kept)} كانت مربوطة` : ""}.`; }
      catch (e) { plan.linkMsg = "تعذّر الربط: " + (e.message || e.code); }
      draw(); };
    const og = panel.querySelector("#ocGo"); if (og) og.onclick = () => { F.runReader(schedule); draw(); };
    const os = panel.querySelector("#ocStop"); if (os) os.onclick = () => { F.ocr.stop = true; };
    const df = panel.querySelector("#dupFind"); if (df) df.onclick = async () => { dup = {keep: dup?.keep || {}, msg: "يبحث…"}; draw(); try { dup.groups = await F.duplicates(); dup.msg = null; } catch (e) { dup.msg = "تعذّر البحث: " + (e.message || e.code); } draw(); };
    panel.querySelectorAll("[data-dkeep]").forEach(b => b.onclick = async () => { const g = dup.groups[+b.dataset.dkeep]; const keep = panel.querySelector(`input[name="dk${b.dataset.dkeep}"]:checked`)?.value || F.keepOf(g);
      const k = g.items.find(it => it.id === keep);
      if (!confirm(`تُبقى «${k.path.replace(/^Law Firm\//, "")}» وتُخفى ${g.n - 1} نسخة أخرى (تُستعاد من «المخفية»). متابعة؟`)) return;
      b.disabled = true; try { const n = await F.dedupe(g, keep, F.extractor?.docKind); dup.groups = dup.groups.filter(x => x !== g); dup.msg = `أُخفيت ${ar(n)} نسخة.`; } catch (e) { dup.msg = "تعذّر: " + (e.message || e.code); } draw(); });
    const hs = panel.querySelector("#hidShow"); if (hs) hs.onclick = async () => { hid = await F.hidden(); draw(); };
    panel.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => { b.disabled = true; try { await F.restore(b.dataset.restore); hid = await F.hidden(); } catch (e) { alert("تعذّرت الاستعادة"); } draw(); });
  }
  // the files of a chosen folder (each with its webkitRelativePath): planned, then shown for review before anything is uploaded
  F.importFiles = async (files) => {
    if (!files?.length || plan?.st?.running) return;
    panel?.querySelector(".body").insertAdjacentHTML("afterbegin", `<p class="sub">يفحص ${ar(files.length)} ملفاً…</p>`);
    plan = await F.planImport(files); draw();
  };
  let tick = null; const schedule = () => { if (tick) return; tick = setTimeout(() => { tick = null; draw(); chip(); }, 700); };
  function chip(){ const b = document.getElementById("dcFiles"); if (!b) return; const busy = F.ocr.running || plan?.st?.running;
    b.textContent = busy ? (plan?.st?.running ? `ملفات المكتب · يرفع ${ar(plan.st.ok)}` : `ملفات المكتب · يقرأ ${ar(F.ocr.done)}`) : "ملفات المكتب"; }
  function open(){
    if (panel) return; panel = document.createElement("div"); panel.dir = "rtl"; panel.id = "dcFilesPanel";
    panel.innerHTML = `<style>#dcFilesPanel{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.4);display:grid;place-items:center;padding:16px;font:14px/1.7 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif}
      #dcFilesPanel .box{background:#fff;color:#151547;border-radius:10px;width:min(720px,100%);max-height:90vh;overflow:auto;padding:20px}
      #dcFilesPanel h2{margin:0;font-size:18px} #dcFilesPanel h3{font-size:15px;margin:16px 0 4px} #dcFilesPanel section{border-top:1px solid #eee;padding-top:4px}
      #dcFilesPanel .sub{color:#666;font-size:13px;margin:2px 0} #dcFilesPanel p{margin:4px 0} #dcFilesPanel button,#dcFilesPanel .pick{font:inherit;border:1px solid #c9c5b8;background:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;display:inline-block}
      #dcFilesPanel .pri{background:#151547;color:#fff;border-color:#151547} #dcFilesPanel .pick input{display:none} #dcFilesPanel .btns{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      #dcFilesPanel .row{display:flex;gap:8px;align-items:center;margin:4px 0} #dcFilesPanel .row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #dcFilesPanel .inp{font:inherit;border:1px solid #ccc;border-radius:6px;padding:3px 6px;width:150px;direction:ltr}
      #dcFilesPanel .grp{border:1px solid #eee;border-radius:8px;padding:6px 10px;margin:6px 0} #dcFilesPanel label.row{cursor:pointer}
      @media (prefers-color-scheme: dark){#dcFilesPanel .box{background:#17173a;color:#eee}#dcFilesPanel .sub{color:#aaa}#dcFilesPanel button,#dcFilesPanel .pick{background:#0e0e24;color:#eee;border-color:#3b3b6b}#dcFilesPanel .pri{background:#c9a263;color:#151547}#dcFilesPanel section{border-color:#2b2b55}}</style>
      <div class="box"><div style="display:flex;justify-content:space-between;align-items:center"><h2>ملفات المكتب</h2><button data-x aria-label="إغلاق">×</button></div><div class="body"><p class="sub">يحمّل…</p></div></div>`;
    panel.querySelector("[data-x]").onclick = () => { panel.remove(); panel = null; };
    document.body.appendChild(panel); draw();
  }
  window.addEventListener("diwan-cloud-ready", () => {
    if (!C.whoami()?.staff) return;
    const bar = document.getElementById("diwanCloudBar"); const slot = bar?.querySelector("span:last-child"); if (!slot) return;
    const b = document.createElement("button"); b.id = "dcFiles"; b.textContent = "ملفات المكتب";
    b.style.cssText = "background:none;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit";
    b.onclick = open; slot.prepend(b);
  });
  window.addEventListener("beforeunload", (e) => { if (F.ocr.running || plan?.st?.running) { e.preventDefault(); e.returnValue = ""; } });
})();
