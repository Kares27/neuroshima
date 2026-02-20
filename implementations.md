# Implementacje Systemu Neuroshima 1.5

Szczegółowy opis wprowadzonych zmian i implementacji w systemie.

## 1. Rozdzielenie Amunicji i Magazynków
Zrezygnowano z uniwersalnego przedmiotu `ammunition` na rzecz dwóch dedykowanych typów:
- **Ammo (`ammo`)**: Reprezentuje naboje luzem. Posiada kaliber oraz system nadpisywania statystyk broni (obrażenia, przebicie, zacięcie). Każda statystyka ma oddzielny checkbox aktywujący nadpisanie.
- **Magazine (`magazine`)**: Działa jako kontener na amunicję. Posiada określoną pojemność (`capacity`) i kaliber. Przechowuje amunicję w strukturze stosu (LIFO - Last In, First Out).

## 2. Mechanika Ładowania (Drag & Drop)
- Proces ładowania inicjowany jest poprzez przeciągnięcie amunicji na magazynek w ekwipunku.
- Wywoływany jest dialog `AmmunitionLoadingDialog`, który:
  - Automatycznie oblicza maksymalną liczbę kul możliwą do załadowania (minimum z dostępnej ilości i wolnego miejsca).
  - Ostrzega o niezgodności kalibrów, pozwalając jednak na wymuszenie ładowania.
  - Zabezpiecza przed wprowadzeniem nieprawidłowych wartości (anulowanie rzutu, clampowanie danych).
- Amunicja w magazynku jest przechowywana jako "stosy", co pozwala na mieszanie różnych typów naboi (np. FMJ i AP) w jednym magazynku.

## 3. Mechanika Strzelania i Konsumpcja
- Liczba wystrzelonych pocisków jest obliczana na podstawie szybkostrzelności broni i wybranego trybu ognia (Single/Short/Long/Full).
- System automatycznie ogranicza liczbę wystrzelonych pocisków do aktualnego stanu magazynka. Jeśli gracz próbuje wystrzelić 12 kul, mając tylko 11, rzut zostanie wykonany dla 11 pocisków.
- Statystyki rzutu (obrażenia, przebicie, zacięcie) są pobierane z **pierwszego pocisku**, który opuszcza magazynek w danej serii.
- Amunicja jest usuwana z magazynka od góry stosu (ostatnio załadowane pociski są wystrzeliwane jako pierwsze).

## 4. Rozładowywanie Magazynka
- Gracz może rozładować magazynek jednym kliknięciem.
- **Logika Stosowania**: Podczas powrotu amunicji do ekwipunku, system inteligentnie szuka istniejących stosów. Łączy amunicję tylko wtedy, gdy nazwa, kaliber oraz **wszystkie parametry nadpisywania statystyk** są identyczne. W przeciwnym razie tworzony jest nowy przedmiot w ekwipunku.

## 5. Mechanika Zacięcia (Jamming)
- Zacięcie sprawdzane jest na podstawie **najlepszej (najniższej) pierwotnej kości** rzutu.
- Wartość zacięcia w broni/amunicji (domyślnie 20) stanowi dolną granicę przedziału. Jeśli rzut jest większy lub równy tej wartości (np. 17-20 przy zacięciu 17), broń zacina się.
- Zacięcie powoduje natychmiastowe ustawienie liczby trafień na 0, niezależnie od wyniku testu.
- Informacja o zacięciu jest wyświetlana w stopce karty rzutu zamiast punktów przewagi.

## 7. Specyfika Walki Wręcz (Melee)
- **Mechanika 3k20**: Broń biała zawsze rzuca 3 kości k20, co jest teraz spójne z testami standardowymi.
- **Dystrybucja Umiejętności**: W przeciwieństwie do broni dystansowej, punkty umiejętności w melee stanowią pulę, która jest optymalnie rozdzielana między wszystkie 3 kości, aby uzyskać jak najlepszy wynik.
- **Ujednolicenie Wyników**: Karta rzutu dla wszystkich rodzajów broni wyświetla teraz "Punkty Przewagi" jako główny wskaźnik sukcesu.
  - Dla **testu zamkniętego melee** sukces (2/3 kości) daje 1 punkt przewagi (co oznacza trafienie).
  - Dla **testu otwartego melee** punkty przewagi liczone są jako `target - druga_najlepsza_kość`.
- **Etykiety Kości**: Przywrócono oznaczenia D1, D2, D3 dla wszystkich rodzajów rzutów bronią w celu zachowania spójności.
- **Wyłączenie Zacięcia**: Broń biała nie podlega mechanice zacięcia broni.
