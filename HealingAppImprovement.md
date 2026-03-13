Okej. Najlepsze podejście to zrobić jedną, spójną warstwę “referencji do celu leczenia” i zawsze operować na niej, zamiast zgadywać czy chodzi o token czy aktora.

Poniżej masz krótko, ale konkretnie, jak to ugryźć od początku do końca.

## 1) Ustal dwa tryby pracy i nie mieszaj ich w locie

Masz tylko dwa sensowne tryby:

1. Tryb tokenowy
   Używasz go, gdy leczenie jest inicjowane na scenie i ma dotyczyć konkretnego tokena (także unlinked).

2. Tryb aktorowy
   Używasz go, gdy leczenie jest “karta do karty” bez sceny, albo gdy użytkownik nie wskazuje tokena.

Zasada: jeśli masz token, zapisuj token. Jeśli nie masz tokena, zapisuj aktora.

To zamyka temat NPC bez linkowania, bo unlinked token nadal ma własny uuid, a leczenie ma trafić w “tego egzemplarza”.

## 2) Zapisuj w wiadomości czatu tylko “refs”, a nie id i nie heurystyki

W flagach wiadomości (np. `flags.neuroshima`) trzymaj referencje:

* `patientRef: { kind: "token"|"actor", uuid: "..." }`
* `medicRef: { kind: "token"|"actor", uuid: "..." }`

Nie zapisuj `patientActorId`, nie zapisuj `patientActorUuid` jako jedynego źródła, i nie licz na `medicUser.character`.

Minimalny helper:

```js
function buildRef({ token = null, actor = null } = {}) {
  if (token?.document?.uuid) return { kind: "token", uuid: token.document.uuid };
  if (actor?.uuid) return { kind: "actor", uuid: actor.uuid };
  return null;
}
```

Kiedy tworzysz request:

* Pacjent z tokena: `buildRef({ token })`
* Pacjent z sheetu: `buildRef({ actor: this.actor })`
* Medyk najlepiej zawsze wybierany jako aktor w dialogu: `buildRef({ actor: selectedMedicActor })`

## 3) Rozwiązywanie referencji zrób w jednym miejscu

Jedna funkcja, jeden punkt prawdy. Zawsze:

* `fromUuid(ref.uuid)`
* jeśli kind token, bierz `tokenDoc.actor`
* jeśli kind actor, bierz `actor`

```js
async function resolveRef(ref) {
  const doc = await fromUuid(ref.uuid);
  if (!doc) return null;

  if (ref.kind === "token") return { tokenDoc: doc, actor: doc.actor };
  return { tokenDoc: null, actor: doc };
}
```

W całym systemie zakazujesz sobie “szukania tokena po scenach”, “fallbacków po id” itp. Jeśli uuid nie istnieje, to znaczy, że źródło zniknęło i pokazujesz błąd w UI.

## 4) Aplikuj leczenie zawsze na `resolved.actor`

Klucz: w Foundry `TokenDocument.actor` zwróci właściwy “aktor do zapisu” dla unlinked i linked tokenów. Dzięki temu:

* unlinked token: leczysz syntetycznego aktora tokena
* linked: leczysz bazowego aktora

Czyli kod leczenia nie musi rozróżniać trybu. Ty tylko rozróżniasz sposób identyfikacji celu.

## 5) Uprawnienia oprzyj na ownership aktora medyka, nie na user.character

To eliminuje większość problemów.

W panelu leczenia po resolve robisz:

* jeśli `game.user.isGM` to OK
* inaczej sprawdzasz ownership do `medicResolved.actor` (czy user ma co najmniej Owner)
* opcjonalnie dopuszczasz pacjenta do podglądu, ale nie do klików

To powinno kontrolować zarówno:

* pokazanie przycisków
* możliwość wysłania socket requestu

Ważne: nie rób `isMedic: game.user.isGM || true` ani podobnych skrótów, bo to rozwala bezpieczeństwo.

## 6) Flow UI, który nie rozjeżdża się między sceną i sheetem

Prosty, stabilny przepływ:

1. Klik “Request Healing”

   * budujesz `patientRef` zależnie od kontekstu (token jeśli jest, inaczej actor)
   * wybierasz `medicActor` w dialogu (lista aktorów, do których medyk user ma Owner albo lista party)
   * zapisujesz `medicRef` jako actor ref
   * tworzysz ChatMessage z flagami `patientRef` i `medicRef`

2. Klik w czacie “Open Heal Panel”

   * czytasz flagi
   * `resolveRef(patientRef)`, `resolveRef(medicRef)`
   * autoryzacja
   * otwierasz HealingApp z resolved actorami

3. Klik “Apply”

   * jeśli user nie jest GM, wysyłasz socket do GM z: `patientRef`, `medicRef`, `woundId`, `action`
   * GM po stronie socket handler robi resolve jeszcze raz i dopiero update danych

Zasada: GM nigdy nie ufa temu, co przyszło z klienta, poza uuid i parametrami akcji. Zawsze resolve po stronie GM.

## 7) Chat-message API utylizuj jako dispatcher akcji

Żeby nie mieć dwóch systemów eventów:

* wszystkie akcje z czatu (open panel, accept, apply, resolve) idą przez jeden dispatcher (twoja klasa chat message)
* `system.js` tylko podpina jeden listener i przekazuje html do dispatchera

To daje powtarzalność i mniej bugów po rerender.

## 8) Co to daje w Twoich scenariuszach

* NPC bez linkowania
  Jeśli leczenie startuje z tokena, kind token i leczysz dokładnie tego NPC na scenie. Jeśli startuje z sheetu NPC, kind actor i leczysz bazowego NPC.

* Brak sceny, karta do karty
  kind actor dla pacjenta i medyka, wszystko działa bez tokenów.

* Wiele tokenów tego samego aktora
  token ref rozróżnia egzemplarze, a actor ref nie. To jest właściwe zachowanie zależnie od kontekstu.

