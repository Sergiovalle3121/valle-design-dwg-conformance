#!/usr/bin/env node

// Pipeline REPRODUCIBLE del bundle de la OLA DE ENTIDADES
// (`foundational-entities-ac1015`), origen `tool-converted-original`.
//
// Igual que el pipeline fundacional, fallando cerrado:
//
//  1. genera los siete DXF 09–15 (scripts/generate-entity-dxf.mjs) en un
//     staging FUERA del repositorio;
//  2. los convierte SOLO a ACAD2000 (AC1015) con la herramienta registrada en
//     docs/TOOLS.md, con audit activado — el resto de versiones llegará cuando
//     el decoder de la ola las necesite;
//  3. verifica la FIRMA real de cada DWG producido (primeros 6 bytes);
//  4. re-convierte cada DWG a DXF (round-trip) y compara la estructura contra
//     el DXF fuente con el comparador COMPARTIDO de `corpus-tools.mjs`
//     (conteo por tipo, capas con color/linetype/banderas, bloques) — la
//     segunda validación independiente `dxf-source-roundtrip`;
//  5. escribe `conversion-log.json` y `roundtrip-report.json` — las evidencias
//     cuyos SHA-256 firman las dos validaciones del manifiesto;
//  6. con `--assemble`, monta `bundles/foundational-entities-ac1015/`.
//
// Uso:
//   node scripts/build-entity-corpus.mjs --staging <dir> [--oda <exe>] [--assemble]
//   (o ODA_FILE_CONVERTER en el entorno en lugar de --oda)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeEntityDrawings, ENTITY_DRAWINGS } from "./generate-entity-dxf.mjs";
import {
  TOOL,
  collectErrorFiles,
  compareStructure,
  runConverter,
  sha256,
  sha256File,
  summarizeDxf,
} from "./corpus-tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUNDLE_ID = "foundational-entities-ac1015";
const TARGET = { parameter: "ACAD2000", signature: "AC1015" };

function fail(message) {
  process.stderr.write(`corpus de entidades: ${message}\n`);
  process.exit(1);
}

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

const dxfDir = path.join(staging, "dxf-entidades");
fs.rmSync(dxfDir, { recursive: true, force: true });
await writeEntityDrawings(dxfDir);
const sources = ENTITY_DRAWINGS.map((drawing) => ({
  name: drawing.name,
  intent: drawing.intent,
  file: path.join(dxfDir, `${drawing.name}.dxf`),
}));
process.stdout.write(`DXF de la ola de entidades: ${sources.length} generados en ${dxfDir}\n`);

const dwgDir = path.join(staging, "dwg-entidades", TARGET.parameter);
const roundtripDir = path.join(staging, "roundtrip-entidades", TARGET.parameter);
const reportDir = path.join(staging, "reports-entidades", TARGET.parameter);
fs.rmSync(dwgDir, { recursive: true, force: true });
fs.rmSync(roundtripDir, { recursive: true, force: true });
fs.mkdirSync(reportDir, { recursive: true });

// 1) DXF fuente → DWG AC1015, con audit.
const conversion = runConverter(odaExe, dxfDir, dwgDir, TARGET.parameter, "DWG", fail);
const conversionErrors = collectErrorFiles(dwgDir);

const files = [];
for (const source of sources) {
  const dwgFile = path.join(dwgDir, `${source.name}.dwg`);
  if (!fs.existsSync(dwgFile)) fail(`${TARGET.parameter}: no se produjo ${source.name}.dwg`);
  const bytes = fs.readFileSync(dwgFile);
  const signature = bytes.subarray(0, 6).toString("latin1");
  if (signature !== TARGET.signature) {
    fail(
      `${TARGET.parameter}: firma inesperada en ${source.name}.dwg: "${signature}" (se esperaba ${TARGET.signature})`,
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
const roundtrip = runConverter(odaExe, dwgDir, roundtripDir, "ACAD2000", "DXF", fail);
const roundtripErrors = collectErrorFiles(roundtripDir);
const comparisons = {};
let rejected = 0;
for (const source of sources) {
  const roundtripFile = path.join(roundtripDir, `${source.name}.dxf`);
  if (!fs.existsSync(roundtripFile)) fail(`${TARGET.parameter}: round-trip sin ${source.name}.dxf`);
  const comparison = compareStructure(summarizeDxf(source.file), summarizeDxf(roundtripFile));
  comparisons[source.name] = comparison;
  if (comparison.veredicto !== "accepted") rejected += 1;
}

if (conversion.exitCode !== 0 || conversionErrors.length > 0) {
  fail(`${TARGET.parameter}: la conversión reportó errores (${conversionErrors.length} .err)`);
}
if (rejected > 0) {
  for (const [name, comparison] of Object.entries(comparisons)) {
    for (const problema of comparison.problemas) {
      process.stderr.write(`  ${name}: ${problema}\n`);
    }
  }
  fail(`${TARGET.parameter}: ${rejected} archivo(s) rechazado(s) por el round-trip estructural`);
}

const conversionLog = {
  $schema: "urn:valle-design:dwg-conformance:conversion-log:v1",
  validator: "oda-file-converter",
  validatorVersion: TOOL.version,
  toolRegistryRef: TOOL.registryRef,
  targetVersion: TARGET.parameter,
  expectedSignature: TARGET.signature,
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
  targetVersion: TARGET.parameter,
  roundtrip,
  errorFiles: roundtripErrors,
  comparisons,
  result: "accepted",
};

const logFile = path.join(reportDir, "conversion-log.json");
const reportFile = path.join(reportDir, "roundtrip-report.json");
fs.writeFileSync(logFile, `${JSON.stringify(conversionLog, null, 2)}\n`);
fs.writeFileSync(reportFile, `${JSON.stringify(roundtripReport, null, 2)}\n`);

process.stdout.write(
  `${TARGET.parameter}: ${files.length} DWG con firma ${TARGET.signature} verificada, round-trip accepted\n`,
);

if (assemble) {
  const bundleRoot = path.join(root, "bundles", BUNDLE_ID);
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(bundleRoot, "fixtures"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "oracles", "dxf"), { recursive: true });
  for (const source of sources) {
    fs.copyFileSync(
      path.join(dwgDir, `${source.name}.dwg`),
      path.join(bundleRoot, "fixtures", `${source.name}.dwg`),
    );
    fs.copyFileSync(source.file, path.join(bundleRoot, "oracles", "dxf", `${source.name}.dxf`));
  }
  fs.copyFileSync(logFile, path.join(bundleRoot, "oracles", "conversion-log.json"));
  fs.copyFileSync(reportFile, path.join(bundleRoot, "oracles", "roundtrip-report.json"));
  process.stdout.write(`bundle montado: ${BUNDLE_ID}\n`);
}

process.stdout.write(`${JSON.stringify(
  {
    bundleId: BUNDLE_ID,
    dwgVersion: TARGET.signature,
    fixtures: files.length,
    validations: [
      { validator: "oda-file-converter", version: TOOL.version, evidenceSha256: sha256File(logFile) },
      { validator: "dxf-source-roundtrip", version: "1.0.0", evidenceSha256: sha256File(reportFile) },
    ],
  },
  null,
  2,
)}\n`);
