import { NeuroshimaScript } from "../apps/neuroshima-script-engine.js";

export class NeuroshimaActiveEffect extends ActiveEffect {
  get scripts() {
    if (!this._scripts) {
      const scriptData = this.getFlag("neuroshima", "scripts") || [];
      this._scripts = scriptData.map(s => new NeuroshimaScript(s, this));
    }
    return this._scripts;
  }

  _onUpdate(data, options, user) {
    super._onUpdate(data, options, user);
    this._scripts = null;
  }

  async _onCreate(data, options, user) {
    await super._onCreate(data, options, user);
    if (game.user.id !== user) return;
    if (!this.actor) return;
    const createScripts = this.scripts.filter(s => s.trigger === "createEffect");
    for (const script of createScripts) {
      await script.execute({ actor: this.actor, data, options });
    }
  }

  async _onDelete(options, user) {
    await super._onDelete(options, user);
    if (game.user.id !== user) return;
    if (!this.actor) return;
    const deleteScripts = this.scripts.filter(s => s.trigger === "deleteEffect");
    for (const script of deleteScripts) {
      await script.execute({ actor: this.actor, options });
    }
  }
}
