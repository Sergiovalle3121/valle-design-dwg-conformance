#!/usr/bin/env node

// Pipeline REPRODUCIBLE del bundle de la TERCERA OLA (`entity-wave-3-ac1015`),
// origen `tool-converted-original`: el 3D heredado y la escala.
//
// Mismo contrato que build-entity-corpus-3.mjs, con las mismas garantías: un
// dibujo que la herramienta conversora rechace o que falle el round-trip
// estructural NO tumba el pipeline entero — se EXCLUYE del bundle y su rechazo
// queda documentado con el mensaje exacto del conversor. Fallar cerrado sigue
// aplicando a todo lo demás (firmas, evidencias, staging fuera del repo, cero
// dibujos admitidos).
//
//  1. genera los seis DXF 26–31 (scripts/generate-entity-dxf-3.mjs) en un
//     staging FUERA del repositorio;
//  2. los convierte SOLO a ACAD2000 (AC1015) con la herramienta registrada en
//     docs/TOOLS.md, con audit activado;
//  3. verifica la FIRMA real de cada DWG producido (primeros 6 bytes);
//  4. re-convierte cada DWG a DXF (round-trip) y compara la estructura contra
//     el DXF fuente con el comparador COMPARTIDO de `corpus-tools.mjs` — la
//     segunda validación independiente `dxf-source-roundtrip`;
//  5. escribe `conversion-log.json` y `roundtrip-report.json`;
//  6. con `--assemble`, monta `bundles/entity-wave-3-ac1015/` sólo con los
//     dibujos aceptados.
//
// QUÉ ESPERAR DE ESTA OLA EN CONCRETO. El comparador estructural cuenta
// entidades por tipo, capas y nombres de bloque; NO compara coordenadas. Para
// el 3D eso es justo lo que no basta —un aplanado a Z=0 conserva el conteo—,
// así que la fidelidad del eje Z la falsa el códec contra el DXF oráculo que
// este pipeline congela junto al DWG, no este comparador. Se dice aquí para
// que nadie lea "round-trip OK" como "el 3D viajó bien".
//
// El dibujo 31 (escala, ~5000 entidades) existe para ejercitar la paginación
// del mapa de objetos y el presupuesto del lector. Es, con diferencia, el
// fixture más pesado del corpus: si el conversor tarda, no está colgado.
//
// Uso:
//   node scripts/build-entity-corpus-3.mjs --staging <dir> [--oda <exe>] [--assemble]
//   (o ODA_FILE_CONVERTER en el entorno en lugar de --oda)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeEntityDrawings3,
  ENTITY_DRAWINGS_3,
  DOCUMENTED_EXCLUSIONS,
} from "./generate-entity-dxf-3.mjs";
import {
  TOOL,
  collectErrorFiles,
  compareStructure,
  runConverter,
  sha256,
  sha256File,
  summarizeDxf,
  inside,
} from "./corpus-tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUNDLE_ID = "entity-wave-3-ac1015";
const TARGET = { parameter: "ACAD2000", signature: "AC1015" };

