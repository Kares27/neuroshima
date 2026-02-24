export class NeuroshimaActor extends Actor {
  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    if (data.type === "character") {
      this.updateSource({ "prototypeToken.actorLink": true });
    }
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
  }
}
