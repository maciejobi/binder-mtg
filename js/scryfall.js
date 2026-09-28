/* Binder MTG – Scryfall API client (https://scryfall.com/docs/api)
   Scryfall asks for 50–100 ms between requests and for caching; both are done here. */
(function (B) {
  "use strict";
  const API = "https://api.scryfall.com";
  let last = 0, chain = Promise.resolve();

  function throttle() {
    const p = chain.then(async () => {
      const wait = Math.max(0, last + 110 - Date.now());
      if (wait) await B.sleep(wait);
      last = Date.now();
    });
    chain = p.catch(() => {});
    return p;
  }

  async function req(path, opts = {}) {
    await throttle();
    const url = path.startsWith("http") ? path : API + path;
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, ...opts });
    } catch (e) {
      throw new Error("Brak połączenia ze Scryfall. Sprawdź internet.");
    }
    if (res.status === 404) return { object: "list", data: [], total_cards: 0, has_more: false, notFound: true };
    if (res.status === 429) { await B.sleep(1000); return req(path, opts); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && j.details) || "Scryfall zwrócił błąd " + res.status);
    return j;
  }

  /* ---------- tiny IndexedDB key/value for big caches ---------- */
  const idb = {
    db: null,
    open() {
      if (this.db) return this.db;
      this.db = new Promise((resolve) => {
        try {
          const r = indexedDB.open("binder-mtg", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("kv");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return this.db;
    },
    async get(k) {
      const db = await this.open(); if (!db) return undefined;
      return new Promise((res) => { try { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); } catch (e) { res(undefined); } });
    },
    async set(k, v) {
      const db = await this.open(); if (!db) return;
      return new Promise((res) => { try { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; } catch (e) { res(); } });
    },
  };
  B.idb = idb;

  /* ---------- compact card shape used across the app ---------- */
  function imgOf(o, size) { return o && o.image_uris ? o.image_uris[size] || o.image_uris.normal : ""; }
  B.slim = (c) => {
    const f = c.card_faces || [];
    const front = f[0] || c;
    const faces = f.length ? f.map((x) => ({ name: x.name, mana: x.mana_cost || "", type: x.type_line || "", text: x.oracle_text || "", p: x.power, t: x.toughness, loy: x.loyalty, img: imgOf(x, "normal") })) : null;
    return {
      id: c.id, oid: c.oracle_id || (front.oracle_id || ""), name: c.name, set: (c.set || "").toUpperCase(), setName: c.set_name || "",
      cn: c.collector_number || "", rarity: c.rarity || "", released: c.released_at || "",
      mana: c.mana_cost != null ? c.mana_cost : (front.mana_cost || ""), cmc: c.cmc || 0,
      type: c.type_line || front.type_line || "",
      text: c.oracle_text != null ? c.oracle_text : f.map((x) => x.name + ": " + (x.oracle_text || "")).join("\n//\n"),
      colors: c.colors || front.colors || [], ci: c.color_identity || [], kw: c.keywords || [],
      p: c.power ?? front.power, t: c.toughness ?? front.toughness, loy: c.loyalty ?? front.loyalty,
      std: (c.legalities && c.legalities.standard) || "not_legal",
      img: imgOf(c, "normal") || imgOf(front, "normal"), imgS: imgOf(c, "small") || imgOf(front, "small"),
      edh: c.edhrec_rank || 0, prod: c.produced_mana || [], layout: c.layout || "", faces,
      price: c.prices ? (c.prices.eur || c.prices.usd || "") : "", priceCur: c.prices && c.prices.eur ? "€" : "$",
      uri: c.scryfall_uri || "",
    };
  };

  B.sf = {
    async sets() {
      const cached = B.store.get("sets", null);
      if (cached && Date.now() - cached.t < 86400000) return cached.data;
      const j = await req("/sets");
      const keep = new Set(["expansion", "core", "masters", "draft_innovation", "funny", "starter", "commander", "alchemy"]);
      const data = (j.data || []).filter((s) => keep.has(s.set_type) && !s.digital && s.card_count > 0)
        .map((s) => ({ code: s.code.toUpperCase(), name: s.name, date: s.released_at || "", type: s.set_type, count: s.card_count, icon: s.icon_svg_uri }))
        .sort((a, b) => b.date.localeCompare(a.date));
      B.store.set("sets", { t: Date.now(), data });
      return data;
    },
    /* one page of a search; pass either a query or the next_page URL */
    async search(q, opts = {}) {
      const url = opts.next || ("/cards/search?" + new URLSearchParams({ q, unique: opts.unique || "prints", order: opts.order || "set", dir: opts.dir || "auto", include_extras: "false" }));
      const j = await req(url);
      return { cards: (j.data || []).map(B.slim), next: j.has_more ? j.next_page : null, total: j.total_cards || 0 };
    },
    async named(name, fuzzy) {
      const j = await req("/cards/named?" + new URLSearchParams({ [fuzzy ? "fuzzy" : "exact"]: name }));
      return j && j.object === "card" ? B.slim(j) : null;
    },
    async autocomplete(q) {
      if (q.length < 2) return [];
      const j = await req("/cards/autocomplete?" + new URLSearchParams({ q }));
      return j.data || [];
    },
    /* identifiers: [{name}|{set,collector_number}|{id}] – batched by 75, falls back to GET per card */
    async collection(identifiers) {
      const found = [], notFound = [];
      for (let i = 0; i < identifiers.length; i += 75) {
        const part = identifiers.slice(i, i + 75);
        try {
          const j = await req("/cards/collection", { method: "POST", body: JSON.stringify({ identifiers: part }) });
          (j.data || []).forEach((c) => found.push(B.slim(c)));
          (j.not_found || []).forEach((x) => notFound.push(x));
        } catch (e) {
          for (const idf of part) {
            try {
              let c = null;
              if (idf.id) { const j = await req("/cards/" + idf.id); c = j.object === "card" ? B.slim(j) : null; }
              else if (idf.set) { const j = await req(`/cards/${idf.set.toLowerCase()}/${encodeURIComponent(idf.collector_number)}`); c = j.object === "card" ? B.slim(j) : null; }
              else c = await this.named(idf.name, false);
              c ? found.push(c) : notFound.push(idf);
            } catch (_) { notFound.push(idf); }
          }
        }
      }
      return { found, notFound };
    },
    /* all printings of one card (by oracle id or exact name) */
    async prints(card) {
      const q = card.oid ? `oracleid:${card.oid}` : `!"${card.name}"`;
      const r = await this.search(q, { unique: "prints", order: "released" });
      return r.cards;
    },
    /* list of every card name (~35k), cached for 7 days */
    async cardNames() {
      const c = await idb.get("names");
      if (c && Date.now() - c.t < 7 * 86400000 && c.data && c.data.length > 1000) return c.data;
      const j = await req("/catalog/card-names");
      const data = j.data || [];
      if (data.length) await idb.set("names", { t: Date.now(), data });
      return data.length ? data : (c ? c.data : []);
    },
  };
})(window.B);
