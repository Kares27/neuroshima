/**
 * Represents a single executable script attached to an ActiveEffect.
 * Inspired by WFRP4e's script system but adapted for Neuroshima 1.5.
 */
export class NeuroshimaScript {
  constructor(scriptData, effect) {
    this.trigger = scriptData.trigger || "manual";
    this.label = scriptData.label || "";
    this.code = scriptData.code || "";
    this.runIfDisabled = scriptData.runIfDisabled ?? false;
    this.effect = effect;
  }

  // ── Context getters ──────────────────────────────────────────────────────

  get actor() {
    return this._executingActor ?? this.effect?.actor ?? null;
  }

  get item() {
    return this._executingItem ?? (this.effect?.parent?.documentName === "Item" ? this.effect.parent : null);
  }

  /**
   * The first token on the active scene that represents this actor.
   * Returns null if the actor has no token or there is no active scene.
   */
  get token() {
    return canvas.scene?.tokens.find(t => t.actor?.id === this.actor?.id) ?? null;
  }

  // ── Notifications ────────────────────────────────────────────────────────

  notification(content, type = "info") {
    const name = this.effect?.name || "Effect";
    ui.notifications[type]?.(`${name}: ${content}`);
  }

  // ── Location helpers ─────────────────────────────────────────────────────

  /**
   * Return the hit location key from the current script args (applyDamage / preApplyDamage).
   * Returns null if args has no location.
   * @param {Object} args - The args object passed to the script.
   * @returns {string|null}
   *
   * @example
   * const loc = this.getHitLocation(args);           // e.g. "head", "torso", "leftArm"
   * const label = this.getLocationLabel(loc);         // e.g. "Głowa"
   */
  getHitLocation(args) {
    return args?.location ?? null;
  }

  /**
   * Return true if `location` is a body location (character / NPC / creature).
   * @param {string} location
   * @returns {boolean}
   */
  isBodyLocation(location) {
    return NeuroshimaScriptRunner.isBodyLocation(location);
  }

  /**
   * Return true if `location` is a vehicle location.
   * @param {string} location
   * @returns {boolean}
   */
  isVehicleLocation(location) {
    return NeuroshimaScriptRunner.isVehicleLocation(location);
  }

  /**
   * Return the localized label for a hit location key (body or vehicle).
   * @param {string} location
   * @returns {string}
   */
  getLocationLabel(location) {
    return NeuroshimaScriptRunner.getLocationLabel(location);
  }

  // ── Damage order / wound reduction helpers ───────────────────────────────

