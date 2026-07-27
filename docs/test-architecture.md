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

`TestRunner` pozostaje adapterem zgodności. Nie prowadzi już lifecycle — deleguje
do `test.begin()`, `test.roll()` i `test.finish()`.

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

## Rejestr triggerów

`TriggerRegistry` jest jedynym źródłem listy triggerów dla edytora i silnika.
Udostępnia 55 publicznych triggerów. Historyczne nazwy są aliasami, pozostają
obsługiwane, ale nie są pokazywane przy tworzeniu nowych skryptów.

Triggery przygotowania danych mają `mode: "sync"`. Próba uruchomienia takiego
triggera przez asynchroniczny dispatcher jest błędem kontraktu.
