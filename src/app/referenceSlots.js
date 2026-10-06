// Which picture sits in which reference slot of the current model.
// Plain JavaScript so `node --test` can check it without a build step; the
// types live beside it in referenceSlots.d.ts.
//
// The composer keeps the picked pictures as { slot, asset } pairs. Three
// things can leave that list out of step with the model's slots, and each one
// used to leave a picture on screen that its × couldn't take off until another
// model was picked:
//
// - A saved draft or a reloaded workflow names a slot this model doesn't have.
//   Such a picture now takes the first empty slot, so it shows where it can be
//   removed.
// - Taking the first of several references off left the next one in a later
//   slot. References now close up, so each picture moves into the slot its own
//   follows when that one is empty.
// - The newest pick went to the front of the list, and the first entry is the
//   one generation reads as the start image. The list now comes out in slot order.

/**
 * The picked pictures matched to `inputs`, one per slot, in slot order. With no
 * slots at all nothing can be shown, so nothing is kept.
 * @param {Array<{ slot: string, asset: any }>} selected
 * @param {Array<{ id: string, follows?: string }>} inputs
 */
export function arrangeReferences(selected, inputs) {
  const slots = new Set(inputs.map((input) => input.id));
  const placed = new Map();
  const strays = [];
  for (const item of selected || []) {
    if (!item?.asset?.id) continue;
    if (!slots.has(item.slot)) strays.push(item.asset);
    else if (!placed.has(item.slot)) placed.set(item.slot, item.asset);
  }
  for (const input of inputs) {
    if (!strays.length) break;
    if (!placed.has(input.id)) placed.set(input.id, strays.shift());
  }
  // Close up: a picture whose slot follows an empty one moves into it, until none can.
  for (let moved = true; moved;) {
    moved = false;
    for (const input of inputs) {
      if (!input.follows || !slots.has(input.follows) || !placed.has(input.id) || placed.has(input.follows)) continue;
      placed.set(input.follows, placed.get(input.id));
      placed.delete(input.id);
      moved = true;
    }
  }
  return inputs.filter((input) => placed.has(input.id)).map((input) => ({ slot: input.id, asset: placed.get(input.id) }));
}

/**
 * `selected` with `slot` holding `asset`, replacing whatever was there.
 * @param {Array<{ slot: string, asset: any }>} selected
 * @param {Array<{ id: string, follows?: string }>} inputs
 * @param {string} slot
 * @param {any} asset
 */
export function withReference(selected, inputs, slot, asset) {
  if (!inputs.some((input) => input.id === slot)) return arrangeReferences(selected, inputs);
  return arrangeReferences([{ slot, asset }, ...arrangeReferences(selected, inputs).filter((item) => item.slot !== slot)], inputs);
}

/**
 * `selected` without the pictures in `slots`, the rest closed up.
 * @param {Array<{ slot: string, asset: any }>} selected
 * @param {Array<{ id: string, follows?: string }>} inputs
 * @param {Iterable<string>} slots
 */
export function withoutReferences(selected, inputs, slots) {
  const gone = new Set(slots);
  return arrangeReferences(arrangeReferences(selected, inputs).filter((item) => !gone.has(item.slot)), inputs);
}
