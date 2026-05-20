const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { NEUROSHIMA } from "../config.js";
import { NeuroshimaDice } from "../helpers/dice.js";

/**
 * Application V2 dla panelu leczenia pacjenta
 */
export class HealingApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * Calculates healing penalty change based on success, method, and modifiers
     * @param {number} successCount - Success points from closed test
     * @param {string} healingMethod - "firstAid" or "woundTreatment"
     * @param {boolean} hadFirstAid - Whether wound had First Aid previously
     * @param {number} healingModifier - Per-wound modifier (%)
     * @returns {number} Penalty change (negative=healing, positive=damage)
     */
    static calculatePenaltyChange(successCount, healingMethod, hadFirstAid = false, healingModifier = 0) {
        const isSuccess = successCount >= 2;
        const isFirstAid = healingMethod === "firstAid";
        
        let penaltyChange = 0;
        if (isSuccess) {
            // Success: reduces penalty
            if (isFirstAid) {
                penaltyChange = -5;
            } else {
                // Treat Wounds: 15% if fresh, 10% if had First Aid
                penaltyChange = hadFirstAid ? -10 : -15;
            }
        } else {
            // Failure: always increases penalty by 5%
            penaltyChange = 5;
        }
        
        // Add per-wound healing modifier
        penaltyChange += healingModifier;
        
        return penaltyChange;
    }

    /**
     * Calculates healing effects for wounds without applying them
     * @param {Actor} patientActor - Patient actor
     * @param {Array} woundIds - Wound IDs to process
     * @param {number} successCount - Success points
     * @param {string} healingMethod - "firstAid" or "woundTreatment"
     * @param {boolean} hadFirstAid - Whether wound had First Aid
     * @param {number} healingModifier - Per-wound modifier (%)
     * @returns {Array} Array of healing results with oldPenalty, newPenalty, penaltyChange
     */
    static calculateHealingResults(patientActor, woundIds, successCount, healingMethod, hadFirstAid = false, healingModifier = 0) {
        game.neuroshima?.group("HealingApp | calculateHealingResults");
        
        const penaltyChange = this.calculatePenaltyChange(successCount, healingMethod, hadFirstAid, healingModifier);
        const healingResults = [];
        
        for (const woundId of woundIds) {
            const wound = patientActor.items.get(woundId);
            if (!wound || wound.type !== "wound") continue;
            
            const oldPenalty = wound.system.penalty || 0;
            const isSuccess = successCount >= 2;
            const isFirstAidMethod = healingMethod === "firstAid";
            let newPenalty = Math.max(0, oldPenalty + penaltyChange);

            if (isSuccess) {
                const origPenalty = wound.system.originalPenalty ?? oldPenalty;
                if (isFirstAidMethod) {
                    const faRemaining = Math.max(0, 5 - (wound.system.firstAidHealingApplied || 0));
                    newPenalty = Math.max(oldPenalty - faRemaining, newPenalty);
                }
                newPenalty = Math.max(origPenalty - 15, newPenalty);
                newPenalty = Math.max(0, newPenalty);
            }
            
            game.neuroshima?.log("Healing calculation", {
                woundName: wound.name,
                oldPenalty,
                newPenalty,
                penaltyChange: newPenalty - oldPenalty
            });
            
            healingResults.push({
                woundId,
                woundName: wound.name,
                damageType: wound.system.damageType || "D",
                oldPenalty,
                newPenalty,
                penaltyChange: newPenalty - oldPenalty
            });
        }
        
        game.neuroshima?.groupEnd();
        return healingResults;
    }

    /**
     * Applies healing effects to wounds (updates actor)
     * @param {Actor} patientActor - Patient actor
     * @param {Array} woundIds - Wound IDs to process
     * @param {number} successCount - Success points
     * @param {string} healingMethod - "firstAid" or "woundTreatment"
     * @param {boolean} hadFirstAid - Whether wound had First Aid
     * @param {number} healingModifier - Per-wound modifier (%)
     * @returns {Promise<Array>} Array of applied healing results
     */
    static async applyHealingToWounds(patientActor, woundIds, successCount, healingMethod, hadFirstAid = false, healingModifier = 0) {
        game.neuroshima?.group("HealingApp | applyHealingToWounds");
        
        const penaltyChange = this.calculatePenaltyChange(successCount, healingMethod, hadFirstAid, healingModifier);
        const isSuccess = successCount >= 2;
        const isFirstAid = healingMethod === "firstAid";
        const woundsToUpdate = [];
        const healingResults = [];
        
        for (const woundId of woundIds) {
            const wound = patientActor.items.get(woundId);
            if (!wound || wound.type !== "wound") continue;
            
            const oldPenalty = wound.system.penalty || 0;
            const newPenalty = Math.max(0, oldPenalty + penaltyChange);
            
            game.neuroshima?.log("Applying healing to wound", {
                woundName: wound.name,
                oldPenalty,
                newPenalty,
                penaltyChange,
                isSuccess
            });
            
            // Prepare update data
            const updateData = {
                _id: woundId,
                "system.penalty": newPenalty
            };
            
            // Only flag as isHealing if test succeeded
            if (isSuccess) {
                updateData["system.isHealing"] = true;
            }
            
            // Mark hadFirstAid if First Aid succeeded
            if (isFirstAid && isSuccess) {
                updateData["system.hadFirstAid"] = true;
            }
            
            // Increment healing attempt counter
            const currentAttempts = wound.system.healingAttempts || 0;
            updateData["system.healingAttempts"] = currentAttempts + 1;
            
            woundsToUpdate.push(updateData);
            
            healingResults.push({
                woundId,
                woundName: wound.name,
                oldPenalty,
                newPenalty,
                penaltyChange,
                wasFullyHealed: newPenalty === 0,
                isSuccess
            });
        }
        
        // Apply all updates at once
        if (woundsToUpdate.length > 0) {
            await patientActor.updateEmbeddedDocuments("Item", woundsToUpdate);
            game.neuroshima?.log("Wounds updated", { count: woundsToUpdate.length });
        }
        
        // Delete fully healed wounds (penalty = 0)
        const fullyHealedIds = healingResults
            .filter(r => r.wasFullyHealed)
            .map(r => r.woundId);
        
        if (fullyHealedIds.length > 0) {
            await patientActor.deleteEmbeddedDocuments("Item", fullyHealedIds);
            game.neuroshima?.log("Fully healed wounds deleted", { count: fullyHealedIds.length });
        }
        
        game.neuroshima?.groupEnd();
        return healingResults;
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
            template: "systems/neuroshima/templates/apps/healing-app-main.hbs"
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
        
        game.neuroshima?.log("HealingApp constructor", {
            sessionId: this.sessionId,
            patientRef: this.patientRef,
            medicRef: this.medicRef
        });
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
                
                game.neuroshima?.log("Wound removed", { woundId: woundId });
                game.neuroshima?.groupEnd();
                return wound;
            }

            // Update wound
            if (Object.keys(updateData).length > 0) {
                await wound.update(updateData);
                
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
        const woundData = selectedWoundIds.map(woundId => {
            const wound = patientActor.items.get(woundId);
            return {
                id: woundId,
                name: wound?.name || "Unknown",
                damageType: wound?.system.damageType || "D",
                hadFirstAid: wound?.system.hadFirstAid || false
            };
        });

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

        // Execute test
        await NeuroshimaDice.rollTest({
            stat: finalStat,
            skill: skillValue,
            penalties: {
                mod: NEUROSHIMA.difficulties[baseDifficultyKey]?.min || 0,
                wounds: 0,
                armor: 0
            },
            isOpen: true,
            label: healingMethod.methodLabel,
            actor: medicActor
        });

        game.neuroshima?.log("Test executed, waiting for result");
        game.neuroshima?.groupEnd();
    }
}
