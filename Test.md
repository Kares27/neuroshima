Poniżej masz jedną spójną instrukcję krok po kroku, pod Foundry v13 i Application v2, w układzie bardzo podobnym do WFRP: efekty na Actorze, efekty na Itemach, transfer z Itema na Aktora, oraz triggery skryptów.

Na końcu masz konkretny przykład: jak oskryptować ignorowanie testu Odporność na ból, gdy postać ma Lekkie rany albo jest pod wpływem dragów.

---

## Cel architektury

Chcesz mieć dwa poziomy jak w WFRP:

1. Klasyczne Active Effects, które modyfikują pola `system.*` aktora i itemów.

2. Scripted Effects, czyli skrypty na efektach, które odpalają się na triggerach typu: preTest, postTest, preApplyDamage itd.

3. Transfer efektów z Itemów na Aktora, np. gdy broń jest equipped albo gdy “drugs” item jest aktywny.

---

## Krok 1. Dodaj pliki helperów do efektów

### 1A. Utwórz `module/helpers/effects.js`

Ten plik to “silnik triggerów” dla skryptów w efektach.

Ważne założenie: skrypt ma dostać obiekt `args`, i ma móc zmieniać `args.fields` albo ustawić `args.abort = true`.

```js
// systems/neuroshima/module/helpers/effects.js
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export class NeuroshimaEffects {
  static getActiveEffects(actor) {
    return actor?.effects?.filter(e => e.enabled && !e.isSuppressed) ?? [];
  }

  static getScripts(effect, trigger) {
    const scripts = effect.getFlag("neuroshima", "scriptData") ?? [];
    return scripts.filter(s => s?.trigger === trigger && s?.script);
  }

  static async run(trigger, args) {
    const actor = args?.actor;
    if (!actor) return args;

    for (const effect of this.getActiveEffects(actor)) {
      const scripts = this.getScripts(effect, trigger);
      for (const s of scripts) {
        const fn = new AsyncFunction("args", "actor", "effect", "item", s.script);
        await fn(args, actor, effect, args.item ?? null);
        if (args.abort) return args;
      }
    }
    return args;
  }

  static runSync(trigger, args) {
    const actor = args?.actor;
    if (!actor) return args;

    for (const effect of this.getActiveEffects(actor)) {
      const scripts = this.getScripts(effect, trigger);
      for (const s of scripts) {
        const fn = new Function("args", "actor", "effect", "item", s.script);
        fn(args, actor, effect, args.item ?? null);
        if (args.abort) return args;
      }
    }
    return args;
  }
}
```

### 1B. Utwórz `module/helpers/effects-transfer.js`

To jest “Equip Transfer” w stylu WFRP.

```js
// systems/neuroshima/module/helpers/effects-transfer.js
export class NeuroshimaEffectsTransfer {
  static async syncItemEffects(actor, item, enabled) {
    const transferable = (item.effects?.contents ?? [])
      .filter(e => e.getFlag("neuroshima", "transferOnEquip"))
      .map(e => e.toObject());

    const origin = item.uuid;

    if (enabled) {
      const toCreate = transferable.map(e => {
        e.origin = origin;
        e.flags = e.flags || {};
        e.flags.neuroshima = e.flags.neuroshima || {};
        e.flags.neuroshima.fromItemId = item.id;
        return e;
      });

      if (toCreate.length) {
        await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
      }
    } else {
      const toDelete = actor.effects
        .filter(e => e.origin === origin || e.getFlag("neuroshima", "fromItemId") === item.id)
        .map(e => e.id);

      if (toDelete.length) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      }
    }
  }
}
```

---

## Krok 2. Zarejestruj helpery w `system.js`

W Twoim `system.js` dodaj importy i podpięcie pod `game.neuroshima`.

Wystarczy raz, w `Hooks.once("init")` lub zaraz po tworzeniu namespace.

```js
import { NeuroshimaEffects } from "./module/helpers/effects.js";
import { NeuroshimaEffectsTransfer } from "./module/helpers/effects-transfer.js";

Hooks.once("init", () => {
  game.neuroshima = game.neuroshima || {};
  game.neuroshima.effects = NeuroshimaEffects;
  game.neuroshima.effectsTransfer = NeuroshimaEffectsTransfer;
});
```

---

## Krok 3. Dodaj triggery do rzutów w `dice.js`

Masz dwa główne pipeline, więc to mapuje się idealnie do WFRP.

