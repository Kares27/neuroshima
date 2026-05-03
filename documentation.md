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
  - **attributeTotals**: Centralizuje obliczenia atrybutów: `Base + Modifier + Effects` (używane we wszystkich testach).
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
- **_preCreate**: Automatycznie ustawia `prototypeToken.actorLink: true` dla aktorów typu `character`.

### `NeuroshimaItem`
- **_preCreate**: 
  - Automatyczne przypisywanie ikon na podstawie typu.
  - Wyświetlanie dialogu wyboru typu broni (`melee`, `ranged`, `thrown`) przy tworzeniu nowego przedmiotu.
- **prepareDerivedData**: Oblicza `totalWeight` (waga * ilość).

### `NeuroshimaCombat` / `NeuroshimaCombatant`
- **rollInitiative**: Nadpisanie standardowej metody Foundry VTT. Otwiera `NeuroshimaInitiativeRollDialog` i zapisuje wynik jako Punkty Przewagi (Advantage Points) w Combat Trackerze.

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
  - **Suwak**: Przesuwa poziom trudności na podstawie umiejętności (co 4 pkt = -1 stopień) oraz kości (naturalna 1 = -1 stopień, naturalna 20 = +1 stopień). Umiejętność 0 generuje automatyczną karę +1 stopień trudności.
- **rollInitiative**: Ujednolicony rzut na inicjatywę (3k20 vs Zręczność). Obsługuje "milczące rzuty" (bez wiadomości na czacie) zwracając tooltip HTML dla starć wręcz.
- **rollWeaponTest**: Specjalistyczny rzut dla broni. 
  - **Przerzuty (Reroll)**: Wszystkie rzuty (broń i skille) wspierają mechanikę przerzutu z zachowaniem oryginalnych parametrów. Wiadomości oznaczone są tagiem `isReroll`.  - **Broń Dystansowa**: Uwzględnia celowanie (liczba kości), ogień ciągły (liczba pocisków) oraz lokacje trafień. Umiejętność odejmowana jest w całości od najlepszej kości. Sukcesy w serii liczone są na podstawie nadwyżki (Punkty Przewagi) nad progiem sukcesu.
  - **Dystans**: Automatycznie mierzony między wybranym tokenem a celem (Target) za pomocą `Ray` i `canvas.grid.measureDistance`. Wynik trafia do rzutu i wpływa na obrażenia śrutu.
  - **Mechanika Śrutu**: 
    - Obrażenia bazowe (K, C, L, D) są dobierane dynamicznie z tabeli zasięgu amunicji na podstawie dystansu.
    - Każdy trafiony pocisk w serii (`shellIndex`) oblicza liczbę draśnięć na podstawie `pp - j` (Punkty Przewagi minus pozycja w serii).
    - Maksymalna liczba śrucin w łusce jest również redukowana o pozycję w serii (`pelletCount - j`), co symuluje rozrzut i odrzut (recoil).
    - Logika ta poprawnie obsługuje **amunicję mieszaną** w magazynku (np. naprzemienne ładowanie śrutu i kul).
  - **Zasady Serii**: Liczba wystrzelonych pocisków to `ROF * mnożnik segmentu` (Krótka: 1x, Długa: 3x, Ciągła: 6x).
  - **Zasady Walki Wręcz (Melee Opposed)**: 
    - Atak wręcz na stargetowany cel tworzy handler testu przeciwstawnego.
    - System oczekuje na rzut obronny obrońcy (broń, bijatyka lub unik).
    - Wynik jest automatycznie rozstrzygany (`resolveOpposed`) i wyświetlany jako nowa karta na czacie.
    - Zwycięzca zadaje obrażenia zależne od różnicy Punktów Przewagi (`spDifference`).
    - **Tryb Sukcesów**: Porównanie liczby sukcesów w testach zamkniętych.
    - **Tryb Kości (Segmenty)**: Porównanie korespondencyjne kości (3 segmenty). Atakujący i obrońca mogą wybierać dowolne kości (także porażki), aby je "spalić" lub wykorzystać do obrony.
    - **Cios Złożony**: Wymaga przynajmniej jednego sukcesu w zaznaczonej grupie kości. Siła ciosu równa jest liczbie sukcesów.
    - **Obrona**: Skuteczna, jeśli liczba wybranych sukcesów >= siła ataku. Nieskuteczna obrona nadal zużywa wybrane kości (zasada "daremnej obrony").
    - **Inicjatywa Zwarcia**: Automatyczny test otwarty (3k20 vs Zręczność) wykonywany w tle podczas dołączania do walki. Wyniki (Punkty Przewagi) są wyświetlane jako plakietki pod nazwami postaci z pełnym tooltipem rzutu. System automatycznie wykonuje przerzuty przy remisach. Tooltipy są generowane przez `_buildOpenTestTooltip` i zawierają szczegółowy rozbiór atrybutów, umiejętności oraz bonusów.
    - **Aplikacja Bonusów**: Ustawienie `meleeBonusMode` definiuje czy bonus broni trafia do Atrybutu, Umiejętności, czy obu.
    - **Socketlib Integration**: Wszystkie operacje na danych (aktualizacja flag wiadomości, modyfikacja statystyk) są wykonywane przez GM za pomocą `socketlib`, co zapewnia bezpieczeństwo i brak błędów uprawnień.
  - **Walka Wręcz (Melee - Rzut)**: Zawsze rzuca 3k20. Korzysta z logiki testów standardowych (2/3 sukcesy w zamkniętym, punkty przewagi w otwartym). Umiejętność traktowana jest jako pula punktów do optymalnego rozdzielenia między wszystkie kości.
  - Automatycznie ogranicza liczbę pocisków do stanu magazynka. Przed otwarciem dialogu rzutu system sprawdza, czy broń dystansowa posiada załadowany magazynek i amunicję.
