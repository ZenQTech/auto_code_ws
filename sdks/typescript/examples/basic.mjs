/**
 * Examples for the Hermes TypeScript SDK.
 *
 * Run with: node --experimental-vm-modules examples/basic.mjs
 * Or after build: node examples/basic.mjs
 */

import { Hermes, Sandbox } from "../dist/index.js";

const BASE_URL = process.env.HERMES_BASE_URL ?? "http://localhost:8000";
const API_KEY = process.env.HERMES_API_KEY ?? "demo-key";

export async function basicRun(): Promise<Record<string, unknown>> {
  const hermes = new Hermes({ apiKey: API_KEY, baseUrl: BASE_URL });
  const thread = await hermes.threadStart({ sandbox: Sandbox.WORKSPACE_WRITE });
  const result = await thread.run("Explain the architecture of this project in 3 bullets.");
  await thread.close();
  return result;
}

export async function streamingRun(): Promise<{
  eventCount: number;
  firstText: string;
  types: string[];
}> {
  const hermes = new Hermes({ apiKey: API_KEY, baseUrl: BASE_URL });
  const thread = await hermes.threadStart({ sandbox: Sandbox.READ_ONLY });
  const stream = await thread.runStream("Walk me through the verification loop.");
  const events = stream.events;
  await thread.close();
  return {
    eventCount: events.length,
    firstText: events[0]?.text ?? "",
    types: Array.from(new Set(events.map((e) => e.type))).sort(),
  };
}

export async function resumeAfterRestart(threadId: string): Promise<Record<string, unknown>> {
  const hermes = new Hermes({ apiKey: API_KEY, baseUrl: BASE_URL });
  const thread = await hermes.resumeThread(threadId);
  const result = await thread.run("Continue where we left off.");
  await thread.close();
  return result;
}

async function main(): Promise<void> {
  console.log("== basicRun ==");
  const basic = await basicRun();
  console.log(JSON.stringify(basic, null, 2).slice(0, 400));

  console.log("\n== streamingRun ==");
  const stream = await streamingRun();
  console.log(JSON.stringify(stream, null, 2));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
