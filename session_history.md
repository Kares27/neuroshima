# Zapis sesji - System Neuroshima 1.5 (Foundry VTT v13)
*Data: 18 lutego 2026*

## Użytkownik:
Przeskanuj ogólnie cały code base i pliki .md aby zrozumieć koncept co robimy, co zostało zrobiona itp, po czym oczekuj na dalsze instrukcje.

## Asystent:
*Zidentyfikowano strukturę projektu:*
- **System**: Neuroshima 1.5 na API v13 Foundry VTT.
- **UI**: Wykorzystanie Application V2.
- **Logika**: Klasa `NeuroshimaDice` w `dice.js`, modele danych w `item-data.js`.
- **Lokalizacja**: Obsługa `pl.json` i `en.json`.
- **Debug**: Obsługa settingu `debugMode`.

---

## Użytkownik:
Dobrze, to teraz chciałęm do rzutów dodać bonusy do atrybutu, który wpływa ostatnie na próg i bonus do umiejętności. [...] Chciałem aby te dodatkowe pola znajdowały się pod dialog column, na skill bonus po lewej, na atrybut bonus po prawej jako inputy.

## Asystent:
- Zmodyfikowano `NeuroshimaDice.rollTest` i `rollWeaponTest` w `dice.js`, aby uwzględniały `skillBonus` i `attributeBonus`.
- Zaktualizowano `NeuroshimaWeaponRollDialog` w `weapon-roll-dialog.js` o nowe pola w UI.
- Dodano klucze tłumaczeń do `pl.json` i `en.json`.
- Zaktualizowano szablony `ranged-roll-dialog.hbs` i `melee-roll-dialog.hbs`.

---

## Użytkownik:
A czy możesz też zmodyfikować tooltip chatmessage aby także pokazywał oddzielnie bonus do umiejętności i atrybutu, szczególnie też chce zmniejszyć nazwe na Bon. do Umiejętności/Atrybutu i w nazwie label dać pełną nazwe.

## Asystent:
- Zaktualizowano `weapon-roll-card.hbs` i `roll-card.hbs`.
- Tooltipy wyświetlają teraz: `Współczynnik: [X] Bon. do Współczynnika: [Y]` oraz `Umiejętność: [X] Bon. do Umiejętności: [Y]`.

---

## Użytkownik:
Sprawdź jak obecnie jest rzucane przy ataku test zamknięty i otwarty odpowiednio. [...] jak mamy czy 1d20, 2d20, 3d20 zawsze bierzemy tą kość najniższą, czyli najlepszą.

## Asystent:
- Poprawiono logikę zacięcia (Jamming) – teraz zawsze liczone z pierwszej rzuconej kości (`results[0]`), co zapobiega zmniejszaniu szansy na zacięcie przez celowanie.
- Zaktualizowano wyświetlanie wyników: pokazujemy wszystkie kości, ale modyfikujemy wizualnie tylko tę najlepszą.

---

## Użytkownik:
Ok dwie kwestie. Co do modyfikacji rzutu, skoro i tak wybieramy jedną najlepszą w ranged to możę niech pokazuje after effect, czyli po modyfikacjach tylko jedną kość [...] dodatkowo jeżeli broń ma ustawione seria 0 to chciałbym aby sam suwak serii na dialogu rzutu był disabled [...]

## Asystent:
- Ukryto strzałki modyfikacji dla kości innych niż najlepsza.
- Zablokowano suwak serii (`disabled`) w dialogu, gdy `fireRate` wynosi 0.
- Naprawiono wyświetlanie `undefined` w polu `burstCount`.

---

## Użytkownik:
Następnie potrzebuje propozycji jak rozwiązać kwestie z naszym system przy strzelaniu śrutem [...] Do 2 metrów (Krytyczna + Draśnięcia), Do 5m (Ciężka + Draśnięcia), Do 10m (Lekka + Draśnięcia), Do 20m (Draśnięcia). Trafienie śrutem powoduje tyle Draśnięć, ile strzelec osiągnął Punktów Sukcesu.

## Asystent:
- Zaproponowano rozszerzenie modelu `AmmoData` o flagę `isPellet` i tabelę `pelletRanges`.
- Zaplanowano logikę: `Liczba Draśnięć = Punkty Sukcesu`.
- Zaplanowano logikę lokacji: pierwsze trafienie wylosowane, kolejne to `lokacja - 1`.

---

## Użytkownik:
[...] w item ammo aby tam brał odpowiednio czy jest to śrutówka czy nie. Czyli tam gdzie mamy form-group checkbox-right override-toggle chciałbym na prawo od tego w własnej tabeli dać drugi checkbox czy dane ammo jest śrutówką i jak jest enabled tam ustawiamy po prostu zasięgi i rodzaj obrażeń.

## Asystent:
- Zaktualizowano `AmmoData` w `item-data.js`.
- Przebudowano `ammunition-details.hbs` na układ dwukolumnowy.
- Dodano tabelę zasięgów (4 progi) z edytowalnymi dystansami i typami obrażeń.
- Zablokowano nadpisywanie obrażeń (`overrideDamage`), gdy włączony jest tryb śrutu.
- Dodano style CSS w `items.css` dla nowego układu i obsługę `overflow-y: auto`.

---

## Użytkownik:
Chciałbym zaimplementować liczenie obrażeń na serii z normalnych broni i dodatkową zasadę przy śrucie (pellet). [...] bierzemy dystans do celu (Target), obliczamy bazowe obrażenia z tabeli i liczbę draśnięć (śrucin). Pierwszy pocisk zadaje min(PP, pelletCount) draśnięć, a każdy kolejny o 1 mniej.

## Asystent:
- **Mechanika Dystansu**: Dodano automatyczny pomiar dystansu (`Ray`, `measureDistance`) w `NeuroshimaWeaponRollDialog` przy zaznaczonym celu.
- **Logika Śrutu**: Zaimplementowano w `NeuroshimaDice.rollWeaponTest` sekwencję draśnięć: `min(PP, pelletCount)` dla pierwszej łuski i `-1` dla każdej kolejnej w serii.
- **Liczba Śrucin**: Dodano pole `pelletCount` do `AmmoData` i arkusza amunicji (Buckshot/Birdshot).
- **Ustawienia Systemu**: Dodano setting `usePelletCountLimit` (wymaga przeładowania) sterujący widocznością i działaniem limitu śrucin.
- **Zasady Serii**: Poprawiono mnożniki wystrzelonych pocisków dla broni maszynowej: Krótka (1xROF), Długa (3xROF), Ciągła (6xROF).
- **Interfejs Czatu**: Zaktualizowano `weapon-roll-card.hbs` – pole "Śrut" pokazuje sumę wszystkich draśnięć z serii, a w trybie debugowania widać rozbicie na poszczególne pociski (łuski).
- **Walidacja**: Dodano blokadę rzutu w `actor-sheet.js`, jeśli broń dystansowa nie ma załadowanej amunicji lub wybranego magazynka.

---

## Aktualny Status:
- **Gotowe**: Pełna mechanika amunicji śrutowej (dystans, limity, sekwencje), poprawione mnożniki serii, walidacja amunicji, persistencja danych śrutu w magazynkach.
- **Do zrobienia**: Automatyzacja nakładania ran na cele na podstawie danych zapisanych we flagach wiadomości czatu (w przyszłości).
