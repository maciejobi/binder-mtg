/* Binder MTG – fuzzy card-name matcher for OCR output.
   Indexes every card name from Scryfall with trigrams, then ranks candidates by edit distance. */
(function (B) {
  "use strict";
  let keys = [], names = [], exact = new Map(), grams = new Map(), ready = null;

  function trigrams(s) {
    const p = "  " + s + " ";
    const out = new Set();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  }

  function build(list) {
    keys = []; names = []; exact = new Map(); grams = new Map();
    const add = (key, name) => {
      if (!key || exact.has(key)) return;
      const id = keys.length; keys.push(key); names.push(name); exact.set(key, id);
      for (const g of trigrams(key)) { let a = grams.get(g); if (!a) grams.set(g, (a = [])); a.push(id); }
    };
    for (const n of list) {
      add(B.norm(n), n);
      if (n.includes(" // ")) for (const half of n.split(" // ")) add(B.norm(half), n);
    }
  }

  B.names = {
    load() {
      if (!ready) ready = B.sf.cardNames().then((list) => { build(list); return list.length; }).catch((e) => { ready = null; throw e; });
      return ready;
    },
    get size() { return keys.length; },
    /* returns {name, score, alts:[names]} or null */
    match(text) {
      const t = B.norm(text).replace(/\b(?:[a-z]|\d+)$/g, "").trim(); // drop a lone trailing char (often a mana symbol)
      if (t.length < 3 || !keys.length) return null;
      const hit = exact.get(t);
      if (hit !== undefined) return { name: names[hit], score: 1, alts: [] };
      const counts = new Map();
      for (const g of trigrams(t)) {
        const a = grams.get(g); if (!a || a.length > 6000) continue;
        for (const id of a) counts.set(id, (counts.get(id) || 0) + 1);
      }
      const cand = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
      const scored = [];
      for (const [id] of cand) {
        const k = keys[id];
        const max = Math.ceil(k.length * 0.5);
        let d = B.lev(t, k, max);
        if (t.length > k.length) d = Math.min(d, B.lev(t.slice(0, k.length), k, max) + 1); // trailing junk
        if (t.length > k.length + 1) d = Math.min(d, B.lev(t.slice(-k.length), k, max) + 1); // leading junk
        if (d > max) continue;
        scored.push({ id, score: 1 - d / Math.max(k.length, t.length > k.length ? k.length : t.length) });
      }
      scored.sort((a, b) => b.score - a.score || keys[a.id].length - keys[b.id].length);
      if (!scored.length || scored[0].score < 0.55) return null;
      const seen = new Set(); const alts = [];
      for (const s of scored) { const n = names[s.id]; if (seen.has(n)) continue; seen.add(n); alts.push(n); if (alts.length >= 6) break; }
      return { name: names[scored[0].id], score: scored[0].score, alts: alts.slice(1) };
    },
  };
})(window.B);
