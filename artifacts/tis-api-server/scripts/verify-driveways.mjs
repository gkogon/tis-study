import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/driveways.ts"));
const { expandAccessType, resolveMovements } = m;

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };
const eqM = (a, b) => a.inLeft === b.inLeft && a.inRight === b.inRight && a.outLeft === b.outLeft && a.outRight === b.outRight;

ok(eqM(expandAccessType("full"), { inLeft: true, inRight: true, outLeft: true, outRight: true }), "full = all movements");
ok(eqM(expandAccessType("riro"), { inLeft: false, inRight: true, outLeft: false, outRight: true }), "riro = right-in + right-out only");
ok(eqM(expandAccessType("three_quarter"), { inLeft: true, inRight: true, outLeft: false, outRight: true }), "three_quarter = riro + left-in");
ok(eqM(expandAccessType("entrance_only"), { inLeft: true, inRight: true, outLeft: false, outRight: false }), "entrance_only = ins only");
ok(eqM(expandAccessType("exit_only"), { inLeft: false, inRight: false, outLeft: true, outRight: true }), "exit_only = outs only");
// custom passes movements through verbatim
ok(eqM(resolveMovements({ accessType: "custom", movements: { outLeft: true } }), { inLeft: false, inRight: false, outLeft: true, outRight: false }), "custom = supplied movements (missing keys false)");
// preset ignores any supplied movements
ok(eqM(resolveMovements({ accessType: "riro", movements: { inLeft: true } }), expandAccessType("riro")), "preset overrides supplied movements");

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
