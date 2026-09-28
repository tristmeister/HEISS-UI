import https from "node:https";
import { listenWithFallback } from "./launch.js";
import { listensBeyondThisComputer } from "./lan.js";
import { httpsPort, startupTls, watchCertificate } from "./tls.js";

/**
 * Where the server listens.
 *
 * Plain HTTP on `port`, as always. With LAN mode on and a certificate
 * configured (tls.js), other devices get HTTPS on its own port instead, and
 * plain HTTP stays on localhost, where nothing crosses a network: this
 * computer keeps http://localhost:<port> whatever happens to the certificate.
 * A certificate that is set but unusable keeps the network closed rather than
 * quietly falling back to plain HTTP there, and says why.
 */
export function listenPlan({ host, tls = startupTls }) {
  const lan = listensBeyondThisComputer(host);
  const secure = lan && tls.configured;
  return {
    httpHost: secure ? "127.0.0.1" : host,
    httpsHost: secure && tls.ok ? host : "",
    tlsProblem: secure && !tls.ok ? tls.error || "The certificate can’t be used." : ""
  };
}

export let httpsListening = false;
/** Why HTTPS isn't running although it was set up: the certificate, or its port. Settings shows it. */
export let httpsProblem = "";

/**
 * Starts the servers. Plain HTTP moves to the next free port when another
 * program has the one asked for (launch.js; never onto the HTTPS port), and
 * `onListening` runs once it is up with the port it got. A failure to bind it
 * is fatal (`onFatal`); a failure to bind HTTPS only costs HTTPS.
 */
export async function startServers(app, { host, port, fallback = true, onListening, onFatal }) {
  const plan = listenPlan({ host });
  let listening;
  try {
    listening = await listenWithFallback(app, { port, host: plan.httpHost, fallback, skip: plan.httpsHost ? [httpsPort] : [] });
  } catch (error) {
    onFatal(error);
    return null;
  }
  onListening({ plan, port: listening.port, moved: listening.moved });
  httpsProblem = plan.tlsProblem;
  if (plan.tlsProblem) console.warn(`\n  HTTPS can’t start: ${plan.tlsProblem}\n  Other devices can’t connect until that’s fixed. This computer can still open http://localhost:${listening.port}\n`);
  if (plan.httpsHost) {
    const secure = https.createServer({ cert: startupTls.pem.cert, key: startupTls.pem.key }, app);
    secure.once("error", (error) => {
      httpsProblem = error.code === "EADDRINUSE" ? `Port ${httpsPort} is already in use. Set HEISS_HTTPS_PORT to another one.` : error.message;
      console.warn(`\n  HTTPS couldn’t start on port ${httpsPort}: ${error.code === "EADDRINUSE" ? "the port is in use (set HEISS_HTTPS_PORT)" : error.message}\n`);
    });
    secure.listen(httpsPort, plan.httpsHost, () => {
      httpsListening = true;
      watchCertificate(secure);
    });
  }
  return { server: listening.server, plan };
}
