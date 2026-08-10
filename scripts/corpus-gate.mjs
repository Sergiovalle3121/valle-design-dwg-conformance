import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";

const execFileAsync = promisify(execFile);
const decoder = new TextDecoder("utf-8", { fatal: true });

const OWNER_REVIEWER = "@Sergiovalle3121";
const INDEX_SCHEMA_VERSION = "2.0.0";
const RECORD_SCHEMA_VERSION = "1.0.0";
const VERSION_CODES = new Set([
  "AC1009",
  "AC1012",
  "AC1014",
  "AC1015",
  "AC1018",
  "AC1021",
  "AC1024",
  "AC1027",
  "AC1032",
]);
const DIRECTIONS = new Set(["read", "write"]);
const OBJECT_KINDS = new Set([
  "attestation",
  "evidence",
  "fixture",
  "ground-truth",
  "intake",
  "oracle",
  "validation",
]);
const STRUCTURED_KINDS = new Set(["intake", "oracle", "validation"]);
const LICENSES_BY_ORIGIN = new Map([
  ["sergio-original", new Set(["Valle-Owner-Authorized"])],
  ["donated-original", new Set(["Valle-Donor-Authorized"])],
  [
    "licensed-third-party",
    new Set([
      "0BSD",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "CC-BY-4.0",
      "CC0-1.0",
      "ISC",
      "MIT",
      "Unlicense",
    ]),
  ],
]);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/u;
const BUNDLE_ID_PATTERN = /^bundle-[a-z0-9][a-z0-9.-]{2,95}$/u;
const FACT_ID_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{2,127}$/u;
const HANDLE_PATTERN = /^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

// This list is part of the trusted verifier, not candidate data. It deliberately
// stays empty until the owner verifies a real second reviewer and FACT_REGISTER
// snapshot in a tooling-only change. Tests inject synthetic policy explicitly.
const DEFAULT_TRUSTED_ADMISSION = Object.freeze({
  factSnapshots: Object.freeze([]),
  secondReviewers: Object.freeze([]),
});

export const LIMITS = Object.freeze({
  artifactBytes: 256 * 1024 * 1024,
  bundleBytes: 512 * 1024 * 1024,
  bundles: 1_024,
  dataFiles: 50_000,
  factSnapshotAggregateBytes: 16 * 1024 * 1024,
  factSnapshotBytes: 2 * 1024 * 1024,
  fixturesPerBundle: 512,
  indexBytes: 512 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  objectsPerBundle: 4_096,
  pathBytes: 240,
  pathDepth: 6,
  recordBytes: 512 * 1024,
  repositoryBytes: 2 * 1024 * 1024 * 1024,
  structuredBytesPerBundle: 32 * 1024 * 1024,
  trackedMetadataBytes: 16 * 1024 * 1024,
});

export const STATIC_REPOSITORY_FILES = Object.freeze([
  ".gitattributes",
  ".github/CODEOWNERS",
  ".github/workflows/ci.yml",
  ".gitignore",
  "AGENTS.md",
  "CORPUS_POLICY.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "index.json",
  "index.schema.json",
  "intake.schema.json",
  "manifest.schema.json",
  "oracle.schema.json",
  "package.json",
  "scripts/check-corpus.mjs",
  "scripts/corpus-gate.mjs",
  "tests/check-corpus.spec.mjs",
  "validation.schema.json",
]);

function fail(message) {
  throw new Error(`DWG corpus gate: ${message}`);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function caseFold(value) {
  return value.normalize("NFC").toLowerCase();
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

function assertRecord(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} has missing or additional properties`);
  }
  return value;
}

function assertArray(value, label, minimum, maximum) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    fail(`${label} has an invalid item count`);
  }
  return value;
}

function assertString(value, label, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(`${label} must be a bounded canonical string`);
  }
  return value;
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${label} is not a portable ID`);
  }
  return value;
}

function assertFactId(value, label) {
  if (typeof value !== "string" || !FACT_ID_PATTERN.test(value)) {
    fail(`${label} is not a fact ID`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} is not SHA-256`);
  }
  return value;
}

function assertHandle(value, label) {
  if (typeof value !== "string" || !HANDLE_PATTERN.test(value)) {
    fail(`${label} is not a canonical GitHub handle`);
  }
  return value;
}

function assertSafeInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its integer budget`);
  }
  return value;
}

function parseDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail(`${label} is not an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${label} is not a real date`);
  }
  return parsed.valueOf();
}

function parseDateTime(value, label) {
  if (typeof value !== "string" || !DATE_TIME_PATTERN.test(value)) {
    fail(`${label} is not a canonical UTC timestamp`);
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().replace(".000Z", "Z") !== value
  ) {
    fail(`${label} is not a real UTC timestamp`);
  }
  return parsed.valueOf();
}

function assertUnique(values, label, transform = caseFold) {
  const seen = new Set();
  for (const value of values) {
    const key = transform(value);
    if (seen.has(key)) fail(`${label} contains a duplicate`);
    seen.add(key);
  }
}

function assertPortableSegment(segment, label) {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(segment) ||
    segment.endsWith(".") ||
    WINDOWS_RESERVED.test(segment)
  ) {
    fail(`${label} contains a non-portable segment`);
  }
}

function assertPortableRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > LIMITS.pathBytes ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    /[\u0000-\u001f\u007f:]/u.test(value)
  ) {
    fail(`${label} is not a bounded portable path`);
  }
  const parts = value.split("/");
  if (parts.length > LIMITS.pathDepth) {
    fail(`${label} exceeds the path-depth budget`);
  }
  for (const part of parts) assertPortableSegment(part, label);
  return value;
}

function parseCanonicalJson(bytes, label) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (canonicalJson(value) !== text) {
    fail(`${label} is not canonical JSON`);
  }
  return value;
}

