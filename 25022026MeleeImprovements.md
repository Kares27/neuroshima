# Melee Improvements & Healing Refactoring (25.02.2026)

## 1. Walka Wręcz (Melee Combat)
Wprowadzono kompletny system testów przeciwstawnych dla walki wręcz, wzorowany na mechanice WFRP4e, ale dostosowany do realiów Neuroshimy 1.5.

### Kluczowe Funkcjonalności:
- **Testy Przeciwstawne (Opposed Tests)**:
  - Automatyczna inicjacja po stargetowaniu przeciwnika i wykonaniu rzutu bronią białą.
  - Tworzenie "Handlera" na czacie, który oczekuje na rzut obronny celu.
  - Tryby porównywania: **SP Mode** (różnica Punktów Przewagi) oraz **Dice Mode** (porównywanie segmentów/kości).
- **UI/UX na Czacie**:
  - Usunięto zbędne selektory lokacji trafienia z kart czatu (lokacja jest teraz częścią rzutu lub wyboru w dialogu).
  - Zintegrowano sekcję nakładania obrażeń (`apply-damage-section`) bezpośrednio z wynikiem pojedynku.
  - Dodano dynamiczne raporty pokazujące kto wygrał i o ile (Advantage).
- **Mapowanie Obrażeń**:
  - Broń biała korzysta z `damageValue` zdefiniowanego w przedmiocie.
  - Wynik testu przeciwstawnego (`spDifference`) wpływa na ostateczny tier obrażeń.

### Poprawki Techniczne:
- Rozwiązano błędy `ReferenceError` związane z brakującymi definicjami `NEUROSHIMA` oraz `locationSelectHtml`.
- Usprawniono logikę `resolveOpposed` w `NeuroshimaChatMessage`.

## 2. System Leczenia (Healing App Refactor)
Gruntowna przebudowa systemu identyfikacji pacjenta i medyka w celu wyeliminowania błędów przy unlinked tokenach i braku przypisanych postaci graczy.

### Zmiany w Logice:
- **System Referencji (`Refs`)**:
  - Wprowadzono `patientRef` i `medicRef` zamiast prostych ID/UUID.
  - Referencje przechowują `kind` (token/actor) oraz `uuid`, co pozwala na stabilne odnajdywanie celu nawet bez aktywnej sceny.
- **Wybór Medyka**:
  - Dialog wyboru medyka pokazuje teraz wyłącznie **Postacie Graczy** (Player Characters) przypisane do aktywnych użytkowników.
  - Eliminuje to listę setek NPC u GM-a i zapobiega błędom "medicUser.character is null".
- **Bezpieczeństwo i Uprawnienia**:
  - `HealingApp` sprawdza uprawnienia na podstawie ownershipu do aktora medyka, a nie tylko roli GM.
  - Aplikowanie leczenia odbywa się poprzez socket do GM-a, który ponownie weryfikuje dane przed zapisem.

## 3. Lokalizacja i Konfiguracja
- Rozbudowano pliki `en.json` i `pl.json` o brakujące klucze dla walki wręcz i systemu referencji.
- Zaktualizowano `CombatConfig` o nowe opcje sterujące testami przeciwstawnymi.
