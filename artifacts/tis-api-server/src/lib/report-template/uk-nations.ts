/**
 * Home-nation scope of the UK standards registry — read by the neutral UK TA
 * only (templates/neutral-uk.ts, through the *ByNation providers).
 *
 * The shared registry (regulations.ts) tags the NPPF, the PPG and Census
 * WU03EW "UK", and the Velocity TA prints that registry as it stands for every
 * UK site: their house format is kept exactly as it is, so neither the registry
 * nor its jurisdiction tags change here. The neutral TA prints for every UK
 * nation under another firm's name, so it lists an entry only where it
 * applies: the NPPF and the PPG are England's (Scotland, Wales and Northern
 * Ireland each set their own national planning policy), and WU03EW is the
 * England-and-Wales Census table (the "EW" suffix).
 */
import { applicableRegulations, type Regulation, type StudyKind } from "./regulations";

export type UkNation = "ENG" | "SCT" | "WLS" | "NIR";

const UK_NATIONS: readonly string[] = ["ENG", "SCT", "WLS", "NIR"];

/** Registry codes that apply in some UK nations only, and those nations. A code not listed applies UK-wide. */
export const UK_NATION_SCOPE: Readonly<Record<string, readonly UkNation[]>> = {
  NPPF: ["ENG"],
  PPG: ["ENG"],
  "Census WU03EW": ["ENG", "WLS"],
};

/** A UK region's home nation (its regions.ts stateCode; London is in England), or null when it names none. */
export function homeNation(region: any): UkNation | null {
  if (region?.country !== "UK") return null;
  if (UK_NATIONS.includes(region?.stateCode)) return region.stateCode as UkNation;
  return /london/i.test(region?.displayName ?? "") ? "ENG" : null;
}

/**
 * applicableRegulations for the region and study kind, less every entry whose
 * nation scope leaves out the region's home nation. Outside the UK it is
 * applicableRegulations unchanged.
 */
export function nationScopedRegulations(region: any, kind: StudyKind): Regulation[] {
  const regs = applicableRegulations(region, kind);
  if (region?.country !== "UK") return regs;
  const nation = homeNation(region);
  return regs.filter((r) => {
    const scope = UK_NATION_SCOPE[r.code];
    return !scope || (nation !== null && scope.includes(nation));
  });
}
