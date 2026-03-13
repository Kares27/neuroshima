# Testowanie NeuroshimaChatMessage API

## Szybki Test w Konsoli Foundy

### 1. Test renderRoll (Test umiejętności)

```javascript
// W konsoli gry Foundry:
const actor = game.actors.contents[0]; // Pobierz pierwszego aktora

const testData = {
  label: "Test czołgania",
  stat: 15,
  skill: 8,
  skillBonus: 0,
  attributeBonus: 0,
  baseStat: 15,
  baseSkill: 8,
  penalties: { mod: 0, wounds: 0, armor: 0 },
  totalPenalty: 0,
  baseDifficultyLabel: "NEUROSHIMA.Difficulties.Average",
  difficultyLabel: "NEUROSHIMA.Difficulties.Average",
  target: 15,
  isOpen: false,
  isCombat: false,
  isDebug: false,
  rawResults: [10, 14, 8],
  modifiedResults: [
    { original: 10, modified: 2, index: 0, isSuccess: true, isNat1: false, isNat20: false, ignored: false },
    { original: 14, modified: 14, index: 1, isSuccess: false, isNat1: false, isNat20: false, ignored: false },
    { original: 8, modified: 8, index: 2, isSuccess: true, isNat1: false, isNat20: false, ignored: false }
  ],
  isSuccess: true,
  successPoints: 2
};

const roll = new Roll("3d20");
await roll.evaluate();

// Renderuj kartę
await game.neuroshima.NeuroshimaChatMessage.renderRoll(testData, actor, roll);
```

**Oczekiwany wynik:** Na czacie pojawia się karta testu z wynikami kości.

---

### 2. Test renderWeaponRoll (Test broni)

```javascript
const actor = game.actors.contents[0];
const token = canvas.tokens.placeables[0];
const weapon = actor.items.find(i => i.type === "weapon");

const weaponData = {
  label: weapon.name,
  actionLabel: "NEUROSHIMA.Roll.RangedAttack",
  isMelee: false,
  weaponId: weapon.id,
  actorId: actor.id,
  difficulty: "average",
  difficultyLabel: "NEUROSHIMA.Difficulties.Average",
  stat: 12,
  skill: 6,
  skillBonus: 0,
  attributeBonus: 0,
  baseStat: 12,
  baseSkill: 6,
  penalties: { base: 20, mod: 0, armor: 0, wounds: 0, location: 0 },
  totalPenalty: 20,
  target: 12,
  isOpen: false,
  isSuccess: true,
  successPoints: 3,
  bulletsFired: 3,
  hitBullets: 2,
  hitBulletsData: [
    { damage: "L", successPoints: 2, isPellet: false },
    { damage: "L", successPoints: 1, isPellet: false }
  ],
  totalPelletSP: 0,
  isPellet: false,
  isJamming: false,
  distance: 25,
  damage: "L",
  burstLevel: 1,
  aimingLevel: 0,
  finalLocation: "torso",
  locationRoll: null,
  locationLabel: "NEUROSHIMA.HitLocations.Torso",
  debugMode: false,
  results: [9, 15, 7],
  modifiedResults: [
    { original: 9, modified: 3, index: 0, isSuccess: true, isNat1: false, isNat20: false, isBest: true },
    { original: 15, modified: 15, index: 1, isSuccess: false, isNat1: false, isNat20: false },
    { original: 7, modified: 7, index: 2, isSuccess: true, isNat1: false, isNat20: false }
  ],
  bulletSequence: [
    { name: "9x19mm", damage: "L", piercing: 3, jamming: 20, isPellet: false, pelletCount: 1 }
  ],
  magazineId: null,
  ammoId: null
};

const roll = new Roll("3d20");
await roll.evaluate();

await game.neuroshima.NeuroshimaChatMessage.renderWeaponRoll(weaponData, actor, roll);
```

**Oczekiwany wynik:** Na czacie pojawia się karta ataku z sekcją aplikacji obrażeń.

---

### 3. Test renderPainResistance (Test odporności)

```javascript
const actor = game.actors.contents[0];

const results = [
  {
    name: "Wbita kula",
    isPassed: true,
    penalty: 15,
    difficulty: "NEUROSHIMA.Difficulties.Problematic",
    target: 15,
    skill: 0,
    successPoints: 3,
    modifiedResults: [
      { original: 8, modified: 8, index: 0, isSuccess: true, isNat1: false, isNat20: false, ignored: false },
      { original: 12, modified: 12, index: 1, isSuccess: true, isNat1: false, isNat20: false, ignored: false },
      { original: 6, modified: 6, index: 2, isSuccess: true, isNat1: false, isNat20: false, ignored: false }
    ]
  }
];

const woundIds = ["item-id-1"];

await game.neuroshima.NeuroshimaChatMessage.renderPainResistance(actor, results, woundIds);
```

