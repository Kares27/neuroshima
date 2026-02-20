# Podsumowanie Zmian - Neuroshima 1.5

Poniżej znajduje się chronologiczna lista zmian wprowadzonych w systemie podczas bieżącej sesji:

## 1. Naprawa Błędów i Stabilność
- **TypeError w dice.js**: Naprawiono błąd `Cannot read properties of undefined (reading 'id')` występujący podczas ponownej ewaluacji rzutu bronią (zmiana testu Otwarty/Zamknięty).
- **Synchronizacja Ran**: Naprawiono błąd uniemożliwiający edycję lokalizacji, kar i typu obrażeń bezpośrednio z arkusza postaci. Zmiany są teraz poprawnie przesyłane do przedmiotów typu `wound`.

## 2. Mechanika Rzutów i Dice Logic (`dice.js`)
- **Persistence (Zapamiętywanie)**: Zaimplementowano zapamiętywanie ustawień dialogu rzutu bronią (Typ testu, trudność, modyfikatory, kary) w danych Aktora.
- **Zasada Suwaka (Shift)**: Zintegrowano ustawienie `allowCombatShift`. Rzuty bronią uwzględniają teraz przesunięcia trudności wynikające z poziomu umiejętności oraz wyników 1/20 na kościach.
- **Trafione Pociski (Hit Bullets)**: Dodano logikę obliczania liczby trafionych pocisków dla serii (krótka, długa, ciągła). Wynik to `Punkty Przewagi + 1`, ograniczony przez liczbę wystrzelonych kul.
- **Re-ewaluacja Rzutów**: Umożliwiono dynamiczną zmianę typu testu (Otwarty/Zamknięty) dla rzutów bronią za pomocą menu kontekstowego na czacie.

## 3. Konfiguracja Systemu (`config.js`)
- **Modyfikatory Lokacji**: Rozdzielono kary za trafienie w konkretne lokacje na dwie kategorie: `melee` (walka wręcz) oraz `ranged` (walka dystansowa), zgodnie z mechaniką gry.
- **Mapowanie Obrażeń**: Zoptymalizowano pobieranie nazw typów obrażeń z `NEUROSHIMA.woundConfiguration`.

## 4. Interfejs Użytkownika (UI/UX)
- **Arkusz Postaci**:
    - Przebudowano sekcję ran w zakładce Walka: statystyki HP i kar są teraz wyrównane nad odpowiednimi kolumnami.
    - Zaktualizowano `stat-box` w nagłówku, aby wyświetlał sumę kar (pancerz + rany) z dynamicznym tooltipem.
- **Karta Rzutu Bronią (`weapon-roll-card.hbs`)**:
    - Przebudowano układ na bardziej czytelny (siatka kości, kwadratowe wyniki).
    - Dodano wiersz **Obrażenia** z tooltipem wyświetlającym pełną nazwę typu rany.
    - Skrócono etykiety (np. "Lokacja", "Pociski").
    - Zmieniono układ sekcji wyników na pionowy (etykieta po lewej, wartość po prawej).
    - Usunięto zbędne napisy "Krytyczny Sukces/Porażka" na prośbę użytkownika.
    - Dodano kropkowane linie oddzielające sekcje karty.
- **Okno Rzutu (`NeuroshimaWeaponRollDialog`)**:
    - Dodano dynamiczny podgląd ostatecznej trudności uwzględniający zasadę Suwaka (np. "Przeciętny → Łatwy").
    - Poprawiono wyświetlanie modyfikatorów lokacji w zależności od typu broni.

## 6. Poprawa Walki Wręcz i Ujednolicenie Rzutów (Sesja Akt.)
- **Nowa Logika Melee**:
    - Walka wręcz działa teraz jak test standardowy (3k20).
    - Punkty umiejętności są traktowane jako pula do optymalnego rozdzielenia między wszystkie kości (zgodnie z `_evaluateClosedTest` i `_evaluateOpenTest`).
    - Test zamknięty wymaga 2 z 3 sukcesów.
    - Test otwarty ignoruje najgorszą kość i liczy przewagi z gorszej z pozostałych dwóch.
- **UI Dialogu Rzutu**:
    - Odblokowano wybór testu otwartego dla broni białej.
    - Ukryto suwaki celowania i serii dla melee, wymuszając rzut 3 kośćmi.
    - Poprawiono zapamiętywanie (`persistence`) typu testu dla broni.
- **Karta Rzutu Bronią**:
    - Przywrócono oznaczenia D1, D2, D3 dla wszystkich rodzajów rzutów (zamiast "Segmentów").
    - Ujednolicono wyświetlanie wyników: teraz każda broń (w tym biała) wyświetla "Punkty Przewagi" zamiast liczby sukcesów.
    - Wynik dla testu zamkniętego melee to 1 punkt przewagi (przy trafieniu) lub 0 (przy pudle).
- **Tłumaczenia**:
    - Dodano `SuccessCount` ("Liczba sukcesów") do plików językowych.
- **Dokumentacja**:
    - Zaktualizowano `documentation.md` oraz `implementations.md` o szczegóły techniczne dystrybucji umiejętności w melee.
