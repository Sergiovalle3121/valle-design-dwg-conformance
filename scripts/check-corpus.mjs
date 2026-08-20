#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlesRoot = resolve(root, "bundles");
const sha256Pattern = /^[0-9a-f]{64}$/;
const bundleIdPattern = /^[a-z0-9][a-z0-9.-]{0,127}$/;

function fail(message) {
  throw new Error(`DWG corpus gate: ${message}`);
}

function inside(parent, child) {
  const candidate = relative(parent, child);
  return (
    candidate === "" ||
    (candidate !== ".." &&
      !candidate.startsWith(`..${sep}`) &&
      !isAbsolute(candidate))
  );
}

async function json(path, maximumBytes = 1024 * 1024) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    fail(`${relative(root, path)} is not a bounded regular JSON file`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail(`${relative(root, path)} is not valid JSON`);
  }
}

async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
  })) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function portablePath(value, expectedPrefix) {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    !value.startsWith(`${expectedPrefix}/`)
  ) {
    fail(`invalid portable artifact path`);
  }
  return value;
}

async function safeFile(bundleRoot, path) {
  const candidate = resolve(bundleRoot, path);
  if (!inside(bundleRoot, candidate)) fail(`artifact escapes its bundle`);
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`artifact is not a regular non-symlink file`);
  }
  const canonical = await realpath(candidate);
  if (!inside(await realpath(bundleRoot), canonical)) {
    fail(`artifact canonical path escapes its bundle`);
  }
  return { candidate, metadata };
}

async function validateArtifacts(
  bundleRoot,
  artifacts,
  prefix,
  seenPaths,
  seenIds,
) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    fail(`${prefix} must contain at least one artifact`);
  }
  for (const artifact of artifacts) {
    if (
      typeof artifact?.id !== "string" ||
      !bundleIdPattern.test(artifact.id) ||
      seenIds.has(artifact.id)
    ) {
      fail(`invalid or duplicate artifact id`);
    }
    seenIds.add(artifact.id);
    const path = portablePath(artifact?.path, prefix);
    const folded = path.normalize("NFC").toLowerCase();
    if (seenPaths.has(folded)) fail(`duplicate artifact path`);
    seenPaths.add(folded);
    if (!sha256Pattern.test(artifact?.sha256 ?? "")) fail(`invalid SHA-256`);
    if (
      !Number.isSafeInteger(artifact?.byteLength) ||
      artifact.byteLength < 1 ||
      artifact.byteLength > 512 * 1024 * 1024
    ) {
      fail(`invalid artifact byte length`);
    }
    const { candidate, metadata } = await safeFile(bundleRoot, path);
    if (metadata.size !== artifact.byteLength) fail(`artifact size mismatch`);
    if ((await hash(candidate)) !== artifact.sha256)
      fail(`artifact hash mismatch`);
  }
}

