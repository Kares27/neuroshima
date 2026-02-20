# Dokumentacja Systemu Neuroshima 1.5 (Foundry VTT v13)

Dokumentacja techniczna struktury, kluczowych funkcji i logiki systemu.

## 1. Architektura Danych (`module/data/`)

### `NeuroshimaActorData`
Model danych dla Aktorów.
- **defineSchema**: Definiuje strukturę atrybutów, umiejętności, kar, udźwigu oraz historii rzutów.
- **prepareDerivedData**: 
  - Oblicza udźwig (`encumbrance`) na podstawie Kondycji i ustawień systemu.
  - Sumuje wagę przedmiotów.
  - Generuje progi sukcesu (`thresholds`) dla każdego atrybutu i poziomu trudności.
  - Sumuje kary z pancerza i ran (`combat.totalArmorPenalty`, `combat.totalWoundPenalty`).
  - Oblicza sumę punktów obrażeń (`combat.totalDamagePoints`).

### `WeaponData`, `ArmorData`, `AmmoData`, `MagazineData`, itd.
Modele danych dla poszczególnych typów przedmiotów.
- **baseSchema**: Wspólne pola dla większości przedmiotów (opis, waga, koszt, ilość).
- **equipableSchema**: Pole `equipped` dla przedmiotów, które można założyć.
- **AmmoData**: Przechowuje informacje o kalibrze oraz opcjonalne nadpisania statystyk broni (obrażenia, przebicie, zacięcie).
  - **Amunicja Śrutowa (Pellet)**: Specjalny tryb amunicji (`isPellet`). Zawiera tabelę `pelletRanges` (zasięgi i obrażenia zależne od dystansu) oraz `pelletCount` (liczba śrucin w jednej łusce).
- **MagazineData**: Działa jako kontener amunicji ze stosową kolejką (LIFO). Przechowuje `maxAmmo` oraz listę `contents`. Podczas ładowania/rozładowywania zachowuje parametry amunicji śrutowej w nadpisaniach (`overrides`).

## 2. Dokumenty (`module/documents/`)

### `NeuroshimaActor`
- **prepareDerivedData**: Wywołuje logikę modelu danych.

### `NeuroshimaItem`
- **_preCreate**: 
  - Automatyczne przypisywanie ikon na podstawie typu.
  - Wyświetlanie dialogu wyboru typu broni (`melee`, `ranged`, `thrown`) przy tworzeniu nowego przedmiotu.
- **prepareDerivedData**: Oblicza `totalWeight` (waga * ilość).

## 3. Logika Rzutów (`module/helpers/dice.js`)

### `NeuroshimaDice`
Główna klasa obsługująca rzuty.
- **rollTest**: Standardowy test (3k20). Obsługuje mechanikę Suwaka, testy otwarte/zamknięte i kary procentowe.
- **rollWeaponTest**: Specjalistyczny rzut dla broni. 
  - **Broń Dystansowa**: Uwzględnia celowanie (liczba kości), ogień ciągły (liczba pocisków) oraz lokacje trafień. Umiejętność odejmowana jest w całości od najlepszej kości. Sukcesy w serii liczone są na podstawie nadwyżki (Punkty Przewagi) nad progiem sukcesu.
  - **Dystans**: Automatycznie mierzony między wybranym tokenem a celem (Target) za pomocą `Ray` i `canvas.grid.measureDistance`. Wynik trafia do rzutu i wpływa na obrażenia śrutu.
  - **Mechanika Śrutu**: 
    - Obrażenia bazowe (K, C, L, D) są dobierane dynamicznie z tabeli zasięgu amunicji na podstawie dystansu.
    - Każdy trafiony pocisk w serii (`shellIndex`) oblicza liczbę draśnięć na podstawie `pp - j` (Punkty Przewagi minus pozycja w serii).
    - Maksymalna liczba śrucin w łusce jest również redukowana o pozycję w serii (`pelletCount - j`), co symuluje rozrzut i odrzut (recoil).
    - Logika ta poprawnie obsługuje **amunicję mieszaną** w magazynku (np. naprzemienne ładowanie śrutu i kul).
  - **Zasady Serii**: Liczba wystrzelonych pocisków to `ROF * mnożnik segmentu` (Krótka: 1x, Długa: 3x, Ciągła: 6x).
  - **Zacięcie vs Amunicja**: Sprawdzenie zacięcia broni (`jamming`) odbywa się przed faktycznym odjęciem amunicji. Jeśli broń się zatnie, amunicja nie jest pobierana z magazynka/ekwipunku.
  - **Walka Wręcz (Melee)**: Zawsze rzuca 3k20. Korzysta z logiki testów standardowych (2/3 sukcesy w zamkniętym, punkty przewagi w otwartym). Umiejętność traktowana jest jako pula punktów do optymalnego rozdzielenia między wszystkie kości. W teście zamkniętym nadmiarowe punkty umiejętności są rozdzielane równomiernie na kości sukcesu, aby obniżyć ich wyniki.
  - Automatycznie ogranicza liczbę pocisków do stanu magazynka. Przed otwarciem dialogu rzutu system sprawdza, czy broń dystansowa posiada załadowany magazynek i amunicję.
