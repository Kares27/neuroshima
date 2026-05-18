# Neuroshima 1.5 FoundryVTT — Changelog

Zmiany wprowadzone w systemie w okresie **12–18 maja 2026**.

---

## [Unreleased] — 18 maja 2026

### System Leczenia — Zgodność z zasadami Neuroshima 1.5

#### Nowe pola danych rany (`WoundData`)
- `failedFirstAidAttempts` — liczba kolejnych nieudanych prób Pierwszej Pomocy (licznik zeruje się po sukcesie)
- `failedTreatmentAttempts` — liczba kolejnych nieudanych prób Leczenia Ran (jw.)
- `firstAidHealingApplied` — łączna % kary usunięta przez PP (limit 5%)
- `originalPenalty` — kara procentowa rany w chwili pierwszego leczenia (punkt bazowy dla limitu 15%)

#### Wzrost trudności po nieudanych próbach (+1 PT)
- `rollBatchHealingTests` (`dice.js`) — każda rana z `config.failedAttempts > 0` ma odpowiednio przesuniętą trudność testu o +1 poziomu PT za każdą poprzednią porażkę tej metody
- `rerollHealingTest` (`dice.js`) — ta sama logika przy przerzutach z karty czatu
- `healing-roll-dialog.js` `_onRoll` — `failedAttempts` odczytywane z danych rany i przekazywane do `woundConfig`

#### Maksymalne limity leczenia
- **Pierwsza Pomoc: max 5% łącznie na ranę** — egzekwowane przez `firstAidHealingApplied`
- **Łącznie PP + Leczenie Ran: max 15% na ranę** — egzekwowane przez `originalPenalty`
- Cap stosowany w trzech miejscach: `calculateHealingEffects` (dice.js), `calculateHealingResults` (healing-app.js) oraz `onApplyHealing` (chat-message.js) — ostatnie miejsce re-oblicza ze świeżych danych rany w chwili aplikacji

#### `onApplyHealing` (`chat-message.js`) — pełna przebudowa
- Re-obliczanie `newPenalty` ze świeżych danych rany (nie ze stale flagi)
- Automatyczna aktualizacja wszystkich pól tracking po każdej aplikacji:
  - `originalPenalty` ustawiane przy pierwszym leczeniu
  - `firstAidHealingApplied` inkrementowane o faktycznie wyleczone %
  - `failedFirstAidAttempts` / `failedTreatmentAttempts` zerowane po sukcesie, inkrementowane po porażce
  - `healingAttempts` (istniejące pole) inkrementowane jak dotychczas
- `healingModifier` pobierany z `extraData.woundConfigs` (flaga czatu) zamiast z flagi wynikowej

#### Mapowanie danych ran
- `combat-helper.js` — nowe pola dodane do obiektu rany w `generatePatientCard`
- `actor-sheet.js` — nowe pola dodane do obiektu rany w `_prepareContext`

#### Dokumentacja (`effect-scripts.html`)
- Zaktualizowany opis `args.wounds` — nowe pola obiektu rany
- Nowa tabela pól obiektu rany w sekcji Dialog Leczenia
- Nowy callout opisujący wbudowane zasady leczenia (trudność bazowa, limity, wzrost PT)
- Nowe przykłady skryptów: bonus za specjalistyczny sprzęt przy wielu porażkach, ukrywanie modyfikatora gdy limit PP wyczerpany

---

## [Unreleased] — 16–17 maja 2026

### Dialog Leczenia — Pełna przebudowa (`NeuroshimaHealingRollDialog`)

#### Nowa klasa dialogu
- `NeuroshimaHealingRollDialog extends NeuroshimaRollDialogBase` zastąpiła starą funkcję `showHealingRollDialog` opartą na `DialogV2`
- `rollType: "healing"` — skrypty efektów mogą podpinać się do dialogu leczenia
- Pełny wzorzec re-renderowania (WFRP-style): `userEntry` przechowuje nadpisania użytkownika, `_prepareContext` przelicza przy każdym renderowaniu
- Panel Dialog Modifiers z toggleowalnymi wpisami (jak w dialogach broni/umiejętności)
- `_woundGroupMap` — grupowanie ran po typie uszkodzeń (D/L/C/K), śledzenie trudności i modyfikatorów per typ
- `_updateSummary()` — oblicza: globalny modyfikator trudności, trudność per typ rany, % leczenia, stosuje `difficultyShift` ze skryptów

