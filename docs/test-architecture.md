# Architektura testów

Wszystkie testy znajdują się w `module/tests.mjs`. Kod wywołujący wybiera konkretną
klasę przed utworzeniem testu:

```js
const test = new SkillTest({
  preData: {
    stat: 12,
    skill: 4,
    penalties: { mod: 0 }
  }
}, actor);

await test.roll();
```

Hierarchia:

```text
NeuroshimaTestBase
├── NeuroshimaTest
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

`MeleeOpposedResolver` łączy dwa gotowe testy i nie jest typem rzutu.

## Dane i zapis

Test ma dokładnie trzy sekcje:

```js
{
  preData: {}, // wejście, modyfikatory i UUID dokumentów
  result: {},  // wynik, kości, sukcesy, obrażenia i tooltip
  context: {}  // stan wykonania: reroll, edited, dirty i rollMode
}
```

Karta czatu zapisuje wyłącznie `flags.neuroshima.test`. Klasa jest wskazana przez
`preData.rollClass`. Odtworzenie karty nie używa fabryki:

```js
const test = await NeuroshimaTestBase.recreate(
  message.getFlag("neuroshima", "test")
);
```

`recreate()` odczytuje klasę ze statycznej przestrzeni `game.neuroshima.tests`
i odtwarza dokumenty z UUID.

## Lifecycle

```text
preRollTest
preRollWeaponTest (tylko broń)
prepare
rollDice
computeResult
resolveDomain
rollTest
rollWeaponTest (tylko broń)
recalculate (tylko gdy test jest dirty)
postTest
sendToChat
```

`recalculate()` nie uruchamia triggerów i nie aktualizuje dokumentów. Skutki
pierwszego rzutu, takie jak zużycie amunicji lub granatu, należą do `postTest()`.
Edycja i przerzut ustawiają odpowiednio `context.edited` lub `context.reroll`,
więc nie zużywają zasobów ponownie.

## Active Effects

Każdy trigger testu otrzymuje jeden kontrakt:

```js
{
  actor,
  item,
  test,
  context,
  eventContext
}
```

Skrypt czyta i modyfikuje `args.test.preData`, `args.test.result` albo korzysta
z metod testu: `replaceDie`, `addSuccesses`, `addSuccessPoints`, `forceSuccess`,
`forceFailure` i `addAnnotation`. Zmiany wyniku oznaczają test jako `dirty`, po czym
pipeline wykonuje jedno kontrolowane przeliczenie.

## Chat, edycja i przerzut

Wszystkie klasy korzystają z `NeuroshimaChatMessage.renderTest()`. Dane tooltipa
pochodzą z `test.getDataTooltip()`. Menu kontekstowe odtwarza rzeczywistą klasę
i wywołuje `test.edit()`, `test.reroll()` lub metody `RangedWeaponTest`.
