// Where this Nova Agent runs, and the rule that only one runs at a time.
//
// It runs on the studio PC, or on the server (the VPS, NOVA_ON_SERVER=1; Nova Bot's
// vps/agent-switch.sh moves it there and vps/agent-switch-back.sh brings it home). Two linked copies
// would both send reminders and fight over Nova Bot's link, so:
//   - the link says which one it is (X-Nova-Agent-Where); Nova Bot keeps the server's link and
//     turns a PC away with 4002 (src/agent-relay.js in Nova Bot);
//   - on the PC, a marker file (config.onServerMarker) says the server has it: a PC copy with Nova
//     Bot's key doesn't start, and one that's turned away writes the marker and stops.
// A copy without the key (a preview, a Fixer job's server) can't link or reach Nova Bot, so it's left alone.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";

export type Where = "server" | "pc";
export const where = (): Where => (config.onServer ? "server" : "pc");

// Why this copy mustn't run ("" = it may)
export function standDownReason(): string {
  if (config.onServer || !config.agentNovaKey) return "";
  if (existsSync(config.onServerMarker)) return `Nova Agent runs on the server now (${config.onServerMarker}), so this PC's copy stays off. To bring it back here: vps/agent-switch-back.sh in Nova Bot.`;
  return "";
}

// Nova Bot said the server has the link: note it, so this PC's copy stays off from now on
export function markServerHasIt(): void {
  if (config.onServer) return;
  try {
    mkdirSync(dirname(config.onServerMarker), { recursive: true });
    writeFileSync(config.onServerMarker, `Nova Bot turned this PC's Nova Agent away at ${new Date().toISOString()}: the server has the link.\n`);
  } catch {}
}