async function validateBundle(indexEntry) {
  if (!bundleIdPattern.test(indexEntry?.id ?? "")) fail(`invalid bundle id`);
  const expectedManifest = `bundles/${indexEntry.id}/manifest.json`;
  if (indexEntry.manifestPath !== expectedManifest)
    fail(`manifest path mismatch`);
  if (!sha256Pattern.test(indexEntry.manifestSha256 ?? "")) {
    fail(`invalid manifest hash`);
  }
  const manifestPath = resolve(root, expectedManifest);
  if (!inside(bundlesRoot, manifestPath)) fail(`manifest escapes bundles root`);
  const bundleRoot = resolve(bundlesRoot, indexEntry.id);
  const bundleMetadata = await lstat(bundleRoot);
  if (bundleMetadata.isSymbolicLink() || !bundleMetadata.isDirectory()) {
    fail(`bundle is not a regular non-symlink directory`);
  }
  if (!inside(await realpath(bundlesRoot), await realpath(bundleRoot))) {
    fail(`bundle canonical path escapes bundles root`);
  }
  const manifestMetadata = await lstat(manifestPath);
  if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) {
    fail(`manifest is not a regular non-symlink file`);
  }
  if ((await hash(manifestPath)) !== indexEntry.manifestSha256) {
    fail(`manifest hash mismatch`);
  }
  const manifest = await json(manifestPath);
  if (
    manifest.schemaVersion !== "1.0.0" ||
    manifest.id !== indexEntry.id ||
    manifest.status !== "allowed" ||
    manifest.rights?.containsClientData !== false ||
    !Array.isArray(manifest.reviews) ||
    !Array.isArray(manifest.validations) ||
    manifest.validations.length < 2 ||
    !Array.isArray(manifest.sourceFactIds) ||
    manifest.sourceFactIds.length === 0 ||
    new Set(manifest.sourceFactIds).size !== manifest.sourceFactIds.length ||
    ![
      "AC1009",
      "AC1012",
      "AC1014",
      "AC1015",
      "AC1018",
      "AC1021",
      "AC1024",
      "AC1027",
      "AC1032",
    ].includes(manifest.dwgVersion) ||
    ![
      "sergio-original",
      "donated-original",
      "licensed-third-party",
      "tool-converted-original",
    ].includes(manifest.rights?.origin)
  ) {
    fail(`bundle manifest is incomplete or not allowed`);
  }
  // Enmienda 2026-08-20 de CORPUS_POLICY.md: tool-converted-original admite
  // un revisor-propietario pero exige que la herramienta esté registrada en
  // docs/TOOLS.md y referenciada; cualquier otro origen sigue exigiendo dos
  // revisores humanos distintos.
  const uniqueReviews = new Set(
    manifest.reviews.map((handle) =>
      typeof handle === "string" ? handle.toLowerCase() : handle,
    ),
  );
  if (manifest.rights.origin === "tool-converted-original") {
    if (uniqueReviews.size < 1) fail(`bundle requires the owner reviewer`);
    const registryRef = manifest.rights.toolRegistryRef;
    if (
      typeof registryRef !== "string" ||
      !/^docs\/TOOLS\.md#[a-z0-9][a-z0-9.-]{0,127}$/.test(registryRef)
    ) {
      fail(`tool-converted-original bundle lacks a valid toolRegistryRef`);
    }
    const anchor = registryRef.slice(registryRef.indexOf("#") + 1);
    let registry;
    try {
      registry = await readFile(resolve(root, "docs", "TOOLS.md"), "utf8");
    } catch {
      fail(`docs/TOOLS.md is missing but a bundle references it`);
    }
    if (!registry.includes(`id="${anchor}"`)) {
      fail(`toolRegistryRef anchor "${anchor}" is not registered in docs/TOOLS.md`);
    }
  } else if (uniqueReviews.size < 2) {
    fail(`bundle requires two distinct human reviewers`);
  }
  const validators = new Set();
  for (const validation of manifest.validations) {
    if (
      typeof validation?.validator !== "string" ||
      typeof validation?.version !== "string" ||
      validation.result !== "accepted" ||
      !sha256Pattern.test(validation?.evidenceSha256 ?? "")
    ) {
      fail(`bundle validation is incomplete or not accepted`);
    }
    validators.add(`${validation.validator}\0${validation.version}`);
  }
  if (validators.size < 2) fail(`bundle requires two independent validators`);
  const seenPaths = new Set();
  const seenIds = new Set();
  await validateArtifacts(
    bundleRoot,
    manifest.fixtures,
    "fixtures",
    seenPaths,
    seenIds,
  );
  await validateArtifacts(
    bundleRoot,
    manifest.oracles,
    "oracles",
    seenPaths,
    seenIds,
  );

  const expectedFiles = new Set(["manifest.json", ...seenPaths]);
  const pending = [bundleRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`bundle contains a symlink`);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (!entry.isFile()) {
        fail(`bundle contains a non-regular entry`);
      } else {
        const path = relative(bundleRoot, entryPath).replaceAll("\\", "/");
        if (!expectedFiles.has(path))
          fail(`bundle contains an unmanifested file`);
        expectedFiles.delete(path);
      }
    }
  }
  if (expectedFiles.size !== 0)
    fail(`bundle is missing a manifest-listed file`);
}

const manifest = await json(resolve(root, "package.json"));
if (manifest.private !== true || manifest.license !== "UNLICENSED") {
  fail(`package.json must remain private and UNLICENSED`);
}

const index = await json(resolve(root, "index.json"));
if (
  index.schemaVersion !== "1.0.0" ||
  !/^\d{4}-\d{2}-\d{2}$/.test(index.updatedAt ?? "") ||
  !Array.isArray(index.bundles)
) {
  fail(`index.json has an unsupported shape`);
}
const ids = new Set();
const manifests = new Set();
for (const entry of index.bundles) {
  if (ids.has(entry?.id) || manifests.has(entry?.manifestPath)) {
    fail(`duplicate bundle id or manifest path`);
  }
  ids.add(entry.id);
  manifests.add(entry.manifestPath);
  await validateBundle(entry);
}

let physicalBundleCount = 0;
try {
  for (const entry of await readdir(bundlesRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      fail(`bundles contains a non-directory or symlink entry`);
    }
    physicalBundleCount += 1;
    if (!ids.has(entry.name)) fail(`unmanifested physical bundle`);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (physicalBundleCount !== index.bundles.length)
  fail(`bundle inventory mismatch`);

const repositoryPending = [root];
while (repositoryPending.length > 0) {
  const directory = repositoryPending.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "incoming", "private-notes"].includes(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`repository contains a symlink`);
    if (entry.isDirectory()) {
      repositoryPending.push(entryPath);
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".dwg") &&
      !inside(bundlesRoot, entryPath)
    ) {
      fail(`DWG bytes exist outside an admitted bundle`);
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ bundles: index.bundles.length, status: "ok" })}\n`,
);