async function assertSafeRoot(root, label) {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} is not a regular non-symlink directory`);
  }
  return realpath(root);
}

async function safeFile(root, canonicalRoot, relativePath, label) {
  assertPortableRelativePath(relativePath, label);
  let current = root;
  const parts = relativePath.split("/");
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    if (!inside(root, current)) fail(`${label} escapes its root`);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) fail(`${label} traverses a symlink`);
    if (index < parts.length - 1 && !metadata.isDirectory()) {
      fail(`${label} traverses a non-directory`);
    }
    if (index === parts.length - 1 && !metadata.isFile()) {
      fail(`${label} is not a regular file`);
    }
  }
  const canonical = await realpath(current);
  if (!inside(canonicalRoot, canonical)) fail(`${label} escapes canonically`);
  return current;
}

async function readAndHashFile(
  root,
  canonicalRoot,
  relativePath,
  expectedBytes,
  maximumBytes,
  label,
  capture,
) {
  assertSafeInteger(expectedBytes, 1, maximumBytes, `${label} byteLength`);
  const path = await safeFile(root, canonicalRoot, relativePath, label);
  const flags = fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedBytes) {
      fail(`${label} size does not match its manifest`);
    }
    const digest = createHash("sha256");
    const captured = capture ? Buffer.alloc(expectedBytes) : null;
    const chunk = Buffer.alloc(Math.min(1024 * 1024, expectedBytes));
    let offset = 0;
    while (offset < expectedBytes) {
      const length = Math.min(chunk.length, expectedBytes - offset);
      const { bytesRead } = await handle.read(chunk, 0, length, offset);
      if (bytesRead !== length) fail(`${label} changed during its bounded read`);
      digest.update(chunk.subarray(0, bytesRead));
      if (captured !== null) chunk.copy(captured, offset, 0, bytesRead);
      offset += bytesRead;
    }
    const sentinel = Buffer.alloc(1);
    const extra = await handle.read(sentinel, 0, 1, expectedBytes);
    const after = await handle.stat();
    if (extra.bytesRead !== 0 || after.size !== expectedBytes) {
      fail(`${label} changed during its bounded read`);
    }
    return { bytes: captured, sha256: digest.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function readCanonicalJsonFile(root, canonicalRoot, relativePath, maximumBytes, label) {
  const path = await safeFile(root, canonicalRoot, relativePath, label);
  const metadata = await lstat(path);
  assertSafeInteger(metadata.size, 1, maximumBytes, `${label} size`);
  const result = await readAndHashFile(
    root,
    canonicalRoot,
    relativePath,
    metadata.size,
    maximumBytes,
    label,
    true,
  );
  return {
    byteLength: metadata.size,
    sha256: result.sha256,
    value: parseCanonicalJson(result.bytes, label),
  };
}

async function trackedFiles(root) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "--stage", "-z"],
      { encoding: "buffer", maxBuffer: LIMITS.trackedMetadataBytes },
    ));
  } catch {
    fail(`candidate root must be a readable Git worktree`);
  }
  let text;
  try {
    text = decoder.decode(stdout);
  } catch {
    fail(`Git tracked-file metadata is not UTF-8`);
  }
  const files = new Map();
  for (const record of text.split("\0")) {
    if (record === "") continue;
    const match = /^(\d{6}) [a-f0-9]{40,64} (\d)\t([\s\S]+)$/u.exec(record);
    if (match === null || match[2] !== "0" || match[1] !== "100644") {
      fail(`repository contains a staged, executable, symlink or special entry`);
    }
    const path = match[3];
    if (path !== path.normalize("NFC") || files.has(caseFold(path))) {
      fail(`repository contains a non-canonical or duplicate tracked path`);
    }
    files.set(caseFold(path), path);
    if (files.size > LIMITS.dataFiles) fail(`repository exceeds its file budget`);
  }
  return files;
}

function validateReviewSummaries(reviews, admission, finalizedAt, label) {
  const records = assertArray(reviews, `${label} reviews`, 2, 8);
  const reviewers = [];
  let ownerCount = 0;
  let secondCount = 0;
  for (const [index, value] of records.entries()) {
    const review = assertRecord(
      value,
      ["decision", "reviewedAt", "reviewer", "role"],
      `${label} review ${index}`,
    );
    const reviewer = assertHandle(review.reviewer, `${label} reviewer`);
    reviewers.push(reviewer);
    if (review.decision !== "approved") fail(`${label} review is not approved`);
    const reviewedAt = parseDateTime(review.reviewedAt, `${label} review date`);
    if (reviewedAt > finalizedAt) fail(`${label} review postdates finalization`);
    const folded = caseFold(reviewer);
    if (review.role === "owner" && folded === caseFold(admission.ownerReviewer)) {
      ownerCount += 1;
    } else if (
      review.role === "second-reviewer" &&
      admission.secondReviewers.some((entry) => caseFold(entry) === folded)
    ) {
      secondCount += 1;
    } else {
      fail(`${label} review identity or role is not admitted`);
    }
  }
  assertUnique(reviewers, `${label} reviewers`);
  if (ownerCount !== 1 || secondCount < 1) {
    fail(`${label} requires the owner and an admitted second reviewer`);
  }
}

function validateFactSnapshotDocument(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is not a fact register`);
  }
  const facts = assertArray(value.facts, `${label} facts`, 1, 20_000);
  const allowedFacts = new Map();
  const ids = [];
  for (const [index, fact] of facts.entries()) {
    if (fact === null || typeof fact !== "object" || Array.isArray(fact)) {
      fail(`${label} fact ${index} is not an object`);
    }
    const id = assertFactId(fact.id, `${label} fact ID`);
    ids.push(id);
    if (
      fact.status === "allowed" &&
      fact.derivableContentRecorded === true &&
      fact.humanReview?.decision === "approved" &&
      ["algorithm", "conformance", "format", "governance", "original-measurement"].includes(
        fact.kind,
      )
    ) {
      allowedFacts.set(caseFold(id), { id, kind: fact.kind });
    }
  }
  assertUnique(ids, `${label} fact IDs`);
  return allowedFacts;
}

