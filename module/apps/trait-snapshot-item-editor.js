import {
  collectTraitSnapshots,
  createTraitSnapshot,
  itemDataFromTraitSnapshot
} from "../helpers/trait-snapshot.js";

/**
 * Open the regular Neuroshima ItemSheet for a trait copy stored inside an
 * Origin/Profession. The draft is a complete in-memory Item document. All
 * writes, flags and embedded ActiveEffect mutations are persisted back into
 * the parent Item's traitChoices array without creating a database document or
 * firing gameplay document hooks.
 */
export async function openTraitSnapshotItemSheet(parentItem, snapshotId) {
  const snapshots = await collectTraitSnapshots(parentItem);
  const snapshot = snapshots.find(entry => entry.id === snapshotId);
  const itemData = itemDataFromTraitSnapshot(snapshot);
  if (!itemData) return;

  itemData._id = foundry.utils.randomID();
  const tempActor = new CONFIG.Actor.documentClass({
    _id: foundry.utils.randomID(),
    name: "_ns_trait_snapshot",
    type: "npc",
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
  });
  const draft = new CONFIG.Item.documentClass(itemData, { parent: tempActor });
  draft._isTraitSnapshotDraft = true;

  let sheet = null;
  let saveQueue = Promise.resolve();

  const serializeEffectsToSource = () => {
    draft._source.effects = draft.effects.map(effect => effect.toObject());
  };

  const persist = async () => {
    serializeEffectsToSource();
    saveQueue = saveQueue.then(async () => {
      const current = await collectTraitSnapshots(parentItem);
      const index = current.findIndex(entry => entry.id === snapshotId);
      if (index < 0) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Traits.CopyMissing"));
        await sheet?.close();
        return;
      }
      current[index] = createTraitSnapshot(draft, { id: snapshotId });
      await parentItem.update({
        "system.traitChoices": current,
        "system.traits": []
      }, { neuroshimaTraitSnapshotEditor: true });
    });
    await saveQueue;
  };

  const renderItemSheet = async () => {
    if (sheet?.rendered) await sheet.render();
  };

  const patchEffect = effect => {
    if (!effect || effect._isTraitSnapshotDraftEffect) return effect;
    effect._isTraitSnapshotDraftEffect = true;

    effect.update = async function(changes = {}, _options = {}) {
      this.updateSource(foundry.utils.expandObject(changes));
      this.prepareData?.();
      serializeEffectsToSource();
      await persist();
      if (this._openSheet?.rendered) await this._openSheet.render();
      await renderItemSheet();
      return this;
    };

    effect.setFlag = async function(scope, key, value) {
      return this.update({ [`flags.${scope}.${key}`]: value });
    };

    effect.unsetFlag = async function(scope, key) {
      return this.update({ [`flags.${scope}.-=${key}`]: null });
    };

    effect.delete = async function(_options = {}) {
      draft.effects.delete(this.id);
      serializeEffectsToSource();
      await persist();
      await this._openSheet?.close();
      await renderItemSheet();
      return this;
    };

    return effect;
  };

  const patchEffects = () => {
    for (const effect of draft.effects) patchEffect(effect);
  };
  patchEffects();

  draft.update = async function(changes = {}, _options = {}) {
    this.updateSource(foundry.utils.expandObject(changes));
    this.prepareData?.();
    patchEffects();
    await persist();
    await renderItemSheet();
    return this;
  };

  draft.setFlag = async function(scope, key, value) {
    return this.update({ [`flags.${scope}.${key}`]: value });
  };

  draft.unsetFlag = async function(scope, key) {
    return this.update({ [`flags.${scope}.-=${key}`]: null });
  };

  draft.createEmbeddedDocuments = async function(embeddedName, data = [], _options = {}) {
    if (embeddedName !== "ActiveEffect") {
      throw new Error(`Trait snapshot editor does not support embedded ${embeddedName} documents`);
    }
    const created = data.map(source => {
      const effectData = foundry.utils.deepClone(source);
      effectData._id ??= foundry.utils.randomID();
      const effect = new CONFIG.ActiveEffect.documentClass(effectData, { parent: draft });
      draft.effects.set(effect.id, effect);
      return patchEffect(effect);
    });
    serializeEffectsToSource();
    await persist();
    await renderItemSheet();
    return created;
  };

  draft.updateEmbeddedDocuments = async function(embeddedName, updates = [], _options = {}) {
    if (embeddedName !== "ActiveEffect") {
      throw new Error(`Trait snapshot editor does not support embedded ${embeddedName} documents`);
    }
    const updated = [];
    for (const change of updates) {
      const effect = draft.effects.get(change._id);
      if (!effect) continue;
      const data = foundry.utils.deepClone(change);
      delete data._id;
      effect.updateSource(foundry.utils.expandObject(data));
      effect.prepareData?.();
      updated.push(patchEffect(effect));
    }
    serializeEffectsToSource();
    await persist();
    await renderItemSheet();
    return updated;
  };

  draft.deleteEmbeddedDocuments = async function(embeddedName, ids = [], _options = {}) {
    if (embeddedName !== "ActiveEffect") {
      throw new Error(`Trait snapshot editor does not support embedded ${embeddedName} documents`);
    }
    const deleted = ids.map(id => draft.effects.get(id)).filter(Boolean);
    for (const effect of deleted) draft.effects.delete(effect.id);
    serializeEffectsToSource();
    await persist();
    await renderItemSheet();
    return deleted;
  };

  const { NeuroshimaItemSheet } = await import("../sheets/item-sheet.js");
  sheet = new NeuroshimaItemSheet({
    document: draft,
    window: {
      title: `${draft.name} — ${game.i18n.localize("NEUROSHIMA.Traits.EmbeddedCopy")}`
    }
  });
  draft._openSheet = sheet;
  sheet.render(true);
}
