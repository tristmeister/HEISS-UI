import http from "node:http";
import https from "node:https";
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
 * Starts the servers. `onListening` runs once plain HTTP is up; a failure to
 * bind it is fatal (`onFatal`), a failure to bind HTTPS only costs HTTPS.
 */
export function startServers(app, { host, port, onListening, onFatal }) {
  const plan = listenPlan({ host });
  const server = http.createServer(app);
  server.once("error", onFatal);
  server.listen(port, plan.httpHost, () => {
    server.off("error", onFatal);
    onListening({ plan });
  });
  httpsProblem = plan.tlsProblem;
  if (plan.tlsProblem) console.warn(`\n  HTTPS is set up but can’t start: ${plan.tlsProblem}\n  Other devices can’t connect until that’s fixed; this computer still opens http://localhost:${port}\n`);
  if (plan.httpsHost) {
    const secure = https.createServer({ cert: startupTls.pem.cert, key: startupTls.pem.key }, app);
    secure.once("error", (error) => {
      httpsProblem = error.code === "EADDRINUSE" ? `Port ${httpsPort} is already in use. Set HEISS_HTTPS_PORT to another one.` : error.message;
      console.warn(`\n  HTTPS could not start on port ${httpsPort}: ${error.code === "EADDRINUSE" ? "something else uses it (set HEISS_HTTPS_PORT)" : error.message}\n`);
    });
    secure.listen(httpsPort, plan.httpsHost, () => {
      httpsListening = true;
      watchCertificate(secure);
    });
  }
  return { server, plan };
}
