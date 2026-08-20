#!/usr/bin/env node

// Productor de manifiestos. El repositorio ya tenía el verificador
// (`check-corpus.mjs`), pero no tenía con qué PRODUCIR lo que ese verificador
// exige: un manifiesto con SHA-256 de 64 caracteres por artefacto. Escribirlos
// a mano no es sólo tedioso, es el camino por el que un gate legal termina
// saltándose «sólo esta vez» por hartazgo. Este script quita esa excusa.
//
// Qué NO hace, y es deliberado: no abre, no parsea y no interpreta el interior
// de ningún dibujo. Sólo lee bytes para hashearlos y medirlos. La política de
// cuarentena prohíbe la inspección técnica, y el trabajo del codec es
// clean-room: un productor que mirase dentro contaminaría ambas cosas a la vez.
//
// Sin dependencias externas, igual que el verificador. Un repositorio que
// custodia derechos no debería arrastrar una cadena de suministro que su dueño
// no controla.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlesRoot = resolve(root, "bundles");
const incomingRoot = resolve(root, "incoming");

const BUNDLE_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const FACT_ID = /^[A-Z0-9][A-Z0-9._:-]{0,127}$/;
const HANDLE = /^@[A-Za-z0-9-]{1,39}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ARTIFACT_PATH = /^(fixtures|oracles)\/[A-Za-z0-9._/-]+$/;
const ATTESTATION = /^private-attestation:[A-Za-z0-9._:-]{1,128}$/;
const DWG_VERSIONS = [
  "AC1009",
  "AC1012",
  "AC1014",
  "AC1015",
  "AC1018",
  "AC1021",
  "AC1024",
  "AC1027",
  "AC1032",
];
const ORIGINS = ["sergio-original", "donated-original", "licensed-third-party"];
const MAX_ARTIFACT_BYTES = 536870912;

// Fallo cerrado: ante cualquier ambigüedad se aborta con un error tipado. Un
// manifiesto a medias que «parece correcto» es peor que no tenerlo, porque
// pasaría el gate llevándose por delante la razón de que el gate exista.
function fail(message) {
  throw new Error(`DWG manifest builder: ${message}`);
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

async function sha256OfFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    highWaterMark: 1024 * 1024,
  })) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function sha256OfText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Recorre un directorio de artefactos y devuelve sus entradas ya hasheadas.
// Rechaza enlaces simbólicos porque un symlink permite que el manifiesto
// declare un hash de un archivo que vive fuera del bundle, y el bundle debe ser
// autocontenido e inmutable.
async function collectArtifacts(bundleRoot, kind) {
  const kindRoot = resolve(bundleRoot, kind);
  const artifacts = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail(`falta el directorio ${kind}/ en el bundle`);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = resolve(directory, entry.name);
      if (!inside(kindRoot, absolute)) {
        fail(`${entry.name} escapa de ${kind}/`);
      }
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        fail(`${entry.name} es un enlace simbólico; el bundle debe ser autocontenido`);
      }
      if (info.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!info.isFile()) {
        fail(`${entry.name} no es un archivo regular`);
      }
      if (info.size < 1) {
        fail(`${entry.name} está vacío`);
      }
      if (info.size > MAX_ARTIFACT_BYTES) {
        fail(`${entry.name} supera el máximo de ${MAX_ARTIFACT_BYTES} bytes`);
      }

      const portable = relative(bundleRoot, absolute).split(sep).join("/");
      if (!ARTIFACT_PATH.test(portable)) {
        fail(`la ruta ${portable} no encaja con el patrón exigido por el esquema`);
      }
      // El id se deriva de la ruta para que dos artefactos nunca compartan id
      // por descuido: el esquema no lo exige, pero un id duplicado haría que la
      // evidencia apuntase al archivo equivocado.
      const id = portable
        .slice(kind.length + 1)
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "-")
        .replace(/^-+/, "");
      if (!BUNDLE_ID.test(id)) {
        fail(`no se pudo derivar un id válido de ${portable}`);
      }

      artifacts.push({
        id,
        path: portable,
        sha256: await sha256OfFile(absolute),
        byteLength: info.size,
      });
    }
  }

  await walk(kindRoot);
  if (artifacts.length < 1) {
    fail(`${kind}/ no contiene ningún artefacto`);
  }
  const ids = new Set(artifacts.map((a) => a.id));
  if (ids.size !== artifacts.length) {
    fail(`${kind}/ produce ids duplicados`);
  }
  return artifacts;
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || value.length < 1) {
    fail(`la declaración no trae ${label}`);
  }
  if (pattern && !pattern.test(value)) {
    fail(`${label} no encaja con el formato exigido: ${value}`);
  }
  return value;
}

