import { GMAddXPApp } from "./gm-xp-app.js";
import { GMApplyDamageApp } from "./gm-damage-app.js";
import { GMGroupCheckApp } from "./gm-group-check-app.js";
import { GMPayoutApp } from "./gm-payout-app.js";
import { GMReputationApp } from "./gm-reputation-app.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class GMToolkitApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gm-toolkit",
        classes: ["neuroshima", "gm-toolkit"],
        tag: "div",
        window: {
            title: "NEUROSHIMA.GMToolkit.Title",
            icon: "fas fa-toolbox",
            resizable: false,
            minimizable: true
        },
        position: {
            width: 360,
            height: "auto"
        },
        actions: {
            openXP:           this._onOpenXP,
            openDamage:       this._onOpenDamage,
            openGroupCheck:   this._onOpenGroupCheck,
            openPayout:       this._onOpenPayout,
            openReputation:   this._onOpenReputation,
            incrementSession: this._onIncrementSession,
            resetSession:     this._onResetSession
        }
    };

    static PARTS = {
        main: {
            template: "systems/neuroshima/templates/apps/gm-toolkit.hbs"
        }
    };

    static open() {
        if (!game.user.isGM) {
            ui.notifications.warn(game.i18n.localize("NEUROSHIMA.GMToolkit.GMOnly"));
            return;
        }
        const existing = Object.values(ui.windows).find(w => w instanceof GMToolkitApp);
        if (existing) {
            existing.bringToTop();
            return existing;
        }
        return new GMToolkitApp().render(true);
    }

    async _prepareContext(options) {
        if (!game.user.isGM) return { error: true };
        const sessionID = game.settings.get("neuroshima", "sessionID") ?? 1;
        return { isGM: true, sessionID };
    }

    static _onOpenXP(event, target) {
        GMAddXPApp.open();
    }

    static _onOpenDamage(event, target) {
        GMApplyDamageApp.open();
    }

    static _onOpenGroupCheck(event, target) {
        GMGroupCheckApp.open();
    }

    static _onOpenPayout(event, target) {
        GMPayoutApp.open();
    }

    static _onOpenReputation(event, target) {
        GMReputationApp.open();
    }

    static async _onIncrementSession(event, target) {
        const current = game.settings.get("neuroshima", "sessionID") ?? 1;
        await game.settings.set("neuroshima", "sessionID", current + 1);
        this.render({ parts: ["main"] });
    }

    static async _onResetSession(event, target) {
        await game.settings.set("neuroshima", "sessionID", 1);
        this.render({ parts: ["main"] });
    }
}
