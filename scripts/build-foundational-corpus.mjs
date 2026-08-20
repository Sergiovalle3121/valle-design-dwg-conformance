#!/usr/bin/env node

// Pipeline REPRODUCIBLE del corpus fundacional `tool-converted-original`.
//
// Qué hace, en orden y fallando cerrado:
//
//  1. genera los ocho DXF fundacionales (scripts/generate-foundational-dxf.mjs)
//     en un directorio de staging FUERA del repositorio;
//  2. los convierte a DWG en las cinco versiones objetivo con la herramienta
//     registrada en docs/TOOLS.md (ODA File Converter, ver enmienda 2026-08-20
//     de CORPUS_POLICY.md), con audit activado;
//  3. verifica la FIRMA real de cada DWG producido (primeros 6 bytes) — el
//     `dwgVersion` de cada manifiesto sale de esta verificación, no del nombre
//     del parámetro de conversión;
//  4. re-convierte cada DWG a DXF (round-trip) y compara la estructura contra
//     el DXF fuente: conteo por tipo de entidad (con la equivalencia declarada
//     POLYLINE 2D → LWPOLYLINE), capas con banderas frozen/locked y colores,
//     y nombres de bloque. Este es el segundo validador independiente
//     (`dxf-source-roundtrip`): su veredicto depende del contenido, no de que
//     la conversión "no explote";
//  5. escribe `conversion-log.json` y `roundtrip-report.json` por versión —
//     las evidencias cuyos SHA-256 firman las dos validaciones del manifiesto;
//  6. con `--assemble`, monta `bundles/valle.fundacional.<ver>.001/` con
//     fixtures (DWG), oráculos (DXF fuente + evidencias) listos para
//     `build-manifest.mjs`.
//
// El DXF que produce el round-trip NO entra al repositorio: sólo se usa para
// emitir el veredicto y se queda en staging. Lo que se congela es el veredicto
// con su evidencia hasheada.
//
// Uso:
//   node scripts/build-foundational-corpus.mjs --staging <dir> [--oda <exe>] [--assemble]
//   (o ODA_FILE_CONVERTER en el entorno en lugar de --oda)

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDrawings, DRAWINGS } from "./generate-foundational-dxf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TOOL = {
  name: "ODA File Converter",
  version: "27.1",
  registryRef: "docs/TOOLS.md#oda-file-converter-27.1",
};

/** Las cinco versiones objetivo: parámetro del conversor → firma esperada. */
const TARGETS = [
  { parameter: "ACAD2000", signature: "AC1015" },
  { parameter: "ACAD2004", signature: "AC1018" },
  { parameter: "ACAD2010", signature: "AC1024" },
  { parameter: "ACAD2013", signature: "AC1027" },
  { parameter: "ACAD2018", signature: "AC1032" },
];

function fail(message) {
  process.stderr.write(`corpus fundacional: ${message}\n`);
  process.exit(1);
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));

// ---------------------------------------------------------------------------
// Parser DXF estructural mínimo (sólo para COMPARAR, nunca para implementar)
// ---------------------------------------------------------------------------

/** Lee un DXF ASCII como lista de pares [código, valor]. */
function readPairs(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) break;
    pairs.push([code, lines[i + 1]]);
  }
  return pairs;
}

/**
 * Resumen estructural de un DXF: entidades por tipo, capas y bloques.
 * VERTEX/SEQEND no cuentan como entidades: pertenecen a su POLYLINE.
 */
