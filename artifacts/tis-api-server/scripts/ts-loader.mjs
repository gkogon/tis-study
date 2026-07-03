// ESM loader hook: resolves extensionless relative imports to .ts files.
// Used by check-scripts that import .ts modules which themselves import
// other .ts modules without extensions (tsc bundler-mode convention).
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  const { parentURL } = context;
  // Only handle relative imports that lack an extension.
  if (
    parentURL &&
    specifier.startsWith(".") &&
    !path.extname(specifier)
  ) {
    const parentPath = fileURLToPath(parentURL);
    const candidate = path.resolve(path.dirname(parentPath), specifier + ".ts");
    if (fs.existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
