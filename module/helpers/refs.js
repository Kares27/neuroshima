/**
 * Helpers for managing actor and token references in the Neuroshima 1.5 system.
 * Provide a consistent way to address healing and combat targets whether they are
 * unlinked scene tokens or library actors.
 */

/**
 * Builds a reference object from a token or an actor.
 * 
 * @param {Object} data
 * @param {Token|TokenDocument} [data.token] - Token placeable or document
 * @param {Actor} [data.actor] - Actor document
 * @returns {Object|null} Reference object { kind: "token"|"actor", uuid: string }
 */
export function buildRef({ token = null, actor = null } = {}) {
    // Handle token input (document or placeable)
    const tokenDoc = token?.document || (token instanceof TokenDocument ? token : null);
    if (tokenDoc?.uuid) {
        return { kind: "token", uuid: tokenDoc.uuid };
    }

    // Handle actor input
    if (actor?.uuid) {
        return { kind: "actor", uuid: actor.uuid };
    }

    return null;
}

/**
 * Resolves a reference object to actual Foundry documents.
 * 
 * @param {Object} ref - Reference object { kind, uuid }
 * @returns {Promise<{tokenDoc: TokenDocument|null, actor: Actor|null}>}
 */
export async function resolveRef(ref) {
    if (!ref || !ref.uuid) return { tokenDoc: null, actor: null };

    try {
        const doc = await fromUuid(ref.uuid);
        if (!doc) {
            console.error(`Neuroshima | resolveRef: No document found for UUID: ${ref.uuid}`);
            return { tokenDoc: null, actor: null };
        }

        if (ref.kind === "token") {
            // For a token reference, doc is a TokenDocument; the actor is in .actor
            return { 
                tokenDoc: doc, 
                actor: doc.actor 
            };
        }

        // For an actor reference, doc is the Actor directly
        return { 
            tokenDoc: null, 
            actor: doc 
        };
    } catch (err) {
        console.error(`Neuroshima | resolveRef: Error resolving UUID: ${ref.uuid}`, err);
        return { tokenDoc: null, actor: null };
    }
}