function summarizeDxf(file) {
  const pairs = readPairs(file);
  const entities = new Map();
  const layers = new Map();
  const blocks = [];

  let section = null;
  let table = null;
  let pendingLayer = null;
  const closeLayer = () => {
    if (pendingLayer?.name !== undefined) {
      layers.set(pendingLayer.name, {
        flags: pendingLayer.flags ?? 0,
        color: pendingLayer.color ?? 7,
        linetype: pendingLayer.linetype ?? "CONTINUOUS",
      });
    }
    pendingLayer = null;
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const [code, raw] = pairs[i];
    const value = raw.trim();
    if (code === 2 && pairs[i - 1]?.[0] === 0 && pairs[i - 1]?.[1].trim() === "SECTION") {
      section = value;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      closeLayer();
      section = null;
      table = null;
      continue;
    }
    if (section === "TABLES") {
      if (code === 2 && pairs[i - 1]?.[0] === 0 && pairs[i - 1]?.[1].trim() === "TABLE") {
        table = value;
        continue;
      }
      if (code === 0 && value === "ENDTAB") {
        closeLayer();
        table = null;
        continue;
      }
      if (table === "LAYER") {
        if (code === 0 && value === "LAYER") {
          closeLayer();
          pendingLayer = {};
        } else if (pendingLayer) {
          if (code === 2) pendingLayer.name = value;
          else if (code === 70) pendingLayer.flags = Number.parseInt(value, 10);
          else if (code === 62) pendingLayer.color = Number.parseInt(value, 10);
          else if (code === 6) pendingLayer.linetype = value.toUpperCase();
        }
      }
      continue;
    }
    if (section === "BLOCKS" && code === 2 && pairs[i - 1]?.[0] === 0 && pairs[i - 1]?.[1].trim() === "BLOCK") {
      if (!value.startsWith("*")) blocks.push(value.toUpperCase());
      continue;
    }
    if (section === "ENTITIES" && code === 0 && value !== "VERTEX" && value !== "SEQEND") {
      entities.set(value, (entities.get(value) ?? 0) + 1);
    }
  }
  closeLayer();
  return {
    entities: Object.fromEntries([...entities.entries()].sort()),
    layers: Object.fromEntries([...layers.entries()].sort()),
    blocks: blocks.sort(),
  };
}

/**
 * Equivalencias DECLARADAS de la conversión: una polilínea 2D clásica del DXF
 * R12 se representa como LWPOLYLINE al guardar contenedores modernos. Ninguna
 * otra transformación de tipo se acepta en silencio.
 */
const EQUIVALENT_TYPES = new Map([["POLYLINE", "LWPOLYLINE"]]);

const normalizeCounts = (counts) => {
  const out = new Map();
  for (const [type, count] of Object.entries(counts)) {
    const canonical = EQUIVALENT_TYPES.get(type) ?? type;
    out.set(canonical, (out.get(canonical) ?? 0) + count);
  }
  return out;
};

/** Bits de estado que el corpus fija a propósito: 1 = frozen, 2 = off?, 4 = locked. */
const LAYER_STATE_MASK = 1 | 4;

function compareStructure(source, roundtrip) {
  const problems = [];
  const expected = normalizeCounts(source.entities);
  const actual = normalizeCounts(roundtrip.entities);
  const matrix = {};
  for (const [type, count] of expected) {
    const got = actual.get(type) ?? 0;
    matrix[type] = { esperado: count, leido: got };
    if (got !== count) problems.push(`entidades ${type}: esperadas ${count}, leidas ${got}`);
  }
  for (const [type, count] of actual) {
    if (!expected.has(type)) {
      matrix[type] = { esperado: 0, leido: count };
      problems.push(`entidades ${type}: 0 esperadas, ${count} leidas`);
    }
  }
  const layerMatrix = {};
  for (const [name, meta] of Object.entries(source.layers)) {
    const got = roundtrip.layers[name];
    layerMatrix[name] = { esperado: meta, leido: got ?? null };
    if (!got) {
      problems.push(`capa ${name}: ausente en el round-trip`);
      continue;
    }
    if ((got.flags & LAYER_STATE_MASK) !== (meta.flags & LAYER_STATE_MASK)) {
      problems.push(`capa ${name}: banderas ${meta.flags} → ${got.flags}`);
    }
    if (got.color !== meta.color) {
      problems.push(`capa ${name}: color ${meta.color} → ${got.color}`);
    }
    if (got.linetype !== meta.linetype) {
      problems.push(`capa ${name}: linetype ${meta.linetype} → ${got.linetype}`);
    }
  }
  const missingBlocks = source.blocks.filter((b) => !roundtrip.blocks.includes(b));
  for (const name of missingBlocks) problems.push(`bloque ${name}: ausente en el round-trip`);
  return {
    entidades: matrix,
    capas: layerMatrix,
    bloques: { esperados: source.blocks, leidos: roundtrip.blocks },
    problemas: problems,
    veredicto: problems.length === 0 ? "accepted" : "rejected",
  };
}

