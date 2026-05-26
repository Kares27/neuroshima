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

    // Build list of available crew actors
    const crewPositionLabels = {
      driver:    game.i18n.localize("NEUROSHIMA.Vehicle.Position.Driver"),
      gunner:    game.i18n.localize("NEUROSHIMA.Vehicle.Position.Gunner"),
      commander: game.i18n.localize("NEUROSHIMA.Vehicle.Position.Commander"),
      passenger: game.i18n.localize("NEUROSHIMA.Vehicle.Position.Passenger")
    };

    this.crewOptions = (this.vehicle.system.crewMembers ?? [])
      .map(m => {
        const raw   = m.toObject?.() ?? m;
        const actor = game.actors.get(raw.actorId);
        if (!actor) return null;
        const roleLabel = crewPositionLabels[raw.role] ?? raw.role;
        return { actorId: raw.actorId, actor, label: `${actor.name} (${roleLabel})` };
      })
      .filter(Boolean);
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
    context.crewOptions  = this.crewOptions;
    context.weaponName   = this.weapon?.name ?? "";
    context.hasNoCrew    = this.crewOptions.length === 0;
    return context;
  }

  async _onConfirm() {
    const form = this.element.tagName === "FORM" ? this.element : this.element.querySelector("form");
    const actorId = form?.querySelector("select[name='crewActorId']")?.value;
    const actor   = actorId ? game.actors.get(actorId) : null;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Vehicle.NoCrewSelected"));
      return;
    }
    await this.close();
    if (this.onSelect) this.onSelect(actor);
  }

  async _onCancel() {
    await this.close();
  }
}
