# Przegląd V13/V14 i konsolidacja helperów

Data: 2026-11-09. Punkt wyjścia: `39d333c`, wersja systemu 1.0.2.

Przegląd objął moduły JavaScript, modele dokumentów, cykl życia Active Effects,
obszary aur i granatów, rzuty i wiadomości czatu, aplikacje, ustawienia, migracje,
szablony oraz powiązania importów. Dalszy przegląd AE objął odczyt kopii kompendiów
LevelDB; szczegóły znajdują się poniżej. Oryginalne rekordy baz nie były edytowane
w tym audycie.

## Konsolidacja

25 plików w `module/helpers` zastąpiło 6 modułów. Zachowano wszystkie 164
dotychczasowe eksporty nazwane i publiczne klasy udostępniane przez `game.neuroshima`.

| Moduł docelowy | Dotychczasowe pliki |
| --- | --- |
| `foundry-compat.js` | `foundry-compat.js`, `socket-helper.js`, `settings-transfer.js` |
| `item-helper.js` | `gear-types.js`, `armor-durability.js`, `armor-limit.js`, `mod-helpers.js`, `armor-location.js`, `ammunition.js`, `item-reference.js`, `trait-snapshot.js`, `vehicle-crew.js`, `item-tooltip.js` |
| `rolls.js` | `tooltip-renderer.js`, `dialog-script-groups.js`, `choice-router.js`, `rolls.js` |
| `combat-helper.js` | `required-test.js`, `beast-actions.js`, `beast-required-test.js`, `combat-helper.js` |
| `xp.js` | `xp.js`, `speciality.js` |
| `migration.js` | `migration.js`, `document-migrations.js` |

Zaktualizowano importy statyczne i dynamiczne w kodzie oraz testach. Pozostała jedna
implementacja obliczania sum pancerza: `item-helper.js#getArmorRating`;
`CombatHelper.getArmorRating` deleguje do niej. Usuwa to zależność przygotowania
ekwipunku od modułu obsługującego wykonywanie walki.

Makra używające `game.neuroshima` zachowują dotychczasowe nazwy API. Zewnętrzne
makra importujące usunięte pliki bezpośrednio muszą używać ścieżek z tej tabeli.
Szablony HBS i style nie były usuwane ani przebudowywane w tej konsolidacji.

## Poprawione problemy zgodności

