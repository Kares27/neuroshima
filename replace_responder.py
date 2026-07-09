import re

with open('D:/FoundryData/Data/systems/neuroshima/module/combat/combat.js', encoding='utf-8') as f:
    content = f.read()

START_MARKER = '    if (state.waitingFor === "responder") {'
END_AFTER = '        await DuelLifecycle.end(DuelContext.fromFlag(state));\n      }\n    }\n  }'

start_idx = content.find(START_MARKER)
if start_idx == -1:
    print("ERROR: Start marker not found")
    exit(1)

end_idx = content.find(END_AFTER, start_idx)
if end_idx == -1:
    print("ERROR: End marker not found")
    exit(1)

end_idx += len(END_AFTER)

old_block = content[start_idx:end_idx]
print(f"Found block: chars {start_idx}-{end_idx}, length={len(old_block)}")
print("First 80 chars:", repr(old_block[:80]))
print("Last 80 chars:", repr(old_block[-80:]))

NEW_BLOCK = '''    if (state.waitingFor === "responder") {
      const _responded = await DuelSegmentEngine.processResponder(state, {
        pool,
        responderPool,
        isOwnerAttacker,
        diceIndices,
        action,
        message,
        onRender:         (msg, st) => MeleeOpposedChat._renderDuelCard(msg, st),
        onSyncInitiative: (st)      => MeleeOpposedChat._syncInitiativeToTracker(st),
        onClearManeuvers: (actor)   => MeleaTurnService._clearManeuverConditions(actor)
      });
      if (!_responded) return;
    }
  }'''

new_content = content[:start_idx] + NEW_BLOCK + content[end_idx:]

with open('D:/FoundryData/Data/systems/neuroshima/module/combat/combat.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("SUCCESS: Replaced responder block")
print(f"Old length: {len(content)}, New length: {len(new_content)}, Diff: {len(new_content) - len(content)}")