function validateRights(rights) {
  if (!rights || typeof rights !== "object") {
    fail("la declaración no trae el bloque `rights`");
  }
  if (!ORIGINS.includes(rights.origin)) {
    fail(`rights.origin debe ser uno de ${ORIGINS.join(", ")}`);
  }
  // `containsClientData` se compara contra `false` literal, nunca contra un
  // valor falsy. Un `0`, un `""` o un `null` significan «nadie lo revisó», y
  // eso es exactamente lo que la política prohíbe dar por bueno.
  if (rights.containsClientData !== false) {
    fail(
      "rights.containsClientData debe ser el literal `false`, declarado tras la revisión humana",
    );
  }
  return {
    origin: rights.origin,
    owner: requireString(rights.owner, "rights.owner"),
    tool: requireString(rights.tool, "rights.tool"),
    toolVersion: requireString(rights.toolVersion, "rights.toolVersion"),
    outputRights: requireString(rights.outputRights, "rights.outputRights"),
    redistribution: requireString(rights.redistribution, "rights.redistribution"),
    attestationRef: requireString(
      rights.attestationRef,
      "rights.attestationRef",
      ATTESTATION,
    ),
    containsClientData: false,
  };
}

// Dos validaciones independientes y dos revisores humanos. El esquema ya exige
// los mínimos; aquí se endurece en dos puntos que el esquema no cubre y que la
// política sí: ninguna validación puede venir `rejected`, y los dos oráculos
// tienen que ser distintos entre sí. Un bundle validado dos veces por el mismo
// oráculo no está validado dos veces.
function validateValidations(validations) {
  if (!Array.isArray(validations) || validations.length < 2) {
    fail("la declaración necesita al menos DOS validaciones independientes");
  }
  const names = new Set();
  for (const entry of validations) {
    requireString(entry?.validator, "validations[].validator");
    requireString(entry?.version, "validations[].version");
    requireString(entry?.evidenceSha256, "validations[].evidenceSha256", SHA256);
    if (entry.result !== "accepted") {
      fail(
        `la validación de ${entry.validator} no es \`accepted\`; un bundle no se promueve con una validación en contra`,
      );
    }
    names.add(entry.validator.toLowerCase());
  }
  if (names.size < 2) {
    fail(
      "las dos validaciones vienen del mismo oráculo; la política exige que sean independientes entre sí",
    );
  }
  return validations.map((entry) => ({
    validator: entry.validator,
    version: entry.version,
    result: "accepted",
    evidenceSha256: entry.evidenceSha256,
  }));
}

function validateReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length < 2) {
    fail(
      "la declaración necesita al menos DOS revisores humanos: el titular y el segundo revisor que firma derechos",
    );
  }
  const unique = new Set();
  for (const handle of reviews) {
    requireString(handle, "reviews[]", HANDLE);
    unique.add(handle.toLowerCase());
  }
  if (unique.size !== reviews.length) {
    fail("hay revisores repetidos; el titular no puede contar como segundo revisor");
  }
  return [...reviews];
}

