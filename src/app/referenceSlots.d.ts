import type { MediaInput, ReferenceAsset, SelectedReferenceAsset } from './types';

type Slots = ReadonlyArray<Pick<MediaInput, 'id' | 'follows'>>;

export function arrangeReferences(selected: readonly SelectedReferenceAsset[] | null | undefined, inputs: Slots): SelectedReferenceAsset[];
export function withReference(selected: readonly SelectedReferenceAsset[] | null | undefined, inputs: Slots, slot: string, asset: ReferenceAsset): SelectedReferenceAsset[];
export function withoutReferences(selected: readonly SelectedReferenceAsset[] | null | undefined, inputs: Slots, slots: Iterable<string>): SelectedReferenceAsset[];
