import { Modal } from './Modal';

/** Every keyboard shortcut, for Settings › General and the "?" overlay. */
export const shortcuts: ReadonlyArray<readonly [string, string]> = [
  ['Enter', 'Generate (when “Enter to generate” is on)'],
  ['⌘/Ctrl + Enter', 'Generate, always'],
  ['Shift + Enter', 'New line in the prompt'],
  ['↑', 'Recent prompts (in an empty prompt)'],
  ['Any letter', 'Jump to the prompt and start typing'],
  ['/  or  ⌘/Ctrl + F', 'Search the gallery'],
  ['F', 'Star the open image (viewer)'],
  ['← →', 'Previous or next image (viewer and zen)'],
  ['Arrow keys', 'Move between gallery tiles, newest to oldest'],
  ['+  −  0', 'Zoom in, out, reset (viewer)'],
  ['Delete', 'Delete the open image (undo for a few seconds)'],
  ['Esc', 'Close the menu, viewer or dialog on top'],
  ['?', 'Show these shortcuts']
];

/** The key that sends the prompt, for the Generate button's tooltip. */
export function generateShortcut(enterToGenerate: boolean) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  return enterToGenerate ? 'Enter' : mac ? '⌘ Enter' : 'Ctrl + Enter';
}

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="They pause while you type in a field, except the ones that send the prompt." className="shortcuts-sheet">
      <dl className="shortcuts-list">
        {shortcuts.map(([keys, what]) => (
          <div key={keys} className="shortcuts-row">
            <dt><kbd className="set-kbd">{keys}</kbd></dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
