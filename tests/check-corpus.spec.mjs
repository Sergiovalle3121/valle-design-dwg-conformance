import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  LIMITS,
  STATIC_REPOSITORY_FILES,
  validateCorpus,
} from "../scripts/corpus-gate.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownerReviewer = "@Sergiovalle3121";
const secondReviewer = "@SecondReviewer";
const bundleId = "bundle-adversarial-test";
const factId = "VALLE-TEST-CONFORMANCE";

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function git(root, ...arguments_) {
  await execFileAsync("git", ["-C", root, ...arguments_]);
}

async function writeCanonical(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(value), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function createRepository(parent, name = "candidate") {
  const root = resolve(parent, name);
  await mkdir(root, { recursive: true });
  for (const relativePath of STATIC_REPOSITORY_FILES) {
    const target = resolve(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(repositoryRoot, relativePath), target);
  }
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Corpus Gate Test");
  await git(root, "config", "user.email", "corpus-gate@example.invalid");
  await git(root, "add", "-A");
  return root;
}

async function commitAll(root, message = "test baseline") {
  await git(root, "add", "-A");
  await git(root, "commit", "-m", message);
}

async function withTemporaryRoot(label, callback) {
  const root = await mkdtemp(resolve(tmpdir(), `valle-${label}-`));
  try {
    await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function addObject(root, objects, id, kind, content, mediaType) {
  const bytes = Buffer.isBuffer(content)
    ? content
    : Buffer.from(canonicalJson(content), "utf8");
  const sha256 = hash(bytes);
  const relativePath = `objects/sha256/${sha256}`;
  await mkdir(resolve(root, "bundles", bundleId, "objects", "sha256"), {
    recursive: true,
  });
  await writeFile(resolve(root, "bundles", bundleId, relativePath), bytes);
  const descriptor = {
    id,
    kind,
    path: relativePath,
    sha256,
    byteLength: bytes.byteLength,
    mediaType,
  };
  objects.push(descriptor);
  return descriptor;
}

function toolIdentity(prefix, authorizationObjectId) {
  return {
    implementationId: `${prefix}-implementation`,
    organizationId: `${prefix}-organization`,
    tool: `${prefix} authorized validator`,
    version: "1.0.0",
    authorizationObjectId,
  };
}

async function buildValidBundle(root) {
  const snapshot = {
    $schema: "./fact-register.schema.json",
    schemaVersion: "1.0.0",
    updatedAt: "2026-08-09",
    facts: [
      {
        id: factId,
        kind: "conformance",
        status: "allowed",
        derivableContentRecorded: true,
        humanReview: { decision: "approved" },
      },
    ],
  };
  const snapshotBytes = Buffer.from(canonicalJson(snapshot), "utf8");
  const snapshotSha256 = hash(snapshotBytes);
  const snapshotPath = `fact-snapshots/sha256/${snapshotSha256}`;
  await mkdir(dirname(resolve(root, snapshotPath)), { recursive: true });
  await writeFile(resolve(root, snapshotPath), snapshotBytes);

  const objects = [];
  const fixtureObject = await addObject(
    root,
    objects,
    "fixture-object",
    "fixture",
    Buffer.from("VALLE SYNTHETIC GATE TEST; NOT A DWG\n", "utf8"),
    "application/vnd.valle.dwg",
  );
  const rightsEvidence = await addObject(
    root,
    objects,
    "rights-attestation",
    "attestation",
    Buffer.from("test rights attestation\n", "utf8"),
    "application/octet-stream",
  );
  const privacyEvidence = await addObject(
    root,
    objects,
    "privacy-attestation",
    "attestation",
    Buffer.from("test privacy attestation\n", "utf8"),
    "application/octet-stream",
  );
  const ownerReviewEvidence = await addObject(
    root,
    objects,
    "owner-review-attestation",
    "attestation",
    Buffer.from("test owner review attestation\n", "utf8"),
    "application/octet-stream",
  );
  const secondReviewEvidence = await addObject(
    root,
    objects,
    "second-review-attestation",
    "attestation",
    Buffer.from("test second review attestation\n", "utf8"),
    "application/octet-stream",
  );
  const oracleAuthorization = await addObject(
    root,
    objects,
    "oracle-authorization",
    "attestation",
    Buffer.from("test oracle authorization\n", "utf8"),
    "application/octet-stream",
  );
  const validatorOneAuthorization = await addObject(
    root,
    objects,
    "validator-one-authorization",
    "attestation",
    Buffer.from("test validator one authorization\n", "utf8"),
    "application/octet-stream",
  );
  const validatorTwoAuthorization = await addObject(
    root,
    objects,
    "validator-two-authorization",
    "attestation",
    Buffer.from("test validator two authorization\n", "utf8"),
    "application/octet-stream",
  );
  const groundTruth = await addObject(
    root,
    objects,
    "ground-truth-object",
    "ground-truth",
    { expected: "synthetic-gate-test", fixtureSha256: fixtureObject.sha256 },
    "application/json",
  );

  const intakeRecord = {
    $schema: "urn:valle-design:dwg-intake:1.0.0",
    schemaVersion: "1.0.0",
    id: "intake-record",
    fixtureId: "fixture-record",
    fixtureSha256: fixtureObject.sha256,
    fixtureByteLength: fixtureObject.byteLength,
    submittedAt: "2026-08-09T08:00:00Z",
    origin: {
      kind: "sergio-original",
      owner: "Sergio Valle Zárate",
      createdAt: "2026-08-08",
      tool: "Valle synthetic gate test",
      toolVersion: "1.0.0",
      sourceFactIds: [factId],
    },
    rights: {
      decision: "approved",
      licenseId: "Valle-Owner-Authorized",
      useAllowed: true,
      modifyAllowed: true,
      redistributionScope: "private-conformance-only",
      evidenceObjectId: rightsEvidence.id,
    },
    privacy: {
      decision: "approved",
      containsClientData: false,
      containsPersonalData: false,
      containsSecrets: false,
      containsConfidentialData: false,
      evidenceObjectId: privacyEvidence.id,
    },
    reviews: [
      {
        reviewer: ownerReviewer,
        role: "owner",
        decision: "approved",
        reviewedAt: "2026-08-09T09:00:00Z",
        evidenceObjectId: ownerReviewEvidence.id,
      },
      {
        reviewer: secondReviewer,
        role: "second-reviewer",
        decision: "approved",
        reviewedAt: "2026-08-09T09:30:00Z",
        evidenceObjectId: secondReviewEvidence.id,
      },
    ],
  };
  const intakeObject = await addObject(
    root,
    objects,
    intakeRecord.id,
    "intake",
    intakeRecord,
    "application/json",
  );

  const oracleRecord = {
    $schema: "urn:valle-design:dwg-oracle:1.0.0",
    schemaVersion: "1.0.0",
    id: "oracle-record",
    fixtureId: "fixture-record",
    fixtureSha256: fixtureObject.sha256,
    direction: "read",
    kind: "independent-reader",
    expectedOutcome: "ok",
    expectedErrorCode: null,
    groundTruthObjectId: groundTruth.id,
    groundTruthSchema: "urn:valle-design:test-ground-truth:1",
    producer: toolIdentity("oracle-engine", oracleAuthorization.id),
    reviewer: ownerReviewer,
    reviewedAt: "2026-08-09T10:00:00Z",
  };
  const oracleObject = await addObject(
    root,
    objects,
    oracleRecord.id,
    "oracle",
    oracleRecord,
    "application/json",
  );

  const evidenceOne = await addObject(
    root,
    objects,
    "validation-one-evidence",
    "evidence",
    { accepted: true, producer: "independent-one" },
    "application/json",
  );
  const evidenceTwo = await addObject(
    root,
    objects,
    "validation-two-evidence",
    "evidence",
    { accepted: true, producer: "independent-two" },
    "application/json",
  );
  const validationOneRecord = {
    $schema: "urn:valle-design:dwg-validation:1.0.0",
    schemaVersion: "1.0.0",
    id: "validation-one-record",
    fixtureId: "fixture-record",
    fixtureSha256: fixtureObject.sha256,
    direction: "read",
    oracleId: oracleRecord.id,
    result: "accepted",
    evidenceObjectId: evidenceOne.id,
    validator: toolIdentity("independent-one", validatorOneAuthorization.id),
    observedAt: "2026-08-09T10:15:00Z",
    reviewer: secondReviewer,
    reviewedAt: "2026-08-09T11:00:00Z",
  };
  const validationTwoRecord = {
    ...validationOneRecord,
    id: "validation-two-record",
    evidenceObjectId: evidenceTwo.id,
    validator: toolIdentity("independent-two", validatorTwoAuthorization.id),
    observedAt: "2026-08-09T10:30:00Z",
  };
  const validationOneObject = await addObject(
    root,
    objects,
    validationOneRecord.id,
    "validation",
    validationOneRecord,
    "application/json",
  );
  const validationTwoObject = await addObject(
    root,
    objects,
    validationTwoRecord.id,
    "validation",
    validationTwoRecord,
    "application/json",
  );

  const manifest = {
    $schema: "../../manifest.schema.json",
    schemaVersion: "2.0.0",
    id: bundleId,
    createdAt: "2026-08-09T12:00:00Z",
    status: "allowed",
    dwgVersion: "AC1015",
    factSnapshotSha256: snapshotSha256,
    sourceFactIds: [factId],
    objects,
    fixtures: [
      {
        id: "fixture-record",
        objectId: fixtureObject.id,
        intakeObjectId: intakeObject.id,
        oracleObjectIds: [oracleObject.id],
        validationObjectIds: [validationOneObject.id, validationTwoObject.id],
        directions: ["read"],
        declaredVersion: "AC1015",
      },
    ],
    reviews: [
      {
        reviewer: ownerReviewer,
        role: "owner",
        decision: "approved",
        reviewedAt: "2026-08-09T11:30:00Z",
      },
      {
        reviewer: secondReviewer,
        role: "second-reviewer",
        decision: "approved",
        reviewedAt: "2026-08-09T11:45:00Z",
      },
    ],
  };
  const manifestPath = resolve(root, "bundles", bundleId, "manifest.json");
  await writeCanonical(manifestPath, manifest);
  const manifestBytes = await readFile(manifestPath);
  const factSnapshotDescriptor = {
    repository: "Sergiovalle3121/valle-design",
    commit: "1".repeat(40),
    sourcePath: "packages/dwg-codec/FACT_REGISTER.json",
    objectPath: snapshotPath,
    sha256: snapshotSha256,
    byteLength: snapshotBytes.byteLength,
  };
  const index = {
    $schema: "./index.schema.json",
    schemaVersion: "2.0.0",
    updatedAt: "2026-08-09",
    admission: {
      ownerReviewer,
      secondReviewers: [secondReviewer],
      factSnapshots: [factSnapshotDescriptor],
    },
    bundles: [
      {
        id: bundleId,
        manifestPath: `bundles/${bundleId}/manifest.json`,
        manifestSha256: hash(manifestBytes),
        manifestByteLength: manifestBytes.byteLength,
      },
    ],
  };
  await writeCanonical(resolve(root, "index.json"), index);
  await git(root, "add", "-A");
  return {
    manifest,
    objects,
    trustedAdmission: {
      secondReviewers: [secondReviewer],
      factSnapshots: [factSnapshotDescriptor],
    },
  };
}

async function refreshManifestAndIndex(root, manifest) {
  const manifestPath = resolve(root, "bundles", bundleId, "manifest.json");
  await writeCanonical(manifestPath, manifest);
  const manifestBytes = await readFile(manifestPath);
  const indexPath = resolve(root, "index.json");
  const index = await readJson(indexPath);
  const entry = index.bundles.find((candidate) => candidate.id === bundleId);
  entry.manifestSha256 = hash(manifestBytes);
  entry.manifestByteLength = manifestBytes.byteLength;
  await writeCanonical(indexPath, index);
  await git(root, "add", "-A");
}

async function replaceStructuredObject(root, manifest, objectId, mutate) {
  const descriptor = manifest.objects.find((object) => object.id === objectId);
  const oldPath = resolve(root, "bundles", bundleId, descriptor.path);
  const record = await readJson(oldPath);
  mutate(record);
  const bytes = Buffer.from(canonicalJson(record), "utf8");
  const sha256 = hash(bytes);
  const newRelativePath = `objects/sha256/${sha256}`;
  await rm(oldPath);
  await writeFile(resolve(root, "bundles", bundleId, newRelativePath), bytes);
  descriptor.path = newRelativePath;
  descriptor.sha256 = sha256;
  descriptor.byteLength = bytes.byteLength;
  await refreshManifestAndIndex(root, manifest);
}

test("empty locked corpus is valid", async () => {
  await withTemporaryRoot("empty", async (parent) => {
    const root = await createRepository(parent);
    const report = await validateCorpus({ root });
    assert.deepEqual(report, { bundles: 0, bytes: 0, fixtures: 0, status: "ok" });
  });
});

test("non-empty corpus is rejected until reviewer and fact snapshot admission", async () => {
  await withTemporaryRoot("locked", async (parent) => {
    const root = await createRepository(parent);
    const indexPath = resolve(root, "index.json");
    const index = await readJson(indexPath);
    index.bundles.push({
      id: bundleId,
      manifestPath: `bundles/${bundleId}/manifest.json`,
      manifestSha256: "0".repeat(64),
      manifestByteLength: 1,
    });
    await writeCanonical(indexPath, index);
    await git(root, "add", "-A");
    await assert.rejects(validateCorpus({ root }), /corpus is locked/);
  });
});

test("fully linked content-addressed synthetic metadata passes", async () => {
  await withTemporaryRoot("valid", async (parent) => {
    const root = await createRepository(parent);
    const { trustedAdmission } = await buildValidBundle(root);
    const report = await validateCorpus({ root, trustedAdmission });
    assert.equal(report.bundles, 1);
    assert.equal(report.fixtures, 1);
    assert.ok(report.bytes > 0);
  });
});

test("candidate metadata cannot self-register a reviewer or fact snapshot", async () => {
  await withTemporaryRoot("self-admission", async (parent) => {
    const root = await createRepository(parent);
    await buildValidBundle(root);
    await assert.rejects(validateCorpus({ root }), /outside the trusted policy/);
  });
});

test("an empty candidate cannot pre-register an untrusted reviewer", async () => {
  await withTemporaryRoot("empty-self-admission", async (parent) => {
    const root = await createRepository(parent);
    const indexPath = resolve(root, "index.json");
    const index = await readJson(indexPath);
    index.admission.secondReviewers.push(secondReviewer);
    await writeCanonical(indexPath, index);
    await git(root, "add", "-A");
    await assert.rejects(validateCorpus({ root }), /outside the trusted policy/);
  });
});

test("strict manifest rejects additional properties even with a refreshed hash", async () => {
  await withTemporaryRoot("strict", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    manifest.unreviewedMetadata = "forbidden";
    await refreshManifestAndIndex(root, manifest);
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /missing or additional properties/,
    );
  });
});

test("intake cannot omit a privacy decision field after rehashing", async () => {
  await withTemporaryRoot("privacy", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    await replaceStructuredObject(root, manifest, "intake-record", (record) => {
      delete record.privacy.containsSecrets;
    });
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /intake privacy has missing or additional properties/,
    );
  });
});

