import React from 'react';
import { ExternalLink, Plug } from 'lucide-react';
import { Modal } from './Modal';
import { cn } from './format';
import { formatGB, useHardware, type Hardware } from './hardware';

/**
 * "No ComfyUI yet?": which ComfyUI to install on this kind of computer, that
 * HEISS UI then finds it by itself, and what memory makes a good start. Only
 * official pages are linked. The README's "No ComfyUI yet?" says the same.
 */

type System = 'windows' | 'mac' | 'linux';

const routes: Record<System, { name: string; what: string; links: Array<{ label: string; href: string }> }> = {
  windows: {
    name: 'Windows',
    what: 'ComfyUI Desktop installs everything in one go and runs on NVIDIA graphics cards. For an AMD card, or to keep everything in one folder, use the portable version.',
    links: [
      { label: 'ComfyUI Desktop', href: 'https://www.comfy.org/download' },
      { label: 'Portable version', href: 'https://docs.comfy.org/installation/comfyui_portable_windows' }
    ]
  },
  mac: {
    name: 'Mac',
    what: 'ComfyUI Desktop, for Macs with Apple Silicon (M1 or later) on macOS 13 or newer.',
    links: [{ label: 'ComfyUI Desktop', href: 'https://www.comfy.org/download' }]
  },
  linux: {
    name: 'Linux',
    what: 'Follow the ComfyUI install guide for NVIDIA or AMD (ROCm) cards.',
    links: [
      { label: 'Install guide', href: 'https://docs.comfy.org/installation/manual_install' },
      { label: 'ComfyUI on GitHub', href: 'https://github.com/comfyanonymous/ComfyUI' }
    ]
  }
};

function thisSystem(hardware: Hardware | null): System {
  const os = hardware?.os || '';
  if (os === 'darwin') return 'mac';
  if (os === 'win32') return 'windows';
  if (os === 'linux') return 'linux';
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /Mac/i.test(agent) ? 'mac' : /Win/i.test(agent) ? 'windows' : 'linux';
}

/** What this computer has, when HEISS UI can tell without ComfyUI. */
function thisComputerLine(hardware: Hardware | null) {
  if (!hardware?.known) return '';
  if (hardware.unified) return `This Mac has ${formatGB(hardware.ramGB)} of memory.`;
  if (hardware.vramGB) return `This computer has ${hardware.name ? `${/^([aeiou]|nvidia)/i.test(hardware.name) ? 'an' : 'a'} ${hardware.name} with ` : ''}${formatGB(hardware.vramGB)} of graphics memory.`;
  return '';
}

export function NoComfySheet({ open, onOpenChange, onChangeAddress }: { open: boolean; onOpenChange: (open: boolean) => void; onChangeAddress?: () => void }) {
  const hardware = useHardware();
  const here = thisSystem(hardware);
  const order: System[] = [here, ...(['windows', 'mac', 'linux'] as System[]).filter((system) => system !== here)];
  const line = thisComputerLine(hardware);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Get ComfyUI"
      description="ComfyUI does the generating. Install and start it, and it connects here."
      className="no-comfy-sheet"
      footer={onChangeAddress ? <button type="button" className="btn is-ghost" onClick={() => { onOpenChange(false); onChangeAddress(); }}><Plug size={13} /> Use another address</button> : undefined}
    >
      <ul className="no-comfy-routes">
        {order.map((system) => {
          const route = routes[system];
          return (
            <li key={system} className={cn('no-comfy-route', system === here && 'is-here')}>
              <div className="no-comfy-route-head">
                <strong>{route.name}</strong>
                {system === here ? <span className="no-comfy-here">This computer</span> : null}
              </div>
              <p>{route.what}</p>
              <div className="no-comfy-links">
                {route.links.map((link) => (
                  <a key={link.href} className={cn('btn', system === here && link === route.links[0] ? 'is-primary' : '')} href={link.href} target="_blank" rel="noreferrer">{link.label} <ExternalLink size={12} /></a>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <section className="no-comfy-notes">
        <h3>Connecting</h3>
        <p>Start ComfyUI and leave it running. It connects on port 8188 (manual or portable install) or 8000 (ComfyUI Desktop).</p>
        <h3>Memory and disk</h3>
        <p>
          A graphics card with 8 GB runs SDXL and the compact Flux.2 Klein; 12 to 16 GB is comfortable, and 24 GB or more runs nearly everything.
          On a Mac, 16 GB of memory runs SDXL, 18 GB or more Flux.2 Klein, and 48 GB or more Krea 2.
          Models take 7 to 50 GB of disk each.{line ? <> <strong>{line}</strong></> : null}
        </p>
      </section>
    </Modal>
  );
}
