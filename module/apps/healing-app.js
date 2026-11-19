const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/rolls.js";
import { HealingTest } from "../tests.mjs";
import { applicationInstances, NeuroshimaSocket } from "../helpers/foundry-compat.js";

/**
 * Application V2 dla panelu leczenia pacjenta
 */
export class HealingApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static _patientUpdates = new Map();

    static registerSocketHandlers(socket) {
        socket.register("applyHealingBatch", function (data) {
            const requester = game.users?.get(this?.socketdata?.userId);
            if (game.user.isGM && requester) return HealingApp.applyHealingBatch(data, requester);
            return false;
        });
        socket.register("refreshHealingPanels", data => this.refreshPanels(data));
    }

    /** Refresh only existing panels; socket notifications carry no patient data. */
    static refreshPanels({ patientUuid } = {}) {
        if (!patientUuid) return;
        for (const app of applicationInstances()) {
            if (app instanceof HealingApp
                && (app._patientActorUuid === patientUuid || app.patientRef?.uuid === patientUuid)) {
                app._queueRefresh();
            }
        }
    }

    static async notifyPatientChanged(patientUuid) {
        this.refreshPanels({ patientUuid });
        try { await NeuroshimaSocket.executeForAll("refreshHealingPanels", { patientUuid }); }
        catch (error) { console.error("Neuroshima | Healing panel refresh notification failed", error); }
    }

    /** Apply results from a saved report with the requesting user's permissions. */
    static async applyHealingBatch({ patientUuid, messageId } = {}, requester = game.user) {
        const message = game.messages.get(messageId);
        if (message?.getFlag("neuroshima", "messageType") !== "healingBatchReport") return false;
        const recordedPatient = message.getFlag("neuroshima", "patientUuid");
        if (!recordedPatient) return false;
        const document = await fromUuid(recordedPatient);
        const patient = document?.actor ?? document;
        if (!patient?.items || (patientUuid && patientUuid !== recordedPatient && patientUuid !== patient.uuid)) return false;
        if (!requester) return false;
        if (!requester.isGM && !patient.testUserPermission(requester, "OWNER")) {
            if (requester.id !== message.author?.id) return false;
            const medicUuid = message.getFlag("neuroshima", "medicUuid");
            const medic = medicUuid ? await fromUuid(medicUuid) : null;
            if (!(medic?.actor ?? medic)?.testUserPermission(requester, "OWNER")) return false;
        }

        const key = patient.uuid;
        const previous = this._patientUpdates.get(key) ?? Promise.resolve();
        const operation = previous.catch(() => {}).then(() => this._applyHealingBatch(patient, message));
        this._patientUpdates.set(key, operation);
        try { return await operation; }
        finally {
            if (this._patientUpdates.get(key) === operation) this._patientUpdates.delete(key);
        }
    }

    static async _applyHealingBatch(patient, message) {
        if (message.getFlag("neuroshima", "healingApplied")) return false;
        const method = message.getFlag("neuroshima", "healingMethod");
        const tests = message.getFlag("neuroshima", "test")?.context?.batchTests;
        if (!["firstAid", "woundTreatment"].includes(method) || !Array.isArray(tests)) return false;
        const results = new Map();
        for (const test of tests) {
            const { preData, result } = test ?? {};
            const wound = patient.items.get(result?.woundId);
            if (wound?.type !== "wound" || results.has(wound.id) || typeof result.isSuccess !== "boolean") continue;
            const config = preData?.woundConfig;
            if (config && config.woundId !== wound.id) continue;
            if (preData?.patientUuid && preData.patientUuid !== patient.uuid
                && preData.patientUuid !== message.getFlag("neuroshima", "patientUuid")) continue;
            const savedEffect = result.healingEffect;
            const oldChange = savedEffect?.penaltyChange ?? (savedEffect?.newPenalty - savedEffect?.oldPenalty);
            if (!config && !Number.isFinite(oldChange)) continue;
            results.set(wound.id, HealingTest.calculateWoundResult(wound, method, result.isSuccess, config,
                config ? null : oldChange));
        }
        if (!results.size) return false;
        await this._updateWounds(patient, method, results.values());
        await message.setFlag("neuroshima", "healingApplied", true);
        await this.notifyPatientChanged(patient.uuid);
        return true;
    }

    /** Save wound penalties and attempt counters, then remove healed wounds. */
    static async _updateWounds(patient, method, results) {
        const isFirstAid = method === "firstAid";
        const updates = [], toDelete = [];
        for (const result of results) {
            const wound = patient.items.get(result.woundId);
            if (wound?.type !== "wound") continue;
            const { oldPenalty, newPenalty } = result;
            const update = {
                _id: wound.id,
                "system.healingAttempts": (wound.system.healingAttempts || 0) + 1
            };
            if (wound.system.originalPenalty == null) update["system.originalPenalty"] = oldPenalty;
            if (isFirstAid && newPenalty < oldPenalty) {
                update["system.firstAidHealingApplied"] = (wound.system.firstAidHealingApplied || 0)
                    + oldPenalty - newPenalty;
            }
            if (result.isSuccess) {
                update["system.isHealing"] = true;
                if (isFirstAid) {
                    update["system.hadFirstAid"] = true;
                    update["system.failedFirstAidAttempts"] = 0;
                } else update["system.failedTreatmentAttempts"] = 0;
            } else {
                const field = isFirstAid ? "failedFirstAidAttempts" : "failedTreatmentAttempts";
                update[`system.${field}`] = (wound.system[field] || 0) + 1;
            }
            if (newPenalty <= 0) toDelete.push(wound.id);
            else {
                update["system.penalty"] = newPenalty;
                updates.push(update);
            }
        }
        if (updates.length) await patient.updateEmbeddedDocuments("Item", updates);
        if (toDelete.length) await patient.deleteEmbeddedDocuments("Item", toDelete);
    }

    /** Calculate a healing modifier before applying wound limits. */
    static calculatePenaltyChange(successPoints, method, hadFirstAid = false, healingModifier = 0, scriptHealingModifier = 0) {
        return HealingTest.calculatePenaltyChange(method, successPoints >= 2, {
            hadFirstAid, healingModifier, scriptHealingModifier
        });
    }

    /** Preview healing for the selected wounds. */
    static calculateHealingResults(patient, woundIds, successPoints, method, hadFirstAid = false, healingModifier = 0, scriptHealingModifier = 0) {
        const results = [];
        for (const id of new Set(woundIds)) {
            const wound = patient.items.get(id);
            if (wound?.type !== "wound") continue;
            results.push(HealingTest.calculateWoundResult(wound, method, successPoints >= 2, {
                hadFirstAid, healingModifier, scriptHealingModifier
            }));
        }
        return results;
    }

    /** Apply healing from a test and refresh the patient's open panels. */
    static async applyHealingToWounds(patient, woundIds, successPoints, method, hadFirstAid = false, healingModifier = 0, scriptHealingModifier = 0) {
        const results = this.calculateHealingResults(patient, woundIds, successPoints, method,
            hadFirstAid, healingModifier, scriptHealingModifier);
        if (results.length) {
            await this._updateWounds(patient, method, results);
            await this.notifyPatientChanged(patient.uuid);
        }
        return results;
    }


    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        id: "healing-app",
        tag: "div",
        classes: ["neuroshima", "healing-app"],
        window: {
            title: "NEUROSHIMA.HealingRequest.Title",
            resizable: true,
            minimizable: true,
            icon: "fas fa-heartbeat",
            centered: true
        },
        position: {
            width: 800,
            height: 700
        }
    };

    /** @inheritdoc */
    static PARTS = {
        header: {
            template: "systems/neuroshima/templates/apps/healing-app-header.hbs"
        },
        main: {
            template: "systems/neuroshima/templates/apps/healing-app-main.hbs",
            scrollable: [".wounds-list-container"]
        }
    };

    constructor(options = {}) {
        super(options);
        
        // Przechowuj sessionId, patientRef i medicRef z opcji
        this.sessionId = options.sessionId;
        this.patientRef = options.patientRef;
        this.medicRef = options.medicRef;
        
        // If refs are not in options directly, check in options.options (v13 pattern)
        if (!this.patientRef && options.options) {
            this.patientRef = options.options.patientRef;
            this.medicRef = options.options.medicRef;
            this.sessionId = options.options.sessionId;
        }
        
        // UI state
        this.selectedLocation = null;
        this._selectedWoundIds = new Set();
        this._documentHooks = [];
        this._observedActorUuids = new Set();
        this._observedRelatedUuids = new Set();
        this._refreshPending = false;
        this._closing = false;
        
        game.neuroshima?.log("HealingApp constructor", {
            sessionId: this.sessionId,
            patientRef: this.patientRef,
            medicRef: this.medicRef
        });
    }

    _observeDocuments() {
        if (this._documentHooks.length) return;
        this._closing = false;
        const changed = document => {
            let current = document;
            while (current) {
                if (this._observedActorUuids.has(current.uuid) || this._observedRelatedUuids.has(current.uuid)
                    || this._observedActorUuids.has(current.actor?.uuid)
                    || this._observedActorUuids.has(current.syntheticActor?.uuid)) {
                    this._queueRefresh();
                    return;
                }
                current = current.parent;
            }
        };
        for (const type of ["Actor", "Item", "ActiveEffect", "ActorDelta", "Token"]) {
            for (const action of ["create", "update", "delete"]) {
                const name = `${action}${type}`;
                this._documentHooks.push([name, Hooks.on(name, changed)]);
            }
        }
        for (const event of ["createChatMessage", "updateChatMessage"]) {
            this._documentHooks.push([event, Hooks.on(event, message => {
                const patientUuid = message.getFlag("neuroshima", "patientUuid");
                if (patientUuid && (patientUuid === this._patientActorUuid || patientUuid === this.patientRef?.uuid)) {
                    this._queueRefresh();
                }
            })]);
        }
        this._documentHooks.push(["updateWorldTime", Hooks.on("updateWorldTime", () => this._queueRefresh())]);
    }

    _queueRefresh() {
        if (this._closing) return;
        this._refreshPending = true;
        if (!this.rendered) return;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            if (!this.rendered || this._closing) return;
            this._refreshPending = false;
            Promise.resolve(this.render({ parts: ["header", "main"] })).catch(error => {
                console.error("Neuroshima | Healing panel refresh failed", error);
            });
        }, 100);
    }

    async close(options = {}) {
        this._closing = true;
        this._refreshPending = false;
        clearTimeout(this._refreshTimer);
        for (const [name, id] of this._documentHooks) Hooks.off(name, id);
        this._documentHooks = [];
        return super.close(options);
    }

    /** @inheritdoc */
    async _prepareContext(options) {
        game.neuroshima?.group("HealingApp | _prepareContext");
        
        // Resolve references
        const { actor: patientActor } = await game.neuroshima.resolveRef(this.patientRef);
        const { actor: medicActor } = await game.neuroshima.resolveRef(this.medicRef);

        if (!patientActor) {
            game.neuroshima?.error("Patient actor not found", this.patientRef);
            game.neuroshima?.groupEnd();
            return {
                error: true,
                errorMessage: `Patient actor not found (UUID: ${this.patientRef?.uuid || 'None'})`
            };
        }

        this._observedActorUuids = new Set([patientActor.uuid, medicActor?.uuid].filter(Boolean));
        this._patientActorUuid = patientActor.uuid;
        this._observedRelatedUuids = new Set([patientActor, medicActor].flatMap(actor => [
            actor?.token?.uuid, actor?.token?.baseActor?.uuid
        ]).filter(Boolean));
        this._observeDocuments();
        for (const id of this._selectedWoundIds) {
            if (patientActor.items.get(id)?.type !== "wound") this._selectedWoundIds.delete(id);
        }

        // Permissions: Medic (owner of medic actor or GM)
        const isGM = game.user.isGM;
        const isMedic = isGM || (medicActor ? medicActor.testUserPermission(game.user, "OWNER") : false);

        // Generate patient card data
        const patientData = game.neuroshima.CombatHelper.generatePatientCard(patientActor);

        // Build location map for fast access
        const locationsMap = {};
        for (const location of patientData.locations) {
            locationsMap[location.key] = location;
        }

        // Prepare data for location filter
        let selectedLocationWounds = [];
        if (this.selectedLocation) {
            selectedLocationWounds = locationsMap[this.selectedLocation]?.wounds || [];
        }

        // Calculate damage type totals and penalties
        const summary = {
            K: 0, C: 0, L: 0, D: 0,
            penalty: 0
        };

        const woundsToSum = this.selectedLocation ? selectedLocationWounds : patientData.locations.flatMap(l => l.wounds);
        for (const wound of woundsToSum) {
            if (summary[wound.damageType] !== undefined) {
                summary[wound.damageType]++;
            }
            summary.penalty += wound.penalty || 0;
        }

        game.neuroshima?.log("Preparing healing panel context", {
            actorName: patientActor.name,
            isMedic: isMedic,
            selectedLocation: this.selectedLocation,
            summary: summary
        });

        const context = {
            actor: patientActor,
            medicActor: medicActor,
            patientData: patientData,
            locationsMap: locationsMap,
            sessionId: this.sessionId,
            selectedLocation: this.selectedLocation,
            selectedLocationWounds: selectedLocationWounds,
            summary: summary,
            isMedic: isMedic,
            config: game.neuroshima.config
        };

        game.neuroshima?.groupEnd();
        return context;
    }

    /** @inheritdoc */
    _attachPartListeners(partId, htmlElement, options) {
        super._attachPartListeners(partId, htmlElement, options);

        if (partId === "main") {
            // Handle clicks on paper doll locations
            htmlElement.querySelectorAll(".body-location-hotspot").forEach(hotspot => {
                hotspot.addEventListener("click", (event) => {
                    event.preventDefault();
                    const locationKey = hotspot.dataset.location;
                    this._onLocationSelected(locationKey);
                });
            });

            // Handle wound checkboxes
            htmlElement.querySelectorAll(".wound-checkbox").forEach(checkbox => {
                checkbox.addEventListener("change", (event) => {
                    event.stopPropagation(); // Prevent triggering the row click event
                    if (checkbox.checked) this._selectedWoundIds.add(checkbox.dataset.woundId);
                    else this._selectedWoundIds.delete(checkbox.dataset.woundId);
                    this._updateHealButton(htmlElement);
                });
            });

            // Handle click on entire wound row (toggle checkbox)
            htmlElement.querySelectorAll(".wound-item").forEach(item => {
                item.style.cursor = "pointer";
                item.addEventListener("click", (event) => {
                    // If clicked directly on the checkbox, do nothing (let the natural change event fire)
                    if (event.target.classList.contains("wound-checkbox")) return;
                    
                    const checkbox = item.querySelector(".wound-checkbox");
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        // Manually dispatch change event to update the heal button
                        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                });
            });

            // Handle the heal selected wounds button
            const healBtn = htmlElement.querySelector(".heal-selected-wounds");
            if (healBtn) {
                healBtn.addEventListener("click", (event) => {
                    event.preventDefault();
                    this._onHealSelectedWounds(htmlElement);
                });
            }

            // Initialize heal button and "select all" checkbox state
            this._updateHealButton(htmlElement);

            // Handle "select all" checkbox
            const selectAllBtn = htmlElement.querySelector(".select-all-wounds");
            if (selectAllBtn) {
                selectAllBtn.addEventListener("change", (event) => {
                    const isChecked = event.target.checked;
                    htmlElement.querySelectorAll(".wound-checkbox").forEach(cb => {
                        cb.checked = isChecked;
                        if (isChecked) this._selectedWoundIds.add(cb.dataset.woundId);
                        else this._selectedWoundIds.delete(cb.dataset.woundId);
                    });
                    this._updateHealButton(htmlElement);
                });
            }
        }
    }

    /**
     * Handles location selection on the paper doll.
     */
    async _onLocationSelected(locationKey) {
        game.neuroshima?.group("HealingApp | _onLocationSelected");
        game.neuroshima?.log("Location selected", { location: locationKey });

        this.selectedLocation = this.selectedLocation === locationKey ? null : locationKey;
        
        // Manually update the paper doll and wound list without a full re-render
        // Using partial render to avoid window jumping and scroll position loss
        this.render({ parts: ["main"] });
        game.neuroshima?.groupEnd();
    }

    /** @inheritdoc */
    async _onRender(context, options) {
        await super._onRender(context, options);
        
        // Initialize paper doll
        this._initializeWoundLocationPanel(this.element);
        this._observeDocuments();
        this.element.querySelectorAll(".wound-checkbox").forEach(checkbox => {
            checkbox.checked = this._selectedWoundIds.has(checkbox.dataset.woundId);
        });
        this._updateHealButton(this.element);
        if (this._refreshPending) this._queueRefresh();
    }

    /**
     * Initializes the visual state of the paper doll.
     * @private
     */
    _initializeWoundLocationPanel(html) {
        const hotspots = html.querySelectorAll('.body-location-hotspot');
        const targetHotspot = Array.from(hotspots).find(h => h.dataset.location === this.selectedLocation);
        
        if (targetHotspot) {
            this._onPaperDollLocationSelect(targetHotspot);
        }
    }

    /**
     * Visually highlights the selected location on the paper doll.
     * @private
     */
    _onPaperDollLocationSelect(hotspot) {
        // Remove selected class from all hotspots
        this.element.querySelectorAll('.body-location-hotspot').forEach(hs => {
            hs.classList.remove('selected');
        });
        
        // Add selected class to the current one
        hotspot.classList.add('selected');
    }

    /**
     * Handles wound healing — shows an options dialog.
     */
    async _onHealWound(woundId) {
        game.neuroshima?.group("HealingApp | _onHealWound");
        game.neuroshima?.log("Initiating wound healing", { woundId: woundId });

        const { actor } = await game.neuroshima.resolveRef(this.patientRef);
        if (!actor) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.ActorNotFound"));
            game.neuroshima?.groupEnd();
            return;
        }

        const wound = actor.items.get(woundId);
        if (!wound) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.WoundNotFound"));
            game.neuroshima?.groupEnd();
            return;
        }

        game.neuroshima?.log("Wound found:", { name: wound.name, isHealing: wound.system.isHealing });

        // Show healing options dialog
        const action = await this._showHealingDialog(wound);
        if (!action) {
            game.neuroshima?.log("Wound healing cancelled");
            game.neuroshima?.groupEnd();
            return;
        }

        game.neuroshima?.log("Healing action selected", { action: action });

        // If user is GM, apply immediately; otherwise send via socket.
        if (game.user.isGM) {
            await HealingApp.healWound(actor, woundId, action);
            this.render();
        } else {
            // Send socket to GM via socketlib
            try {
                game.neuroshima.socket.executeAsGM("applyHealing", {
                    patientRef: this.patientRef,
                    medicRef: this.medicRef,
                    woundId: woundId,
                    action: action,
                    sessionId: this.sessionId
                });

                game.neuroshima?.log("Socket sent to GM via socketlib", { 
                    action: action, 
                    patientRef: this.patientRef,
                    medicRef: this.medicRef
                });
                
                // Refresh UI after healing (temporarily local; GM will send the report)
                setTimeout(() => {
                    this.render();
                }, 500);

                ui.notifications.info(game.i18n.format("NEUROSHIMA.HealingRequest.WoundHealed", {
                    woundName: wound.name,
                    action: game.i18n.localize(`NEUROSHIMA.HealingRequest.Action.${action}`)
                }));

            } catch (err) {
                game.neuroshima?.log("Error sending socket:", err);
                ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.HealingFailed"));
            }
        }

        game.neuroshima?.groupEnd();
    }

    /**
     * Shows the healing action selection dialog.
     */
    async _showHealingDialog(wound) {
        const woundLabel = wound.system.damageType ? 
            game.i18n.localize(game.neuroshima.config.woundConfiguration[wound.system.damageType]?.fullLabel || "NEUROSHIMA.Items.Type.Wound") : 
            wound.name;

        const isHealing = wound.system.isHealing;
        const healingDays = wound.system.healingDays || 0;

        let buttonOptions = [];

        // Always available: start or continue healing
        if (!isHealing) {
            buttonOptions.push({
                action: "start",
                label: game.i18n.localize("NEUROSHIMA.HealingRequest.Action.start"),
                default: true
            });
        } else {
            buttonOptions.push({
                action: "progress",
                label: `${game.i18n.localize("NEUROSHIMA.HealingRequest.Action.progress")} (${healingDays}d)`,
                default: true
            });
        }

        // Always available: complete healing (remove wound)
        buttonOptions.push({
            action: "complete",
            label: game.i18n.localize("NEUROSHIMA.HealingRequest.Action.complete")
        });

        // Cancel button
        buttonOptions.push({
            action: "cancel",
            label: game.i18n.localize("NEUROSHIMA.Actions.Cancel")
        });

        const content = `
            <div class="neuroshima healing-dialog">
                <p><strong>${wound.name}</strong> (${woundLabel})</p>
                ${isHealing ? `<p>${game.i18n.format("NEUROSHIMA.HealingRequest.HealingProgress", { days: healingDays })}</p>` : ""}
                <p>${game.i18n.localize("NEUROSHIMA.HealingRequest.SelectAction")}</p>
            </div>
        `;

        const action = await foundry.applications.api.DialogV2.wait({
            window: {
                title: game.i18n.localize("NEUROSHIMA.HealingRequest.HealWound"),
                classes: ["neuroshima"]
            },
            content: content,
            buttons: buttonOptions
        });

        return action === "cancel" ? null : action;
    }

    /**
     * Heals a wound — changes its state according to the selected action.
     * @param {Actor} actor - The patient actor
     * @param {string} woundId - The wound item ID
     * @param {string} action - Healing action ("start", "progress", "complete")
     * @returns {Promise<Item>}
     */
    static async healWound(actor, woundId, action = "progress") {
        game.neuroshima?.group("HealingApp | healWound");
        game.neuroshima?.log("Starting wound healing", {
            actorName: actor.name,
            woundId: woundId,
            action: action
        });

        try {
            // Retrieve wound
            const wound = actor.items.get(woundId);
            if (!wound || wound.type !== "wound") {
                game.neuroshima?.log("Error: Wound not found for healing");
                game.neuroshima?.groupEnd();
                return null;
            }

            game.neuroshima?.log("Wound found:", {
                name: wound.name,
                isHealing: wound.system.isHealing,
                healingDays: wound.system.healingDays
            });

            // Prepare update
            const updateData = {};

            if (action === "start") {
                // Start healing
                updateData["system.isHealing"] = true;
                updateData["system.healingDays"] = 1;
                game.neuroshima?.log("Action: Start healing");
                
            } else if (action === "progress") {
                // Continue healing — increment days
                if (!wound.system.isHealing) {
                    updateData["system.isHealing"] = true;
                    updateData["system.healingDays"] = 1;
                } else {
                    updateData["system.healingDays"] = (wound.system.healingDays || 0) + 1;
                }
                game.neuroshima?.log("Action: Healing progress");
                
            } else if (action === "complete") {
                // Complete healing — remove wound
                game.neuroshima?.log("Action: Complete healing — removing wound");
                await actor.deleteEmbeddedDocuments("Item", [woundId]);
                await this.notifyPatientChanged(actor.uuid);
                
                game.neuroshima?.log("Wound removed", { woundId: woundId });
                game.neuroshima?.groupEnd();
                return wound;
            }

            // Update wound
            if (Object.keys(updateData).length > 0) {
                await wound.update(updateData);
                await this.notifyPatientChanged(actor.uuid);
                
                game.neuroshima?.log("Wound updated", {
                    updates: updateData
                });
            }

            game.neuroshima?.groupEnd();
            return wound;

        } catch (err) {
            game.neuroshima?.log("Error during wound healing:", err);
            game.neuroshima?.groupEnd();
            throw err;
        }
    }

    /**
     * Updates the heal button state based on the number of selected wounds.
     */
    _updateHealButton(htmlElement) {
        const allCheckboxes = htmlElement.querySelectorAll(".wound-checkbox");
        const checkedCheckboxes = htmlElement.querySelectorAll(".wound-checkbox:checked");
        const healBtn = htmlElement.querySelector(".heal-selected-wounds");
        const selectAllBtn = htmlElement.querySelector(".select-all-wounds");
        
        if (healBtn) {
            healBtn.disabled = checkedCheckboxes.length === 0;
        }

        if (selectAllBtn && allCheckboxes.length > 0) {
            selectAllBtn.checked = allCheckboxes.length === checkedCheckboxes.length;
            selectAllBtn.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < allCheckboxes.length;
        }

        game.neuroshima?.log("Heal button updated", {
            checkedWounds: checkedCheckboxes.length,
            totalWounds: allCheckboxes.length
        });
    }

    /**
     * Handles healing of selected wounds.
     */
    async _onHealSelectedWounds(htmlElement) {
        game.neuroshima?.group("HealingApp | _onHealSelectedWounds");
        
        const checkboxes = htmlElement.querySelectorAll(".wound-checkbox:checked");
        const selectedWoundIds = Array.from(checkboxes).map(cb => cb.dataset.woundId);

        game.neuroshima?.log("Selected wounds to heal", {
            count: selectedWoundIds.length,
            woundIds: selectedWoundIds
        });

        if (selectedWoundIds.length === 0) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.NoWoundsSelected"));
            game.neuroshima?.groupEnd();
            return;
        }

        // Resolve references
        const { actor: patientActor } = await game.neuroshima.resolveRef(this.patientRef);
        const { actor: medicActor } = await game.neuroshima.resolveRef(this.medicRef);
        
        if (!patientActor || !medicActor) {
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.HealingRequest.ActorNotFound"));
            game.neuroshima?.groupEnd();
            return;
        }

        game.neuroshima?.log("Actors found", { 
            patientName: patientActor.name,
            medicName: medicActor.name
        });

        // Show healing roll dialog with healing method selection
        const selectedIds = new Set(selectedWoundIds);
        const woundData = game.neuroshima.CombatHelper.generatePatientCard(patientActor)
            .locations.flatMap(location => location.wounds)
            .filter(wound => selectedIds.has(wound.id));
        if (!woundData.length) {
            this._queueRefresh();
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.HealingRequest.NoWoundsSelected"));
            game.neuroshima?.groupEnd();
            return;
        }

        game.neuroshima?.log("Opening healing roll dialog");

        await game.neuroshima.showHealingRollDialog({
            medicActor: medicActor,
            patientActor: patientActor,
            wounds: woundData,
            lastRoll: medicActor.system.lastRoll || {}
        });
        
        game.neuroshima?.groupEnd();
    }

    /**
     * Shows the healing method selection dialog.
     * @param {string[]} woundIds - IDs of selected wounds
     * @returns {Promise<{method: string, methodLabel: string}|null>}
     */
    async _showHealingMethodDialog(woundIds) {
        const content = `
            <div class="neuroshima healing-method-dialog">
                <p>${game.i18n.localize("NEUROSHIMA.HealingRequest.SelectHealingMethod")}</p>
                <div class="healing-methods">
                    <div class="healing-method-option">
                        <h4>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAid")}</h4>
                        <p class="healing-method-description">${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAidDesc")}</p>
                        <ul class="healing-method-rules">
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAidReduction")}</li>
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAidFailure")}</li>
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAidMax")}</li>
                        </ul>
                    </div>
                    <div class="healing-method-option">
                        <h4>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWounds")}</h4>
                        <p class="healing-method-description">${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWoundsDesc")}</p>
                        <ul class="healing-method-rules">
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWoundsReduction")}</li>
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWoundsFailure")}</li>
                            <li>${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWoundsMax")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;

        const buttons = [
            {
                action: "firstaid",
                label: `🏥 ${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAid")}`,
                default: true
            },
            {
                action: "treatwounds",
                label: `⚕️ ${game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWounds")}`
            },
            {
                action: "cancel",
                label: game.i18n.localize("NEUROSHIMA.Dialog.Cancel")
            }
        ];

        const method = await foundry.applications.api.DialogV2.wait({
            window: {
                title: game.i18n.localize("NEUROSHIMA.HealingRequest.SelectHealingMethod"),
                classes: ["neuroshima", "healing-method"]
            },
            content: content,
            buttons: buttons
        });

        if (method === "cancel") return null;

        const methodLabels = {
            firstaid: game.i18n.localize("NEUROSHIMA.HealingRequest.Method.FirstAid"),
            treatwounds: game.i18n.localize("NEUROSHIMA.HealingRequest.Method.TreatWounds")
        };

        return {
            method: method,
            methodLabel: methodLabels[method] || method
        };
    }

    /**
     * Performs the healing skill test and applies results.
     */
    async _performHealingTest(medicActor, healingMethod, selectedWoundIds) {
        game.neuroshima?.group("HealingApp | _performHealingTest");
        
        const isFirstAid = healingMethod.method === "firstaid";
        const skillKey = isFirstAid ? "firstAid" : "woundTreatment";
        const baseDifficultyKey = isFirstAid ? "average" : "problematic";
        const maxReduction = isFirstAid ? 5 : 15;
        
        game.neuroshima?.log("Healing test parameters", {
            method: healingMethod.method,
            skillKey: skillKey,
            difficulty: baseDifficultyKey,
            maxReduction: maxReduction
        });

        // Retrieve skill and attribute values
        const skillValue = medicActor.system.skills[skillKey]?.value || 0;
        const finalStat = Number(medicActor.system.attributeTotals?.cleverness) || 10;

        game.neuroshima?.log("Medic values", {
            cleverness: finalStat,
            skill: skillValue
        });

        const test = new HealingTest({
          actor: medicActor,
          attribute: { key: "cleverness", value: finalStat },
          skill: { key: skillKey, value: skillValue },
          preData: {
            label: healingMethod.methodLabel,
            penalties: {
                mod: NEUROSHIMA.difficulties[baseDifficultyKey]?.min || 0,
                wounds: 0,
                armor: 0
            }
          },
          context: { isOpen: true, healingMethod: isFirstAid ? "firstAid" : "woundTreatment" }
        });
        await test.roll();

        game.neuroshima?.log("Test executed, waiting for result");
        game.neuroshima?.groupEnd();
    }
}