test("reviewer identities are unique under case folding", async () => {
  await withTemporaryRoot("reviewers", async (parent) => {
    const root = await createRepository(parent);
    const indexPath = resolve(root, "index.json");
    const index = await readJson(indexPath);
    index.admission.secondReviewers = [secondReviewer, "@secondreviewer"];
    await writeCanonical(indexPath, index);
    await git(root, "add", "-A");
    await assert.rejects(validateCorpus({ root }), /second reviewers contains a duplicate/);
  });
});

test("same validator organization under another version is not independent", async () => {
  await withTemporaryRoot("independence", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    await replaceStructuredObject(root, manifest, "validation-two-record", (record) => {
      record.validator.organizationId = "independent-one-organization";
      record.validator.version = "2.0.0";
    });
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /organizations contains a duplicate/,
    );
  });
});

test("validation evidence must resolve to a physical typed object", async () => {
  await withTemporaryRoot("evidence", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    await replaceStructuredObject(root, manifest, "validation-two-record", (record) => {
      record.evidenceObjectId = "missing-evidence";
    });
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /does not resolve to a evidence object/,
    );
  });
});

test("object paths must encode their exact content hash", async () => {
  await withTemporaryRoot("content-address", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    manifest.objects[0].path = `objects/sha256/${"0".repeat(64)}`;
    await refreshManifestAndIndex(root, manifest);
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /path is not content-addressed/,
    );
  });
});

