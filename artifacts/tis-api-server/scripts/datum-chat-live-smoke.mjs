/**
 * The Datum chat's live smoke test. For the owner, who holds the key; it is in
 * no check:* script and CI never runs it.
 *
 *   ANTHROPIC_API_KEY=… node artifacts/tis-api-server/scripts/datum-chat-live-smoke.mjs
 *
 * It sends one real request to the Claude API with what the chat really sends:
 * RERUN_TOOL and READ_PATH_TOOL (tools.ts), buildSystem over the grounding pack
 * of scenario-base.json (prompt.ts, context.ts), with the proofread clauses' own
 * findings and the first in focus, and the model call settings of run.ts. The
 * request goes through the real loop (runDatumTurn) and the real client
 * (client.ts, the SDK and its adapter), so it also proves the adapter against
 * the SDK. It confirms the API accepts the params (adaptive thinking, effort,
 * the strict tool schemas, the cached system blocks), and prints the stop
 * reason and the token counts.
 *
 * One request only: a second model call (after a tool call) is refused here
 * before it is sent. If the model calls the re-run tool, it is answered "not
 * run": no engine, no database. Without the key it exits 2 and loads nothing.
 * Exit 0: the API answered. Exit 1: it did not; the error's status and message
 * are printed (not its headers).
 */
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "datum-chat-live-smoke: ANTHROPIC_API_KEY is not set, so nothing was sent. This script makes one real API call; run it with the key set.",
  );
  process.exit(2);
}

const { readFileSync } = await import("node:fs");
const { randomUUID } = await import("node:crypto");
const path = await import("node:path");
const { fileURLToPath, pathToFileURL } = await import("node:url");

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const load = (rel) => import(pathToFileURL(path.join(repo, rel)).href);
const CHAT = "artifacts/tis-api-server/src/lib/datum-chat";

const { RERUN_TOOL, READ_PATH_TOOL } = await load(`${CHAT}/tools.ts`);
const { buildHistory, buildSystem } = await load(`${CHAT}/prompt.ts`);
const { buildGroundingPack, readStudyPath } = await load(`${CHAT}/context.ts`);
const { runDatumTurn } = await load(`${CHAT}/run.ts`);
const { getDatumClient } = await load(`${CHAT}/client.ts`);
const { runClauses } = await load("artifacts/tis-api-server/src/lib/proofread/index.ts");

// The study: scenario-base.json as the check stores it (its request with growth set to 2.1, and its result).
const fixture = JSON.parse(readFileSync(path.join(repo, "artifacts/atlanta-tis/scripts/fixtures/scenario-base.json"), "utf8"));
const { request: fixtureRequest, ...result } = fixture;
const record = { request: { ...fixtureRequest, growthRatePct: 2.1 }, result };

// The findings the engineer would see, as the store hands them over.
const findings = runClauses(record)
  .findings.filter((f) => f.audience !== "admin")
  .map((f) => ({ id: randomUUID(), clauseId: f.clauseId, type: f.type, title: f.title, detail: f.detail, sourceLabel: f.sourceLabel, readPaths: f.readPaths, remedy: f.remedy }));
const focus = findings[0];

const pack = buildGroundingPack({ request: record.request, result: record.result, findings, dispositions: [], ...(focus ? { focusFindingId: focus.id } : {}) });
const system = buildSystem(pack.text);
const question = "Why was this flagged? The county's letter of 2026-09-14 adopts 1.0% a year for this corridor. Re-run the study with that.";
const messages = buildHistory([], focus ? { content: question, focus } : { content: question });

const client = await getDatumClient();
if (client === null) {
  console.error("datum-chat-live-smoke: getDatumClient() gave no client although the key is set.");
  process.exit(1);
}

/** The real client, limited to one request: the first stream goes out, a second is refused before it is sent. */
let requests = 0;
let first = null;
const once = {
  messages: {
    stream(params) {
      requests += 1;
      if (requests > 1) throw new Error("smoke test: one request only, so the next model call was not sent");
      const stream = client.messages.stream(params);
      return {
        on: (event, cb) => stream.on(event, cb),
        abort: () => stream.abort(),
        finalMessage: async () => {
          const message = await stream.finalMessage();
          first = { params, message };
          return message;
        },
      };
    },
  },
};

let rerunAsked = null;
const turn = await runDatumTurn(
  {
    client: once,
    revise: async (input) => {
      rerunAsked = input;
      return { ok: false, error: "Smoke test: the re-run was not run. Tell the engineer nothing was changed." };
    },
    readPath: (p) => readStudyPath(record, p),
    emit: (event) => {
      if (event.type === "text") process.stdout.write(event.delta);
    },
    signal: new AbortController().signal,
  },
  { system, messages },
);
process.stdout.write("\n\n");

console.log(`tools sent: ${[READ_PATH_TOOL.name, RERUN_TOOL.name].join(", ")}`);
console.log(`system blocks: ${system.length} (pack ${pack.bytes} bytes; sections ${pack.sections.join(" | ")})`);
console.log(`focused finding: ${focus ? `${focus.clauseId} (${focus.title})` : "none"}`);

if (first === null) {
  const err = turn.error;
  const status = typeof err === "object" && err !== null && "status" in err ? err.status : undefined;
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`the API did not answer: ${name}${status === undefined ? "" : ` (status ${status})`}: ${message}`);
  process.exit(1);
}

const uses = first.message.content.filter((b) => b.type === "tool_use");
console.log(`model: ${first.message.model}`);
console.log(`stop reason: ${first.message.stop_reason}`);
console.log(`input tokens: ${first.message.usage.input_tokens}`);
console.log(`output tokens: ${first.message.usage.output_tokens}`);
console.log(`content blocks: ${first.message.content.map((b) => b.type).join(", ")}`);
if (uses.length > 0) {
  console.log(`tool called: ${uses.map((u) => u.name).join(", ")}`);
  console.log(`re-run input passed RerunToolInput: ${rerunAsked === null ? "no re-run reached revise" : JSON.stringify(rerunAsked)}`);
}
console.log(`loop: ${turn.stopReason}${requests > 1 ? " (stopped here at the second model call, which was not sent)" : ""}`);
process.exit(0);
