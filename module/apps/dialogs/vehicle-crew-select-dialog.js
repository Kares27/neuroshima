import { crewMemberData, resolveCrewActor } from "../../helpers/vehicle-crew.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Dialog for selecting which crew member's stats to use for a vehicle weapon roll.
 * Appears before NeuroshimaWeaponRollDialog when rolling from a vehicle.
 */
export class VehicleCrewSelectDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.vehicle  = options.vehicle;
    this.weapon   = options.weapon;
    this.onSelect = options.onSelect;

    this.crewOptions = [];
    this._crewActors = new Map();
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "standard-form", "vehicle-crew-select-dialog"],
    position: { width: 360, height: "auto" },
    window: { resizable: false, minimizable: false, title: "NEUROSHIMA.Vehicle.SelectCrew" },
    actions: {
      confirm: VehicleCrewSelectDialog.prototype._onConfirm,
      cancel:  VehicleCrewSelectDialog.prototype._onCancel
    }
  };

  static PARTS = {
    form: { template: "systems/neuroshima/templates/apps/vehicle-crew-select-dialog.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this._crewActors.clear();
    const crewPositionLabels = {
      driver:    game.i18n.localize("NEUROSHIMA.Vehicle.Position.Driver"),
      gunner:    game.i18n.localize("NEUROSHIMA.Vehicle.Position.Gunner"),
      commander: game.i18n.localize("NEUROSHIMA.Vehicle.Position.Commander"),
      passenger: game.i18n.localize("NEUROSHIMA.Vehicle.Position.Passenger")
    };
    const resolved = await Promise.all((this.vehicle.system.crewMembers ?? []).map(async member => {
      const raw = crewMemberData(member);
      const actor = await resolveCrewActor(raw);
      if (!actor) return null;
      const actorRef = raw.actorUuid || actor.uuid;
      const roleLabel = crewPositionLabels[raw.role] ?? raw.role;
      this._crewActors.set(actorRef, actor);
      return { actorRef, actorId: raw.actorId, actorUuid: actor.uuid, label: `${actor.name} (${roleLabel})` };
    }));
    this.crewOptions = resolved.filter(Boolean);
    context.crewOptions  = this.crewOptions;
    context.weaponName   = this.weapon?.name ?? "";
    context.hasNoCrew    = this.crewOptions.length === 0;
    return context;
  }

  async _onConfirm() {
    const form = this.element.tagName === "FORM" ? this.element : this.element.querySelector("form");
    const actorRef = form?.querySelector("select[name='crewActorRef']")?.value;
    const actor = actorRef ? this._crewActors.get(actorRef) ?? null : null;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Vehicle.NoCrewSelected"));
      return;
    }
    await this.close();
    if (this.onSelect) await this.onSelect(actor);
  }

  async _onCancel() {
    await this.close();
  }
}
