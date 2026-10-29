# neuroshima 1.5
All rights go to PORTAL GAMES SP. Z O.O https://sklep.portalgames.pl

Warstwa zgodności obsługuje Foundry V13 i V14. Manifest zachowuje `minimum: 13`
i `verified: 13`: testy automatyczne sprawdzają oba kontrakty API, ale nie zastępują
testów działającej aplikacji V14.

Wspólne punkty wejścia:

- `module/helpers/foundry-compat.js`: formaty Active Effects, czas trwania, obszary sceny, tryby wiadomości i instancje aplikacji.
- `module/helpers/rolls.js`: `NeuroshimaDice` i `NeuroshimaRollTestRouter`.
- `module/helpers/item-tooltip.js`: treść i interakcje podglądu przedmiotów.
- `module/apps/config/combat-config.js`: konfiguracja walki i typów obrażeń.

Testy: `node --test tests/*.test.mjs`.

Przed podniesieniem `verified` należy sprawdzić na kopii świata w V14: migrację
aktorów i kompendiów, edycję AE i stanów, fazy zmian i wygasanie efektów, aury
po ruchu tokenu, umieszczanie i anulowanie obszarów granatów, karty walki i okna
odłączone. W V13 należy sprawdzić te same scenariusze po aktualizacji systemu.
Szczegóły API skryptów: `docs/effect-scripts.html`.
