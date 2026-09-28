/* Binder MTG – offline deck-building engine.
   Scores every Standard-legal card you own with rules-text heuristics, tries every colour combination
   and archetype, builds a legal 60- or 40-card deck with a sensible curve and mana base, and explains it. */
(function (B) {
  "use strict";
  const BASIC = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
  const BASIC_NAMES = new Set(Object.values(BASIC).concat(["Wastes"]));
  const COLORS = ["W", "U", "B", "R", "G"];

  /* ---------- card analysis ---------- */
  const RX = {
    removal: /\b(destroy|exile) (up to one )?target (creature|nonland permanent|permanent|artifact or creature|creature or planeswalker|creature or vehicle|attacking creature|tapped creature|creature an opponent controls|nontoken creature)/i,
    burn: /deals? (\d+|x|that much) damage to (any target|target creature|target (creature|planeswalker|player)( or (planeswalker|creature|battle))*|each creature)/i,
    shrink: /target creature (an opponent controls )?gets -(\d+|x)\/-(\d+|x)/i,
    fight: /\bfights? (target|another|up to one)|deals damage equal to its power to (target|another)/i,
    sweeper: /(destroy|exile) all (creatures|nonland permanents)|all creatures get -\d|deals? \d+ damage to each creature/i,
    counter: /counter target (spell|creature spell|noncreature spell|instant|sorcery|activated|artifact|enchantment)/i,
    bounce: /return (up to one )?target (creature|nonland permanent|permanent)[^.]*to (its|their) owner'?s hand/i,
    draw2: /draws? (two|three|four|x) cards/i,
    draw: /\bdraw (a|one) card|draws a card/i,
    loot: /draw a card, then discard|surveil|scry \d|investigate/i,
    token: /create (a|an|one|two|three|four|x|\d+) [^.]*?(creature )?tokens?/i,
    discard: /(each opponent|target (opponent|player)) discards/i,
    ramp: /search your library for (a|up to \w+) (basic )?land|add \{[WUBRGC]\}|add one mana|treasure token/i,
    lifegain: /gain (\d+|x) life|lifelink/i,
    etb: /when(ever)? [^.]*? enters/i,
    counters: /\+1\/\+1 counter/i,
    anthem: /(creatures|other [a-z]+s?) you control get \+\d/i,
    tapped: /enters (the battlefield )?tapped/i,
    drawback: /at the beginning of (the|your) end step, sacrifice (this|it)|sacrifice (this creature|it) at|can't block|skip your/i,
    protect: /hexproof|indestructible|protection from|ward/i,
    trick: /target creature (you control )?gets \+\d+\/\+\d+ until end of turn/i,
    hate: /artifact or enchantment|destroy target (artifact|enchantment)|exile (all|target) cards? from (a|each|target) (player's )?graveyard|counter target noncreature|flying|destroy all|you gain \d+ life|discards?/i,
  };
  const KW = { Flying: 0.8, Haste: 0.45, Deathtouch: 0.6, Lifelink: 0.45, Trample: 0.3, "First strike": 0.45, "Double strike": 1.1, Vigilance: 0.25, Menace: 0.4, Ward: 0.45, Flash: 0.4, Hexproof: 0.6, Indestructible: 0.8, Reach: 0.15, Prowess: 0.3, Defender: -0.9 };
  const RAR = { common: 1, uncommon: 1.5, rare: 2.2, mythic: 2.6, special: 1.8, bonus: 1.8 };

  function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function isType(c, t) { return new RegExp("\\b" + t + "\\b").test(c.type.split("//")[0]); }
  function subtypes(c) { const m = c.type.split("//")[0].split(/—|-/)[1]; return m ? m.trim().split(/\s+/).filter(Boolean) : []; }

  function analyse(c) {
    const text = (c.text || "").replace(/\([^)]*\)/g, ""); const kw = new Set(c.kw || []);
    const t = {
      land: isType(c, "Land") && !isType(c, "Creature"),
      creature: isType(c, "Creature"), pw: isType(c, "Planeswalker"),
      instant: isType(c, "Instant"), legendary: /Legendary/.test(c.type),
      removal: RX.removal.test(text) || RX.shrink.test(text) || RX.fight.test(text) || (RX.burn.test(text) && !/each opponent|target player$/i.test(text.match(RX.burn)?.[0] || "")),
      sweeper: RX.sweeper.test(text), counter: RX.counter.test(text), bounce: RX.bounce.test(text),
      draw: RX.draw2.test(text) ? 2 : RX.draw.test(text) ? 1 : RX.loot.test(text) ? 0.5 : 0,
      token: RX.token.test(text), discard: RX.discard.test(text), ramp: RX.ramp.test(text) && !isType(c, "Land"),
      lifegain: RX.lifegain.test(text) || kw.has("Lifelink"), etb: RX.etb.test(text), trick: RX.trick.test(text),
      hate: RX.hate.test(text), anthem: RX.anthem.test(text), drawback: RX.drawback.test(text),
      tapped: RX.tapped.test(text), kw, subtypes: subtypes(c), text,
    };
    const m = text.match(RX.burn); t.burnN = m ? (m[1] === "x" ? 3 : num(m[1]) || 2) : 0;
    return t;
  }

  function baseScore(c, a) {
    if (a.land) return 0;
    let s = RAR[c.rarity] || 1;
    if (c.edh) s += Math.max(0, (25000 - c.edh) / 25000) * 1.2;
    const cmc = c.cmc || 0;
    if (a.creature) {
      const p = num(c.p), tg = num(c.t);
      const expected = 1.25 * Math.max(cmc, 0.5) + 0.5;
      s += (p + tg * 0.65 - expected) * 0.32;
      if (a.etb) s += 0.45;
    }
    if (a.pw) s += 1.8;
    for (const k of a.kw) if (KW[k]) s += KW[k];
    if (a.removal) s += 2.1 + Math.min(1, a.burnN * 0.12);
    if (a.sweeper) s += 1.2;
    if (a.counter) s += 1.1;
    if (a.bounce) s += 0.5;
    s += a.draw * 0.7;
    if (a.token) s += 0.7;
    if (a.discard) s += 0.5;
    if (a.ramp) s += 0.35;
    if (a.anthem) s += 0.6;
    if (a.trick) s += 0.2;
    if (a.drawback) s -= 0.6;
    if (cmc >= 6) s -= 0.35 * (cmc - 5) * (a.removal || a.sweeper || c.rarity === "mythic" ? 0.4 : 1);
    if (c.std === "banned") s = -99;
    return s;
  }

  function styleAdj(c, a, style) {
    const cmc = c.cmc || 0; let s = 0;
    if (style === "aggro") {
      if (a.creature && cmc <= 2) s += 0.9; else if (a.creature && cmc === 3) s += 0.4;
      if (a.kw.has("Haste")) s += 0.5;
      if (a.burnN) s += 0.3;
      if (cmc >= 5) s -= 1.1; if (cmc === 4) s -= 0.3;
      if (a.counter || a.sweeper) s -= 1.2;
      if (a.creature && num(c.p) === 0) s -= 1;
    } else if (style === "control") {
      if (a.removal) s += 0.8; if (a.sweeper) s += 1.4; if (a.counter) s += 0.8; s += a.draw * 0.5;
      if (a.creature && cmc <= 2 && !a.etb && !a.kw.has("Flying")) s -= 0.7;
      if (a.kw.has("Haste")) s -= 0.2;
      if (a.pw) s += 0.5;
    } else { // midrange
      if (a.etb) s += 0.3; if (a.removal) s += 0.3;
      if (a.creature && cmc >= 3 && cmc <= 5 && num(c.p) + num(c.t) >= cmc * 2) s += 0.4;
      if (a.counter) s -= 0.2;
    }
    return s;
  }

  /* ---------- colours ---------- */
  function symbols(c) { return (String(c.mana || "").match(/\{[^}]+\}/g) || []).map((x) => x.slice(1, -1)); }
  function castable(c, cols) {
    for (const s of symbols(c)) {
      if (/^[WUBRG]$/.test(s)) { if (!cols.includes(s)) return false; }
      else if (/^[WUBRG]\/[WUBRG]$/.test(s)) { const [x, y] = s.split("/"); if (!cols.includes(x) && !cols.includes(y)) return false; }
      else if (/^[WUBRG]\/P$/.test(s)) { /* phyrexian: payable with life */ }
      else if (/^[2]\/[WUBRG]$/.test(s)) { /* {2/W} payable with generic */ }
    }
    // colour identity outside the deck colours (e.g. activated abilities) is allowed only for artifacts/colourless
    return true;
  }
  function pipCount(c) { const o = {}; for (const s of symbols(c)) for (const ch of s.split("/")) if (COLORS.includes(ch)) o[ch] = (o[ch] || 0) + (s.includes("/") ? 0.5 : 1); return o; }

  function combos(pool) {
    const out = COLORS.map((c) => [c]);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) out.push([COLORS[i], COLORS[j]]);
    // three colours only when enough multicolour lands are owned
    const fixers = pool.filter((x) => x.a.land && (x.card.prod || []).filter((m) => COLORS.includes(m)).length >= 2);
    if (fixers.reduce((n, x) => n + x.q, 0) >= 5)
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) for (let k = j + 1; k < 5; k++) out.push([COLORS[i], COLORS[j], COLORS[k]]);
    return out;
  }

  /* ---------- deck assembly for one colour set + style ---------- */
  const CURVE = { aggro: [0.24, 0.34, 0.24, 0.11, 0.05, 0.02], midrange: [0.08, 0.25, 0.25, 0.2, 0.14, 0.08], control: [0.08, 0.22, 0.22, 0.2, 0.14, 0.14] };
  const CREAT_MIN = { aggro: 0.55, midrange: 0.38, control: 0.12 };
  const bucket = (cmc) => Math.max(0, Math.min(5, Math.round(cmc) - 1));

  function landCount(size, style, avg) {
    if (size === 40) return avg <= 2.4 ? 16 : avg <= 3.4 ? 17 : 18;
    if (style === "aggro") return avg <= 2.2 ? 21 : 22;
    return avg <= 2.7 ? 22 : avg <= 3.1 ? 23 : avg <= 3.5 ? 24 : avg <= 4 ? 25 : 26;
  }

  function assemble(pool, cols, style, opts, tribal) {
    const size = opts.size;
    const spells = pool.filter((x) => !x.a.land && castable(x.card, cols));
    const tribalAdj = (x) => (tribal && x.a.subtypes.includes(tribal.type) ? tribal.bonus : 0) + (tribal && tribal.lordRx.test(x.a.text) ? 1.0 : 0);
    const offHybrid = (x) => symbols(x.card).filter((s) => /^2\/[WUBRG]$/.test(s) && !cols.includes(s[2])).length * 0.6;
    const val = (x) => x.base + styleAdj(x.card, x.a, style) + tribalAdj(x) - offHybrid(x);
    const real = (x) => x.base + tribalAdj(x) - offHybrid(x); // style-independent value used to compare decks
    // expand copies
    const copies = [];
    for (const x of spells) {
      const v = val(x); const maxQ = Math.min(4, x.q);
      for (let k = 0; k < maxQ; k++) copies.push({ x, v: v - (k ? 0.08 * k : 0) - (k && (x.a.legendary && (x.a.creature || x.a.pw)) ? 0.9 : 0), k });
    }
    copies.sort((a, b) => b.v - a.v);
    let landsN = landCount(size, style, 3);
    const pick = (landsN) => {
      const need = size - landsN; const cap = CURVE[style].map((f) => Math.ceil(f * need * 1.45) + 1);
      const cnt = [0, 0, 0, 0, 0, 0]; const chosen = []; const rest = [];
      for (const c of copies) {
        if (chosen.length >= need) { rest.push(c); continue; }
        const b = bucket(c.x.card.cmc);
        if (cnt[b] < cap[b]) { chosen.push(c); cnt[b]++; } else rest.push(c);
      }
      while (chosen.length < need && rest.length) chosen.push(rest.shift());
      // creature minimum
      const minC = Math.round(CREAT_MIN[style] * need);
      let creatures = chosen.filter((c) => c.x.a.creature).length;
      const restC = rest.filter((c) => c.x.a.creature);
      while (creatures < minC && restC.length) {
        const worst = chosen.filter((c) => !c.x.a.creature).sort((a, b) => a.v - b.v)[0]; if (!worst) break;
        const inC = restC.shift(); chosen.splice(chosen.indexOf(worst), 1, inC); rest.splice(rest.indexOf(inC), 1); rest.push(worst); creatures++;
      }
      return { chosen, rest, need };
    };
    let r = pick(landsN);
    const avg = r.chosen.length ? r.chosen.reduce((a, c) => a + c.x.card.cmc, 0) / r.chosen.length : 3;
    const l2 = landCount(size, style, avg);
    if (l2 !== landsN) { landsN = l2; r = pick(landsN); }

    // ---- mana base
    const pips = {}; cols.forEach((c) => (pips[c] = 0));
    for (const c of r.chosen) { const p = pipCount(c.x.card); for (const k in p) if (k in pips) pips[k] += p[k]; }
    const nonbasic = [];
    const landsOwned = pool.filter((x) => x.a.land && !BASIC_NAMES.has(x.card.name));
    const scoredLands = landsOwned.map((x) => {
      const prod = (x.card.prod || []).filter((m) => COLORS.includes(m));
      const inCols = prod.filter((m) => cols.includes(m)); const outCols = prod.filter((m) => !cols.includes(m));
      let s = inCols.length >= 2 ? 3 : inCols.length === 1 && cols.length === 1 ? 1.2 : inCols.length === 1 ? 0.6 : prod.length === 0 && cols.length === 1 ? 0.4 : -1;
      if (x.a.tapped) s -= style === "aggro" ? 0.8 : 0.3;
      if (outCols.length && inCols.length < 2) s -= 0.5;
      if (/any color/i.test(x.card.text) && inCols.length === 0) s = cols.length >= 2 ? 1.5 : 0.3;
      return { x, s, prod: inCols.length ? inCols : /any color/i.test(x.card.text) ? cols.slice() : [] };
    }).filter((l) => l.s > 0).sort((a, b) => b.s - a.s);
    let nb = 0; const maxNB = cols.length === 1 ? Math.floor(landsN * 0.25) : Math.floor(landsN * 0.6);
    const sources = {}; cols.forEach((c) => (sources[c] = 0));
    for (const l of scoredLands) {
      const q = Math.min(4, l.x.q, maxNB - nb); if (q <= 0) break;
      nonbasic.push({ card: l.x.card, q }); nb += q; l.prod.forEach((m) => (sources[m] += q));
    }
    let basicsN = landsN - nb; const basics = {};
    const totalPips = cols.reduce((a, c) => a + (pips[c] || 0), 0) || cols.length;
    cols.forEach((c) => (basics[c] = Math.round(basicsN * (pips[c] || totalPips / cols.length) / totalPips)));
    let diff = basicsN - cols.reduce((a, c) => a + basics[c], 0);
    const byNeed = cols.slice().sort((a, b) => (pips[b] || 0) - (pips[a] || 0));
    for (let i = 0; diff !== 0 && i < 20; i++) { const c = byNeed[i % byNeed.length]; if (diff > 0) { basics[c]++; diff--; } else if (basics[c] > 1) { basics[c]--; diff++; } }
    // minimum sources for splash colours
    const minSrc = size === 40 ? 6 : 8;
    if (cols.length > 1) for (const c of cols) { while (basics[c] + sources[c] < minSrc) { const donor = byNeed.find((d) => d !== c && basics[d] + sources[d] > minSrc + 1 && basics[d] > 0); if (!donor) break; basics[donor]--; basics[c]++; } }
    const warnings = [];
    if (!opts.basicsFree) {
      for (const c of cols) {
        const own = pool.filter((x) => x.card.name === BASIC[c]).reduce((a, x) => a + x.q, 0);
        if (basics[c] > own) { warnings.push(`Masz tylko ${own}× ${BASIC[c]}, a deck potrzebuje ${basics[c]}.`); basics[c] = own; }
      }
    }
    const basicCards = cols.filter((c) => basics[c] > 0).map((c) => ({ card: basicCard(pool, BASIC[c], c), q: basics[c] }));

    // ---- merge copies into list
    const main = mergeCopies(r.chosen);
    const lands = nonbasic.concat(basicCards);
    const count = r.chosen.length + lands.reduce((a, l) => a + l.q, 0);
    if (count < size) warnings.unshift(`Brakuje ${size - count} kart do pełnych ${size} – w tych kolorach masz za mało kart.`);

    // ---- sideboard (Bo3, 60 cards)
    let side = [];
    if (opts.bo3 && size === 60) {
      const used = new Map(main.map((m) => [key(m.card), m.q]));
      const sb = r.rest.map((c) => ({ c, v: c.v * 0.5 + (c.x.a.hate ? 2 : 0) + (c.x.a.removal ? 1 : 0) + (c.x.a.counter ? 0.8 : 0) }))
        .sort((a, b) => b.v - a.v); const sel = [];
      for (const { c } of sb) { if (sel.length >= 15) break; const k = key(c.x.card); if ((used.get(k) || 0) >= Math.min(4, c.x.q)) continue; used.set(k, (used.get(k) || 0) + 1); sel.push(c); }
      side = mergeCopies(sel);
    }

    // ---- scoring of the whole deck
    const curve = [0, 0, 0, 0, 0, 0, 0]; let creatures = 0, removal = 0, draw = 0, cmcSum = 0;
    for (const c of r.chosen) { curve[Math.min(6, Math.round(c.x.card.cmc))]++; if (c.x.a.creature) creatures++; if (c.x.a.removal || c.x.a.sweeper) removal++; if (c.x.a.draw >= 1) draw++; cmcSum += c.x.card.cmc; }
    let score = r.chosen.reduce((a, c) => a + real(c.x) - (c.k ? 0.08 * c.k : 0), 0);
    const inter = r.chosen.filter((c) => c.x.a.removal || c.x.a.sweeper || c.x.a.counter || c.x.a.draw >= 1).length;
    const avgC = r.chosen.length ? r.chosen.reduce((a, c) => a + c.x.card.cmc, 0) / r.chosen.length : 0;
    // how well the list actually fits the archetype it claims
    if (style === "aggro") score -= Math.max(0, avgC - 2.6) * 8 + Math.max(0, 0.5 * r.need - creatures) * 0.5;
    else if (style === "control") score -= Math.max(0, 0.45 * r.need - inter) * 0.6 + Math.max(0, creatures - 0.35 * r.need) * 0.4;
    else score -= Math.max(0, 0.3 * r.need - creatures) * 0.4;
    const need = r.need; const target = CURVE[style].map((f) => f * need); const bcnt = [0, 0, 0, 0, 0, 0];
    r.chosen.forEach((c) => bcnt[bucket(c.x.card.cmc)]++);
    score -= bcnt.reduce((a, n, i) => a + Math.abs(n - target[i]), 0) * 0.12;
    score -= Math.max(0, size - count) * 4;
    score += cols.length === 1 ? 1.5 : cols.length === 3 ? -3 + Math.min(2, nb * 0.3) : Math.min(2, nb * 0.35) - 0.5;
    if (removal < (size === 60 ? 4 : 3)) score -= (4 - removal) * 0.8;
    if (tribal) score += tribal.bonusDeck;

    return { cols, style, size, main, lands, side, score, count, warnings,
      stats: { creatures, removal, draw, avg: r.chosen.length ? cmcSum / r.chosen.length : 0, curve, landsN, spells: r.chosen.length, nonbasic: nb },
      picked: r.chosen, rest: r.rest };
  }
  function key(c) { return c.oid || c.name; }
  function mergeCopies(list) {
    const m = new Map();
    for (const c of list) { const k = key(c.x.card); const e = m.get(k) || { card: c.x.card, q: 0, v: c.v }; e.q++; m.set(k, e); }
    return [...m.values()].sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
  }
  function basicCard(pool, name, color) {
    const own = pool.find((x) => x.card.name === name);
    return own ? own.card : { id: "basic-" + color, oid: "basic-" + color, name, type: "Basic Land — " + name, mana: "", cmc: 0, rarity: "common", std: "legal", prod: [color], set: "", cn: "", img: "", imgS: "", text: "" };
  }

  function findTribal(picked) {
    const counts = new Map();
    for (const c of picked) if (c.x.a.creature) for (const s of c.x.a.subtypes) counts.set(s, (counts.get(s) || 0) + 1);
    let best = null;
    for (const [type, n] of counts) if (n >= 7 && (!best || n > best.n)) best = { type, n };
    if (!best) return null;
    const plural = best.type.endsWith("f") ? best.type.slice(0, -1) + "ves" : best.type + "s";
    return { type: best.type, n: best.n, bonus: 0.35, bonusDeck: (best.n - 6) * 0.3, lordRx: new RegExp(`\\b(${best.type}|${plural})\\b`, "i") };
  }

  /* ---------- explanations (Polish) ---------- */
  function explain(d, tribal) {
    const cn = d.cols.map((c) => B.COLORNAME[c].toLowerCase()).join(" i ");
    const styleName = { aggro: "Aggro", midrange: "Midrange", control: "Control" }[d.style];
    d.archetype = `${B.guild(d.cols)} ${tribal ? tribal.type + " " : ""}${styleName}`;
    d.name = tribal ? `${B.guild(d.cols)} ${tribal.type.endsWith("f") ? tribal.type.slice(0, -1) + "ves" : tribal.type + "s"}` : `${B.guild(d.cols)} ${styleName}`;
    const key = d.picked.slice().sort((a, b) => b.v - a.v).map((c) => c.x.card.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 5);
    const plans = {
      aggro: "Wystawiaj tanie stwory od pierwszych tur i atakuj co turę. Usuwanie zużywaj na blokujących, a nie na zagrożenia, które nie przeszkadzają w ataku. Trzymaj rękę z 2–3 lądami i tanimi kartami; bez zagrania na turę 1–2 raczej mulliganuj.",
      midrange: "Graj najlepszą kartę na każdą turę krzywej, wymieniaj się korzystnie z tym, co wystawia przeciwnik, i przejmij stół od tury 4–5. Przeciw szybkim deckom graj defensywnie, przeciw wolnym bądź agresorem.",
      control: "Przetrwaj wczesne tury usuwaniem i kontrami, dociągaj karty i wygrywaj kilkoma mocnymi zagrożeniami na końcu krzywej. Nie wydawaj usuwania na mało groźne stwory, jeśli masz lepsze cele w talii przeciwnika.",
    };
    const weak = [];
    if (d.stats.removal < (d.size === 60 ? 6 : 4)) weak.push(`mało usuwania (${d.stats.removal} kart), więc mocny stwór przeciwnika może przejąć grę`);
    if (d.stats.draw < 3) weak.push("mało dobierania kart; w długiej grze deck może zabraknąć paliwa");
    if (d.style !== "control" && d.stats.creatures < d.stats.spells * 0.35) weak.push("stosunkowo mało stworów");
    if (d.stats.avg > 3.4) weak.push(`wysoka średnia koszt many (${d.stats.avg.toFixed(2)}); szybkie decki mogą Cię wyprzedzić`);
    if (d.cols.length >= 2 && d.stats.nonbasic < 4) weak.push("mało lądów dwukolorowych, więc zdarzą się ręce bez właściwego koloru");
    const singles = d.main.filter((m) => m.q === 1).length;
    if (singles > d.main.length * 0.6) weak.push("większość kart w pojedynczych kopiach, więc gry będą mniej powtarzalne");
    const upgrades = d.main.filter((m) => m.q < 4 && !/Legendary/.test(m.card.type)).sort((a, b) => b.v - a.v).slice(0, 6)
      .map((m) => `${m.card.name}: masz ${B.col.ownedByOracle(m.card.oid, m.card.name)}, warto mieć ${4} kopie`);
    d.summary = `${d.archetype}: ${cn === "" ? "bezbarwny" : cn} deck ${d.style === "aggro" ? "nastawiony na szybkie obrażenia" : d.style === "control" ? "oparty na kontroli stołu i przewadze kart" : "grający najmocniejszymi kartami na każdej turze"}. ${d.stats.creatures} stworów, ${d.stats.removal} kart usuwania, średni koszt ${d.stats.avg.toFixed(2)}. Kluczowe karty: ${key.join(", ")}.${tribal ? ` Synergia plemienna: ${tribal.n} stworów typu ${tribal.type}.` : ""}`;
    d.plan = plans[d.style];
    d.weak = weak.length ? "Uwaga na: " + weak.join("; ") + "." : "Deck nie ma wyraźnych braków w podstawowych proporcjach.";
    d.upgrades = upgrades;
    return d;
  }

  /* ---------- public API ---------- */
  function preparePool(entries) {
    return entries.filter((x) => x.card.std === "legal").map((x) => { const a = analyse(x.card); return { card: x.card, q: x.q, a, base: baseScore(x.card, a) }; });
  }

  B.deck = {
    analyse, castable,
    build(entries, opts) {
      opts = Object.assign({ size: 60, style: "auto", colors: [], bo3: true, basicsFree: true }, opts);
      const pool = preparePool(entries);
      const spells = pool.filter((x) => !x.a.land);
      if (spells.reduce((a, x) => a + x.q, 0) < 8) return { error: "Masz za mało kart legalnych w Standardzie, żeby zbudować deck. Dodaj więcej kart do kolekcji." };
      const styles = opts.style === "auto" ? ["aggro", "midrange", "control"] : [opts.style];
      const cs = opts.colors && opts.colors.length ? [opts.colors] : combos(pool);
      const results = [];
      for (const cols of cs) for (const st of styles) {
        let d = assemble(pool, cols, st, opts, null);
        const tribal = findTribal(d.picked);
        if (tribal) { const d2 = assemble(pool, cols, st, opts, tribal); if (d2.score > d.score) d = Object.assign(d2, { tribal }); }
        results.push(d);
      }
      results.sort((a, b) => b.score - a.score);
      const best = explain(results[0], results[0].tribal);
      const seen = new Set([best.cols.join("")]); const alts = [];
      for (const r of results.slice(1)) { const k = r.cols.join(""); if (seen.has(k)) continue; seen.add(k); alts.push(explain(r, r.tribal)); if (alts.length >= 4) break; }
      return { best, alts, tried: results.length };
    },
    /* turns a name list (e.g. from Claude) into a checked deck using the same structure */
    fromList(entries, list, opts) {
      opts = Object.assign({ size: 60, basicsFree: true }, opts);
      const pool = preparePool(entries);
      const byName = new Map(); pool.forEach((x) => { byName.set(B.norm(x.card.name), x); if (x.card.faces) byName.set(B.norm(x.card.faces[0].name), x); });
      const warnings = []; const used = new Map();
      const conv = (arr, label) => {
        const out = [];
        for (const it of arr || []) {
          const n = String(it.n || it.name || ""); let q = Math.max(0, parseInt(it.q, 10) || 0); if (!q) continue;
          const col = Object.entries(BASIC).find(([, v]) => v.toLowerCase() === n.toLowerCase());
          if (col && opts.basicsFree) { out.push({ card: basicCard(pool, col[1], col[0]), q, v: 0 }); continue; }
          const x = byName.get(B.norm(n));
          if (!x) { warnings.push(`${label}: pominięto „${n}” (brak w kolekcji lub nielegalna)`); continue; }
          const have = x.q - (used.get(key(x.card)) || 0);
          if (have <= 0) { warnings.push(`${label}: pominięto ${n} (wykorzystano wszystkie kopie)`); continue; }
          if (q > have) { warnings.push(`${label}: ${n} zmniejszono do ${have} (tyle masz)`); q = have; }
          if (q > 4 && !BASIC_NAMES.has(x.card.name)) { q = 4; warnings.push(`${label}: ${n} ograniczono do 4 kopii`); }
          used.set(key(x.card), (used.get(key(x.card)) || 0) + q);
          out.push({ card: x.card, q, v: x.base, a: x.a });
        }
        return out;
      };
      const all = conv(list.main, "Main"), side = conv(list.side, "Sideboard");
      const lands = all.filter((m) => /\bLand\b/.test(m.card.type) && !/Creature/.test(m.card.type));
      const main = all.filter((m) => !lands.includes(m));
      const curve = [0, 0, 0, 0, 0, 0, 0]; let creatures = 0, removal = 0, draw = 0, cmcSum = 0, spells = 0;
      for (const m of main) { const a = m.a || analyse(m.card); curve[Math.min(6, Math.round(m.card.cmc))] += m.q; spells += m.q; cmcSum += m.card.cmc * m.q; if (a.creature) creatures += m.q; if (a.removal || a.sweeper) removal += m.q; if (a.draw >= 1) draw += m.q; }
      const count = all.reduce((a, m) => a + m.q, 0);
      if (count !== opts.size) warnings.push(`Mainboard ma ${count} kart zamiast ${opts.size}.`);
      const cols = COLORS.filter((c) => main.some((m) => symbols(m.card).some((s) => s.includes(c))));
      return { cols, style: list.style || "midrange", size: opts.size, main, lands, side, count, warnings,
        stats: { creatures, removal, draw, avg: spells ? cmcSum / spells : 0, curve, landsN: lands.reduce((a, l) => a + l.q, 0), spells, nonbasic: lands.filter((l) => !BASIC_NAMES.has(l.card.name)).reduce((a, l) => a + l.q, 0) },
        name: list.name || "Deck od Claude", archetype: list.archetype || "", summary: list.summary || "", plan: list.plan || "", weak: list.weak || "", upgrades: list.upgrades || [] };
    },
    BASIC_NAMES,
  };
})(window.B);
