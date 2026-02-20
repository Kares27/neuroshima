# Log zmian w mechanice rzutów (Neuroshima 1.5)

Ten dokument szczegółowo opisuje proces refaktoryzacji mechaniki rzutów, rzutów bronią oraz optymalizacji logiki testów w systemie Neuroshima 1.5.

## 1. Refaktoryzacja Walki Wręcz (Melee)
- **Problem**: Walka wręcz rzucała pojedynczą kością, zamiast stosować standardowy test 3k20 (Neuroshima 1.5).
- **Rozwiązanie**: Przebudowano metodę `rollWeaponTest` tak, aby dla broni typu `melee` zawsze rzucane były 3 kości.
- **Dystrybucja Umiejętności**: Wprowadzono logikę puli punktów umiejętności.
  - W **teście zamkniętym**: Punkty są najpierw wydawane na "dokupienie" sukcesów na kościach, które ich nie mają. Jeśli po uzyskaniu sukcesów (min. 2 kości) zostaną punkty, są one rozdzielane równomiernie na kości sukcesu, aby obniżyć ich wyniki (poprawa estetyki rzutu i optymalizacja mechaniczna).
  - W **teście otwartym**: Ignorowana jest najwyższa kość, a punkty umiejętności są wydawane najpierw na wyrównanie gorszej kości do poziomu lepszej, a następnie na obniżanie obu równomiernie.

## 2. Dynamiczny Suwak (Skill Shift)
- **Poprzednio**: Przesunięcie trudności (Suwak) było na sztywno przypisane do wartości 4, 8 i 12 umiejętności.
- **Zmiana**: Funkcja `getSkillShift` została zrefaktoryzowana na wzór dynamiczny: `floor(Umiejętność / 4)`. Pozwala to na skalowanie przesunięcia trudności powyżej wartości 12 (np. Skill 16 daje -4 stopnie trudności).

## 3. Poprawki w Broni Dystansowej
- **Zacięcie (Jamming)**: Upewniono się, że zacięcie jest zawsze liczone z **pierwotnej (najlepszej) kości**, a nie po modyfikacji przez umiejętność. Zapobiega to sytuacji, w której wysoka umiejętność niwelowałaby ryzyko zacięcia broni.
- **Punkty Przewagi**: Wprowadzono ujednolicone nazewnictwo na kartach czatu.
  - Test zamknięty: Sukces = 1 Punkt Przewagi.
  - Test otwarty: Punkty Przewagi = Próg Sukcesu - Zmodyfikowany Wynik Kości.
- **Trafienia w serii**: Liczba trafionych pocisków w serii jest teraz obliczana jako `Math.clamp(Punkty Przewagi + 1, 1, Liczba Wystrzelonych)`. Obliczenia te bazują na zmodyfikowanym wyniku kości (po odjęciu umiejętności).

## 4. Naprawa Błędów i Optymalizacja
- **ReferenceError (isJamming)**: Naprawiono błąd w `reEvaluateWeaponRoll`, gdzie zmienna `isJamming` była używana przed jej inicjalizacją podczas przełączania typu testu na czacie.
- **Logi Debugowania**: Do wszystkich kluczowych metod w `dice.js` dodano obszerne logi diagnostyczne, które uruchamiają się tylko przy włączonym ustawieniu `debugMode`. Logi są pogrupowane (`console.group`), co ułatwia analizę przebiegu rzutu.
- **Komentowanie Kodu**: Dodano komentarze w języku polskim wyjaśniające każdy krok algorytmu rozdzielania punktów umiejętności i obliczania sukcesów.

## 5. Zmiany w UI i Prezentacji
- **Karta Czatu**: Wszystkie rzuty bronią wyświetlają teraz "Punkty Przewagi" zamiast "Sukcesy".
- **Dialog Rzutu**: `NeuroshimaWeaponRollDialog` dynamicznie dostosowuje swój wygląd. Dla walki wręcz suwaki celowania i serii są ukryte, a wartość "Rzucane kości" jest na sztywno ustawiona na 3.
- **Menu Kontekstowe**: Przywrócono i naprawiono funkcję zmiany typu rzutu (Otwarty/Zamknięty) na wiadomościach czatu dla broni, co pozwala MG na dynamiczną reakcję na wynik rzutu.
