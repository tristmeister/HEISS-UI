import crypto from "node:crypto";

/**
 * Password stretching off the event loop. crypto.scryptSync at this cost
 * takes 50-100 ms, and every guess froze the whole server for that long;
 * crypto.scrypt runs on libuv's thread pool instead.
 */
export const scryptParams = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function scryptAsync(password, salt, params = scryptParams) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ""), salt, 32, params, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
