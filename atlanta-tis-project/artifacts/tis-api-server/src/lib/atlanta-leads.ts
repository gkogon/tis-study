import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persist captured trial-request / demo leads alongside the bundled TIS data.
// We only ever append (one row per submission). The file is intentionally
// flat-JSON (not a database) so the operator can copy it down for an MVP.
// __dirname resolves to the bundled `dist/` directory at runtime, so one `..`
// puts us at `artifacts/tis-api-server/`.
const LEADS_PATH = path.resolve(__dirname, "../data/atlanta-leads.json");
const DATA_DIR = path.dirname(LEADS_PATH);

// TIS-app lead sources only. The analyzer's pitch_page / exec_summary sources
// stay on the analyzer's lead capture (if/when it's reintroduced); the TIS
// surface only ever produces these.
export type LeadSourceKind =
  | "pricing_page"
  | "for_firms_page"
  | "trial_request"
  | "other";

export interface LeadInput {
  name: string;
  email: string;
  organization: string;
  city: string;
  role?: string;
  message?: string;
  productInterest?: string;
  source?: LeadSourceKind;
}

export interface PersistedLead extends LeadInput {
  id: string;
  createdAt: string;
}

interface LeadsFile {
  leads: PersistedLead[];
}

function ensureDir(): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {
    // best-effort; the writeFileSync below will surface a real error if the
    // directory truly cannot be created.
  }
}

function loadAll(): LeadsFile {
  if (!existsSync(LEADS_PATH)) return { leads: [] };
  try {
    const raw = readFileSync(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.leads)) {
      return { leads: [] };
    }
    return parsed as LeadsFile;
  } catch {
    return { leads: [] };
  }
}

function persist(file: LeadsFile): void {
  ensureDir();
  // Atomic write: stage to a per-process tmp file, then rename. Rename is
  // atomic on the same filesystem, so concurrent POSTs cannot observe a
  // partially-written JSON file.
  const tmpPath = `${LEADS_PATH}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(file, null, 2));
  try {
    renameSync(tmpPath, LEADS_PATH);
  } catch (e) {
    try { unlinkSync(tmpPath); } catch {
      // tmp file already cleaned up or never created — nothing to do.
    }
    throw e;
  }
}

// Serialize concurrent saveLead() calls within this process so the
// read-modify-write cycle cannot interleave and drop entries.
let writeChain: Promise<unknown> = Promise.resolve();

function genId(): string {
  // Compact unique id: ts + 4 random hex chars. Good enough for lead capture.
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `lead_${ts}_${rand}`;
}

export async function saveLead(input: LeadInput): Promise<PersistedLead> {
  const run = async (): Promise<PersistedLead> => {
    const file = loadAll();
    const lead: PersistedLead = {
      ...input,
      id: genId(),
      createdAt: new Date().toISOString(),
    };
    file.leads.push(lead);
    persist(file);
    return lead;
  };
  const next = writeChain.then(run, run);
  // Keep the chain alive even if a write fails so subsequent writers proceed.
  writeChain = next.catch(() => undefined);
  return next;
}

export function getLeadsCount(): number {
  return loadAll().leads.length;
}

export function getAllLeads(): PersistedLead[] {
  // Most recent first.
  return loadAll().leads.slice().reverse();
}
