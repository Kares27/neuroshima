/**
 * Custom Combat Tracker for Neuroshima 1.5.
 * Integrates Melee Duels directly above the initiative list for a unified view.
 */
export class NeuroshimaCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
    /** @override */
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
        classes: ["neuroshima", "combat-tracker"]
    });

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.user = game.user;
        return context;
    }

    /** @override */
    async _onRender(context, options) {
        await super._onRender(context, options);
    }
}
