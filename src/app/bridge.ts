export type Transfer = { id: string; name: string; mime: string; size: number; sha256: string; width: number; height: number; createdAt: string; state: string; deviceId: string; error?: string };
export type SavedImage = Transfer & { blob: Blob; acknowledged?: boolean };
export type Pair = { deviceId: string; token: string };
let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('jai-bridge-receiver', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('images', { keyPath: 'id' }); request.result.createObjectStore('settings'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function stored<T>(store: string, operation: (s: IDBObjectStore) => IDBRequest, write = false): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, write ? 'readwrite' : 'readonly', write ? { durability: 'strict' } : undefined);
    const request = operation(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onabort = () => reject(transaction.error || new Error('Device storage could not save this image.'));
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function checksum(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function bridgeRequest<T>(url: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`/api/bridge${url}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Bridge request failed.');
  return result;
}