- **rollSkill / rollAttribute**: Standardowe testy oparte na atrybutach i umiejętnościach.
  - **Dynamiczny Atrybut**: W oknie dialogowym rzutu na umiejętność gracz może tymczasowo wybrać inny atrybut bazowy dla testu (zmiana nie zapisuje się na stałe).
- **reEvaluateWeaponRoll**: Pozwala na ponowne przeliczenie rzutu (np. przy zmianie typu testu na czacie) bez ponownego rzucania kośćmi.
- **getSkillShift**: Dynamicznie oblicza przesunięcie trudności (Suwak) jako `floor(Umiejętność / 4)`. Dla umiejętności <= 0 zwraca -1 (kara +1 stopień).
- **_getShiftedDifficulty**: Helper przesuwający poziom trudności o zadaną liczbę stopni (mechanika Suwaka). Bonusy skracają dystans do PT (odejmują od indeksu), kary zwiększają.
- **getDifficultyFromPercent**: Zwraca obiekt trudności z konfiguracji na podstawie sumy kar procentowych.
- **renderRollCard / renderWeaponRollCard**: Renderuje wyniki rzutu na czacie przy użyciu szablonów Handlebars. Wyświetla "Punkty Przewagi" jako uniwersalną miarę sukcesu. Dodano bogate tooltipy HTML (`_buildOpenTestTooltip`, `_buildClosedTestTooltip`) na etykietach typu testu, pokazujące szczegółowy rozbiór modyfikatorów, bonusów i kości.

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

### `NeuroshimaInitiativeRollDialog` (ApplicationV2)
Zintegrowany dialog rzutu na inicjatywę. 
- Obsługuje rzuty z atrybutu Zręczność z opcjonalnym uwzględnieniem umiejętności broni.
- Wykorzystywany przez Combat Tracker oraz system walki wręcz.

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
- **doubleSkillAction**: Zasada dodatkowa pozwalająca na ręczne rozdzielanie punktów umiejętności w zwarciu (obniżanie własnych kości LUB podwyższanie kości przeciwnika).

Role: 0 = Brak, 1 = Gracz, 2 = Zaufany Gracz, 3 = Asystent GM, 4 = Gamemaster.

### renderChatMessage Hook - Dynamiczna Widoczność
Hook `renderChatMessage` w `system.js` implementuje **client-side dynamic visibility**:
- Sprawdza uprawnienia użytkownika dla każdego elementu.
- Usuwa atrybuty `data-tooltip` jeśli użytkownik nie ma dostępu.
- Ukrywa sekcje obrażeń i szczegóły testów odporności na ból.
- Każdy klient niezależnie egzekwuje reguły widoczności.

### 8.1. System Rzutów i Widoczność (Roll Modes)
System w pełni integruje się z systemowymi trybami rzutu Foundry VTT (`CONST.DICE_ROLL_MODES`):
- **Public Roll**: Wiadomość widoczna dla wszystkich.
- **Private GM Roll**: Wiadomość widoczna tylko dla rzucającego i GM.
- **Blind GM Roll**: Wiadomość widoczna tylko dla GM (rzucający nie widzi wyniku).
- **Self Roll**: Wiadomość widoczna tylko dla rzucającego.

**Wizualizacja**:
- Każdy tryb rzutu posiada dedykowany kolor obramowania wiadomości (np. czerwony dla rzutów prywatnych GM, różowy dla własnych).
- Nad nagłówkiem karty wyświetlana jest etykieta z nazwą trybu rzutu w odpowiednim kolorze.

Logika rzutu (`NeuroshimaDice`) oraz renderowania wiadomości (`NeuroshimaChatMessage`) wykorzystuje `ChatMessage.applyRollMode` do poprawnego ustawienia uprawnień `whisper` i `blind`. Wybrany tryb jest zapamiętywany w `lastRoll` aktora.

### 8.2. System Leczenia (Healing System)

Pełny system leczenia ran w systemie Neuroshima 1.5. Podzielony na 4 fazy:

