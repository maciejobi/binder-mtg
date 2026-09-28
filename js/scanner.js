/* Binder MTG – photo scanner.
   Local engine: OpenCV.js finds card rectangles, Tesseract.js reads each title bar (and the set line),
   the fuzzy matcher maps OCR text to real card names, Scryfall resolves the printing.
   Optional Claude engine: sends the photo to the Claude API with the user's own key. */
(function (B) {
  "use strict";
  const $ = B.$, esc = B.esc;
  const LIBS = {
    opencv: "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js",
    tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js",
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
    core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    lang: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  };
  B.SCAN_LIBS = LIBS;

  /* ---------- lazy library loading ---------- */
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) scriptCache[src] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error("Nie udało się pobrać biblioteki: " + src.split("/npm/")[1])); };
      document.head.appendChild(s);
    });
    return scriptCache[src];
  }
  let cvReady = null;
  function getCV() {
    if (!cvReady) cvReady = (async () => {
      await loadScript(LIBS.opencv);
      // opencv.js exposes an Emscripten module that becomes usable once its runtime is initialised.
      // (It is "thenable", so it must not be awaited directly.) Poll until cv.Mat exists.
      const t0 = Date.now();
      while (!(window.cv && window.cv.Mat && window.cv.imread)) {
        if (Date.now() - t0 > 90000) throw new Error("Biblioteka wykrywania kart nie uruchomiła się. Odśwież stronę.");
        await B.sleep(60);
      }
      // the module is "thenable": resolving a promise with it loops forever, so drop .then
      try { window.cv.then = undefined; } catch (e) {}
      return { cv: window.cv };
    })().catch((e) => { cvReady = null; throw e; });
    return cvReady;
  }
  let sched = null;
  async function getOCR(progress) {
    if (sched) return sched;
    await loadScript(LIBS.tesseract);
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    const s = Tesseract.createScheduler();
    for (let i = 0; i < n; i++) {
      progress && progress(`Uruchamiam OCR (${i + 1}/${n})…`);
      const w = await Tesseract.createWorker("eng", 1, { workerPath: LIBS.worker, corePath: LIBS.core, langPath: LIBS.lang, cacheMethod: "write" });
      await w.setParameters({ tessedit_pageseg_mode: "7", preserve_interword_spaces: "1" });
      s.addWorker(w);
    }
    sched = s; return s;
  }

  /* ---------- image helpers ---------- */
  async function fileToCanvas(file, maxSide) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Nie można otworzyć zdjęcia.")); i.src = URL.createObjectURL(file); });
    }
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return c;
  }
  function subCanvas(src, x, y, w, h, scale = 1) {
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height); return c;
  }
  function rotateCanvas(src, deg) {
    if (!deg) return src;
    const c = document.createElement("canvas"); const sw = deg % 180 !== 0;
    c.width = sw ? src.height : src.width; c.height = sw ? src.width : src.height;
    const g = c.getContext("2d"); g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(src, -src.width / 2, -src.height / 2); return c;
  }
  /* grayscale + contrast stretch, inverted when text is light on dark */
  function prepText(src, binar) {
    const c = subCanvas(src, 0, 0, src.width, src.height, src.height < 60 ? 60 / src.height : 1);
    const g = c.getContext("2d"); const d = g.getImageData(0, 0, c.width, c.height); const a = d.data;
    let min = 255, max = 0, sum = 0; const n = a.length / 4; const lum = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = (a[i * 4] * 0.299 + a[i * 4 + 1] * 0.587 + a[i * 4 + 2] * 0.114) | 0; lum[i] = v; sum += v; if (v < min) min = v; if (v > max) max = v; }
    const mean = sum / n; const inv = mean < 118; const span = Math.max(1, max - min);
    // Otsu threshold for the binarised variant
    let thr = 128;
    if (binar) {
      const hist = new Array(256).fill(0); for (let i = 0; i < n; i++) hist[lum[i]]++;
      let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
      let sB = 0, wB = 0, best = 0;
      for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sumAll - sB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
    }
    for (let i = 0; i < n; i++) {
      let v = binar ? (lum[i] > thr ? 255 : 0) : ((lum[i] - min) * 255 / span) | 0;
      if (inv) v = 255 - v;
      a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v; a[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    // white margin helps Tesseract with glyphs touching the edge
    const out = document.createElement("canvas"); out.width = c.width + 24; out.height = c.height + 24;
    const og = out.getContext("2d"); og.fillStyle = "#fff"; og.fillRect(0, 0, out.width, out.height); og.drawImage(c, 12, 12);
    return out;
  }

  /* ---------- card detection with OpenCV ---------- */
  function orderQuad(pts) {
    // returns [tl, tr, br, bl]
    const s = pts.map((p) => p.x + p.y), d = pts.map((p) => p.y - p.x);
    return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))], pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]];
  }
  function detectCards(cv, canvas) {
    const src = cv.imread(canvas); const area = src.cols * src.rows;
    const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = new cv.Mat(); cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const cands = [];
    const tryMask = (mask) => {
      const contours = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mask, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const a = cv.contourArea(cnt);
        if (a < area * 0.004 || a > area * 0.6) { cnt.delete(); continue; }
        const r = cv.minAreaRect(cnt);
        const w = r.size.width, h = r.size.height; const ratio = Math.min(w, h) / Math.max(w, h);
        const rectness = a / (w * h);
        if (ratio > 0.6 && ratio < 0.82 && rectness > 0.72) {
          const pts = cv.RotatedRect.points(r);
          cands.push({ cx: r.center.x, cy: r.center.y, w: Math.min(w, h), h: Math.max(w, h), area: w * h, pts: pts.map((p) => ({ x: p.x, y: p.y })), score: rectness - Math.abs(ratio - 0.716) * 2 });
        }
        cnt.delete();
      }
      contours.delete(); hier.delete();
    };
    // pass 1: edges
    const edges = new cv.Mat(); cv.Canny(blur, edges, 40, 120);
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, k, new cv.Point(-1, -1), 2);
    tryMask(edges);
    // pass 2: adaptive threshold (helps on busy backgrounds)
    const thr = new cv.Mat(); cv.adaptiveThreshold(blur, thr, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 7);
    cv.morphologyEx(thr, thr, cv.MORPH_CLOSE, k, new cv.Point(-1, -1), 2);
    tryMask(thr);
    [src, gray, blur, edges, thr, k].forEach((m) => m.delete());
    if (!cands.length) return [];
    // 1) merge duplicates (same rectangle found by both passes)
    cands.sort((a, b) => b.score - a.score || b.area - a.area);
    let keep = [];
    for (const c of cands) {
      if (keep.some((k2) => Math.hypot(k2.cx - c.cx, k2.cy - c.cy) < Math.min(k2.w, c.w) * 0.15 && c.area / k2.area > 0.75 && c.area / k2.area < 1.33)) continue;
      keep.push(c);
    }
    // 2) containment: a box holding 2+ separate card-sized boxes is a group of cards (drop it);
    //    a box holding exactly one smaller card-shaped box is a card and the inner one is its art frame (drop the inner)
    const box = (o) => { const xs = o.pts.map((p) => p.x), ys = o.pts.map((p) => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const inside = (c, o) => { const [x0, y0, x1, y1] = box(o); return c.cx > x0 && c.cx < x1 && c.cy > y0 && c.cy < y1; };
    const inners = keep.map((a) => keep.filter((b) => b !== a && b.area < a.area / 1.25 && b.area > a.area / 14 && inside(b, a)));
    const separate = (list) => { const out = []; for (const b of list.sort((x, y) => y.area - x.area)) if (!out.some((o) => inside(b, o) || inside(o, b))) out.push(b); return out; };
    const drop = new Set();
    keep.forEach((a, i) => { if (separate(inners[i].slice()).length >= 2) drop.add(a); });
    keep.forEach((a, i) => { if (drop.has(a)) return; const inn = inners[i].filter((b) => !drop.has(b)); if (inn.length && separate(inn.slice()).length === 1) inn.forEach((b) => drop.add(b)); });
    keep = keep.filter((c) => !drop.has(c));
    if (!keep.length) return [];
    // cards in one photo have similar size: drop outliers relative to the median
    const med = keep.map((c) => c.area).sort((a, b) => a - b)[Math.floor(keep.length / 2)];
    keep = keep.filter((c) => c.area > med * 0.45 && c.area < med * 2.2);
    // reading order: rows then columns
    const mh = keep.map((c) => c.h).sort((a, b) => a - b)[Math.floor(keep.length / 2)] || 1;
    keep.sort((a, b) => (Math.abs(a.cy - b.cy) < mh * 0.5 ? a.cx - b.cx : a.cy - b.cy));
    return keep;
  }
  function warpCard(cv, canvas, cand, W = 630, H = 880) {
    let [tl, tr, br, bl] = orderQuad(cand.pts);
    const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y), hLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const landscape = wTop > hLeft * 1.1;
    const src = cv.imread(canvas);
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    const w = landscape ? H : W, h = landscape ? W : H;
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
    const M = cv.getPerspectiveTransform(from, to); const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const out = document.createElement("canvas"); cv.imshow(out, dst);
    [src, from, to, M, dst].forEach((m) => m.delete());
    return { canvas: out, landscape };
  }
  function gridCells(canvas, rows, cols) {
    const out = []; const cw = canvas.width / cols, ch = canvas.height / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ canvas: subCanvas(canvas, c * cw, r * ch, cw, ch), landscape: false });
    return out;
  }

  /* ---------- OCR of one card ---------- */
  const TITLE = { x: 0.065, y: 0.038, w: 0.80, h: 0.066 };
  const SETLINE = { x: 0.035, y: 0.935, w: 0.45, h: 0.055 };
  function region(card, r) { return subCanvas(card, card.width * r.x, card.height * r.y, card.width * r.w, card.height * r.h); }
  async function ocr(s, canvas, psm) {
    const { data } = await s.addJob("recognize", canvas, psm ? { tessedit_pageseg_mode: psm } : undefined);
    return (data.text || "").replace(/\s+/g, " ").trim();
  }
  async function readCard(s, cardCanvas, opts) {
    const tries = opts.landscape ? [90, 270, 0, 180] : [0, 180];
    let best = null;
    for (const deg of tries) {
      const card = rotateCanvas(cardCanvas, deg);
      const title = region(card, TITLE);
      for (const bin of [false, true]) {
        const txt = await ocr(s, prepText(title, bin));
        const m = B.names.match(txt);
        const cand = { text: txt, match: m, deg, card, titleImg: title };
        if (!best || (m && (!best.match || m.score > best.match.score))) best = cand;
        if (m && m.score >= 0.86) break;
      }
      if (best.match && best.match.score >= 0.8) break;
    }
    // fallback: a taller title window helps when the card box was found slightly off
    if (!best.match || best.match.score < 0.72) {
      const TITLE2 = { x: 0.045, y: 0.022, w: 0.86, h: 0.095 };
      for (const deg of [best.deg, (best.deg + 180) % 360]) {
        const card = rotateCanvas(cardCanvas, deg);
        for (const bin of [false, true]) {
          const txt = await ocr(s, prepText(region(card, TITLE2), bin));
          const m = B.names.match(txt);
          if (m && (!best.match || m.score > best.match.score)) best = { text: txt, match: m, deg, card, titleImg: null };
        }
        if (best.match && best.match.score >= 0.8) break;
      }
    }
    best.set = ""; best.cn = "";
    if (opts.readSet && best.match) {
      const line = await ocr(s, prepText(region(best.card, SETLINE), false), "6");
      const up = line.toUpperCase();
      const codes = opts.setCodes;
      const tok = up.match(/[A-Z0-9]{3,5}/g) || [];
      best.set = tok.find((t) => codes.has(t) && !/^\d+$/.test(t)) || "";
      const num = up.match(/\b0*(\d{1,4})\b/);
      if (best.set && num) best.cn = num[1];
      best.setText = line;
    }
    return best;
  }

  /* ---------- Claude vision engine ---------- */
  async function readWithClaude(file) {
    const canvas = await fileToCanvas(file, 2000);
    const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    const prompt = `Na zdjęciu są karty Magic: The Gathering. Wypisz KAŻDĄ widoczną kartę dokładnie raz, w kolejności czytania (rzędami, od lewej górnej).
Dla każdej: "name" – angielska nazwa dokładnie jak w tytule (karta nieangielska: oficjalna nazwa angielska), "set" – kod edycji z lewego dolnego rogu (np. HOB) lub "", "num" – numer kolekcjonerski bez zer wiodących lub "", "conf" – high/medium/low.
Pomiń żetony i rewersy. Odpowiedz tylko JSON: {"cards":[{"name":"Old Thrush","set":"HOB","num":"2","conf":"high"}]}`;
    const res = await B.claude.ask([{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: prompt }], { json: true, maxTokens: 3000 });
    return { canvas, cards: Array.isArray(res.cards) ? res.cards : [] };
  }

  /* ---------- state + UI ---------- */
  let photos = [], pid = 0, running = false, stopFlag = false;
  let rev = B.store.get("scan", []); // review rows
  function saveRev() { B.store.set("scan", rev.map((r) => ({ ...r, thumb: r.thumb && r.thumb.length < 40000 ? r.thumb : "" }))); }
  const status = (t, err) => { const el = $("#s-status"); el.textContent = t; el.className = "status" + (err ? " err" : ""); };

  function renderPhotos() {
    $("#s-photos").innerHTML = photos.map((p) => `<div class="photo ${p.st}"><img src="${p.url}" alt="Zdjęcie ${p.id}"><button class="x" data-rm="${p.id}" ${p.st === "reading" ? "disabled" : ""} aria-label="Usuń zdjęcie">×</button><div class="st"><span>${esc(p.msg)}</span>${p.st === "done" ? `<span class="flag ok">${p.n}</span>` : p.st === "error" ? `<span class="flag bad">błąd</span>` : ""}</div>${p.debug ? `<button class="linkish dbg" data-dbg="${p.id}">pokaż wykryte</button>` : ""}</div>`).join("");
    const pend = photos.filter((p) => p.st === "pending" || p.st === "error").length;
    $("#s-go").disabled = !pend || running;
    $("#s-go").textContent = pend > 1 ? `Odczytaj karty (${pend} zdjęć)` : "Odczytaj karty";
  }

  function rowHtml(r) {
    const alts = r.score >= 0.9 ? [] : (r.alts || []);
    return `<tr data-id="${r.id}" class="${r.name ? "" : "unmatched"}">
      <td><input type="checkbox" data-f="on" ${r.on ? "checked" : ""} ${r.card ? "" : "disabled"} aria-label="Dodaj"></td>
      <td class="thumbs">${r.thumb ? `<img class="crop" src="${r.thumb}" alt="Fragment zdjęcia">` : ""}${r.card && r.card.imgS ? `<img class="mini" src="${esc(r.card.imgS)}" alt="">` : ""}</td>
      <td>${r.card ? `<button class="linkish" data-f="open"><b>${esc(r.card.name)}</b></button>` : ""}
        <div class="nameedit"><input class="inp ${r.name ? "" : "bad"}" data-f="name" value="${esc(r.name || r.text || "")}" list="s-names" aria-label="Nazwa karty" placeholder="Wpisz nazwę karty"></div>
        ${alts.length ? `<div class="alts">Może: ${alts.slice(0, 4).map((a) => `<button class="chipbtn" data-alt="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : ""}
        <div class="readas">${r.text && r.name && B.norm(r.text) !== B.norm(r.name) ? `OCR: „${esc(r.text)}” · ` : ""}${r.score ? `<span class="${r.score < 0.8 ? "low" : ""}">pewność ${Math.round(r.score * 100)}%</span>` : r.name ? "" : "nie rozpoznano – wpisz nazwę"}</div></td>
      <td>${r.card ? `${esc(r.card.set)} #${esc(r.card.cn)}<div>${B.legalFlag(r.card)}</div>` : r.loading ? "szukam…" : ""}</td>
      <td><input type="number" class="inp" data-f="q" min="1" max="99" value="${r.q}" aria-label="Liczba"></td>
      <td><button class="btn sm" data-f="rm" aria-label="Usuń">×</button></td></tr>`;
  }
  function renderRev() {
    $("#s-rev").hidden = !rev.length;
    const on = rev.filter((r) => r.on && r.card); const tot = on.reduce((a, r) => a + r.q, 0);
    $("#s-accept").textContent = `Akceptuj i dodaj do kolekcji (${tot})`; $("#s-accept").disabled = !tot;
    $("#s-revtab").innerHTML = `<thead><tr><th></th><th>Zdjęcie / karta</th><th>Nazwa</th><th>Wydruk</th><th>Szt.</th><th></th></tr></thead><tbody>${rev.map(rowHtml).join("")}</tbody>`;
    $("#s-count").textContent = rev.length ? `${rev.length} pozycji · ${rev.filter((r) => !r.card).length} do poprawienia` : "";
  }

  /* resolve names -> Scryfall cards (batched) */
  async function resolveRows(rows) {
    const need = rows.filter((r) => r.name && !r.card);
    if (!need.length) return;
    need.forEach((r) => (r.loading = true)); renderRev();
    const ids = need.map((r) => (r.set && r.cn ? { set: r.set.toLowerCase(), collector_number: r.cn } : { name: r.name }));
    let found = [];
    try { found = (await B.sf.collection(ids)).found; } catch (e) { status(e.message, true); }
    const bySetNum = new Map(found.map((c) => [c.set + "|" + c.cn, c]));
    const byName = new Map(); found.forEach((c) => { byName.set(B.norm(c.name), c); if (c.faces) c.faces.forEach((f) => byName.set(B.norm(f.name), c)); });
    const retry = [];
    const front = (n) => B.norm(String(n).split(" // ")[0]);
    const nameOk = (c, n) => B.norm(c.name).startsWith(front(n)) || (c.faces || []).some((f) => B.norm(f.name) === front(n));
    for (const r of need) {
      r.loading = false;
      let c = r.set && r.cn ? bySetNum.get(r.set.toUpperCase() + "|" + r.cn) : null;
      if (c && !nameOk(c, r.name)) c = null;
      if (!c) c = byName.get(B.norm(r.name)) || byName.get(front(r.name)) || null;
      if (c) { r.card = c; r.on = true; }
      else if (r.set && r.cn) retry.push(r); // set/number misread – retry by name only
      else { r.card = null; r.on = false; }
    }
    if (retry.length) { retry.forEach((r) => { r.set = ""; r.cn = ""; }); await resolveRows(retry); }
    renderRev(); saveRev();
  }

  async function processPhoto(p, engine) {
    p.st = "reading"; p.msg = "Wczytuję zdjęcie…"; renderPhotos();
    const layout = $("#s-layout").value; const readSet = $("#s-readset").checked;
    const newRows = [];
    if (engine === "claude") {
      p.msg = "Claude czyta zdjęcie…"; renderPhotos();
      const { cards } = await readWithClaude(p.file);
      await B.names.load().catch(() => {});
      for (const c of cards) {
        const raw = String(c.name || "").trim(); if (!raw) continue;
        const m = B.names.size ? B.names.match(raw) : { name: raw, score: 1, alts: [] };
        newRows.push({ id: Math.random().toString(36).slice(2), text: raw, name: m ? m.name : "", score: m ? (c.conf === "low" ? Math.min(0.7, m.score) : m.score) : 0, alts: m ? m.alts : [], set: String(c.set || ""), cn: String(c.num || ""), q: 1, on: false, card: null, thumb: "", ph: p.id });
      }
    } else {
      p.msg = "Ładuję silnik OCR…"; renderPhotos();
      const [cvw, s] = await Promise.all([getCV(), getOCR((t) => { p.msg = t; renderPhotos(); }), B.names.load()]); const cv = cvw.cv;
      const canvas = await fileToCanvas(p.file, 2600);
      let cards;
      if (layout === "auto") {
        p.msg = "Szukam kart na zdjęciu…"; renderPhotos();
        const found = detectCards(cv, canvas);
        cards = found.map((f) => warpCard(cv, canvas, f));
        p.debug = drawDebug(canvas, found);
        if (!cards.length) throw new Error("Nie znalazłem kart na zdjęciu. Połóż je na gładkim, kontrastowym tle albo wybierz układ siatki (np. 4 × 4).");
      } else {
        const [r, c] = layout.split("x").map(Number); cards = gridCells(canvas, r, c);
      }
      const setCodes = new Set((B.state.sets || []).map((x) => x.code));
      for (let i = 0; i < cards.length; i++) {
        if (stopFlag) break;
        p.msg = `Czytam kartę ${i + 1} z ${cards.length}…`; renderPhotos();
        const w = cards[i];
        const res = await readCard(s, w.canvas, { landscape: w.landscape, readSet, setCodes });
        const thumb = subCanvas(res.card, 0, 0, res.card.width, res.card.height * 0.16, 260 / res.card.width).toDataURL("image/jpeg", 0.7);
        newRows.push({ id: Math.random().toString(36).slice(2), text: res.text, name: res.match ? res.match.name : "", score: res.match ? res.match.score : 0, alts: res.match ? res.match.alts : [], set: res.set, cn: res.cn, q: 1, on: false, card: null, thumb, ph: p.id });
      }
    }
    rev = rev.concat(newRows); renderRev();
    p.msg = "Szukam kart w Scryfall…"; renderPhotos();
    await resolveRows(newRows);
    p.st = "done"; p.n = newRows.length; p.msg = `${newRows.length} kart`;
  }
  function drawDebug(canvas, found) {
    const k = Math.min(1, 900 / canvas.width);
    const c = subCanvas(canvas, 0, 0, canvas.width, canvas.height, k); const g = c.getContext("2d");
    g.lineWidth = 4; g.strokeStyle = "#35E07A"; g.fillStyle = "#35E07A"; g.font = "bold 22px sans-serif";
    found.forEach((f, i) => { const q = orderQuad(f.pts); g.beginPath(); q.forEach((p, j) => (j ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k))); g.closePath(); g.stroke(); g.fillText(String(i + 1), f.cx * k - 8, f.cy * k + 8); });
    return c.toDataURL("image/jpeg", 0.75);
  }

  async function runAll() {
    const engine = $("#s-engine").value;
    if (engine === "claude" && !B.claude.hasKey()) { status("Aby użyć Claude, wpisz swój klucz API w Ustawieniach.", true); return; }
    running = true; stopFlag = false; $("#s-stop").hidden = false; renderPhotos(); status("");
    const t0 = Date.now(); let n = 0;
    for (const p of photos) {
      if (stopFlag) break;
      if (p.st !== "pending" && p.st !== "error") continue;
      try { await processPhoto(p, engine); n += p.n; }
      catch (e) { console.error(e); p.st = "error"; p.msg = e.message.length > 60 ? "błąd" : e.message; status(e.message, true); }
      renderPhotos();
    }
    running = false; $("#s-stop").hidden = true; renderPhotos();
    if (n) status(`Odczytano ${n} kart w ${Math.round((Date.now() - t0) / 1000)} s. Sprawdź listę poniżej i zaakceptuj.`);
  }

  B.initScanner = () => {
    const add = (files) => { for (const f of files) if (/^image\//.test(f.type || "image/")) photos.push({ id: ++pid, file: f, url: URL.createObjectURL(f), st: "pending", msg: "czeka" }); renderPhotos(); };
    ["#s-cam", "#s-pick"].forEach((sel) => { const el = $(sel); el.onchange = () => { add([...el.files]); el.value = ""; }; });
    const drop = $("#s-drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); });
    $("#s-photos").addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]"); if (rm) { const i = photos.findIndex((p) => p.id === +rm.dataset.rm); if (i >= 0) { URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); renderPhotos(); } return; }
      const dbg = e.target.closest("[data-dbg]"); if (dbg) { const p = photos.find((x) => x.id === +dbg.dataset.dbg); $("#pane").innerHTML = `<div class="row" style="justify-content:space-between"><b>Wykryte karty (${p.n || 0})</b><button class="btn sm" data-close>Zamknij</button></div><img src="${p.debug}" alt="Wykryte karty" style="width:100%;border-radius:8px"><p class="meta">Zielone ramki to karty znalezione na zdjęciu. Jeśli jakiejś brakuje, wybierz układ siatki albo zrób zdjęcie na gładszym tle.</p>`; $("#drawer").hidden = false; }
    });
    $("#s-go").onclick = runAll;
    $("#s-stop").onclick = () => { stopFlag = true; status("Zatrzymuję po bieżącej karcie…"); };
    $("#s-engine").value = B.store.get("scanEngine", "local");
    $("#s-engine").onchange = (e) => { B.store.set("scanEngine", e.target.value); };
    $("#s-layout").value = B.store.get("scanLayout", "auto");
    $("#s-layout").onchange = (e) => B.store.set("scanLayout", e.target.value);
    $("#s-readset").checked = B.store.get("scanSet", true);
    $("#s-readset").onchange = (e) => B.store.set("scanSet", e.target.checked);

    const tab = $("#s-revtab");
    const row = (el) => { const tr = el.closest("tr[data-id]"); return tr ? rev.find((r) => r.id === tr.dataset.id) : null; };
    tab.addEventListener("change", async (e) => {
      const r = row(e.target); if (!r) return; const f = e.target.dataset.f;
      if (f === "on") r.on = e.target.checked;
      else if (f === "q") r.q = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
      else if (f === "name") {
        const v = e.target.value.trim(); if (!v) return;
        const m = B.names.size ? B.names.match(v) : { name: v, score: 1, alts: [] };
        r.name = m ? m.name : v; r.score = m ? m.score : 0; r.alts = m ? m.alts : []; r.card = null; r.set = ""; r.cn = "";
        await resolveRows([r]); return;
      }
      renderRev(); saveRev();
    });
    tab.addEventListener("click", async (e) => {
      const r = row(e.target); if (!r) return;
      if (e.target.closest("[data-f=rm]")) { rev = rev.filter((x) => x !== r); renderRev(); saveRev(); return; }
      if (e.target.closest("[data-f=open]")) { B.openCard(r.card); return; }
      const alt = e.target.closest("[data-alt]");
      if (alt) { r.name = alt.dataset.alt; r.score = 1; r.alts = []; r.card = null; r.set = ""; r.cn = ""; await resolveRows([r]); }
    });
    let acT;
    tab.addEventListener("input", (e) => {
      if (e.target.dataset.f !== "name") return; clearTimeout(acT);
      acT = setTimeout(async () => { try { const list = await B.sf.autocomplete(e.target.value); $("#s-names").innerHTML = list.map((n) => `<option value="${esc(n)}">`).join(""); } catch (_) {} }, 250);
    });
    $("#s-accept").onclick = () => {
      let n = 0;
      for (const r of rev) if (r.on && r.card) { B.col.add(r.card, r.q); n += r.q; }
      rev = rev.filter((r) => !(r.on && r.card)); renderRev(); saveRev();
      status(`Dodano ${n} kart do kolekcji.` + (rev.length ? ` Zostało ${rev.length} pozycji do poprawienia.` : ""));
      B.toast(`Dodano ${n} kart do kolekcji`);
    };
    $("#s-clear").onclick = () => { rev = []; renderRev(); saveRev(); };
    $("#s-all").onclick = () => { const all = rev.every((r) => !r.card || r.on); rev.forEach((r) => { if (r.card) r.on = !all; }); renderRev(); };
    renderRev();
    // retry lookups for rows restored from a previous visit
    const pending = rev.filter((r) => r.name && !r.card); if (pending.length) resolveRows(pending);
  };
  /* warm up libraries in the background when the tab is opened */
  B.prefetchScanner = () => {
    if ($("#s-engine").value !== "local") return;
    B.names.load().catch(() => {});
    getCV().catch(() => {});
  };
  // exported for tests
  B._scan = { detectCards, warpCard, readCard, getCV, getOCR, fileToCanvas, prepText };
})(window.B);