**Oczekiwany wynik:** Na czacie pojawia się raport odporności na ból z podsumowaniem i listą ran.

---

## Testy w Przeglądarce DevTools

### Test 1: Sprawdzenie Flags

```javascript
// Pobierz ostatnią wiadomość
const msg = game.messages.contents[game.messages.contents.length - 1];

// Sprawdź typ
console.log("messageType:", msg.messageType);
console.log("rollData:", msg.rollData);
console.log("isRollMessage:", msg.isRollMessage);
console.log("isPainResistanceReport:", msg.isPainResistanceReport);
```

### Test 2: Sprawdzenie HTML

```javascript
const msg = game.messages.contents[game.messages.contents.length - 1];
const html = msg.content;

// Powinny być elementy roll-card
console.log("Has roll-card:", html.includes("neuroshima roll-card"));

// Powinno być data-tooltip (jeśli showTooltip=true)
console.log("Has tooltip:", html.includes("data-tooltip"));

// Powinny być odpowiednie buttony
console.log("Has buttons:", html.includes("btn") || html.includes("button"));
```

### Test 3: Interakcje

```javascript
// Sprawdzenie czy hooki obsługują wiadomość
const msg = game.messages.contents[game.messages.contents.length - 1];

// Kliknij na toggle (jeśli istnieje)
const toggle = document.querySelector(".collapsible-toggle");
if (toggle) {
  toggle.click();
  console.log("Toggle test: PASS");
}

// Sprawdź czy sekcja się otwiera
const content = document.querySelector(".collapsible-content");
console.log("Content visible:", content && content.style.display !== "none");
```

---

## Sprawdzenie w Grze

### 1. Test umiejętności
- Otwórz arkusz postaci
- Kliknij na umiejętność → "Test Umiejętności"
- Sprawdź czy karta pojawia się na czacie

### 2. Test broni
- Otwórz arkusz postaci
- Przejdź na zakładkę Walka
- Kliknij na broń → "Atak"
- Uzupełnij dialog
- Sprawdź czy karta pojawia się z sekcją "Aplikuj Obrażenia"

### 3. Aplikacja obrażeń
- Z karty ataku kliknij "Aplikuj Obrażenia"
- Wybierz cel
- Kliknij przycisk "Aplikuj"
- Sprawdź czy pojawia się raport odporności na ból

---

## Debugowanie

### Włączyć Debug Mode

```javascript
// W konsoli gry:
await game.settings.set("neuroshima", "debugMode", true);
```

### Monitoruj Logi

```javascript
// W konsoli przeglądarki:
// Będą logi: "Neuroshima 1.5 | ..."
console.log("Debug mode logi pojawiają się tutaj");
```

### Sprawdzenie Integralności

```javascript
// Sprawdź czy NeuroshimaChatMessage jest dostępny
console.log("API dostępne:", !!game.neuroshima.NeuroshimaChatMessage);

// Sprawdź metody
console.log("renderRoll:", typeof game.neuroshima.NeuroshimaChatMessage.renderRoll);
console.log("renderWeaponRoll:", typeof game.neuroshima.NeuroshimaChatMessage.renderWeaponRoll);
console.log("renderPainResistance:", typeof game.neuroshima.NeuroshimaChatMessage.renderPainResistance);
```

---

## Checklist Testowania

- [ ] NeuroshimaChatMessage jest dostępny w `game.neuroshima`
- [ ] Renderowanie testu umiejętności działa
- [ ] Renderowanie testu broni działa
- [ ] Sekcja obrażeń jest widoczna/ukryta w zależności od uprawnień
- [ ] Tooltips działają prawidłowo
- [ ] Hooki obsługują interakcje (rozwijanie, klikanie przycisków)
- [ ] Flags są ustawiane prawidłowo
- [ ] Raport odporności na ból pojawia się po aplikacji obrażeń
- [ ] Reverse Damage (cofnięcie obrażeń) działa
- [ ] Brak błędów w konsoli przeglądarki
- [ ] Brak błędów w logach servera

---

## Potencjalne Problemy

| Problem | Przyczyna | Rozwiązanie |
|---------|-----------|------------|
| "NeuroshimaChatMessage is not defined" | Brak importu | Sprawdzić import w `dice.js` i `combat-helper.js` |
| Karta się nie wyświetla | Zły template | Sprawdzić ścieżkę szablonu w metodzie |
| Brak tooltips | `showTooltip=false` | Sprawdzić ustawienia uprawnień |
| Hooki nie działają | Flagi ustawiane źle | Sprawdzić flags w `NeuroshimaChatMessage.create()` |
| Błędy w konsoli | Duplikaty metod | Sprawdzić czy stare metody zostały usunięte |

