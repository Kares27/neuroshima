# Melee V2

Melee V2 is an opt-in, GM-authoritative melee engine. Its domain model lives in
`module/combat/melee-system.js`; rendering and declarative editors live in
`module/apps/melee-system-ui.js`.

## Enabling and rollback

Enable **Melee Engine V2** in World Settings and reload Foundry. The setting is
disabled by default. Disable it and reload to return to the legacy engine. No
automatic migration runs when the setting changes, and legacy flags and
`scriptData` remain intact.

## Data ownership

- During Combat, the canonical sessions map is stored in
  `Combat.flags.neuroshima.meleeSessionsV2`.
- Outside Combat, the complete session is stored only on its primary
  `ChatMessage` under `flags.neuroshima.meleeSessionV2`.
- Chat messages used during Combat store only a projection marker:
  `flags.neuroshima.melee.{sessionId, renderedRevision, cardType}`.
- Melee initiative belongs to a single session. V2 never writes
  `Combatant.initiative`.

All mutations pass through `MeleeCommandService` and the single
`dispatchMeleeCommand` socket handler. Commands require an expected revision,
an idempotency key, an active authorized user, a valid phase, exact Activity
identity, available dice, successes, segments and targets.

## Declarative Activities

Open an Item or Active Effect while V2 is enabled and use the crossed-swords
header control. Activities define activation, conditions, outcomes, operations
and automation without JavaScript. Beast action and beast segment Items use the
same editor, catalogue, ledger, runner, effect service and command service.

The stable reference is the pair of `sourceItemUuid`/`sourceEffectUuid` and
`activityId`; display names and costs are never used as identity.

Supported operations include damage, damage modification, effect application
and removal, required tests, initiative transfer, die and target modification,
resource spending/recovery, scheduled outcomes, follow-ups, movement,
engagement end and ChatMessage entries. `legacyScript` is only a compatibility
escape hatch.

## Active Effects

`system.melee` adds `stackKey`, `stackMode`, modifiers, restrictions, expiry
rules and granted Activities. Expiry can react to round, turn, segment,
initiative, action resolution, damage and session events. Applied copies record
session, action and operation provenance and are idempotent.

## Migration

Migration is never automatic. From the console, a GM can inspect without
writes:

```js
game.neuroshima.melee.migration.dryRun()
```

After testing a copy of the world, explicitly migrate with:

```js
await game.neuroshima.melee.migration.migrate({ confirm: true })
```

The migrator preserves legacy data and does not duplicate documents already at
schema version 2.

## Regression suite

The existing test API exposes the document-free suite:

```js
await game.neuroshima.runMeleeV2Tests()
```

It covers the session invariants, dice, segments, per-engagement initiative,
activities, beast identity and costs, condition/operation registries, effect
stacking and expiry, authorization, revision checks, idempotency, retry,
snapshots and migration dry-run.
