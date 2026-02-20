# Podsumowanie Refaktoryzacji: Amunicja, Umiejętności i Dystans

## 1. Mechanika Serii i Amunicji Mieszanej (`dice.js`)
- **Indywidualna Ewaluacja Pocisków**: Logika rzutu iteruje teraz po każdym wystrzelonym pocisku w sekwencji (`bulletSequence`).
- **Narastająca Kara Serii (Recoil)**: Wprowadzono zmienną `j` (indeks pocisku w serii), która obniża skuteczność każdego kolejnego strzału:
  - **Punkty Przewagi**: Każdy kolejny strzał wymaga o 1 PP więcej, aby trafić (`pp - j`).
  - **Skuteczność Śrutu**: Każda kolejna łuska śrutowa ma fizycznie mniejszą liczbę śrucin o `j` (`maxPelletsInShell - j`), co symuluje rozrzut i odrzut broni.
- **Amunicja Mieszana**: System poprawnie obsługuje magazynki załadowane różnymi typami amunicji (np. śrut, kula, śrut). Każdy pocisk korzysta z własnych statystyk i pozycji w serii.

## 2. Dynamiczny Atrybut w Testach Umiejętności (`actor-sheet.js`, `roll-dialog.hbs`)
- **Wybór Atrybutu**: W oknie dialogowym rzutu na umiejętność dodano możliwość tymczasowej zmiany atrybutu, z którego wykonywany jest test.
- **Brak Persystencji**: Zmiana atrybutu w dialogu nie nadpisuje domyślnego przypisania umiejętności w karcie aktora, zapewniając czysty stan przy kolejnych rzutach.
- **Domyślne Atrybuty**: System nadal sugeruje podstawowy atrybut przypisany do danej umiejętności zgodnie z konfiguracją systemu.

## 3. Inteligentne Mierzenie Dystansu (`dice.js`, `actor-sheet.js`)
- **Mierzenie do Punktu**: Rozszerzono funkcję `_waitForTarget` o możliwość kliknięcia w dowolne miejsce na mapie (nie tylko na tokeny).
- **Poprawka V13**: Naprawiono błąd `NaN` przy mierzeniu dystansu do współrzędnych `[x, y]` w wersji Foundry V13, dodając obsługę tablic współrzędnych w `NeuroshimaDice.measureDistance`.
- **Interakcja**: Jeśli gracz ma zaznaczony cel (target), dystans liczony jest automatycznie. Jeśli nie, system prosi o wskazanie celu na mapie.

## 4. Ochrona Amunicji przy Zacięciu (`dice.js`)
- **Walidacja Zacięcia**: Sprawdzenie zacięcia broni (`jamming`) odbywa się przed faktycznym odjęciem amunicji z magazynka lub ekwipunku.
- **Brak Strat**: Jeśli broń się zatnie, amunicja pozostaje w magazynku/ekwipunku, co eliminuje błąd "znikania" pocisków przy nieudanym strzale.
