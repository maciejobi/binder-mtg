/* Binder MTG – optional Claude API integration (user's own key, stored only in this browser).
   Used for: AI deck building and AI photo reading. The key never leaves the browser except to api.anthropic.com. */
(function (B) {
  "use strict";
  const DEFAULT_MODEL = "claude-sonnet-5";

  B.claude = {
    hasKey() { return !!B.store.get("apiKey", ""); },
    model() { return B.store.get("apiModel", DEFAULT_MODEL) || DEFAULT_MODEL; },
    async ask(content, { json = false, maxTokens = 4000, signal } = {}) {
      const key = B.store.get("apiKey", "");
      if (!key) throw new Error("Brak klucza API Claude. Dodaj go w Ustawieniach.");
      let res;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: this.model(), max_tokens: maxTokens, messages: [{ role: "user", content }] }),
        });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error("Brak połączenia z API Claude.");
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = j.error && j.error.message ? j.error.message : "HTTP " + res.status;
        if (res.status === 401) throw new Error("Klucz API jest nieprawidłowy (401).");
        if (res.status === 429) throw new Error("Limit zapytań API wyczerpany. Spróbuj za chwilę.");
        throw new Error("Błąd API Claude: " + msg);
      }
      const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (!json) return text;
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      let body = fenced ? fenced[1] : text;
      const start = body.search(/[\[{]/), end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
      if (start >= 0 && end > start) body = body.slice(start, end + 1);
      try { return JSON.parse(body); } catch (e) { throw new Error("Claude zwrócił odpowiedź w złym formacie. Spróbuj ponownie."); }
    },
    async buildDeck(entries, opts, signal) {
      const pool = entries.filter((x) => x.card.std === "legal");
      const line = (x) => {
        const c = x.card; let t = (c.text || "").replace(/\([^)]*\)/g, "").replace(/\s*\n\s*/g, " / ").trim();
        if (t.length > 200) t = t.slice(0, 200) + "…";
        return `${x.q}x ${c.name} | ${c.mana || "-"} | ${c.type}${c.p != null ? " | " + c.p + "/" + c.t : ""}${t ? " | " + t : ""}`;
      };
      const prompt = `Jesteś doświadczonym deckbuilderem Magic: The Gathering (format Standard, dziś ${B.today()}).
Zbuduj NAJSILNIEJSZY możliwy deck z kolekcji poniżej.
Zasady: mainboard dokładnie ${opts.size} kart; max 4 kopie jednej nazwy (lądy podstawowe bez limitu); używaj wyłącznie kart z kolekcji i nie więcej kopii niż podano; lądy podstawowe: ${opts.basicsFree ? "dowolna liczba" : "tylko posiadane"}; ${opts.bo3 && opts.size === 60 ? "sideboard do 15 kart z pozostałych kart" : "bez sideboardu"}; styl: ${opts.style === "auto" ? "wybierz najlepszy" : opts.style}${opts.colors.length ? "; kolory: " + opts.colors.join("") : ""}.
Odpowiedz WYŁĄCZNIE JSON (teksty po polsku, nazwy kart po angielsku dokładnie jak w kolekcji):
{"name":"","archetype":"","style":"aggro|midrange|control","main":[{"n":"Nazwa","q":4}],"side":[{"n":"Nazwa","q":2}],"summary":"","plan":"","weak":"","upgrades":["karta spoza kolekcji do dokupienia i dlaczego"]}

KOLEKCJA:
${pool.map(line).join("\n").slice(0, 150000)}`;
      return this.ask([{ type: "text", text: prompt }], { json: true, maxTokens: 6000, signal });
    },
  };
})(window.B);