// ---------------------------------------------------------------------------
// Conversión con la herramienta registrada
// ---------------------------------------------------------------------------

function runConverter(exe, inputDir, outputDir, versionParameter, type) {
  fs.mkdirSync(outputDir, { recursive: true });
  const args = [inputDir, outputDir, versionParameter, type, "0", "1"];
  const started = new Date().toISOString();
  const result = spawnSync(exe, args, { stdio: "ignore", timeout: 10 * 60 * 1000 });
  if (result.error) fail(`el conversor no arrancó: ${result.error.message}`);
  return {
    tool: TOOL,
    command: [path.basename(exe), ...args.map((a) => a.replaceAll("\\", "/"))],
    audit: true,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
  };
}

/** Los .err que deja el conversor junto a sus salidas delatan archivos fallidos. */
function collectErrorFiles(outputDir) {
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith(".err"))
    .map((name) => ({
      file: name,
      content: fs.readFileSync(path.join(outputDir, name), "utf8").slice(0, 2000),
    }));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index > -1 ? argv[index + 1] : undefined;
};
const stagingArg = flag("--staging");
if (!stagingArg) fail("falta --staging <dir> (un directorio FUERA del repositorio)");
const staging = path.resolve(stagingArg);
if (staging.startsWith(root)) fail("el staging no puede vivir dentro del repositorio");
const odaExe = flag("--oda") ?? process.env.ODA_FILE_CONVERTER;
if (!odaExe || !fs.existsSync(odaExe)) {
  fail("falta el ejecutable del conversor (--oda <exe> o ODA_FILE_CONVERTER)");
}
const assemble = argv.includes("--assemble");

const dxfDir = path.join(staging, "dxf");
fs.rmSync(dxfDir, { recursive: true, force: true });
await writeDrawings(dxfDir);
const sources = DRAWINGS.map((drawing) => ({
  name: drawing.name,
  intent: drawing.intent,
  file: path.join(dxfDir, `${drawing.name}.dxf`),
}));
process.stdout.write(`DXF fundacionales: ${sources.length} generados en ${dxfDir}\n`);

