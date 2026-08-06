import {
  MELEE_SETTING,
  MeleeActionCatalog,
  MeleeMigration,
  normalizeMeleeActivity,
  isMeleeV2Enabled
} from "../combat/melee-system.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Shared declarative editor for Item and ActiveEffect melee activities. */
export class MeleeActivityEditor extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  constructor(document, activityId = null, options = {}) {
    super(options);
    this.document = document;
    this.activityId = activityId;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "melee-v2-editor"],
    window: { resizable: true },
    position: { width: 620, height: 720 },
    form: { handler: MeleeActivityEditor._submit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      addCondition: MeleeActivityEditor._addCondition,
      addOperation: MeleeActivityEditor._addOperation,
      newActivity: MeleeActivityEditor._newActivity,
      editActivity: MeleeActivityEditor._editActivity,
      removeActivity: MeleeActivityEditor._removeActivity
    }
  };

  static PARTS = { form: { template: "systems/neuroshima/templates/apps/melee-v2-config.hbs" } };

  get title() { return `Melee V2: ${this.document.name}`; }

  get activities() {
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      return Array.from(this.document.system?.activities ?? []);
    }
    return this.document.documentName === "ActiveEffect"
      ? Array.from(this.document.system?.melee?.grantedActivities ?? [])
      : Array.from(this.document.getFlag("neuroshima", "meleeActivities") ?? []);
  }

  async _prepareContext() {
    const existing = this.activities.find(activity => activity.id === this.activityId);
    const activity = normalizeMeleeActivity(existing ?? {
      id: foundry.utils.randomID(), name: "Nowa akcja melee", category: "attack",
      activation: { role: "either", timing: "declaration", minDice: 1, maxDice: 3, successCost: 0, segmentCost: 0 },
      automation: { approval: "gm", resolver: "opposedSuccessPoints" }
    });
    this.activityId = activity.id;
    return {
      activity,
      activityList: this.activities.map(entry => ({ id: entry.id, name: entry.name || entry.label || entry.id })),
      tagsText: activity.tags.join(", "),
      conditionsJson: JSON.stringify(activity.conditions, null, 2),
      outcomesJson: JSON.stringify(activity.outcomes, null, 2),
      operationsJson: JSON.stringify(activity.operations, null, 2),
      expiryRulesJson: JSON.stringify(this.document.system?.melee?.expiryRules ?? [], null, 2),
      modifiersJson: JSON.stringify(this.document.system?.melee?.modifiers ?? [], null, 2),
      restrictionsJson: JSON.stringify(this.document.system?.melee?.restrictions ?? [], null, 2),
      isEffect: this.document.documentName === "ActiveEffect",
      melee: this.document.system?.melee?.toObject?.() ?? this.document.system?.melee ?? {}
    };
  }

  static async _submit(_event, form, formData) {
    const data = formData.object;
    const parse = (value, label) => {
      try { return JSON.parse(value || "[]"); }
      catch (_error) { throw new Error(`${label}: niepoprawny JSON`); }
    };
    const normalized = normalizeMeleeActivity({
      id: this.activityId,
      name: data.name,
      description: data.description,
      category: data.category,
      tags: String(data.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
      activation: {
        role: data.role, timing: data.timing,
        minDice: Number(data.minDice), maxDice: Number(data.maxDice),
        successCost: Number(data.successCost), segmentCost: Number(data.segmentCost),
        reusableDice: data.reusableDice === true
      },
      conditions: parse(data.conditionsJson, "Warunki"),
      outcomes: parse(data.outcomesJson, "Wyniki"),
      operations: parse(data.operationsJson, "Operacje"),
      automation: { approval: data.approval, resolver: data.resolver }
    });
    const previous = this.activities.find(entry => entry.id === this.activityId);
    const activity = { ...(previous?.toObject?.() ?? previous ?? {}), ...normalized };
    const activities = this.activities.map(entry => entry.id === activity.id ? activity : entry);
    if (!activities.some(entry => entry.id === activity.id)) activities.push(activity);
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      await this.document.update({ "system.activities": activities });
    } else if (this.document.documentName === "ActiveEffect") {
      await this.document.update({
        "system.melee.stackKey": data.stackKey || "",
        "system.melee.stackMode": data.stackMode || "ignore",
        "system.melee.modifiers": parse(data.modifiersJson, "Modyfikatory"),
        "system.melee.restrictions": parse(data.restrictionsJson, "Ograniczenia"),
        "system.melee.expiryRules": parse(data.expiryRulesJson, "Wygasanie"),
        "system.melee.grantedActivities": activities
      });
    } else await this.document.setFlag("neuroshima", "meleeActivities", activities);
    ui.notifications.info("Zapisano definicję Melee V2.");
    this.render({ force: true });
  }

  static _addCondition() {
    const textarea = this.element.querySelector('[name="conditionsJson"]');
    const values = JSON.parse(textarea.value || "[]");
    values.push({ key: "always" });
    textarea.value = JSON.stringify(values, null, 2);
  }

  static _addOperation() {
    const textarea = this.element.querySelector('[name="operationsJson"]');
    const values = JSON.parse(textarea.value || "[]");
    values.push({ id: foundry.utils.randomID(), type: "chatEntry", target: "opponent", data: { text: "" } });
    textarea.value = JSON.stringify(values, null, 2);
  }

  static _newActivity() {
    this.activityId = foundry.utils.randomID();
    this.render({ force: true });
  }

  static _editActivity(_event, target) {
    this.activityId = target.closest("[data-activity-id]")?.dataset.activityId;
    this.render({ force: true });
  }

  static async _removeActivity(_event, target) {
    const id = target.closest("[data-activity-id]")?.dataset.activityId;
    if (!id) return;
    const activities = this.activities.filter(entry => entry.id !== id);
    if (["beast-action", "beast-segment"].includes(this.document.type)) {
      await this.document.update({ "system.activities": activities });
    } else if (this.document.documentName === "ActiveEffect") {
      await this.document.update({ "system.melee.grantedActivities": activities });
    } else await this.document.setFlag("neuroshima", "meleeActivities", activities);
    this.activityId = activities[0]?.id ?? foundry.utils.randomID();
    this.render({ force: true });
  }
}

