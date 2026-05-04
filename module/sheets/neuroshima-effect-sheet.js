import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

const BaseEffectSheet = foundry.applications.sheets.ActiveEffectConfig;

const NS_CHANGE_KEYS = [
  { group: "NEUROSHIMA.Effects.Keys.Group.Attributes", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.attributes.dexterity",          label: "NEUROSHIMA.Attributes.Dexterity" },
    { key: "system.attributeBonuses.dexterity",    label: "NEUROSHIMA.Attributes.Dexterity",    prefix: "Bonus" },
    { key: "system.attributes.perception",         label: "NEUROSHIMA.Attributes.Perception" },
    { key: "system.attributeBonuses.perception",   label: "NEUROSHIMA.Attributes.Perception",   prefix: "Bonus" },
    { key: "system.attributes.charisma",           label: "NEUROSHIMA.Attributes.Charisma" },
    { key: "system.attributeBonuses.charisma",     label: "NEUROSHIMA.Attributes.Charisma",     prefix: "Bonus" },
    { key: "system.attributes.cleverness",         label: "NEUROSHIMA.Attributes.Cleverness" },
    { key: "system.attributeBonuses.cleverness",   label: "NEUROSHIMA.Attributes.Cleverness",   prefix: "Bonus" },
    { key: "system.attributes.constitution",       label: "NEUROSHIMA.Attributes.Constitution" },
    { key: "system.attributeBonuses.constitution", label: "NEUROSHIMA.Attributes.Constitution", prefix: "Bonus" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.HP", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.hp.max", label: "NEUROSHIMA.HP.Max" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.Combat", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.movement",                label: "NEUROSHIMA.Movement.Label" },
    { key: "system.combat.armorPenaltyBonus", label: "NEUROSHIMA.Combat.ArmorPenalty" },
    { key: "system.combat.generalPenalty",    label: "NEUROSHIMA.Combat.GeneralPenalty" },
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
    { key: "system.attributeBonuses.agility",      label: "NEUROSHIMA.Vehicle.Attributes.Agility" },
    { key: "system.attributeBonuses.topSpeed",     label: "NEUROSHIMA.Vehicle.Attributes.TopSpeed" },
    { key: "system.attributeBonuses.acceleration", label: "NEUROSHIMA.Vehicle.Attributes.Acceleration" },
    { key: "system.attributeBonuses.brakes",       label: "NEUROSHIMA.Vehicle.Attributes.Brakes" },
    { key: "system.attributeBonuses.durability",   label: "NEUROSHIMA.Vehicle.Attributes.Durability" },
    { key: "system.attributeBonuses.efficiency",   label: "NEUROSHIMA.Vehicle.Attributes.Efficiency" }
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
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.SkillsDexterity", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.skills.brawl.value",          label: "NEUROSHIMA.Skills.brawl" },
    { key: "system.skillBonuses.brawl",          label: "NEUROSHIMA.Skills.brawl",         prefix: "Bonus" },
    { key: "system.skills.handWeapon.value",     label: "NEUROSHIMA.Skills.handWeapon" },
    { key: "system.skillBonuses.handWeapon",     label: "NEUROSHIMA.Skills.handWeapon",     prefix: "Bonus" },
    { key: "system.skills.throwing.value",       label: "NEUROSHIMA.Skills.throwing" },
    { key: "system.skillBonuses.throwing",       label: "NEUROSHIMA.Skills.throwing",       prefix: "Bonus" },
    { key: "system.skills.pistols.value",        label: "NEUROSHIMA.Skills.pistols" },
    { key: "system.skillBonuses.pistols",        label: "NEUROSHIMA.Skills.pistols",        prefix: "Bonus" },
    { key: "system.skills.rifles.value",         label: "NEUROSHIMA.Skills.rifles" },
    { key: "system.skillBonuses.rifles",         label: "NEUROSHIMA.Skills.rifles",         prefix: "Bonus" },
    { key: "system.skills.machineGuns.value",    label: "NEUROSHIMA.Skills.machineGuns" },
    { key: "system.skillBonuses.machineGuns",    label: "NEUROSHIMA.Skills.machineGuns",    prefix: "Bonus" },
    { key: "system.skills.bow.value",            label: "NEUROSHIMA.Skills.bow" },
    { key: "system.skillBonuses.bow",            label: "NEUROSHIMA.Skills.bow",            prefix: "Bonus" },
    { key: "system.skills.crossbow.value",       label: "NEUROSHIMA.Skills.crossbow" },
    { key: "system.skillBonuses.crossbow",       label: "NEUROSHIMA.Skills.crossbow",       prefix: "Bonus" },
    { key: "system.skills.sling.value",          label: "NEUROSHIMA.Skills.sling" },
    { key: "system.skillBonuses.sling",          label: "NEUROSHIMA.Skills.sling",          prefix: "Bonus" },
    { key: "system.skills.car.value",            label: "NEUROSHIMA.Skills.car" },
    { key: "system.skillBonuses.car",            label: "NEUROSHIMA.Skills.car",            prefix: "Bonus" },
    { key: "system.skills.truck.value",          label: "NEUROSHIMA.Skills.truck" },
    { key: "system.skillBonuses.truck",          label: "NEUROSHIMA.Skills.truck",          prefix: "Bonus" },
    { key: "system.skills.motorcycle.value",     label: "NEUROSHIMA.Skills.motorcycle" },
    { key: "system.skillBonuses.motorcycle",     label: "NEUROSHIMA.Skills.motorcycle",     prefix: "Bonus" },
    { key: "system.skills.pickpocketing.value",  label: "NEUROSHIMA.Skills.pickpocketing" },
    { key: "system.skillBonuses.pickpocketing",  label: "NEUROSHIMA.Skills.pickpocketing",  prefix: "Bonus" },
    { key: "system.skills.sleightOfHand.value",  label: "NEUROSHIMA.Skills.sleightOfHand" },
    { key: "system.skillBonuses.sleightOfHand",  label: "NEUROSHIMA.Skills.sleightOfHand",  prefix: "Bonus" },
    { key: "system.skills.lockpicking.value",    label: "NEUROSHIMA.Skills.lockpicking" },
    { key: "system.skillBonuses.lockpicking",    label: "NEUROSHIMA.Skills.lockpicking",    prefix: "Bonus" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.SkillsPerception", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.skills.directionSense.value",    label: "NEUROSHIMA.Skills.directionSense" },
    { key: "system.skillBonuses.directionSense",    label: "NEUROSHIMA.Skills.directionSense",   prefix: "Bonus" },
    { key: "system.skills.tracking.value",          label: "NEUROSHIMA.Skills.tracking" },
    { key: "system.skillBonuses.tracking",          label: "NEUROSHIMA.Skills.tracking",         prefix: "Bonus" },
    { key: "system.skills.traps.value",             label: "NEUROSHIMA.Skills.traps" },
    { key: "system.skillBonuses.traps",             label: "NEUROSHIMA.Skills.traps",            prefix: "Bonus" },
    { key: "system.skills.listening.value",         label: "NEUROSHIMA.Skills.listening" },
    { key: "system.skillBonuses.listening",         label: "NEUROSHIMA.Skills.listening",        prefix: "Bonus" },
    { key: "system.skills.spotting.value",          label: "NEUROSHIMA.Skills.spotting" },
    { key: "system.skillBonuses.spotting",          label: "NEUROSHIMA.Skills.spotting",         prefix: "Bonus" },
    { key: "system.skills.vigilance.value",         label: "NEUROSHIMA.Skills.vigilance" },
    { key: "system.skillBonuses.vigilance",         label: "NEUROSHIMA.Skills.vigilance",        prefix: "Bonus" },
    { key: "system.skills.sneaking.value",          label: "NEUROSHIMA.Skills.sneaking" },
    { key: "system.skillBonuses.sneaking",          label: "NEUROSHIMA.Skills.sneaking",         prefix: "Bonus" },
    { key: "system.skills.hiding.value",            label: "NEUROSHIMA.Skills.hiding" },
    { key: "system.skillBonuses.hiding",            label: "NEUROSHIMA.Skills.hiding",           prefix: "Bonus" },
    { key: "system.skills.camouflage.value",        label: "NEUROSHIMA.Skills.camouflage" },
    { key: "system.skillBonuses.camouflage",        label: "NEUROSHIMA.Skills.camouflage",       prefix: "Bonus" },
    { key: "system.skills.hunting.value",           label: "NEUROSHIMA.Skills.hunting" },
    { key: "system.skillBonuses.hunting",           label: "NEUROSHIMA.Skills.hunting",          prefix: "Bonus" },
    { key: "system.skills.waterGathering.value",    label: "NEUROSHIMA.Skills.waterGathering" },
    { key: "system.skillBonuses.waterGathering",    label: "NEUROSHIMA.Skills.waterGathering",   prefix: "Bonus" },
    { key: "system.skills.terrainKnowledge.value",  label: "NEUROSHIMA.Skills.terrainKnowledge" },
    { key: "system.skillBonuses.terrainKnowledge",  label: "NEUROSHIMA.Skills.terrainKnowledge", prefix: "Bonus" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.SkillsCharisma", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.skills.persuasion.value",        label: "NEUROSHIMA.Skills.persuasion" },
    { key: "system.skillBonuses.persuasion",        label: "NEUROSHIMA.Skills.persuasion",       prefix: "Bonus" },
    { key: "system.skills.intimidation.value",      label: "NEUROSHIMA.Skills.intimidation" },
    { key: "system.skillBonuses.intimidation",      label: "NEUROSHIMA.Skills.intimidation",     prefix: "Bonus" },
    { key: "system.skills.leadership.value",        label: "NEUROSHIMA.Skills.leadership" },
    { key: "system.skillBonuses.leadership",        label: "NEUROSHIMA.Skills.leadership",       prefix: "Bonus" },
    { key: "system.skills.emotionPerception.value", label: "NEUROSHIMA.Skills.emotionPerception" },
    { key: "system.skillBonuses.emotionPerception", label: "NEUROSHIMA.Skills.emotionPerception", prefix: "Bonus" },
    { key: "system.skills.bluff.value",             label: "NEUROSHIMA.Skills.bluff" },
    { key: "system.skillBonuses.bluff",             label: "NEUROSHIMA.Skills.bluff",            prefix: "Bonus" },
    { key: "system.skills.animalCare.value",        label: "NEUROSHIMA.Skills.animalCare" },
    { key: "system.skillBonuses.animalCare",        label: "NEUROSHIMA.Skills.animalCare",       prefix: "Bonus" },
    { key: "system.skills.painResistance.value",    label: "NEUROSHIMA.Skills.painResistance" },
    { key: "system.skillBonuses.painResistance",    label: "NEUROSHIMA.Skills.painResistance",   prefix: "Bonus" },
    { key: "system.skills.steadfastness.value",     label: "NEUROSHIMA.Skills.steadfastness" },
    { key: "system.skillBonuses.steadfastness",     label: "NEUROSHIMA.Skills.steadfastness",    prefix: "Bonus" },
    { key: "system.skills.morale.value",            label: "NEUROSHIMA.Skills.morale" },
    { key: "system.skillBonuses.morale",            label: "NEUROSHIMA.Skills.morale",           prefix: "Bonus" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.SkillsCleverness", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.skills.woundTreatment.value",    label: "NEUROSHIMA.Skills.woundTreatment" },
    { key: "system.skillBonuses.woundTreatment",    label: "NEUROSHIMA.Skills.woundTreatment",   prefix: "Bonus" },
    { key: "system.skills.diseaseTreatment.value",  label: "NEUROSHIMA.Skills.diseaseTreatment" },
    { key: "system.skillBonuses.diseaseTreatment",  label: "NEUROSHIMA.Skills.diseaseTreatment", prefix: "Bonus" },
    { key: "system.skills.firstAid.value",          label: "NEUROSHIMA.Skills.firstAid" },
    { key: "system.skillBonuses.firstAid",          label: "NEUROSHIMA.Skills.firstAid",         prefix: "Bonus" },
    { key: "system.skills.mechanics.value",         label: "NEUROSHIMA.Skills.mechanics" },
    { key: "system.skillBonuses.mechanics",         label: "NEUROSHIMA.Skills.mechanics",        prefix: "Bonus" },
    { key: "system.skills.electronics.value",       label: "NEUROSHIMA.Skills.electronics" },
    { key: "system.skillBonuses.electronics",       label: "NEUROSHIMA.Skills.electronics",      prefix: "Bonus" },
    { key: "system.skills.computers.value",         label: "NEUROSHIMA.Skills.computers" },
    { key: "system.skillBonuses.computers",         label: "NEUROSHIMA.Skills.computers",        prefix: "Bonus" },
    { key: "system.skills.heavyMachinery.value",    label: "NEUROSHIMA.Skills.heavyMachinery" },
    { key: "system.skillBonuses.heavyMachinery",    label: "NEUROSHIMA.Skills.heavyMachinery",   prefix: "Bonus" },
    { key: "system.skills.combatVehicles.value",    label: "NEUROSHIMA.Skills.combatVehicles" },
    { key: "system.skillBonuses.combatVehicles",    label: "NEUROSHIMA.Skills.combatVehicles",   prefix: "Bonus" },
    { key: "system.skills.boats.value",             label: "NEUROSHIMA.Skills.boats" },
    { key: "system.skillBonuses.boats",             label: "NEUROSHIMA.Skills.boats",            prefix: "Bonus" },
    { key: "system.skills.gunsmithing.value",       label: "NEUROSHIMA.Skills.gunsmithing" },
    { key: "system.skillBonuses.gunsmithing",       label: "NEUROSHIMA.Skills.gunsmithing",      prefix: "Bonus" },
    { key: "system.skills.launchers.value",         label: "NEUROSHIMA.Skills.launchers" },
    { key: "system.skillBonuses.launchers",         label: "NEUROSHIMA.Skills.launchers",        prefix: "Bonus" },
    { key: "system.skills.explosives.value",        label: "NEUROSHIMA.Skills.explosives" },
    { key: "system.skillBonuses.explosives",        label: "NEUROSHIMA.Skills.explosives",       prefix: "Bonus" },
    { key: "system.skills.knowledge1.value",        label: "NEUROSHIMA.Skills.knowledge1" },
    { key: "system.skillBonuses.knowledge1",        label: "NEUROSHIMA.Skills.knowledge1",       prefix: "Bonus" },
    { key: "system.skills.knowledge2.value",        label: "NEUROSHIMA.Skills.knowledge2" },
    { key: "system.skillBonuses.knowledge2",        label: "NEUROSHIMA.Skills.knowledge2",       prefix: "Bonus" },
    { key: "system.skills.knowledge3.value",        label: "NEUROSHIMA.Skills.knowledge3" },
    { key: "system.skillBonuses.knowledge3",        label: "NEUROSHIMA.Skills.knowledge3",       prefix: "Bonus" },
    { key: "system.skills.knowledge4.value",        label: "NEUROSHIMA.Skills.knowledge4" },
    { key: "system.skillBonuses.knowledge4",        label: "NEUROSHIMA.Skills.knowledge4",       prefix: "Bonus" },
    { key: "system.skills.knowledge5.value",        label: "NEUROSHIMA.Skills.knowledge5" },
    { key: "system.skillBonuses.knowledge5",        label: "NEUROSHIMA.Skills.knowledge5",       prefix: "Bonus" },
    { key: "system.skills.knowledge6.value",        label: "NEUROSHIMA.Skills.knowledge6" },
    { key: "system.skillBonuses.knowledge6",        label: "NEUROSHIMA.Skills.knowledge6",       prefix: "Bonus" }
  ]},
  { group: "NEUROSHIMA.Effects.Keys.Group.SkillsConstitution", actorTypes: ["character", "npc", "creature"], keys: [
    { key: "system.skills.swimming.value",          label: "NEUROSHIMA.Skills.swimming" },
    { key: "system.skillBonuses.swimming",          label: "NEUROSHIMA.Skills.swimming",         prefix: "Bonus" },
    { key: "system.skills.climbing.value",          label: "NEUROSHIMA.Skills.climbing" },
    { key: "system.skillBonuses.climbing",          label: "NEUROSHIMA.Skills.climbing",         prefix: "Bonus" },
    { key: "system.skills.stamina.value",           label: "NEUROSHIMA.Skills.stamina" },
    { key: "system.skillBonuses.stamina",           label: "NEUROSHIMA.Skills.stamina",          prefix: "Bonus" },
    { key: "system.skills.horseRiding.value",       label: "NEUROSHIMA.Skills.horseRiding" },
    { key: "system.skillBonuses.horseRiding",       label: "NEUROSHIMA.Skills.horseRiding",      prefix: "Bonus" },
    { key: "system.skills.drivingCarriage.value",   label: "NEUROSHIMA.Skills.drivingCarriage" },
    { key: "system.skillBonuses.drivingCarriage",   label: "NEUROSHIMA.Skills.drivingCarriage",  prefix: "Bonus" },
    { key: "system.skills.taming.value",            label: "NEUROSHIMA.Skills.taming" },
    { key: "system.skillBonuses.taming",            label: "NEUROSHIMA.Skills.taming",           prefix: "Bonus" }
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

    if (this.document.getFlag("neuroshima", "conditionNumbered")) {
      const statusesField = this.element.querySelector("multi-select[name='statuses']");
      if (statusesField) {
        statusesField.setAttribute("disabled", "");
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = game.i18n.localize("NEUROSHIMA.Conditions.StatusLocked");
        statusesField.closest(".form-group")?.appendChild(hint);
      }
    }

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
        option.textContent = (keyDef.prefix ? keyDef.prefix + " " : "") + game.i18n.localize(keyDef.label);
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

    if (this.document.getFlag("neuroshima", "conditionNumbered")) {
      delete submitData.statuses;
    }

    if (this.document._isSyntheticConditionTemplate) {
      return this.document.update(submitData);
    }
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
