#!/usr/bin/env node
/**
 * Spec del gate del corpus — el ÚNICO verificador que corre desatendido y
 * decide el merge, y hasta esta campaña el único script sin una sola prueba
 * (el productor, que corre bajo supervisión humana, tenía 22).
 *
 * Estrategia: el gate resuelve su raíz desde import.meta.url, así que cada
 * caso COPIA el repositorio real (3,6 MB sin .git) a un directorio temporal,
 * lo muta y ejecuta el gate copiado como proceso hijo. Se prueba el script
 * real, byte a byte, contra árboles reales — no una reimplementación.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// OJO: npm test corre con --test-concurrency=1 a propósito.
// build-manifest.spec crea bundles TRANSITORIOS en el repo real (el
// productor resuelve su raíz solo), y una copia tomada en paralelo los
// capturaría como bundles fantasma.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Copia el repo (sin .git ni node_modules) a un temporal y lo devuelve. */
function copyOfRepo() {
  const target = mkdtempSync(join(tmpdir(), "corpus-gate-"));
  cpSync(repoRoot, target, {
    recursive: true,
    filter: (source) => {
      const name = source.slice(repoRoot.length + 1);
      return name !== ".git" && !name.startsWith(".git/");
    },
  });
  return target;
}

function runGate(root) {
  const result = spawnSync(process.execPath, [join(root, "scripts", "check-corpus.mjs")], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Reescribe el manifiesto de un bundle y re-firma su hash en index.json. */
function patchManifest(root, bundleId, mutate) {
  const manifestPath = join(root, "bundles", bundleId, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const indexPath = join(root, "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const entry = index.bundles.find((candidate) => candidate.id === bundleId);
  entry.manifestSha256 = sha256(manifestPath);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

const BUNDLE = "entity-wave-2-ac1015";

void test("el árbol real admitido pasa entero", () => {
  const root = copyOfRepo();
  try {
    const { status, stdout, stderr } = runGate(root);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /"bundles":7/);
    assert.match(stdout, /"status":"ok"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un byte alterado en un fixture tumba el gate por hash", () => {
  const root = copyOfRepo();
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "bundles", BUNDLE, "manifest.json"), "utf8"),
    );
    const first = manifest.fixtures[0].path;
    const target = join(root, "bundles", BUNDLE, first);
    const bytes = readFileSync(target);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(target, bytes);
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /hash mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un archivo extra no manifestado tumba el gate", () => {
  const root = copyOfRepo();
  try {
    writeFileSync(
      join(root, "bundles", BUNDLE, "fixtures", "colado.txt"),
      "no estoy en el manifiesto",
    );
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /unmanifested file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un archivo manifestado ausente tumba el gate", () => {
  const root = copyOfRepo();
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "bundles", BUNDLE, "manifest.json"), "utf8"),
    );
    rmSync(join(root, "bundles", BUNDLE, manifest.fixtures[0].path));
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    // El primer rojo puede ser el lstat del artefacto o el inventario; ambos
    // son el mismo hecho: falta un archivo prometido.
    assert.match(stderr, /ENOENT|missing a manifest-listed file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un symlink dentro de un bundle tumba el gate", () => {
  const root = copyOfRepo();
  try {
    symlinkSync(
      join(root, "package.json"),
      join(root, "bundles", BUNDLE, "fixtures", "enlace"),
    );
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("bytes DWG fuera de bundles tumban el gate", () => {
  const root = copyOfRepo();
  try {
    writeFileSync(join(root, "docs", "fugado.dwg"), "AC1015");
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /outside an admitted bundle/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un directorio físico sin entrada en el índice tumba el gate", () => {
  const root = copyOfRepo();
  try {
    cpSync(join(root, "bundles", BUNDLE), join(root, "bundles", "fantasma"), {
      recursive: true,
    });
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /unmanifested physical bundle/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un fixture con MAYÚSCULAS legales pasa si está manifestado", () => {
  // El productor y el esquema permiten [A-Za-z…] en las rutas; el gate llegó
  // a comparar el inventario contra rutas case-folded y un nombre con
  // mayúsculas moría con DOS mensajes falsos. Regresión de esa corrección.
  const root = copyOfRepo();
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "bundles", BUNDLE, "manifest.json"), "utf8"),
    );
    const oldPath = manifest.fixtures[0].path;
    const newPath = oldPath.replace(/([^/]+)$/u, (name) =>
      name.replace(/[a-z]/u, (c) => c.toUpperCase()),
    );
    assert.notEqual(oldPath, newPath, "el caso exige un rename real");
    renameSync(
      join(root, "bundles", BUNDLE, oldPath),
      join(root, "bundles", BUNDLE, newPath),
    );
    patchManifest(root, BUNDLE, (m) => {
      m.fixtures[0].path = newPath;
    });
    const { status, stderr } = runGate(root);
    assert.equal(status, 0, stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un campo inventado en el manifiesto tumba el gate", () => {
  const root = copyOfRepo();
  try {
    patchManifest(root, BUNDLE, (m) => {
      m.campoInventado = "additionalProperties:false era decorativo";
    });
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /unexpected key/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("un manifiesto sin rights.attestationRef tumba el gate", () => {
  const root = copyOfRepo();
  try {
    patchManifest(root, BUNDLE, (m) => {
      delete m.rights.attestationRef;
    });
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /rights/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("dos validaciones del MISMO oráculo (versiones distintas) no cuentan como dos", () => {
  const root = copyOfRepo();
  try {
    patchManifest(root, BUNDLE, (m) => {
      m.validations[1].validator = m.validations[0].validator;
      m.validations[1].version = "999.0";
    });
    const { status, stderr } = runGate(root);
    assert.notEqual(status, 0);
    assert.match(stderr, /independent validators/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
