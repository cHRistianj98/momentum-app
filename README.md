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

3. Otwórz adres pokazany w terminalu (zwykle **http://localhost:5173/**).

Do kompilacji produkcyjnej użyj `npm run build`, a do podglądu `npm run preview`.

## Co działa w tej wersji

- Pulpit z kartami progresu, XP, kalendarzem dnia i panelem zadań.
- Kalendarz **dzień/tydzień**, nawigacja po datach, kliknięcie pustego slotu tworzy zadanie z godziną.
- **Przeciąganie bloków zadań** na inną godzinę i dzień na siatce kalendarza; zmiana czasu trwania w edytorze.
- Zadania: dodawanie, edycja, usuwanie, ukończenie/cofnięcie, kategoria, własna ikona, małe zdjęcie, czas, notatka, XP.
- Inbox dla zadań bez terminu, zadania zaplanowane i ukończone, filtrowanie, wyszukiwanie.
- Szybkie dodawanie popularnych zadań, przeciąganie z panelu po prawej na kalendarz; skróty `N` (nowe zadanie) i `Ctrl/Cmd + K` (wyszukiwarka).
- Rutyny: tworzenie szablonów, edytowanie kroków i dni tygodnia, wykonanie krok po kroku, jeden przycisk zamyka rutynę; jej blok w kalendarzu zostaje automatycznie oznaczony jako ukończony.
- XP, poziomy, seria aktywności, statystyki, wykres ostatnich 7 dni i udział kategorii.
- Konfigurowalne kolory pięciu kategorii, jasny/ciemny motyw, responsywny interfejs.
- Automatyczny zapis w `localStorage`, działające przykładowe dane. W ustawieniach można je zresetować.

## Zakres i ograniczenia MVP

**To jest świadomie frontend-first**: nie ma jeszcze backendu Spring Boot, PostgreSQL, logowania, API Google Calendar/Tasks, synchronizacji wielu urządzeń, powiadomień ani aplikacji mobilnej. Dane są lokalne w konkretnej przeglądarce. Zdjęcia są zapisywane jako data URI (limit 900 KB), co nadaje się do demo, nie do rozwiązania produkcyjnego.

Nie ma jeszcze resize drag krawędzi bloku ani przenoszenia pojedynczego wystąpienia rutyny między dniami. Długość bloku można zmienić w edytorze zadania. Dla rutyn kalendarz pokazuje wystąpienia według harmonogramu szablonu.

## Jak działa model danych

- `Task` — zadanie wraz z dziennym statusem i opcjonalnym blokiem czasowym (dla MVP jedna instancja).
- `Routine` — szablon rutyny z listą kroków, porą i dniami tygodnia.
- `RoutineLog` — dzienne wykonanie rutyny, stan kroków i ukończenia.
- XP jest **wyliczane z ukończonych zadań i rutyn**, a nie dodawane inkrementalnie — dzięki temu ponowne kliknięcie nie powoduje naliczenia XP po raz drugi.
- Kategorie określają charakter aktywności finansowo-czasowej, nie karzą za odpoczynek.

Docelowo należy wydzielić instancje cyklicznych zadań i bloki czasowe do osobnych encji, dodać historię `XpTransaction`, API Spring Boot, PostgreSQL + Flyway, uwierzytelnianie i synchronizację.

## Gdzie zmieniać kod

```text
momentum-app/
  src/
    App.tsx                   # layout, nawigacja, stan i logika aplikacji
    styles.css                # design system, responsywność i dark mode
    types.ts                  # typy domenowe
    components/
      CalendarView.tsx        # kalendarz i natywny drag & drop
      TaskModal.tsx           # edytor zadania
      RoutineModal.tsx        # wykonywanie/edycja rutyn
    lib/
      date.ts                 # czas i daty lokalne
      icons.tsx               # zestaw ikon z lucide-react
      seed.ts                 # dane demonstracyjne, kategorie, presety
      storage.ts              # zapis lokalny
```

**Uwaga:** kody w przykładach są demonstracyjne i przechowywane tylko w przeglądarce. W produkcyjnym backendzie konieczna będzie spójna walidacja operacji i transakcyjne przydzielanie XP.
