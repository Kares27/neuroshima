# Dokumentacja Techniczna Komponentów - Neuroshima 1.5

Przegląd kluczowych plików i logiki zaimplementowanej w systemie.

## 1. Logika Rzutów (`module/helpers/dice.js`)
- **NeuroshimaDice.rollWeaponTest**: Główna metoda obsługująca ataki. Odpowiada za pobieranie kar, rzut odpowiednią liczbą kości (celowanie), losowanie lokacji, aplikowanie zasady Suwaka i generowanie karty czatu.
- **NeuroshimaDice.reEvaluateWeaponRoll**: Metoda pozwalająca na przeliczenie wyników rzutu bez ponownego rzucania kośćmi. Używana przy zmianie typu testu na czacie.
- **NeuroshimaDice.getDamageTooltip**: Helper parsujący skróty obrażeń (np. "D/L") na pełne nazwy z konfiguracji (np. "Draśnięcie / Lekka Rana") dla tooltipów.

## 2. Arkusz Postaci (`module/sheets/actor-sheet.js`)
- **_prepareContext**: Przygotowuje dane dla arkusza, w tym sumowanie kar z pancerza i ran oraz organizację przedmiotów w zakładkach.
- **_prepareCombatWeapons**: Formatuje dane o broniach do wyświetlenia w zakładce Walka, automatycznie parsując obrażenia dla broni białej i szukając magazynków dla broni dystansowej.
- **_prepareSubmitData**: Kluczowa metoda zapewniająca synchronizację danych. Umożliwia edycję pól przedmiotów (ran) bezpośrednio z poziomu arkusza aktora.

## 3. Konfiguracja (`module/config.js`)
- **NEUROSHIMA.difficulties**: Definicje progów trudności i ich modyfikatorów procentowych.
- **NEUROSHIMA.woundConfiguration**: Centralne miejsce definicji typów ran (D, L, C, K) wraz z ich punktami obrażeń i karami.
- **NEUROSHIMA.hitLocationModifiers**: Zawiera dwie pod-sekcje (`melee` i `ranged`) z karami procentowymi za celowanie w konkretne części ciała.

## 4. Aplikacje i Dialogi (`module/apps/`)
- **NeuroshimaWeaponRollDialog**: Zaawansowane okno rzutu oparte na `ApplicationV2`. Zawiera logikę `_updatePreview`, która w czasie rzeczywistym oblicza ostateczną trudność, sumę kar i przewidywaną liczbę wystrzelonych pocisków.
- **Persistence**: Wykorzystuje flagę `lastWeaponRoll` w modelu danych aktora do zapamiętywania ostatnich wyborów gracza w dialogu rzutu.

## 5. Szablony (`templates/`)
- **actor-combat.hbs**: Układ zakładki walki. Wykorzystuje `selectOptions` do edycji typu rany i lokacji bezpośrednio na liście.
- **weapon-roll-card.hbs**: Szablon karty czatu dla broni. Wykorzystuje pomocnicze klasy CSS do wyświetlania kości w formie kwadratów i stylizowanych wierszy informacji.

## 6. Style (`css/base.css` i `css/actor.css`)
- **.roll-card**: Główne style dla wiadomości na czacie, w tym obsługa trybu ciemnego i kropkowanych linii (`.dotted-hr`).
- **.stat-box**: Style nagłówka arkusza postaci z dynamicznymi kolorami kar.