### Faza 1-3: Interfejs i Selekcja
- Pacjent prosi medyka o leczenie (wybór medyka ograniczony do Postaci Graczy przypisanych do użytkowników)
- System wykorzystuje referencje (`patientRef`, `medicRef`) oparte na UUID, wspierające zarówno tokeny (także unlinked) jak i aktorów z biblioteki.
- Medyk wybiera rany do leczenia w panelu HealingApp. Uprawnienia weryfikowane są na podstawie ownershipu do aktora medyka.
- Klik "Heal Selected Wounds" otwiera dialog rzutu.

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

## 8.2. Panel Rozszerzonego Leczenia (Extended Wounds Panel)

**Pliki**: `templates/actor/parts/actor-combat.hbs`, `templates/actor/parts/wounds-list-partial.hbs`, `templates/actor/parts/wounds-paper-doll-partial.hbs`, `css/actor.css`, `module/sheets/actor-sheet.js`

### Strukturura UI
Panel rozszerzony ma dwie główne części:
1. **Paper Doll (Diagram Anatomiczny)**: Interaktywny schemat ludzkiego ciała z hotspotami dla każdej lokacji anatomicznej
2. **Wounds List Container**: Lista ran organizowana według wybranej lokacji

### Logika Selekcji Lokacji
- Klik na hotspot w diagramie zapisuje lokację w actor flag (`neuroshima.selectedWoundLocation`)
- Lokacja domyślna: `torso`
- Po wyrenderowaniu szablonu `combatWoundsList` wyświetla się aktualna selekcja
- Nagłówki lokacji mają klasę `active` (controlowana przez Handlebars: `{{#if (eq location.key ../combat.selectedWoundLocation)}}active{{/if}}`)

### Wygląd Ran
- **Kolory tła**: 
  - Brak leczenia: `rgba(245, 40, 40, 0.15)` (czerwony/salmon)
  - W trakcie leczenia (`isHealing: true`): `rgba(76, 175, 80, 0.3)` (zielony)
- Kolory są aplikowane za pośrednictwem klasy `.is-healing` na elemencie `.wound-item`

### Konfiguracja Tempa Leczenia
- Input pole `healing-rate-input` pozwala ustawić procent leczenia na dzień (domyślnie 5%)
- Przechowywane w `system.healingRate` (zakres 1-100)
- Dni do wyleczenia są obliczane dynamicznie: `Math.ceil(totalWoundPenalty / healingRate)`
- Pozwala na uwzględnienie modyfikatorów GM (ulgi medyczne, specjalne terapie itp.)

