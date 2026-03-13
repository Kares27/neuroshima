# Log Zmian - 02.03.2026

## Rozszerzenie Systemu Walki i Centralizacja Atrybutów

Dzisiejsze prace skupiły się na głębokiej automatyzacji starć w zwarciu (Melee Duel), ujednoliceniu rzutów na inicjatywę oraz optymalizacji obliczeń atrybutów.

### 1. Centralizacja Kalkulacji Atrybutów
- **`attributeTotals`**: Wprowadzono nową strukturę w modelu danych aktora (`NeuroshimaActorData`), która centralizuje obliczenia: `Base + Modifier + Effects`.
- Rozwiązano problem powielania logiki matematycznej w różnych częściach systemu (karty, rzuty, dialogi). Wszystkie testy korzystają teraz z tej samej "Single Source of Truth".

### 2. Ujednolicony System Inicjatywy
- **`NeuroshimaInitiativeRollDialog`**: Nowy dialog oparty na **ApplicationV2**, używany zarówno przez Combat Tracker (ikona kości), jak i system walki wręcz.
- **Wsparcie dla Umiejętności**: Dodano opcję "Uwzględnij umiejętność" bezpośrednio w dialogu inicjatywy. System automatycznie sugeruje odpowiednią umiejętność na podstawie używanej broni.
- **Integracja z Combat Trackerem**: Nadpisano standardową metodę `rollInitiative` w Foundry, aby wymusić otwarcie naszego dialogu i poprawne przeliczenie sukcesów (Punkty Przewagi) do tabeli inicjatywy.
- **Bogate Tooltipy**: Zamiast generować oddzielne wiadomości na czacie podczas starć wręcz, pełny wynik rzutu na inicjatywę jest renderowany jako interaktywny tooltip HTML nad plakietką Punktów Przewagi (`advantage-badge`).

### 3. Automatyzacja Starć Melee (Melee Duel v2)
- **Sekwencyjne Fazy**: Wdrożono cykl życia starcia: `Initiative -> Modification -> Segments`.
- **Ukrywanie Wyników**: Kości przeciwnika są ukryte (placeholder "Oczekiwanie na Inicjatywę") dopóki obie strony nie wykonają rzutu na inicjatywę.
- **System "Podwójne działanie Umiejętności"**:
    - Dodano ustawienie systemowe (`doubleSkillAction`).
    - **Tryb Automatyczny (Standardowy)**: System automatycznie optymalizuje wydawanie punktów umiejętności (`_autoOptimizeDice`), obniżając wyniki na kościach tak, aby uzyskać maksymalną liczbę sukcesów.
    - **Tryb Manualny**: Gracze mogą ręcznie odejmować punkty od swoich kości lub dodawać je przeciwnikowi za pomocą przycisków +/- (dostępne tylko przy włączonym ustawieniu).
- **Zabezpieczenie Naturalnych 20**: Zgodnie z zasadami, naturalna 20 na kości jest nienaruszalna i zawsze oznacza porażkę – system uniemożliwia jej modyfikację.

### 4. Usprawnienia Interfejsu (UX/UI)
- **Skalowanie Tooltipów**: Zwiększono rozmiary czcionek i elementów w tooltipach rzutów, aby zapewnić czytelność na monitorach o wysokiej rozdzielczości.
- **Fix "Cancel"**: Naprawiono brak reakcji przycisku "Anuluj" w dialogach V2.
- **Dynamiczne UI**: Paski modyfikacji i przyciski resetu puli są ukrywane, gdy system zarządza umiejętnościami automatycznie, co redukuje "szum" informacyjny na karcie.

### 6. Szczegółowe Tooltipy Inicjatywy i Broni (v2.1)
- **`_buildOpenTestTooltip` & `_buildClosedTestTooltip`**: Wprowadzono nową metodę renderowania tooltipów dla testów otwartych i zamkniętych, spójną z raportem odporności na ból.
- **Pełny Rozbiór Danych**: Tooltipy wyświetlają teraz:
    - Oryginalne i zmodyfikowane wyniki wszystkich kości (z oznaczeniem kości ignorowanej w testach otwartych).
    - Bazowy atrybut, bonusy atrybutu, bazową umiejętność oraz bonusy umiejętności.
    - Ostateczny próg sukcesu (Target) oraz Punkty Przewagi (Success Points / Success Count).
- **Zastosowanie**: Tooltipy zostały dodane do etykiet typu testu (`test-type`) na kartach rzutu bronią oraz w starciach wręcz, co pozwala GM na szybki podgląd kalkulacji bez szukania w logach.
- **Lokalizacja**: Wszystkie etykiety w tooltipach są teraz w pełni lokalizowane za pomocą `game.i18n`.