  /**
   * Full severity order (interleaved, for comparison only).
   * sK > K > sC > C > sL > L > sD > D
   * @type {string[]}
   */
  get DAMAGE_ORDER() {
    return ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];
  }

  /**
   * Regular wound severity track: D → L → C → K.
   * Use for reduce/increase operations on non-bruise wounds.
   * @type {string[]}
   */
  get REGULAR_ORDER() {
    return ["D", "L", "C", "K"];
  }

  /**
   * Bruise wound severity track: sD → sL → sC → sK.
   * Use for reduce/increase operations on bruise (s-prefix) wounds.
   * @type {string[]}
   */
  get BRUISE_ORDER() {
    return ["sD", "sL", "sC", "sK"];
  }

  /**
   * Reduce the single worst active wound on `actor` (defaults to this.actor) by 1 level.
   * Stays within the wound's own track (regular or bruise — never crosses between them).
   * If the wound is already at the minimum on its track (D or sD), it is healed (deleted).
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>} true if a wound was reduced, false if no active wounds found.
   */
  async reduceWorstWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstWounds();
    if (!worst.length) return false;
    const w = worst[0];
    const track = w.system.damageType?.startsWith("s") ? this.BRUISE_ORDER : this.REGULAR_ORDER;
    if (track.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  /**
   * Reduce the worst regular (non-bruise) wound by 1 level.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>}
   */
  async reduceWorstRegularWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstRegularWounds();
    if (!worst.length) return false;
    const w = worst[0];
    if (this.REGULAR_ORDER.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  /**
   * Reduce the worst bruise (s-prefix) wound by 1 level.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Promise<boolean>}
   */
  async reduceWorstBruiseWound(actor) {
    const target = actor ?? this.actor;
    const worst = target.getWorstBruiseWounds();
    if (!worst.length) return false;
    const w = worst[0];
    if (this.BRUISE_ORDER.indexOf(w.system.damageType) === 0) {
      await w.heal();
    } else {
      await w.reduceLevel(1);
    }
    return true;
  }

  // ── Damage type helpers ──────────────────────────────────────────────────

  /**
   * Return true if the damage type is light (D, sD, L, sL).
   * @param {string} damageType
   * @returns {boolean}
   */
  isLightDamage(damageType) {
    return NeuroshimaScriptRunner.isLightDamage(damageType);
  }

  /**
   * Return true if the damage type is heavy or worse (C, sC, K, sK).
   * @param {string} damageType
   * @returns {boolean}
   */
  isHeavyDamage(damageType) {
    return NeuroshimaScriptRunner.isHeavyDamage(damageType);
  }

  /**
   * Compare two damage types by severity.
   * Returns negative if a < b, 0 if equal, positive if a > b.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  compareDamage(a, b) {
    return NeuroshimaScriptRunner.compareDamage(a, b);
  }

  /**
   * Return true if the damage type belongs to the bruise track (s-prefix: sD, sL, sC, sK).
   * Use this instead of `type?.startsWith("s")` for readability.
   * @param {string} type
   * @returns {boolean}
   *
   * @example
   * this.isBruiseDamage("sC")  // → true
   * this.isBruiseDamage("C")   // → false
   *
   * @example
   * // Select the correct wound track
   * const track = this.isBruiseDamage(type) ? this.BRUISE_ORDER : this.REGULAR_ORDER;
   */
  isBruiseDamage(type) {
    return typeof type === "string" && type.startsWith("s");
  }

  /**
   * Return true if the damage type is the minimum on its track (D or sD).
   * When a wound is at minimum, it should be healed (deleted) rather than reduced further.
   * @param {string} type
   * @returns {boolean}
   *
   * @example
   * // Heal at minimum, otherwise reduce
   * if (this.isMinDamage(wound.system.damageType)) await wound.heal();
   * else await wound.reduceLevel(1);
   *
   * @example
   * this.isMinDamage("D")   // → true
   * this.isMinDamage("sD")  // → true
   * this.isMinDamage("L")   // → false
   */
  isMinDamage(type) {
    return type === "D" || type === "sD";
  }

  /**
   * Return true if the damage type is the maximum on its track (K or sK).
   * @param {string} type
   * @returns {boolean}
   *
   * @example
   * this.isMaxDamage("K")   // → true
   * this.isMaxDamage("sK")  // → true
   * this.isMaxDamage("C")   // → false
   *
   * @example
   * // Cap any escalation at K/sK
   * if (!this.isMaxDamage(args.damageType)) {
   *   args.damageType = this.increaseDamageType(args.damageType, 1);
   * }
   */
  isMaxDamage(type) {
    return type === "K" || type === "sK";
  }

  /**
   * Return the severity index (0–3) of a damage type within its own track.
   * Regular: D=0, L=1, C=2, K=3
   * Bruise:  sD=0, sL=1, sC=2, sK=3
   * Returns -1 if the type is not recognised.
   * @param {string} type
   * @returns {number}
   *
   * @example
   * this.getSeverityIndex("D")   // → 0
   * this.getSeverityIndex("sL")  // → 1
   * this.getSeverityIndex("C")   // → 2
   * this.getSeverityIndex("K")   // → 3
   *
   * @example
   * // Scale bonus based on wound severity (D=+0, L=+10, C=+20, K=+30)
   * const severity = this.getSeverityIndex(wound.system.damageType);
   * args.penalties.mod += severity * 10;
   */
  getSeverityIndex(type) {
    const track = this.isBruiseDamage(type) ? this.BRUISE_ORDER : this.REGULAR_ORDER;
    return track.indexOf(type);
  }

  /**
   * Extract raw die results (numbers) from a Foundry Roll object.
   * Replaces the verbose pattern `roll.dice[0].results.map(r => r.result)`.
   * @param {Roll}   roll       - An already-evaluated Roll object (use after `await this.roll(...)`).
   * @param {number} [dieIndex=0] - Index into `roll.dice` (default 0 = first die pool).
   * @returns {number[]}
   *
   * @example
   * const roll    = await this.roll("3d20");
   * const results = this.getDiceResults(roll);   // e.g. [13, 7, 18]
   *
   * @example
   * // Two separate pools: 2d20 + 1d6
   * const roll    = await this.roll("2d20 + 1d6");
   * const d20s    = this.getDiceResults(roll, 0);  // [8, 15]
   * const d6      = this.getDiceResults(roll, 1);  // [4]
   */
  getDiceResults(roll, dieIndex = 0) {
    return roll?.dice?.[dieIndex]?.results?.map(r => r.result) ?? [];
  }

  /**
   * Return wounds from `args.wounds` that are not skipped by a previous script.
   * A wound is skipped when any earlier script set `wound.forceSkip = true`.
   * Use this in `applyDamage` scripts to work only on wounds that will actually land.
   * @param {{ wounds: Array }} args - The args object passed to the applyDamage trigger.
   * @returns {Array}
   *
   * @example
   * // Only apply poison if at least one wound actually lands
   * const effective = this.getEffectiveWounds(args);
   * if (!effective.length) return;
   * await this.addCondition("bleeding", args.actor);
   *
   * @example
   * // Count how many wounds land this hit
   * const count = this.getEffectiveWounds(args).length;
   * await this.sendMessage(`${count} rana/rany weszły.`);
   */
  getEffectiveWounds(args) {
    return (args?.wounds ?? []).filter(w => !w.forceSkip);
  }

  /**
   * Reduce a damage type string by `steps` severity levels, staying within its track.
   * Regular track: D → L → C → K  (reduce goes right-to-left; minimum is D)
   * Bruise  track: sD → sL → sC → sK (minimum is sD)
   * If `type` is not recognised, it is returned unchanged.
   * @param {string} type     - Current damage type string (e.g. "C", "sK").
   * @param {number} [steps=1] - How many severity levels to reduce (default 1).
   * @returns {string} New damage type string.
   *
   * @example
   * // preApplyDamage — every hit is reduced by 1 level before armor
   * args.damageType = this.reduceDamageType(args.damageType, 1);
   * // C→L, K→C, L→D, D stays D  |  sC→sL, sK→sC, sL→sD, sD stays sD
   *
   * @example
   * // Only heavy wounds are reduced (C,sC,K,sK → one level down)
   * if (this.isHeavyDamage(args.damageType)) {
   *   args.damageType = this.reduceDamageType(args.damageType, 1);
   * }
   */
  reduceDamageType(type, steps = 1) {
    const track = type?.startsWith("s") ? this.BRUISE_ORDER : this.REGULAR_ORDER;
    const idx = track.indexOf(type);
    if (idx < 0) return type;
    return track[Math.max(0, idx - steps)];
  }

  /**
   * Increase a damage type string by `steps` severity levels, staying within its track.
   * Regular track: D → L → C → K  (increase goes left-to-right; maximum is K)
   * Bruise  track: sD → sL → sC → sK (maximum is sK)
   * If `type` is not recognised, it is returned unchanged.
   * @param {string} type     - Current damage type string (e.g. "L", "sC").
   * @param {number} [steps=1] - How many severity levels to increase (default 1).
   * @returns {string} New damage type string.
   *
   * @example
   * // preApplyDamage — cursed enemy: every incoming hit is worsened by 1 level
   * args.damageType = this.increaseDamageType(args.damageType, 1);
   * // D→L, L→C, C→K, K stays K
   */
  increaseDamageType(type, steps = 1) {
    const track = type?.startsWith("s") ? this.BRUISE_ORDER : this.REGULAR_ORDER;
    const idx = track.indexOf(type);
    if (idx < 0) return type;
    return track[Math.min(track.length - 1, idx + steps)];
  }

  // ── Token / targeting helpers ────────────────────────────────────────────

  /**
   * Apply all "Target" type effects (transferType "target", documentType "actor")
   * from `source` to the given targets. Targets default to the user's current targets.
   *
   * Use this in manual or immediate scripts to implement Target-type transfers.
   *
   * @param {Actor|Item}          source   - Actor or Item whose Target effects are transferred.
   * @param {Actor[]|Token[]}    [targets] - Defaults to this.getTargets().
   * @returns {Promise<void>}
   */
  async applyTargetEffects(source, targets) {
    const resolved = targets ?? this.getTargets();
    return game.neuroshima.CombatHelper.applyTargetEffects(source, resolved);
  }

  /**
   * Return all actors currently targeted by the user's token targeting.
   * Returns an empty array if nothing is targeted.
   * @returns {Actor[]}
   */
  getTargets() {
    return NeuroshimaScriptRunner.getTargets();
  }

  /**
   * Return actors of all currently selected tokens on the canvas.
   * Falls back to the user's assigned character if no token is selected.
   * @returns {Actor[]}
   */
  getSelected() {
    return NeuroshimaScriptRunner.getSelected();
  }

  /**
   * Return targeted actors if any targets exist, otherwise fall back to selected tokens.
   * This is the most common way to resolve "who the script should affect".
   * @returns {Actor[]}
   */
  getTargetsOrSelected() {
    return NeuroshimaScriptRunner.getTargetsOrSelected();
  }

  // ── Weapon / Jamming helpers ─────────────────────────────────────────────

  /**
   * Return the effective jamming threshold for a weapon item.
   * Reads `system.jamming` from the item and defaults to 20 if absent.
   * @param {Item} weapon
   * @returns {number}
   */
  getWeaponJammingThreshold(weapon) {
    return weapon?.system?.jamming ?? 20;
  }

  /**
   * Return whether the weapon is currently in the jammed state (from a previous shot).
   * Useful in `preWeaponShot` or `weaponJam` scripts to check if the weapon was already jammed
   * before this shot began.
   * @param {Item} weapon
   * @returns {boolean}
   *
   * @example
   * // In preWeaponShot — extra penalty if weapon was already jammed
   * if (this.getWeaponJammedState(args.weapon)) {
   *   this.notification("Broń była już zacięta!", "warn");
   * }
   */
  getWeaponJammedState(weapon) {
    return weapon?.system?.jammed ?? false;
  }

  /**
   * Shift the effective jamming threshold in a `preWeaponShot` script.
   * Positive delta makes the weapon HARDER to jam (threshold moves up).
   * Negative delta makes it EASIER to jam (threshold moves down).
   *
   * @param {Object} args  - The args object from a preWeaponShot trigger.
   * @param {number} delta - Amount to add to `args.jammingThreshold`.
   *
   * @example
   * // In preWeaponShot — Rusznikarstwo passive: weapon is +3 harder to jam
   * this.modifyJammingThreshold(args, 3);
   */
  modifyJammingThreshold(args, delta) {
    if (typeof args?.jammingThreshold === "number") args.jammingThreshold += delta;
  }

  /**
   * In a `weaponJam` script, allow the actor to fire despite the jam.
   * The weapon is still jammed (needs repair), ammo is consumed and
   * hit evaluation runs normally (shot hits if the roll would have succeeded).
   *
   * @param {Object} args          - The args object from a weaponJam trigger.
   * @param {number} [count=1]     - Maximum number of bullets allowed to fire despite the jam.
   *                                 Defaults to 1. Pass higher value for bursts.
   *
   * @example
   * // Sztuczka "Na pewno działa!" — 1 strzał, trafia tylko jeśli rzut był sukcesem
   * if (this.isStandardJam(args, 11, 18)) {
   *   this.allowShotDespiteJam(args);
   *   this.addAnnotation(`Na pewno działa! [${args.weapon.name}] oddaje ostatni strzał.`);
   * }
   *
   * @example
   * // 2 pociski przez zacięcie w serii
   * if (this.isStandardJam(args, 11, 18)) {
   *   this.allowShotDespiteJam(args, 2);
   *   this.addAnnotation(`Seria przez Zacięcie: 2 pociski mimo zacięcia.`);
   * }
   */
  allowShotDespiteJam(args, count = 1) {
    if (!args) return;
    args.canFireDespiteJam = true;
    args.despiteJamBullets = Math.floor(Math.max(1, count));
  }

  /**
   * In a `weaponJam` script, clear the jam so the weapon fires normally.
   * No jam is recorded and the shot proceeds as if it never happened.
   *
   * @param {Object} args - The args object from a weaponJam trigger.
   *
   * @example
   * // In weaponJam — Szczęśliwa Awaria: jam is ignored entirely
   * this.clearWeaponJam(args);
   */
  clearWeaponJam(args) {
    if (args) args.clearJam = true;
  }

  /**
   * In a `preWeaponShot` script, prevent the weapon from jamming this shot entirely.
   * Equivalent to setting `args.forceNoJam = true`.
   *
   * @param {Object} args - The args object from a preWeaponShot trigger.
   *
   * @example
   * // In preWeaponShot — Niezawodna Broń passive: weapon cannot jam
   * this.preventWeaponJam(args);
   */
  preventWeaponJam(args) {
    if (args) args.forceNoJam = true;
  }

  /**
   * In a `preWeaponShot` script, force the weapon to jam regardless of the dice.
   * Equivalent to setting `args.forceJam = true`.
   *
   * @param {Object} args - The args object from a preWeaponShot trigger.
   *
   * @example
   * // In preWeaponShot — Wadliwa Amunicja: weapon always jams this shot
   * this.forceWeaponJam(args);
   */
  forceWeaponJam(args) {
    if (args) args.forceJam = true;
  }

  /**
   * Check whether a weapon jam result falls within a given range (inclusive).
   * When called with the full `args` object (recommended), also checks that
   * the original roll would have been a success — so the entire `if` block
   * (including `allowShotDespiteJam` and `addAnnotation`) only runs when both
   * conditions are true.
   *
   * Default range is 1–20 (covers any possible die result).
   * If `min > max`, the values are automatically swapped so the check is always valid.
   *
   * @param {Object|number} argsOrResult - Pass the full `args` object (recommended) or a raw die number.
   *                                       When an object is passed, checks range AND `args.wouldSucceed`.
   * @param {number} [min=1]             - Low end of the range (inclusive).
   * @param {number} [max=20]            - High end of the range (inclusive).
   * @returns {boolean}
   *
   * @example
   * // Zalecane — sprawdza zakres I czy rzut byłby sukcesem
   * if (this.isStandardJam(args, 11, 18)) {
   *   this.allowShotDespiteJam(args);
   *   this.addAnnotation(`Na pewno działa! Broń oddaje ostatni strzał.`);
   * }
   *
   * @example
   * // Krytyczne zacięcie (19-20), bez sprawdzania sukcesu
   * if (this.isStandardJam(args, 19, 20)) {
   *   this.notification("Krytyczne zacięcie — sztuczka nie pomaga!", "warn");
   * }
   *
   * @example
   * // Dowolne zacięcie (domyślny zakres), bez sprawdzania sukcesu
   * if (this.isStandardJam(args)) {
   *   this.clearWeaponJam(args);
   * }
   */
  isStandardJam(argsOrResult, min = 1, max = 20) {
    const bestResult = typeof argsOrResult === "number" ? argsOrResult : argsOrResult?.bestResult;
    if (bestResult === undefined || bestResult === null) return false;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const inRange = bestResult >= lo && bestResult <= hi;
    if (typeof argsOrResult !== "object" || argsOrResult === null) return inRange;
    if (typeof argsOrResult.wouldSucceed === "boolean") {
      const result = inRange && argsOrResult.wouldSucceed;
      game.neuroshima?.log?.("[isStandardJam]", {
        bestResult, range: `[${lo},${hi}]`, inRange,
        wouldSucceed: argsOrResult.wouldSucceed, result
      });
      return result;
    }
    return inRange;
  }

  /**
   * Append a short annotation to the roll result card.
   * Annotations appear below the roll-outcome footer.
   * Available in `preRollTest`, `rollTest`, `preWeaponShot`, `weaponJam`, and `postWeaponShot` triggers.
   * @param {string} text - Annotation text to display.
   *
   * @example
   * // In weaponJam — inform the player that the trick allowed a shot through
   * if (this.isStandardJam(args, 11, 18)) {
   *   this.allowShotDespiteJam(args);
   *   this.addAnnotation("Na pewno działa! Broń oddaje ostatni strzał mimo zacięcia.");
   * }
   */
  addAnnotation(text) {
    const annotations = this._currentArgs?.annotations;
    if (!Array.isArray(annotations)) return;
    annotations.push(String(text));
  }

  // ── Utility helpers ──────────────────────────────────────────────────────

  /**
   * Async pause for `ms` milliseconds.
   * Useful for waiting for Dice So Nice animations or chaining async steps.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return NeuroshimaScriptRunner.sleep(ms);
  }

  /**
   * Evaluate a dice formula and return the Roll object.
   * Optionally posts the roll to chat with a flavor and roll mode.
   *
   * @param {string} formula  - A valid Foundry dice formula, e.g. "2d6+3", "1d100", "3d20".
   * @param {Object} [data={}] - Formula data for variable substitution.
   * @param {Object} [options={}]
   * @param {string}  [options.flavor]    - Chat message flavor text. If provided, roll is auto-posted.
   * @param {string}  [options.rollMode]  - Foundry roll mode (defaults to current game setting).
   * @param {boolean} [options.toMessage] - Force posting to chat even without a flavor string.
   * @param {Object}  [options.speaker]   - ChatMessage speaker data (defaults to this.actor).
   * @returns {Promise<Roll>}
   *
   * @example
   * // Just evaluate — no chat message
   * const r = await this.roll("3d20");
   * const results = r.dice[0].results.map(d => d.result);
   *
   * @example
   * // Evaluate AND post to chat with flavor
   * const r = await this.roll("1d100", {}, { flavor: "Test Siły", toMessage: true });
   *
   * @example
   * // Post with variable substitution
   * const r = await this.roll("1d@sides", { sides: 20 }, { flavor: "Kość Testowa" });
   */
  async roll(formula, data = {}, options = {}) {
    const r = await new Roll(formula, data).evaluate();
    if (options.toMessage || options.flavor !== undefined) {
      await r.toMessage({
        speaker: options.speaker ?? ChatMessage.getSpeaker({ actor: this.actor }),
        flavor:   options.flavor   ?? this.effect?.name ?? "",
        rollMode: options.rollMode ?? game.settings.get("core", "rollMode")
      });
    }
    return r;
  }

  // ── Chat helpers ─────────────────────────────────────────────────────────

  /**
   * Build default ChatMessage creation data for this script context.
   * The speaker defaults to the actor; flavor defaults to the effect name.
   * @param {Object} [merge={}] Additional data to merge in.
   * @returns {Object}
   */
  getChatData(merge = {}) {
    return foundry.utils.mergeObject({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: this.effect?.name ?? this.item?.name ?? ""
    }, merge);
  }

  /**
   * Create a chat message attributed to this script's actor.
   * @param {string} content - HTML content of the message.
   * @param {Object} [chatData={}] - Additional ChatMessage data (merged with defaults).
   * @returns {Promise<ChatMessage>}
   */
  async sendMessage(content, chatData = {}) {
    return ChatMessage.create(this.getChatData(foundry.utils.mergeObject({ content }, chatData)));
  }

  // ── Dialog helper ────────────────────────────────────────────────────────

  /**
   * Build default config for a Foundry V13 Dialog opened from a script.
   * Merges the effect name as window title with any extra config.
   * @param {string} content - HTML content of the dialog.
   * @param {Object} [config={}] - Extra ApplicationV2 config (merged).
   * @returns {Object}
   */
  dialogConfig(content, config = {}) {
    return foundry.utils.mergeObject(
      { window: { title: this.effect?.name ?? "" }, content },
      config
    );
  }

  /**
   * Show a Foundry V13 dialog from a script.
   * Wraps `foundry.applications.api.Dialog[type]()`.
   *
   * @param {string} content - HTML body of the dialog.
   * @param {"confirm"|"input"|"prompt"} [type="confirm"] - Dialog type.
   * @param {Object} [config={}] - Extra config merged into the dialog options.
   * @returns {Promise<any>}
   *
   * @example
   * // Confirm dialog — returns true/false
   * const yes = await this.dialog("<p>Użyć przedmiotu?</p>");
   * if (!yes) return;
   *
   * @example
   * // Prompt dialog — returns entered string or null
   * const name = await this.dialog("<p>Podaj nazwę:</p>", "prompt");
   */
  dialog(content, type = "confirm", config = {}) {
    return foundry.applications.api.Dialog[type](this.dialogConfig(content, config));
  }

  // ── Wound helpers ────────────────────────────────────────────────────────

  /**
   * Return wound items from actor. Accepts same filter object as actor.getWounds().
   * @param {Object}  [filter={}]
   * @param {Actor}   [actor]    - Defaults to this.actor.
   * @returns {Item[]}
   *
   * @example
   * const activeWounds = this.getWounds({ active: true });
   * const headWounds   = this.getWounds({ location: "head" });
   */
  getWounds(filter = {}, actor) {
    const target = actor ?? this.actor;
    return target?.getWounds(filter) ?? [];
  }

  /**
   * Return total number of active wounds on actor.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {number}
   *
   * @example
   * const n = this.getWoundCount();
   */
  getWoundCount(actor) {
    return this.getWounds({ active: true }, actor).length;
  }

  /**
   * Apply a wound directly to actor, bypassing pain resistance.
   * @param {string}  damageType  - e.g. "L", "C", "K", "sL"
   * @param {string}  [location]  - Hit location key. Defaults to "torso".
   * @param {Actor}   [actor]     - Defaults to this.actor.
   * @returns {Promise<Item>}
   *
   * @example
   * await this.applyWound("L", "head");
   * await this.applyWound("C", args.location ?? "torso");
   */
  applyWound(damageType, location = "torso", actor) {
    const target = actor ?? this.actor;
    const { NeuroshimaDice } = game.neuroshima ?? {};
    return NeuroshimaDice.applyWound(target, { damageType, location, source: this.effect?.name ?? "" });
  }

  // ── Condition helpers ─────────────────────────────────────────────────────

  /**
   * Return current value of an int-type condition. Returns 0 if not active.
   * @param {string} key   - Condition key (e.g. "bleeding").
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {number}
   *
   * @example
   * const stacks = this.getConditionValue("bleeding");
   */
  getConditionValue(key, actor) {
    const target = actor ?? this.actor;
    return target?.getConditionValue(key) ?? 0;
  }

  /**
   * Set the stored value of an int-type condition directly.
   * Creates the condition effect if it doesn't exist, or removes it when value reaches 0.
   * @param {string} key   - Condition key.
   * @param {number} value - New value (≥ 0 unless condition allows negatives).
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {Promise<void>}
   *
   * @example
   * await this.setConditionValue("bleeding", 3);
   * await this.setConditionValue("bleeding", 0); // removes the condition
   */
  async setConditionValue(key, value, actor) {
    const target = actor ?? this.actor;
    if (!target) return;
    const existing = target.effects.find(
      e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
    );
    if (value <= 0) {
      if (existing) await existing.delete();
      return;
    }
    if (existing) {
      await existing.setFlag("neuroshima", "conditionValue", value);
      target._refreshTokenHUD?.();
    } else {
      await target.addCondition(key);
      const created = target.effects.find(
        e => e.statuses?.has(key) && e.getFlag("neuroshima", "conditionNumbered")
      );
      if (created && value !== 1) {
        await created.setFlag("neuroshima", "conditionValue", value);
        target._refreshTokenHUD?.();
      }
    }
  }

  /**
   * Add (or increment) a condition on actor.
   * Boolean conditions toggle on; int conditions increment by 1.
   * @param {string} key   - Condition key.
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {Promise<void>}
   *
   * @example
   * await this.addCondition("bleeding");
   * await this.addCondition("stunned");
   */
  addCondition(key, actor) {
    const target = actor ?? this.actor;
    return target?.addCondition(key);
  }

  /**
   * Remove (or decrement) a condition on actor.
   * Boolean conditions toggle off; int conditions decrement by 1 (remove at 0).
   * @param {string} key   - Condition key.
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {Promise<void>}
   *
   * @example
   * await this.removeCondition("bleeding");
   */
  removeCondition(key, actor) {
    const target = actor ?? this.actor;
    return target?.removeCondition(key);
  }

  // ── Actor stat helpers ────────────────────────────────────────────────────

  /**
   * Return the actor's attribute base value.
   * @param {string} key   - Attribute key (e.g. "dexterity", "constitution").
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {number}
   *
   * @example
   * const dex = this.getAttribute("dexterity");
   */
  getAttribute(key, actor) {
    const target = actor ?? this.actor;
    return target?.getAttribute(key) ?? 0;
  }

  /**
   * Return the actor's attribute total (base + modifier).
   * @param {string} key   - Attribute key.
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {number}
   *
   * @example
   * const str = this.getAttributeTotal("strength");
   */
  getAttributeTotal(key, actor) {
    const target = actor ?? this.actor;
    return target?.getAttributeTotal(key) ?? 0;
  }

  /**
   * Return the actor's skill value.
   * @param {string} key   - Skill key (e.g. "brawl", "firearms").
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {number}
   *
   * @example
   * const brawl = this.getSkill("brawl");
   */
  getSkill(key, actor) {
    const target = actor ?? this.actor;
    return target?.getSkill(key) ?? 0;
  }

  /**
   * Return true if actor has an active (non-disabled) effect with the given name or ID.
   * @param {string} nameOrId
   * @param {Actor}  [actor] - Defaults to this.actor.
   * @returns {boolean}
   *
   * @example
   * if (this.hasEffect("Rykoszet")) { ... }
   */
  hasEffect(nameOrId, actor) {
    const target = actor ?? this.actor;
    return target?.hasEffect(nameOrId) ?? false;
  }

  // ── Armor helpers ─────────────────────────────────────────────────────────

  static #ARMOR_LOCS = ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"];

  /**
   * Return all equipped armor items on actor.
   * @param {Actor} [actor] - Defaults to this.actor.
   * @returns {Item[]}
   *
   * @example
   * const armors = this.getEquippedArmors();
   * for (const a of armors) { ... }
   */
  getEquippedArmors(actor) {
    const target = actor ?? this.actor;
    return target?.items.filter(i => i.type === "armor" && i.system.equipped) ?? [];
  }

  /**
   * Return the base SP rating at a location for an armor item.
   * @param {Item}   item     - An armor item.
   * @param {string} location - Location key: "head", "torso", "leftArm", etc.
   * @returns {number}
   *
   * @example
   * const sp = this.getArmorRating(armor, "torso");
   */
  getArmorRating(item, location) {
    return item?.system?.armor?.ratings?.[location] ?? 0;
  }

  /**
   * Return the effective SP at a location (base rating minus accumulated damage, min 0).
   * @param {Item}   item
   * @param {string} location
   * @returns {number}
   *
   * @example
   * const effective = this.getArmorEffective(armor, "torso");
   */
  getArmorEffective(item, location) {
    return item?.system?.effectiveArmor?.[location] ?? 0;
  }

  /**
   * Return durability info for an armor item.
   * @param {Item} item
   * @returns {{ max: number, damage: number, remaining: number }}
   *
   * @example
   * const { max, damage, remaining } = this.getArmorDurability(armor);
   */
  getArmorDurability(item) {
    const max    = item?.system?.armor?.durability       ?? 0;
    const damage = item?.system?.armor?.durabilityDamage ?? 0;
    return { max, damage, remaining: Math.max(0, max - damage) };
  }

  /**
   * Deal damage to armor at a specific location.
   * `amount` is added to the location's damage counter, clamped so the effective SP
   * never drops below 0 (i.e. damage cannot exceed the base rating at that location).
   * @param {Item}   item
   * @param {string} location - Location key.
   * @param {number} amount   - Damage to apply (positive integer).
   * @returns {Promise<number>} New damage value at the location.
   *
   * @example
   * // Damage torso SP by 2
   * const newDmg = await this.damageArmorLocation(armor, "torso", 2);
   */
  async damageArmorLocation(item, location, amount) {
    if (!item || !NeuroshimaScript.#ARMOR_LOCS.includes(location)) return 0;
    const current = item.system.armor.damage?.[location] ?? 0;
    const maxDmg  = item.system.armor.ratings?.[location] ?? 0;
    const next    = Math.min(maxDmg, current + Math.max(0, amount));
    if (next === current) return current;
    await item.update({ [`system.armor.damage.${location}`]: next });
    return next;
  }

  /**
   * Repair armor at a specific location.
   * `amount` is subtracted from the location's damage counter, clamped to [0, max].
   * @param {Item}   item
   * @param {string} location
   * @param {number} amount   - Amount to repair (positive integer).
   * @returns {Promise<number>} New damage value at the location (lower = better).
   *
   * @example
   * // Repair left arm by 1 SP
   * await this.repairArmorLocation(armor, "leftArm", 1);
   */
  async repairArmorLocation(item, location, amount) {
    if (!item || !NeuroshimaScript.#ARMOR_LOCS.includes(location)) return 0;
    const current = item.system.armor.damage?.[location] ?? 0;
    const next    = Math.max(0, current - Math.max(0, amount));
    if (next === current) return current;
    await item.update({ [`system.armor.damage.${location}`]: next });
    return next;
  }

  /**
   * Deal damage to armor durability (Wytrzymałość).
   * Clamped to [0, max durability]; the remaining durability never goes below 0.
   * @param {Item}   item
   * @param {number} amount - Durability damage to apply.
   * @returns {Promise<number>} New durabilityDamage value.
   *
   * @example
   * const newDmg = await this.damageArmorDurability(armor, 1);
   */
  async damageArmorDurability(item, amount) {
    if (!item) return 0;
    const current = item.system.armor.durabilityDamage ?? 0;
    const maxDmg  = item.system.armor.durability       ?? 0;
    const next    = Math.min(maxDmg, current + Math.max(0, amount));
    if (next === current) return current;
    await item.update({ "system.armor.durabilityDamage": next });
    return next;
  }

  /**
   * Repair armor durability.
   * Clamped to [0, max]; durabilityDamage is decreased by `amount`.
   * @param {Item}   item
   * @param {number} amount
   * @returns {Promise<number>} New durabilityDamage value.
   *
   * @example
   * await this.repairArmorDurability(armor, 2);
   */
  async repairArmorDurability(item, amount) {
    if (!item) return 0;
    const current = item.system.armor.durabilityDamage ?? 0;
    const next    = Math.max(0, current - Math.max(0, amount));
    if (next === current) return current;
    await item.update({ "system.armor.durabilityDamage": next });
    return next;
  }

  // ── Item Resource helpers ─────────────────────────────────────────────────

  /**
   * Find a custom resource on an item by key.
   * @param {Item} item
   * @param {string} key
   * @returns {{ key: string, label: string, value: number, min: number, max: number } | null}
   */
  _findResource(item, key) {
    if (!item || !key) return null;
    return (item.system?.resources ?? []).find(r => r.key === key) ?? null;
  }

  /**
   * Return whether an item has a custom resource with the given key.
   * @param {Item} item
   * @param {string} key
   * @returns {boolean}
   *
   * @example
   * if (this.hasItemResource(this.item, "charges")) {
   *   // item has a "charges" resource
   * }
   */
  hasItemResource(item, key) {
    return this._findResource(item, key) !== null;
  }

  /**
   * Return the current value of a custom resource on an item.
   * Returns null if the resource does not exist.
   * @param {Item} item
   * @param {string} key
   * @returns {number | null}
   *
   * @example
   * const charges = this.getItemResource(this.item, "charges");
   * if (charges > 0) { ... }
   */
  getItemResource(item, key) {
    const res = this._findResource(item, key);
    return res ? (res.value ?? 0) : null;
  }

  /**
   * Set the value of a custom resource on an item (clamped to [min, max]).
   * When max === 0, no upper clamp is applied.
   * @param {Item} item
   * @param {string} key
   * @param {number} value
   * @returns {Promise<number | null>} — new value, or null if resource not found
   *
   * @example
   * await this.setItemResource(this.item, "charges", 3);
   */
  async setItemResource(item, key, value) {
    if (!item || !key) return null;
    const resources = Array.from(item.system?.resources ?? []);
    const idx = resources.findIndex(r => r.key === key);
    if (idx < 0) return null;
    const res = resources[idx];
    let next = value;
    if (!res.unclamped) {
      const min = res.min ?? 0;
      const max = res.max ?? 0;
      next = Math.max(min, next);
      if (max > 0) next = Math.min(max, next);
    }
    resources[idx] = { ...res, value: next };
    await item.update({ "system.resources": resources });
    return next;
  }

  /**
   * Add delta to the value of a custom resource (clamped to [min, max]).
   * @param {Item} item
   * @param {string} key
   * @param {number} delta - amount to add (can be negative)
   * @returns {Promise<number | null>}
   *
   * @example
   * await this.modifyItemResource(this.item, "charges", -1);
   */
  async modifyItemResource(item, key, delta) {
    const current = this.getItemResource(item, key);
    if (current === null) return null;
    return this.setItemResource(item, key, current + delta);
  }

  /**
   * Increase the value of a custom resource by amount (clamped to max).
   * @param {Item} item
   * @param {string} key
   * @param {number} amount - positive number
   * @returns {Promise<number | null>}
   *
   * @example
   * await this.increaseItemResource(this.item, "charges", 2);
   */
  async increaseItemResource(item, key, amount = 1) {
    return this.modifyItemResource(item, key, Math.abs(amount));
  }

  /**
   * Decrease the value of a custom resource by amount (clamped to min).
   * @param {Item} item
   * @param {string} key
   * @param {number} amount - positive number
   * @returns {Promise<number | null>}
   *
   * @example
   * await this.decreaseItemResource(this.item, "charges", 1);
   */
  async decreaseItemResource(item, key, amount = 1) {
    return this.modifyItemResource(item, key, -Math.abs(amount));
  }

  /**
   * Return the full resource object at a given array index.
   * Indices automatically re-pack when a resource is deleted, so index 0 is
   * always the first defined resource regardless of how many were removed.
   * @param {Item} item
   * @param {number} id - Array index (0-based)
   * @returns {{ key: string, label: string, value: number, min: number, max: number } | null}
   *
   * @example
   * const res = this.getItemResourceById(this.item, 0);
   * if (res) this.notification(`${res.label}: ${res.value}`);
   */
  getItemResourceById(item, id) {
    if (!item || typeof id !== "number") return null;
    return (item.system?.resources ?? [])[id] ?? null;
  }

  /**
   * Set the value of a custom resource by its array index (clamped to [min, max]).
   * @param {Item} item
   * @param {number} id - Array index
   * @param {number} value
   * @returns {Promise<number | null>}
   *
   * @example
   * await this.setItemResourceById(this.item, 0, 5);
   */
  async setItemResourceById(item, id, value) {
    if (!item || typeof id !== "number") return null;
    const resources = Array.from(item.system?.resources ?? []);
    if (id < 0 || id >= resources.length) return null;
    const res = resources[id];
    let next = value;
    if (!res.unclamped) {
      const min = res.min ?? 0;
      const max = res.max ?? 0;
      next = Math.max(min, next);
      if (max > 0) next = Math.min(max, next);
    }
    resources[id] = { ...res, value: next };
    await item.update({ "system.resources": resources });
    return next;
  }

  /**
   * Add delta to the value of a resource by its array index (clamped).
   * @param {Item} item
   * @param {number} id - Array index
   * @param {number} delta
   * @returns {Promise<number | null>}
   *
   * @example
   * await this.modifyItemResourceById(this.item, 0, -1);
   */
  async modifyItemResourceById(item, id, delta) {
    const res = this.getItemResourceById(item, id);
    if (!res) return null;
    return this.setItemResourceById(item, id, (res.value ?? 0) + delta);
  }

  /**
   * Increase a resource by index.
   * @param {Item} item
   * @param {number} id - Array index
   * @param {number} amount
   * @returns {Promise<number | null>}
   */
  async increaseItemResourceById(item, id, amount = 1) {
    return this.modifyItemResourceById(item, id, Math.abs(amount));
  }

  /**
   * Decrease a resource by index.
   * @param {Item} item
   * @param {number} id - Array index
   * @param {number} amount
   * @returns {Promise<number | null>}
   */
  async decreaseItemResourceById(item, id, amount = 1) {
    return this.modifyItemResourceById(item, id, -Math.abs(amount));
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Build a stable Proxy context for script execution.
   * Captures actor and item in a closure so they remain accessible even inside
   * async IIFEs where a finally-block might otherwise clear instance properties.
   * All other property/method accesses delegate to the original script instance.
   * @param {Actor|null}  executingActor
   * @param {Item|null}   executingItem
   * @returns {Proxy}
   */
  _buildContext(executingActor, executingItem) {
    const script = this;
    const proxy = new Proxy(this, {
      get(target, prop) {
        if (prop === "actor") return executingActor ?? script.effect?.actor ?? null;
        if (prop === "item")  return executingItem  ?? (script.effect?.parent?.documentName === "Item" ? script.effect.parent : null);
        const val = target[prop];
        if (typeof val === "function") return val.bind(proxy);
        return val;
      }
    });
    return proxy;
  }

  async execute(args = {}) {
    const executingActor = args.actor ?? null;
    const executingItem  = args.item  ?? null;
    const ctx = this._buildContext(executingActor, executingItem);
    this._currentArgs = args;
    try {
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

      // Try to wrap the code as a return-expression so that Promises from IIFE
      // patterns like `(async () => { ... })()` are properly returned and awaited
      // by the caller.  If the code contains top-level statements (not a valid
      // expression), AsyncFunction construction throws a SyntaxError → fall back.
      let fn;
      const expr = this.code.trimEnd().replace(/;\s*$/, "");
      try {
        fn = new AsyncFunction("args", `return (${expr})`);
      } catch {
        fn = new AsyncFunction("args", this.code);
      }

      return await fn.call(ctx, args);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.debug(`Neuroshima | Script Syntax [${this.label}]:`, e.message);
      } else {
        console.error(`Neuroshima | Script Error [${this.label}]:`, e);
        ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
      }
    } finally {
      this._currentArgs = null;
    }
  }

  executeSync(args = {}) {
    const executingActor = args.actor ?? null;
    const executingItem  = args.item  ?? null;
    const ctx = this._buildContext(executingActor, executingItem);
    this._currentArgs = args;
    try {
      const fn = new Function("args", this.code);
      return fn.call(ctx, args);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.debug(`Neuroshima | Script Syntax [${this.label}]:`, e.message);
      } else {
        console.error(`Neuroshima | Script Error [${this.label}]:`, e);
        ui.notifications.error(`Script Error [${this.label}]: ${e.message}`);
      }
    } finally {
      this._currentArgs = null;
    }
  }
}

/**
 * Manages and executes Neuroshima scripts stored as flags on ActiveEffects.
 *
 * Scripts are stored in flags.neuroshima.scripts as:
 * [{ trigger: string, label: string, code: string }]
 *
 * Available triggers:
 *
 * manual           — Manually Invoked: executed by clicking ▶ on the actor sheet
 *                    args: { actor }
 *
 * immediate        — Immediate: runs once right after the effect is created on an actor.
 *                    Ideal for one-shot consumables (apply and auto-delete the effect).
 *                    args: { actor, data, options }
 *
 * prepareData      — Prepare Data: runs during actor.prepareDerivedData() [SYNC, no await]
 *                    args: { actor }
 *                    Use: directly modify actor.system.* values
 *
 * preRollTest      — Pre-Roll Test: runs BEFORE any skill/attribute roll, can cancel or auto-succeed it
 *                    args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                            attributeKey, skillKey, autoSuccess, cancelled, annotation }
 *                    Use: set args.autoSuccess = true  → skip roll, count as success
 *                         set args.cancelled = true    → abort the roll entirely
 *                         set args.annotation = "text" → custom message shown in chat
 *
 * rollTest         — Roll Test: runs after preRollTest (only if not cancelled/autoSuccess)
 *                    args: { actor, stat, skill, skillBonus, attributeBonus, penalties, label,
 *                            attributeKey, skillKey }
 *                    Use: modify args.stat, args.skill, args.penalties.mod to affect the roll
 *
 * preApplyDamage   — Pre-Apply Damage: runs BEFORE armor reduction for an incoming hit.
 *                    Modify raw wound list before armor/pain resistance processing.
 *                    args: { actor, location, damageType, rawWounds, piercing }
 *                    Use: push/pop entries in args.rawWounds, or change args.damageType
 *
 * applyDamage      — Apply Damage: runs before pain resistance is processed for incoming wounds
 *                    args: { actor, wounds: [{name, damageType, forcePassed?, forceSkip?, annotation?}], location }
 *                    Use: set wound.forcePassed = true  → auto-pass pain resistance for that wound
 *                         set wound.forceSkip   = true  → remove the wound entirely
 *                         set wound.annotation  = "text"→ custom text shown in chat for this wound
 *
 * armorCalculation — Armour Calculation: runs before armor SP reduction is applied to an incoming hit [SYNC]
 *                    args: { actor, location, damageType, sp, piercing, bonusSP }
 *                    Use: modify args.sp, args.bonusSP to change effective armor value
 *
 * equipToggle      — Equip Toggle: runs after an item is equipped or unequipped
 *                    args: { actor, item, equipped }
 *                    Use: apply/remove custom bonuses based on equipped state
 *
 * startCombat      — Start Combat: runs when combat starts (once per actor)
 *                    args: { actor, combat }
 *
 * startRound       — Start Round: runs at the beginning of each combat round (once per actor)
 *                    args: { actor, combat, round }
 *
 * startTurn        — Start Turn: runs at the beginning of each of the actor's turns
 *                    args: { actor, combat, combatant }
 *
 * endTurn          — End Turn: runs at the end of each of the actor's turns
 *                    args: { actor, combat, combatant }
 *
 * endRound         — End Round: runs at the end of each combat round (once per actor)
 *                    args: { actor, combat, round }
 *
 * endCombat        — End Combat: runs when combat ends (once per actor)
 *                    args: { actor, combat }
 *
 * preWeaponShot    — Pre-Weapon Shot: runs BEFORE jamming is evaluated for a ranged shot.
 *                    Allows scripts to shift the jam threshold or force/prevent jamming entirely.
 *                    Never fires for melee weapons.
 *                    args: { actor, weapon, jammingThreshold, ammoJamming, bestResult,
 *                            forceNoJam, forceJam }
 *                    Use: args.jammingThreshold += N  → raise threshold (harder to jam)
 *                         args.jammingThreshold -= N  → lower threshold (easier to jam)
 *                         args.forceNoJam = true      → weapon cannot jam this shot
 *                         args.forceJam   = true      → weapon always jams this shot
 *                    Helpers: this.modifyJammingThreshold(args, delta)
 *                             this.preventWeaponJam(args)
 *                             this.forceWeaponJam(args)
 *                             this.getWeaponJammingThreshold(weapon)
 *
 * weaponJam        — Weapon Jam: runs ONLY when a jam is detected, before ammo is withheld.
 *                    Allows scripts to allow firing despite the jam, or clear the jam.
 *                    Never fires for melee weapons.
 *                    args: { actor, weapon, bestResult, jammingThreshold, wouldSucceed,
 *                            canFireDespiteJam, clearJam, despiteJamBullets }
 *                    Use: args.canFireDespiteJam = true → consume ammo and fire despite jam
 *                              (weapon stays jammed — needs repair; implements "Na pewno działa!")
 *                         args.clearJam = true          → jam is cancelled entirely (normal shot,
 *                              also clears pre-existing system.jammed flag on the weapon)
 *                    Helpers: this.allowShotDespiteJam(args, count=1)
 *                             this.clearWeaponJam(args)
 *                             this.isStandardJam(args, min=1, max=20) → inRange AND wouldSucceed
 *                             this.getWeaponJammedState(weapon) → was weapon already jammed?
 *
 * postWeaponShot   — Post-Weapon Shot: runs AFTER the full ranged shot is resolved.
 *                    Fires even if the weapon jammed (isJamming may be true).
 *                    Never fires for melee weapons.
 *                    args: { actor, weapon, isSuccess, isJamming, firedDespiteJam,
 *                            despiteJamBullets, hitBullets, bulletsFired, successPoints, rollData }
 *                    Use: apply conditions/effects to shooter based on shot result,
 *                         send custom chat messages, trigger secondary effects.
 *
 * createEffect     — Effect Created: runs once when this effect is created on an actor
 *                    args: { actor, data, options }
 *
 * deleteEffect     — Effect Deleted: runs once when this effect is deleted from an actor
 *                    args: { actor, options }
 *
 * Context available inside every script (via `this`):
 *   this.effect                    — The ActiveEffect owning this script
 *   this.actor                     — The actor (parent of effect or item)
 *   this.item                      — The item (if the effect lives on an item)
 *   this.token                     — The first scene token for this actor (or null)
 *   this.notification(msg, type)   — Shows a UI notification
 *   this.roll(formula, data?, options?) — Evaluate a dice formula → Roll (async)
 *                                    options: { flavor, rollMode, toMessage, speaker }
 *                                    If flavor or toMessage is set, roll is posted to chat.
 *   this.sleep(ms)                 — Async pause in milliseconds
 *   this.getTargets()              — Actors targeted by the user
 *   this.getSelected()             — Actors of selected tokens (fallback: assigned character)
 *   this.getTargetsOrSelected()    — Targets if any, otherwise selected
 *   this.isLightDamage(type)         — true for D, sD, L, sL
 *   this.isHeavyDamage(type)         — true for C, sC, K, sK
 *   this.isBruiseDamage(type)        — true for sD, sL, sC, sK (s-prefix track)
 *   this.isMinDamage(type)           — true for D or sD (minimum on track; heal instead of reduce)
 *   this.isMaxDamage(type)           — true for K or sK (maximum on track)
 *   this.compareDamage(a, b)         — -1/0/1 severity comparison
 *   this.getSeverityIndex(type)      — position in track: D/sD=0, L/sL=1, C/sC=2, K/sK=3 (-1 unknown)
 *   this.reduceDamageType(type, n)   — lower severity by n levels within track (D/sD floor)
 *   this.increaseDamageType(type, n) — raise severity by n levels within track (K/sK ceiling)
 *   this.getDiceResults(roll, idx?)  — extract number[] from Roll.dice[idx] (default 0)
 *   this.getEffectiveWounds(args)    — wounds from args that are NOT forceSkip'd
 *   this.getHitLocation(args)        — location key from args (applyDamage/preApplyDamage)
 *   this.isBodyLocation(loc)         — true for character/NPC/creature locations
 *   this.isVehicleLocation(loc)      — true for vehicle locations
 *   this.getLocationLabel(loc)       — localized location name
 *   this.getChatData(merge?)         — ChatMessage data with default speaker/flavor
 *   this.sendMessage(html, data?)    — Create a chat message (async)
 *
 * Weapon / Jamming helpers (use in preWeaponShot / weaponJam / postWeaponShot triggers):
 *   this.getWeaponJammingThreshold(weapon)     — weapon's raw jamming value (default 20)
 *   this.getWeaponJammedState(weapon)          — true if weapon.system.jammed (from previous shot)
 *   this.modifyJammingThreshold(args, delta)   — shift threshold in preWeaponShot (+harder, -easier)
 *   this.preventWeaponJam(args)                — forceNoJam = true (preWeaponShot)
 *   this.forceWeaponJam(args)                  — forceJam = true (preWeaponShot)
 *   this.allowShotDespiteJam(args, count=1)    — canFireDespiteJam = true + bullet limit (weaponJam)
 *   this.clearWeaponJam(args)                  — clearJam = true, also clears system.jammed (weaponJam)
 *   this.isStandardJam(args, min=1, max=20)    — true if bestResult in [min,max] AND wouldSucceed; swaps min/max if inverted
 *
 * Wound helpers:
 *   this.getWounds(filter?, actor?)       — wound items matching filter (active, location, damageType, bruise)
 *   this.getWoundCount(actor?)            — number of active wounds
 *   this.applyWound(damageType, loc?, actor?) — create a wound directly (bypasses pain resistance)
 *
 * Condition helpers:
 *   this.getConditionValue(key, actor?)   — current int-condition stack count (0 if inactive)
 *   this.setConditionValue(key, n, actor?) — set int-condition value directly (0 = remove)
 *   this.addCondition(key, actor?)        — add/increment condition
 *   this.removeCondition(key, actor?)     — remove/decrement condition
 *
 * Actor stat helpers:
 *   this.getAttribute(key, actor?)        — attribute base value
 *   this.getAttributeTotal(key, actor?)   — attribute base + modifier
 *   this.getSkill(key, actor?)            — skill value
 *   this.hasEffect(nameOrId, actor?)      — true if actor has an active effect with that name/id
 *
 * Armor helpers (item = equipped armor Item):
 *   this.getEquippedArmors(actor?)                — Item[] of equipped armors on actor
 *   this.getArmorRating(item, location)            — base SP at location
 *   this.getArmorEffective(item, location)         — effective SP (rating − damage, min 0)
 *   this.getArmorDurability(item)                  — { max, damage, remaining }
 *   await this.damageArmorLocation(item, loc, n)   — add n to location damage (clamped to rating)
 *   await this.repairArmorLocation(item, loc, n)   — reduce location damage by n (min 0)
 *   await this.damageArmorDurability(item, n)      — add n to durabilityDamage (clamped to max)
 *   await this.repairArmorDurability(item, n)      — reduce durabilityDamage by n (min 0)
 *
 * Item resource helpers (item = any Item with a "resources" tab; use this.item for own item):
 *   By KEY (string key field):
 *   this.hasItemResource(item, key)                 — true if resource with key exists
 *   this.getItemResource(item, key)                 — current value (null if not found)
 *   await this.setItemResource(item, key, value)    — set value, clamped to [min, max] (max=0 = uncapped)
 *   await this.modifyItemResource(item, key, delta) — value += delta, clamped
 *   await this.increaseItemResource(item, key, n=1) — value += |n|, clamped to max
 *   await this.decreaseItemResource(item, key, n=1) — value -= |n|, clamped to min
 *   By ID (array index, auto re-packs on delete):
 *   this.getItemResourceById(item, id)                 — full resource object (null if not found)
 *   await this.setItemResourceById(item, id, value)    — set value by index, clamped
 *   await this.modifyItemResourceById(item, id, delta) — value += delta by index, clamped
 *   await this.increaseItemResourceById(item, id, n=1) — value += |n| by index
 *   await this.decreaseItemResourceById(item, id, n=1) — value -= |n| by index
 *
 * Damage type constants (for use in scripts):
 *   D  sD  L  sL  C  sC  K  sK    (rany postaci, od najlżejszej; s = siniak)
 *   VL  VC  VK                     (vehicle damage)
 */
export class NeuroshimaScriptRunner {
  static TRIGGERS = {
    manual:           "Manually Invoked",
    immediate:        "Immediate",
    prepareData:      "Prepare Data",
    preRollTest:      "Pre-Roll Test",
    rollTest:         "Roll Test",
    preApplyDamage:   "Pre-Apply Damage",
    applyDamage:      "Apply Damage",
    armorCalculation: "Armour Calculation",
    equipToggle:      "Equip Toggle",
    startCombat:      "Start Combat",
    startRound:       "Start Round",
    startTurn:        "Start Turn",
    endTurn:          "End Turn",
    endRound:         "End Round",
    endCombat:        "End Combat",
    createEffect:     "Effect Created",
    deleteEffect:     "Effect Deleted",
    preWeaponShot:    "Pre-Weapon Shot",
    weaponJam:        "Weapon Jam",
    postWeaponShot:   "Post-Weapon Shot"
  };

  /**
   * Damage type severity order for helpers.
   */
  static DAMAGE_ORDER = ["D", "sD", "L", "sL", "C", "sC", "K", "sK"];

  /**
   * Body location keys — valid for character, NPC, and creature actors.
   */
  static BODY_LOCATIONS = ["head", "rightArm", "leftArm", "torso", "rightLeg", "leftLeg"];

  /**
   * Vehicle location keys — valid for vehicle actors.
   */
  static VEHICLE_LOCATIONS = ["front", "rightSide", "leftSide", "rear", "bottom"];

  /**
   * Return true if the location is a body location (character / NPC / creature).
   * @param {string} location
   * @returns {boolean}
   */
  static isBodyLocation(location) {
    return this.BODY_LOCATIONS.includes(location);
  }

  /**
   * Return true if the location is a vehicle location.
   * @param {string} location
   * @returns {boolean}
   */
  static isVehicleLocation(location) {
    return this.VEHICLE_LOCATIONS.includes(location);
  }

  /**
   * Return the localized label for a hit location key.
   * Works for both body locations and vehicle locations.
   * Returns the raw key if no label is found.
   * @param {string} location
   * @returns {string}
   */
  static getLocationLabel(location) {
    const NEUROSHIMA = game.neuroshima?.NEUROSHIMA ?? {};
    const bodyEntry = NEUROSHIMA.bodyLocations?.[location];
    if (bodyEntry?.label) return game.i18n.localize(bodyEntry.label);
    const vehicleKey = NEUROSHIMA.vehicleLocations?.[location];
    if (vehicleKey) return game.i18n.localize(vehicleKey);
    return location;
  }

  /**
   * Check if a damage type is "light" (D, sD, L, sL).
   * @param {string} damageType
   */
  static isLightDamage(damageType) {
    return ["D", "sD", "L", "sL"].includes(damageType);
  }

  /**
   * Check if a damage type is "heavy or worse" (C, sC, K, sK).
   * @param {string} damageType
   */
  static isHeavyDamage(damageType) {
    return ["C", "sC", "K", "sK"].includes(damageType);
  }

  /**
   * Compare two damage types. Returns negative if a < b, 0 if equal, positive if a > b.
   * @param {string} a
   * @param {string} b
   */
  static compareDamage(a, b) {
    return this.DAMAGE_ORDER.indexOf(a) - this.DAMAGE_ORDER.indexOf(b);
  }

  /**
   * Collect all scripts from actor effects and embedded item effects for a given trigger.
   * Supports character, NPC, creature, and vehicle actor types.
   * For items: only collects from equipped items (if item has equipped property).
   * @param {Actor} actor
   * @param {string} trigger
   * @returns {NeuroshimaScript[]}
   */
  static getScripts(actor, trigger) {
    const scripts = [];
    if (!actor) return scripts;

    const collectFromEffect = (effect, skipSuppressedCheck = false) => {
      if (!skipSuppressedCheck && effect.isSuppressed) return;
      const isDisabled = effect.disabled;
      const effectScripts = effect.scripts ?? [];
      for (const script of effectScripts) {
        if (script.trigger !== trigger) continue;
        if (isDisabled && !script.runIfDisabled) continue;
        scripts.push(script);
      }
    };

    const actorItemUuids = new Set((actor.items ?? []).map(i => i.uuid));

    for (const effect of (actor.effects ?? [])) {
      if (effect.getFlag("neuroshima", "fromEquipTransfer")) continue;
      if (effect.origin && actorItemUuids.has(effect.origin)) continue;
      collectFromEffect(effect);
    }

    for (const item of (actor.items ?? [])) {
      const hasEquipped  = "equipped" in (item.system ?? {});
      const isUnequipped = hasEquipped && item.system.equipped === false;
      for (const effect of (item.effects ?? [])) {
        const equipTransfer = effect.getFlag("neuroshima", "equipTransfer") ?? false;
        const skipped = equipTransfer && isUnequipped && trigger !== "equipToggle";
        if (skipped) {
          game.neuroshima?.log?.(`[getScripts:${trigger}] POMINIĘTY efekt "${effect.name}" na item "${item.name}" (equipTransfer=true, unequipped)`);
          continue;
        }
        collectFromEffect(effect, true);
      }
    }

    game.neuroshima?.log?.(`[getScripts:${trigger}] znaleziono ${scripts.length} skryptów`, scripts.map(s => `${s.label} @ ${s.effect?.name}`));

    return scripts;
  }

  /**
   * Execute all scripts for a given trigger on the actor (async).
   * @param {string} trigger
   * @param {Object} args - Arguments passed to each script
   * @returns {Promise<void>}
   */
  static async execute(trigger, args = {}) {
    const actor = args.actor;
    if (!actor) return;
    const scripts = this.getScripts(actor, trigger);
    for (const script of scripts) {
      if (trigger === "applyDamage" && Array.isArray(args.wounds)) {
        const before = args.wounds.map(w => ({ forcePassed: w.forcePassed, annotation: w.annotation }));
        await script.execute(args);
        args.wounds.forEach((w, i) => {
          if (w.forcePassed && !before[i].forcePassed && !w.effectName) {
            w.effectName = script.effect?.name ?? "";
          }
          const newAnnotation = w.annotation;
          const oldAnnotation = before[i].annotation;
          if (newAnnotation && oldAnnotation && newAnnotation !== oldAnnotation) {
            w.annotation = `${oldAnnotation}\n${newAnnotation}`;
          }
        });
      } else {
        await script.execute(args);
      }
    }
  }

  /**
   * Execute all scripts for a given trigger synchronously.
   * Use for triggers called from synchronous methods (e.g. prepareDerivedData).
   * Scripts must not use async/await — they run synchronously.
   * @param {string} trigger
   * @param {Object} args - Arguments passed to each script
   */
  static executeSync(trigger, args = {}) {
    const actor = args.actor;
    if (!actor) return;
    const scripts = this.getScripts(actor, trigger);
    for (const script of scripts) {
      script.executeSync(args);
    }
  }

  /**
   * Execute manual scripts on an actor (called from the actor sheet).
   * @param {Actor} actor
   * @param {ActiveEffect} effect
   * @param {number} scriptIndex
   * @returns {Promise<void>}
   */
  static async executeManual(actor, effect, scriptIndex) {
    const resolvedActor = actor
      ?? effect.actor
      ?? game.user.character
      ?? canvas.tokens?.controlled?.[0]?.actor
      ?? null;

    if (!resolvedActor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
      return;
    }

    const effectScripts = effect.getFlag("neuroshima", "scripts") || [];
    const scriptData = effectScripts[scriptIndex];
    if (!scriptData || scriptData.trigger !== "manual") return;
    const script = new NeuroshimaScript(scriptData, effect);
    await script.execute({ actor: resolvedActor, item: effect.parent?.documentName === "Item" ? effect.parent : null });
  }

  /**
   * Run preRollTest scripts and return result flags.
   * @param {Actor} actor
   * @param {Object} rollArgs - Current roll parameters
   * @returns {Promise<{autoSuccess: boolean, cancelled: boolean}>}
   */
  static async runPreRollTest(actor, rollArgs) {
    if (!actor) return { autoSuccess: false, cancelled: false };
    const args = { ...rollArgs, autoSuccess: false, cancelled: false };
    await this.execute("preRollTest", args);
    return { autoSuccess: !!args.autoSuccess, cancelled: !!args.cancelled };
  }

  /**
   * Run startCombat scripts for all combatants that have a linked actor.
   * @param {Combat} combat
   */
  static async runStartCombat(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("startCombat", { actor, combat });
    }
  }

  /**
   * Run startTurn scripts for the current combatant's actor.
   * @param {Combat} combat
   * @param {Combatant} combatant
   */
  static async runStartTurn(combat, combatant) {
    const actor = combatant?.actor;
    if (!actor) return;
    await this.execute("startTurn", { actor, combat, combatant });
  }

  /**
   * Run endTurn scripts for the current combatant's actor.
   * @param {Combat} combat
   * @param {Combatant} combatant
   */
  static async runEndTurn(combat, combatant) {
    const actor = combatant?.actor;
    if (!actor) return;
    await this.execute("endTurn", { actor, combat, combatant });
  }

  /**
   * Run endCombat scripts for all combatants that have a linked actor.
   * @param {Combat} combat
   */
  static async runEndCombat(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("endCombat", { actor, combat });
    }
  }

  /**
   * Run startRound scripts for all combatants at the beginning of a new round.
   * Called once per actor (deduped).
   * @param {Combat} combat
   */
  static async runStartRound(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("startRound", { actor, combat, round: combat.round });
    }
  }

  /**
   * Run endRound scripts for all combatants at the end of a round.
   * @param {Combat} combat
   */
  static async runEndRound(combat) {
    const actors = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || actors.has(actor.id)) continue;
      actors.add(actor.id);
      await this.execute("endRound", { actor, combat, round: combat.round });
    }
  }

  // ── Script utility helpers (available in scripts via game.neuroshima.NeuroshimaScriptRunner) ──

  /**
   * Return all actors targeted by the current user's token targeting.
   * Returns an empty array if nothing is targeted.
   * @returns {Actor[]}
   */
  static getTargets() {
    return Array.from(game.user.targets).map(t => t.actor).filter(a => a);
  }

  /**
   * Return actors of all currently selected tokens on the canvas.
   * Falls back to the user's assigned character if no token is selected.
   * @returns {Actor[]}
   */
  static getSelected() {
    const selected = canvas.tokens?.controlled.map(t => t.actor).filter(a => a) ?? [];
    if (selected.length) return selected;
    if (game.user.character) return [game.user.character];
    return [];
  }

  /**
   * Return targeted actors if any targets exist, otherwise fall back to selected tokens.
   * @returns {Actor[]}
   */
  static getTargetsOrSelected() {
    const targets = this.getTargets();
    return targets.length ? targets : this.getSelected();
  }

  /**
   * Async sleep / delay.
   * Useful for waiting between steps (e.g. after Dice So Nice animations).
   * @param {number} ms - Milliseconds to wait.
   * @returns {Promise<void>}
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Roll a dice formula and return the evaluated Roll object.
   * Convenience wrapper around `new Roll(formula).evaluate()`.
   * @param {string} formula - A valid Foundry dice formula (e.g. "1d100", "2d6+3").
   * @param {Object} [data={}]  - Formula data for variable substitution.
   * @returns {Promise<Roll>}
   */
  static async rollDice(formula, data = {}) {
    return new Roll(formula, data).evaluate();
  }

  /**
   * Check all actors in a combat and delete effects whose duration has expired.
   * Must be called by GM only. Intended to be called from the updateCombat hook.
   *
   * An effect is expired when:
   *   - it has a rounds-based or seconds-based duration
   *   - effect.duration.remaining is not null and is <= 0
   *
   * @param {Combat} combat
   * @returns {Promise<void>}
   */
  static async expireEffects(combat) {
    if (!game.user.isGM) return;
    // If a duration-handling module (e.g. "Times Up") is active, let it manage expiry.
    if (game.modules.get("times-up")?.active) return;
    if (game.modules.get("combat-utility-belt")?.active &&
        game.settings.get("combat-utility-belt", "enableConditionLab") === true) return;

    const currentRound = combat.round;
    const seen = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || seen.has(actor.id)) continue;
      seen.add(actor.id);

      const toDelete = actor.effects
        .filter(e => {
          // Primary: use Foundry's computed remaining (works when duration.combat is set)
          const d = e.duration;
          if (d && d.type !== "none" && d.remaining !== null && d.remaining !== undefined && d.remaining <= 0) {
            return true;
          }
          // Fallback: manual rounds check (handles effects without duration.combat set)
          const rounds     = e.duration?.rounds ?? 0;
          const startRound = e.duration?.startRound ?? null;
          if (rounds > 0 && startRound !== null) {
            return (startRound + rounds) <= currentRound;
          }
          return false;
        })
        .map(e => e.id);

      if (toDelete.length) {
        game.neuroshima?.log(`Expiring ${toDelete.length} effect(s) on ${actor.name}`);
        await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
      }
    }
  }
}