#### Nowy szablon `healing-roll-dialog.hbs`
- Layout `weapon-roll-dialog-content` — ujednolicony z dialogami broni
- `rd-top-split`: lewa kolumna z checkboxami (modyfikator, pancerz, rany, choroba, bonusy), prawa kolumna z panelem Dialog Modifiers
- `rd-dropdowns-row`: wybór metody leczenia i atrybutu w dwóch kolumnach (osobna sekcja między `rd-top-split` a tabelą ran)
- Tabela ran z wyborem trudności per typ, kolumną % leczenia i modyfikatorem per typ
- Sekcja podsumowania: globalna trudność + dostosowana trudność per typ rany
- Stopka z przyciskami Roll / Cancel (standard Application V2)

#### Integracja z systemem skryptów
- `NeuroshimaScriptRunner.computeDialogFields()` wywoływane z `rollType: "healing"`
- `difficultyShift` ze skryptów stosowany w `_updateSummary` via `NeuroshimaScriptRunner.shiftDifficultyKey()`
- Backward-compatible wrapper `showHealingRollDialog()` — bez zmian w `system.js` i `healing-app.js`

#### Dokumentacja (`effect-scripts.html`)
- Nowa sekcja "Skrypty dialogowe — Dialog Leczenia"
- Opis `args.healingMethod` i `args.wounds` w tabeli kontekstu
- Callout o działaniu `difficultyShift` w leczeniu
- Przykłady: globalny `difficultyShift`, warunkowy per typ rany, bonus do PP, modifier %

---

## [Unreleased] — 14–15 maja 2026

### Pipeline żądania leczenia (Healing Request)

#### Karta czatu żądania
- Uproszczona karta informacyjna bez elementów interaktywnych dla graczy
- Sekcja `ns-gm-actor-section` widoczna tylko dla GM (`{{#if isGM}}`)
- Poprawiony layout checkboxów lokacji

#### Socket i Drag-Drop
- GM-only obsługa drag-drop ran między aktorami
- `NeuroshimaSocket.gmExecute` dla operacji wymagających uprawnień GM
- `resolveRef` — helper do rozwiązywania referencji aktorów przez UUID

---

## [Unreleased] — 12–13 maja 2026

### System Modyfikatorów Broni i Pancerza

#### Dane i schemat
- `WeaponModData` / `ArmorModData` — dedykowane klasy danych w `item-data.js`
- `template.json` — rozszerzone o pola modów
- Pola nadpisań (override boolean): `overrideCaliberId`, `overrideRange`, `overrideDamage`, `overrideROF` itp.
- `computeWeaponEffective()` — oblicza efektywne statystyki broni uwzględniające aktywne mody
- `worldCalibers` datalist — globalna lista kalibrów dostępna w interfejsie

#### UI i szablony
- `mods-tab.hbs` — dedykowana zakładka modów w arkuszu itemu
- `weapon-ranged.hbs` — blokowanie pól przy aktywnym modzie (lock icons)
- Kolapsowalne sekcje modów i zasobów
- Tooltips modów w kartach czatu i podsumowaniach itemów
- Separator `ns-divider` i obramowania `damage-input-row`

#### Logika modów
- `mod-helpers.js` — `getModEffects()`, `applyModEffectsToTargets()`, `removeEffectsAppliedFromThis()`
- `@mod.*` placeholdery w skryptach efektów
- Wsparcie dla zasobów per mod (`@mod.resources`)
- Natywne `effect.applyEffect()` / `this.applyEffects()` — generyczny helper
- `WeaponModifier` — integracja pól modyfikatora broni

### System Skryptów — Rozszerzenia

#### Czas gry (`worldTime`)
- `worldTimeUpdate` trigger — wyzwalacz przy każdej zmianie czasu świata
- `daysCrossed` / `hoursCrossed` / `minutesCrossed` — helpery flag-free do testowania przekroczenia progów czasu
- `worldTime` helpers w szablonach Handlebars

#### Zasoby per mod
- `mod-scoped resource helpers` — zarządzanie zasobami przypisanymi do konkretnego modu
- `_preUpdate` fix — poprawna obsługa zasobów przy aktualizacji modów

#### Efekty ActiveEffect (AE)
- Poprawka duplikowania AE
- `equipTransfer` zachowane przy przenoszeniu
- `@mod.*` placeholder support w value expressions AE

---

## Kontekst techniczny

| Obszar | Pliki |
|--------|-------|
| Dane ran | `module/data/item-data.js` |
| Logika leczenia | `module/apps/healing-app.js`, `module/helpers/dice.js` |
| Dialog leczenia | `module/apps/healing-roll-dialog.js`, `templates/dialog/healing-roll-dialog.hbs` |
| Karta czatu | `module/documents/chat-message.js` |
| Mapowanie danych | `module/helpers/combat-helper.js`, `module/sheets/actor-sheet.js` |
| Dokumentacja | `docs/effect-scripts.html` |
| Mody broni/pancerza | `module/helpers/mod-helpers.js`, `templates/items/parts/mods-tab.hbs` |
| System skryptów | `module/helpers/script-runner.js` |