test("tracked bytes outside the exact repository inventory are rejected", async () => {
  await withTemporaryRoot("inventory", async (parent) => {
    const root = await createRepository(parent);
    await writeFile(resolve(root, "renamed-corpus.bin"), Buffer.from("hidden bytes"));
    await git(root, "add", "-A");
    await assert.rejects(validateCorpus({ root }), /tracked repository inventory is not exact/);
  });
});

test("force-added quarantine paths do not bypass tracked inventory", async () => {
  await withTemporaryRoot("quarantine", async (parent) => {
    const root = await createRepository(parent);
    const path = resolve(root, "incoming", "forced.dwg");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from("not admitted"));
    await git(root, "add", "-f", "incoming/forced.dwg");
    await assert.rejects(validateCorpus({ root }), /tracked repository inventory is not exact/);
  });
});

test("source facts resolve against the fixed physical snapshot", async () => {
  await withTemporaryRoot("facts", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    manifest.sourceFactIds = ["VALLE-UNKNOWN-CONFORMANCE"];
    await refreshManifestAndIndex(root, manifest);
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /fact not allowed by the fixed snapshot/,
    );
  });
});

test("aggregate object limits are checked before opening oversized content", async () => {
  await withTemporaryRoot("limits", async (parent) => {
    const root = await createRepository(parent);
    const { manifest, trustedAdmission } = await buildValidBundle(root);
    manifest.objects[0].byteLength = LIMITS.artifactBytes + 1;
    await refreshManifestAndIndex(root, manifest);
    await assert.rejects(
      validateCorpus({ root, trustedAdmission }),
      /outside its integer budget/,
    );
  });
});

