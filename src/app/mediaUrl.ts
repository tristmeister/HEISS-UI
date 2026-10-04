/**
 * The address a gallery picture is shown from, made unique to the item.
 *
 * An output's URL names a file, and a file name comes back: delete the newest
 * image and ComfyUI gives the next one the same number, re-import a folder and
 * a replaced file keeps its path. A page that already showed that URL keeps
 * its picture in memory and shows it again for the new image, whatever the
 * server says, until a reload. So every picture is asked for with `v`, a
 * short fingerprint of the item it belongs to (its id and when it was made,
 * plus `salt` for an upscale); a new item can never be served an old one's
 * picture. The server ignores `v`, and the stored records keep their plain URLs.
 */
export function mediaUrl(url: string | undefined | null, item: { id?: string; createdAt?: string } | null | undefined, salt = ''): string {
  if (!url) return '';
  // Only the studio's own addresses; data:, blob: and other sites are left alone.
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  if (/[?&]v=/.test(url)) return url;
  const identity = `${item?.id || ''}|${item?.createdAt || ''}|${salt}`;
  if (identity === '||') return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${fingerprint(identity)}`;
}

/** FNV-1a, in base 36: short, stable, and different for different items. */
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