async function validateFactSnapshots(root, canonicalRoot, descriptors, expectedFiles, dataDigests) {
  const snapshots = assertArray(descriptors, "factSnapshots", 0, 64);
  const byHash = new Map();
  const paths = [];
  let aggregateBytes = 0;
  for (const [index, value] of snapshots.entries()) {
    const descriptor = assertRecord(
      value,
      ["byteLength", "commit", "objectPath", "repository", "sha256", "sourcePath"],
      `fact snapshot ${index}`,
    );
    if (descriptor.repository !== "Sergiovalle3121/valle-design") {
      fail(`fact snapshot repository is not authorized`);
    }
    if (!COMMIT_PATTERN.test(descriptor.commit ?? "")) fail(`fact snapshot commit is invalid`);
    if (descriptor.sourcePath !== "packages/dwg-codec/FACT_REGISTER.json") {
      fail(`fact snapshot source path is invalid`);
    }
    const sha256 = assertSha256(descriptor.sha256, `fact snapshot hash`);
    const objectPath = `fact-snapshots/sha256/${sha256}`;
    if (descriptor.objectPath !== objectPath) fail(`fact snapshot path is not content-addressed`);
    assertSafeInteger(
      descriptor.byteLength,
      1,
      LIMITS.factSnapshotBytes,
      `fact snapshot byteLength`,
    );
    aggregateBytes += descriptor.byteLength;
    if (aggregateBytes > LIMITS.factSnapshotAggregateBytes) {
      fail(`fact snapshots exceed their aggregate byte budget`);
    }
    if (byHash.has(sha256)) fail(`duplicate fact snapshot hash`);
    paths.push(objectPath);
    expectedFiles.add(objectPath);
    const result = await readAndHashFile(
      root,
      canonicalRoot,
      objectPath,
      descriptor.byteLength,
      LIMITS.factSnapshotBytes,
      `fact snapshot`,
      true,
    );
    if (result.sha256 !== sha256) fail(`fact snapshot hash mismatch`);
    dataDigests.set(objectPath, sha256);
    byHash.set(sha256, {
      descriptor,
      facts: validateFactSnapshotDocument(
        parseCanonicalJson(result.bytes, `fact snapshot`),
        `fact snapshot`,
      ),
    });
  }
  assertUnique(paths, `fact snapshot paths`);
  return byHash;
}

function validateAdmission(value) {
  const admission = assertRecord(
    value,
    ["factSnapshots", "ownerReviewer", "secondReviewers"],
    "index admission",
  );
  if (admission.ownerReviewer !== OWNER_REVIEWER) fail(`owner reviewer is immutable`);
  const secondReviewers = assertArray(admission.secondReviewers, "secondReviewers", 0, 8);
  for (const reviewer of secondReviewers) {
    assertHandle(reviewer, "second reviewer");
    if (caseFold(reviewer) === caseFold(OWNER_REVIEWER)) {
      fail(`owner cannot be the second reviewer`);
    }
  }
  assertUnique(secondReviewers, "second reviewers");
  return admission;
}

function validateTrustedAdmission(value) {
  const trusted = value ?? DEFAULT_TRUSTED_ADMISSION;
  if (
    trusted === null ||
    typeof trusted !== "object" ||
    !Array.isArray(trusted.secondReviewers) ||
    !Array.isArray(trusted.factSnapshots)
  ) {
    fail(`trusted admission policy is invalid`);
  }
  const reviewers = trusted.secondReviewers.map((reviewer) =>
    assertHandle(reviewer, `trusted second reviewer`),
  );
  assertUnique(reviewers, `trusted second reviewers`);
  const snapshots = new Map();
  for (const descriptor of trusted.factSnapshots) {
    if (
      descriptor === null ||
      typeof descriptor !== "object" ||
      !SHA256_PATTERN.test(descriptor.sha256 ?? "")
    ) {
      fail(`trusted fact snapshot policy is invalid`);
    }
    if (snapshots.has(descriptor.sha256)) fail(`trusted fact snapshot policy has duplicates`);
    snapshots.set(descriptor.sha256, canonicalJson(descriptor));
  }
  return { reviewers, snapshots };
}

function validateIndex(value, trustedPolicy) {
  const index = assertRecord(
    value,
    ["$schema", "admission", "bundles", "schemaVersion", "updatedAt"],
    "index.json",
  );
  if (index.$schema !== "./index.schema.json" || index.schemaVersion !== INDEX_SCHEMA_VERSION) {
    fail(`index schema identity is unsupported`);
  }
  parseDate(index.updatedAt, "index updatedAt");
  const admission = validateAdmission(index.admission);
  const bundles = assertArray(index.bundles, "index bundles", 0, LIMITS.bundles);
  const ids = [];
  const manifestPaths = [];
  for (const [position, valueEntry] of bundles.entries()) {
    const entry = assertRecord(
      valueEntry,
      ["id", "manifestByteLength", "manifestPath", "manifestSha256"],
      `bundle index entry ${position}`,
    );
    if (typeof entry.id !== "string" || !BUNDLE_ID_PATTERN.test(entry.id)) {
      fail(`bundle index entry has an invalid ID`);
    }
    const expectedPath = `bundles/${entry.id}/manifest.json`;
    if (entry.manifestPath !== expectedPath) fail(`bundle manifest path mismatch`);
    assertSha256(entry.manifestSha256, `bundle manifest hash`);
    assertSafeInteger(
      entry.manifestByteLength,
      1,
      LIMITS.manifestBytes,
      `bundle manifest byteLength`,
    );
    ids.push(entry.id);
    manifestPaths.push(entry.manifestPath);
  }
  assertUnique(ids, "bundle IDs");
  assertUnique(manifestPaths, "bundle manifest paths");
  const admittedReviewers = admission.secondReviewers.filter((reviewer) =>
    trustedPolicy.reviewers.some((trusted) => caseFold(trusted) === caseFold(reviewer)),
  );
  const admittedSnapshots = admission.factSnapshots.filter(
    (snapshot) => trustedPolicy.snapshots.get(snapshot.sha256) === canonicalJson(snapshot),
  );
  if (admittedReviewers.length !== admission.secondReviewers.length) {
    fail(`index contains a second reviewer outside the trusted policy`);
  }
  if (admittedSnapshots.length !== admission.factSnapshots.length) {
    fail(`index contains a fact snapshot outside the trusted policy`);
  }
  if (
    bundles.length > 0 &&
    (admittedReviewers.length === 0 || admittedSnapshots.length === 0)
  ) {
    fail(`non-empty corpus is locked by the trusted reviewer and snapshot policy`);
  }
  return {
    admission: {
      ...admission,
      secondReviewers: admittedReviewers,
    },
    bundles,
    index,
    trustedSnapshots: new Set(admittedSnapshots.map((snapshot) => snapshot.sha256)),
  };
}

