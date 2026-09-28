/* Binder MTG – collection store + "Kolekcja" tab */
(function (B) {
  "use strict";
  const $ = B.$, esc = B.esc;

  /* ---------- store: { scryfallId: {q, c: slimCard, at} } ---------- */
  let col = B.store.get("col", {});
  const listeners = new Set();
  let saveT;
  function changed() {
    clearTimeout(saveT);
    saveT = setTimeout(() => B.store.set("col", col), 250);
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  B.col = {
    onChange(fn) { listeners.add(fn); },
    qty(id) { return col[id] ? col[id].q : 0; },
    card(id) { return col[id] ? col[id].c : null; },
    entries() { return Object.values(col); },
    add(card, n = 1) {
      if (!card || !card.id) return;
      const e = col[card.id] || (col[card.id] = { q: 0, c: card, at: Date.now() });
      e.c = card; e.q = Math.max(0, Math.min(999, e.q + n));
      if (!e.q) delete col[card.id];
      changed();
    },
    set(card, q) { if (!card) return; if (q <= 0) delete col[card.id]; else col[card.id] = { q: Math.min(999, q), c: card, at: (col[card.id] || {}).at || Date.now() }; changed(); },
    /* copies owned of this oracle card across all printings */
    ownedByOracle(oid, name) {
      let n = 0;
      for (const e of Object.values(col)) if ((oid && e.c.oid === oid) || (!oid && e.c.name === name)) n += e.q;
      return n;
    },
    total() { return Object.values(col).reduce((a, e) => a + e.q, 0); },
    unique() { return new Set(Object.values(col).map((e) => e.c.oid || e.c.name)).size; },
    /* aggregated by card (oracle), used by the deck engine */
    pool() {
      const m = new Map();
      for (const e of Object.values(col)) {
        const k = e.c.oid || e.c.name;
        const x = m.get(k) || { card: e.c, q: 0, prints: [] };
        x.q += e.q; x.prints.push(e.c);
        // keep the most recent printing as representative (freshest legality data)
        if ((e.c.released || "") > (x.card.released || "")) x.card = e.c;
        m.set(k, x);
      }
      return [...m.values()];
    },
    replaceAll(obj) { col = obj || {}; changed(); },
    raw() { return col; },
  };

  /* ---------- legality helpers ---------- */
  const LEG = { legal: ["ok", "Standard"], banned: ["bad", "Zbanowana"], not_legal: ["no", "Poza Standardem"], restricted: ["warn", "Ograniczona"] };
  B.legalFlag = (c) => { const [k, t] = LEG[c.std] || LEG.not_legal; return `<span class="flag ${k}">${t}</span>`; };

  /* ---------- import / export ---------- */
  function exportJSON() {
    B.download(`binder-mtg-${B.today()}.json`, JSON.stringify({ app: "binder-mtg", v: 1, exported: new Date().toISOString(), col }, null, 1));
  }
  function exportCSV() {
    const rows = [["Count", "Name", "Edition", "Collector Number", "Rarity", "Scryfall ID"]];
    for (const e of Object.values(col)) rows.push([e.q, e.c.name, e.c.set, e.c.cn, e.c.rarity, e.c.id]);
    const csv = rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(",")).join("\n");
    B.download(`binder-mtg-${B.today()}.csv`, csv, "text/csv");
  }
  function textList() {
    const m = new Map();
    for (const e of Object.values(col)) m.set(e.c.name, (m.get(e.c.name) || 0) + e.q);
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([n, q]) => `${q} ${n}`).join("\n");
  }
  /* parses "4 Name", "4x Name", "Name", "4 Name (SET) 123", CSV rows from this app */
  function parseText(txt) {
    const out = [];
    for (let line of txt.split(/\r?\n/)) {
      line = line.trim();
      if (!line || /^(deck|sideboard|commander|companion|count,)/i.test(line) || line.startsWith("//") || line.startsWith("#")) continue;
      const csv = line.match(/^(\d+),"?([^",]+)"?,([A-Za-z0-9]{2,6}),([^,]+)/);
      if (csv) { out.push({ q: +csv[1], name: csv[2], set: csv[3], cn: csv[4] }); continue; }
      const m = line.match(/^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w★\-]+))?)?(?:\s+\*F\*)?$/i);
      if (m) out.push({ q: m[1] ? +m[1] : 1, name: m[2].trim(), set: m[3] || "", cn: m[4] || "" });
    }
    return out;
  }
  async function importText(txt, status) {
    const items = parseText(txt);
    if (!items.length) { status.textContent = "Nie znalazłem żadnych kart w tym tekście."; return; }
    status.textContent = `Szukam ${items.length} pozycji w Scryfall…`;
    const ids = items.map((i) => i.set && i.cn ? { set: i.set.toLowerCase(), collector_number: i.cn } : { name: i.name });
    const { found } = await B.sf.collection(ids);
    const byKey = new Map();
    for (const c of found) { byKey.set(c.set.toLowerCase() + "|" + c.cn, c); byKey.set(B.norm(c.name), c); if (c.faces) byKey.set(B.norm(c.faces[0].name), c); }
    let added = 0; const missing = [];
    for (const i of items) {
      const c = (i.set && i.cn && byKey.get(i.set.toLowerCase() + "|" + i.cn)) || byKey.get(B.norm(i.name));
      if (c) { B.col.add(c, i.q); added += i.q; } else missing.push(i.name);
    }
    status.textContent = `Dodano ${added} kart.` + (missing.length ? ` Nie znaleziono: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}` : "");
  }
  async function refreshData(btn) {
    const ids = Object.keys(col).map((id) => ({ id }));
    if (!ids.length) return;
    btn.disabled = true; btn.textContent = "Odświeżam…";
    try {
      const { found } = await B.sf.collection(ids);
      for (const c of found) if (col[c.id]) col[c.id].c = c;
      changed(); B.toast(`Zaktualizowano dane ${found.length} kart (legalność, ceny).`);
    } catch (e) { B.toast(e.message, "err"); }
    btn.disabled = false; btn.textContent = "Odśwież legalność i ceny";
  }

  /* ---------- UI ---------- */
  const V = { filter: "", q: "", sort: "name" };
  function render() {
    const root = $("#v-coll"); if (!root || root.hidden) return;
    const ents = Object.values(col);
    const pool = B.col.pool();
    const legal = pool.filter((x) => x.card.std === "legal"), banned = pool.filter((x) => x.card.std === "banned");
    let value = 0; for (const e of ents) value += (parseFloat(e.c.price) || 0) * e.q;
    $("#c-stats").innerHTML = [
      [pool.length, "różnych kart"], [B.col.total(), "egzemplarzy"], [legal.length, `legalnych w Standardzie (${legal.reduce((a, x) => a + x.q, 0)} szt.)`],
      [banned.length, "zbanowanych"], [value ? value.toFixed(0) + " " + (ents[0]?.c.priceCur || "€") : "–", "szacowana wartość"],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
    const q = B.norm(V.q);
    let list = ents.filter((e) => (!V.filter || e.c.std === V.filter || (V.filter === "not_legal" && e.c.std !== "legal" && e.c.std !== "banned")) && (!q || B.norm(e.c.name + " " + e.c.type).includes(q)));
    const sorts = { name: (a, b) => a.c.name.localeCompare(b.c.name), set: (a, b) => b.c.released.localeCompare(a.c.released) || (parseInt(a.c.cn) - parseInt(b.c.cn)), added: (a, b) => (b.at || 0) - (a.at || 0), cmc: (a, b) => a.c.cmc - b.c.cmc || a.c.name.localeCompare(b.c.name), price: (a, b) => (parseFloat(b.c.price) || 0) - (parseFloat(a.c.price) || 0) };
    list.sort(sorts[V.sort] || sorts.name);
    const el = $("#c-list");
    if (!ents.length) { el.innerHTML = `<div class="empty">Kolekcja jest pusta. Dodaj karty w Katalogu, zeskanuj je aparatem albo zaimportuj listę.</div>`; return; }
    el.innerHTML = list.map((e) => `<div class="crow" data-id="${e.c.id}">
      <img src="${esc(e.c.imgS)}" alt="" loading="lazy" data-open>
      <div class="cinfo"><button class="linkish" data-open>${esc(e.c.name)}</button>
        <div class="meta">${B.mana(e.c.mana)} <span>${esc(e.c.type)}</span></div>
        <div class="meta"><span class="rar ${e.c.rarity}"></span>${esc(e.c.set)} #${esc(e.c.cn)} · ${B.legalFlag(e.c)}${e.c.price ? ` · ${esc(e.c.price)} ${e.c.priceCur}` : ""}</div></div>
      <div class="qtyc"><button class="btn sm" data-d="-1" aria-label="Mniej">−</button><b>${e.q}</b><button class="btn sm" data-d="1" aria-label="Więcej">+</button></div>
    </div>`).join("") || `<div class="empty">Brak kart dla tego filtra.</div>`;
  }

  B.initCollection = () => {
    $("#c-filter").onchange = (e) => { V.filter = e.target.value; render(); };
    $("#c-sort").onchange = (e) => { V.sort = e.target.value; render(); };
    let t; $("#c-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { V.q = e.target.value; render(); }, 150); };
    $("#c-list").addEventListener("click", (e) => {
      const row = e.target.closest(".crow"); if (!row) return;
      const card = B.col.card(row.dataset.id);
      if (e.target.closest("[data-open]")) { B.openCard(card); return; }
      const d = e.target.closest("[data-d]"); if (d) B.col.add(card, +d.dataset.d);
    });
    $("#c-exp-json").onclick = exportJSON;
    $("#c-exp-csv").onclick = exportCSV;
    $("#c-copy").onclick = (e) => B.copy(textList(), e.currentTarget);
    $("#c-refresh").onclick = (e) => refreshData(e.currentTarget);
    $("#c-imp-go").onclick = async () => {
      const st = $("#c-imp-status"); const txt = $("#c-imp-text").value;
      if (!txt.trim()) { st.textContent = "Wklej listę kart."; return; }
      try { await importText(txt, st); $("#c-imp-text").value = ""; } catch (e) { st.textContent = e.message; }
    };
    $("#c-imp-file").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return; const st = $("#c-imp-status");
      const txt = await f.text(); e.target.value = "";
      if (/^\s*\{/.test(txt)) {
        try {
          const j = JSON.parse(txt);
          if (!j.col) throw new Error();
          const merge = $("#c-imp-merge").checked;
          if (merge) { for (const [id, x] of Object.entries(j.col)) { const cur = col[id]; col[id] = { q: (cur ? cur.q : 0) + x.q, c: x.c, at: x.at || Date.now() }; } changed(); }
          else B.col.replaceAll(j.col);
          st.textContent = `Wczytano kopię: ${Object.keys(j.col).length} pozycji (${merge ? "dodane do obecnej kolekcji" : "zastąpiły obecną kolekcję"}).`;
        } catch (_) { st.textContent = "To nie jest plik kopii z Binder MTG."; }
      } else {
        try { await importText(txt, st); } catch (err) { st.textContent = err.message; }
      }
    };
    B.col.onChange(render);
  };
  B.renderCollection = render;
})(window.B);