### 3A. `rollTest` w `/mnt/data/dice.js`

Dodaj na samym początku `args` i odpal `preTest`.

Potrzebujesz też sposobu na przerwanie testu, więc ustalamy standard: jeśli `args.abort === true`, to kończymy i zwracamy `null`.

Schemat:

```js
let args = {
  actor,
  item: null,
  context: {
    testKey: options.testKey || null,
    isPainResistance: options.isPainResistance || false
  },
  fields: {
    stat,
    skill,
    skillBonus,
    attributeBonus,
    penalties,
    isOpen,
    isCombat
  },
  abort: false
};

await game.neuroshima.effects.run("preTest", args);

if (args.abort) return null;

// potem licz finalSkill finalStat na bazie args.fields
// po rzucie odpal postTest
await game.neuroshima.effects.run("postTest", { actor, rollData, context: args.context, item: null });
```

Najważniejsze jest `context.testKey` i `context.isPainResistance`, bo na tym będziesz opierał skrypty.

### 3B. `rollWeaponTest` w `/mnt/data/dice.js`

Analogicznie, tylko `item: weapon` i trigger `preWeaponTest` oraz `postWeaponTest`.

To masz już dobrze opisane w poprzedniej wiadomości, więc tu nie powielam całego bloku.

---

## Krok 4. Dodaj triggery do obrażeń w `combat-helper.js`

Masz centralne miejsce: `applyDamage` w `/mnt/data/combat-helper.js`.

Dodaj:

1. `preApplyDamage` przed utworzeniem ran.
2. `postApplyDamage` po utworzeniu ran.
3. osobny trigger dla “czy w ogóle odpalić odporność na ból”, najlepiej `prePainResistance`.

### 4A. Modyfikacja w `applyDamage`

Tuż przed `await actor.createEmbeddedDocuments("Item", woundsToCreate)` dodaj:

```js
let dmgArgs = {
  actor,
  item: null,
  context: { source: "applyDamage" },
  fields: { woundsToCreate },
  abort: false
};

await game.neuroshima.effects.run("preApplyDamage", dmgArgs);

if (dmgArgs.abort) return;

woundsToCreate = dmgArgs.fields.woundsToCreate;
```

Po utworzeniu ran:

```js
await game.neuroshima.effects.run("postApplyDamage", {
  actor,
  context: { source: "applyDamage" },
  fields: { createdCount: woundsToCreate.length }
});
```

### 4B. Modyfikacja w `triggerPainResistance`

W Twoim pliku już jest `triggerPainResistance(actor)`.

Zrób w nim na początku:

```js
let prArgs = {
  actor,
  context: { isPainResistance: true, testKey: "painResistance" },
  abort: false
};

await game.neuroshima.effects.run("prePainResistance", prArgs);

if (prArgs.abort) return null;
```

I dopiero potem odpal `NeuroshimaDice.rollTest`, ale koniecznie przekaż kontekst:

```js
return game.neuroshima.NeuroshimaDice.rollTest({
  skill: skillValue,
  stat: statValue,
  label: game.i18n.localize("NEUROSHIMA.Skills.painResistance"),
  actor: actor,
  isOpen: false,
  testKey: "painResistance",
  isPainResistance: true
});
```

To jest klucz, bo dzięki temu efekty mogą reagować na sam test, nawet jeśli odpalisz go w innym miejscu w przyszłości.

---

## Krok 5. Transfer efektów z Itemów na Aktora

W stylu WFRP: item ma efekty, ale realnie działają na actorze jako applied effects.

### 5A. Hook na equip

W `system.js` dodaj:

```js
Hooks.on("updateItem", async (item, changes) => {
  const actor = item.actor;
  if (!actor) return;

  if (!foundry.utils.hasProperty(changes, "system.equipped")) return;

  const equipped = item.system.equipped;
  await game.neuroshima.effectsTransfer.syncItemEffects(actor, item, equipped);
});
```

### 5B. Hook na “aktywny item”, np. dragi

Jeśli dragi są itemem typu `trick` albo `gear` i mają pole `system.isActive`, dodaj analogiczny hook:

```js
Hooks.on("updateItem", async (item, changes) => {
  const actor = item.actor;
  if (!actor) return;

  if (!foundry.utils.hasProperty(changes, "system.isActive")) return;

  const active = item.system.isActive;
  await game.neuroshima.effectsTransfer.syncItemEffects(actor, item, active);
});
```