function requireObject(objectsById, objectId, kind, label) {
  const id = assertId(objectId, `${label} object ID`);
  const object = objectsById.get(caseFold(id));
  if (object === undefined || object.kind !== kind) {
    fail(`${label} does not resolve to a ${kind} object`);
  }
  return object;
}

function claimObject(claims, object, fixtureId, label) {
  const key = caseFold(object.id);
  const existing = claims.get(key);
  if (existing !== undefined && existing !== fixtureId) {
    fail(`${label} shares an object across fixtures`);
  }
  claims.set(key, fixtureId);
}

function validateSourceFactIds(values, snapshot, label) {
  const sourceFactIds = assertArray(values, `${label} sourceFactIds`, 1, 512);
  for (const id of sourceFactIds) assertFactId(id, `${label} source fact ID`);
  assertUnique(sourceFactIds, `${label} source fact IDs`);
  const facts = sourceFactIds.map((id) => snapshot.facts.get(caseFold(id)));
  if (facts.some((fact) => fact === undefined)) {
    fail(`${label} references a fact not allowed by the fixed snapshot`);
  }
  if (!facts.some((fact) => fact.kind !== "governance")) {
    fail(`${label} requires a non-governance source fact`);
  }
  return new Set(sourceFactIds.map(caseFold));
}

function validateIntake(
  record,
  descriptor,
  fixture,
  fixtureObject,
  manifestFacts,
  snapshot,
  objectsById,
  claims,
  admission,
  finalizedAt,
) {
  const intake = assertRecord(
    record,
    [
      "$schema",
      "fixtureByteLength",
      "fixtureId",
      "fixtureSha256",
      "id",
      "origin",
      "privacy",
      "reviews",
      "rights",
      "schemaVersion",
      "submittedAt",
    ],
    `intake record`,
  );
  if (
    intake.$schema !== "urn:valle-design:dwg-intake:1.0.0" ||
    intake.schemaVersion !== RECORD_SCHEMA_VERSION ||
    intake.id !== descriptor.id ||
    intake.fixtureId !== fixture.id ||
    intake.fixtureSha256 !== fixtureObject.sha256 ||
    intake.fixtureByteLength !== fixtureObject.byteLength
  ) {
    fail(`intake record does not bind its exact fixture`);
  }
  const submittedAt = parseDateTime(intake.submittedAt, `intake submittedAt`);
  if (submittedAt > finalizedAt) fail(`intake postdates bundle finalization`);
  const origin = assertRecord(
    intake.origin,
    ["createdAt", "kind", "owner", "sourceFactIds", "tool", "toolVersion"],
    `intake origin`,
  );
  if (!LICENSES_BY_ORIGIN.has(origin.kind)) fail(`intake origin is not allowed`);
  if (origin.kind === "sergio-original" && origin.owner !== "Sergio Valle Zárate") {
    fail(`owner-original intake has the wrong owner`);
  }
  assertString(origin.owner, `intake owner`, 256);
  assertString(origin.tool, `intake creation tool`, 128);
  assertString(origin.toolVersion, `intake creation tool version`, 128);
  const createdAt = parseDate(origin.createdAt, `intake creation date`);
  if (createdAt > submittedAt) fail(`fixture creation postdates intake`);
  const intakeFacts = assertArray(origin.sourceFactIds, `intake sourceFactIds`, 1, 512);
  for (const id of intakeFacts) {
    assertFactId(id, `intake source fact ID`);
    if (!manifestFacts.has(caseFold(id))) fail(`intake source fact is outside the bundle snapshot`);
  }
  assertUnique(intakeFacts, `intake source fact IDs`);
  if (
    !intakeFacts.some((id) => {
      const fact = snapshot.facts.get(caseFold(id));
      return fact !== undefined && fact.kind !== "governance";
    })
  ) {
    fail(`intake requires a non-governance source fact`);
  }

  const rights = assertRecord(
    intake.rights,
    [
      "decision",
      "evidenceObjectId",
      "licenseId",
      "modifyAllowed",
      "redistributionScope",
      "useAllowed",
    ],
    `intake rights`,
  );
  if (
    rights.decision !== "approved" ||
    rights.useAllowed !== true ||
    rights.modifyAllowed !== true ||
    rights.redistributionScope !== "private-conformance-only" ||
    !LICENSES_BY_ORIGIN.get(origin.kind).has(rights.licenseId)
  ) {
    fail(`intake rights are not explicitly allowed`);
  }
  const rightsEvidence = requireObject(
    objectsById,
    rights.evidenceObjectId,
    "attestation",
    `rights evidence`,
  );
  claimObject(claims, rightsEvidence, fixture.id, `rights evidence`);

  const privacy = assertRecord(
    intake.privacy,
    [
      "containsClientData",
      "containsConfidentialData",
      "containsPersonalData",
      "containsSecrets",
      "decision",
      "evidenceObjectId",
    ],
    `intake privacy`,
  );
  if (
    privacy.decision !== "approved" ||
    privacy.containsClientData !== false ||
    privacy.containsConfidentialData !== false ||
    privacy.containsPersonalData !== false ||
    privacy.containsSecrets !== false
  ) {
    fail(`intake privacy review is not fail-closed`);
  }
  const privacyEvidence = requireObject(
    objectsById,
    privacy.evidenceObjectId,
    "attestation",
    `privacy evidence`,
  );
  claimObject(claims, privacyEvidence, fixture.id, `privacy evidence`);

  const reviews = assertArray(intake.reviews, `intake reviews`, 2, 8);
  const reviewers = [];
  let ownerCount = 0;
  let secondCount = 0;
  for (const [index, reviewValue] of reviews.entries()) {
    const review = assertRecord(
      reviewValue,
      ["decision", "evidenceObjectId", "reviewedAt", "reviewer", "role"],
      `intake review ${index}`,
    );
    const reviewer = assertHandle(review.reviewer, `intake reviewer`);
    reviewers.push(reviewer);
    if (review.decision !== "approved") fail(`intake review is not approved`);
    const reviewedAt = parseDateTime(review.reviewedAt, `intake review date`);
    if (reviewedAt < submittedAt || reviewedAt > finalizedAt) {
      fail(`intake review chronology is invalid`);
    }
    const folded = caseFold(reviewer);
    if (review.role === "owner" && folded === caseFold(admission.ownerReviewer)) {
      ownerCount += 1;
    } else if (
      review.role === "second-reviewer" &&
      admission.secondReviewers.some((entry) => caseFold(entry) === folded)
    ) {
      secondCount += 1;
    } else {
      fail(`intake review identity or role is not admitted`);
    }
    const evidence = requireObject(
      objectsById,
      review.evidenceObjectId,
      "attestation",
      `review evidence`,
    );
    claimObject(claims, evidence, fixture.id, `review evidence`);
  }
  assertUnique(reviewers, `intake reviewers`);
  if (ownerCount !== 1 || secondCount < 1) {
    fail(`intake requires owner and second-reviewer adoption`);
  }
}

