/**
 * Firm logo upload.
 *
 * Backend strategy:
 *   - Data-URL fallback (used today): converts the image to a base64
 *     data URL stored on the `firms.logo_url` column. Hard-capped at
 *     256 KB so we don't bloat the DB or break the PDFs.
 *   - Replit Object Storage (planned): once a bucket is provisioned
 *     on the Replit deployment, drop the @replit/object-storage SDK
 *     back in and switch on REPLIT_OBJECT_STORAGE_BUCKET. The branch
 *     for that path is kept below behind a feature-flag stub so the
 *     surrounding code doesn't churn when we re-enable it.
 *
 * Validation (always applied):
 *   - File ≤ 2 MB
 *   - Type in {PNG, JPEG, SVG, WebP}
 */
import { logger } from "./logger";

const MAX_BYTES = 1024 * 1024 * 2;            // 2 MB total ceiling
const DATA_URL_MAX_BYTES = 1024 * 256;        // 256 KB for inline storage

export type LogoUploadResult = {
  url: string;
  backend: "replit_object_storage" | "data_url_fallback";
};

export class LogoTooLargeError extends Error {
  constructor(reason: "for_storage" | "for_data_url") {
    super(
      reason === "for_storage"
        ? `Logo exceeds the ${MAX_BYTES / 1024 / 1024} MB upload limit.`
        : `Logo exceeds the ${DATA_URL_MAX_BYTES / 1024} KB inline-storage limit. Provision Replit Object Storage to upload larger images.`,
    );
  }
}

export class LogoInvalidTypeError extends Error {
  constructor(actual: string) {
    super(`Unsupported logo type: ${actual}. Use PNG, JPG, SVG, or WebP.`);
  }
}

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/svg+xml",
  "image/webp",
]);

function objectStorageBucket(): string | null {
  return process.env.REPLIT_OBJECT_STORAGE_BUCKET ?? null;
}

export async function uploadFirmLogo(args: {
  firmId: string;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<LogoUploadResult> {
  if (args.buffer.length > MAX_BYTES) throw new LogoTooLargeError("for_storage");
  if (!ALLOWED_MIME.has(args.mimeType.toLowerCase())) {
    throw new LogoInvalidTypeError(args.mimeType);
  }

  if (objectStorageBucket()) {
    // Future: re-introduce @replit/object-storage SDK via dynamic
    // import here. Kept stubbed so the existing flag plumbing stays
    // in place.
    logger.warn(
      { firmId: args.firmId },
      "logo-storage.bucket_env_set_but_sdk_not_wired — falling back to data URL",
    );
  }

  // Data-URL path.
  if (args.buffer.length > DATA_URL_MAX_BYTES) {
    throw new LogoTooLargeError("for_data_url");
  }
  const dataUrl = `data:${args.mimeType};base64,${args.buffer.toString("base64")}`;
  return { url: dataUrl, backend: "data_url_fallback" };
}
