export const ROLL_RESULT_SCHEMA_VERSION = 2;

const rollResults = roll => roll?.dice?.flatMap(die =>
  die.results?.map(result => result.result) ?? []
) ?? [];

/**
 * Add the versioned, common result envelope without removing the legacy
 * top-level properties still consumed by chat cards and saved messages.
 */
export function attachRollContract(rollData, {
  type = "skill",
  subtype = null,
  actor = null,
  item = null,
  roll = null,
  auxiliary = [],
  tags = []
} = {}) {
  if (!rollData || typeof rollData !== "object") return rollData;
  rollData.schemaVersion = ROLL_RESULT_SCHEMA_VERSION;
  rollData.contract = {
    schemaVersion: ROLL_RESULT_SCHEMA_VERSION,
    type,
    subtype,
    source: {
      actorUuid: actor?.uuid ?? null,
      itemUuid: item?.uuid ?? null
    },
    rolls: {
      primary: {
        formula: roll?.formula ?? null,
        results: rollResults(roll)
      },
      auxiliary: auxiliary.filter(Boolean)
    },
    outcome: {
      success: rollData.isSuccess ?? rollData.success ?? null,
      successPoints: rollData.successPoints ?? rollData.successCount ?? 0,
      tags: [...new Set(tags.filter(Boolean))]
    }
  };
  return rollData;
}

