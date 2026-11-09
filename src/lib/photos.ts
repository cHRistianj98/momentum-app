// 500 autorskich miniaturek WebP (16 grup) umieszczonych lokalnie w /public/assets/thumbs/.
// Bez dodatkowych zapytań do zewnętrznych serwisów zdjęciowych.
// Numer pliku to pozycja tytułu w grupie (<grupa>-NN.webp). Nowe tytuły dopisuj tylko na końcu listy grupy:
// zadania i rutyny zapisują ścieżkę wybranego zdjęcia, więc przestawienie kolejności podmieniłoby im obrazki.
const GROUPS = [
  {id:'work',label:'Praca i biznes',short:[
    'Biurko', 'Home office', 'Planowanie', 'Analizy', 'Biuro', 'Spotkanie', 'Współpraca', 'Notatki',
    'Poranek w pracy', 'Stanowisko', 'Wideorozmowa', 'Skrzynka e-mail', 'Prezentacja', 'Burza mózgów', 'Lista zadań',
    'Kalendarz', 'Rozmowa telefoniczna', 'Rozmowa kwalifikacyjna', 'Raport', 'Dokumenty', 'Podpisanie umowy',
    'Coworking', 'Praca w kawiarni', 'Szkolenie', 'Konferencja', 'Networking', 'Deadline', 'Głęboka praca',
    'Przerwa na lunch', 'Tablica kanban', 'Drukowanie', 'Aktówka', 'Wizytówki', 'Obsługa klienta',
    'Organizacja biurka', 'Archiwum', 'Delegacja', 'Mentoring', 'Cele', 'Praca wieczorem',
  ]},
  {id:'technology',label:'Technologia i tworzenie',short:[
    'Kod', 'Programista', 'Laptop', 'Projekt', 'Architektura', 'Pomysł', 'Aparat', 'Montaż wideo', 'Komputer',
    'Klawiatura', 'Smartfon', 'Tablet z rysikiem', 'Projektowanie UI', 'Serwerownia', 'Druk 3D', 'Elektronika',
    'Robotyka', 'Smartwatch', 'Podcast', 'Nagrywanie wideo', 'Dron', 'Gogle VR', 'Kopia zapasowa',
    'Składanie komputera', 'Sztuczna inteligencja', 'Cyberbezpieczeństwo', 'Aplikacja mobilna', 'Debugowanie',
    'Internet', 'Inteligentny dom', 'Ładowanie urządzeń', 'Hackathon', 'Naprawa telefonu', 'Nowy sprzęt',
    'Skanowanie',
  ]},
  {id:'finance',label:'Finanse i sprzedaż',short:[
    'Sprzedaż', 'Wysyłka', 'Sklep online', 'Oszczędności', 'Skarbonka', 'Portfel', 'Inwestycje', 'Płatność',
    'Nieruchomości', 'Budżet', 'Faktury', 'Rachunki', 'Bankowość mobilna', 'Bankomat', 'Gotówka', 'Kryptowaluty',
    'Złoto', 'Ubezpieczenie', 'Wydatki', 'Arkusz budżetu', 'Terminal płatniczy', 'Marketing', 'Social media',
    'Zdjęcia produktów', 'Magazyn', 'Wymiana walut', 'Księgowość', 'Darowizna', 'Sprzedaż rzeczy', 'Podatki',
  ]},
  {id:'fitness',label:'Sport i aktywność',short:[
    'Ciężary', 'Siłownia', 'Trening', 'Buty biegowe', 'Bieganie', 'Joga', 'Rower', 'Boks', 'Forma', 'Pływanie',
    'Przysiady', 'Martwy ciąg', 'Kettlebell', 'Skakanka', 'Rozciąganie', 'Pilates', 'Crossfit', 'Pompki', 'Plank',
    'Bieżnia', 'Spinning', 'Orbitrek', 'Wioślarz', 'Wspinaczka', 'Tenis', 'Piłka nożna', 'Koszykówka', 'Siatkówka',
    'Badminton', 'Squash', 'Tenis stołowy', 'Golf', 'Narty', 'Snowboard', 'Łyżwy', 'Rolki', 'Nordic walking', 'Kajak',
    'Surfing', 'Jazda konna', 'Sztuki walki', 'Taniec', 'Zajęcia fitness', 'Trening w domu', 'Podciąganie',
    'Odżywka białkowa', 'Rolowanie', 'Zawody biegowe', 'Spacer', 'Rower górski',
  ]},
  {id:'health',label:'Zdrowie',short:[
    'Wizyta u lekarza', 'Dentysta', 'Badanie krwi', 'Apteka', 'Leki', 'Witaminy', 'Pomiar ciśnienia', 'Fizjoterapia',
    'Okulista', 'Szczepienie', 'Terapia', 'Ważenie', 'Pomiary ciała', 'Przeziębienie', 'USG', 'Prześwietlenie',
    'Oddawanie krwi', 'Dietetyk', 'Alergia', 'Kręgosłup', 'Kardiolog', 'Pomiar cukru', 'Inhalator', 'Soczewki',
    'Apteczka',
  ]},
  {id:'home',label:'Dom i obowiązki',short:[
    'Odkurzanie', 'Sprzątanie', 'Ścielenie łóżka', 'Pranie', 'Pralka', 'Garderoba', 'Salon', 'Zmywanie',
    'Wyniesienie śmieci', 'Ogród', 'Mycie okien', 'Mycie podłogi', 'Prasowanie', 'Sprzątanie łazienki',
    'Sprzątanie kuchni', 'Zmywarka', 'Porządek w lodówce', 'Ścieranie kurzu', 'Segregacja odpadów',
    'Podlewanie kwiatów', 'Przesadzanie roślin', 'Grabienie liści', 'Odśnieżanie', 'Warzywnik', 'Naprawy domowe',
    'Malowanie ścian', 'Składanie mebli', 'Przeprowadzka', 'Suszenie prania', 'Garaż', 'Ubieranie choinki', 'Pisanki',
    'Remont', 'Balkon', 'Robot sprzątający', 'Wietrzenie', 'Organizacja szuflad', 'Czyszczenie piekarnika',
    'Czyszczenie butów', 'Kominek', 'Podlewanie ogrodu', 'Sadzenie roślin', 'Przycinanie krzewów', 'Zbiory z ogrodu',
    'Kompostownik',
  ]},
  {id:'errands',label:'Sprawy i zakupy',short:[
    'Zakupy spożywcze', 'Lista zakupów', 'Poczta', 'Paczkomat', 'Kurier', 'Urząd', 'Fryzjer', 'Pralnia',
    'Zakupy ubrań', 'Galeria handlowa', 'Drogeria', 'Kwiaciarnia', 'Market budowlany', 'Piekarnia', 'Księgarnia',
    'Kasa samoobsługowa', 'Serwis rowerowy', 'Sprawy w mieście', 'Zwrot butelek', 'Krawiec',
  ]},
  {id:'food',label:'Gotowanie i jedzenie',short:[
    'Warzywa', 'Gotowanie', 'Lunchbox', 'Sałatka', 'Owsianka', 'Kawa', 'Przygotowanie posiłku', 'Obiad', 'Wypieki',
    'Smoothie', 'Śniadanie', 'Kanapki', 'Herbata', 'Pizza', 'Makaron', 'Zupa', 'Pierogi', 'Sushi', 'Burger', 'Grill',
    'Kolacja', 'Deser', 'Szarlotka', 'Chleb', 'Owoce', 'Zdrowe przekąski', 'Targ', 'Restauracja', 'Jedzenie na wynos',
    'Świeży sok', 'Lody', 'Naleśniki', 'Gofry', 'Jogurt z granolą', 'Wok', 'Ryba', 'Pieczony kurczak', 'Bowl',
    'Przyprawy', 'Jadłospis', 'Piknik', 'Przetwory', 'Rogaliki', 'Tost z awokado', 'Ramen',
  ]},
  {id:'learning',label:'Nauka i rozwój',short:[
    'Książki', 'Czytanie', 'Nauka online', 'Notatki', 'Biblioteka', 'Pisanie', 'Geografia', 'E-book', 'Podręczniki',
    'Plan nauki', 'Fiszki', 'Języki obce', 'Audiobook', 'Webinar', 'Matematyka', 'Laboratorium', 'Mikroskop',
    'Astronomia', 'Historia', 'Egzamin', 'Wykład', 'Dyplom', 'Praca dyplomowa', 'Korepetycje', 'Mapa myśli',
    'Powtórka materiału', 'Pomodoro', 'Kurs pierwszej pomocy', 'Prasa', 'Kostka logiczna', 'Nauka w grupie', 'Lekcja',
    'Przybory szkolne', 'Wystąpienia publiczne', 'Research', 'Lekcja muzyki', 'Czytanie w parku', 'Kariera',
    'Konwersacje', 'Bullet journal',
  ]},
  {id:'family',label:'Rodzina i znajomi',short:[
    'Spotkanie z przyjaciółmi', 'Randka', 'Rodzinny obiad', 'Urodziny', 'Prezenty', 'Telefon do bliskich',
    'Zabawa z dziećmi', 'Odbiór ze szkoły', 'Odrabianie lekcji', 'Plac zabaw', 'Dziadkowie', 'Wesele',
    'Wizyta u znajomych', 'Spacer z rodziną', 'Wigilia', 'Święconka', 'Spacer z wózkiem', 'Impreza', 'Wolontariat',
    'Kościół', 'Sylwester', 'Kartka z życzeniami', 'Zaręczyny', 'Wspólne gotowanie', 'Album ze zdjęciami',
  ]},
  {id:'travel',label:'Podróże i natura',short:[
    'City break', 'Wybrzeże', 'Spacer w lesie', 'Góry', 'Jezioro', 'Plecak', 'Miasto', 'Stare miasto', 'Plaża',
    'Samolot', 'Pakowanie walizki', 'Lotnisko', 'Paszport', 'Hotel', 'Podróż pociągiem', 'Road trip', 'Kamper',
    'Żeglowanie', 'Wodospad', 'Pustynia', 'Zimowy wyjazd', 'Planowanie podróży', 'Zamek', 'Molo', 'Park jesienią',
    'Wschód słońca', 'Zachód słońca', 'Schronisko', 'Trekking', 'Kolejka górska', 'Balony', 'Nurkowanie', 'Wieś',
    'Jaskinia', 'Zorza polarna',
  ]},
  {id:'transport',label:'Transport i auto',short:[
    'Dojazd autem', 'Tankowanie', 'Myjnia', 'Mechanik', 'Wymiana opon', 'Ładowanie auta', 'Parking', 'Autobus',
    'Tramwaj', 'Metro', 'Rowerem do pracy', 'Hulajnoga', 'Nawigacja', 'Prawo jazdy', 'Motocykl',
  ]},
  {id:'leisure',label:'Rozrywka i hobby',short:[
    'Gaming', 'Film', 'Muzyka', 'Gitara', 'Pianino', 'Kino', 'Pies', 'Ognisko', 'Szachy', 'Camping', 'Planszówki',
    'Puzzle', 'Koncert', 'Teatr', 'Muzeum', 'Galeria sztuki', 'Mecz', 'Serial', 'Karaoke', 'Perkusja', 'Skrzypce',
    'Wędkarstwo', 'Grzybobranie', 'Kręgle', 'Bilard', 'Wesołe miasteczko', 'Zoo', 'Karty', 'Winyle', 'Klocki',
    'Obserwacja ptaków', 'Hamak', 'Stand-up', 'Latawiec', 'Sanki',
  ]},
  {id:'creative',label:'Twórczość i rękodzieło',short:[
    'Rysowanie', 'Malowanie', 'Fotografia', 'Szycie', 'Robienie na drutach', 'Ceramika', 'Kaligrafia', 'Stolarka',
    'Haft', 'Modelarstwo', 'Biżuteria', 'Origami', 'Kolorowanie', 'Pisanie książki', 'Produkcja muzyki',
  ]},
  {id:'pets',label:'Zwierzęta',short:[
    'Spacer z psem', 'Karmienie kota', 'Weterynarz', 'Zabawa z kotem', 'Akwarium', 'Kąpiel psa', 'Szkolenie psa',
    'Królik', 'Papuga', 'Sklep zoologiczny',
  ]},
  {id:'wellness',label:'Rytuały i regeneracja',short:[
    'Pobudka', 'Woda', 'Dziennik', 'Prysznic', 'Pielęgnacja', 'Medytacja', 'Wieczorna książka', 'Spokojny wieczór',
    'Noc', 'Sen', 'Kąpiel', 'Sauna', 'Masaż', 'Spa', 'Oddychanie', 'Mycie zębów', 'Maseczka', 'Golenie',
    'Strój na jutro', 'Cyfrowy detoks', 'Drzemka', 'Aromaterapia', 'Morsowanie', 'Równowaga', 'Boso po trawie',
    'Maska do spania', 'Manicure', 'Pielęgnacja włosów', 'Krem z filtrem', 'Matcha', 'Tablica marzeń', 'Hygge',
    'Misa dźwiękowa', 'Leżak', 'Deszczowy dzień',
  ]},
] as const;

export const PHOTO_GROUPS=GROUPS.map(({id,label})=>({id,label}));
export const PHOTO_OPTIONS=GROUPS.flatMap(group=>group.short.map((title,index)=>({
  id:`${group.id}-${String(index+1).padStart(2,'0')}`,
  src:`/assets/thumbs/${group.id}-${String(index+1).padStart(2,'0')}.webp`,
  group:group.id,
  groupLabel:group.label,
  title,
})));