- **rollSkill / rollAttribute**: Standardowe testy oparte na atrybutach i umiejętnościach.
  - **Dynamiczny Atrybut**: W oknie dialogowym rzutu na umiejętność gracz może tymczasowo wybrać inny atrybut bazowy dla testu (zmiana nie zapisuje się na stałe).
- **reEvaluateWeaponRoll**: Pozwala na ponowne przeliczenie rzutu (np. przy zmianie typu testu na czacie) bez ponownego rzucania kośćmi.
- **getSkillShift**: Dynamicznie oblicza przesunięcie trudności (Suwak) jako `floor(Umiejętność / 4)`.
- **_getShiftedDifficulty**: Helper przesuwający poziom trudności o zadaną liczbę stopni (mechanika Suwaka).
- **getDifficultyFromPercent**: Zwraca obiekt trudności z konfiguracji na podstawie sumy kar procentowych.
- **renderRollCard / renderWeaponRollCard**: Renderuje wyniki rzutu na czacie przy użyciu szablonów Handlebars. Wyświetla "Punkty Przewagi" jako uniwersalną miarę sukcesu (1 w teście zamkniętym, nadwyżka w otwartym).

## 4. Arkusz Aktora (`module/sheets/actor-sheet.js`)

### `NeuroshimaActorSheet` (ApplicationV2)
- **_prepareContext**: Przygotowuje dane dla szablonów, w tym organizację przedmiotów w zakładkach i dane bojowe.
- **_prepareSubmitData**: Synchronizuje dane arkusza, umożliwiając edycję pól przedmiotów (np. ran) bezpośrednio z tabel na arkuszu aktora.
- **_prepareCombatWeapons**: Formatuje dane broni i szuka pasującej amunicji/magazynków.
- **_prepareAnatomicalArmor**: Grupuje założony pancerz według lokacji anatomicznych i sumuje AP.
- **Akcje (`actions`)**: 
  - `modifyDurability` / `modifyAP`: Szybka edycja uszkodzeń pancerza (LPM/PPM).
  - `rollWeapon` / `rollSkill` / `rollAttribute`: Inicjacja rzutów.
  - `adjustQuantity`: Zmiana ilości przedmiotów (LPM/PPM + modyfikatory Shift/Ctrl).
  - `unloadMagazine`: Opróżnianie zawartości magazynka z powrotem do ekwipunku.
- **Interakcje**: 
  - **Drag & Drop**: Przeciągnięcie przedmiotu `ammo` na `magazine` inicjuje proces ładowania.

## 5. Dialogi i Aplikacje (`module/apps/`)

### `AmmunitionLoadingDialog`
Dialog wywoływany przy ładowaniu amunicji do magazynka.
- Waliduje kaliber amunicji względem magazynka.
- Pozwala wybrać ilość ładowanych kul z uwzględnieniem dostępnego `quantity` i wolnego miejsca w magazynku.

### `NeuroshimaWeaponRollDialog` (ApplicationV2)
Zaawansowane okno rzutu bronią.
- **Dynamiczne UI**: Dla broni dystansowej wyświetla suwaki celowania i serii. Dla walki wręcz ukrywa je, wymuszając 3 kości rzutu.
- **Typ testu**: Pozwala na wybór między testem otwartym a zamkniętym dla każdego typu broni.
- **_updatePreview**: W czasie rzeczywistym aktualizuje podgląd trudności, kar i liczby pocisków podczas zmiany opcji w oknie.
- **Persistence**: Zapamiętuje ostatnie wybory gracza (trudność, kary, tryb testu) w modelu danych aktora.

## 6. Konfiguracja (`module/config.js`)

### `NEUROSHIMA`
Centralny obiekt konfiguracyjny.
- `difficulties`: Definicje progów i modyfikatorów trudności.
- `skillConfiguration`: Mapowanie umiejętności do atrybutów.
- `woundConfiguration`: Szczegóły typów ran (D, L, C, K) i ich wpływ na mechanikę.
- `hitLocationTable`: Tabela losowania lokacji trafień (1k20).
- `hitLocationModifiers`: Kary za celowanie w konkretne lokacje.

## 7. Tryb Debugowania
System korzysta z ustawienia `debugMode`. Logi w konsoli powinny być warunkowane sprawdzeniem tego booleana:
```javascript
if (game.settings.get("neuroshima", "debugMode")) {
    console.log("Neuroshima 1.5 | ...", data);
}
```
