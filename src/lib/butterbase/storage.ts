// ============================================================================
// src/lib/butterbase/storage.ts — bucket helpers (uploads + signed URLs).
//
// Promo:      BUTTERBASE0502
// Submission: butterbase0502
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Single bucket: `preopreel-renders`. Five prefixes (see types.gen.ts
// BUCKET_LAYOUT). All API access uses the service-role key; signed URLs are
// minted lazily, per request, from `mintSignedUrl()` in client.ts so the URL
// in HTML is never older than the page render (Mara E.3 mitigation).
//
// Implementation strategy: Butterbase's Storage REST API is Supabase-shape.
// We use it directly via fetch to keep zero hard dependency on `@butterbase/js`.
// If the SDK is present at runtime, client.ts swaps these helpers for the
// SDK's storage methods. Either way the on-the-wire shape is the same.
// ============================================================================

import { BUCKET_NAME } from "./types.gen";

interface StorageEnv {
  projectUrl: string;
  serviceKey: string;
  bucket: string;
}

function loadEnv(): StorageEnv {
  const projectUrl = process.env.BUTTERBASE_PROJECT_URL ?? "";
  const serviceKey = process.env.BUTTERBASE_API_KEY ?? "";
  const bucket = process.env.BUTTERBASE_STORAGE_BUCKET ?? BUCKET_NAME;
  if (!projectUrl || !serviceKey) {
    throw new Error(
      "[butterbase/storage] BUTTERBASE_PROJECT_URL and BUTTERBASE_API_KEY are required",
    );
  }
  return { projectUrl: projectUrl.replace(/\/$/, ""), serviceKey, bucket };
}

/**
 * Upload bytes to the named bucket at `key`. Overwrites if present.
 * Returns the storage key (caller signs it on demand).
 */
export async function uploadBytes(
  key: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
  bucket?: string,
): Promise<string> {
  const env = loadEnv();
  const targetBucket = bucket ?? env.bucket;
  const url = `${env.projectUrl}/storage/v1/object/${encodeURIComponent(targetBucket)}/${encodeStoragePath(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "x-upsert": "true",
    },
    body: toBodyInit(bytes),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 409 from Supabase-shape APIs means "already exists" without upsert;
    // we do upsert above, so 409 should not normally occur — but if the
    // backend rejects upsert, fall through with a clear error.
    throw new Error(
      `[butterbase/storage] upload failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return key;
}

/**
 * Mint a signed URL for `key`. ttlSeconds defaults to 1 hour, matching the
 * lazy-mint policy in plan 05 (Mara E.3 — never embed a long-lived URL in HTML).
 */
export async function signedUrl(
  key: string,
  ttlSeconds = 3600,
  bucket?: string,
): Promise<string> {
  const env = loadEnv();
  const targetBucket = bucket ?? env.bucket;
  const url = `${env.projectUrl}/storage/v1/object/sign/${encodeURIComponent(targetBucket)}/${encodeStoragePath(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
    },
    body: JSON.stringify({ expiresIn: ttlSeconds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[butterbase/storage] signedUrl failed (${res.status}): ${text || res.statusText}`,
    );
  }
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const signed = body.signedURL ?? body.signedUrl;
  if (!signed) {
    throw new Error("[butterbase/storage] signedUrl response missing url");
  }
  // Some backends return a path-only string; absolutify it.
  if (signed.startsWith("http")) return signed;
  return `${env.projectUrl}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

/**
 * Download bytes for `key`. Used by the replay system when a fixture is
 * stored in object storage rather than inline `bytea`.
 */
export async function downloadBytes(
  key: string,
  bucket?: string,
): Promise<Buffer> {
  const env = loadEnv();
  const targetBucket = bucket ?? env.bucket;
  const url = `${env.projectUrl}/storage/v1/object/${encodeURIComponent(targetBucket)}/${encodeStoragePath(key)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
    },
  });
  if (!res.ok) {
    throw new Error(
      `[butterbase/storage] download failed (${res.status}): ${res.statusText}`,
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Encode a storage path so slashes survive (per-segment encode).
 */
function encodeStoragePath(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/**
 * Coerce a Buffer to fetch's BodyInit. Node's undici accepts Uint8Array
 * at runtime, but the DOM lib types narrow BodyInit too aggressively in
 * Node — wrap in a Blob to satisfy both runtimes.
 */
function toBodyInit(bytes: Buffer | Uint8Array): BodyInit {
  // Slice into a fresh Uint8Array view, then pass through Blob to coerce
  // into a guaranteed BodyInit-shaped value across both undici and the DOM lib.
  const view =
    bytes instanceof Buffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : bytes;
  // Casting through unknown — runtime accepts Uint8Array; tsc just disagrees.
  return view as unknown as BodyInit;
}
