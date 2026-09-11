// The read-only quota gate /whatif runs in place of reserveStudySlot.
//
// firmMayRunUncharged(firm, email) must say "yes" in exactly the cases where
// reserveStudySlot would have found a slot to charge — unlimited (dev-auth /
// studyLimit<=0 sentinel / admin email), period quota left on a non-
// delinquent subscription, or a prepaid credit — and "no" otherwise, with the
// same reason precedence (delinquency first). It reads columns and never
// touches the database, which is what makes it safe to run before an
// uncharged engine run.
//
// Run: pnpm run check:whatif-gate
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

// firms.ts imports the db client, which only needs the env var to exist —
// nothing here runs a query.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.ADMIN_EMAILS = "ops@example.com";
delete process.env.DEV_AUTH_ENABLED;

const { firmMayRunUncharged } = await import(path.resolve(here, "../src/lib/firms.ts"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const firm = (over = {}) => ({
  studyLimit: 10, studiesUsedThisPeriod: 0, studyCreditsRemaining: 0, subscriptionStatus: null, ...over,
});

// Unlimited buckets — never metered.
ok(firmMayRunUncharged(firm({ studyLimit: 0, studiesUsedThisPeriod: 0 })).ok, "studyLimit 0 sentinel: unlimited");
ok(firmMayRunUncharged(firm({ studyLimit: -1, studiesUsedThisPeriod: 99 })).ok, "negative studyLimit sentinel: unlimited");
ok(firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10 }), "ops@example.com").ok, "admin email: unlimited even at the cap");
ok(firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10 }), "OPS@example.com").ok, "admin email is case-insensitive");
ok(!firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10 }), "someone@example.com").ok, "non-admin email at the cap: blocked");

// Period quota.
ok(firmMayRunUncharged(firm({ studiesUsedThisPeriod: 9 })).ok, "9 of 10 used: quota left");
{
  const r = firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10 }));
  ok(!r.ok && r.reason === "quota_exceeded", `10 of 10 used, no credits: blocked, reason ${r.reason}`);
}
{
  const r = firmMayRunUncharged(firm({ studiesUsedThisPeriod: 12 }));
  ok(!r.ok && r.reason === "quota_exceeded", "over the cap: blocked");
}

// Credits.
ok(firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10, studyCreditsRemaining: 1 })).ok, "exhausted period + 1 credit: may run");
ok(!firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10, studyCreditsRemaining: -1 })).ok, "negative credits are not credits");

// Delinquency: blocks the period quota, not the credits; names itself in the reason.
for (const status of ["unpaid", "incomplete_expired", "canceled"]) {
  const r = firmMayRunUncharged(firm({ subscriptionStatus: status }));
  ok(!r.ok && r.reason === "subscription_delinquent", `${status} with quota left and no credits: blocked, reason ${r.reason}`);
  ok(firmMayRunUncharged(firm({ subscriptionStatus: status, studyCreditsRemaining: 2 })).ok, `${status} with credits: may run on credits`);
  ok(firmMayRunUncharged(firm({ subscriptionStatus: status, studyLimit: 0 })).ok, `${status} but unlimited sentinel: may run`);
}
ok(firmMayRunUncharged(firm({ subscriptionStatus: "past_due" })).ok, "past_due is the dunning grace period: may run on period quota");
ok(firmMayRunUncharged(firm({ subscriptionStatus: "active", studiesUsedThisPeriod: 3 })).ok, "active with quota: may run");
{
  const r = firmMayRunUncharged(firm({ subscriptionStatus: "active", studiesUsedThisPeriod: 10 }));
  ok(!r.ok && r.reason === "quota_exceeded", "active, exhausted, no credits: quota_exceeded (not delinquent)");
}

// Trial default (3 seats / 10 studies) exhausted.
{
  const r = firmMayRunUncharged(firm({ studyLimit: 10, studiesUsedThisPeriod: 10, subscriptionStatus: null }));
  ok(!r.ok && r.reason === "quota_exceeded", "exhausted trial: blocked, quota_exceeded");
}

// Dev-auth: everything is unlimited.
process.env.DEV_AUTH_ENABLED = "true";
ok(firmMayRunUncharged(firm({ studiesUsedThisPeriod: 10, subscriptionStatus: "canceled" })).ok, "DEV_AUTH_ENABLED=true: unlimited regardless of the row");
delete process.env.DEV_AUTH_ENABLED;

console.log(fails === 0 ? "\nAll what-if gate checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