export class MeleeSessionPresenter {
  static async context(session) {
    const ownerSide = session.participants.attacker.actorUuid === session.initiative.ownerId ? "attacker" : "defender";
    const activities = {};
    for (const side of ["attacker", "defender"]) {
      const participant = session.participants[side];
      const doc = await fromUuid(participant.tokenUuid || participant.actorUuid);
      const actor = doc?.actor ?? doc;
      const weapon = participant.weaponUuid ? await fromUuid(participant.weaponUuid) : null;
      activities[side] = actor ? MeleeActionCatalog.collect(actor, { item: weapon }).map(activity => ({
        ...activity,
        sourceItemUuid: activity.source.itemUuid,
        sourceEffectUuid: activity.source.effectUuid
      })) : [];
    }
    return {
      session,
      ownerSide,
      responderSide: ownerSide === "attacker" ? "defender" : "attacker",
      ownerActivities: activities[ownerSide],
      responderActivities: activities[ownerSide === "attacker" ? "defender" : "attacker"],
      ownerName: session.participants[ownerSide].name,
      activities,
      canGM: game.user.isGM,
      canAct: Object.fromEntries(["attacker", "defender"].map(side => [side,
        game.user.isGM || session.participants[side].userIds.includes(game.user.id)
      ])),
      isAwaitingAttacker: session.phase === "awaitingAttackerRoll",
      isAwaitingDefender: session.phase === "awaitingDefenderRoll",
      isDeclaration: session.phase === "declaration",
      isResponse: session.phase === "response",
      isPending: session.phase === "pendingOutcomes",
      canAdvance: session.phase === "resolution",
      isComplete: session.phase === "complete"
    };
  }

