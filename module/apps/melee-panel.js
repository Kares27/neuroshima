const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
import { CombatHelper } from "../helpers/combat-helper.js";

/**
 * Application V2 for Vanilla Melee Panel
 */
export class NeuroshimaMeleePanel extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @inheritdoc */
    static DEFAULT_OPTIONS = {
        id: "neuroshima-melee-panel",
        tag: "div",
        classes: ["neuroshima", "melee-panel"],
        window: {
            title: "NEUROSHIMA.MeleeOpposed.Title",
            resizable: true,
            minimizable: true,
            icon: "fas fa-swords",
            centered: false
        },
        position: {
            width: 600,
            height: 450
        },
        actions: {
            rollInitiative: NeuroshimaMeleePanel.onRollInitiative,
            rollPool: NeuroshimaMeleePanel.onRollPool,
            selectDie: NeuroshimaMeleePanel.onSelectDie,
            resolveSegment: NeuroshimaMeleePanel.onResolveSegment,
            endMelee: NeuroshimaMeleePanel.onEndMelee
        }
    };

    /** @inheritdoc */
    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/melee-panel.hbs"
        }
    };

    /** @inheritdoc */
    async _prepareContext(options) {
        const combat = game.combat;
        if (!combat) return { noCombat: true };

        const melee = combat.getFlag("neuroshima", "melee");
        if (!melee || !melee.active) return { noMelee: true };

        const attacker = await fromUuid(melee.attackerId);
        const defender = await fromUuid(melee.defenderId);
        const leader = melee.leaderId ? await fromUuid(melee.leaderId) : null;

        const isGM = game.user.isGM;
        const isAttacker = isGM || (attacker?.actor?.testUserPermission(game.user, "OWNER"));
        const isDefender = isGM || (defender?.actor?.testUserPermission(game.user, "OWNER"));

        return {
            combat,
            melee,
            attacker: attacker?.actor || attacker,
            defender: defender?.actor || defender,
            leader: leader?.actor || leader,
            isAttacker,
            isDefender,
            isGM,
            pending: melee.pending,
            pools: melee.pools,
            log: melee.log,
            segmentIndex: melee.segmentIndex,
            segmentsLeft: melee.segmentsLeft
        };
    }

    /**
     * Handlers for UI actions
     */
    static async onRollInitiative(event, target) {
        const combat = game.combat;
        if (!combat) return;
        await CombatHelper.resolveMeleeInitiative(combat);
    }

    static async onRollPool(event, target) {
        const combat = game.combat;
        if (!combat) return;
        const side = target.dataset.side; // "attacker" or "defender"
        await CombatHelper.rollMeleePool(combat, side);
    }

    static async onSelectDie(event, target) {
        const combat = game.combat;
        if (!combat) return;
        const side = target.dataset.side;
        const index = parseInt(target.dataset.index);
        
        // GM or Owner only
        if (!game.user.isGM) {
             const melee = combat.getFlag("neuroshima", "melee");
             const actorId = side === "attacker" ? melee.attackerId : melee.defenderId;
             const actor = await fromUuid(actorId);
             if (!actor?.actor?.testUserPermission(game.user, "OWNER")) return;
        }

        if (game.user.isGM) {
            await CombatHelper.selectMeleeDie(combat, side, index);
        } else {
            game.socket.emit("system.neuroshima", {
                type: "selectMeleeDie",
                combatId: combat.id,
                side,
                index
            });
        }
    }

    static async onResolveSegment(event, target) {
        if (!game.user.isGM) return;
        const combat = game.combat;
        if (!combat) return;
        await CombatHelper.resolveMeleeSegment(combat);
    }

    static async onEndMelee(event, target) {
        if (!game.user.isGM) return;
        const combat = game.combat;
        if (!combat) return;
        await CombatHelper.endMelee(combat);
    }
}
