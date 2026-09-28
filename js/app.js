/* Binder MTG – app shell: tabs, deck tab, settings, boot */
(function (B) {
  "use strict";
  const $ = B.$, esc = B.esc;
  B.state = { sets: [] };

  /* ---------- tabs ---------- */
  const TABS = ["cat", "scan", "coll", "deck", "set"];
  function showTab(t) {
    if (!TABS.includes(t)) t = "cat";
    B.store.set("tab", t);
    B.$$(".tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach((x) => ($("#v-" + x).hidden = x !== t));
    if (t === "coll") B.renderCollection();
    if (t === "scan") B.prefetchScanner();
    if (t === "cat") B.catalogRefresh();
    if (t === "deck") renderDeckIntro();
    if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
    window.scrollTo(0, 0);
  }
  function updateCount() { $("#n-own").textContent = B.col.total(); }

  /* ---------- deck tab ---------- */
  const D = { colors: new Set(), result: null, current: null };
  function pipBtn(c) { return `<button class="pipbtn" data-c="${c}" aria-pressed="false" aria-label="${B.COLORNAME[c]}" title="${B.COLORNAME[c]}"><span class="ms big ${c}">${c}</span></button>`; }
  function renderDeckIntro() {
    const pool = B.col.pool(); const legal = pool.filter((x) => x.card.std === "legal");
    $("#d-pool").textContent = `W kolekcji: ${legal.length} kart legalnych w Standardzie (${legal.reduce((a, x) => a + x.q, 0)} egzemplarzy).`;
    $("#d-engine").querySelector('[value="claude"]').disabled = !B.claude.hasKey();
    if (!B.claude.hasKey() && $("#d-engine").value === "claude") $("#d-engine").value = "local";
    renderSaved();
  }
  function opts() {
    return { size: +$("#d-size").value, style: $("#d-style").value, colors: [...D.colors], bo3: $("#d-bo3").checked, basicsFree: $("#d-basics").checked };
  }
  let ctl = null;
  async function build() {
    const st = $("#d-status"); const o = opts(); const entries = B.col.pool();
    if ($("#d-engine").value === "claude") {
      ctl = new AbortController(); $("#d-build").disabled = true; $("#d-stop").hidden = false;
      st.className = "status"; st.textContent = "Claude buduje deck… (zwykle 20–60 s)";
      try {
        const list = await B.claude.buildDeck(entries, o, ctl.signal);
        const d = B.deck.fromList(entries, list, o);
        D.result = { best: d, alts: [] }; showDeck(d); st.textContent = "";
      } catch (e) { st.className = "status err"; st.textContent = e.name === "AbortError" ? "Zatrzymano." : e.message; }
      $("#d-build").disabled = false; $("#d-stop").hidden = true; return;
    }
    st.className = "status"; st.textContent = "Liczę…";
    await B.sleep(20);
    const t0 = performance.now();
    const r = B.deck.build(entries, o);
    if (r.error) { st.className = "status err"; st.textContent = r.error; $("#d-out").innerHTML = ""; return; }
    D.result = r; showDeck(r.best);
    st.textContent = `Sprawdzono ${r.tried} wariantów (kolory × styl) w ${Math.round(performance.now() - t0)} ms.`;
  }
  const GROUPS = [["Creature", "Stwory"], ["Planeswalker", "Planeswalkerzy"], ["Battle", "Battle"], ["Instant", "Instanty"], ["Sorcery", "Sorcery"], ["Artifact", "Artefakty"], ["Enchantment", "Enchantmenty"]];
  function groupOf(c) { const t = c.type.split("//")[0]; for (const [k, l] of GROUPS) if (new RegExp("\\b" + k + "\\b").test(t)) return l; return "Inne"; }
  function showDeck(d) {
    D.current = d;
    const groups = new Map();
    for (const m of d.main) { const g = groupOf(m.card); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(m); }
    const order = [...GROUPS.map((g) => g[1]), "Inne"].filter((g) => groups.has(g));
    const line = (m) => `<div class="dline" data-id="${esc(m.card.id)}"><span class="q">${m.q}</span>${m.card.imgS ? `<img src="${esc(m.card.imgS)}" alt="" loading="lazy">` : `<span class="noimg-s"></span>`}<button class="linkish n">${esc(m.card.name)}</button><span class="cost">${B.mana(m.card.mana)}</span></div>`;
    const mx = Math.max(1, ...d.stats.curve);
    const lands = d.lands.reduce((a, l) => a + l.q, 0), side = d.side.reduce((a, l) => a + l.q, 0);
    const alts = D.result && D.result.alts ? D.result.alts : [];
    $("#d-out").innerHTML = `<div class="sect deck">
      <div class="deck-head"><div><div class="eyebrow">${esc(d.archetype)}</div><h2>${esc(d.name)}</h2><div class="meta">${d.cols.map((c) => `<span class="ms big ${c}">${c}</span>`).join("")} ${d.count} kart · ${lands} lądów${side ? ` · sideboard ${side}` : ""}</div></div>
        <div class="row"><button class="btn" id="d-hand">Losuj rękę</button><button class="btn" id="d-save">Zapisz deck</button><button class="btn pri" id="d-copy">Kopiuj (Arena)</button></div></div>
      ${d.summary ? `<p class="prose">${esc(d.summary)}</p>` : ""}
      ${d.warnings && d.warnings.length ? `<div class="warnbox">${d.warnings.map(esc).join("<br>")}</div>` : ""}
      <div id="d-handout"></div>
      <div class="deck-cols">
        <div>${order.map((g) => `<div class="dgroup"><h4>${g} (${groups.get(g).reduce((a, m) => a + m.q, 0)})</h4>${groups.get(g).map(line).join("")}</div>`).join("")}
          <div class="dgroup"><h4>Lądy (${lands})</h4>${d.lands.map(line).join("")}</div>
          ${side ? `<div class="dgroup"><h4>Sideboard (${side})</h4>${d.side.map(line).join("")}</div>` : ""}</div>
        <div>
          <div class="dgroup"><h4>Krzywa many (bez lądów)</h4>
            <div class="curve">${d.stats.curve.map((c) => `<div><div class="bar" style="height:${(c / mx) * 100}%"><span>${c}</span></div></div>`).join("")}</div>
            <div class="curve-l">${["0", "1", "2", "3", "4", "5", "6+"].map((l) => `<span>${l}</span>`).join("")}</div></div>
          <div class="kv"><span>Stwory</span><b>${d.stats.creatures}</b><span>Usuwanie</span><b>${d.stats.removal}</b><span>Dobieranie</span><b>${d.stats.draw}</b><span>Średni koszt</span><b>${d.stats.avg.toFixed(2)}</b></div>
          ${d.plan ? `<div class="dgroup"><h4>Jak grać</h4><p class="prose">${esc(d.plan)}</p></div>` : ""}
          ${d.weak ? `<div class="dgroup"><h4>Słabe strony</h4><p class="prose">${esc(d.weak)}</p></div>` : ""}
          ${d.upgrades && d.upgrades.length ? `<div class="dgroup"><h4>Warto dokupić</h4><ul class="ul">${d.upgrades.map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div>` : ""}
          ${alts.length ? `<div class="dgroup"><h4>Inne warianty z Twoich kart</h4>${alts.map((a, i) => `<button class="altbtn" data-alt="${i}"><span>${a.cols.map((c) => `<span class="ms ${c}">${c}</span>`).join("")} ${esc(a.archetype)}</span><span class="meta">${a.stats.creatures} stw. · ${a.stats.removal} usuw. · śr. ${a.stats.avg.toFixed(1)}</span></button>`).join("")}</div>` : ""}
        </div></div></div>`;
    $("#d-copy").onclick = (e) => B.copy(arena(d), e.currentTarget);
    $("#d-save").onclick = () => { const s = B.store.get("decks", []); s.unshift({ id: Date.now(), at: new Date().toISOString(), name: d.name, archetype: d.archetype, text: arena(d), cols: d.cols }); B.store.set("decks", s.slice(0, 30)); renderSaved(); B.toast("Zapisano deck"); };
    $("#d-hand").onclick = () => sampleHand(d);
  }
  function arena(d) {
    const l = (m) => `${m.q} ${m.card.name}`;
    return "Deck\n" + d.main.concat(d.lands).map(l).join("\n") + (d.side.length ? "\n\nSideboard\n" + d.side.map(l).join("\n") : "");
  }
  function sampleHand(d) {
    const lib = []; d.main.concat(d.lands).forEach((m) => { for (let i = 0; i < m.q; i++) lib.push(m.card); });
    for (let i = lib.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lib[i], lib[j]] = [lib[j], lib[i]]; }
    const hand = lib.slice(0, 7); const lands = hand.filter((c) => /\bLand\b/.test(c.type)).length;
    const verdict = lands <= 1 ? "Za mało lądów: mulligan." : lands >= 6 ? "Za dużo lądów: mulligan." : lands === 2 && d.style !== "aggro" ? "Dwa lądy: grywalne, jeśli masz tanie zagrania." : "Ręka do zatrzymania.";
    $("#d-handout").innerHTML = `<div class="hand">${hand.map((c) => c.img ? `<img src="${esc(c.imgS || c.img)}" alt="${esc(c.name)}" title="${esc(c.name)}">` : `<div class="noimg hand-c">${esc(c.name)}</div>`).join("")}</div><p class="meta">${lands} ${lands === 1 ? "ląd" : lands < 5 ? "lądy" : "lądów"} w ręce. ${verdict}</p>`;
  }
  function renderSaved() {
    const s = B.store.get("decks", []); const el = $("#d-saved");
    el.innerHTML = s.length ? `<h4 class="eyebrow">Zapisane decki</h4>` + s.map((x) => `<div class="saved"><span>${x.cols.map((c) => `<span class="ms ${c}">${c}</span>`).join("")} <b>${esc(x.name)}</b> <span class="meta">${x.at.slice(0, 10)}</span></span><span class="row"><button class="btn sm" data-copy="${x.id}">Kopiuj</button><button class="btn sm" data-del="${x.id}" aria-label="Usuń">×</button></span></div>`).join("") : "";
  }

  /* ---------- settings ---------- */
  function initSettings() {
    $("#set-key").value = B.store.get("apiKey", "");
    $("#set-model").value = B.claude.model();
    $("#set-save").onclick = () => {
      B.store.set("apiKey", $("#set-key").value.trim()); B.store.set("apiModel", $("#set-model").value.trim() || "claude-sonnet-5");
      B.toast("Zapisano ustawienia"); syncEngines();
    };
    $("#set-test").onclick = async (e) => {
      const b = e.currentTarget; B.store.set("apiKey", $("#set-key").value.trim()); B.store.set("apiModel", $("#set-model").value.trim() || "claude-sonnet-5");
      b.disabled = true; $("#set-status").textContent = "Sprawdzam…";
      try { const t = await B.claude.ask([{ type: "text", text: "Odpowiedz jednym słowem: działa" }], { maxTokens: 20 }); $("#set-status").textContent = "Połączenie działa: " + t.trim(); }
      catch (err) { $("#set-status").textContent = err.message; }
      b.disabled = false; syncEngines();
    };
    $("#set-forget").onclick = () => { B.store.del("apiKey"); $("#set-key").value = ""; syncEngines(); B.toast("Usunięto klucz z tej przeglądarki"); };
    $("#set-wipe-confirm").onclick = () => { $("#set-wipe-box").hidden = false; };
    $("#set-wipe-no").onclick = () => { $("#set-wipe-box").hidden = true; };
    $("#set-wipe-yes").onclick = () => { B.col.replaceAll({}); B.store.del("scan"); B.store.del("decks"); $("#set-wipe-box").hidden = true; B.toast("Wyczyszczono kolekcję"); };
  }
  function syncEngines() {
    const has = B.claude.hasKey();
    $("#s-engine").querySelector('[value="claude"]').disabled = !has;
    $("#d-engine").querySelector('[value="claude"]').disabled = !has;
    if (!has) { if ($("#s-engine").value === "claude") $("#s-engine").value = "local"; if ($("#d-engine").value === "claude") $("#d-engine").value = "local"; }
  }

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    $(".tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) showTab(b.dataset.tab); });
    B.col.onChange(updateCount); updateCount();
    B.initCollection(); B.initScanner(); initSettings(); syncEngines();
    // deck controls
    $("#d-pips").innerHTML = ["W", "U", "B", "R", "G"].map(pipBtn).join("");
    $("#d-pips").addEventListener("click", (e) => { const b = e.target.closest(".pipbtn"); if (!b) return; const c = b.dataset.c; D.colors.has(c) ? D.colors.delete(c) : D.colors.add(c); b.setAttribute("aria-pressed", D.colors.has(c)); });
    $("#d-size").onchange = () => { $("#d-bo3").disabled = $("#d-size").value === "40"; };
    $("#d-build").onclick = build;
    $("#d-stop").onclick = () => ctl && ctl.abort();
    $("#d-out").addEventListener("click", (e) => {
      const alt = e.target.closest("[data-alt]"); if (alt) { const a = D.result.alts[+alt.dataset.alt]; const cur = D.current; D.result.alts[+alt.dataset.alt] = cur; D.result.best = a; showDeck(a); $("#d-out").scrollIntoView({ behavior: "smooth" }); return; }
      const ln = e.target.closest(".dline"); if (ln && e.target.closest(".n")) { const m = D.current.main.concat(D.current.lands, D.current.side).find((x) => x.card.id === ln.dataset.id); if (m && m.card.img) B.openCard(m.card); }
    });
    $("#d-saved").addEventListener("click", (e) => {
      const s = B.store.get("decks", []);
      const c = e.target.closest("[data-copy]"); if (c) { const x = s.find((d) => d.id === +c.dataset.copy); if (x) B.copy(x.text, c); }
      const d = e.target.closest("[data-del]"); if (d) { B.store.set("decks", s.filter((x) => x.id !== +d.dataset.del)); renderSaved(); }
    });
    showTab((location.hash || "").slice(1) || B.store.get("tab", "cat"));
    try { B.state.sets = await B.sf.sets(); } catch (e) {}
    B.initCatalog();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})(window.B);
