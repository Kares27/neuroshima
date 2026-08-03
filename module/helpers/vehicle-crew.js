/**
 * Convert a crew SchemaField model into ordinary update-safe data.
 */
export function crewMemberData(member) {
  return member?.toObject?.() ?? member ?? {};
}

/**
 * Resolve the concrete Actor represented by a vehicle crew entry.
 *
 * `actorUuid` is authoritative because it can identify the synthetic Actor of
 * one specific unlinked Token. `actorId` remains a legacy fallback for world
 * Actors saved before crew UUIDs were introduced.
 */
export async function resolveCrewActor(member) {
  const data = crewMemberData(member);
  if (data.actorUuid) {
    try {
      const document = await fromUuid(data.actorUuid);
      if (document?.documentName === "Actor") return document;
      if (document?.documentName === "Token") return document.actor ?? null;
    } catch (error) {
      game.neuroshima?.warn?.("[vehicle crew] Unable to resolve actorUuid", {
        actorUuid: data.actorUuid,
        error
      });
    }
  }
  return data.actorId ? game.actors.get(data.actorId) ?? null : null;
}

/**
 * Match a stored entry with identity data emitted by the vehicle sheet.
 * UUID wins for new entries; actorId keeps legacy world-Actor rows editable.
 */
export function crewMemberMatches(member, { actorUuid = "", actorId = "" } = {}) {
  const data = crewMemberData(member);
  if (data.actorUuid && actorUuid) return data.actorUuid === actorUuid;
  return !!actorId && data.actorId === actorId;
}

