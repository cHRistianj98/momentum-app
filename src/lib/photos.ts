// 100 autorskich miniaturek WebP umieszczonych lokalnie w /public/assets/thumbs/.
// Bez dodatkowych zapytań do zewnętrznych serwisów zdjęciowych.
const GROUPS = [
  {id:'work',label:'Praca i biznes',short:['Biurko','Home office','Planowanie','Analizy','Biuro','Spotkanie','Współpraca','Notatki','Poranek w pracy','Stanowisko']},
  {id:'technology',label:'Technologia i tworzenie',short:['Kod','Programista','Laptop','Projekt','Architektura','Pomysł','Aparat','Montaż wideo','Komputer','Klawiatura']},
  {id:'finance',label:'Finanse i sprzedaż',short:['Sprzedaż','Wysyłka','Sklep online','Oszczędności','Skarbonka','Portfel','Inwestycje','Płatność','Nieruchomości','Budżet']},
  {id:'fitness',label:'Sport i aktywność',short:['Ciężary','Siłownia','Trening','Buty biegowe','Bieganie','Joga','Rower','Boks','Forma','Pływanie']},
  {id:'home',label:'Dom i obowiązki',short:['Odkurzanie','Sprzątanie','Ścielenie łóżka','Pranie','Pralka','Garderoba','Salon','Zmywanie','Wyniesienie śmieci','Ogród']},
  {id:'food',label:'Gotowanie i jedzenie',short:['Warzywa','Gotowanie','Lunchbox','Sałatka','Owsianka','Kawa','Przygotowanie posiłku','Obiad','Wypieki','Smoothie']},
  {id:'learning',label:'Nauka i rozwój',short:['Książki','Czytanie','Nauka online','Notatki','Biblioteka','Pisanie','Geografia','E-book','Podręczniki','Plan nauki']},
  {id:'travel',label:'Podróże i natura',short:['City break','Wybrzeże','Spacer w lesie','Góry','Jezioro','Plecak','Miasto','Stare miasto','Plaża','Samolot']},
  {id:'leisure',label:'Rozrywka i hobby',short:['Gaming','Film','Muzyka','Gitara','Pianino','Kino','Pies','Ognisko','Szachy','Camping']},
  {id:'wellness',label:'Rytuały i regeneracja',short:['Pobudka','Woda','Dziennik','Prysznic','Pielęgnacja','Medytacja','Wieczorna książka','Spokojny wieczór','Noc','Sen']},
] as const;

export const PHOTO_GROUPS=GROUPS.map(({id,label})=>({id,label}));
export const PHOTO_OPTIONS=GROUPS.flatMap(group=>group.short.map((title,index)=>({
  id:`${group.id}-${String(index+1).padStart(2,'0')}`,
  src:`/assets/thumbs/${group.id}-${String(index+1).padStart(2,'0')}.webp`,
  group:group.id,
  groupLabel:group.label,
  title,
})));
