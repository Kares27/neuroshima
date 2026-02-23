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

### Pancerz (ArmorData)
- **Wartości**: Akceptuje liczby całkowite i połówki (krok 0.5)
  - Można mieć pancerz o wartości 0, 0.5, 1, 1.5, 2, 2.5, itd.
  - Każda lokacja anatomiczna ma osobną wartość pancerza
  - Wszystkie ekwipowane pancerze na danej lokacji się sumują
- **Uszkodzenia Pancerza**: Pancerz posiada dwa pola danych:
  - **ratings**: Maksymalne punkty pancerza dla każdej lokacji
  - **damage**: Obrażenia pancerza dla każdej lokacji (zwiększane gdy pancerz jest trafiony)
- **Efektywny Pancerz (Effective Armor)**: Automatycznie obliczany jako `ratings - damage`, nigdy poniżej 0
  - Używany do redukcji obrażeń i musi być uwzględniany przy każdym trafieniu

### Rany - Punkty Obrażeń
Każdy typ rany ma dwa rodzaje punktów w konfiguracji:
- **damageHealth**: Punkty zdrowia (HP) - 1, 3, 9, 27 - do obliczania obrażeń dla HP aktora
- **damagePoints**: Punkty redukcji pancerza - 1, 2, 3, 4 - do obliczania zmniejszenia obrażeń przez pancerz

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

## 7. System Walki i Obrażeń (`module/helpers/combat-helper.js`)

### `CombatHelper`
Klasa wspomagająca mechaniki walki i zarządzanie obrażeniami.

**Główne funkcje:**

- **reduceArmorDamage**: Zmniejsza obrażenia na podstawie efektywnego pancerza aktora i przebicia broni.
  - Oblicza efektywny pancerz dla każdego ekwipowanego pancerza: `effectiveArmor = ratings - damage` (min 0)
  - Sumuje wszystkie efektywne punkty pancerza na danej lokacji
  - Formuła redukcji: `Realna Redukcja = Suma Efektywnego Pancerza - Punkty Przebicia`
  - Specjalny przypadek: Jeśli redukcja < 1 ale > 0 (np. 0.5), liczy się jako 1 pkt redukcji
  - Mapuje obrażenia na typ rany (K/C/L/D) na podstawie punktów redukcji lub całkowite zneutralizowanie
  - Zawsze wyświetla raport w czacie z liczbą zredukowanych pocisków/ran

- **applyDamage**: Nakładanie obrażeń na wybranych aktorów na podstawie rzutu bronią.
  - Automatycznie wykonuje testy Odporności na Ból dla każdej rany.
  - Obsługuje zarówno bronie strzeleckie (Draśnięcia z pocisków, Rany zwykłe) jak i walkę wręcz.
  - Renderuje raport w czacie pokazujący wyniki testów odporności.

- **processPainResistance**: Seria testów odporności na ból (testy ZAMKNIĘTE).
  - Wykonuje test zamknięty (3k20) dla każdej rany oddzielnie.
  - Ignoruje kary z pancerza i istniejących ran (test czysty).
  - Wymaga minimum 2 sukcesów dla zdanego testu.
  - Przydzielanie kar na podstawie konfiguracji (`woundConfiguration`).
  - Zwraca szczegółowe dane o każdym teście (wyniki, trudność, kara).

- **renderPainResistanceReport**: Renderowanie raportu odporności na ból do czatu.
  - Wyświetla podsumowanie (zdane/niezdane/zredukowane).
  - Collapsible lista ran z wskaźnikami zdania/porażki/zredukcji.
  - Mini tooltips dla każdej rany pokazujące kości, trudność i wynik.
  - **Zredukowane Obrażenia**: Wyświetlane z ikoną tarczy (szara), pełną nazwą typu obrażenia i myślnikiem "-" zamiast procentu kary.
  - **Tooltip Redukcji**: Pokazuje szczegóły kalkulacji:
    - Pełna nazwa lokacji trafienia
    - Poszczególne pancerze aktora z ich efektywną wartością (ratings - damage)
    - Wartość przebicia broni/amunicji
    - Całkowita kalkulacja AP (suma pancerzy - przebicie = redukcja)
    - Podsumowanie obrażeń (typ [punkty] - redukcja = zredukowane)