const bundles = [];
for (const target of TARGETS) {
  const dwgDir = path.join(staging, "dwg", target.parameter);
  const roundtripDir = path.join(staging, "roundtrip", target.parameter);
  const reportDir = path.join(staging, "reports", target.parameter);
  fs.rmSync(dwgDir, { recursive: true, force: true });
  fs.rmSync(roundtripDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });

  // 1) DXF fuente → DWG de la versión objetivo, con audit.
  const conversion = runConverter(odaExe, dxfDir, dwgDir, target.parameter, "DWG");
  const conversionErrors = collectErrorFiles(dwgDir);

  const files = [];
  for (const source of sources) {
    const dwgFile = path.join(dwgDir, `${source.name}.dwg`);
    if (!fs.existsSync(dwgFile)) fail(`${target.parameter}: no se produjo ${source.name}.dwg`);
    const bytes = fs.readFileSync(dwgFile);
    const signature = bytes.subarray(0, 6).toString("latin1");
    if (signature !== target.signature) {
      fail(
        `${target.parameter}: firma inesperada en ${source.name}.dwg: "${signature}" (se esperaba ${target.signature})`,
      );
    }
    files.push({
      name: source.name,
      sourceDxfSha256: sha256File(source.file),
      dwgSha256: sha256(bytes),
      dwgByteLength: bytes.length,
      signature,
    });
  }

  // 2) DWG → DXF de vuelta, y comparación estructural contra la fuente.
  const roundtrip = runConverter(odaExe, dwgDir, roundtripDir, "ACAD2000", "DXF");
  const roundtripErrors = collectErrorFiles(roundtripDir);
  const comparisons = {};
  let rejected = 0;
  for (const source of sources) {
    const roundtripFile = path.join(roundtripDir, `${source.name}.dxf`);
    if (!fs.existsSync(roundtripFile)) fail(`${target.parameter}: round-trip sin ${source.name}.dxf`);
    const comparison = compareStructure(summarizeDxf(source.file), summarizeDxf(roundtripFile));
    comparisons[source.name] = comparison;
    if (comparison.veredicto !== "accepted") rejected += 1;
  }

  if (conversion.exitCode !== 0 || conversionErrors.length > 0) {
    fail(`${target.parameter}: la conversión reportó errores (${conversionErrors.length} .err)`);
  }
  if (rejected > 0) {
    fail(`${target.parameter}: ${rejected} archivo(s) rechazado(s) por el round-trip estructural`);
  }

  const conversionLog = {
    $schema: "urn:valle-design:dwg-conformance:conversion-log:v1",
    validator: "oda-file-converter",
    validatorVersion: TOOL.version,
    toolRegistryRef: TOOL.registryRef,
    targetVersion: target.parameter,
    expectedSignature: target.signature,
    conversion,
    errorFiles: conversionErrors,
    files,
    result: "accepted",
  };
  const roundtripReport = {
    $schema: "urn:valle-design:dwg-conformance:roundtrip-report:v1",
    validator: "dxf-source-roundtrip",
    validatorVersion: "1.0.0",
    method:
      "DWG del bundle re-convertido a DXF con la herramienta registrada y comparado estructuralmente contra el DXF fuente de autoría propia: conteo por tipo de entidad (equivalencia declarada POLYLINE 2D → LWPOLYLINE), capas (banderas frozen/locked, color, linetype) y bloques.",
    limitation:
      "Valida la conversión con la MISMA herramienta que produjo el DWG: es independiente del codec de Valle, pero no de la herramienta. La prueba contra AutoCAD real llegará con bundles donated-original.",
    targetVersion: target.parameter,
    roundtrip,
    errorFiles: roundtripErrors,
    comparisons,
    result: "accepted",
  };

  const logFile = path.join(reportDir, "conversion-log.json");
  const reportFile = path.join(reportDir, "roundtrip-report.json");
  fs.writeFileSync(logFile, `${JSON.stringify(conversionLog, null, 2)}\n`);
  fs.writeFileSync(reportFile, `${JSON.stringify(roundtripReport, null, 2)}\n`);

  const bundleId = `valle.fundacional.${target.signature.toLowerCase()}.001`;
  bundles.push({
    bundleId,
    dwgVersion: target.signature,
    dwgDir,
    logFile,
    reportFile,
    logSha256: sha256File(logFile),
    reportSha256: sha256File(reportFile),
    fileCount: files.length,
  });
  process.stdout.write(
    `${target.parameter}: ${files.length} DWG con firma ${target.signature} verificada, round-trip accepted\n`,
  );
}

if (assemble) {
  for (const bundle of bundles) {
    const bundleRoot = path.join(root, "bundles", bundle.bundleId);
    fs.rmSync(bundleRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(bundleRoot, "fixtures"), { recursive: true });
    fs.mkdirSync(path.join(bundleRoot, "oracles", "dxf"), { recursive: true });
    for (const source of sources) {
      fs.copyFileSync(
        path.join(bundle.dwgDir, `${source.name}.dwg`),
        path.join(bundleRoot, "fixtures", `${source.name}.dwg`),
      );
      fs.copyFileSync(source.file, path.join(bundleRoot, "oracles", "dxf", `${source.name}.dxf`));
    }
    fs.copyFileSync(bundle.logFile, path.join(bundleRoot, "oracles", "conversion-log.json"));
    fs.copyFileSync(bundle.reportFile, path.join(bundleRoot, "oracles", "roundtrip-report.json"));
  }
  process.stdout.write(`bundles montados: ${bundles.map((b) => b.bundleId).join(", ")}\n`);
}

process.stdout.write(`${JSON.stringify(
  bundles.map(({ bundleId, dwgVersion, logSha256, reportSha256, fileCount }) => ({
    bundleId,
    dwgVersion,
    fixtures: fileCount,
    validations: [
      { validator: "oda-file-converter", version: TOOL.version, evidenceSha256: logSha256 },
      { validator: "dxf-source-roundtrip", version: "1.0.0", evidenceSha256: reportSha256 },
    ],
  })),
  null,
  2,
)}\n`);
