/* Binder MTG – helpers shared by all modules */
window.B = window.B || {};
(function (B) {
  "use strict";

  B.$ = (sel, root = document) => root.querySelector(sel);
  B.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  B.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  B.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  B.today = () => new Date().toISOString().slice(0, 10);

  /* ---------- storage (localStorage, JSON, never throws) ---------- */
  B.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("binder." + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("binder." + key, JSON.stringify(value)); return true; }
      catch (e) { B.toast("Nie udało się zapisać danych w przeglądarce (brak miejsca lub tryb prywatny).", "err"); return false; }
    },
    del(key) { try { localStorage.removeItem("binder." + key); } catch (e) {} },
  };

  /* ---------- toast ---------- */
  let toastTimer;
  B.toast = (msg, kind = "") => {
    let el = B.$("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.className = "toast show " + kind;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast " + kind), kind === "err" ? 6000 : 3200);
  };

  /* ---------- clipboard ---------- */
  B.copy = async (text, btn) => {
    const old = btn ? btn.textContent : "";
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) {} ta.remove();
    }
    if (btn) { btn.textContent = "Skopiowano"; setTimeout(() => (btn.textContent = old), 1600); }
  };

  /* ---------- file download ---------- */
  B.download = (filename, text, type = "application/json") => {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  /* ---------- mana symbols ---------- */
  const PIP = { W: "#F8F2D6", U: "#AAD3EE", B: "#BDB2B5", R: "#F2A58C", G: "#9FD1A7", C: "#CAC5C0" };
  B.PIP = PIP;
  B.mana = (str, big) => {
    if (!str) return "";
    return String(str).replace(/\{([^}]+)\}/g, (m, t) => {
      const cls = "ms" + (big ? " big" : "");
      if (/^[WUBRG]$/.test(t)) return `<span class="${cls} ${t}">${t}</span>`;
      const h = t.match(/^([WUBRGC0-9])\/([WUBRGP])$/);
      if (h) {
        const a = PIP[h[1]] || "#CAC5C0", b = h[2] === "P" ? "#CAC5C0" : PIP[h[2]];
        return `<span class="${cls} h" style="--a:${a};--b:${b}">${h[2] === "P" ? h[1] : ""}</span>`;
      }
      return `<span class="${cls}">${B.esc(t === "T" ? "↷" : t)}</span>`;
    }).replace(/ \/\/ /g, ' <span class="sep">//</span> ');
  };
  B.oracleHtml = (t) => B.esc(t).replace(/\{([^}]+)\}/g, (m) => B.mana(m)).replace(/\n/g, "<br>");

  /* ---------- text normalisation for name matching ---------- */
  B.norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'").replace(/æ/g, "ae").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

  /* Levenshtein distance with early exit when above max */
  B.lev = (a, b, max = 99) => {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i; const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= b.length; j++) {
        const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
        cur.push(v); if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  };

  B.RARITY = { common: "Common", uncommon: "Uncommon", rare: "Rare", mythic: "Mythic", special: "Special", bonus: "Bonus" };
  B.COLORNAME = { W: "Biały", U: "Niebieski", B: "Czarny", R: "Czerwony", G: "Zielony" };
  const GUILD = { W: "Mono-White", U: "Mono-Blue", B: "Mono-Black", R: "Mono-Red", G: "Mono-Green",
    WU: "Azorius", UB: "Dimir", BR: "Rakdos", RG: "Gruul", GW: "Selesnya", WB: "Orzhov", UR: "Izzet", BG: "Golgari", RW: "Boros", GU: "Simic",
    WUB: "Esper", UBR: "Grixis", BRG: "Jund", RGW: "Naya", GWU: "Bant", WBG: "Abzan", URW: "Jeskai", BGU: "Sultai", RWB: "Mardu", GUR: "Temur" };
  B.colorKey = (cols) => {
    const s = new Set(cols); const order = "WUBRG";
    const arr = [...order].filter((c) => s.has(c));
    // guild names use a canonical rotation; find the rotation present in GUILD
    for (let r = 0; r < arr.length; r++) {
      const k = arr.slice(r).concat(arr.slice(0, r)).join("");
      if (GUILD[k]) return k;
    }
    return arr.join("");
  };
  B.guild = (cols) => GUILD[B.colorKey(cols)] || (cols.length ? cols.join("") : "Colorless");
})(window.B);
