/** Group presentation only; each member retains its original AE execution context. */
export function dialogScriptSignature(script, sourceActor, isMeleePreRoll, label) {
  return JSON.stringify([
    sourceActor?.uuid ?? sourceActor?.id ?? null,
    script.effect?.parent?.documentName === "Item" ? script.effect.parent.uuid : null,
    !!isMeleePreRoll, label, script.trigger, script.code, script.dialogCode,
    script.hideScript, script.activateScript, script.submissionScript,
    script.dialogDescription, script.targeter, script.defendingAgainst,
    script.runIfDisabled, script.deleteAfterRun, script.throwOnError,
    script.scope, script.useActionDef, script.actionDef, script.version ?? null
  ]);
}

/** Stable across re-renders and removal of one of several identical aura sources. */
export function dialogScriptGroupId(signature) {
  let first = 2166136261, second = 5381;
  for (let i = 0; i < signature.length; i++) {
    first = Math.imul(first ^ signature.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ signature.charCodeAt(i);
  }
  return `script_${(first >>> 0).toString(16)}_${(second >>> 0).toString(16)}`;
}

export function groupDialogModifiers(modifiers) {
  const groups = new Map();
  for (const modifier of modifiers) {
    const key = modifier._groupKey ?? modifier._effectId;
    const group = groups.get(key);
    if (group) {
      group._members.push(modifier);
      group.scriptCount++;
      group.activated ||= modifier.activated;
    } else {
      groups.set(key, { ...modifier, _members: [modifier], scriptCount: 1 });
    }
  }
  return [...groups.values()];
}

/** Expand before submission, preview totals, or recording activated effect UUIDs. */
export function expandDialogModifiers(modifiers = []) {
  return modifiers.flatMap(modifier => modifier._members ?? [modifier]);
}
