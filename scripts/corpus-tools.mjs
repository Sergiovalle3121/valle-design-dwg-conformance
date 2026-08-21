#!/usr/bin/env node

// Piezas COMPARTIDAS del pipeline reproducible del corpus: el parser DXF
// estructural mínimo (sólo para COMPARAR, nunca para implementar), el
// comparador fuente↔round-trip, el ejecutor del conversor registrado y los
// hashes. Vivían dentro de `build-foundational-corpus.mjs`; se extrajeron al
// nacer la ola de entidades (`build-entity-corpus.mjs`) para que ambos
// pipelines usen EXACTAMENTE el mismo criterio de veredicto — dos copias del
// comparador habrían divergido en silencio.
//
// Nada de aquí abre ni interpreta el interior de un DWG: los DWG sólo se
// hashean y se miden; el análisis estructural es del DXF ASCII propio.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** La herramienta registrada en docs/TOOLS.md que produce y valida los DWG. */
export const TOOL = {
  name: "ODA File Converter",
  version: "27.1",
  registryRef: "docs/TOOLS.md#oda-file-converter-27.1",
};

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
export const sha256File = (file) => sha256(fs.readFileSync(file));

// ---------------------------------------------------------------------------
// Parser DXF estructural mínimo
// ---------------------------------------------------------------------------

/** Lee un DXF ASCII como lista de pares [código, valor]. */
export function readPairs(file) {
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
 * VERTEX/SEQEND no cuentan como entidades: pertenecen a su POLYLINE (o a su
 * INSERT con atributos).
 */
export function summarizeDxf(file) {
  const pairs = readPairs(file);
  const entities = new Map();
  const layers = new Map();
  const blocks = [];

  let section = null;
  let table = null;
  let pendingLayer = null;
  let pendingBlockName = false;
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
      pendingBlockName = false;
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
    if (section === "BLOCKS") {
      // El nombre (código 2) no viene pegado al «0 BLOCK»: R12 intercala la
      // capa (8) y el dialecto 2000 los marcadores de subclase (100). Vale el
      // primer 2 dentro del objeto BLOCK, hasta el siguiente código 0.
      if (code === 0) {
        pendingBlockName = value === "BLOCK";
      } else if (pendingBlockName && code === 2) {
        if (!value.startsWith("*")) blocks.push(value.toUpperCase());
        pendingBlockName = false;
      }
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
export const EQUIVALENT_TYPES = new Map([["POLYLINE", "LWPOLYLINE"]]);

export const normalizeCounts = (counts) => {
  const out = new Map();
  for (const [type, count] of Object.entries(counts)) {
    const canonical = EQUIVALENT_TYPES.get(type) ?? type;
    out.set(canonical, (out.get(canonical) ?? 0) + count);
  }
  return out;
};

/** Bits de estado que el corpus fija a propósito: 1 = frozen, 4 = locked. */
export const LAYER_STATE_MASK = 1 | 4;

export function compareStructure(source, roundtrip) {
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

export function runConverter(exe, inputDir, outputDir, versionParameter, type, fail) {
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
export function collectErrorFiles(outputDir) {
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith(".err"))
    .map((name) => ({
      file: name,
      content: fs.readFileSync(path.join(outputDir, name), "utf8").slice(0, 2000),
    }));
}
