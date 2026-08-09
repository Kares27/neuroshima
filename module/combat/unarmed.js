export const DEFAULT_UNARMED_DAMAGE_TABLE = Object.freeze([
  { maxBuild: 10, damage1: "sD", damage2: "sD", damage3: "sD" },
  { maxBuild: 12, damage1: "sD", damage2: "sD", damage3: "sL" },
  { maxBuild: 14, damage1: "sD", damage2: "sL", damage3: "sL" },
  { maxBuild: 16, damage1: "sD", damage2: "sL", damage3: "sC" },
  { maxBuild: 18, damage1: "sL", damage2: "sL", damage3: "sC" },
  { maxBuild: null, damage1: "sL", damage2: "sC", damage3: "sC" }
]);

export const UNARMED_DAMAGE_TYPES = Object.freeze(["D", "L", "C", "K", "sD", "sL", "sC", "sK"]);

export function normalizeUnarmedDamageTable(table) {
  const rows = Array.isArray(table) ? table : [];
  const normalized = rows.map(row => {
    const rawMax = row?.maxBuild;
    const maxBuild = rawMax === null || rawMax === "" || rawMax === undefined
      ? null
      : Number(rawMax);
    const damage = key => UNARMED_DAMAGE_TYPES.includes(row?.[key]) ? row[key] : "sD";
    return {
      maxBuild: Number.isFinite(maxBuild) ? maxBuild : null,
      damage1: damage("damage1"),
      damage2: damage("damage2"),
      damage3: damage("damage3")
    };
  });
  return normalized.sort((left, right) => {
    if (left.maxBuild === null) return right.maxBuild === null ? 0 : 1;
    if (right.maxBuild === null) return -1;
    return left.maxBuild - right.maxBuild;
  });
}

export function getUnarmedDamageProfile(actor, table = null) {
  const configured = table ?? game.settings?.get?.("neuroshima", "unarmedDamageTable");
  const rows = normalizeUnarmedDamageTable(
    Array.isArray(configured) && configured.length ? configured : DEFAULT_UNARMED_DAMAGE_TABLE
  );
  const build = Number(actor?.system?.attributeTotals?.constitution)
    || Number(actor?.system?.attributes?.constitution)
    || 0;
  const row = rows.find(entry => entry.maxBuild === null || build <= entry.maxBuild)
    ?? rows.at(-1)
    ?? DEFAULT_UNARMED_DAMAGE_TABLE[0];
  return { build, damage1: row.damage1, damage2: row.damage2, damage3: row.damage3 };
}

export function createUnarmedWeapon(actor) {
  const damage = getUnarmedDamageProfile(actor);
  return {
    id: null,
    uuid: null,
    isSynthetic: true,
    isUnarmed: true,
    name: game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.Unarmed"),
    img: "systems/neuroshima/assets/img/weapon-melee.svg",
    type: "weapon",
    actor,
    system: {
      weaponType: "melee",
      attribute: "dexterity",
      skill: "brawl",
      attackBonus: 0,
      defenseBonus: 0,
      weaponModifier: 0,
      piercing: 0,
      requiredBuild: 0,
      magazine: null,
      jamming: 20,
      damageCategory: "physical",
      damageMelee1: damage.damage1,
      damageMelee2: damage.damage2,
      damageMelee3: damage.damage3,
      tags: ["unarmed"]
    }
  };
}
