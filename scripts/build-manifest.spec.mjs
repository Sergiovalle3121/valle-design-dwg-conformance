#!/usr/bin/env node

// El productor de manifiestos es un gate legal: decide qué material entra al
// corpus con derechos declarados. Un gate sin pruebas es peor que no tenerlo,
// porque da la sensación de estar protegido. Este spec fija los rechazos que
// importan, uno por uno, para que nadie los relaje sin que salte algo.
//
// Cada caso comprueba el MENSAJE, no sólo el código de salida: quien se topa
// con el rechazo a las once de la noche necesita saber qué le falta, no que
// «falló». Un error opaco se acaba saltando.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builder = resolve(root, "scripts/build-manifest.mjs");

// Los bundles de prueba viven bajo un prefijo reservado y se borran siempre.
// El .gitignore los excluye: un repositorio que custodia derechos no puede
// acabar con basura de tests indistinguible de material admitido.
const PREFIX = "spec-tmp";
let counter = 0;

function baseDeclaration() {
  return {
    updatedAt: "2026-08-19",
    dwgVersion: "AC1015",
    rights: {
      origin: "sergio-original",
      owner: "Titular de prueba",
      tool: "AutoCAD",
      toolVersion: "2026",
      outputRights: "Dibujo original del titular; derechos plenos sobre el output.",
      redistribution: "Redistribucion limitada a este repositorio privado.",
      attestationRef: "private-attestation:spec-0001",
      containsClientData: false,
    },
    sourceFactIds: ["FACT.SPEC.0001"],
    validations: [
      {
        validator: "oraculo-a",
        version: "1.0",
        result: "accepted",
        evidenceSha256: "1".repeat(64),
      },
      {
        validator: "oraculo-b",
        version: "1.0",
        result: "accepted",
        evidenceSha256: "2".repeat(64),
      },
    ],
    reviews: ["@titular", "@segundo-revisor"],
  };
}

// Prepara un bundle completo y devuelve su id junto con la función de limpieza.
// El contenido de los artefactos es texto cualquiera a propósito: el productor
// nunca interpreta el interior de un archivo, sólo lo hashea y lo mide.
async function withBundle(mutate) {
  counter += 1;
  const id = `${PREFIX}-${counter}`;
  const bundleRoot = resolve(root, "bundles", id);
  const declarationPath = resolve(root, "incoming", `${id}.declaration.json`);

  await mkdir(resolve(bundleRoot, "fixtures"), { recursive: true });
  await mkdir(resolve(bundleRoot, "oracles"), { recursive: true });
  await mkdir(resolve(root, "incoming"), { recursive: true });
  await writeFile(resolve(bundleRoot, "fixtures/muestra.dwg"), "bytes de prueba\n");
  await writeFile(resolve(bundleRoot, "oracles/lectura.json"), "{}\n");

  const declaration = baseDeclaration();
  mutate?.(declaration);
  await writeFile(declarationPath, `${JSON.stringify(declaration, null, 2)}\n`);

  return {
    id,
    cleanup: async () => {
      await rm(bundleRoot, { recursive: true, force: true });
      await rm(declarationPath, { force: true });
    },
  };
}

