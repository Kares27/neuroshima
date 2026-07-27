# Architektura testów

Publicznym wejściem nowego silnika jest konkretna klasa testu:

```js
const test = NeuroshimaTestFactory.create({
  type: "weapon",
  subtype: "ranged",
  actor,
  item: weapon,
  preData
});

await test.roll();
```

Historyczne `NeuroshimaDice.rollWeaponTest(params)` jest cienkim adapterem:
wybiera klasę przez `NeuroshimaTestFactory` i przekazuje płaski kontrakt do
`WeaponTest.rollFromLegacy()`. Dialogi i makra zachowują dzięki temu zgodność,
ale nie prowadzą lifecycle ani nie wybierają implementacji ranged/melee.

`TestRunner` pozostaje adapterem zgodności. Nie prowadzi już lifecycle — deleguje
do `test.begin()`, `test.roll()` i `test.finish()`.
Kod produkcyjny nie korzysta z niego; pozostaje wyłącznie dla zewnętrznych
integracji importujących wcześniejsze API.

## Hierarchia

```text
NeuroshimaTestBase
├── NeuroshimaTest (3k20)
│   ├── AttributeTest
│   ├── SkillTest
│   │   └── HealingTest
│   ├── InitiativeTest
│   └── AttackTest
│       ├── WeaponTest
│       │   ├── RangedWeaponTest
│       │   └── MeleeWeaponTest
│       └── GrenadeTest
└── PercentileTest
    └── ReputationTest
```

Każda klasa udostępnia stabilne `classId`. Rodzaj testu w skrypcie należy
sprawdzać przez:

```js
if (args.test.classId !== "rangedWeapon") return;
```

## Lifecycle

```text
runPreEffects()
→ prepare()
→ rollDice()
→ computeResult()
→ runPostEffects()
→ transformacje
→ akcje wyniku
→ recalculate()
→ postTest()
→ commitSideEffects()
```

`computeResult()` i `recalculate()` nie mogą aktualizować dokumentów.
Aktualizacje należy kolejkować przez `test.sideEffects` i zatwierdzać dopiero
w `commitSideEffects()`.

## Triggery testów

Zwykły test:

```text
preRollTest → rzut → rollTest
```

Test broni:

```text
preRollTest → preRollWeaponTest → rzut
→ rollTest → rollWeaponTest
```

Kolejność testu broni wynika z dziedziczenia `WeaponTest`, nie z warunków
w runnerze.

## Serializacja

Karta czatu zapisuje `flags.neuroshima.test`:

```js
{
  classId,
  actorUuid,
  itemUuid,
  targetUuids,
  type,
  subtype,
  preData,
  rollData,
  context
}
```

Odtworzenie:

```js
const test = await NeuroshimaTestFactory.fromData(
  message.getFlag("neuroshima", "test")
);
await test.recalculate();
```

Starsze karty bez tego flagowania nadal korzystają z adaptera danych rzutu.

## Przeliczanie domenowe

`recalculate()` jest polimorficzne:

- `NeuroshimaTest` ponownie oblicza test 3k20,
- `ReputationTest` ponownie oblicza test 1k100,
- `InitiativeTest` ponownie uwzględnia synchroniczny `getInitiativeFormula`,
- `RangedWeaponTest` ponownie oblicza sukces, PP, zacięcie, pociski i śrut,
- `MeleeWeaponTest` ponownie oblicza pulę uczestnika,
- `GrenadeTest` ponownie oblicza margines porażki, odchylenie i strefy wybuchu.

Akcja wyniku odtwarza klasę z flagi wiadomości, wykonuje skrypt na rzeczywistym
`args.test`, a następnie wywołuje:

```js
await test.recalculate();
await test.applyResultOverrides();
```

Nie wybiera już globalnego przelicznika na podstawie szablonu karty.

## Skutki uboczne broni

Aktualizacje magazynka, amunicji i stanu zacięcia są kolejkowane. Warunek
zużycia amunicji jest sprawdzany dopiero podczas zatwierdzenia względem
finalnego, przeliczonego wyniku:

```text
rzut
→ triggery wyniku
→ akcje wyniku
→ recalculate()
→ ostateczny stan zacięcia
→ commitSideEffects()
```

Zmiana kości na karcie nie może więc drugi raz zużyć amunicji, a zacięcie
wywołane przez końcową zmianę kości blokuje zaplanowane zużycie.

## Rejestr triggerów

`TriggerRegistry` jest jedynym źródłem listy triggerów dla edytora i silnika.
Udostępnia 55 publicznych triggerów. Historyczne nazwy są aliasami, pozostają
obsługiwane, ale nie są pokazywane przy tworzeniu nowych skryptów.

Triggery przygotowania danych mają `mode: "sync"`. Próba uruchomienia takiego
triggera przez asynchroniczny dispatcher jest błędem kontraktu.

## Przygotowanie dokumentów

Actor wykonuje synchronicznie:

```text
prePrepareData
→ prePrepareItems
→ computeCharacteristics
→ computeEncumbrance
→ preWoundCalc
→ woundCalc
→ calculateSize
→ preAPCalc
→ APCalc
→ prepareData
```

Owned Item wykonuje `prePrepareItem → prepareItem → prepareOwned`. Argument
`preparedData` wskazuje na przygotowywany model w pamięci. W tych triggerach nie
wolno aktualizować dokumentów ani używać operacji asynchronicznych.

## Test przeciwstawny

`MeleeOpposedResolver` składa dwa zakończone `MeleeWeaponTest`. Nie rzuca kośćmi.
Przed porównaniem wykonuje `preOpposedAttacker` i `preOpposedDefender`, po
porównaniu `opposedAttacker` i `opposedDefender`. Osobna metoda
`calculateDamage()` uruchamia `calculateOpposedDamage`.

Starsze karty, które zawierają płaskie `rollData`, są przed rozstrzygnięciem
odtwarzane jako konkretne klasy testów.

Pełny system pojedynku segmentowego pozostaje rozszerzeniem Neuroshimy:
operuje na utrwalonym stanie wielu segmentów, a nie na jednej parze testów.
Klasyczny atak przeciwstawny i obrona z kart czatu korzystają z
`MeleeOpposedResolver`; stanowy silnik pojedynku zachowuje odpowiadające mu
granice lifecycle przez `DuelLifecycle`.

## Migracja triggerów

Migracja schematu 1.5 przepisuje jednoznaczne stare nazwy na identyfikatory
kanoniczne. Triggery o historycznie odmiennym kontrakcie argumentów pozostają
pod starą nazwą i są obsługiwane przez adapter. `auditEffectTriggers()` zwraca
raport wszystkich pozostałych aliasów.
