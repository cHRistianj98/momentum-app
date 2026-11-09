# Momentum ✦ — kalendarz, zadania i rutyny

Pierwsza działająca wersja MVP (frontend demo) osobistego planera z timeblockingiem, zadaniami, rutynami i grywalizacją. **Interfejs w języku polskim.**

## Uruchomienie w VS Code

Wymagania: **Node.js 20.19+** lub nowszy i npm.

1. Rozpakuj archiwum, otwórz katalog `momentum-app` w VS Code.
2. W terminalu wpisz:

```bash
npm install
npm run dev
```

3. Otwórz adres pokazany w terminalu (zwykle **http://localhost:5180/** — port ustawiony w `vite.config.ts`).

Do kompilacji produkcyjnej użyj `npm run build`, a do podglądu `npm run preview`.

## Powiadomienia i przypomnienia

- Każde zadanie (z datą i godziną) oraz każda rutyna może mieć **kilka przypomnień**, np. 30 min i 5 min przed startem — wybierasz je w formularzu (gotowe chipy albo „Własne”).
- Domyślne przypomnienia dla nowych zadań i rutyn ustawisz w **Ustawienia → Powiadomienia i przypomnienia**.
- Dzwonek w górnym pasku pokazuje nadchodzące przypomnienia (48 h) i historię; gdy aplikacja jest otwarta, przypomnienie pojawia się jako baner.

**iPhone:** powiadomienia systemowe działają od iOS 16.4 wyłącznie w aplikacji dodanej do ekranu początkowego
(Safari → Udostępnij → Do ekranu początkowego), uruchomionej z wersji produkcyjnej (`npm run build`) serwowanej przez **HTTPS**.
Zgodę daje się przyciskiem „Włącz” w dzwonku lub w ustawieniach.

### Także przy zamkniętej aplikacji (Web Push z serwera)

**Ustawienia → Powiadomienia → „Także przy zamkniętej aplikacji” → Włącz.** Na iPhonie: aplikacja z ekranu początkowego, iOS 16.4+.

- Aplikacja wylicza przypomnienia na najbliższe 7 dni (tą samą logiką co lokalnie) i wysyła listę do Workera; **Cron Trigger**
  (co minutę, `wrangler.jsonc` → `triggers`) wysyła te, których czas nadszedł. Dokładność ok. ±1 min.
- Szyfrowanie treści według RFC 8291 (aes128gcm) i uwierzytelnienie VAPID (RFC 8292) na WebCrypto, bez dodatkowych bibliotek
  (`worker/webpush.ts`). Klucze VAPID serwer tworzy sam przy pierwszym użyciu i trzyma w D1 — nic nie trzeba konfigurować.
- Z włączoną synchronizacją lista jest wspólna dla konta: zadanie dodane na laptopie powiadomi telefon, nawet gdy aplikacja
  na nim jest zamknięta. Gdy aplikacja jest otwarta, push trafia też do dzwonka (bez duplikatu lokalnego powiadomienia).
- Lista odświeża się po każdej zmianie i co 6 godzin. Przypomnienia spóźnione o ponad 30 min (np. po awarii) są pomijane.
- Prywatność: na serwerze leży treść przypomnień z najbliższych 7 dni (tytuł i godzina), usuwana po wysłaniu (najpóźniej po 3 dniach).
- Koszt: cron to ok. 1440 wywołań dziennie — w darmowym limicie Cloudflare (100 tys.).

## Synchronizacja w chmurze

Backend na Cloudflare: **Worker** (`worker/`, konfiguracja `wrangler.jsonc`) + baza **D1** (SQLite). Ten sam Worker
serwuje statyczną aplikację (Workers Static Assets) — kod uruchamia się tylko dla `/api/*`. Bez logowania — urządzenie dostaje
anonimowe konto chronione 24-znakowym **kodem odzyskiwania**. Synchronizację włącza się osobno na każdym urządzeniu;
dopóki jej nie włączysz, aplikacja działa wyłącznie lokalnie i nie wysyła danych.

### Jednorazowa konfiguracja Cloudflare (darmowy plan)

1. **Storage & Databases → D1 SQL Database → Create** — nazwa `momentum`. Skopiuj **Database ID** (UUID ze strony bazy).
2. Wpisz to ID w `wrangler.jsonc` (`d1_databases` → `database_id`).
3. Sprawdź, czy `"name"` w `wrangler.jsonc` jest identyczne z nazwą Workera w panelu (Workers & Pages).
4. Commit + push — Workers Builds wykona `npm run build` i `npx wrangler deploy`. Powiązania ustawia plik `wrangler.jsonc`
   (dodane ręcznie w panelu zostałyby nadpisane przy kolejnym wdrożeniu).
5. Test: `https://<adres-aplikacji>/api/health` powinno zwrócić `{"ok":true,"version":1}`. Tabele tworzą się same
   (schemat poglądowo w `migrations/0001_init.sql`).

### Jak zacząć

**Ustawienia → Synchronizacja w chmurze → Włącz synchronizację** na pierwszym urządzeniu (zapisz kod odzyskiwania),
a na kolejnym **Mam kod z innego urządzenia**.

### Jak to działa

- Synchronizowana jest cała przestrzeń `momentum.*` (to samo, co w kopii JSON) jako jedna migawka z numerem rewizji.
- Zmiany trafiają na serwer ok. 2,5 s po zapisie. Nowsze dane z chmury aplikacja pobiera przy starcie (przed pierwszym
  renderem), po powrocie do aplikacji i co minutę, gdy jest widoczna. Przeładowanie następuje tylko w bezpiecznym momencie
  (bez otwartych okien i edycji) — w przeciwnym razie pojawia się pasek „Nowe dane z innego urządzenia”.
- Gdy dane zmieniły się na dwóch urządzeniach, aplikacja **łączy zmiany** (scalanie trójstronne względem ostatniej wspólnej
  wersji, zapisanej lokalnie poza `momentum.*`). Łączą się osobno zadania, projekty, rutyny, kroki, logi rutyn i pola
  w nich. Gdy obie strony zmieniły to samo pole, wygrywa nowsza zmiana; usunięcie przegrywa z edycją. Jeśli połączenie
  wymaga odświeżenia widoku, dzieje się to w bezpiecznym momencie albo po dotknięciu „Wczytaj”.
- Wybór „Zachowaj z tego urządzenia” / „Wczytaj z chmury” zostaje tylko wtedy, gdy brak wspólnej wersji (np. pierwsza
  synchronizacja po aktualizacji aplikacji). Zastąpiona wersja z chmury trafia wtedy do historii.
- **Historia wersji** (Ustawienia → Synchronizacja → Historia wersji): serwer zachowuje kopię przy pierwszej zmianie
  każdego dnia, przed usunięciem dużej części danych (np. reset) i przed przywróceniem wersji — przez 30 dni, maks. 60
  wersji. Przywrócenie działa na wszystkich urządzeniach i można je cofnąć (obecna wersja też trafia do historii).
  Schemat poglądowo w `migrations/0002_history.sql`.
- Serwer przechowuje wyłącznie skrót SHA-256 kodu. Kod działa jak hasło: kto go zna, ma dostęp do danych; bez kodu nie
  odzyskasz kopii z chmury (dane na urządzeniu zostają). Dane można usunąć z serwera przyciskiem w ustawieniach.
- Limit migawki: 6 MB (najwięcej zajmują zdjęcia zapisane jako data URI). Darmowe limity Cloudflare (100 tys. żądań dziennie,
  D1: 500 MB na bazę, 5 mln odczytów i 100 tys. zapisów wierszy dziennie) wystarczają z dużym zapasem.
- Zabezpieczenie przed nadużyciem: limit 20 nowych kont dziennie na adres IP. Kopia JSON nadal jest zalecanym, niezależnym backupem.

## Zadania cykliczne

Zadanie, które się powtarza, ale nie ma listy kroków (np. siłownia w pn, śr i pt o 18:00). W formularzu zadania wybierz
**Powtarzanie**: *Codziennie*, *Co tydzień* (z wyborem dni), *Co 2 tygodnie* albo *Co miesiąc*. Seria zaczyna się od wybranej daty.

- Każde wystąpienie odhaczasz osobno — w kalendarzu, na liście „Moje zadania” (sekcja *Dzisiaj*) albo w panelu „Do zrobienia”.
  XP przyznawane jest za każde ukończone wystąpienie.
- Lista „Moje zadania” ma sekcję **Cykliczne**: harmonogram i najbliższy termin każdej serii.
- Przeciągnięcie lub zmiana długości bloku w kalendarzu pyta, czy zmienić tylko to wystąpienie, czy całą serię.
- **Przenieś na inny dzień** (także na iPhonie, gdzie bloku nie da się przeciągnąć na inny dzień): w oknie rutyny, zadania
  cyklicznego albo zwykłego zadania pasek z terminem ma przycisk „Przenieś”. Szybki wybór (*Dzień wcześniej/później*, *Dziś*,
  *Jutro*), kalendarz i godzina. Przenosi się tylko ten jeden termin — np. piątkowa siłownia na poniedziałek — razem
  z odhaczonymi krokami. „Pierwotny termin” cofa przeniesienie. Wystąpienie można przesunąć do 6 tygodni od terminu z harmonogramu.
- Usuwanie: *Tylko to wystąpienie*, *Zakończ serię* (kolejne terminy znikają, historia i XP zostają) albo *Usuń całą serię*.
- Przypomnienia, powiadomienia w tle, synchronizacja, statystyki i Weekly Review działają tak jak dla rutyn.
  W przeglądzie tygodnia seria liczy się jako zadanie, a jej regularność widać w sekcji systematyczności.
- Zwykłe zadanie można zamienić na cykliczne, wybierając powtarzanie w jego edycji.

Technicznie seria to wpis w `routines` z `kind: 'task'`, bez kroków, z regułą `repeat` (`every`: dzień/tydzień/miesiąc,
`interval`, `start`, opcjonalnie `until`). Dzięki temu korzysta z tych samych wirtualnych wystąpień i logów co rutyny.
Rutyny bez `repeat` działają jak dotąd (dni tygodnia, bez daty startu).

## Odznaki (100)

- **Statystyki → Osiągnięcia i odznaki**: 100 odznak w 9 grupach (Zadania, Regularność, Czas działania, Planowanie,
  Rutyny i serie, Przychód i rozwój, Projekty, Focus Mode, Doświadczenie). Zwinięta grupa pokazuje jeden rząd,
  „Pokaż wszystkie” rozwija resztę; filtry: wszystkie / zdobyte / do zdobycia.
- Zdobyta odznaka zostaje zdobyta, nawet gdy wynik później spadnie (np. po przerwanej serii).
- Po aktualizacji odznaki spełnione już wcześniej trafiają do kolekcji po cichu — jeden komunikat zamiast serii okienek.
- Katalog i zasady liczenia: `src/lib/progression.ts` (`ACHIEVEMENT_DEFINITIONS`), grafiki: `public/assets/progression/ach-<id>.svg`.

## Eksport dni do tekstu (np. do oceny przez AI)

**Weekly Review → „Eksport dni do tekstu”.** Wybierasz tydzień i zaznaczasz dni (przyszłych nie da się wybrać). Aplikacja
składa z nich zwykły tekst do skopiowania, udostępnienia (na iPhonie arkusz „Udostępnij”, np. do aplikacji ChatGPT)
albo pobrania jako `.txt`:

```text
Piątek 06.11.2026
07:00–07:45 🔴 Poranna rutyna (rutyna) — ukończona · kroki 2/2
    ✓ Szklanka wody
    ✓ Prysznic
09:00–11:00 🟢 Praca dla klienta — ukończone
bez godziny 🟡 Kurs React — ukończone · 45 min
Podsumowanie dnia: ukończono 3 z 3 · czas ukończonych 3 h 30 min (🟢 2 h · 🟡 45 min · 🔴 45 min)
```

- Kolor to kategoria (🟢 przychód, 🟡 możliwy przyszły przychód, 🔴 bez przychodu), z legendą na początku tekstu.
  Przy własnych kolorach kategorii znacznik dopasowuje się do wybranej barwy.
- Opcje (zapamiętywane): niewykonane pozycje, kroki rutyn i podzadania, notatki, krótka prośba o ocenę dla AI.
- Dane i liczby są te same co w Weekly Review (`src/lib/dayExport.ts`). Tekst nie jest nigdzie wysyłany, dopóki go nie wkleisz
  albo nie udostępnisz.

## Co działa w tej wersji

- Pulpit z kartami progresu, XP, kalendarzem dnia i panelem zadań.
- Kalendarz **dzień/tydzień**, nawigacja po datach, kliknięcie pustego slotu tworzy zadanie z godziną.
- **Przeciąganie bloków zadań** na inną godzinę i dzień na siatce kalendarza; zmiana czasu trwania w edytorze.
- Zadania: dodawanie, edycja, usuwanie, ukończenie/cofnięcie, kategoria, własna ikona, małe zdjęcie, czas, notatka, XP.
- Inbox dla zadań bez terminu, zadania zaplanowane i ukończone, filtrowanie, wyszukiwanie.
- Szybkie dodawanie popularnych zadań, przeciąganie z panelu po prawej na kalendarz; skróty `N` (nowe zadanie) i `Ctrl/Cmd + K` (wyszukiwarka).
- Rutyny: tworzenie szablonów, edytowanie kroków i dni tygodnia, wykonanie krok po kroku, jeden przycisk zamyka rutynę; jej blok w kalendarzu zostaje automatycznie oznaczony jako ukończony.
- XP, poziomy, seria aktywności, 100 odznak, statystyki, wykres ostatnich 7 dni i udział kategorii.
- Konfigurowalne kolory pięciu kategorii, jasny/ciemny motyw, responsywny interfejs.
- Automatyczny zapis w `localStorage`, działające przykładowe dane. W ustawieniach można je zresetować.

## Zakres i ograniczenia MVP

**To jest świadomie frontend-first**: nie ma jeszcze backendu Spring Boot, PostgreSQL, logowania, API Google Calendar/Tasks, synchronizacji wielu urządzeń, serwera powiadomień push ani aplikacji mobilnej. Dane są lokalne w konkretnej przeglądarce. Zdjęcia są zapisywane jako data URI (limit 900 KB), co nadaje się do demo, nie do rozwiązania produkcyjnego.

Nie ma jeszcze resize drag krawędzi bloku ani przenoszenia pojedynczego wystąpienia rutyny między dniami. Długość bloku można zmienić w edytorze zadania. Dla rutyn kalendarz pokazuje wystąpienia według harmonogramu szablonu.

## Jak działa model danych

- `Task` — zadanie wraz z dziennym statusem i opcjonalnym blokiem czasowym (dla MVP jedna instancja).
- `Routine` — szablon rutyny z listą kroków, porą i dniami tygodnia. Z `kind: 'task'` i regułą `repeat` — zadanie cykliczne.
- `RoutineLog` — dzienne wykonanie rutyny lub zadania cyklicznego: stan kroków, ukończenie, wyjątki terminu, `skipped` (usunięte wystąpienie).
- XP jest **wyliczane z ukończonych zadań i rutyn**, a nie dodawane inkrementalnie — dzięki temu ponowne kliknięcie nie powoduje naliczenia XP po raz drugi.
- Kategorie określają charakter aktywności finansowo-czasowej, nie karzą za odpoczynek.

Docelowo należy wydzielić instancje cyklicznych zadań i bloki czasowe do osobnych encji, dodać historię `XpTransaction`, API Spring Boot, PostgreSQL + Flyway, uwierzytelnianie i synchronizację.

## Gdzie zmieniać kod

```text
momentum-app/
  src/
    App.tsx                   # layout, nawigacja, stan i logika aplikacji
    styles.css                # design system, responsywność i dark mode
    styles-v06.css            # pasek kalendarza na iPhone, powiadomienia, statystyki, Weekly Review
    types.ts                  # typy domenowe
    components/
      CalendarView.tsx        # kalendarz i natywny drag & drop
      TaskModal.tsx           # edytor zadania (także powtarzanie i edycja serii)
      RoutineModal.tsx        # wykonywanie/edycja rutyn
      InsightsView.tsx        # statystyki, mapa regularności, odznaki
      WeeklyReview.tsx        # tygodniowe podsumowanie
      DayExport.tsx           # okno „Eksport dni do tekstu” (wybór dni, kopiowanie, udostępnianie, .txt)
      NotificationCenter.tsx  # dzwonek, baner przypomnienia, status zgody
      ReminderPicker.tsx      # wybór wielu przypomnień
      CloudSyncPanel.tsx      # ustawienia synchronizacji w chmurze i pasek konfliktu
    lib/
      date.ts                 # czas i daty lokalne
      icons.tsx               # zestaw ikon z lucide-react
      seed.ts                 # dane demonstracyjne, kategorie, presety
      storage.ts              # zapis lokalny
      recurrence.ts           # powtarzanie: wystąpienia serii, opisy, przesuwanie całej serii
      reminders.ts            # wyliczanie terminów przypomnień
      notifications.ts        # zgoda, wyświetlanie powiadomień, historia
      useReminders.ts         # harmonogram przypomnień w aplikacji
      progression.ts          # rangi i katalog 100 odznak (grupy, metryki postępu)
      dayExport.ts            # tekstowy eksport wybranych dni (plan, wykonanie, kroki, kolory kategorii)
      cloudSync.ts            # silnik synchronizacji (migawka, rewizje, scalanie, historia wersji)
      syncMerge.ts            # scalanie trójstronne zmian z dwóch urządzeń (czyste funkcje)
      syncBase.ts             # ostatnia wspólna wersja (baza scalania) w IndexedDB
      useCloudSync.ts         # hook React dla synchronizacji
      push.ts                 # subskrypcja Web Push i lista przypomnień dla serwera
  worker/
    index.ts                  # Cloudflare Worker: /api/* → API, reszta → statyczne pliki; cron co minutę
    sync.ts                   # API synchronizacji, historia wersji + zapis w D1
    push.ts                   # API powiadomień push + kolejka wysyłki (cron)
    webpush.ts                # szyfrowanie Web Push (RFC 8291) i VAPID na WebCrypto
  wrangler.jsonc              # konfiguracja Workera (assets z dist/, baza D1)
  migrations/                 # schemat D1 (tworzony też automatycznie): 0001 konta i migawki, 0002 historia wersji
```

**Uwaga:** kody w przykładach są demonstracyjne i przechowywane tylko w przeglądarce. W produkcyjnym backendzie konieczna będzie spójna walidacja operacji i transakcyjne przydzielanie XP.