function validateToolIdentity(value, objectsById, claims, fixtureId, label) {
  const tool = assertRecord(
    value,
    ["authorizationObjectId", "implementationId", "organizationId", "tool", "version"],
    label,
  );
  assertId(tool.implementationId, `${label} implementationId`);
  assertId(tool.organizationId, `${label} organizationId`);
  assertString(tool.tool, `${label} tool`, 128);
  assertString(tool.version, `${label} version`, 128);
  const authorization = requireObject(
    objectsById,
    tool.authorizationObjectId,
    "attestation",
    `${label} authorization`,
  );
  claimObject(claims, authorization, fixtureId, `${label} authorization`);
  return { ...tool, authorization };
}

function validateOracle(
  record,
  descriptor,
  fixture,
  fixtureObject,
  objectsById,
  claims,
  admission,
  finalizedAt,
) {
  const oracle = assertRecord(
    record,
    [
      "$schema",
      "direction",
      "expectedErrorCode",
      "expectedOutcome",
      "fixtureId",
      "fixtureSha256",
      "groundTruthObjectId",
      "groundTruthSchema",
      "id",
      "kind",
      "producer",
      "reviewedAt",
      "reviewer",
      "schemaVersion",
    ],
    `oracle record`,
  );
  if (
    oracle.$schema !== "urn:valle-design:dwg-oracle:1.0.0" ||
    oracle.schemaVersion !== RECORD_SCHEMA_VERSION ||
    oracle.id !== descriptor.id ||
    oracle.fixtureId !== fixture.id ||
    oracle.fixtureSha256 !== fixtureObject.sha256 ||
    !fixture.directions.includes(oracle.direction) ||
    !["independent-reader", "independent-writer", "original-measurement", "owner-ground-truth"].includes(
      oracle.kind,
    ) ||
    !["error", "ok", "unsupported"].includes(oracle.expectedOutcome)
  ) {
    fail(`oracle record is inconsistent with its fixture`);
  }
  if (
    (oracle.expectedOutcome === "ok" && oracle.expectedErrorCode !== null) ||
    (oracle.expectedOutcome !== "ok" &&
      (typeof oracle.expectedErrorCode !== "string" || oracle.expectedErrorCode.length === 0))
  ) {
    fail(`oracle expected outcome is incomplete`);
  }
  assertString(oracle.groundTruthSchema, `oracle ground-truth schema`, 256);
  const groundTruth = requireObject(
    objectsById,
    oracle.groundTruthObjectId,
    "ground-truth",
    `oracle ground truth`,
  );
  claimObject(claims, groundTruth, fixture.id, `oracle ground truth`);
  const producer = validateToolIdentity(
    oracle.producer,
    objectsById,
    claims,
    fixture.id,
    `oracle producer`,
  );
  const reviewer = assertHandle(oracle.reviewer, `oracle reviewer`);
  if (
    ![admission.ownerReviewer, ...admission.secondReviewers].some(
      (entry) => caseFold(entry) === caseFold(reviewer),
    )
  ) {
    fail(`oracle reviewer is not admitted`);
  }
  if (parseDateTime(oracle.reviewedAt, `oracle review date`) > finalizedAt) {
    fail(`oracle review postdates bundle finalization`);
  }
  return oracle;
}

function validateValidation(
  record,
  descriptor,
  fixture,
  fixtureObject,
  oraclesById,
  objectsById,
  claims,
  admission,
  finalizedAt,
) {
  const validation = assertRecord(
    record,
    [
      "$schema",
      "direction",
      "evidenceObjectId",
      "fixtureId",
      "fixtureSha256",
      "id",
      "observedAt",
      "oracleId",
      "result",
      "reviewedAt",
      "reviewer",
      "schemaVersion",
      "validator",
    ],
    `validation record`,
  );
  if (
    validation.$schema !== "urn:valle-design:dwg-validation:1.0.0" ||
    validation.schemaVersion !== RECORD_SCHEMA_VERSION ||
    validation.id !== descriptor.id ||
    validation.fixtureId !== fixture.id ||
    validation.fixtureSha256 !== fixtureObject.sha256 ||
    !fixture.directions.includes(validation.direction) ||
    !oraclesById.has(caseFold(validation.oracleId)) ||
    validation.result !== "accepted"
  ) {
    fail(`validation record is inconsistent with its fixture or oracle`);
  }
  if (oraclesById.get(caseFold(validation.oracleId)).direction !== validation.direction) {
    fail(`validation direction differs from its oracle`);
  }
  const evidence = requireObject(
    objectsById,
    validation.evidenceObjectId,
    "evidence",
    `validation evidence`,
  );
  claimObject(claims, evidence, fixture.id, `validation evidence`);
  const validator = validateToolIdentity(
    validation.validator,
    objectsById,
    claims,
    fixture.id,
    `validator`,
  );
  const observedAt = parseDateTime(validation.observedAt, `validation observation date`);
  const reviewedAt = parseDateTime(validation.reviewedAt, `validation review date`);
  if (observedAt > reviewedAt || reviewedAt > finalizedAt) {
    fail(`validation chronology is invalid`);
  }
  const reviewer = assertHandle(validation.reviewer, `validation reviewer`);
  if (
    ![admission.ownerReviewer, ...admission.secondReviewers].some(
      (entry) => caseFold(entry) === caseFold(reviewer),
    )
  ) {
    fail(`validation reviewer is not admitted`);
  }
  return { evidence, validation, validator };
}

