/**
 * The Datum chat routes, wired to the real modules. The routes themselves are
 * ./datum-chat-router.ts, which takes every piece of I/O as a dep so the check
 * can run them with fakes; this file is the one place the real ones are named.
 *
 * The re-run is reviseStudy (lib/datum-chat/revise.ts) over the same pieces the
 * generate route uses: the firm's read-only "may it still run studies" gate
 * (firmMayRunUncharged, as /whatif), the engine (generateTisReport), the parse
 * the generate route saves (GenerateTisResponse.parse), the insert-only save
 * (createRevision) and the proofread queue (enqueueProofread). No study slot
 * is reserved or released.
 */
import { GenerateTisResponse } from "@workspace/tis-api-zod";
import { firmMayRunUncharged, getOrCreateFirmForUser } from "../lib/firms";
import { enqueueProofread } from "../lib/proofread-run";
import { datumChatLimiter } from "../lib/security";
import { countLineage, createRevision, lineageFor, listRevisions } from "../lib/study-revisions";
import { generateTisReport } from "../lib/tis";
import type { TisReport } from "../lib/tis";
import { getProject } from "../lib/tis-projects";
import { datumChatEnabled, getDatumClient } from "../lib/datum-chat/client";
import { reviseStudy } from "../lib/datum-chat/revise.ts";
import { firmRepliesLast24h, insertMessage, listMessages, loadVisible } from "../lib/datum-chat/store";
import { makeDatumChatRouter } from "./datum-chat-router.ts";

/**
 * The users with a chat re-run going: one engine run at a time per user. One
 * set per process, used by the chat only. /whatif keeps its own, so a what-if
 * and a chat re-run do not refuse each other.
 */
const chatRerunInFlight = new Set<string>();

/** The firm as getOrCreateFirmForUser gives it: what the uncharged gate reads. */
type ChatFirm = Awaited<ReturnType<typeof getOrCreateFirmForUser>>["firm"];

const router = makeDatumChatRouter<ChatFirm>({
  isEnabled: datumChatEnabled,
  getClient: getDatumClient,
  resolveFirm: async (user) => {
    const { firm } = await getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName });
    return firm;
  },
  getProject,
  loadVisible,
  listMessages,
  insertMessage,
  listRevisions,
  lineageFor,
  firmRepliesLast24h,
  revise: async (firm, user, parentId, input, messageId, findingId, extras) => {
    // reviseStudy answers with the new version but not its log row; Datum's message records the row's id.
    let revisionId: string | null = null;
    const outcome = await reviseStudy<ChatFirm, TisReport>(
      {
        getParent: getProject,
        firmGate: firmMayRunUncharged,
        inFlight: chatRerunInFlight,
        countLineage,
        generate: generateTisReport,
        parseResult: (report) => GenerateTisResponse.parse(report),
        createRevision: async (args) => {
          const saved = await createRevision(args);
          revisionId = saved.revisionId;
          return saved;
        },
        enqueueProofread,
        log: extras.log,
      },
      { firm, user, parentId, input, messageId, findingId, clauseId: extras.clauseId },
    );
    return outcome.ok && revisionId !== null ? { ...outcome, revisionId } : outcome;
  },
  limiter: datumChatLimiter,
});

export default router;
