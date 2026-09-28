# Binder MTG

Aplikacja webowa do kolekcji Magic: The Gathering:

- **Katalog**: przeglądanie kart ze Scryfall z prawdziwymi obrazkami. Stuknięcie karty dodaje ją do kolekcji.
- **Skaner**: zdjęcie kilkunastu kart naraz. Aplikacja wykrywa każdą kartę, odczytuje nazwę i kod edycji (OCR w przeglądarce), a Ty akceptujesz wynik przed dodaniem.
- **Kolekcja**: statystyki, legalność w Standardzie, ceny orientacyjne, import i eksport (JSON, CSV, lista tekstowa).
- **Deck**: wbudowany silnik buduje najmocniejszy deck 60- lub 40-kartowy z Twoich kart legalnych w Standardzie, z krzywą many, bazą lądów, sideboardem, planem gry i wariantami.
- **Opcjonalnie Claude AI**: z własnym kluczem API możesz budować decki przez AI i czytać zdjęcia przez Claude Vision.

Aplikacja jest w pełni statyczna: nie ma serwera ani bazy danych. Kolekcja zapisuje się w przeglądarce użytkownika, więc każdy odwiedzający ma własną.

## Publikacja (za darmo)

### Netlify Drop (najprościej, 1 minuta)
1. Wejdź na https://app.netlify.com/drop i zaloguj się (konto darmowe).
2. Przeciągnij **cały folder `binder-mtg`** na stronę.
3. Po chwili dostaniesz adres typu `https://nazwa.netlify.app`. Nazwę zmienisz w *Site configuration → Change site name*.

### GitHub Pages
1. Załóż repozytorium na GitHubie i wgraj do niego zawartość folderu (plik `index.html` ma być w katalogu głównym).
2. *Settings → Pages → Source: Deploy from a branch → main / root*.
3. Strona będzie pod `https://twojlogin.github.io/nazwa-repo/`.

### Cloudflare Pages
*Workers & Pages → Create → Pages → Upload assets* i wgraj folder.

Wszystkie trzy dają HTTPS, który jest potrzebny do instalacji aplikacji na telefonie (*Dodaj do ekranu głównego*) i do pracy offline.

## Uruchomienie lokalnie
Otwórz terminal w folderze i uruchom `python3 -m http.server 8000`, potem wejdź na http://localhost:8000. (Samo dwukliknięcie `index.html` też zadziała, ale bez trybu offline.)

## Jak działa skaner
1. **OpenCV.js** szuka na zdjęciu prostokątów o proporcjach karty i prostuje każdą kartę.
2. **Tesseract.js** czyta pasek z nazwą (próbuje też obrócić kartę o 180°) i, jeśli włączone, linię z kodem edycji i numerem w lewym dolnym rogu.
3. Odczytany tekst jest dopasowywany do listy ~35 000 nazw kart ze Scryfall (tolerancja literówek OCR).
4. Scryfall zwraca właściwy wydruk. Ty sprawdzasz listę, poprawiasz ewentualne błędy i akceptujesz.

Przy pierwszym skanowaniu przeglądarka pobiera ok. 13 MB bibliotek (OpenCV, Tesseract, słownik). Potem są w pamięci podręcznej.

Wskazówki: gładkie, kontrastowe tło, zdjęcie prosto z góry, dobre światło bez odblasków, 9–16 kart na zdjęciu. Gdy automatyczne wykrywanie zawodzi, wybierz układ siatki (np. 4 × 4) i wykadruj zdjęcie do samych kart. Folie, karty borderless/showcase i nieangielskie czyta się gorzej. Dla nich lepszy jest tryb Claude Vision.

## Claude AI (opcjonalnie)
W *Ustawieniach* wpisz klucz API z https://console.anthropic.com. Klucz zapisuje się tylko w przeglądarce osoby, która go wpisała, i jest wysyłany wyłącznie do `api.anthropic.com`. **Nie wpisuj swojego klucza do kodu strony**, bo byłby widoczny dla wszystkich odwiedzających. Zapytania są płatne z konta API.

## Pliki
```
index.html              układ aplikacji
css/style.css           wygląd (jasny i ciemny motyw)
js/util.js              wspólne funkcje
js/scryfall.js          klient API Scryfall (limit zapytań, cache)
js/names.js             dopasowanie tekstu z OCR do nazw kart
js/catalog.js           zakładka Katalog + panel szczegółów karty
js/scanner.js           skaner (OpenCV + Tesseract + Claude Vision)
js/collection.js        kolekcja, import/eksport
js/deckengine.js        silnik budowania decków
js/claude.js            opcjonalne API Claude
js/app.js               zakładki, ustawienia, start
sw.js, manifest.webmanifest, icon*.png   instalacja na telefonie i tryb offline
```

## Informacje prawne
Binder MTG to nieoficjalna aplikacja fanowska, dozwolona przez Fan Content Policy Wizards of the Coast. Nie jest zatwierdzona ani wspierana przez Wizards. Części materiałów są własnością Wizards of the Coast. ©Wizards of the Coast LLC. Dane kart, ceny i obrazy pochodzą ze Scryfall (https://scryfall.com). Aplikacja korzysta z API zgodnie z ich wytycznymi (odstęp między zapytaniami, pamięć podręczna).
