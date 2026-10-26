import { isBeastAbility } from "../helpers/beast-actions.js";

/** Keep actor-owned ability copies separate from same-ID world items during directory sorting. */
export class NeuroshimaItemDirectory extends foundry.applications.sidebar.tabs.ItemDirectory {
  async _getDroppedEntryFromData(data) {
    const entry = await super._getDroppedEntryFromData(data);
    if (!isBeastAbility(entry) || !entry.parent) return entry;
    const source = entry.toObject();
    source._id = foundry.utils.randomID();
    // Document#clone retains its original parent in v13, so construct an unsaved world copy.
    return new this.documentClass(source, { parent: null, pack: null, strict: false });
  }

  async _createDroppedEntry(entry, updates = {}) {
    if (!isBeastAbility(entry)) return super._createDroppedEntry(entry, updates);
    const data = foundry.utils.mergeObject(entry.toObject(), updates, { performDeletions: true });
    return this.documentClass.create(data, {
      fromCompendium: entry.inCompendium,
      keepEmbeddedIds: true
    });
  }
}
