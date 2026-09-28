// The double-click launchers a release carries (see scripts/package-release.mjs).
// Each starts scripts/start.mjs on the download's own Node.js (runtime/current.txt
// names it), else on a Node.js 20.9+ from PATH.

const nodeCheck = "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)";

/**
 * macOS (.command) and Linux (.sh). The update swaps this file by renaming, so
 * a running shell keeps reading the old copy to the end.
 */
export function shellLauncher() {
  return [
    "#!/bin/sh",
    "# Starts HEISS UI. On macOS double-click it; on Linux use the .desktop file, or run ./\"Start HEISS UI.sh\".",
    "cd \"$(dirname \"$0\")\" || exit 1",
    "pause() { if [ -t 0 ]; then echo; echo \"Press Enter to close this window.\"; read -r _; fi; }",
    "if [ ! -f scripts/start.mjs ]; then",
    "  echo \"Unpack the whole zip first, then start this file from the unpacked folder.\"",
    "  pause; exit 1",
    "fi",
    // macOS marks everything unpacked from a downloaded zip as quarantined and then
    // refuses the bundled Node.js and native packages one by one. They came with this app.
    "if [ \"$(uname)\" = \"Darwin\" ] && command -v xattr >/dev/null 2>&1; then",
    "  xattr -dr com.apple.quarantine runtime node_modules 2>/dev/null",
    "fi",
    "NODE=\"\"",
    "if [ -f runtime/current.txt ]; then",
    "  RUNTIME=$(cat runtime/current.txt)",
    "  if [ -n \"$RUNTIME\" ] && [ -x \"runtime/$RUNTIME/bin/node\" ]; then NODE=\"runtime/$RUNTIME/bin/node\"; fi",
    "fi",
    "if [ -z \"$NODE\" ] && command -v node >/dev/null 2>&1; then",
    `  if node -e "${nodeCheck}" 2>/dev/null; then`,
    "    NODE=node",
    "  else",
    "    echo \"HEISS UI needs Node.js 20.9 or newer (22 LTS recommended); this is $(node -v 2>/dev/null). Get it from https://nodejs.org\"",
    "    pause; exit 1",
    "  fi",
    "fi",
    "if [ -z \"$NODE\" ]; then",
    "  echo \"HEISS UI needs Node.js 20.9 or newer (22 LTS recommended): https://nodejs.org\"",
    "  echo \"Install it, then open this file again.\"",
    "  pause; exit 1",
    "fi",
    "\"$NODE\" scripts/start.mjs \"$@\"",
    "status=$?",
    // Keep a failure readable in a terminal window that closes on exit. Not for
    // Ctrl+C (130, 143) or "already running" (78, the browser shows that copy).
    "case $status in 0|78|130|143) ;; *) pause ;; esac",
    "exit $status",
    ""
  ].join("\n");
}

/**
 * A Linux desktop entry: most file managers open a .sh in a text editor, but
 * run this one (after "Allow Launching") in a terminal. %k is where this file
 * is, so it finds the .sh beside it wherever the folder was unpacked. The
 * quoting follows the desktop entry spec: escaped once for the argument and
 * once more for the string value.
 */
export function desktopEntry() {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Start HEISS UI",
    "Comment=Local studio for ComfyUI",
    "Exec=sh -c \"cd \\\\\"\\\\$(dirname \\\\\"\\\\$1\\\\\")\\\\\" && exec ./\\\\\"Start HEISS UI.sh\\\\\"\" heiss-ui %k",
    "Terminal=true",
    "Categories=Graphics;",
    ""
  ].join("\n");
}

/**
 * Windows. It skips npm: npm.cmd run without `call` never returns, so a
 * `pause` after it never ran and the window closed on any error. The last
 * line is one line on purpose: an update replaces this file while it runs,
 * and cmd reads the next line from the new file at the old offset.
 */
export function windowsLauncher() {
  return [
    "@echo off",
    "cd /d \"%~dp0\"",
    "if not exist \"scripts\\start.mjs\" (echo Unpack the whole zip first, then start this file from the unpacked folder.& pause & exit /b 1)",
    // The Windows download's own Node (runtime\\current.txt names it), else one on PATH.
    "set \"HEISS_NODE=node\"",
    "set \"HEISS_RUNTIME=\"",
    "if exist \"runtime\\current.txt\" set /p HEISS_RUNTIME=<\"runtime\\current.txt\"",
    "if defined HEISS_RUNTIME if exist \"runtime\\%HEISS_RUNTIME%\\node.exe\" set \"HEISS_NODE=runtime\\%HEISS_RUNTIME%\\node.exe\"",
    "if not \"%HEISS_NODE%\"==\"node\" goto run",
    "where node >nul 2>nul && goto run",
    "echo HEISS UI needs Node.js 20.9 or newer (22 LTS recommended): https://nodejs.org& pause & exit /b 1",
    ":run",
    "(\"%HEISS_NODE%\" scripts\\start.mjs || pause) & exit /b",
    ""
  ].join("\r\n");
}
