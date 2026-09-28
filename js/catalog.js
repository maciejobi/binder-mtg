/* Binder MTG – "Katalog" tab (browse Scryfall, tap to add) + card drawer */
(function (B) {
  "use strict";
  const $ = B.$, esc = B.esc;
  const S = Object.assign({ set: "", q: "", std: true, sort: "set", variants: false }, B.store.get("cat", {}));
  let sets = [], results = [], next = null, loading = false, reqId = 0;

  function saveUi() { B.store.set("cat", { set: S.set, std: S.std, sort: S.sort, variants: S.variants }); }

  function buildQuery() {
    const parts = [];
    if (S.q.trim()) parts.push(S.q.trim());
    if (S.set) parts.push("e:" + S.set.toLowerCase());
    if (S.std) parts.push("f:standard");
    if (!S.variants) parts.push("-is:variation", "not:boosterfun", "-is:promo");
    if (!S.q.trim() && !S.set) parts.push("f:standard");
    return parts.join(" ");
  }

  function tile(c) {
    const q = B.col.qty(c.id);
    const other = q ? 0 : B.col.ownedByOracle(c.oid, c.name);
    return `<div class="ctile${q ? " own" : ""}" data-id="${c.id}" role="button" tabindex="0" aria-pressed="${!!q}" aria-label="${esc(c.name)}, ${q} szt.">
      <div class="imgwrap">${c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="noimg">${esc(c.name)}</div>`}
        ${q ? `<span class="qbadge">${q}×</span>` : other ? `<span class="qbadge other" title="Masz inne wydruki tej karty">${other}× inny</span>` : ""}
        ${c.std === "banned" ? `<span class="banbadge">Ban</span>` : ""}</div>
      <div class="tbar"><span class="tset"><span class="rar ${c.rarity}"></span>${esc(c.set)} #${esc(c.cn)}</span>
        <span class="tbtns">${q ? `<button data-act="dec" aria-label="Usuń egzemplarz">−</button>` : ""}<button data-act="inc" aria-label="Dodaj egzemplarz">+</button><button data-act="info" aria-label="Szczegóły">i</button></span></div>
    </div>`;
  }

  function renderGrid() {
    const g = $("#cat-grid");
    if (!results.length && !loading) { g.innerHTML = `<div class="empty" style="grid-column:1/-1">Brak kart dla tego wyszukiwania.</div>`; }
    else g.innerHTML = results.map(tile).join("");
    $("#cat-more").hidden = !next;
  }
  function refreshTile(id) {
    const el = $(`#cat-grid .ctile[data-id="${CSS.escape(id)}"]`); if (!el) return;
    const c = results.find((x) => x.id === id); if (!c) return;
    const d = document.createElement("div"); d.innerHTML = tile(c); el.replaceWith(d.firstElementChild);
  }

  async function run(append) {
    const my = ++reqId; loading = true;
    const st = $("#cat-status");
    if (!append) { results = []; next = null; $("#cat-grid").innerHTML = `<div class="empty" style="grid-column:1/-1">Ładuję karty ze Scryfall…</div>`; }
    try {
      const orders = { set: ["set", "auto"], name: ["name", "auto"], cmc: ["cmc", "auto"], price: ["eur", "desc"], rarity: ["rarity", "desc"] };
      const [order, dir] = orders[S.sort] || orders.set;
      const r = append ? await B.sf.search(null, { next }) : await B.sf.search(buildQuery(), { order, dir });
      if (my !== reqId) return;
      results = results.concat(r.cards); next = r.next;
      st.textContent = r.total ? `${r.total} kart` : "";
    } catch (e) { if (my === reqId) { st.textContent = e.message; } }
    loading = false; if (my === reqId) renderGrid();
  }

  function renderSets() {
    const recent = sets.filter((s) => (s.type === "expansion" || s.type === "core") && s.date >= "2023-06-01");
    const chips = [`<button class="setchip" data-set="" aria-pressed="${!S.set}"><b>ALL</b><span>Wszystkie edycje</span><i>wyniki wyszukiwania</i></button>`]
      .concat(recent.map((s) => `<button class="setchip" data-set="${s.code}" aria-pressed="${S.set === s.code}" title="${esc(s.name)}"><b>${s.code}</b><span>${esc(s.name)}</span><i class="${s.date > B.today() ? "soon" : ""}">${s.date > B.today() ? "premiera " + s.date : s.date.slice(0, 7)}</i></button>`));
    $("#cat-rail").innerHTML = chips.join("");
    const sel = $("#cat-setsel");
    sel.innerHTML = `<option value="">Inna edycja…</option>` + sets.map((s) => `<option value="${s.code}" ${S.set === s.code ? "selected" : ""}>${esc(s.name)} (${s.code}, ${s.date.slice(0, 4)})</option>`).join("");
  }

  /* ---------- card drawer ---------- */
  B.openCard = async (c) => {
    if (!c) return;
    const d = $("#drawer"), p = $("#pane");
    const faces = c.faces && c.faces.some((f) => f.img) ? c.faces : null;
    const owned = B.col.ownedByOracle(c.oid, c.name);
    p.innerHTML = `<div class="row" style="justify-content:space-between">${B.legalFlag(c)}<button class="btn sm" data-close>Zamknij</button></div>
      <div class="bigimgs">${faces ? faces.map((f) => `<img src="${esc(f.img)}" alt="${esc(f.name)}">`).join("") : c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}">` : ""}</div>
      <div><h2>${esc(c.name)}</h2><div class="meta" style="margin-top:4px">${B.mana(c.mana, true)}</div><div class="meta">${esc(c.type)}${c.p != null ? " · " + esc(c.p + "/" + c.t) : c.loy ? " · lojalność " + esc(c.loy) : ""}</div></div>
      ${faces ? faces.map((f) => `<div class="oracle"><b>${esc(f.name)}</b> ${B.mana(f.mana)}<br>${B.oracleHtml(f.text)}</div>`).join("") : c.text ? `<div class="oracle">${B.oracleHtml(c.text)}</div>` : ""}
      <div class="row"><b>Ten wydruk (${esc(c.set)} #${esc(c.cn)}):</b>
        <button class="btn sm" data-dq="-1">−</button><b data-q>${B.col.qty(c.id)}</b><button class="btn sm" data-dq="1">+</button>
        <span class="meta">łącznie wszystkich wydruków: <b data-own>${owned}</b></span></div>
      ${c.price ? `<div class="meta">Cena orientacyjna: ${esc(c.price)} ${c.priceCur} (Scryfall)</div>` : ""}
      <div><b>Wydruki</b><div id="prints" class="meta">Ładuję…</div></div>
      <a href="${esc(c.uri || "https://scryfall.com/search?q=" + encodeURIComponent('!"' + c.name + '"'))}" target="_blank" rel="noopener">Otwórz na Scryfall ↗</a>`;
    d.hidden = false; p.scrollTop = 0; p.querySelector("[data-close]").focus();
    p.onclick = (e) => {
      const b = e.target.closest("[data-dq]"); if (b) { B.col.add(c, +b.dataset.dq); p.querySelector("[data-q]").textContent = B.col.qty(c.id); p.querySelector("[data-own]").textContent = B.col.ownedByOracle(c.oid, c.name); refreshTile(c.id); }
      const pr = e.target.closest("[data-print]"); if (pr) { const x = printsCache.find((y) => y.id === pr.dataset.print); if (x) B.openCard(x); }
    };
    try {
      const prints = await B.sf.prints(c); printsCache = prints;
      const el = $("#prints"); if (!el) return;
      el.innerHTML = `<table class="ptab">${prints.map((x) => `<tr><td><button class="linkish" data-print="${x.id}">${esc(x.setName)}</button></td><td class="num">${esc(x.set)} #${esc(x.cn)}</td><td class="num">${x.price ? esc(x.price) + " " + x.priceCur : ""}</td><td class="num">${B.col.qty(x.id) ? B.col.qty(x.id) + "×" : ""}</td></tr>`).join("")}</table>`;
    } catch (e) { const el = $("#prints"); if (el) el.textContent = e.message; }
  };
  let printsCache = [];

  B.initCatalog = async () => {
    $("#cat-rail").addEventListener("click", (e) => { const b = e.target.closest(".setchip"); if (!b) return; S.set = b.dataset.set; saveUi(); renderSets(); run(); });
    $("#cat-setsel").onchange = (e) => { if (!e.target.value) return; S.set = e.target.value; S.std = false; $("#cat-std").checked = false; saveUi(); renderSets(); run(); };
    let t; $("#cat-q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; run(); }, 450); });
    $("#cat-std").checked = S.std; $("#cat-std").onchange = (e) => { S.std = e.target.checked; saveUi(); run(); };
    $("#cat-var").checked = S.variants; $("#cat-var").onchange = (e) => { S.variants = e.target.checked; saveUi(); run(); };
    $("#cat-sort").value = S.sort; $("#cat-sort").onchange = (e) => { S.sort = e.target.value; saveUi(); run(); };
    $("#cat-more").onclick = () => run(true);
    const grid = $("#cat-grid");
    grid.addEventListener("click", (e) => {
      const tl = e.target.closest(".ctile"); if (!tl) return;
      const c = results.find((x) => x.id === tl.dataset.id); if (!c) return;
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "info") { B.openCard(c); return; }
      B.col.add(c, act === "dec" ? -1 : 1); refreshTile(c.id);
    });
    grid.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("ctile")) {
        e.preventDefault(); const c = results.find((x) => x.id === e.target.dataset.id); B.col.add(c, 1); refreshTile(c.id);
        $(`#cat-grid .ctile[data-id="${CSS.escape(c.id)}"]`)?.focus();
      }
    });
    const d = $("#drawer");
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !d.hidden) d.hidden = true; });
    B.col.onChange(() => { if (!$("#v-cat").hidden) { /* tiles refresh individually; nothing else */ } });
    try { sets = await B.sf.sets(); } catch (e) { $("#cat-status").textContent = e.message; }
    if (!S.set && !S.q) { const cur = sets.find((s) => (s.type === "expansion" || s.type === "core") && s.date <= B.today()); if (cur) S.set = cur.code; }
    renderSets(); run();
  };
  B.catalogRefresh = () => renderGrid();
})(window.B);
