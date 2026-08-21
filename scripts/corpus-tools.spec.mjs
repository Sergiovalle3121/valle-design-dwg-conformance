#!/usr/bin/env node

// summarizeDxf sólo compara, nunca implementa; pero si no ve los bloques, la
// comparación de bloques pasa en vacío y el veredicto "accepted" miente. Este
// spec fija que el nombre (código 2) se capture en los DOS dialectos del
// corpus: R12 (la capa 8 intercalada tras «0 BLOCK») y 2000 (los marcadores de
// subclase 100 antes del nombre), y que los bloques anónimos «*» sigan fuera.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { compareStructure, summarizeDxf } from "./corpus-tools.mjs";

const dxf = (pairs) => pairs.map(([code, value]) => `${code}\n${value}`).join("\n") + "\n";

async function summarizePairs(pairs) {
  const dir = await mkdtemp(join(tmpdir(), "valle-dwg-corpus-tools-"));
  try {
    const file = join(dir, "caso.dxf");
    await writeFile(file, dxf(pairs));
    return summarizeDxf(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("dialecto R12: el nombre del bloque llega tras la capa 8 y se captura", async () => {
  const summary = await summarizePairs([
    [0, "SECTION"], [2, "BLOCKS"],
    [0, "BLOCK"], [8, "0"], [2, "MARCO-A"], [70, "0"],
    [10, "0.0"], [20, "0.0"], [30, "0.0"],
    [0, "LINE"], [8, "0"], [10, "0.0"], [20, "0.0"], [11, "20.0"], [21, "0.0"],
    [0, "ENDBLK"], [8, "0"],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"],
    [0, "INSERT"], [8, "0"], [2, "MARCO-A"], [10, "5.0"], [20, "5.0"],
    [0, "ENDSEC"],
    [0, "EOF"],
  ]);
  assert.deepEqual(summary.blocks, ["MARCO-A"]);
  // La LINE vive dentro del bloque: no cuenta como entidad del dibujo.
  assert.deepEqual(summary.entities, { INSERT: 1 });
});

test("dialecto 2000: el nombre llega tras los marcadores 100 y los «*» se filtran", async () => {
  const summary = await summarizePairs([
    [0, "SECTION"], [2, "BLOCKS"],
    [0, "BLOCK"], [5, "20"], [330, "1F"],
    [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockBegin"],
    [2, "*Model_Space"], [70, "0"], [10, "0.0"], [20, "0.0"], [30, "0.0"],
    [3, "*Model_Space"], [1, ""],
    [0, "ENDBLK"], [5, "21"], [330, "1F"],
    [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockEnd"],
    [0, "BLOCK"], [5, "22"], [330, "1E"],
    [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockBegin"],
    [2, "CAJETIN"], [70, "2"], [10, "0.0"], [20, "0.0"], [30, "0.0"],
    [3, "CAJETIN"], [1, ""],
    [0, "ATTDEF"], [5, "23"], [100, "AcDbEntity"], [8, "0"], [2, "REVISION"],
    [0, "ENDBLK"], [5, "24"], [330, "1E"],
    [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockEnd"],
    [0, "ENDSEC"],
    [0, "EOF"],
  ]);
  // Sólo el 2 del objeto BLOCK: ni los espacios anónimos ni el tag del ATTDEF.
  assert.deepEqual(summary.blocks, ["CAJETIN"]);
});

test("un bloque presente en la fuente y ausente en el round-trip rechaza el dibujo", () => {
  const source = { entities: {}, layers: {}, blocks: ["CAJETIN"] };
  const roundtrip = { entities: {}, layers: {}, blocks: [] };
  const comparison = compareStructure(source, roundtrip);
  assert.equal(comparison.veredicto, "rejected");
  assert.deepEqual(comparison.problemas, ["bloque CAJETIN: ausente en el round-trip"]);
});