function assertIndependentCoverage(fixture, oracles, validations) {
  for (const direction of fixture.directions) {
    const independentOracles = oracles.filter(
      (oracle) =>
        oracle.direction === direction &&
        caseFold(oracle.producer.organizationId) !== "valle-design",
    );
    if (independentOracles.length === 0) {
      fail(`fixture direction lacks an independent oracle`);
    }
    const independent = validations.filter(
      (entry) =>
        entry.validation.direction === direction &&
        caseFold(entry.validator.organizationId) !== "valle-design",
    );
    const organizations = independent.map((entry) => entry.validator.organizationId);
    const implementations = independent.map((entry) => entry.validator.implementationId);
    const evidenceHashes = independent.map((entry) => entry.evidence.sha256);
    const authorizationHashes = independent.map(
      (entry) => entry.validator.authorization.sha256,
    );
    if (independent.length < 2) fail(`fixture direction requires two independent validations`);
    assertUnique(organizations, `independent validator organizations`);
    assertUnique(implementations, `independent validator implementations`);
    assertUnique(evidenceHashes, `independent validation evidence`, (value) => value);
    assertUnique(
      authorizationHashes,
      `independent validator authorizations`,
      (value) => value,
    );
  }
}

async function listDataFiles(root, relativeRoot, maximumFiles) {
  const absoluteRoot = resolve(root, relativeRoot);
  let rootMetadata;
  try {
    rootMetadata = await lstat(absoluteRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail(`${relativeRoot} is not a regular non-symlink directory`);
  }
  const files = [];
  const pending = [{ absolute: absoluteRoot, relative: "", depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > LIMITS.pathDepth) fail(`${relativeRoot} exceeds directory depth`);
    for (const entry of await readdir(current.absolute, { withFileTypes: true })) {
      const entryPath = resolve(current.absolute, entry.name);
      const relativePath = current.relative === "" ? entry.name : `${current.relative}/${entry.name}`;
      if (entry.isSymbolicLink()) fail(`${relativeRoot} contains a symlink`);
      if (entry.isDirectory()) {
        pending.push({ absolute: entryPath, relative: relativePath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        files.push(`${relativeRoot}/${relativePath}`);
        if (files.length > maximumFiles) fail(`${relativeRoot} exceeds its file budget`);
      } else {
        fail(`${relativeRoot} contains a non-regular entry`);
      }
    }
  }
  return files;
}

async function validateBundle(
  root,
  canonicalRoot,
  entry,
  admission,
  snapshots,
  trustedSnapshots,
  expectedFiles,
  dataDigests,
) {
  expectedFiles.add(entry.manifestPath);
  const manifestResult = await readAndHashFile(
    root,
    canonicalRoot,
    entry.manifestPath,
    entry.manifestByteLength,
    LIMITS.manifestBytes,
    `bundle manifest`,
    true,
  );
  if (manifestResult.sha256 !== entry.manifestSha256) fail(`bundle manifest hash mismatch`);
  dataDigests.set(entry.manifestPath, manifestResult.sha256);
  const manifest = assertRecord(
    parseCanonicalJson(manifestResult.bytes, `bundle manifest`),
    [
      "$schema",
      "createdAt",
      "dwgVersion",
      "factSnapshotSha256",
      "fixtures",
      "id",
      "objects",
      "reviews",
      "schemaVersion",
      "sourceFactIds",
      "status",
    ],
    `bundle manifest`,
  );
  if (
    manifest.$schema !== "../../manifest.schema.json" ||
    manifest.schemaVersion !== INDEX_SCHEMA_VERSION ||
    manifest.id !== entry.id ||
    manifest.status !== "allowed" ||
    !VERSION_CODES.has(manifest.dwgVersion)
  ) {
    fail(`bundle manifest identity, status or version is invalid`);
  }
  const finalizedAt = parseDateTime(manifest.createdAt, `bundle creation date`);
  validateReviewSummaries(manifest.reviews, admission, finalizedAt, `bundle`);
  const snapshotHash = assertSha256(manifest.factSnapshotSha256, `bundle fact snapshot hash`);
  const snapshot = snapshots.get(snapshotHash);
  if (snapshot === undefined || !trustedSnapshots.has(snapshotHash)) {
    fail(`bundle fact snapshot does not resolve through trusted admission`);
  }
  const manifestFacts = validateSourceFactIds(manifest.sourceFactIds, snapshot, `bundle`);

  const objects = assertArray(
    manifest.objects,
    `bundle objects`,
    1,
    LIMITS.objectsPerBundle,
  );
  const objectsById = new Map();
  const hashes = [];
  const paths = [];
  let bundleBytes = 0;
  let structuredBytes = 0;
  for (const [position, objectValue] of objects.entries()) {
    const object = assertRecord(
      objectValue,
      ["byteLength", "id", "kind", "mediaType", "path", "sha256"],
      `bundle object ${position}`,
    );
    const id = assertId(object.id, `bundle object ID`);
    if (!OBJECT_KINDS.has(object.kind)) fail(`bundle object kind is invalid`);
    const sha256 = assertSha256(object.sha256, `bundle object hash`);
    if (object.path !== `objects/sha256/${sha256}`) {
      fail(`bundle object path is not content-addressed`);
    }
    if (
      (object.kind === "fixture" && object.mediaType !== "application/vnd.valle.dwg") ||
      (STRUCTURED_KINDS.has(object.kind) && object.mediaType !== "application/json") ||
      (!["fixture", ...STRUCTURED_KINDS].includes(object.kind) &&
        !["application/json", "application/octet-stream", "application/pdf"].includes(
          object.mediaType,
        ))
    ) {
      fail(`bundle object media type is invalid for its kind`);
    }
    const maximum = STRUCTURED_KINDS.has(object.kind)
      ? LIMITS.recordBytes
      : LIMITS.artifactBytes;
    assertSafeInteger(object.byteLength, 1, maximum, `bundle object byteLength`);
    bundleBytes += object.byteLength;
    if (!Number.isSafeInteger(bundleBytes) || bundleBytes > LIMITS.bundleBytes) {
      fail(`bundle exceeds its aggregate byte budget`);
    }
    if (STRUCTURED_KINDS.has(object.kind)) {
      structuredBytes += object.byteLength;
      if (structuredBytes > LIMITS.structuredBytesPerBundle) {
        fail(`bundle structured records exceed their memory budget`);
      }
    }
    const relativePath = `bundles/${entry.id}/${object.path}`;
    expectedFiles.add(relativePath);
    const result = await readAndHashFile(
      root,
      canonicalRoot,
      relativePath,
      object.byteLength,
      maximum,
      `bundle object`,
      STRUCTURED_KINDS.has(object.kind),
    );
    if (result.sha256 !== sha256) fail(`bundle object hash mismatch`);
    object.bytes = result.bytes;
    dataDigests.set(relativePath, sha256);
    const key = caseFold(id);
    if (objectsById.has(key)) fail(`duplicate bundle object ID`);
    objectsById.set(key, object);
    hashes.push(sha256);
    paths.push(object.path);
  }
  assertUnique(hashes, `bundle object hashes`, (value) => value);
  assertUnique(paths, `bundle object paths`);

  const fixtures = assertArray(
    manifest.fixtures,
    `bundle fixtures`,
    1,
    LIMITS.fixturesPerBundle,
  );
  const fixtureIds = [];
  const claims = new Map();
  for (const [position, fixtureValue] of fixtures.entries()) {
    const fixture = assertRecord(
      fixtureValue,
      [
        "declaredVersion",
        "directions",
        "id",
        "intakeObjectId",
        "objectId",
        "oracleObjectIds",
        "validationObjectIds",
      ],
      `fixture ${position}`,
    );
    fixture.id = assertId(fixture.id, `fixture ID`);
    fixtureIds.push(fixture.id);
    if (fixture.declaredVersion !== manifest.dwgVersion) {
      fail(`fixture declared version differs from its bundle`);
    }
    fixture.directions = assertArray(fixture.directions, `fixture directions`, 1, 2);
    for (const direction of fixture.directions) {
      if (!DIRECTIONS.has(direction)) fail(`fixture direction is invalid`);
    }
    assertUnique(fixture.directions, `fixture directions`, (value) => value);
    const fixtureObject = requireObject(objectsById, fixture.objectId, "fixture", `fixture`);
    claimObject(claims, fixtureObject, fixture.id, `fixture`);
    const intakeObject = requireObject(
      objectsById,
      fixture.intakeObjectId,
      "intake",
      `fixture intake`,
    );
    claimObject(claims, intakeObject, fixture.id, `fixture intake`);
    validateIntake(
      parseCanonicalJson(intakeObject.bytes, `intake record`),
      intakeObject,
      fixture,
      fixtureObject,
      manifestFacts,
      snapshot,
      objectsById,
      claims,
      admission,
      finalizedAt,
    );

    const oracleObjectIds = assertArray(
      fixture.oracleObjectIds,
      `fixture oracleObjectIds`,
      1,
      32,
    );
    for (const id of oracleObjectIds) assertId(id, `oracle object ID`);
    assertUnique(oracleObjectIds, `fixture oracle object IDs`);
    const oracles = oracleObjectIds.map((id) => {
      const descriptor = requireObject(objectsById, id, "oracle", `fixture oracle`);
      claimObject(claims, descriptor, fixture.id, `fixture oracle`);
      return validateOracle(
        parseCanonicalJson(descriptor.bytes, `oracle record`),
        descriptor,
        fixture,
        fixtureObject,
        objectsById,
        claims,
        admission,
        finalizedAt,
      );
    });
    const oraclesById = new Map(
      oracles.map((oracle) => [caseFold(oracle.id), oracle]),
    );

    const validationObjectIds = assertArray(
      fixture.validationObjectIds,
      `fixture validationObjectIds`,
      2,
      64,
    );
    for (const id of validationObjectIds) assertId(id, `validation object ID`);
    assertUnique(validationObjectIds, `fixture validation object IDs`);
    const validations = validationObjectIds.map((id) => {
      const descriptor = requireObject(objectsById, id, "validation", `fixture validation`);
      claimObject(claims, descriptor, fixture.id, `fixture validation`);
      return validateValidation(
        parseCanonicalJson(descriptor.bytes, `validation record`),
        descriptor,
        fixture,
        fixtureObject,
        oraclesById,
        objectsById,
        claims,
        admission,
        finalizedAt,
      );
    });
    assertIndependentCoverage(fixture, oracles, validations);
  }
  assertUnique(fixtureIds, `fixture IDs`);
  if (claims.size !== objectsById.size) fail(`bundle contains an unreferenced object`);

  const actualFiles = await listDataFiles(root, `bundles/${entry.id}`, LIMITS.objectsPerBundle + 1);
  const expectedBundleFiles = new Set(
    [...expectedFiles].filter((path) => path.startsWith(`bundles/${entry.id}/`)),
  );
  if (
    actualFiles.length !== expectedBundleFiles.size ||
    actualFiles.some((path) => !expectedBundleFiles.has(path))
  ) {
    fail(`bundle physical inventory differs from its manifest`);
  }
  return { bundleBytes, fixtureCount: fixtures.length };
}

async function validateTree(root, trustedAdmission) {
  const canonicalRoot = await assertSafeRoot(root, `candidate root`);
  const tracked = await trackedFiles(root);
  const expectedFiles = new Set(STATIC_REPOSITORY_FILES);
  const dataDigests = new Map();
  const indexDocument = await readCanonicalJsonFile(
    root,
    canonicalRoot,
    "index.json",
    LIMITS.indexBytes,
    "index.json",
  );
  const trustedPolicy = validateTrustedAdmission(trustedAdmission);
  const { admission, bundles, index, trustedSnapshots } = validateIndex(
    indexDocument.value,
    trustedPolicy,
  );
  const snapshots = await validateFactSnapshots(
    root,
    canonicalRoot,
    admission.factSnapshots,
    expectedFiles,
    dataDigests,
  );
  let repositoryBytes = 0;
  let fixtureCount = 0;
  for (const entry of bundles) {
    const report = await validateBundle(
      root,
      canonicalRoot,
      entry,
      admission,
      snapshots,
      trustedSnapshots,
      expectedFiles,
      dataDigests,
    );
    repositoryBytes += report.bundleBytes;
    fixtureCount += report.fixtureCount;
    if (repositoryBytes > LIMITS.repositoryBytes) fail(`repository exceeds its byte budget`);
  }

  const snapshotFiles = await listDataFiles(root, "fact-snapshots", 64);
  const expectedSnapshotFiles = new Set(
    [...expectedFiles].filter((path) => path.startsWith("fact-snapshots/")),
  );
  if (
    snapshotFiles.length !== expectedSnapshotFiles.size ||
    snapshotFiles.some((path) => !expectedSnapshotFiles.has(path))
  ) {
    fail(`fact snapshot physical inventory differs from the index`);
  }

  if (tracked.size !== expectedFiles.size) fail(`tracked repository inventory is not exact`);
  for (const expected of expectedFiles) {
    if (tracked.get(caseFold(expected)) !== expected) {
      fail(`tracked repository inventory is not exact`);
    }
  }
  return {
    admission,
    bundles,
    dataDigests,
    fixtureCount,
    index,
    repositoryBytes,
    snapshots,
  };
}

function assertAppendOnly(candidate, baseline) {
  if (parseDate(candidate.index.updatedAt, `candidate updatedAt`) < parseDate(baseline.index.updatedAt, `baseline updatedAt`)) {
    fail(`index updatedAt moved backwards`);
  }
  if (candidate.admission.ownerReviewer !== baseline.admission.ownerReviewer) {
    fail(`owner reviewer changed`);
  }
  const candidateReviewers = new Set(candidate.admission.secondReviewers.map(caseFold));
  for (const reviewer of baseline.admission.secondReviewers) {
    if (!candidateReviewers.has(caseFold(reviewer))) fail(`second reviewer registry is append-only`);
  }
  const candidateSnapshots = new Map(
    candidate.admission.factSnapshots.map((snapshot) => [snapshot.sha256, canonicalJson(snapshot)]),
  );
  for (const snapshot of baseline.admission.factSnapshots) {
    if (candidateSnapshots.get(snapshot.sha256) !== canonicalJson(snapshot)) {
      fail(`fact snapshot registry is append-only`);
    }
  }
  const candidateBundles = new Map(
    candidate.bundles.map((bundle) => [caseFold(bundle.id), canonicalJson(bundle)]),
  );
  for (const bundle of baseline.bundles) {
    if (candidateBundles.get(caseFold(bundle.id)) !== canonicalJson(bundle)) {
      fail(`bundle index is append-only`);
    }
  }
  for (const [path, digest] of baseline.dataDigests) {
    if (candidate.dataDigests.get(path) !== digest) {
      fail(`admitted corpus data is immutable`);
    }
  }
}

async function validateLegacyEmptyBaseline(root) {
  const canonicalRoot = await assertSafeRoot(root, `legacy baseline root`);
  const document = await readCanonicalJsonFile(
    root,
    canonicalRoot,
    "index.json",
    LIMITS.indexBytes,
    "legacy index.json",
  );
  const index = assertRecord(
    document.value,
    ["$schema", "bundles", "schemaVersion", "updatedAt"],
    "legacy index.json",
  );
  if (
    index.$schema !== "./index.schema.json" ||
    index.schemaVersion !== "1.0.0" ||
    !Array.isArray(index.bundles) ||
    index.bundles.length !== 0
  ) {
    fail(`legacy baseline migration is allowed only from the known empty index`);
  }
  parseDate(index.updatedAt, `legacy index updatedAt`);
  const tracked = await trackedFiles(root);
  for (const path of tracked.values()) {
    if (path.startsWith("bundles/") || path.startsWith("fact-snapshots/")) {
      fail(`legacy baseline contains corpus data`);
    }
  }
  return {
    admission: {
      ownerReviewer: OWNER_REVIEWER,
      secondReviewers: [],
      factSnapshots: [],
    },
    bundles: [],
    dataDigests: new Map(),
    fixtureCount: 0,
    index,
    repositoryBytes: 0,
    snapshots: new Map(),
  };
}

export async function validateCorpus({
  root,
  baselineRoot = null,
  trustedAdmission = DEFAULT_TRUSTED_ADMISSION,
}) {
  const candidate = await validateTree(resolve(root), trustedAdmission);
  if (baselineRoot !== null) {
    let baseline;
    try {
      baseline = await validateTree(resolve(baselineRoot), trustedAdmission);
    } catch (error) {
      try {
        baseline = await validateLegacyEmptyBaseline(resolve(baselineRoot));
      } catch {
        throw error;
      }
    }
    assertAppendOnly(candidate, baseline);
  }
  return {
    bundles: candidate.bundles.length,
    bytes: candidate.repositoryBytes,
    fixtures: candidate.fixtureCount,
    status: "ok",
  };
}