- **refundAmmunition**: Zwrot amunicji użytej w rzucie.
  - Obsługuje zarówno magazynki (magazynek LIFO) jak i bezpośrednią amunicję.
  - Inteligentne łączenie (merging) amunicji tego samego typu.
  - Porównuje wszystkie parametry (obrażenia, przebicie, zacięcie, śrutowe parametry).

- **reverseDamage**: Cofnięcie nałożonych obrażeń (usuwanie ran z aktora).
  - Pracuje zarówno z Actor Library jak i Token Actors (poprzez UUID resolution).
  - Obsługuje sytuacje, gdy GM usunął manualnie część ran.
  - Dodaje wizualny wskaźnik do wiadomości.

- **canShowPainResistanceDetails / canPerformCombatAction**: Funkcje sprawdzające uprawnienia użytkownika.
  - Oparte na ustawieniach roli w Combat Settings.

- **getShiftedLocation / getShiftedLocationByRoll**: Pomocnicze funkcje do zmiany lokacji trafienia.
  - Przydatne do przyszłych reguł rozprzestrzeniania się pocisków śrutowych.

### Pain Resistance Test - Detale Mechaniki
Zgodnie z zasadami Neuroshima 1.5:
- Każda rana wymaga osobnego testu odporności.
- Test jest testem **ZAMKNIĘTYM** (nie bierze suwaków).
- Bazowa trudność zależy od typu rany (D, L, C, K).
- Test się udaje, jeśli liczba sukcesów >= 2.
- Kara przydzielana na podstawie wyniku:
  - `penalties[0]` - gdy test ZDANY
  - `penalties[1]` - gdy test NIEZDANY

## 8. System Uprawnień i Widoczności (`module/apps/combat-config.js`)

### `CombatConfig` (Application V2)
Dedykowana aplikacja do zarządzania ustawieniami walki.

**Konfigurowane ustawienia:**

- **usePelletCountLimit**: Czy stosować limit liczby śrucin w serii.
- **damageApplicationMinRole**: Minimalna rola wymagana do widoczności sekcji nakładania obrażeń.
- **painResistanceMinRole**: Minimalna rola wymagana do widoczności szczegółów testów odporności na ból.
- **combatActionsMinRole**: Minimalna rola wymagana do akcji specjalnych (Refundacja, Cofnięcie).

Role: 0 = Brak, 1 = Gracz, 2 = Zaufany Gracz, 3 = Asystent GM, 4 = Gamemaster.

### renderChatMessage Hook - Dynamiczna Widoczność
Hook `renderChatMessage` w `system.js` implementuje **client-side dynamic visibility**:
- Sprawdza uprawnienia użytkownika dla każdego elementu.
- Usuwa atrybuty `data-tooltip` jeśli użytkownik nie ma dostępu.
- Ukrywa sekcje obrażeń i szczegóły testów odporności na ból.
- Każdy klient niezależnie egzekwuje reguły widoczności.

## 8.1. System Leczenia (Healing System)

Pełny system leczenia ran w systemie Neuroshima 1.5. Podzielony na 4 fazy:

### Faza 1-3: Interfejs i Selekcja
- Pacjent prosi medyka o leczenie (dualne tryby: Simple/Extended)
- Medyk wybiera rany do leczenia w panelu HealingApp
- Klik "Heal Selected Wounds" otwiera dialog rzutu

### Faza 4: Auto-Aplikowanie Efektów
**Plik**: `module/helpers/dice.js`

Metoda `applyHealingEffects()` obsługuje:
1. Obliczenie wyniku testu (2+ sukcesy = sukces)
2. Ustalenie procent redukcji kar:
   - **Pierwsza Pomoc**: ±5% (sukces/porażka)
   - **Leczenie Ran**: ±15% (sukces) / -5% (porażka)
3. Aktualizację penalty każdej rany
4. Zwrot danych do renderowania na czacie

Szczegółowa dokumentacja: [HEALING_SYSTEM_PHASE4.md](./HEALING_SYSTEM_PHASE4.md)

## 9. Tryb Debugowania
System korzysta z ustawienia `debugMode`. Logi w konsoli powinny być warunkowane sprawdzeniem tego booleana:
```javascript
if (game.settings.get("neuroshima", "debugMode")) {
    console.log("Neuroshima 1.5 | ...", data);
}
```

Dla strukturyzowanych logów w grupach:
```javascript
game.neuroshima.group("Opis operacji");
game.neuroshima.log("Dane", { /* data */ });
game.neuroshima.groupEnd();
```