1. **Typ modelu przy ponownym stosowaniu AE w V14.** Kopia `actor.system` była
   zwykłym obiektem. Natywne `ActiveEffect.applyChange` wybiera obsługę zależnie
   od obecności modelu i jego pól. Teraz kopia zachowuje typ `DataModel`, schemat
   i przygotowane wartości, a zmiana jest liczona bez modyfikowania aktora.
   Faza `final` pozostaje obsługiwana przez Foundry po przygotowaniu danych.
   [API ActiveEffect V14](https://foundryvtt.com/api/v14/classes/foundry.documents.ActiveEffect.html).
2. **Import bezterminowego efektu V14 do V13.** `start: null` pozostawało jako
   pole formatu V14. Normalizacja usuwa je także dla pustego zegara; wspólne czasy
   nadal trafiają do pól `duration` V13. Nowe, nieodwzorowywalne fazy i zdarzenia
   wygaśnięcia są nadal odrzucane przed zapisem ustawień.
3. **Odwołania do aplikacji ustawień i odczytu drag-and-drop.** Wywołania używają
   `foundry.applications.settings.SettingsConfig` i
   `foundry.applications.ux.TextEditor.getDragEventData`. Obie ścieżki istnieją
   również w V13.
   [SettingsConfig V13](https://foundryvtt.com/api/v13/classes/foundry.applications.settings.SettingsConfig.html),
   [TextEditor V13](https://foundryvtt.com/api/v13/classes/foundry.applications.ux.TextEditor.html).

Nie zmieniano wersji schematu danych: przeniesienie funkcji i powyższe poprawki nie
wprowadzają nowych pól do dokumentów. Manifest zachowuje minimum V13 i zweryfikowaną
wersję V14 z wersji 1.0.2.

## Pozostałe ustalenia

- **Starsza usterka redukcji oczek, wspólna dla V13 i V14:** `system.js` wywołuje
  `NeuroshimaDice.applyTrickDieBonus` oraz `resetTrickDieBonus`, których klasa
  nie definiowała już w `39d333c`. To istniejąca luka funkcjonalna, wymagająca
  podłączenia do kanonicznej mutacji testu i synchronizacji wymiany melee.
  Ponowne wykonanie całego rzutu mogłoby powtarzać jego skutki, więc nie zostało
  użyte jako zastępstwo tych metod podczas przenoszenia helperów.
- W ścieżkach migracji i zapisu modyfikacji pozostają stare operatory usuwania
  `-=...`. V14 nadal je obsługuje przez warstwę zgodności do V16. Konwersja
  operatorów przy scalaniu danych katalogu przedmiotów pozostaje w
  `mergeWithDeletions`; pozostałe miejsca warto ujednolicić przy kolejnej zmianie
  zapisu dokumentów. Nie blokują bieżącej obsługi V14.

## Weryfikacja

- 142 testy automatyczne przechodzą, w tym testy obu generacji API, migracji,
  importu/eksportu, pancerza, zdolności bestii, autoryzacji i synchronizacji melee.
- Kontrola ścieżek obejmuje również istnienie importowanych eksportów, preload
  szablonów, aliasy partiali i zasoby manifestu.
- Wszystkie 140 szablonów kompiluje się kompilatorem Handlebars 4.7.9 z lokalnej
  instalacji Foundry.
- Import `system.js` i wszystkich 78 modułów przechodzi na natywnym frameworku
  V14 w lokalnym środowisku testowym. Sam import systemu nie emituje ostrzeżeń.
- Natywny test przeliczenia AE zwrócił 8 z bazy 4 i mnożnika 2, zachował typ modelu
  oraz nie zmienił danych aktora.

Natywne próby wykonano na niezapisanych obiektach i lokalnym serwerze plików,
bez uruchamiania ani zmieniania świata. Nie obejmują pełnej sesji gry, odłączania
okien, ruchu tokenów ani pracy z zewnętrznymi modułami. Natywny runtime V13 nie był
uruchamiany w tej sesji; jego kontrakty są objęte testami automatycznymi.

## Uzupełnienie: Active Effects, kompendia i czas

Kopia bazy `items` zawierała 368 itemów, 58 folderów i 219 osadzonych AE.
Razem z 54 efektami w zapisanych wyborach cech sprawdzono 273 definicje efektów
i 12 unikalnych skryptów czasu: m.in. Totem, Maszynę do zabijania, Powrót na
ziemię, Hemofilię i leki. Kopia Bestiariusza była pusta.

Poprawiono następujące ścieżki:

- `convertToApplied()` normalizuje nadpisania oddzielnie od szablonu. Wcześniej
  natywne `duration.value` i `system.changes` w V14 mogły przesłonić nadpisania
  `duration.seconds` i `changes`. Nowa kopia otrzymuje aktualny początek;
  jawny początek ze skryptu ma pierwszeństwo. V13 nie dziedziczy starej walki.
- W V14 wygasza natywny rejestr z `CONFIG.ActiveEffect.expiryAction = "delete"`.
  Usunięto równoległe kasowanie w `Actor.onUpdateEffectDurations`: callback
  następuje przed oznaczeniem wygaśnięcia. Skrypt czasu nie próbuje ponownie
  usuwać efektu już usuwanego przez rejestr. Efekt z `duration.expired` nie
  uruchamia zwykłych modyfikatorów dialogu.
- `this.effectTime(effect?)` zwraca `{ startTime, seconds, remaining, elapsed }`
  w sekundach dla efektów czasowych na obu generacjach. Rundy/tury bez przelicznika
  zachowują licznik walki, a `seconds` ma wtedy wartość `null`.
  Helper zachowuje zero jako początek i ujemny czas
  pozostały, potrzebny do obliczania przekroczenia czasu aktywności. Proste
  starsze odczyty czasu oraz stałe trybów zmian są konwertowane podczas
  przygotowania skryptu i przez istniejącą migrację jego treści.
- Pięć natywnych definicji używa `turnStart`. Przy konwersji do V13 zdarzenie
  z określonym czasem zachowuje `flags.neuroshima.durationExpiry`: poza walką
  wygasa według zegara, w walce na początku tury odbiorcy po upływie czasu.
  Przy powrocie do V14 odtwarzane jest `duration.expiry`. Inne nieodwzorowywalne
  zdarzenia i fazy nadal są odrzucane. Import konfiguracji warunków ze
  zdarzeniami natywnymi do V13 pozostaje niedostępny.
- Odświeżanie efektu w melee ponownie uruchamia jego zegar, zamiast kopiować
  długość trwania z poprzednim początkiem.
- Zmiany czasu wykonuje aktywny MG, a wywołania systemowe są kolejkowane.
  Mostek niezależnego kalendarza uwzględnia itemy i niezależne tokeny wszystkich
  scen, nie uruchamia szablonów bez początku, obsługuje cofanie czasu i odświeża
  rejestr V14. Wyłączenie efektu nie zatrzymuje czasu. Systemowe wygaszanie
  ustępuje aktywnemu modułowi Times Up.

Wskaźniki `CURRENT` Bestiariusza i makr miały końce linii CRLF, które LevelDB
interpretował jako część nazwy manifestu. Odczyt kopii działał po przywróceniu
LF (Bestiariusz: 0 rekordów, makra: 6 rekordów). Naprawiono tylko te wskaźniki;
`.gitattributes` zapobiega konwersji końców linii plików kompendiów przez Git.
Oryginalnych rekordów efektów nie przepisywano narzędziem bazodanowym.

Nie podniesiono numeru schematu: zgodność działa przy odczycie skryptu,
konwersji efektu oraz w istniejącym mechanizmie migracji dokumentów i importów.
Nie trzeba ręcznie ponownie importować całego kompendium.

Weryfikacja dodatkowa:

- 154 testy automatyczne, w tym wykonanie rzeczywistych skryptów Totemu,
  Powrotu na ziemię, zmęczenia i leków na danych V13/V14. Sprawdzono też
  cofanie czasu, start w chwili zero, odświeżanie melee, oczekiwanie na turę
  odbiorcy, migrację metadanych i ochronę przed podwójnym usuwaniem.
- Wszystkie 273 definicje przeszły ścisłą konstrukcję, przygotowanie i nakładanie
  z nadpisaniem czasu na natywnym API V14.369, bez ostrzeżeń zgodności.
- Normalizacja tych samych 273 definicji do V13 nie zgłosiła błędów i zachowała
  wszystkie pięć zdarzeń `turnStart`.
- Natywny rejestr V14 zlecił jedną operację usunięcia wygasłego efektu; kolejne
  odświeżenie nie zleciło drugiej. Backend zastąpiono rejestratorem operacji,
  więc próba nie zmieniała świata.

Nie uruchamiano pełnej sesji z graczami i modułem kalendarza. Tryb „none”
celowo nie zmienia zegara Foundry ani flag użytkownika. Dlatego skrypty Totemu
i Hemofilii bazujące na `game.time.worldTime` lub flagach czasu wymagają
połączenia kalendarza z czasem świata. Wiek samego AE można mierzyć przez
`this.effectTime().elapsed`, również przy mostku czasu. Konwersja starszych
odczytów dotyczy prostych dostępów przez kropkę; dostęp przez nawiasy należy
przepisać na helper.

Podstawa API: [EffectDurationData V14](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.EffectDurationData.html)
i [ActiveEffectRegistry V14](https://foundryvtt.com/api/v14/classes/foundry.helpers.ActiveEffectRegistry.html).