test("append-only comparison rejects deletion of an admitted bundle", async () => {
  await withTemporaryRoot("append-only", async (parent) => {
    const baseline = await createRepository(parent, "baseline");
    const { trustedAdmission } = await buildValidBundle(baseline);
    await commitAll(baseline);
    const candidate = resolve(parent, "candidate");
    await execFileAsync("git", ["clone", "--quiet", baseline, candidate]);
    const indexPath = resolve(candidate, "index.json");
    const index = await readJson(indexPath);
    index.bundles = [];
    await writeCanonical(indexPath, index);
    await rm(resolve(candidate, "bundles"), { force: true, recursive: true });
    await git(candidate, "add", "-A");
    const standalone = await validateCorpus({ root: candidate, trustedAdmission });
    assert.equal(standalone.bundles, 0);
    await assert.rejects(
      validateCorpus({ root: candidate, baselineRoot: baseline, trustedAdmission }),
      /bundle index is append-only/,
    );
  });
});

test("one-way bootstrap accepts only the known legacy empty baseline", async () => {
  await withTemporaryRoot("legacy", async (parent) => {
    const candidate = await createRepository(parent, "candidate");
    const baseline = resolve(parent, "legacy-baseline");
    await mkdir(baseline, { recursive: true });
    await execFileAsync("git", ["-C", baseline, "init", "-b", "main"]);
    await writeCanonical(resolve(baseline, "index.json"), {
      $schema: "./index.schema.json",
      schemaVersion: "1.0.0",
      updatedAt: "2026-08-09",
      bundles: [],
    });
    await git(baseline, "add", "index.json");
    const report = await validateCorpus({ root: candidate, baselineRoot: baseline });
    assert.equal(report.bundles, 0);
  });
});
