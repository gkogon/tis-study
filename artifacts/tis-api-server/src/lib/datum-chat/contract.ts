/**
 * The one door from the pure datum-chat modules to lib/tis-api-zod.
 *
 * "@workspace/tis-api-zod" cannot be used from a module that has to load under
 * plain `node`: its index re-exports the generated files without an extension,
 * and node does not resolve that. Only the two files below can be loaded
 * directly. Every pure module in this directory imports the contract from
 * "./contract.ts" and nowhere else, so that fact is written down once, here,
 * and verify-datum-chat.mjs pins it.
 *
 * tsc accepts the explicit `.ts` paths because this package's tsconfig sets
 * allowImportingTsExtensions and references lib/tis-api-zod.
 *
 * The generated names are re-exported one by one on purpose: a wildcard from
 * generated/ would put the whole generated surface behind this door.
 */
export * from "../../../../../lib/tis-api-zod/src/datum-chat.ts";
export {
  GenerateTisBody,
  generateTisBodySignalTimingOverridesMax,
} from "../../../../../lib/tis-api-zod/src/generated/api.ts";