  static async renderMessage(message, root) {
    if (!isMeleeV2Enabled()) return;
    const marker = message.getFlag("neuroshima", "melee");
    if (!marker?.sessionId) return;
    const session = await game.neuroshima.melee.get(marker.sessionId, { messageId: message.id });
    if (!session) return;
    const shell = root.querySelector?.(".melee-session-v2-shell") ?? root.querySelector?.("[data-melee-session-id]");
    if (!shell) return;
    shell.innerHTML = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/melee-session-v2.hbs",
      await this.context(session)
    );
    this.activate(shell, session);
  }

  static activate(root, session) {
    root.querySelectorAll("[data-melee-command]").forEach(button => button.addEventListener("click", async event => {
      event.preventDefault();
      const type = button.dataset.meleeCommand;
      const side = button.dataset.side;
      const payload = {};
      if (type === "roll") {
        const participant = session.participants[side];
        const actorDoc = await fromUuid(participant.tokenUuid || participant.actorUuid);
        const actor = actorDoc?.actor ?? actorDoc;
        let weapon = participant.weaponUuid ? await fromUuid(participant.weaponUuid) : null;
        if (["beast-action", "beast-segment"].includes(weapon?.type)) {
          const beastItem = weapon;
          const byTier = {};
          for (const activity of beastItem.system.activities ?? []) {
            const tier = Math.min(3, Math.max(1, Number(activity.successCost ?? activity.segmentCost ?? 1)));
            byTier[tier] ??= activity.damage || activity.damage1 || "D";
          }
          weapon = {
            id: null, name: beastItem.name, img: beastItem.img, type: "weapon",
            system: {
              weaponType: "melee", attribute: beastItem.system.attribute || "dexterity", skill: "experience",
              attackBonus: 0, defenseBonus: 0, piercing: 0,
              damageMelee1: byTier[1] ?? byTier[2] ?? byTier[3] ?? "D",
              damageMelee2: byTier[2] ?? byTier[1] ?? byTier[3] ?? "D",
              damageMelee3: byTier[3] ?? byTier[2] ?? byTier[1] ?? "D"
            }
          };
        }
        weapon ??= {
          id: null, name: "Walka bez broni", img: actor?.img, type: "weapon",
          system: { weaponType: "melee", attribute: "dexterity", skill: "melee",
            attackBonus: 0, defenseBonus: 0, damageMelee1: "D", damageMelee2: "D", damageMelee3: "D", piercing: 0 }
        };
        const { NeuroshimaWeaponRollDialog } = await import("./dialogs/weapon-roll-dialog.js");
        new NeuroshimaWeaponRollDialog({
          actor, weapon, rollType: "melee",
          meleeAction: side === "attacker" ? "attack" : "defense",
          targets: [], isPoolRoll: true,
          onRoll: async result => {
            const dice = (result.modifiedResults ?? []).map((die, index) => ({
              id: die.id || `die-${index + 1}-${foundry.utils.randomID(6)}`,
              raw: die.original ?? result.rawResults?.[index], modified: die.modified,
              target: result.target, isSuccess: die.isSuccess === true,
              changes: result.diceChanges?.filter(change => change.index === index) ?? []
            }));
            return game.neuroshima.melee.dispatch({
              type: "submitRoll", side, payload: { dice }, sessionId: session.id,
              messageId: session.messageId, expectedRevision: session.revision,
              commandId: foundry.utils.randomID()
            });
          }
        }).render(true);
        return;
      }
      if (type === "approveOutcome") payload.outcomeId = button.dataset.outcomeId;
      if (["declare", "respond"].includes(type)) {
        const select = root.querySelector(`[data-activity-select="${side}"]`);
        const option = select?.selectedOptions?.[0];
        payload.activity = {
          activityId: option?.dataset.activityId,
          sourceItemUuid: option?.dataset.sourceItemUuid || null,
          sourceEffectUuid: option?.dataset.sourceEffectUuid || null
        };
        payload.diceIds = Array.from(root.querySelectorAll(`[data-die-side="${side}"]:checked`)).map(input => input.value);
      }
      try {
        await game.neuroshima.melee.dispatch({
          type, side, payload, sessionId: session.id, messageId: session.messageId,
          expectedRevision: session.revision, commandId: foundry.utils.randomID()
        });
      } catch (error) {
        ui.notifications.error(error.message);
      }
    }));
  }
}

function injectEditorButton(app, element) {
  if (!isMeleeV2Enabled() || !app.document?.isOwner) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector(".window-header");
  if (!header || header.querySelector("[data-open-melee-v2]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.openMeleeV2 = "";
  button.className = "header-control icon fa-solid fa-swords";
  button.dataset.tooltip = "Konfiguracja Melee V2";
  button.addEventListener("click", () => new MeleeActivityEditor(app.document).render(true));
  header.querySelector(".close")?.before(button);
}

function projectTracker(html) {
  if (!isMeleeV2Enabled()) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  for (const session of game.neuroshima.melee.list()) {
    if (session.status !== "active") continue;
    for (const side of ["attacker", "defender"]) {
      const participant = session.participants[side];
      const combatant = game.combat?.combatants.find(entry =>
        entry.actor?.uuid === participant.actorUuid || entry.token?.uuid === participant.tokenUuid);
      const row = root?.querySelector(`[data-combatant-id="${combatant?.id}"]`);
      if (!row) continue;
      const badge = document.createElement("span");
      badge.className = "melee-v2-tracker-badge";
      badge.dataset.tooltip = `Melee: ${session.participants[side === "attacker" ? "defender" : "attacker"].name}`;
      badge.innerHTML = session.initiative.ownerId === participant.actorUuid
        ? '<i class="fa-solid fa-swords"></i>'
        : '<i class="fa-regular fa-shield"></i>';
      row.querySelector(".token-name")?.append(badge);
    }
  }
}

export function registerMeleeSystemUI() {
  Hooks.on("renderChatMessageHTML", (message, html) => MeleeSessionPresenter.renderMessage(message, html));
  Hooks.on("renderChatMessage", (message, html) => MeleeSessionPresenter.renderMessage(message, html));
  Hooks.on("renderNeuroshimaItemSheet", injectEditorButton);
  Hooks.on("renderNeuroshimaEffectSheet", injectEditorButton);
  Hooks.on("renderCombatTracker", (_app, html) => projectTracker(html));
  Hooks.on("neuroshimaMeleeSessionUpdated", session => {
    const message = game.messages.get(session.messageId);
    if (message) ui.chat?.updateMessage?.(message);
    ui.combat?.render?.();
  });
  game.neuroshima.melee.openEditor = (document, activityId) => new MeleeActivityEditor(document, activityId).render(true);
  game.neuroshima.melee.dryRun = options => MeleeMigration.dryRun(options);
}

export function registerMeleeV2SettingMenuHint() {
  // Kept as a separate hook so worlds can expose the feature flag without
  // automatically opening or migrating any document.
  return MELEE_SETTING;
}
