# Usprawnienia Systemu Neuroshima 1.5 - 26.02.2026

Dzisiejsza sesja programistyczna skupiła się na głębokiej refaktoryzacji mechanik walki wręcz, automatyzacji procesów obrażeń oraz poprawie estetyki i czytelności interfejsu konfiguracji.

## 1. Refaktoryzacja i Automatyzacja Walki Wręcz (Melee Opposed)
- **Ujednolicenie Trybów Walki**: Usunięto przestarzały tryb SP, pozostawiając tryby `Successes` (Różnica sukcesów) oraz `Dice` (Porównanie kości/Segmenty).
- **Logika Bonusów Broni**:
    - **Tryb Successes**: Bonusy ataku/obrony z broni są teraz dodawane do **Atrybutu**, co bezpośrednio wpływa na próg sukcesu (target).
    - **Tryb Dice**: Bonusy z broni są dodawane do **Umiejętności**, zwiększając pulę punktów dostępnych do modyfikacji wyników na kościach.
- **Automatyzacja Wyboru Obrażeń**: System teraz inteligentnie wybiera tier obrażeń z danych broni (`damageMelee1/2/3`) na podstawie przewagi (`spDifference`) uzyskanej w starciu.
- **Eliminacja Błędów Logicznych**:
    - Naprawiono problem "self-targetingu", gdzie obrońca rzucający na obronę inicjował nowy test przeciwstawny przeciw samemu sobie.
    - Naprawiono błędy `TypeError` przy renderowaniu wyników starcia na czacie.
    - Upewniono się, że rzuty obronne oraz rzuty ze skilli w kontekście walki wręcz zawsze korzystają z logiki testu **ZAMKNIĘTEGO** (3k20).

## 2. Automatyzacja Testów Odporności na Ból
- **Dynamiczne Progi Trudności**: Naprawiono błąd, przez który wszystkie automatyczne testy odporności na ból korzystały z tej samej trudności. Teraz system poprawnie odczytuje trudność (`Easy`, `Average`, `Hard` itd.) przypisaną do konkretnego typu rany (D, L, C, K) w konfiguracji `woundConfiguration`.
- **Niezależny Suwak (Slider)**: Wprowadzono nowe ustawienie globalne `allowPainResistanceShift`. Pozwala ono na włączenie/wyłączenie mechaniki Suwaka (przesunięcia PT o 1 stopień na każde 4 pkt umiejętności) specyficznie dla testów na rany, niezależnie od ogólnych ustawień walki.

## 3. Usprawnienia Interfejsu i UX
- **Kompaktowa Konfiguracja**: Zrefaktoryzowano panel `CombatConfig`. Nowy, sekcyjny układ z mniejszymi czcionkami dla notatek i lepszym marginesem poprawia czytelność i eliminuje problem "zbyt dużych tekstów". Styl został ujednolicony z panelem udźwigu (`EncumbranceConfig`).
- **Zarządzanie Trybami Rzutu (Roll Modes)**:
    - Przebudowano dialogi rzutów (`roll-dialog.hbs`, `ranged-roll-dialog.hbs`), przenosząc wybór trybu rzutu na dół formularza, tuż nad przyciski akcji.
    - Dodano pełne wsparcie dla `CONST.DICE_ROLL_MODES` (Public, Private GM, Blind GM, Self Roll).
    - Wprowadzono zaawansowaną stylizację CSS dla wiadomości czatu:
        - Dedykowane kolory obramowania (border 2px) dla całego kontenera wiadomości w zależności od trybu prywatności.
        - Etykiety tekstowe trybu (np. "PRIVATE GM ROLL") wyświetlane nad nagłówkiem karty dla szybkiej identyfikacji widoczności rzutu.

## 4. Techniczne Poprawki
- Naprawiono błąd odczytu etykiet trudności w raportach Odporności na Ból.
- Poprawiono synchronizację flag między wiadomościami ataku, obrony i handlera starcia.
- Usprawniono metodę `_getShiftedDifficulty`, zapewniając bezpieczne fallbacki dla nieoczekiwanych poziomów trudności.
