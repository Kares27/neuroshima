import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

const BaseEffectSheet = foundry.applications.sheets.ActiveEffectConfig;

const NS_CHANGE_KEYS = [
  { group: "NEUROSHIMA.Effects.Keys.Group.Attributes", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.attributes.dexterity",    label: "NEUROSHIMA.Attribute.Dexterity" },
    { key: "system.attributes.perception",   label: "NEUROSHIMA.Attribute.Perception" },
    { key: "system.attributes.charisma",     label: "NEUROSHIMA.Attribute.Charisma" },
    { key: "system.attributes.cleverness",   label: "NEUROSHIMA.Attribute.Cleverness" },
    { key: "system.attributes.constitution", label: "NEUROSHIMA.Attribute.Constitution" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.Modifiers", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.modifiers.dexterity",    label: "NEUROSHIMA.Modifier.Dexterity" },
    { key: "system.modifiers.perception",   label: "NEUROSHIMA.Modifier.Perception" },
    { key: "system.modifiers.charisma",     label: "NEUROSHIMA.Modifier.Charisma" },
    { key: "system.modifiers.cleverness",   label: "NEUROSHIMA.Modifier.Cleverness" },
    { key: "system.modifiers.constitution", label: "NEUROSHIMA.Modifier.Constitution" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.HP", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.hp.max",   label: "NEUROSHIMA.HP.Max" },
    { key: "system.hp.value", label: "NEUROSHIMA.HP.Value" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.Combat", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.combat.totalArmorPenalty", label: "NEUROSHIMA.Combat.ArmorPenalty" },
    { key: "system.combat.meleeInitiative",   label: "NEUROSHIMA.Combat.MeleeInitiative" },
    { key: "system.healingRate",              label: "NEUROSHIMA.Effects.Keys.HealingRate" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.ArmorBonus", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.armorBonus.all",      label: "NEUROSHIMA.Effects.Keys.ArmorBonus.All" },
    { key: "system.armorBonus.head",     label: "NEUROSHIMA.Effects.Keys.ArmorBonus.Head" },
    { key: "system.armorBonus.torso",    label: "NEUROSHIMA.Effects.Keys.ArmorBonus.Torso" },
    { key: "system.armorBonus.rightArm", label: "NEUROSHIMA.Effects.Keys.ArmorBonus.RightArm" },
    { key: "system.armorBonus.leftArm",  label: "NEUROSHIMA.Effects.Keys.ArmorBonus.LeftArm" },
    { key: "system.armorBonus.rightLeg", label: "NEUROSHIMA.Effects.Keys.ArmorBonus.RightLeg" },
    { key: "system.armorBonus.leftLeg",  label: "NEUROSHIMA.Effects.Keys.ArmorBonus.LeftLeg" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.NaturalArmor", actorTypes: ["creature"], keys: [
    { key: "system.naturalArmor.head.reduction",     label: "NEUROSHIMA.Effects.Keys.NaturalArmor.Head" },
    { key: "system.naturalArmor.torso.reduction",    label: "NEUROSHIMA.Effects.Keys.NaturalArmor.Torso" },
    { key: "system.naturalArmor.rightArm.reduction", label: "NEUROSHIMA.Effects.Keys.NaturalArmor.RightArm" },
    { key: "system.naturalArmor.leftArm.reduction",  label: "NEUROSHIMA.Effects.Keys.NaturalArmor.LeftArm" },
    { key: "system.naturalArmor.rightLeg.reduction", label: "NEUROSHIMA.Effects.Keys.NaturalArmor.RightLeg" },
    { key: "system.naturalArmor.leftLeg.reduction",  label: "NEUROSHIMA.Effects.Keys.NaturalArmor.LeftLeg" },
    { key: "system.aggression",  label: "NEUROSHIMA.Effects.Keys.Creature.Aggression" },
    { key: "system.movement",    label: "NEUROSHIMA.Effects.Keys.Creature.Movement" },
    { key: "system.kondycja",    label: "NEUROSHIMA.Effects.Keys.Creature.Kondycja" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.VehicleAttributes", actorTypes: ["vehicle"], keys: [
    { key: "system.attributes.agility",      label: "NEUROSHIMA.Vehicle.Attributes.Agility" },
    { key: "system.attributes.topSpeed",     label: "NEUROSHIMA.Vehicle.Attributes.TopSpeed" },
    { key: "system.attributes.acceleration", label: "NEUROSHIMA.Vehicle.Attributes.Acceleration" },
    { key: "system.attributes.brakes",       label: "NEUROSHIMA.Vehicle.Attributes.Brakes" },
    { key: "system.attributes.durability",   label: "NEUROSHIMA.Vehicle.Attributes.Durability" },
    { key: "system.attributes.efficiency",   label: "NEUROSHIMA.Vehicle.Attributes.Efficiency" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.VehicleArmorBonus", actorTypes: ["vehicle"], keys: [
    { key: "system.armorBonus.all",       label: "NEUROSHIMA.Effects.Keys.ArmorBonus.All" },
    { key: "system.armorBonus.front",     label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Front" },
    { key: "system.armorBonus.rightSide", label: "NEUROSHIMA.Effects.Keys.VehicleArmor.RightSide" },
    { key: "system.armorBonus.leftSide",  label: "NEUROSHIMA.Effects.Keys.VehicleArmor.LeftSide" },
    { key: "system.armorBonus.rear",      label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Rear" },
    { key: "system.armorBonus.bottom",    label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Bottom" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.VehicleArmor", actorTypes: ["vehicle"], keys: [
    { key: "system.armor.front.reduction",     label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Front" },
    { key: "system.armor.rightSide.reduction", label: "NEUROSHIMA.Effects.Keys.VehicleArmor.RightSide" },
    { key: "system.armor.leftSide.reduction",  label: "NEUROSHIMA.Effects.Keys.VehicleArmor.LeftSide" },
    { key: "system.armor.rear.reduction",      label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Rear" },
    { key: "system.armor.bottom.reduction",    label: "NEUROSHIMA.Effects.Keys.VehicleArmor.Bottom" }
  ]}
];

export class NeuroshimaEffectSheet extends BaseEffectSheet {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    foundry.utils.deepClone(BaseEffectSheet.DEFAULT_OPTIONS),
    {
      classes: [
        ...(BaseEffectSheet.DEFAULT_OPTIONS.classes ?? []),
        "neuroshima",
        "effect"
      ],
      actions: {
        ...(BaseEffectSheet.DEFAULT_OPTIONS.actions ?? {}),
        addScript: NeuroshimaEffectSheet.prototype._onAddScript,
        removeScript: NeuroshimaEffectSheet.prototype._onRemoveScript,
        runManualScript: NeuroshimaEffectSheet.prototype._onRunManualScript,
        editScript: NeuroshimaEffectSheet.prototype._onEditScript,
        toggleChangeMode: NeuroshimaEffectSheet.prototype._onToggleChangeMode
      }
    },
    { inplace: false }
  );

  static PARTS = {
    header: BaseEffectSheet.PARTS.header,
    tabs: BaseEffectSheet.PARTS.tabs,
    details: BaseEffectSheet.PARTS.details,
    duration: BaseEffectSheet.PARTS.duration,
    changes: BaseEffectSheet.PARTS.changes,
    scripts: {
      template: "systems/neuroshima/templates/apps/effect-sheet-scripts.hbs"
    },
    footer: BaseEffectSheet.PARTS.footer
  };

  static TABS = {
    ...BaseEffectSheet.TABS,
    sheet: {
      ...(BaseEffectSheet.TABS?.sheet ?? {}),
      tabs: [
        ...(BaseEffectSheet.TABS?.sheet?.tabs ?? []),
        { id: "scripts", icon: "fa-solid fa-code", label: "NEUROSHIMA.Tabs.Scripts" }
      ]
    }
  };

  async _onRender(context, options) {
    await super._onRender(context, options);

    for (const [group, tabId] of Object.entries(this.tabGroups)) {
      this.element.querySelectorAll(`[data-group="${group}"][data-tab]`).forEach(el => {
        el.classList.toggle("active", el.dataset.tab === tabId);
      });
    }

    this._injectDetailsFields();

    const changesSection = this.element.querySelector("section[data-tab='changes']");
    if (changesSection) {
      const isManual = this.document.getFlag("neuroshima", "manualChangeKeys") ?? false;

      const toggle = document.createElement("div");
      toggle.classList.add("form-group", "ns-change-key-toggle");
      toggle.innerHTML = `<label>${game.i18n.localize("NEUROSHIMA.Effects.ManualKeys")}</label>
        <div class="form-fields"><input type="checkbox" data-action="toggleChangeMode"${isManual ? " checked" : ""}></div>`;
      changesSection.insertAdjacentElement("afterbegin", toggle);

      if (!isManual) {
        const actorType = this._getActorType();
        for (const input of changesSection.querySelectorAll(".key input")) {
          input.replaceWith(this._buildKeySelect(input.name, input.value, actorType));
        }
      }
    }
  }

  _getActorType() {
    const parent = this.document.parent;
    if (!parent) return null;
    const actor = parent.documentName === "Actor" ? parent : parent.parent;
    return actor?.type ?? null;
  }

  _buildKeySelect(name, currentValue, actorType = null) {
    const select = document.createElement("select");
    select.name = name;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = `— ${game.i18n.localize("NEUROSHIMA.Effects.Change.SelectKey")} —`;
    if (!currentValue) blank.selected = true;
    select.appendChild(blank);

    for (const group of NS_CHANGE_KEYS) {
      const allowed = !group.actorTypes || !actorType || group.actorTypes.includes(actorType);
      if (!allowed) {
        if (!currentValue || !group.keys.some(k => k.key === currentValue)) continue;
      }
      const optgroup = document.createElement("optgroup");
      optgroup.label = game.i18n.localize(group.group);
      for (const keyDef of group.keys) {
        const option = document.createElement("option");
        option.value = keyDef.key;
        option.textContent = game.i18n.localize(keyDef.label);
        if (keyDef.key === currentValue) option.selected = true;
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    return select;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.scripts      = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    context.triggers     = NeuroshimaScriptRunner.TRIGGERS;
    context.transferType = this.document.getFlag("neuroshima", "transferType") ?? "owningDocument";
    context.documentType = this.document.getFlag("neuroshima", "documentType") ?? "actor";
    context.equipTransfer = this.document.getFlag("neuroshima", "equipTransfer") ?? false;
    return context;
  }

  _injectDetailsFields() {
    const section = this.element.querySelector("section[data-tab='details']");
    if (!section || section.querySelector(".ns-transfer-type")) return;

    // Hide the default Foundry "Apply Effect to Actor" (transfer) checkbox —
    // transfer is fully controlled by our Effect Application + Document Type dropdowns.
    const transferGroup = section.querySelector("[name='transfer']")?.closest(".form-group");
    if (transferGroup) transferGroup.style.display = "none";

    const transferType  = this.document.getFlag("neuroshima", "transferType")  ?? "owningDocument";
    const documentType  = this.document.getFlag("neuroshima", "documentType")  ?? "actor";
    const equipTransfer = this.document.getFlag("neuroshima", "equipTransfer") ?? false;

    const wrap = document.createElement("div");
    wrap.classList.add("ns-transfer-type");
    wrap.innerHTML = `
      <hr>
      <div class="form-group">
        <label>Effect Application</label>
        <div class="form-fields">
          <select name="flags.neuroshima.transferType">
            <option value="owningDocument"${transferType === "owningDocument" ? " selected" : ""}>Owning Document</option>
            <option value="target"        ${transferType === "target"         ? " selected" : ""}>Target</option>
            <option value="damage"        ${transferType === "damage"         ? " selected" : ""}>Damage</option>
            <option value="other"         ${transferType === "other"          ? " selected" : ""}>Other</option>
          </select>
        </div>
        <p class="hint">How this effect is transferred to another document.</p>
      </div>
      <div class="form-group">
        <label>Document Type</label>
        <div class="form-fields">
          <select name="flags.neuroshima.documentType">
            <option value="actor"${documentType === "actor" ? " selected" : ""}>Actor</option>
            <option value="item" ${documentType === "item"  ? " selected" : ""}>Item</option>
          </select>
        </div>
        <p class="hint">Target document type when Effect Application is not Owning Document.</p>
      </div>
      <div class="form-group">
        <label>Transfer on Equip</label>
        <div class="form-fields">
          <input type="checkbox" name="flags.neuroshima.equipTransfer"${equipTransfer ? " checked" : ""}>
        </div>
        <p class="hint">Only transfer this effect when the parent item is equipped.</p>
      </div>`;

    section.appendChild(wrap);
  }

  async _processSubmitData(event, form, submitData) {
    const transferType = submitData["flags.neuroshima.transferType"] ?? "owningDocument";
    const documentType = submitData["flags.neuroshima.documentType"] ?? "actor";
    submitData.transfer = (transferType === "owningDocument" && documentType === "actor");
    return super._processSubmitData(event, form, submitData);
  }

  async _onToggleChangeMode(event, target) {
    const current = this.document.getFlag("neuroshima", "manualChangeKeys") ?? false;
    await this.document.setFlag("neuroshima", "manualChangeKeys", !current);
  }

  async _onAddScript(event, target) {
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    const newIndex = scripts.length;
    scripts.push({ trigger: "manual", label: game.i18n.localize("NEUROSHIMA.Scripts.NewScript"), code: "" });
    await this.document.setFlag("neuroshima", "scripts", scripts);
    const { NeuroshimaScriptEditor } = await import("../apps/neuroshima-script-editor.js");
    new NeuroshimaScriptEditor(this.document, newIndex).render(true);
  }

  async _onRemoveScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const scripts = foundry.utils.deepClone(this.document.getFlag("neuroshima", "scripts") || []);
    scripts.splice(index, 1);
    await this.document.setFlag("neuroshima", "scripts", scripts);
  }

  async _onEditScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const { NeuroshimaScriptEditor } = await import("../apps/neuroshima-script-editor.js");
    new NeuroshimaScriptEditor(this.document, index).render(true);
  }

  async _onRunManualScript(event, target) {
    const index = parseInt(target.closest("[data-index]")?.dataset.index ?? target.dataset.index);
    const actor = this.document.actor
      ?? game.user.character
      ?? canvas.tokens?.controlled?.[0]?.actor
      ?? null;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
      return;
    }
    await NeuroshimaScriptRunner.executeManual(actor, this.document, index);
  }
}
