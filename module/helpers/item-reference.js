/**
 * Resolve an Item reference stored by older compendium data.
 *
 * Foundry world Items use `Item.<id>`, but some records inside the system
 * compendium also stored their pack-local links in that form. Resolve those
 * links against the source pack first, then fall back to normal UUID lookup
 * and the remaining Item packs.
 */
export async function resolveItemReference(reference, { relativeTo = null } = {}) {
  const value = String(reference ?? "").trim();
  if (!value) return null;

  const localMatch = value.match(/^Item\.([^.]+)$/);
  const localId = localMatch?.[1] ?? null;
  const preferredPackId = relativeTo?.pack ?? relativeTo?.compendium?.collection ?? null;

  if (localId && preferredPackId) {
    const pack = game.packs.get(preferredPackId);
    const item = await pack?.getDocument(localId);
    if (item) return { uuid: item.uuid, item };
  }

  try {
    const item = await fromUuid(value);
    if (item?.documentName === "Item") return { uuid: item.uuid ?? value, item };
  } catch (error) {
    game.neuroshima?.log?.(`[ItemReference] Could not resolve "${value}" as a UUID`, error);
  }

  if (!localId) return null;

  const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
  for (const pack of packs.filter(pack =>
    (pack.metadata?.type ?? pack.documentName) === "Item"
  )) {
    if (pack.collection === preferredPackId) continue;
    let item = null;
    try {
      item = await pack.getDocument(localId);
    } catch (error) {
      game.neuroshima?.log?.(`[ItemReference] Could not read "${localId}" from ${pack.collection}`, error);
    }
    if (item) return { uuid: item.uuid, item };
  }

  return null;
}

export async function resolveItemReferences(references, options = {}) {
  const resolved = [];
  const seen = new Set();

  for (const reference of references ?? []) {
    const result = await resolveItemReference(reference, options);
    if (!result || seen.has(result.uuid)) continue;
    seen.add(result.uuid);
    resolved.push({ ...result, storedUuid: reference });
  }

  return resolved;
}