async function build(id) {
  try {
    const { stdout } = await run(process.execPath, [builder, "--bundle", id]);
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

// El caso feliz. Sin él, los rechazos podrían estar pasando por la razón
// equivocada y el spec entero mediría humo.
test("una declaración completa produce un manifiesto en ensayo sin escribir nada", async () => {
  const { id, cleanup } = await withBundle();
  try {
    const result = await build(id);
    assert.equal(result.ok, true, result.stderr);
    const manifest = JSON.parse(result.stdout.slice(0, result.stdout.indexOf("\n---")));
    assert.equal(manifest.status, "allowed");
    assert.equal(manifest.id, id);
    assert.equal(manifest.rights.containsClientData, false);
    assert.equal(manifest.fixtures.length, 1);
    assert.equal(manifest.oracles.length, 1);
    assert.match(manifest.fixtures[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(manifest.fixtures[0].byteLength, 16);
    assert.match(result.stdout, /no se escribió nada/);
  } finally {
    await cleanup();
  }
});

const rechazos = [
  {
    nombre: "un solo revisor no basta: la política exige titular y segundo revisor",
    mutate: (d) => {
      d.reviews = ["@titular"];
    },
    esperado: /DOS revisores humanos/,
  },
  {
    nombre: "el titular no puede contarse dos veces como si fuera el segundo revisor",
    mutate: (d) => {
      d.reviews = ["@titular", "@TITULAR"];
    },
    esperado: /revisores repetidos/,
  },
  {
    nombre: "un dibujo con datos de cliente no entra jamás",
    mutate: (d) => {
      d.rights.containsClientData = true;
    },
    esperado: /containsClientData debe ser el literal `false`/,
  },
  {
    nombre: "un `null` en containsClientData significa que nadie lo revisó",
    mutate: (d) => {
      d.rights.containsClientData = null;
    },
    esperado: /containsClientData debe ser el literal `false`/,
  },
  {
    nombre: "dos validaciones del mismo oráculo no son dos validaciones independientes",
    mutate: (d) => {
      d.validations[1].validator = "oraculo-a";
    },
    esperado: /del mismo oráculo/,
  },
  {
    nombre: "una validación en contra bloquea la promoción",
    mutate: (d) => {
      d.validations[1].result = "rejected";
    },
    esperado: /no es `accepted`/,
  },
  {
    nombre: "una sola validación no llega al mínimo de dos",
    mutate: (d) => {
      d.validations = [d.validations[0]];
    },
    esperado: /al menos DOS validaciones independientes/,
  },
  {
    nombre: "sin referencia privada del acuerdo no hay derechos que verificar",
    mutate: (d) => {
      delete d.rights.attestationRef;
    },
    esperado: /rights\.attestationRef/,
  },
  {
    nombre: "una referencia de acuerdo con formato libre no vale",
    mutate: (d) => {
      d.rights.attestationRef = "acuerdo verbal";
    },
    esperado: /rights\.attestationRef no encaja/,
  },
  {
    nombre: "un origen fuera de los tres admisibles se rechaza",
    mutate: (d) => {
      d.rights.origin = "encontrado-por-ahi";
    },
    esperado: /rights\.origin debe ser uno de/,
  },
  {
    nombre: "una versión de DWG inventada se rechaza",
    mutate: (d) => {
      d.dwgVersion = "AC9999";
    },
    esperado: /dwgVersion debe ser uno de/,
  },
  {
    nombre: "sin sourceFactIds no se puede trazar de dónde salió el material",
    mutate: (d) => {
      d.sourceFactIds = [];
    },
    esperado: /al menos un sourceFactIds/,
  },
];

for (const caso of rechazos) {
  test(`rechazo — ${caso.nombre}`, async () => {
    const { id, cleanup } = await withBundle(caso.mutate);
    try {
      const result = await build(id);
      assert.equal(result.ok, false, "el productor debía fallar y no falló");
      assert.match(result.stderr, caso.esperado);
    } finally {
      await cleanup();
    }
  });
}

test("sin declaración fuera de Git no se produce nada, y el mensaje dice dónde va", async () => {
  const { id, cleanup } = await withBundle();
  try {
    await rm(resolve(root, "incoming", `${id}.declaration.json`), { force: true });
    const result = await build(id);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /incoming\//);
    assert.match(result.stderr, /nunca entra a Git/);
  } finally {
    await cleanup();
  }
});

test("un bundle sin oráculo independiente no se puede admitir", async () => {
  const { id, cleanup } = await withBundle();
  try {
    await rm(resolve(root, "bundles", id, "oracles"), { recursive: true, force: true });
    const result = await build(id);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /oracles/);
  } finally {
    await cleanup();
  }
});

// El id del bundle entra en una ruta. Sin esta comprobación, un id con `..`
// escribiría el manifiesto fuera de bundles/, que es justo lo que el
// verificador se dedica a impedir en el otro sentido.
test("un id que intenta escapar de bundles/ se rechaza antes de tocar el disco", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "valle-dwg-spec-"));
  try {
    const result = await build("../../escape");
    assert.equal(result.ok, false);
    assert.match(result.stderr, /--bundle <id> válido/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
