# NeuroshimaChatMessage API

## Przegląd

**NeuroshimaChatMessage** to rozszerzona klasa `ChatMessage` z Foundry VTT, która stanowi ujednolicone API do renderowania wszystkich typów wiadomości czatu w systemie Neuroshima 1.5.

### Korzyści
- ✅ **Jedyne API**: Wszystkie typy kart czatu przez jedno interface
- ✅ **Brak duplikacji**: Unikamy powtórzenia logiki renderowania
- ✅ **Łatwa modyfikacja**: Zmiana wyglądu w jednym miejscu
- ✅ **Centralne zarządzanie**: Wszystkie uprawnień i flags w jednej klasie
- ✅ **Bezpieczne**: Nie niszczy istniejących hoków i logiki

---

## Typy Wiadomości

```javascript
NeuroshimaChatMessage.TYPES = {
  ROLL: 'roll',              // Testy umiejętności/atrybutów
  WEAPON: 'weapon',          // Testy broni
  PAIN_RESISTANCE: 'painResistance'  // Raporty odporności na ból
}
```

---

## API Metody

### 1. `renderRoll(rollData, actor, roll)`

Renderuje kartę testu umiejętności/atrybutu.

```javascript
// W dice.js (zamiast ChatMessage.create)
await NeuroshimaChatMessage.renderRoll(rollData, actor, roll);
```

**Parametry:**
- `rollData` - Dane z `NeuroshimaDice.rollTest()` (zawiera wszystkie wyniki, kary, itp)
- `actor` - Aktor wykonujący test
- `roll` - Obiekt Roll z wynikami kości

**Szablon:** `templates/chat/roll-card.hbs`

---

### 2. `renderWeaponRoll(rollData, actor, roll)`

Renderuje kartę testu broni.

```javascript
// W dice.js (zamiast ChatMessage.create)
await NeuroshimaChatMessage.renderWeaponRoll(rollData, actor, roll);
```

**Parametry:**
- `rollData` - Dane z `NeuroshimaDice.rollWeaponTest()` (zawiera pocisk, lokacje, obrażenia, itp)
- `actor` - Aktor wykonujący atak
- `roll` - Obiekt Roll z wynikami kości

**Szablon:** `templates/chat/weapon-roll-card.hbs`

---

### 3. `renderPainResistance(actor, results, woundIds)`

Renderuje raport testów odporności na ból.

```javascript
// W combat-helper.js (zamiast renderPainResistanceReport)
await NeuroshimaChatMessage.renderPainResistance(actor, results, woundIds);
```

**Parametry:**
- `actor` - Aktor poddawany testom
- `results` - Array wyników z `CombatHelper.processPainResistance()`
- `woundIds` - ID ran które zostały dodane do aktora

**Szablon:** `templates/chat/pain-resistance-report.hbs`

---

## Właściwości Instancji

Po stworzeniu wiadomości możesz dostać się do danych:

```javascript
const message = game.messages.get(messageId);

// Zwraca typ wiadomości: 'roll' | 'weapon' | 'painResistance'
message.messageType

// Zwraca obiekty rollData z flag
message.rollData

// Zwraca true jeśli to wiadomość o rzucie (roll lub weapon)
message.isRollMessage

// Zwraca true jeśli to raport odporności
message.isPainResistanceReport
```

---

## Flags Struktura

Każda wiadomość automatycznie przechowuje dane w flags:

```javascript
message.flags.neuroshima = {
  messageType: 'roll' | 'weapon' | 'painResistance',
  isPainResistanceReport: boolean,
  rollData: {
    isWeapon: boolean,
    actorId: string,
    isOpen: boolean,
    results: array,
    // ... wszystkie dane do renderowania i re-ewaluacji
  }
}
```

---

## Integracja z system.js Hooks

Istniejące hooki w `system.js` **pozostają bez zmian**:

1. **renderChatMessage hook #1** (linia 384) - Obsługuje interakcje (klikanie, drag-drop)
2. **renderChatMessage hook #2** (linia 475) - Egzekwuje uprawnienia użytkownika

Nowe API automatycznie działa z tymi hookami, ponieważ:
- Flags są ustawiane prawidłowo
- HTML jest renderowany tymi samymi szablonami
- Interfejs hoków pozostaje bez zmian

---

## Przykłady Integracji

### W `module/helpers/dice.js`

**Przed:**
```javascript
static async renderRollCard(data, actor, roll) {
  const template = "systems/neuroshima/templates/chat/roll-card.hbs";
  const showTooltip = this.canShowTooltip(actor);
  const content = await foundry.applications.handlebars.renderTemplate(template, { ... });
  
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: [roll],
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: { neuroshima: { rollData: { ... } } }
  });
}
```

**Po:**
```javascript
static async renderRollCard(data, actor, roll) {
  return NeuroshimaChatMessage.renderRoll(data, actor, roll);
}
```

Lub w `rollTest()`:
```javascript
// Stara linia (740):
await this.renderRollCard(rollData, actor, roll);

// Nowa linia:
await NeuroshimaChatMessage.renderRoll(rollData, actor, roll);
```

### W `module/helpers/combat-helper.js`

**Przed:**
```javascript
static async renderPainResistanceReport(actor, results, woundIds) {
  const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
  const content = await foundry.applications.handlebars.renderTemplate(template, { ... });
  
  await ChatMessage.create({ ... });
}
```

**Po:**
```javascript
static async renderPainResistanceReport(actor, results, woundIds) {
  return NeuroshimaChatMessage.renderPainResistance(actor, results, woundIds);
}
```

---

## Dodawanie Nowych Typów Kart

Aby dodać nowy typ karty czatu:

1. **Dodaj nowy typ** w `NeuroshimaChatMessage.TYPES`:
```javascript
static TYPES = {
  // ... istniejące typy
  CUSTOM: 'custom'
};
```

2. **Stwórz nową metodę** w klasie:
```javascript
static async renderCustom(customData, actor) {
  const template = "systems/neuroshima/templates/chat/custom-card.hbs";
  const content = await this._renderTemplate(template, {
    ...customData,
    config: NEUROSHIMA,
    showTooltip: this._canShowTooltip(actor)
  });

  return this.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: {
      neuroshima: {
        messageType: this.TYPES.CUSTOM,
        customData: { /* twoje dane */ }
      }
    }
  });
}
```

3. **Stwórz szablon** `templates/chat/custom-card.hbs`

4. **Dodaj obsługę w hookach** w `system.js` jeśli potrzebna (dla interakcji)

---

## Debugowanie

Aby zobaczyć flags wiadomości w konsoli:

```javascript
const message = game.messages.get(messageId);
console.log(message.flags.neuroshima);
console.log(message.messageType);
console.log(message.rollData);
```

---

## FAQ

**P: Czy mogę nadal korzystać ze starego `ChatMessage.create()`?**  
O: Tak, ale zalecane jest używanie nowego API dla spójności.

**P: Czy system.js hooki będą działać?**  
O: Tak! API automatycznie integruje się z istniejącymi hookami.

**P: Czy mogę modyfikować flagi w mojej metodzie?**  
O: Tak, możesz dodawać vlastne flagi obok `neuroshima` namespace.

**P: Jak zmienić wygląd kart?**  
O: Edytuj szablony w `templates/chat/` - wiadomości będą automatycznie przerenderowane.