function fail(message) {
  process.stderr.write(`corpus de entidades 3: ${message}\n`);
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
if (inside(root, staging)) fail("el staging no puede vivir dentro del repositorio");
const odaExe = flag("--oda") ?? process.env.ODA_FILE_CONVERTER;
if (!odaExe || !fs.existsSync(odaExe)) {
  fail("falta el ejecutable del conversor (--oda <exe> o ODA_FILE_CONVERTER)");
}
const assemble = argv.includes("--assemble");

const dxfDir = path.join(staging, "dxf-entidades-2");
fs.rmSync(dxfDir, { recursive: true, force: true });
await writeEntityDrawings3(dxfDir);
const sources = ENTITY_DRAWINGS_3.map((drawing) => ({
  name: drawing.name,
  intent: drawing.intent,
  file: path.join(dxfDir, `${drawing.name}.dxf`),
}));
process.stdout.write(`DXF de la ola de entidades 2: ${sources.length} generados en ${dxfDir}\n`);

const dwgDir = path.join(staging, "dwg-entidades-2", TARGET.parameter);
const roundtripDir = path.join(staging, "roundtrip-entidades-2", TARGET.parameter);
const reportDir = path.join(staging, "reports-entidades-2", TARGET.parameter);
fs.rmSync(dwgDir, { recursive: true, force: true });
fs.rmSync(roundtripDir, { recursive: true, force: true });
fs.mkdirSync(reportDir, { recursive: true });

// 1) DXF fuente → DWG AC1015, con audit. Un dibujo sin DWG o con .err queda
// documentado como rechazado y fuera del bundle; no arrastra al resto.
const conversion = runConverter(odaExe, dxfDir, dwgDir, TARGET.parameter, "DWG", fail);
// La red GLOBAL que la ola 1 sí tenía y este copy-paste perdió: un exit
// distinto de cero es un fallo del conversor entero, no de un dibujo — sin
// esta línea el pipeline seguía y podía firmar un lote a medias.
if (conversion.exitCode !== 0) {
  fail(`${TARGET.parameter}: el conversor salió con código ${conversion.exitCode}`);
}
const conversionErrors = collectErrorFiles(dwgDir);
const errorByName = new Map(
  conversionErrors.flatMap((entry) => {
    const stem = entry.file.replace(/\.err$/i, "");
    // Tres formas de clave: el conversor puede nombrar el .err por el archivo
    // de SALIDA (x.dwg.err), por el de ENTRADA (x.dxf.err) o por el nombre a
    // secas — con dos de tres, un .err del tercero admitía el dibujo igual.
    return [
      [stem, entry.content],
      [stem.replace(/\.dwg$/i, ""), entry.content],
      [stem.replace(/\.dxf$/i, ""), entry.content],
    ];
  }),
);

const rejectedConversion = [];
const files = [];
let admitted = sources;
{
  const survivors = [];
  for (const source of admitted) {
    const dwgFile = path.join(dwgDir, `${source.name}.dwg`);
    const converterMessage = errorByName.get(source.name);
    if (!fs.existsSync(dwgFile) || converterMessage !== undefined) {
      rejectedConversion.push({
        name: source.name,
        stage: "dxf-to-dwg",
        reason: fs.existsSync(dwgFile)
          ? "el conversor dejó un .err junto al DWG"
          : "el conversor no produjo el DWG",
        converterMessage: converterMessage ?? null,
      });
      continue;
    }
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
    survivors.push(source);
  }
  admitted = survivors;
}
if (admitted.length === 0) fail(`${TARGET.parameter}: la conversión rechazó los diez dibujos`);

// 2) DWG → DXF de vuelta, y comparación estructural contra la fuente. Un
// veredicto rejected excluye SOLO ese dibujo y queda documentado con sus
// problemas exactos.
const roundtrip = runConverter(odaExe, dwgDir, roundtripDir, "ACAD2000", "DXF", fail);
if (roundtrip.exitCode !== 0) {
  fail(`${TARGET.parameter}: el round-trip salió con código ${roundtrip.exitCode}`);
}
const roundtripErrors = collectErrorFiles(roundtripDir);
const roundtripErrorByName = new Map(
  roundtripErrors.flatMap((entry) => {
    const stem = entry.file.replace(/\.err$/i, "");
    return [
      [stem, entry.content],
      [stem.replace(/\.dwg$/i, ""), entry.content],
      [stem.replace(/\.dxf$/i, ""), entry.content],
    ];
  }),
);
const comparisons = {};
const rejectedRoundtrip = [];
{
  const survivors = [];
  for (const source of admitted) {
    const roundtripFile = path.join(roundtripDir, `${source.name}.dxf`);
    const roundtripMessage = roundtripErrorByName.get(source.name);
    if (!fs.existsSync(roundtripFile) || roundtripMessage !== undefined) {
      rejectedRoundtrip.push({
        name: source.name,
        stage: "dwg-to-dxf",
        reason: fs.existsSync(roundtripFile)
          ? "el conversor dejó un .err junto al DXF del round-trip"
          : "el round-trip no produjo el DXF",
        problemas: [],
        ...(roundtripMessage === undefined
          ? {}
          : { converterMessage: roundtripMessage }),
      });
      continue;
    }
    const comparison = compareStructure(summarizeDxf(source.file), summarizeDxf(roundtripFile));
    if (comparison.veredicto !== "accepted") {
      rejectedRoundtrip.push({
        name: source.name,
        stage: "structural-comparison",
        reason: "el round-trip estructural no coincide con la fuente",
        problemas: comparison.problemas,
      });
      continue;
    }
    comparisons[source.name] = comparison;
    survivors.push(source);
  }
  admitted = survivors;
}
if (admitted.length === 0) fail(`${TARGET.parameter}: el round-trip rechazó todos los dibujos`);

// Los DWG de dibujos rechazados en round-trip no pueden quedar en `files`.
const admittedNames = new Set(admitted.map((source) => source.name));
const admittedFiles = files.filter((file) => admittedNames.has(file.name));

const conversionLog = {
  $schema: "urn:valle-design:dwg-conformance:conversion-log:v1",
  validator: "oda-file-converter",
  validatorVersion: TOOL.version,
  toolRegistryRef: TOOL.registryRef,
  targetVersion: TARGET.parameter,
  expectedSignature: TARGET.signature,
  conversion,
  errorFiles: conversionErrors,
  files: admittedFiles,
  rejected: rejectedConversion,
  documentedExclusions: DOCUMENTED_EXCLUSIONS,
  // Calculado, no literal: una corrida con rechazos al lado de un
  // "result": "accepted" era una evidencia que se contradecía a sí misma.
  result: rejectedConversion.length === 0 ? "accepted" : "partial",
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
  rejected: rejectedRoundtrip,
  result: rejectedRoundtrip.length === 0 ? "accepted" : "partial",
};

const logFile = path.join(reportDir, "conversion-log.json");
const reportFile = path.join(reportDir, "roundtrip-report.json");
fs.writeFileSync(logFile, `${JSON.stringify(conversionLog, null, 2)}\n`);
fs.writeFileSync(reportFile, `${JSON.stringify(roundtripReport, null, 2)}\n`);

const rejectedTotal = rejectedConversion.length + rejectedRoundtrip.length;
process.stdout.write(
  `${TARGET.parameter}: ${admittedFiles.length} DWG con firma ${TARGET.signature} verificada, round-trip accepted, ${rejectedTotal} rechazado(s) documentado(s)\n`,
);

if (assemble) {
  const bundleRoot = path.join(root, "bundles", BUNDLE_ID);
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(bundleRoot, "fixtures"), { recursive: true });
  fs.mkdirSync(path.join(bundleRoot, "oracles", "dxf"), { recursive: true });
  for (const source of admitted) {
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
    fixtures: admittedFiles.length,
    rejected: rejectedTotal,
    validations: [
      { validator: "oda-file-converter", version: TOOL.version, evidenceSha256: sha256File(logFile) },
      { validator: "dxf-source-roundtrip", version: "1.0.0", evidenceSha256: sha256File(reportFile) },
    ],
  },
  null,
  2,
)}\n`);
