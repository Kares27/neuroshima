# Implementacja Systemu Walki Wręcz (Tryb Vanilla)

Zaimplementowano trzeci tryb walki wręcz – **Vanilla** – oparty na zasadach Neuroshim 1.5, zintegrowany z istniejącą logiką testów przeciwstawnych (`opposed`).

## Główne zmiany

### 1. Logika Systemowa (`system.js`)
- Dodano tryb `vanilla` do ustawień systemu (`game.settings`).
- Zaimplementowano generator puli kości na podstawie aktualnego segmentu tury.
- Zintegrowano stan walki z flagami `game.combat` (synchronizacja w czasie rzeczywistym).
- Dodano obsługę rzutów inicjatywy zwarcia oraz rozstrzyganie segmentów (trafienie vs obrona).

### 2. Interfejs Użytkownika (ApplicationV2)
- **Struktura (`templates/apps/melee-panel.hbs`)**: Przebudowano szablon na układ typu Grid, dzieląc go na sekcje:
    - Dane Atakującego (lewa góra) i Obrońcy (prawa góra).
    - Pule kości (D1-D3) umieszczone w kolumnach po bokach.
    - Centrum Akcji (segmenty, inicjatywa, przycisk rozstrzygnięcia).
    - Log walki (dół panelu).

### 3. Stylizacja (`css/melee.css`)
- Wdrożono pełny układ **CSS Grid** (`grid-template-areas`).
- Dodano responsywne style dla przycisków kości (stany: wybrana, użyta, nieaktywna).
- Wprowadzono animacje (pulsowanie przycisku rozstrzygnięcia) oraz kolorystykę zgodną z klimatem gry (czerwień dla ataku, morski dla obrony).
- Ustalono minimalne wymiary panelu na 600x500px dla zachowania czytelności.

### 4. Tłumaczenia (`lang/pl.json`, `lang/en.json`)
- Dodano klucze tłumaczeń dla nowych komunikatów, trybu Vanilla oraz elementów interfejsu panelu zwarcia.

## Instrukcja użycia
1. Zaznacz target.
2. Wykonaj rzut na broń białą.
3. Kliknij "Rozpocznij starcie" w wiadomości na czacie.
4. W otwartym panelu rzuć inicjatywę (GM), a następnie gracze wybierają kości na dany segment.
5. GM zatwierdza wynik segmentu przyciskiem "Rozstrzygnij".
