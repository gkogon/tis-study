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

const { classifyMovement, sideOfStreet } = m;
// East–west street (bearing 90°), site on the SOUTH side. driveway→site points south (bearing 180°).
const south = sideOfStreet(90, 180); // site south of an eastbound street = driver's right = -1
ok(south === -1, `south-side of E-W street = right side (got ${south})`);
// Inbound trip FROM THE WEST (origin bearing 270°): travels east, site on the right ⇒ right turn in.
ok(classifyMovement(90, south, 270, true) === "inRight", `from west into south-side driveway = inRight (got ${classifyMovement(90, south, 270, true)})`);
// Inbound trip FROM THE EAST (origin bearing 90°): travels west, site on the left ⇒ left turn in.
ok(classifyMovement(90, south, 90, true) === "inLeft", `from east into south-side driveway = inLeft (got ${classifyMovement(90, south, 90, true)})`);
// Outbound trip TO THE WEST (destination 270°): departs heading west; leaving a south-side driveway to go west = left turn out.
ok(classifyMovement(90, south, 270, false) === "outLeft", `to west out of south-side driveway = outLeft (got ${classifyMovement(90, south, 270, false)})`);
// Outbound trip TO THE EAST (destination 90°): right turn out.
ok(classifyMovement(90, south, 90, false) === "outRight", `to east out of south-side driveway = outRight (got ${classifyMovement(90, south, 90, false)})`);

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