### Statystyki w Nagłówku (Extended Mode)
- **HP-sum**: Całkowite obrażenia / Max HP (kolor czerwony #ff4444)
- **penalty-sum**: Całkowita kara od ran (kolor pomarańczowy #ff9800)
- **healing-days-sum**: Dni do pełnego wyleczenia (kolor zielony #4caf50)
- Statystyki wyświetlane w centrum nagłówka sekcji ran, w specjalnie stylizowanym pudełku z `rgba(0, 0, 0, 0.3)` tłem

### Toggle Layoutu Walki
- Przycisk w górnym prawym rogu combat tab (ikona strzałek) zmienia kolejność sekcji
- Przycisk zmienia wartość flagi: `actor.setFlag("neuroshima", "woundsFirst", !current)`
- CSS klasa `.wounds-first` na `.combat-grid` zmienia `flex-direction` na `column-reverse`
- `await this.render()` wymusza pełne przerenderowanie kontekstu i zastosowanie zmiany

### Hotspot Initialization
- Po wyrenderowaniu szablonu poszukiwane są elementy `.body-location-hotspot`
- Jeśli hotspoty nie są od razu dostępne (asynchronizm ApplicationV2), system powtarza próbę po 100ms
- Każdy hotspot ma listener zabezpieczony atrybutem `data-listener-active` aby uniknąć duplikatów
- Klik na hotspot renderuje `combatWoundsList` PRZED aktualizacją stanu wizualnego, aby zapobiec flimmerowaniu

### Zachowanie Pozycji Scrolla (Scroll Preservation)
- System automatycznie zapamiętuje pozycję paska przewijania w zakładce Walka (`combat`) przed każdą aktualizacją aktora (edycja rany, zmiana statusu leczenia, usunięcie/dodanie rany).
- Po przerenderowaniu arkusza pozycja scrolla jest przywracana, co eliminuje uciążliwe resetowanie widoku do góry strony przy każdej interakcji.

## 8.3. Panel Medyka (HealingApp)
Dedykowana aplikacja dla medyka obsługująca prośby o leczenie.

### Usprawnienia UI i UX (v1.5.1)
- **Układ Ran**: Elementy rany są ułożone liniowo i wyrównane do lewej w kolejności: `[Checkbox] [Typ Obrażeń] [Kara %] [Ikony Statusu] [Nazwa]`.
- **Interaktywny Diagram (Paper Doll)**:
  - Powiększony obszar diagramu dla lepszej precyzji.
  - Naprawiona blokada kliknięć przez etykiety (użycie `pointer-events: none`).
  - Dynamiczne podświetlanie wybranej lokacji.
- **Nagłówek Pacjenta**: Wyświetla awatar, punkty życia (HP), sumaryczną karę oraz liczbę ran w czytelnej formie.
- **Stabilność Okna**: 
  - Wyłączone automatyczne centrowanie przy zmianie lokacji oraz zastosowanie częściowego renderowania (`parts: ["main"]`), co całkowicie eliminuje "skakanie" okna.
  - Naprawiony błąd `TypeError` przy renderowaniu (brak `TooltipManager`).
  - Poprawiona obsługa zmiany rozmiaru (resizable) – ustawienie stałej wysokości początkowej umożliwia swobodne skalowanie pionowe.
- **Interakcja**: 
  - Całe wiersze ran (`wound-item`) są klikalne, co przełącza stan powiązanego checkboxa.
  - Dodano checkbox "Zaznacz wszystkie" z obsługą stanu nieokreślonego (indeterminate), pozwalający na błyskawiczne zarządzanie selekcją.
- **Odporność na Błędy (v1.5.2)**:
  - **Resilient Actor Retrieval**: System wyszukiwania pacjenta wspiera teraz `UUID`, `ID` aktora oraz przeszukiwanie scen w poszukiwaniu niepowiązanych tokenów (unlinked tokens). Rozwiązuje to błędy "Nie znaleziono aktora" w sytuacjach, gdy użytkownik nie ma przypisanej postaci głównej.
  - **Blokada Podwójnej Aplikacji**: Wprowadzono flagę `healingApplied` na wiadomościach czatu z raportem leczenia. Uniemożliwia to wielokrotne nakładanie leczenia z tej samej karty, nawet po odświeżeniu strony. Przycisk aplikacji i przerzutu są automatycznie blokowane po użyciu.
- **Podsumowanie Obrażeń (Summary Bar)**: 
  - Dodano pasek podsumowania między tytułem sekcji a listą ran.
  - Wyświetla skrótową sumę typów obrażeń (np. `[Suma]xK [Suma]xC [Suma]xL [Suma]xD`).
  - Dla konkretnych części ciała wyświetla również sumę kar na tej lokacji.
- **Konsolidacja Stylu**: Style aplikacji zostały przeniesione do `actor.css`, zapewniając spójność z resztą systemu przy zachowaniu unikalnego wyglądu panelu medycznego.

## 9. Tryb Debugowania (Changed from 9 to account for new 8.2 section)
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

## 10. Testy Przeciwstawne i Duple (Melee Duel v2)

Zaimplementowano zaawansowany cykl życia starcia w zwarciu:
- **Handler (Oczekiwanie)**: Po ataku melee system tworzy wiadomość `meleeOpposedHandler`.
- **Cykl Życia**: `Initiative -> Modification -> Segments -> Resolved`.
- **Ujednolicona Inicjatywa**: Uczestnicy wykonują rzuty inicjatywy za pomocą `NeuroshimaInitiativeRollDialog`. Wyniki są wyświetlane jako tooltipy nad plakietką Punktów Przewagi, co eliminuje nadmiar wiadomości na czacie.
- **Ukrywanie Kości**: Wyniki rzutów są wizualnie ukryte dopóki oba rzuty na inicjatywę nie zostaną wykonane. Przyciski inicjatywy pojawiają się sekwencyjnie dopiero po sformowaniu pełnego starcia (Atakujący + Obrońca).
- **Szczegółowe Tooltipy**: Pełna kalkulacja rzutów 3k20 (atrybuty, umiejętności, bonusy, PT) jest dostępna w formie bogatych tooltipów HTML po najechaniu na portrety uczestników w nagłówku starcia oraz na etykiety typu testu na kartach rzutu bronią.
- **Automatyczna Optymalizacja**: W standardowym trybie system automatycznie wydaje punkty umiejętności, aby przekształcić porażki w sukcesy (zgodnie z progiem sukcesu uwzględniającym Suwak).
- **Zasada Double Skill Action**: Opcjonalne ustawienie pozwalające na manualną alokację punktów umiejętności (obniżanie własnych wyników lub podwyższanie wyników przeciwnika).
- **Zabezpieczenia**: Naturalne 20 są zawsze porażką i nie mogą być modyfikowane.
- **Auto-Resolve**: Hook `createChatMessage` wykrywa rzut obronny i automatycznie dołącza obrońcę do starcia.
- **Result (Wynik)**: Wynik porównuje Punkty Sukcesu (SP) obu stron (nawet przy obustronnej porażce).
- **Automatyzacja Obrażeń**: Różnica SP automatycznie wybiera tier obrażeń broni (`damageMelee1/2/3`). Przewaga 1 SP = D, 2 SP = L, 3+ SP = C.
- **Socketlib Integration**: Wszystkie operacje na danych (aktualizacja flag wiadomości, modyfikacja statystyk) są wykonywane przez GM za pomocą `socketlib`.

## 12. Arkusz Aktora - Usprawnienia Walki (Character Sheet v1.6)

### Sekcja Walki (Combat Tab)
- **Podział Broni**: Bronie w zakładce Walka zostały podzielone na dwie wyraźne grupy pionowe: **Dystansowa (Ranged/Thrown)** i **Wręcz (Melee)**.
- **Inicjatywa Zwarcia (Melee Initiative)**: Nagłówek sekcji walki wręcz zawiera teraz dedykowany input `system.combat.meleeInitiative` oraz przycisk rzutu (ikona kostki), pozwalający na szybkie planowanie pojedynków bez otwierania combat trackera.
- **Dynamiczna Wysokość**: Listy broni mają ograniczoną wysokość (ok. 2 elementy) z automatycznym przewijaniem, co oszczędza miejsce na arkuszu przy dużej liczbie ekwipunku.
- **Synchronizacja z Dice So Nice**: Wszystkie rzuty inicjatywy (zarówno w trackerze, jak i na arkuszu) oraz starcia melee czekają na zakończenie animacji rzutu kośćmi 3D za pomocą hooka `diceSoNiceRollComplete`. Zapobiega to przedwczesnej aktualizacji danych w bazie (np. wpisaniu wyniku do Combat Trackera) zanim gracz zobaczy wynik na kościach.
- **Bogate Tooltipy na Awatarach**: Na kartach czatu (rzuty standardowe, broń, inicjatywa) awatar aktora posiada teraz bogaty tooltip HTML pokazujący pełną matematykę rzutu: bazowy atrybut, modyfikatory PT, kary za rany i pancerz oraz bonusy umiejętności.
- **Poprawki UX Dialogów**: Dialogi rzutu (Initiative, Weapon) zamykają się natychmiast po kliknięciu "Rzuć", a asynchroniczna logika rzutu kontynuuje pracę w tle (czekając na kości 3D). Przycisk "Anuluj" poprawnie blokuje wysyłanie formularza.
- **Logika Open Test (Inicjatywa)**: Naturalna 20 na dowolnej kości jest teraz twardo zablokowana jako automatyczna porażka i nie może zostać zmodyfikowana przez punkty umiejętności.
- **Melee Header**: Zoptymalizowano układ nagłówka walki wręcz na arkuszu - kontrolki (input inicjatywy, rzut) znajdują się po lewej stronie przy ikonach, a etykieta sekcji po prawej. Listy broni posiadają teraz sztywny limit wysokości (max 2 przedmioty) z płynnym przewijaniem.

### Architektura Danych
- **Trwałość Danych**: `prepareDerivedData` w modelu aktora bezpiecznie łączy dane obliczeniowe z polami bazy danych, co zapobiega nadpisywaniu manualnie ustawionych wartości (np. inicjatywy melee) podczas odświeżania arkusza.
- **Jedno Źródło Prawdy**: Wszelkie kalkulacje progów bazują na `attributeTotals`, co gwarantuje spójność wyników między arkuszem a logiką rzutów.

## 13. Dobre Praktyki ApplicationV2

### Unikanie Zagnieżdżonych Formularzy (Krytyczne)
ApplicationV2 domyślnie generuje kontener `<form>` (ustawienie `tag: "form"`). 
- **Zasada**: Szablony `.hbs` używane w ApplicationV2 **nie mogą** zawierać tagu `<form>`.
- **Skutek błędu**: Zagnieżdżenie tagów `<form>` powoduje błąd DOM, który w Foundry V13 wymusza pełne przeładowanie przeglądarki (navigation loop) i niszczy style interfejsu (HUD).
- **Rozwiązanie**: Szablon powinien być opakowany w `<div>` lub `<section>`, a przyciski wysyłające powinny korzystać z `type="submit"` lub `data-action` obsługiwanego przez `_onAction`.

## 14. Integracja Combat Trackera (Melee Duel Integration)

### `NeuroshimaCombatTracker` (Application V2)
- **Bezpieczne Wstrzykiwanie Treści**: System nie nadpisuje statycznej właściwości `PARTS`, aby uniknąć konfliktów z rdzeniem Foundry VTT. Zamiast tego, hook `_onRender` wstrzykuje HTML podsumowania walk (`melee-summary.hbs`) bezpośrednio do DOM paska bocznego przy użyciu `insertAdjacentHTML`.
- **Podsumowanie Walk Wręcz**: Wyświetla listę aktywnych starć bezpośrednio nad listą inicjatywy. Każdy wpis zawiera:
  - Nazwy/Ikony uczestników (Atakujący vs Obrońca).
  - Aktualny segment i turę starcia.
  - Przyciski szybkiego dostępu: "Otwórz Panel" oraz "Zakończ Starcie" (X).
- **Reaktywność**: Tracker odświeża się automatycznie przy każdej zmianie flag w dokumencie `Combat`, co gwarantuje spójność danych u wszystkich graczy.

## 15. Zaawansowany Cykl Życia Walki Wręcz

### Automatyzacja Workflow
- **Inicjacja Ataku**: Rzut bronią melee na stargetowanego przeciwnika automatycznie tworzy dokument starcia (`NeuroshimaMeleeDuel`) i zapisuje go w flagach aktywnej walki (Combat).
- **Auto-Open**: Hook `createChatMessage` natychmiast otwiera `NeuroshimaMeleeDuelTracker` u atakującego, obrońcy oraz MG.
- **Obsługa Tokenów Syntetycznych (UUID)**: System identyfikacji uczestników bazuje na `UUID` tokenów, co pozwala na prowadzenie wielu niezależnych starć z udziałem NPC (unlinked tokens) na tej samej scenie.
- **Powiadomienia na Arkuszu**: Jeśli aktor jest celem aktywnego ataku, na jego arkuszu w sekcji walki pojawia się czerwony panel informacyjny z przyciskiem szybkiej reakcji (rzut obronny).

### Zarządzanie Starciem
- **Finish Duel**: Akcja zakończenia starcia całkowicie czyści flagi z dokumentu Combat i zamyka powiązane interfejsy.
- **Trwałość Stanu**: Wszystkie informacje o segmentach, wykorzystanych kościach i inicjatywie zwarcia są przechowywane w bazie danych, co pozwala na przerwanie i wznowienie walki w dowolnym momencie.

## 17. Architektura Faz i Logika Starcia (Melee Duel v3)

Wprowadzono znaczące usprawnienia w stabilności i zgodności z zasadami Neuroshima 1.5.

### System Faz (Enums)
- **PHASES**: Zastąpiono surowe stringi obiektem zamrożonym `PHASES` (`INITIATIVE`, `ROLL_POOL`, `SEGMENTS`, `RESOLVED`).
- **Zalety**: Eliminuje błędy literówek, ułatwia debugowanie i zapewnia jedno źródło prawdy dla stanu starcia.

### Inicjatywa i Tury
- **Trwałość Inicjatywy**: Inicjatywa zwarcia (melee initiative) jest teraz trwała przez całe starcie. Nie jest resetowana przy przejściu do kolejnej tury 3-segmentowej.
- **Zmiana Inicjatywy**: Przejęcie inicjatywy następuje dynamicznie w trakcie segmentów (np. gdy atakujący spudłuje, a obrońca odniesie sukces). Zmiana ta jest zachowywana w kolejnych turach, dopóki starcie nie zostanie przerwane lub rozstrzygnięte.
- **Blokada Akcji**: Przycisk rzutu 3k20 na broń jest ukryty, dopóki obaj uczestnicy nie wykonają rzutu na inicjatywę. Zapobiega to rzutom "w ciemno" przed ustaleniem kolejności działań.

### Logika Ciosów i Obrażeń
- **Ciosy Łączone (1s, 2s, 3s)**: 
    - Atakujący może zadeklarować cios za 1, 2 lub 3 sukcesy.
    - **Obrażenia**: System automatycznie mapuje liczbę sukcesów na odpowiedni poziom obrażeń broni (`damageMelee1`, `damageMelee2`, `damageMelee3`).
    - **Obrona**: Aby skutecznie obronić się przed ciosem za X sukcesów, obrońca musi przeznaczyć dokładnie X kości sukcesu. Jeśli przeznaczy mniej, otrzymuje trafienie (nawet jeśli jego kości były sukcesami).
- **Maneuvery**: Tymczasowo wyłączono interfejs manewrów, aby uprościć workflow i skupić się na poprawnej implementacji bazowych zasad przejmowania inicjatywy.

### Usprawnienia UI
- **Układ Pool-Title**: Napis "Pula kości" oraz informacje o kościach zostały przeniesione nad wyniki rzutów, zapewniając bardziej pionowy i czytelny układ.
- **Widoczność Przycisków**: Przyciski akcji (Atak/Obrona) pojawiają się selektywnie tylko użytkownikowi, którego jest teraz kolej na wybór kości, co eliminuje chaos przy jednoczesnej grze wielu osób.

## 18. Usprawnienia UX i Stabilności (Melee & Ranged v1.7)

Wprowadzono pakiet poprawek wizualnych i funkcjonalnych, zwiększających czytelność walki oraz stabilność systemu rzutów.

### Usprawnienia Interfejsu Starcia (Melee Duel Tracker)
- **Wizualizacja Aktywnej Tury**: System dynamicznie podświetla portret aktywnego uczestnika (pomarańczowa, pulsująca obwódka). Podświetlenie aktywuje się po zakończeniu fazy przygotowawczej (inicjatywa + rzut 3k20).
- **Nagłówek Informacyjny**: Przeniesiono informacje o tura/segment nad sekcję rzutów, co poprawia hierarchię informacji.
- **Prywatność Danych**: Ukryto jawne progi sukcesu w nazwach puli kości. Pełna matematyka rzutu (atrybuty, modyfikatory, kary) jest dostępna w formie bogatych tooltipów HTML widocznych wyłącznie dla właściciela postaci i GM.

### Ujednolicony System Celowania (Unified Targeting)
- **Melee Map Targeting**: Broń biała korzysta teraz z tego samego mechanizmu co dystansowa. Jeśli przy inicjowaniu rzutu nie ma zaznaczonego celu, system wymusza wybór tokena lub punktu na mapie (minimalizując arkusz postaci), aby poprawnie zmierzyć dystans i zidentyfikować cel starcia.

### Logika Bojowa i Poprawki
- **Segment-based Resolution**: Refaktoryzacja `NeuroshimaMeleeDuelResolver`. System teraz poprawnie zlicza trafienia i parowania w każdym segmencie osobno, zgodnie z zasadami 1.5.1.
- **Naprawa Błędu Segmentu**: Usunięto błąd `TypeError` uniemożliwiający rozstrzygnięcie turny, gdy w ostatnim segmencie nastąpił obustronny brak sukcesów.
- **Prywatność i Tooltipy**: Pełna matematyka rzutów (atrybuty, modyfikatory, kary) jest dostępna w formie bogatych tooltipów HTML na etykietach sekcji, widocznych wyłącznie dla właściciela postaci i MG.

## 19. System Zacięcia Broni — Triggery Skryptów (Jamming Hooks)

Zaimplementowano trzy nowe triggery skryptów ActiveEffect pozwalające na pełną kontrolę nad mechaniką zacięcia broni dystansowej, bez potrzeby modyfikacji kodu systemowego.

### Przepływ egzekucji

```
rollWeaponTest()
  ↓
[dice roll] → bestResult
  ↓
  preWeaponJam   ← scripts modify jammingThreshold / forceNoJam / forceJam
  ↓
[isJamming = bestResult >= jammingThreshold]
  ↓ (if isJamming)
  weaponJam      ← scripts set canFireDespiteJam / clearJam
  ↓
[ammo consumed if !isJamming || canFireDespiteJam]
[hit sequence evaluated if isSuccess && (!isJamming || canFireDespiteJam)]
  ↓
  postWeaponShot ← scripts react to final shot result
  ↓
[chat card rendered]
```

### Trigger: `preWeaponJam`

Uruchamiany **przed** wyznaczeniem zacięcia. Pozwala na modyfikację progu zacięcia.

| Pole `args`         | Typ       | Opis |
|---------------------|-----------|------|
| `actor`             | Actor     | Strzelający |
| `weapon`            | Item      | Broń |
| `jammingThreshold`  | number    | Aktualny próg (min z broń i amunicja) — można modyfikować |
| `ammoJamming`       | number    | Wartość zacięcia z amunicji (read-only) |
| `bestResult`        | number    | Najlepsza (najniższa) kość |
| `forceNoJam`        | boolean   | Ustaw `true` → broń nie może się zaciąć |
| `forceJam`          | boolean   | Ustaw `true` → broń zawsze się zacina |

**Przykłady scenariuszy:**
- **Rusznikarstwo pasywne**: `this.modifyJammingThreshold(args, 3)` — próg podniesiony o 3 (trudniej zaciąć)
- **Wadliwa amunicja**: `this.forceWeaponJam(args)` — broń zawsze się zacina
- **Niezawodna broń**: `this.preventWeaponJam(args)` — broń nigdy się nie zacina

### Trigger: `weaponJam`

Uruchamiany **tylko gdy** zacięcie zostało wykryte. Pozwala na zezwolenie strzału mimo zacięcia lub anulowanie zacięcia.

| Pole `args`         | Typ       | Opis |
|---------------------|-----------|------|
| `actor`             | Actor     | Strzelający |
| `weapon`            | Item      | Broń |
| `bestResult`        | number    | Kość, która wywołała zacięcie |
| `jammingThreshold`  | number    | Próg, który został przekroczony |
| `canFireDespiteJam` | boolean   | Ustaw `true` → amunicja zużyta, seria obliczona (broń nadal zacięta) |
| `clearJam`          | boolean   | Ustaw `true` → zacięcie anulowane, broń strzela normalnie |

**Przykład — Sztuczka "Na pewno działa!":**
```js
// Trigger: weaponJam
// Rusznikarstwo 4+: jeden strzał mimo zacięcia (tylko standardowe zacięcie 11-18)
if (this.isStandardJam(args.bestResult)) {
    this.allowShotDespiteJam(args);
    this.notification("Na pewno działa! Broń oddaje jeszcze jeden strzał.");
}
```

**Inne przykłady:**
- **Szczęśliwa Awaria**: `this.clearWeaponJam(args)` — zacięcie jest ignorowane
- **Szybkie Odblokowanie** (wymaga testu): po zdanym teście umiejętności `this.clearWeaponJam(args)`

### Trigger: `postWeaponShot`

Uruchamiany **po** zakończeniu pełnego rzutu bronią (w tym przy zacięciu).

| Pole `args`         | Typ       | Opis |
|---------------------|-----------|------|
| `actor`             | Actor     | Strzelający |
| `weapon`            | Item      | Broń |
| `isSuccess`         | boolean   | Czy rzut był sukcesem |
| `isJamming`         | boolean   | Czy broń się zacięła |
| `firedDespiteJam`   | boolean   | Czy oddano strzał mimo zacięcia |
| `hitBullets`        | number    | Liczba trafionych pocisków |
| `bulletsFired`      | number    | Liczba wystrzelonych pocisków |
| `successPoints`     | number    | Punkty Przewagi z rzutu |
| `rollData`          | Object    | Pełny obiekt danych rzutu (read-only) |

**Przykłady scenariuszy:**
- **Przegrzanie broni**: po 3+ pociskach w serii dodaj warunek "Gorąca Broń"
- **Adrenalina z trafienia**: po sukcesie z 3+ PP — dodaj bonus do następnego testu
- **Powiadomienie o zacięciu**: własna wiadomość na czacie po wykryciu zacięcia

### Dostępne Helper Methods (`NeuroshimaScript`)

| Metoda | Trigger | Opis |
|--------|---------|------|
| `getWeaponJammingThreshold(weapon)` | preWeaponJam | Zwraca wartość `jamming` broni |
| `modifyJammingThreshold(args, delta)` | preWeaponJam | Zmienia próg zacięcia o delta |
| `preventWeaponJam(args)` | preWeaponJam | Broń nie może się zaciąć |
| `forceWeaponJam(args)` | preWeaponJam | Broń zawsze się zacina |
| `allowShotDespiteJam(args)` | weaponJam | Strzał mimo zacięcia (broń nadal zacięta) |
| `clearWeaponJam(args)` | weaponJam | Anuluj zacięcie całkowicie |
| `isStandardJam(bestResult, min?, max?)` | weaponJam | `true` jeśli wynik w zakresie 11–18 |

### Wymyślone Sztuczki Przykładowe (do implementacji jako AE)

| Sztuczka / Efekt | Trigger | Mechanika |
|------------------|---------|-----------|
| **Na pewno działa!** (Rusznikarstwo 4+) | weaponJam | `allowShotDespiteJam` tylko przy `isStandardJam` |
| **Niezawodna Broń** (pasywny AE) | preWeaponJam | `preventWeaponJam` (stałe) |
| **Szczęśliwa Awaria** (pasywny AE, 1×/scenę) | weaponJam | `clearWeaponJam` + zużyj użycie |
| **Rusznikarstwo Pasywne** (4 pkt = +1 próg) | preWeaponJam | `modifyJammingThreshold(args, floor(skill/4))` |
| **Przegrzanie Broni** | postWeaponShot | Jeśli `bulletsFired >= 3`, dodaj warunek |
| **Działa na Złomowisku** (wadliwa broń) | preWeaponJam | `modifyJammingThreshold(args, -3)` |
| **Adrenalinowy Strzał** | postWeaponShot | Jeśli `successPoints >= 3`, dodaj 1 do nast. rzutu |
| **Wymuszony Zacisk** (debuff wroga) | preWeaponJam | `forceJam` na podstawie flagi aktora |

---

## 20. System Komunikatów i Raportowania (Melee Feedback v1.1)

Wprowadzono ujednolicony system raportowania przebiegu walki wręcz na czacie, korzystający z dedykowanych szablonów wizualnych.

### Rodzaje Komunikatów
- **Melee Duel Started**: Nowa karta powitalna starcia, pokazująca portret atakującego, używaną broń oraz instrukcję obrony dla celu.
- **Melee Segment Result**: Szczegółowy raport z każdego segmentu. Zawiera porównanie mocy ataku vs obrony, informację o zadanych ranach (D, L, C) lub skutecznym parowaniu/przejęciu inicjatywy.
- **Melee Turn Summary**: Podsumowanie całej tury 3-segmentowej. Zbiera wyniki wszystkich akcji w jedną czytelną listę, pozwalając na szybką analizę przebiegu starcia.

### Architektura Komunikatów
- **Standardizacja**: Wszystkie komunikaty korzystają z klasy `.neuroshima.roll-card`, co zapewnia spójność z rzutami umiejętności i broni dystansowej.
- **Lokalizacja**: Pełne wsparcie dla języka polskiego i angielskiego w opisach wyników segmentów.
- **Data Persistence**: Komunikaty przechowują `duelId` we flagach, co umożliwia przyszłe rozszerzenia (np. interaktywne przyciski na karcie wyniku).
- **Zarządzanie Amunicją**: Zintegrowano logikę refundacji amunicji z przyciskiem "Przerzut" na karcie czatu. System automatycznie zwraca pocisk zużyty w poprzednim rzucie przed wykonaniem nowego, co zapobiega nadmiarowemu pobieraniu amunicji przy przerzutach.
- **Optymalizacja Karty Rzutu**: Wyeliminowano błędy wizualne na kartach czatu dla postaci z umiejętnością 0 (ukrywanie zbędnych strzałek i "pustych" kwadratów kości).
- **Stabilność Rzutów Dystansowych**: Naprawiono błąd `meleeAction is not defined`, który uniemożliwiał strzelanie przy braku aktywnego starcia wręcz.

