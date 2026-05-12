/**
 * Firm-branding settings persisted to localStorage so every TIS report a
 * single user prints carries their consultancy's logo, firm name, project
 * metadata, and PE-stamp signature block. No backend round-trip — the data
 * never leaves the browser.
 */

export interface FirmBranding {
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  logoDataUrl: string;       // base64-encoded PNG/JPG, kept under ~200kb
  preparedBy: string;        // engineer name, e.g. "Jane Smith, P.E."
  peNumber: string;          // PE license number, e.g. "GA #034152"
  defaultClient: string;     // optional default for "client" field on new studies
}

export interface ProjectMetadata {
  projectNumber: string;     // firm's internal project number, e.g. "23-0481"
  client: string;            // who the study is for
  preparedFor: string;       // entity submitting to (city, county, GDOT, etc.)
  reviewerName: string;      // PE reviewer name (often = preparedBy)
  studyDate: string;         // ISO date string; default today
  revisionNumber: string;    // e.g. "Rev 1", "Draft", "Final"
}

const FIRM_KEY = "atlanta-tis:firm-branding:v1";
const PROJECT_KEY_PREFIX = "atlanta-tis:project-metadata:v1:";

export const EMPTY_FIRM: FirmBranding = {
  firmName: "",
  firmAddress: "",
  firmPhone: "",
  logoDataUrl: "",
  preparedBy: "",
  peNumber: "",
  defaultClient: "",
};

export function loadFirmBranding(): FirmBranding {
  try {
    const raw = localStorage.getItem(FIRM_KEY);
    if (!raw) return { ...EMPTY_FIRM };
    const parsed = JSON.parse(raw);
    return { ...EMPTY_FIRM, ...parsed };
  } catch {
    return { ...EMPTY_FIRM };
  }
}

export function saveFirmBranding(b: FirmBranding): void {
  localStorage.setItem(FIRM_KEY, JSON.stringify(b));
}

export function clearFirmBranding(): void {
  localStorage.removeItem(FIRM_KEY);
}

export function isFirmConfigured(b: FirmBranding): boolean {
  return Boolean(b.firmName.trim() && b.preparedBy.trim());
}

export function emptyProjectMetadata(firm: FirmBranding): ProjectMetadata {
  return {
    projectNumber: "",
    client: firm.defaultClient ?? "",
    preparedFor: "",
    reviewerName: firm.preparedBy ?? "",
    studyDate: new Date().toISOString().slice(0, 10),
    revisionNumber: "Draft",
  };
}

// Per-project storage so an engineer can come back to the same project and
// reprint with the same metadata. Keyed by project name + lat/lon.
export function projectKey(projectName: string, lat: number, lon: number): string {
  return `${PROJECT_KEY_PREFIX}${projectName.toLowerCase().replace(/\s+/g, "-")}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

export function loadProjectMetadata(
  key: string,
  firm: FirmBranding,
): ProjectMetadata {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyProjectMetadata(firm);
    const parsed = JSON.parse(raw);
    return { ...emptyProjectMetadata(firm), ...parsed };
  } catch {
    return emptyProjectMetadata(firm);
  }
}

export function saveProjectMetadata(key: string, m: ProjectMetadata): void {
  localStorage.setItem(key, JSON.stringify(m));
}