function parseArguments(argv) {
  const options = { bundle: null, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--bundle") {
      options.bundle = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--write") {
      options.write = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      fail(`argumento desconocido: ${argument}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Uso: node scripts/build-manifest.mjs --bundle <id> [--write]",
    "",
    "Produce bundles/<id>/manifest.json y actualiza index.json a partir de una",
    "declaración de derechos que vive FUERA de Git, en incoming/<id>.declaration.json",
    "(el .gitignore ya excluye incoming/).",
    "",
    "Sin --write no escribe nada: imprime el manifiesto que produciría. El paso",
    "3 de la política sólo se ejecuta DESPUÉS de la revisión humana de derechos.",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.bundle || !BUNDLE_ID.test(options.bundle)) {
    fail(`falta --bundle <id> válido\n\n${usage()}`);
  }

  const bundleRoot = resolve(bundlesRoot, options.bundle);
  if (!inside(bundlesRoot, bundleRoot)) {
    fail("el id del bundle escapa de bundles/");
  }

  const declarationPath = resolve(
    incomingRoot,
    `${options.bundle}.declaration.json`,
  );
  let declaration;
  try {
    declaration = JSON.parse(await readFile(declarationPath, "utf8"));
  } catch {
    fail(
      `no se pudo leer la declaración en incoming/${options.bundle}.declaration.json — ese archivo lo escribe un humano tras la revisión de derechos y nunca entra a Git`,
    );
  }

  if (!DWG_VERSIONS.includes(declaration.dwgVersion)) {
    fail(`dwgVersion debe ser uno de ${DWG_VERSIONS.join(", ")}`);
  }
  const sourceFactIds = Array.isArray(declaration.sourceFactIds)
    ? declaration.sourceFactIds
    : [];
  if (sourceFactIds.length < 1) {
    fail("la declaración necesita al menos un sourceFactIds");
  }
  for (const factId of sourceFactIds) {
    requireString(factId, "sourceFactIds[]", FACT_ID);
  }
  if (new Set(sourceFactIds).size !== sourceFactIds.length) {
    fail("hay sourceFactIds repetidos");
  }

  const manifest = {
    schemaVersion: "1.0.0",
    id: options.bundle,
    status: "allowed",
    dwgVersion: declaration.dwgVersion,
    rights: validateRights(declaration.rights),
    sourceFactIds: [...sourceFactIds],
    fixtures: await collectArtifacts(bundleRoot, "fixtures"),
    oracles: await collectArtifacts(bundleRoot, "oracles"),
    validations: validateValidations(declaration.validations),
    reviews: validateReviews(declaration.reviews),
  };

  // El manifiesto se serializa con salto de línea final y sin reordenar claves:
  // el índice guarda su SHA-256, así que cualquier reserialización distinta
  // rompería el gate por una diferencia puramente cosmética.
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = sha256OfText(serialized);

  const indexPath = resolve(root, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const entry = {
    id: options.bundle,
    manifestPath: `bundles/${options.bundle}/manifest.json`,
    manifestSha256,
  };
  // Un bundle es inmutable: una corrección crea un id nuevo, nunca reemplaza
  // bytes bajo el mismo id. Por eso reindexar un id existente es un error, no
  // una actualización.
  if (index.bundles.some((existing) => existing.id === options.bundle)) {
    fail(
      `${options.bundle} ya está en index.json; los bundles son inmutables, una corrección crea un id nuevo`,
    );
  }
  index.bundles = [...index.bundles, entry].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  index.updatedAt = requireString(
    declaration.updatedAt,
    "updatedAt (fecha ISO del día de la admisión, la pone el humano para que el manifiesto sea reproducible)",
    /^\d{4}-\d{2}-\d{2}$/,
  );

  if (!options.write) {
    process.stdout.write(`${serialized}`);
    process.stdout.write(
      `\n--- ensayo, no se escribió nada. Repite con --write ---\nmanifestSha256: ${manifestSha256}\n`,
    );
    return;
  }

  await writeFile(resolve(bundleRoot, "manifest.json"), serialized, "utf8");
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  process.stdout.write(
    `manifiesto escrito para ${options.bundle}\n  fixtures: ${manifest.fixtures.length}\n  oracles: ${manifest.oracles.length}\n  manifestSha256: ${manifestSha256}\nAhora corre \`npm run check\` y abre el PR: main exige corpus-gates y revisión de CODEOWNERS.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
