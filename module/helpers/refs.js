/**
 * Helpery do zarządzania referencjami do aktorów i tokenów w systemie Neuroshima 1.5.
 * Umożliwiają spójne operowanie na celach leczenia i walki niezależnie od tego,
 * czy są to unlinked tokeny na scenie, czy aktorzy w bazie danych.
 */

/**
 * Buduje obiekt referencji na podstawie tokena lub aktora.
 * 
 * @param {Object} data
 * @param {Token|TokenDocument} [data.token] - Token lub dokument tokena
 * @param {Actor} [data.actor] - Aktor
 * @returns {Object|null} Obiekt { kind: "token"|"actor", uuid: string }
 */
export function buildRef({ token = null, actor = null } = {}) {
    // Obsługa tokena (document lub placeable)
    const tokenDoc = token?.document || (token instanceof TokenDocument ? token : null);
    if (tokenDoc?.uuid) {
        return { kind: "token", uuid: tokenDoc.uuid };
    }

    // Obsługa aktora
    if (actor?.uuid) {
        return { kind: "actor", uuid: actor.uuid };
    }

    return null;
}

/**
 * Rozwiązuje obiekt referencji do rzeczywistych dokumentów Foundry.
 * 
 * @param {Object} ref - Obiekt referencji { kind, uuid }
 * @returns {Promise<{tokenDoc: TokenDocument|null, actor: Actor|null}>}
 */
export async function resolveRef(ref) {
    if (!ref || !ref.uuid) return { tokenDoc: null, actor: null };

    try {
        const doc = await fromUuid(ref.uuid);
        if (!doc) {
            console.error(`Neuroshima | resolveRef: Nie znaleziono dokumentu dla UUID: ${ref.uuid}`);
            return { tokenDoc: null, actor: null };
        }

        if (ref.kind === "token") {
            // W przypadku tokena, document to TokenDocument, a aktor jest w .actor
            return { 
                tokenDoc: doc, 
                actor: doc.actor 
            };
        }

        // W przypadku aktora, document to Actor
        return { 
            tokenDoc: null, 
            actor: doc 
        };
    } catch (err) {
        console.error(`Neuroshima | resolveRef: Błąd podczas rozwiązywania UUID: ${ref.uuid}`, err);
        return { tokenDoc: null, actor: null };
    }
}
