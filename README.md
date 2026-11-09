# neuroshima 1.5
All rights go to PORTAL GAMES SP. Z O.O https://sklep.portalgames.pl

Warstwa zgodności obsługuje Foundry V13 i V14. Manifest deklaruje `minimum: 13`
i `verified: 14`. Testy automatyczne sprawdzają oba kontrakty API.

Wspólne punkty wejścia:

- `module/helpers/foundry-compat.js`: zgodność V13/V14, Active Effects, obszary, aplikacje, sockety oraz import i eksport ustawień.
- `module/helpers/item-helper.js`: przedmioty, pancerz, amunicja, modyfikacje, odwołania do dokumentów, migawki cech, załoga i podglądy przedmiotów.
- `module/helpers/rolls.js`: rzuty, wybory użytkownika, grupowanie modyfikatorów dialogu i tooltipy wyników.
- `module/helpers/combat-helper.js`: obrażenia, zdolności bestii, wymagane testy i przypisane efekty.
- `module/helpers/xp.js`: doświadczenie, koszty rozwoju, specjalności i cofanie wydatków.
- `module/helpers/migration.js`: migracje świata, importowanych dokumentów i kompendiów.

Testy: `node --test tests/*.test.mjs`.

Przy zmianach integracji należy sprawdzić na kopii świata w obu wersjach: migrację
aktorów i kompendiów, edycję AE i stanów, fazy zmian i wygasanie efektów, aury
po ruchu tokenu, umieszczanie i anulowanie obszarów granatów, karty walki i okna
odłączone.
Szczegóły API skryptów: `docs/effect-scripts.html`.
Mapa konsolidacji i wyniki przeglądu: `docs/v13-v14-audit.md`.
