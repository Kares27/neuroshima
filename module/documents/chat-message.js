import { NEUROSHIMA } from "../config.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";

/**
 * Rozszerzona klasa ChatMessage z ujednoliconym API renderowania kart czatu.
 * Zapewnia czysty interfejs do tworzenia i renderowania wszystkich typów wiadomości.
 */
export class NeuroshimaChatMessage extends ChatMessage {

  /**
   * Główny dispatcher akcji na kartach czatu.
   * Wywoływany z hooka renderChatMessageHTML w system.js.
   */
  static onChatAction(html) {
    // Application V2 compatibility: html can be a HTMLElement or a jQuery object
    const root = (html instanceof HTMLElement) ? html : html[0];
    if (!root) return;

    // Pobierz wiadomość powiązaną z HTMLem
    const messageId = root.closest(".chat-message")?.dataset.messageId;
    const message = game.messages.get(messageId);
    if (!message) return;

    // Delegacja zdarzeń dla przycisków akcji
    root.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.preventDefault();
        const action = btn.dataset.action;
        
        switch (action) {
          case "reroll-healing":
            this.onRerollHealing(event, message);
            break;
          case "apply-healing":
            this.onApplyHealing(event, message);
            break;
          case "openHealPanel":
            this.onOpenHealPanel(event, message);
            break;
          case "start-melee":
            this.onStartMeleeDuel(event, message);
            break;
          case "meleeOpposedDefend":
            this.onMeleeOpposedDefend(event, btn, message);
            break;
          case "applyOpposedDamage":
            this.onApplyOpposedDamage(event, message);
            break;
          case "executeRequiredTest":
            this.onExecuteRequiredTest(event, message);
            break;
          case "placeGrenadeTemplate":
            this.onPlaceGrenadeTemplate(event, btn, message);
            break;
          case "applyGrenadeDamage":
            this.onApplyGrenadeDamage(event, message);
            break;
        }
      });
    });

    this._bindResultCardCollapsibles(root);

    root.querySelectorAll(".item-card-draggable[data-uuid]").forEach(el => {
      el.addEventListener("dragstart", event => {
        const uuid = el.dataset.uuid;
        if (!uuid) return;

        const messageId = root.closest(".chat-message")?.dataset.messageId;
        const message = messageId ? game.messages.get(messageId) : null;
        const cardData = message?.getFlag("neuroshima", "itemCard");

        if (cardData && cardData.remaining !== null && cardData.remaining <= 0) {
          event.preventDefault();
          return;
        }

        event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid, fromChatCard: true, messageId }));
      });
    });
  }

  /**
   * Rozpoczyna starcie w zwarciu na podstawie rzutu bronią.
   */
  static async onStartMeleeDuel(event, message) {
    const flags = message.getFlag("neuroshima", "rollData");
    if (!flags || !flags.isMelee) return;

    const attackerId = flags.actorId;
    const targets = flags.targets || [];

    if (targets.length === 0) {
        ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoMeleeTarget"));
        return;
    }

    // Jeśli jest wielu przeciwników, bierzemy pierwszego jako głównego (standard 1v1)
    // TODO: Obsługa wielu przeciwników w NeuroshimaMeleeCombat.startDuel
    const defenderId = targets[0];

    const { NeuroshimaMeleeCombat } = await import("../combat/melee-combat.js");
    await NeuroshimaMeleeCombat.startDuel(attackerId, defenderId);
  }

  /**
   * Defender clicks a weapon (or Unarmed) button on the melee-opposed handler card.
   * `btn.dataset.weaponId` is the defender's item ID (empty string = unarmed).
   */
  static async onMeleeOpposedDefend(event, btn, message) {
    const weaponId = btn.dataset.weaponId || null;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.defendFromChat(message.id, weaponId);
  }

  static async onApplyOpposedDamage(event, message) {
    const btn = event.currentTarget;
    const { MeleeOpposedChat } = await import("../combat/melee-opposed-chat.js");
    await MeleeOpposedChat.applyOpposedDamage(message.id);
    // Immediately disable the button in the DOM for the clicking user
    if (btn) {
      btn.disabled = true;
      btn.classList.add("applied");
      btn.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("NEUROSHIMA.MeleeOpposedChat.DamageApplied")}`;
    }
  }

  static _bindResultCardCollapsibles(root) {
    root.querySelectorAll(".neuroshima.item-card .item-card-collapsible-header").forEach(header => {
      header.addEventListener("click", () => {
        const content = header.nextElementSibling;
        if (!content) return;
        const isCollapsed = content.classList.toggle("collapsed");
        header.querySelector(".item-card-chevron")?.classList.toggle("expanded", !isCollapsed);
      });
    });
  }

  static async onExecuteRequiredTest(event, message) {
    const data = message.getFlag("neuroshima", "requiredTestData");
    if (!data) return;

    const actor = game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.RequiredTest.NoActor"));
      return;
    }

    const actorUuid = actor.uuid;

    let resultCallback = null;
    if (data.onSuccess || data.onFailure) {
      const successConsequence = data.onSuccess ?? null;
      const failureConsequence = data.onFailure ?? null;
      resultCallback = async ({ isSuccess }) => {
        const target = await fromUuid(actorUuid);
        if (!target) return;
        const consequence = isSuccess ? successConsequence : failureConsequence;
        if (!consequence) return;
        const actions = Array.isArray(consequence) ? consequence : [consequence];
        for (const action of actions) {
          if (action.addCondition) await target.addCondition(action.addCondition, action.value ?? 1);
        }
        game.neuroshima?.log("onExecuteRequiredTest | consequence applied", { actorUuid, isSuccess, consequence });
      };
    }

    const { NeuroshimaSkillRollDialog } = await import("../apps/skill-roll-dialog.js");
    const lastRoll = { ...(actor.system?.lastRoll ?? {}), isOpen: data.isOpen };

    if (data.testType === "skill") {
      let attrKey = "";
      for (const [aKey, specs] of Object.entries(NEUROSHIMA.skillConfiguration ?? {})) {
        for (const skills of Object.values(specs)) {
          if (skills.includes(data.testKey)) { attrKey = aKey; break; }
        }
        if (attrKey) break;
      }
      const stat = actor.system?.attributeTotals?.[attrKey] ?? 0;
      const skill = actor.system?.skillTotals?.[data.testKey] ?? actor.system?.skills?.[data.testKey]?.value ?? 0;
      const loc = `NEUROSHIMA.Skills.${data.testKey}`;
      const translated = game.i18n.localize(loc);
      const label = data.title || (translated !== loc ? translated : data.testKey);

      const dialog = new NeuroshimaSkillRollDialog({ actor, stat, skill, label, isSkill: true, skillKey: data.testKey, currentAttribute: attrKey, lastRoll, resultCallback });
      dialog.render(true);
    } else if (data.testType === "attribute") {
      const stat = actor.system?.attributeTotals?.[data.testKey] ?? 0;
      const attrDef = NEUROSHIMA.attributes?.[data.testKey];
      const label = data.title || (attrDef?.label ? game.i18n.localize(attrDef.label) : data.testKey);

      const dialog = new NeuroshimaSkillRollDialog({ actor, stat, skill: 0, label, isSkill: false, currentAttribute: data.testKey, lastRoll, resultCallback });
      dialog.render(true);
    }
  }

  static _setTokenTargets(tokenIds) {
    const currentIds = new Set(Array.from(game.user.targets).map(t => t.id));
    for (const t of Array.from(game.user.targets)) {
      if (!tokenIds.includes(t.id))
        t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
    }
    for (const id of tokenIds) {
      if (!currentIds.has(id)) {
        const t = canvas?.tokens?.get(id);
        if (t) t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
      }
    }
  }

  static _clearTokenTargets() {
    for (const t of Array.from(game.user.targets)) {
      t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
    }
  }

  /**
   * Place a grenade blast circle template on the canvas.
   * After placement, computes blast zone damage for all tokens inside and posts a results chat message.
   */
  static async onPlaceGrenadeTemplate(event, btn, message) {
    return this.startGrenadeTemplatePlacement(message);
  }

  static async _deleteExistingGrenadeTemplates(messageId) {
    if (!canvas?.scene || !messageId) return;
    const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
    await NeuroshimaSocket.gmExecute("deleteGrenadeTemplates", messageId);
  }

  static async placeGrenadeTemplateAt(message, point) {
    if (!canvas?.scene) return;

    const grenadeData = message.getFlag("neuroshima", "grenadeRoll");
    if (!grenadeData) return;

    const radius     = Number(grenadeData.templateRadius ?? 0);
    const blastZones = grenadeData.blastZones ?? [];
    if (!radius) return;

    await this._deleteExistingGrenadeTemplates(message.id);

    const snapPos = (x, y) => {
      try {
        if (canvas.grid?.getSnappedPoint)
          return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
        return { x, y };
      } catch (e) { return { x, y }; }
    };

    const snapped = snapPos(point.x, point.y);

    const templateData = {
      t: "circle",
      user: game.user.id,
      x: snapped.x,
      y: snapped.y,
      distance: radius,
      fillColor: game.user.color ?? "#FF0000",
      flags: {
        neuroshima: {
          isGrenadeTemplate: true,
          grenadeBlastZones: blastZones,
          grenadeMessageId: message.id
        }
      }
    };

    const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
    await NeuroshimaSocket.gmExecute("createGrenadeTemplate", templateData);
  }

  static async startGrenadeTemplatePlacement(message) {
    if (!canvas?.scene) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.NoScene"));
      return;
    }

    const grenadeData = message.getFlag("neuroshima", "grenadeRoll");
    if (!grenadeData) return;

    const radius     = Number(grenadeData.templateRadius ?? 0);
    const blastZones = grenadeData.blastZones ?? [];

    if (!radius) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Grenade.NoRadius"));
      return;
    }

    await this._deleteExistingGrenadeTemplates(message.id);

    const templateData = {
      t: "circle",
      user: game.user.id,
      x: 0,
      y: 0,
      distance: radius,
      fillColor: game.user.color ?? "#FF0000",
      flags: {
        neuroshima: {
          isGrenadeTemplate: true,
          grenadeBlastZones: blastZones,
          grenadeMessageId: message.id
        }
      }
    };

    canvas.templates.activate();

    const doc = new CONFIG.MeasuredTemplate.documentClass(templateData, { parent: canvas.scene });
    let previewObj = null;

    try {
      previewObj = new CONFIG.MeasuredTemplate.objectClass(doc);
      canvas.templates.preview.addChild(previewObj);
      await previewObj.draw();
    } catch (e) {
      console.warn("Neuroshima | Template preview draw failed:", e);
      previewObj = null;
    }

    const snapPos = (x, y) => {
      try {
        if (canvas.grid?.getSnappedPoint) {
          return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
        }
        return canvas.grid?.getSnappedPosition?.(x, y, 1) ?? { x, y };
      } catch (e) { return { x, y }; }
    };

    const updateDynamicTargets = (originX, originY) => {
      if (!previewObj?.shape || !canvas?.tokens?.placeables) return;
      const gs = canvas.grid?.size ?? 100;
      const targetIds = canvas.tokens.placeables
        .filter(tokenObj => {
          const td = tokenObj.document;
          const cx = td.x + (td.width  * gs) / 2;
          const cy = td.y + (td.height * gs) / 2;
          return previewObj.shape.contains(cx - originX, cy - originY);
        })
        .map(t => t.id);
      NeuroshimaChatMessage._setTokenTargets(targetIds);
    };

    const updatePreview = (x, y) => {
      const pos = snapPos(x, y);
      try { doc.updateSource(pos); previewObj?.refresh?.(); } catch (e) {}
      updateDynamicTargets(pos.x, pos.y);
    };

    const cleanup = (clearTargets = true) => {
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      canvas.stage.off("rightdown", onRight);
      if (clearTargets) NeuroshimaChatMessage._clearTokenTargets();
      if (previewObj) {
        try { canvas.templates.preview.removeChild(previewObj); previewObj.destroy({ children: true }); } catch (e) {}
        previewObj = null;
      }
    };

    const onMove = (pixi_event) => {
      try {
        const global = pixi_event.global ?? pixi_event.data?.global;
        if (!global) return;
        const pos = canvas.stage.toLocal(global);
        updatePreview(pos.x, pos.y);
      } catch (e) {}
    };

    const onDown = async (pixi_event) => {
      const button = pixi_event.button ?? pixi_event.data?.button;
      if (button !== 0) return;
      try {
        const global = pixi_event.global ?? pixi_event.data?.global;
        const raw = global ? canvas.stage.toLocal(global) : { x: doc.x, y: doc.y };
        const snapped = snapPos(raw.x, raw.y);
        cleanup(false);
        const data = { ...templateData, ...snapped };
        const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
        await NeuroshimaSocket.gmExecute("createGrenadeTemplate", data);
      } catch (e) {
        console.error("Neuroshima | Template placement failed:", e);
        cleanup();
      }
    };

    const onRight = () => { cleanup(true); };

    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    canvas.stage.on("rightdown", onRight);
  }

  /**
   * Compute grenade blast damage for tokens within a placed template.
   * Targets all tokens inside the radius, rolls random locations, and posts a
   * damage-application card with a collapsible per-target damage section.
   * @param {MeasuredTemplateDocument} templateDoc
   * @param {Array} blastZones
   * @param {Actor|null} sourceActor
   * @param {ChatMessage|null} sourceMessage
   */
  static async _computeGrenadeBlast(templateDoc, blastZones, sourceActor, sourceMessage) {
    game.neuroshima.group("_computeGrenadeBlast");

    let templateObj = canvas.templates.get(templateDoc.id);
    if (!templateObj?.shape) {
      await new Promise(r => setTimeout(r, 150));
      templateObj = canvas.templates.get(templateDoc.id);
    }

    game.neuroshima.log("Stan szablonu", {
      templateId: templateDoc.id, found: !!templateObj, hasShape: !!templateObj?.shape,
      blastZonesCount: blastZones.length, tokenCount: canvas.scene.tokens.size
    });

    if (!templateObj?.shape) {
      game.neuroshima.log("BŁĄD: brak obiektu PIXI szablonu po opóźnieniu");
      game.neuroshima.groupEnd();
      return;
    }

    const originX     = templateDoc.x;
    const originY     = templateDoc.y;
    const gs          = canvas.grid.size;
    const gridDist    = canvas.scene.grid.distance || 1;
    const NS          = game.neuroshima?.config ?? {};
    const bodyLocs    = NS.bodyLocations ?? {};

    const resolveLocation = async () => {
      const roll = await new Roll("1d20").evaluate();
      const val  = roll.total;
      const entry = Object.entries(bodyLocs).find(([, d]) => val >= d.roll[0] && val <= d.roll[1]);
      return entry ? { key: entry[0], label: entry[1].label } : { key: "torso", label: "NEUROSHIMA.Location.Torso" };
    };

    const sortedZones = [...blastZones].sort((a, b) => a.radius - b.radius);
    const rawResults = [];
    const targetIds = [];

    for (const tokenDoc of canvas.scene.tokens) {
      const centerX = tokenDoc.x + (tokenDoc.width  * gs) / 2;
      const centerY = tokenDoc.y + (tokenDoc.height * gs) / 2;
      const relX    = centerX - originX;
      const relY    = centerY - originY;
      if (!templateObj.shape.contains(relX, relY)) continue;

      targetIds.push(tokenDoc.id);

      const pixelDist = Math.sqrt(relX * relX + relY * relY);
      const metres    = (pixelDist / gs) * gridDist;
      const zone      = sortedZones.find(z => metres <= z.radius);

      game.neuroshima.log(`Token ${tokenDoc.name}`, { metres: metres.toFixed(2), zone });

      const actor     = tokenDoc.actor;
      const tokenName = tokenDoc.name || actor?.name || "?";

      const shrapnelCount = zone?.shrapnel ?? 0;
      const damage        = zone?.damage ?? "none";
      const loc = damage !== "none" ? await resolveLocation() : null;

      rawResults.push({
        tokenName,
        tokenId:       tokenDoc.id,
        actorId:       actor?.id ?? null,
        actorUuid:     actor?.uuid ?? null,
        distanceM:     Math.round(metres * 10) / 10,
        damage,
        locationKey:   loc?.key ?? null,
        locationLabel: loc?.label ?? null,
        knockdown:     zone?.knockdown ?? false,
        shrapnelCount
      });
    }

    NeuroshimaChatMessage._setTokenTargets(targetIds);
    game.neuroshima.log("Wyniki wybuchu", { rawResultsCount: rawResults.length });

    if (!rawResults.length) {
      game.neuroshima.groupEnd();
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.Grenade.NoTargetsInBlast"));
      return;
    }

    game.neuroshima.log("Wyniki wybuchu", { rawResultsCount: rawResults.length });

    if (sourceMessage) {
      const origData = sourceMessage.getFlag("neuroshima", "grenadeRoll") ?? {};
      const updatedChatData = {
        ...origData,
        blastResults: rawResults,
        damageApplied: false
      };
      const newContent = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
        updatedChatData
      );
      await sourceMessage.update({
        content: newContent,
        "flags.neuroshima.grenadeRoll": updatedChatData,
        "flags.neuroshima.grenadeResults": rawResults,
        "flags.neuroshima.damageApplied": false
      });
      game.neuroshima.log("Wyniki wybuchu dodane do istniejącej wiadomości");
    } else {
      const grenadeLabel = sourceActor?.name ?? game.i18n.localize("NEUROSHIMA.Items.Type.Weapon");
      const context = {
        actorId:         sourceActor?.id ?? null,
        actorImg:        sourceActor?.img ?? "icons/svg/mystery-man.svg",
        grenadeLabel,
        blastResults:    rawResults,
        damageApplied:   false
      };
      const template = "systems/neuroshima/templates/chat/grenade-blast-result.hbs";
      const content  = await this._renderTemplate(template, context);
      await this.create({
        user:    game.user.id,
        speaker: sourceActor ? ChatMessage.getSpeaker({ actor: sourceActor }) : undefined,
        content,
        style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
          neuroshima: {
            messageType:    "grenadeBlastResult",
            actorId:        sourceActor?.id ?? null,
            grenadeResults: rawResults,
            damageApplied:  false
          }
        }
      });
    }

    game.neuroshima.log("Karta wyników wybuchu opublikowana");
    game.neuroshima.groupEnd();
  }

  /**
   * Apply grenade blast damage to all targets listed in the blast result card.
   * Runs pain resistance rolls via CombatHelper infrastructure for each target.
   */
  static async onApplyGrenadeDamage(event, message) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Warnings.GMOnly"));
      return;
    }

    if (message.getFlag("neuroshima", "damageApplied")) {
      ui.notifications.info(game.i18n.localize("NEUROSHIMA.Grenade.BlastDamageApplied"));
      return;
    }

    const grenadeResults = message.getFlag("neuroshima", "grenadeResults")
      ?? message.getFlag("neuroshima", "grenadeRoll")?.blastResults
      ?? [];
    if (!grenadeResults.length) return;

    const btn = event.currentTarget;
    btn.disabled = true;

    const { CombatHelper } = await import("../helpers/combat-helper.js");

    const grenadeLabel = message.getFlag("neuroshima", "grenadeLabel")
      ?? message.getFlag("neuroshima", "grenadeRoll")?.label
      ?? game.i18n.localize("NEUROSHIMA.Items.Type.Weapon");

    const NS         = game.neuroshima?.config ?? {};
    const bodyLocs   = NS.bodyLocations ?? {};

    const resolveLocation = async () => {
      const roll  = await new Roll("1d20").evaluate();
      const val   = roll.total;
      const entry = Object.entries(bodyLocs).find(([, d]) => val >= d.roll[0] && val <= d.roll[1]);
      return entry ? { key: entry[0], label: entry[1].label } : { key: "torso", label: "NEUROSHIMA.Location.Torso" };
    };

    const actorDamages = [];

    for (const result of grenadeResults) {
      if (!result.actorUuid && !result.actorId) continue;

      let actor = null;
      if (result.actorUuid) {
        const doc = await fromUuid(result.actorUuid);
        actor = doc?.actor ?? doc;
      }
      if (!actor && result.actorId) actor = game.actors.get(result.actorId);
      if (!actor) continue;

      const combinedResults        = [];
      const combinedWoundIds       = [];
      let   combinedReduced        = 0;
      const combinedReducedDetails = [];
      const shrapnelRolled         = [];

      if (result.damage && result.damage !== "none" && result.locationKey) {
        const attackData = {
          damage:         result.damage,
          finalLocation:  result.locationKey,
          label:          grenadeLabel,
          isMelee:        false,
          isGrenade:      true,
          piercing:       0,
          hitBulletsData: [{ damage: result.damage, piercing: 0, successPoints: 1 }]
        };
        const partial = await CombatHelper.applyDamageToActor(actor, attackData, {
          location:          result.locationKey,
          attackerMessageId: message.id,
          suppressChat:      true
        });
        if (partial) {
          combinedResults.push(...(partial.results ?? []));
          combinedWoundIds.push(...(partial.woundIds ?? []));
          combinedReduced += partial.reducedProjectiles ?? 0;
          combinedReducedDetails.push(...(partial.reducedDetails ?? []));
        }
      }

      const shrapnelCount = result.shrapnelCount ?? 0;
      for (let s = 0; s < shrapnelCount; s++) {
        const sRoll = await new Roll("1d20").evaluate();
        const sv    = sRoll.total;
        let sDmg    = null;
        if      (sv <= 5)  sDmg = "C";
        else if (sv <= 10) sDmg = "L";
        else if (sv <= 15) sDmg = "D";

        const sLoc = await resolveLocation();
        shrapnelRolled.push({ roll: sv, damage: sDmg, locationKey: sLoc.key, locationLabel: sLoc.label });

        if (sDmg) {
          const sAttack = {
            damage:         sDmg,
            finalLocation:  sLoc.key,
            label:          grenadeLabel + " (odłamek)",
            isMelee:        false,
            isGrenade:      true,
            piercing:       0,
            hitBulletsData: [{ damage: sDmg, piercing: 0, successPoints: 1 }]
          };
          const sPartial = await CombatHelper.applyDamageToActor(actor, sAttack, {
            location:          sLoc.key,
            attackerMessageId: message.id,
            suppressChat:      true
          });
          if (sPartial) {
            combinedResults.push(...(sPartial.results ?? []));
            combinedWoundIds.push(...(sPartial.woundIds ?? []));
            combinedReduced += sPartial.reducedProjectiles ?? 0;
            combinedReducedDetails.push(...(sPartial.reducedDetails ?? []));
          }
        }
      }

      actorDamages.push({
        actorId:              actor.id,
        actorUuid:            actor.uuid,
        actorName:            actor.name,
        distanceM:            result.distanceM,
        damage:               result.damage,
        locationLabel:        result.locationLabel,
        knockdown:            result.knockdown,
        shrapnelRolled,
        results:              combinedResults,
        woundIds:             combinedWoundIds,
        reducedCount:         combinedReduced,
        reducedDetails:       combinedReducedDetails,
        passedCount:          combinedResults.filter(r => !r.isCritical && r.isPassed).length,
        failedCount:          combinedResults.filter(r => !r.isCritical && !r.isPassed).length,
        criticalCount:        combinedResults.filter(r => r.isCritical).length
      });
    }

    if (actorDamages.length > 0) {
      const allWoundIds = actorDamages.flatMap(d => d.woundIds);
      const content = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-blast-pain-report.hbs",
        { grenadeLabel, actorDamages, config: NEUROSHIMA ?? game.neuroshima?.config }
      );
      await this.create({
        user:    game.user.id,
        content,
        style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
        flags: {
          neuroshima: {
            messageType:  "grenadeBlastReport",
            grenadeLabel,
            actorDamages,
            allWoundIds,
            isReversed:   false
          }
        }
      });
    }

    await message.setFlag("neuroshima", "damageApplied", true);

    const grenadeRollData = message.getFlag("neuroshima", "grenadeRoll");
    if (grenadeRollData) {
      const updatedData = { ...grenadeRollData, damageApplied: true };
      const newContent = await this._renderTemplate(
        "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
        updatedData
      );
      await message.update({
        content: newContent,
        "flags.neuroshima.grenadeRoll": updatedData
      });
    } else {
      btn.textContent = "✓ " + game.i18n.localize("NEUROSHIMA.Grenade.BlastDamageApplied");
      btn.classList.add("applied");
    }
  }

  /**
   * Obsługa przerzutu leczenia.
   */
  static async onRerollHealing(event, message) {
    const btn = event.currentTarget;
    const woundId = btn.dataset.woundId;
    const card = btn.closest(".healing-batch-report");
    const patientUuid = card?.dataset.patientUuid;
    const medicUuid = card?.dataset.medicUuid;
    
    if (!patientUuid || !medicUuid) return;

    const patient = await fromUuid(patientUuid);
    const medic = await fromUuid(medicUuid);
    
    if (!patient || !medic) return;

    // Pobierz dane leczenia z flag
    const flags = message.getFlag("neuroshima");
    const method = flags.healingMethod;
    const extraData = flags.extraData || {};
    const woundConfig = extraData.woundConfigs?.find(c => c.woundId === woundId);
    
    if (!woundConfig) {
        ui.notifications.warn("Nie znaleziono konfiguracji rany dla przerzutu.");
        return;
    }

    // Trigger reroll via NeuroshimaDice
    const { NeuroshimaDice } = await import("../helpers/dice.js");
    const newResult = await NeuroshimaDice.rerollHealingTest(
        medic, 
        patient, 
        method, 
        woundConfig,
        extraData.stat,
        extraData.skillBonus,
        extraData.attributeBonus
    );

    if (newResult) {
        // Aktualizacja wyników w wiadomości
        const results = [...(flags.results || [])];
        const idx = results.findIndex(r => r.woundId === woundId);
        if (idx !== -1) {
            results[idx] = {
                ...results[idx],
                ...newResult
            };
            
            const successCount = results.filter(r => r.isSuccess).length;
            const failedCount = results.length - successCount;

            const context = {
                medicActor: medic,
                patientActor: patient,
                results,
                method,
                successCount,
                failedCount,
                patientRef: { uuid: patient.uuid },
                medicRef: { uuid: medic.uuid },
                config: NEUROSHIMA
            };

            const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
            const content = await this._renderTemplate(template, context);

            await message.update({
                content,
                "flags.neuroshima.results": results
            });
        }
    }
  }

  /**
   * Aplikuje wyniki leczenia do aktora.
   */
  static async onApplyHealing(event, message) {
    const btn = event.currentTarget;
    const card = btn.closest(".healing-batch-report");
    const patientUuid = card?.dataset.patientUuid;
    if (!patientUuid) return;

    const patient = await fromUuid(patientUuid);
    if (!patient) return;

    const results = message.getFlag("neuroshima", "results") || [];
    const updates = [];
    const toDelete = [];

    for (const r of results) {
        const wound = patient.items.get(r.woundId);
        if (!wound || wound.type !== "wound") continue;

        const hEffect = r.healingEffect;
        if (!hEffect) continue;

        if (hEffect.newPenalty <= 0) {
            toDelete.push(r.woundId);
        } else {
            const currentAttempts = wound.system.healingAttempts || 0;
            const updateData = {
                _id: r.woundId,
                "system.penalty": hEffect.newPenalty,
                "system.healingAttempts": currentAttempts + 1
            };
            
            // Tylko jeśli test był udany, oznaczamy jako "w trakcie leczenia"
            if (r.isSuccess) {
                updateData["system.isHealing"] = true;
                // Jeśli to była Pierwsza Pomoc, oznaczamy to na ranie
                if (message.getFlag("neuroshima", "healingMethod") === "firstAid") {
                    updateData["system.hadFirstAid"] = true;
                }
            }
            
            updates.push(updateData);
        }
    }

    if (!patient.isOwner && !game.user.isGM) {
        const { NeuroshimaSocket } = await import("../helpers/socket-helper.js");
        return NeuroshimaSocket.gmExecute("applyHealingBatch", {
            patientUuid: patient.uuid,
            results: results,
            messageId: message.id
        });
    }

    if (updates.length > 0) {
        await patient.updateEmbeddedDocuments("Item", updates);
    }
    
    if (toDelete.length > 0) {
        await patient.deleteEmbeddedDocuments("Item", toDelete);
    }

    await message.setFlag("neuroshima", "healingApplied", true);
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.HealingApplied"));
  }

  /**
   * Otwiera panel leczenia.
   */
  static async onOpenHealPanel(event, message) {
    const patientUuid = message.getFlag("neuroshima", "patientUuid");
    const medicUuid = message.getFlag("neuroshima", "medicUuid") || game.user.character?.uuid;
    
    const { HealingApp } = await import("../apps/healing-app.js");
    const app = new HealingApp({
        patientRef: { uuid: patientUuid },
        medicRef: { uuid: medicUuid }
    });
    app.render(true);
  }

  /**
   * Typ wiadomości: 'roll' | 'weapon' | 'painResistance'
   */
  static TYPES = {
    ROLL: 'roll',
    WEAPON: 'weapon',
    PAIN_RESISTANCE: 'painResistance',
    INITIATIVE: 'initiative'
  };

  /**
   * Renderuje kartę testu umiejętności/atrybutu.
   */
  static async renderRoll(rollData, actor, roll) {
    const template = "systems/neuroshima/templates/chat/roll-card.hbs";
    const content = await this._renderTemplate(template, {
      ...rollData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor)
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.ROLL,
          rollData: {
            ...rollData,
            rollMode: rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renderuje kartę testu inicjatywy.
   */
  static async renderInitiativeRoll(rollData, actor, roll) {
    const template = "systems/neuroshima/templates/chat/initiative-roll-card.hbs";
    
    // Pobranie danych o celach (dla inicjatywy zwarcia)
    let targetsData = [];
    if (rollData.isInitiative && rollData.targets?.length > 0) {
        for (const targetId of rollData.targets) {
            let targetActor = game.actors.get(targetId);
            if (!targetActor) {
                const doc = await fromUuid(targetId);
                targetActor = doc?.actor || doc;
            }
            if (targetActor) {
                targetsData.push({
                    id: targetActor.id,
                    name: targetActor.name,
                    img: targetActor.img
                });
            }
        }
    }

    const content = await this._renderTemplate(template, {
      ...rollData,
      meleeTargets: targetsData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      isVanillaMelee: (game.settings.get("neuroshima", "meleeCombatType") || "default") === "default"
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.INITIATIVE,
          rollData: {
            ...rollData,
            rollMode: rollMode
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renderuje kartę testu broni.
   */
  static async renderWeaponRoll(rollData, actor, roll) {
    const template = rollData.isMelee 
      ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
      : "systems/neuroshima/templates/chat/weapon-roll-card.hbs";
      
    // Pobranie danych o celach dla walki wręcz
    let targetsData = [];
    if (rollData.isMelee && rollData.meleeAction === "attack" && rollData.targets?.length > 0) {
        for (const targetId of rollData.targets) {
            let targetActor = game.actors.get(targetId);
            if (!targetActor) {
                const doc = await fromUuid(targetId);
                targetActor = doc?.actor || doc;
            }
            if (targetActor) {
                targetsData.push({
                    id: targetActor.id,
                    name: targetActor.name,
                    img: targetActor.img
                });
            }
        }
    }

    let snapshotTargets = [];
    if (!rollData.isMelee) {
        for (const token of game.user.targets) {
            const targetActor = token.actor;
            if (targetActor) {
                snapshotTargets.push({
                    id: targetActor.id,
                    uuid: targetActor.uuid,
                    name: targetActor.name,
                    img: token.document?.texture?.src || targetActor.img
                });
            }
        }
    }

    const content = await this._renderTemplate(template, {
      ...rollData,
      meleeTargets: targetsData,
      config: NEUROSHIMA,
      showTooltip: this._canShowTooltip(actor),
      isVanillaMelee: (game.settings.get("neuroshima", "meleeCombatType") || "default") === "default"
    });

    const rollMode = rollData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: this.TYPES.WEAPON,
          rollData: {
            ...rollData,
            rollMode,
            snapshotTargets
          }
        }
      }
    };

    ChatMessage.applyRollMode(chatData, rollMode);
    return this.create(chatData);
  }

  /**
   * Renderuje kartę prośby o leczenie.
   */
  static async renderHealingRequest(patientActor, medicActor, requesterId) {
    const template = "systems/neuroshima/templates/chat/healing-request.hbs";
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(patientActor);
    const requester = game.users.get(requesterId);

    const context = {
      ...patientData,
      requesterName: requester?.name || game.user.name,
      patientCardVersion: "short",
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: patientActor }),
      content: content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingRequest",
          patientUuid: patientActor.uuid,
          medicUuid: medicActor?.uuid,
          requesterId: requesterId
        }
      }
    });
  }

  /**
   * Renderuje Kartę Pacjenta do czatu.
   */
  static async renderPatientCard(actor) {
    const template = "systems/neuroshima/templates/chat/patient-card.hbs";
    const patientData = game.neuroshima.CombatHelper.generatePatientCard(actor);
    const context = {
      ...patientData,
      config: NEUROSHIMA,
      isGM: game.user.isGM
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "patientCard",
          actorId: actor.id,
          actorUuid: actor.uuid
        }
      }
    });
  }

  /**
   * Renderuje raport Odporności na Ból.
   */
  static async renderPainResistance(actor, results, woundIds, reducedCount = 0, reducedDetails = [], options = {}) {
    const template = "systems/neuroshima/templates/chat/pain-resistance-report.hbs";
    
    const normalResults = results.filter(r => !r.isCritical);
    const passedCount = normalResults.filter(r => r.isPassed).length;
    const failedCount = normalResults.filter(r => !r.isPassed).length;
    const criticalCount = results.filter(r => r.isCritical).length;

    const context = {
      actorName: actor.name,
      actorId: actor.id,
      actorUuid: actor.uuid,
      results: results,
      woundIds: woundIds,
      passedCount,
      failedCount,
      criticalCount,
      reducedCount,
      reducedDetails,
      sourceInfo: options.sourceInfo || "",
      armorReductionOnly: options.armorReductionOnly || false,
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "painResistanceReport",
          actorId: actor.id,
          actorUuid: actor.uuid,
          woundIds,
          results,
          isReversed: false
        }
      }
    });
  }

  /**
   * Renderuje raport testu Wytrzymałości pojazdu (jeden lub seria trafień).
   */
  static async renderVehicleDamage(actor, results, negatedItems, woundIds, sourceLabel = "") {
    const template = "systems/neuroshima/templates/chat/vehicle-damage-report.hbs";

    const passedCount  = results.filter(r => r.isPassed).length;
    const failedCount  = results.filter(r => !r.isPassed).length;
    const negatedCount = negatedItems.length;

    const context = {
      actorName:    actor.name,
      actorId:      actor.id,
      actorUuid:    actor.uuid,
      results,
      negatedItems,
      woundIds,
      passedCount,
      failedCount,
      negatedCount,
      sourceInfo: sourceLabel ? `<em>${sourceLabel}</em>` : "",
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);

    return this.create({
      user:    game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      style:   CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType:     "vehicleDamageReport",
          actorId:         actor.id,
          actorUuid:       actor.uuid,
          woundIds,
          results,
          isReversed:      false,
          isVehicleDamage: true
        }
      }
    });
  }

  /**
   * Renderuje kartę rzutu leczenia.
   */
  static async renderHealingRoll(medicActor, rollData) {
    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    
    const context = {
      ...rollData,
      patientRef: { uuid: rollData.patientActor?.uuid },
      medicRef: { uuid: medicActor?.uuid },
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingRoll",
          rollData: {
            ...rollData,
            medicId: medicActor?.id,
            patientId: rollData.patientActor?.id
          }
        }
      }
    });
  }

  /**
   * Renderuje raport zbiorczy z leczenia wielu ran.
   */
  static async renderHealingBatchResults(medicActor, patientActor, results, method, extraData = {}) {
    const template = "systems/neuroshima/templates/chat/healing-roll-card.hbs";
    
    if (!Array.isArray(results)) {
        game.neuroshima?.error("renderHealingBatchResults: results is not an array", results);
        return;
    }

    const successCount = results.filter(r => r.isSuccess).length;
    const failedCount = results.filter(r => !r.isSuccess).length;

    const successTooltip = results.filter(r => r.isSuccess).map(r => `<div>${r.woundName} (${r.damageType})</div>`).join("");
    const failedTooltip = results.filter(r => !r.isSuccess).map(r => `<div>${r.woundName} (${r.damageType})</div>`).join("");

    const context = {
      medicActor,
      patientActor,
      results,
      method,
      successCount,
      failedCount,
      successTooltip,
      failedTooltip,
      patientRef: { uuid: patientActor.uuid },
      medicRef: { uuid: medicActor?.uuid },
      config: NEUROSHIMA
    };

    const content = await this._renderTemplate(template, context);
    
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: medicActor }),
      content,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "healingBatchReport",
          results,
          healingMethod: method,
          patientUuid: patientActor.uuid,
          medicUuid: medicActor?.uuid,
          healingApplied: false,
          extraData: extraData
        }
      }
    });
  }

  /**
   * Helper do renderowania szablonów Handlebars.
   */
  static async _renderTemplate(template, context) {
    // v13+ pattern
    if (foundry.applications?.handlebars?.renderTemplate) {
        return await foundry.applications.handlebars.renderTemplate(template, context);
    }
    // Fallback for v12/v11
    if (typeof renderTemplate === "function") {
        return await renderTemplate(template, context);
    }
    return "";
  }

  /**
   * Renderuje wiadomość czatu o odcięciu zacięcia broni przez gracza.
   * @param {Actor} actor   - Aktor który odciął broń
   * @param {Item}  weapon  - Broń która była zacięta
   */
  static async renderUnjam(actor, weapon) {
    const text = game.i18n.format("NEUROSHIMA.Weapon.UnjamMessage", { weapon: weapon.name });
    return this.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="neuroshima roll-card">
        <header class="roll-header">
          <div class="actor-image-container">
            <img src="${actor.img}" width="32" height="32" title="${actor.name}"/>
          </div>
          <div class="header-details">
            <div class="test-info">${text}</div>
          </div>
        </header>
      </div>`,
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType: "weaponUnjam",
          actorId: actor.id,
          weaponId: weapon.id
        }
      }
    });
  }

  /**
   * Sprawdza czy użytkownik może widzieć tooltipy rzutów.
   */
  static _canShowTooltip(actor) {
    const minRole = game.settings.get("neuroshima", "rollTooltipMinRole");
    if (game.user.role >= minRole) return true;
    if (game.settings.get("neuroshima", "rollTooltipOwnerVisibility") && actor?.isOwner) return true;
    return false;
  }

  /**
   * Generuje tooltip dla typu obrażeń.
   */
  static _getDamageTooltip(damageType) {
    if (!damageType) return "";
    const types = damageType.split("/").map(t => t.trim());
    const labels = types.map(t => {
      const config = NEUROSHIMA.woundConfiguration[t];
      return config ? game.i18n.localize(config.label) : t;
    });
    return labels.join(" / ");
  }

  static async showItemCardLimitDialog() {
    const content = `
      <div class="neuroshima item-card-limit-dialog">
        <h4 class="item-card-limit-heading">${game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Label")}</h4>
        <div class="form-group">
          <div class="form-fields">
            <input type="number" name="limit" min="1" placeholder="∞" autofocus style="width:100%">
          </div>
        </div>
      </div>
    `;
    return foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Title") },
      content,
      buttons: [
        {
          action: "confirm",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Confirm"),
          icon: "fas fa-check",
          default: true,
          callback: (event, button) => {
            const val = button.form.elements.limit.value.trim();
            return val ? parseInt(val) : null;
          }
        },
        {
          action: "cancel",
          label: game.i18n.localize("NEUROSHIMA.ItemCard.LimitDialog.Cancel"),
          icon: "fas fa-times",
          callback: () => "cancel"
        }
      ],
      classes: ["neuroshima"],
      rejectClose: false
    });
  }

  static buildItemChatStats(item) {
    const loc = (key) => game.i18n.localize(key);
    const s = item.system;
    const stats = [];
    let armorRatings = null;
    let armorBoxStats = null;
    let magazineContents = null;
    let weight = null;
    let availability = null;
    let hasWeight = false;
    const dash = "—";
    const attachedMods = Object.entries(s.mods || {})
      .filter(([k, v]) => !k.startsWith('__') && v?.attached)
      .map(([modId, v]) => ({
        ...v,
        effectText: NeuroshimaScriptRunner._resolveItemRef(v.effectText ?? "", item, null, v, modId)
      }));
    const summaryResources = (s.resources ?? []).filter(r => r.showInSummary).map(r => {
      const modId = r._fromModId ?? null;
      const modSnap = modId ? (s.mods?.[modId] ?? null) : null;
      return {
        ...r,
        label: NeuroshimaScriptRunner._resolveItemRef(r.label ?? "", item, null, modSnap, modId)
      };
    });
    const attrLabel = (key) => {
      const cfg = NEUROSHIMA?.attributes?.[key];
      return cfg ? loc(cfg.label) : (key || dash);
    };
    const skillLabel = (key) => {
      const k = `NEUROSHIMA.Skills.${key}`;
      const t = loc(k);
      return t !== k ? t : (key || dash);
    };
    if (s.weight !== undefined) {
      hasWeight = true;
      weight = s.weight ?? 0;
      availability = s.availability ?? null;
    }
    switch (item.type) {
      case "weapon": {
        const wType = s.weaponType ?? "melee";
        const wTypeLabel = loc(`NEUROSHIMA.Items.Fields.${wType.charAt(0).toUpperCase() + wType.slice(1)}`);
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.WeaponSubtype"), value: wTypeLabel || wType });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Attribute"), value: attrLabel(s.attribute) });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Skill"), value: skillLabel(s.skill) });
        if (wType === "melee") {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: `${s.damageMelee1 || dash} / ${s.damageMelee2 || dash} / ${s.damageMelee3 || dash}` });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
        } else {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.FireRateAbbr"), value: s.fireRate ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: s.capacity ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.requiredBuild ?? 0 });
        if (s.attackBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.AttackBonusAbbr"), value: (s.attackBonus > 0 ? "+" : "") + s.attackBonus });
        if (s.defenseBonus !== 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.DefenseBonusAbbr"), value: (s.defenseBonus > 0 ? "+" : "") + s.defenseBonus });
        break;
      }
      case "armor": {
        const locKeys = [
          { key: "head",     abbr: "HeadAbbr" },
          { key: "torso",    abbr: "TorsoAbbr" },
          { key: "leftArm",  abbr: "LeftArmAbbr" },
          { key: "rightArm", abbr: "RightArmAbbr" },
          { key: "leftLeg",  abbr: "LeftLegAbbr" },
          { key: "rightLeg", abbr: "RightLegAbbr" }
        ];
        const eff = s.effectiveArmor ?? {};
        armorRatings = locKeys.map(({ key, abbr }) => ({
          label: loc(`NEUROSHIMA.Items.Fields.${abbr}`),
          value: eff[key] ?? s.armor?.ratings?.[key] ?? 0
        }));
        const dur = (s.armor?.durability ?? 0) - (s.armor?.durabilityDamage ?? 0);
        armorBoxStats = [
          { label: loc("NEUROSHIMA.Items.Fields.DurabilityAbbr"), value: `${dur} / ${s.armor?.durability ?? 0}` },
          { label: loc("NEUROSHIMA.Items.Fields.RequiredBuild"), value: s.armor?.requiredBuild ?? 0 },
          { label: loc("NEUROSHIMA.Items.Fields.ArmorPenalty"), value: s.armor?.penalty ?? 0 }
        ];
        break;
      }
      case "gear": {
        if (s.cost > 0) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Cost"), value: s.cost });
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "ammo": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        if (s.isOverride) {
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.Damage"), value: s.damage || dash });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.PiercingAbbr"), value: s.piercing ?? 0 });
          stats.push({ label: loc("NEUROSHIMA.Items.Fields.JammingAbbr"), value: s.jamming ?? 20 });
        }
        if (s.isPellet) stats.push({ label: loc("NEUROSHIMA.Items.Fields.PelletCount"), value: s.pelletCount });
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "magazine": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Caliber"), value: s.caliber || dash });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Capacity"), value: `${s.totalCount ?? 0} / ${s.capacity ?? 0}` });
        magazineContents = (s.contents || []).filter(c => c.quantity > 0).map(c => ({ name: c.name || dash, quantity: c.quantity }));
        break;
      }
      case "money": {
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.CoinValue"), value: s.coinValue });
        stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
      }
      case "reputation": {
        stats.push({ label: loc("NEUROSHIMA.Reputation.Value"), value: s.value });
        break;
      }
      default:
        if (s.quantity !== undefined) stats.push({ label: loc("NEUROSHIMA.Items.Fields.Quantity"), value: s.quantity });
        break;
    }
    return { stats, armorRatings, armorBoxStats, magazineContents, weight, availability, hasWeight, attachedMods, summaryResources };
  }

  static async postItemToChat(item, { actor = null } = {}) {
    const limit = await NeuroshimaChatMessage.showItemCardLimitDialog();
    if (limit === "cancel" || limit === undefined) return;

    const description = item.system.description || "";
    const enriched = description ? await TextEditor.enrichHTML(description, { async: true }) : "";

    const typeKey = item.type.charAt(0).toUpperCase() + item.type.slice(1).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const typeLabel = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`) || item.type;

    const { stats, armorRatings, armorBoxStats, magazineContents, weight, availability, hasWeight, attachedMods, summaryResources } = NeuroshimaChatMessage.buildItemChatStats(item);
    const hasStats = stats.length > 0 || !!armorRatings || !!armorBoxStats;
    const isUnlimited = limit === null;

    const content = await NeuroshimaChatMessage._renderTemplate(
      "systems/neuroshima/templates/chat/item-card.hbs",
      {
        name: item.name, img: item.img, type: item.type, typeLabel,
        uuid: item.uuid, description: enriched,
        stats, armorRatings, armorBoxStats, hasStats,
        magazineContents,
        attachedMods, summaryResources,
        weight, availability, hasWeight,
        remaining: limit, isUnlimited, isExhausted: false
      }
    );

    const rollMode = game.settings.get("core", "rollMode");
    const msgData = {
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({}),
      content,
      flags: { neuroshima: { itemCard: { limit, remaining: limit, sourceActorId: actor?.id ?? null } } }
    };
    ChatMessage.applyRollMode(msgData, rollMode);
    await ChatMessage.create(msgData);
  }

  static async decrementItemCardLimit(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const cardData = message.getFlag("neuroshima", "itemCard");
    if (!cardData || cardData.remaining === null) return;

    const newRemaining = Math.max(0, cardData.remaining - 1);
    const isExhausted = newRemaining <= 0;

    const parser = new DOMParser();
    const doc = parser.parseFromString(message.content, "text/html");

    const badge = doc.querySelector(".item-card-qty-badge");
    if (badge) {
      badge.textContent = `${newRemaining} ×`;
      badge.dataset.remaining = newRemaining;
    }

    if (isExhausted) {
      const card = doc.querySelector(".neuroshima.item-card");
      if (card) card.classList.add("item-card-exhausted");
      const draggable = doc.querySelector(".item-card-draggable");
      if (draggable) draggable.setAttribute("draggable", "false");
    }

    await message.update({
      content: doc.body.innerHTML,
      flags: { neuroshima: { itemCard: { ...cardData, remaining: newRemaining } } }
    });
  }
}