I wtedy w efektach na itemie ustawiasz `flags.neuroshima.transferOnEquip = true`, nawet jeśli to nie equip tylko isActive. Nazwa flagi nie musi być idealna, ważne żeby była spójna.

---

## Krok 6. Dodaj zakładkę Effects na Actor sheet

Czy musisz dodawać zakładkę Effects obok Notes?

Nie musisz, bo efekty da się zarządzać z poziomu Foundry przez panel efektów aktora i itemów, ale to jest słabo wygodne dla graczy.

Jeśli chcesz układ jak w WFRP, to tak, warto dodać zakładkę.

### 6A. Zmień `actor-sheet.js`

W `static TABS` dodaj:

* `{ id: "effects", group: "primary", label: "NEUROSHIMA.Tabs.Effects" }`

Najlepiej jako ostatnią po notes.

W `static PARTS` dodaj:

* `effects: { template: "systems/neuroshima/templates/actor/parts/actor-effects.hbs" }`

### 6B. Dodaj template `actor-effects.hbs`

Najprościej skopiować podejście z item-effects, tylko dla aktora.

Minimalny widok:

* lista `actor.effects`
* przyciski create, edit, delete

W AppV2 zwykle robisz to przez `data-action` i handlers w `actions`.

W Twoim actor-sheet masz już `actions: { ... }`, więc dodajesz:

* `createEffect`
* `editEffect`
* `deleteEffect`
* `toggleEffect`

I w implementacji używasz standardowych metod dokumentu:

* `this.document.createEmbeddedDocuments("ActiveEffect", [data])`
* `effect.sheet.render(true)`
* `this.document.deleteEmbeddedDocuments("ActiveEffect", [id])`
* `effect.update({ disabled: !effect.disabled })`

To będzie działać od razu i nie będzie nieprzyjazne.

---

## Krok 7. Przykład: ignorowanie testów Odporność na ból przy Lekkich ranach albo dragach

Masz dwa sensowne podejścia.

### Podejście A. Efekt na Actorze, który sam wykrywa lekkie rany

Tworzysz ActiveEffect na actorze, np. “Znieczulenie” albo “Szok”.

W nim ustawiasz `flags.neuroshima.scriptData`:

Trigger: `prePainResistance`

Script:

```js
// jeśli aktor ma aktywną lekką ranę, to pomiń test
const hasLight = actor.items.some(i =>
  i.type === "wound" &&
  i.system?.isActive &&
  i.system?.damageType === "L"
);

if (hasLight) {
  args.abort = true;
}
```

Efekt może być nadawany np. przez GM ręcznie, albo przez jakiś inny skrypt.

### Podejście B. “Drugs” jako item z efektem, transferowany na aktora

1. Tworzysz item “Dragi: Lekkie znieczulenie”.
2. W zakładce Effects tego itema dodajesz ActiveEffect.
3. W ActiveEffect ustawiasz flagę:

   * `flags.neuroshima.transferOnEquip = true`
4. W `flags.neuroshima.scriptData` dajesz:

Trigger: `prePainResistance`

Script:

```js
args.abort = true;
```

5. Sterujesz itemem przez `system.isActive` lub equip, a hook zrobi transfer efektu.

To jest najbardziej podobne do WFRP: item ma efekt, a aktor dostaje applied effect dopiero gdy item jest aktywny.

---

## Co warto dodać do dokumentów, żeby to było wygodne i stabilne

1. Konwencja `args` dla triggerów:

* `actor`
* `item`
* `context`
* `fields`
* `abort`

2. Dwa triggery specjalne pod pain resistance:

* `prePainResistance` do blokowania rzutu
* `preTest` z `context.testKey === "painResistance"` jako fallback

3. Flagi na ActiveEffect:

* `flags.neuroshima.transferOnEquip` boolean
* `flags.neuroshima.scriptData` tablica `{trigger, label, script}`
* opcjonalnie później `flags.neuroshima.enableScript` jako skrypt warunkowy

---

Jeśli chcesz, mogę Ci teraz podać konkretną propozycję listy triggerów w Twoim systemie, dokładnie w formie tabeli jak w WFRP, wraz z opisem kiedy się odpalają i jakie pola są w `args.fields` dla każdego. To bardzo pomaga, żeby potem nie łamać kompatybilności efektów.
