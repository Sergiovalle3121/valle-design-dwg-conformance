#!/usr/bin/env node

// Generador del CORPUS FUNDACIONAL: ocho dibujos escalonados de autoría propia
// (Valle Design / Sergio Valle Zárate), escritos como DXF ASCII mínimos y
// deterministas. Este archivo ES la fuente reproducible del corpus: los DWG de
// los bundles `tool-converted-original` se producen convirtiendo estos DXF con
// la herramienta registrada en docs/TOOLS.md, nunca a mano.
//
// Por qué DXF R12 (AC1009): es el dialecto ASCII más simple que las
// implementaciones toleran sin tablas completas ni handles, así que un humano
// puede auditar cada línea. La escalera va de un dibujo vacío a una plantita
// mínima que combina capas, polilíneas con bulges, bloques y texto.
//
// Determinismo: mismo código → mismos bytes (LF, sin fechas, sin aleatoriedad).
// El SHA-256 de cada DXF queda congelado en el manifiesto de su bundle.
//
// Contenido 100% original: composiciones geométricas sencillas diseñadas para
// ejercitar tipos de entidad concretos. No hay datos de clientes ni material
// de terceros.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// --- escritor de pares código/valor -----------------------------------------

/** Formatea un real como lo esperan los parsers DXF clásicos. */
const real = (value) => {
  if (!Number.isFinite(value)) throw new Error(`real no finito: ${value}`);
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
};

class Dxf {
  constructor() {
    this.pairs = [];
  }
  tag(code, value) {
    this.pairs.push([code, value]);
    return this;
  }
  point(baseCode, x, y, z = undefined) {
    this.tag(baseCode, real(x)).tag(baseCode + 10, real(y));
    if (z !== undefined) this.tag(baseCode + 20, real(z));
    return this;
  }
  section(name, body) {
    this.tag(0, "SECTION").tag(2, name);
    body();
    this.tag(0, "ENDSEC");
    return this;
  }
  table(name, entries) {
    this.tag(0, "TABLE").tag(2, name).tag(70, entries.length);
    for (const entry of entries) entry();
    this.tag(0, "ENDTAB");
    return this;
  }
  toString() {
    const lines = [];
    for (const [code, value] of this.pairs) {
      lines.push(String(code), String(value));
    }
    lines.push("0", "EOF", "");
    return lines.join("\n");
  }
}

// --- emisores de entidades R12 ----------------------------------------------

const line = (d, { layer = "0", from, to }) => {
  d.tag(0, "LINE").tag(8, layer).point(10, from[0], from[1], from[2] ?? 0);
  d.point(11, to[0], to[1], to[2] ?? 0);
};

const point = (d, { layer = "0", at }) => {
  d.tag(0, "POINT").tag(8, layer).point(10, at[0], at[1], at[2] ?? 0);
};

const circle = (d, { layer = "0", center, radius }) => {
  d.tag(0, "CIRCLE").tag(8, layer);
  d.point(10, center[0], center[1], center[2] ?? 0).tag(40, real(radius));
};

/** Ángulos en GRADOS, como los guarda el DXF. */
const arc = (d, { layer = "0", center, radius, start, end }) => {
  d.tag(0, "ARC").tag(8, layer);
  d.point(10, center[0], center[1], center[2] ?? 0).tag(40, real(radius));
  d.tag(50, real(start)).tag(51, real(end));
};

const text = (d, { layer = "0", at, height, value, rotation, style, widthFactor }) => {
  d.tag(0, "TEXT").tag(8, layer).point(10, at[0], at[1], at[2] ?? 0);
  d.tag(40, real(height)).tag(1, value);
  if (rotation !== undefined) d.tag(50, real(rotation));
  if (widthFactor !== undefined) d.tag(41, real(widthFactor));
  if (style !== undefined) d.tag(7, style);
};

const insert = (d, { layer = "0", block, at, scale, rotation }) => {
  d.tag(0, "INSERT").tag(8, layer).tag(2, block);
  d.point(10, at[0], at[1], at[2] ?? 0);
  if (scale !== undefined) {
    d.tag(41, real(scale[0])).tag(42, real(scale[1])).tag(43, real(scale[2] ?? 1));
  }
  if (rotation !== undefined) d.tag(50, real(rotation));
};

/**
 * Polilínea 2D clásica de R12 (POLYLINE + VERTEX + SEQEND). Los `vertices`
 * son [x, y, bulge?]; `closed` pone el bit 1 de la bandera 70; `width` fija
 * anchos inicial y final por defecto. Las implementaciones que guardan DWG
 * moderno representan esta misma polilínea como LWPOLYLINE — exactamente la
 * transformación que el corpus quiere capturar.
 */
const polyline = (d, { layer = "0", closed = false, width, vertices }) => {
  d.tag(0, "POLYLINE").tag(8, layer).tag(66, 1).tag(70, closed ? 1 : 0);
  if (width !== undefined) d.tag(40, real(width)).tag(41, real(width));
  for (const [x, y, bulge] of vertices) {
    d.tag(0, "VERTEX").tag(8, layer).point(10, x, y, 0);
    if (bulge !== undefined && bulge !== 0) d.tag(42, real(bulge));
  }
  d.tag(0, "SEQEND").tag(8, layer);
};

// --- tablas ------------------------------------------------------------------

const LTYPE_CONTINUOUS = (d) => () => {
  d.tag(0, "LTYPE").tag(2, "CONTINUOUS").tag(70, 0).tag(3, "Linea continua");
  d.tag(72, 65).tag(73, 0).tag(40, "0.0");
};

const LTYPE_TRAZOS = (d) => () => {
  d.tag(0, "LTYPE").tag(2, "TRAZOS").tag(70, 0).tag(3, "Trazos - - - -");
  d.tag(72, 65).tag(73, 2).tag(40, "1.0").tag(49, "0.75").tag(49, "-0.25");
};

/** flags 70: bit 1 = congelada, bit 4 = bloqueada. */
const layerEntry = (d) => ({ name, color, ltype = "CONTINUOUS", flags = 0 }) => () => {
  d.tag(0, "LAYER").tag(2, name).tag(70, flags).tag(62, color).tag(6, ltype);
};

const styleEntry = (d) => ({ name, font = "txt", widthFactor = 1 }) => () => {
  d.tag(0, "STYLE").tag(2, name).tag(70, 0).tag(40, "0.0").tag(41, real(widthFactor));
  d.tag(50, "0.0").tag(71, 0).tag(42, "2.5").tag(3, font).tag(4, "");
};

const block = (d, { name, base = [0, 0], entities }) => {
  d.tag(0, "BLOCK").tag(8, "0").tag(2, name).tag(70, 0);
  d.point(10, base[0], base[1], 0);
  for (const emit of entities) emit(d);
  d.tag(0, "ENDBLK").tag(8, "0");
};

// --- los ocho dibujos ---------------------------------------------------------

/**
 * Cada dibujo declara además su ORÁCULO: lo que un lector correcto debe
 * encontrar. El harness del repositorio producto parsea el DXF directamente,
 * pero dejar la intención aquí hace auditable el diseño del corpus.
 */
export const DRAWINGS = [
  {
    name: "01-vacio",
    intent: "Dibujo vacío: el contenedor mínimo, cero entidades.",
    build: (d) => {
      d.section("ENTITIES", () => {});
    },
  },
  {
    name: "02-una-linea",
    intent: "Una sola LINE de coordenadas conocidas (0,0,0)-(100,50,0).",
    build: (d) => {
      d.section("ENTITIES", () => {
        line(d, { from: [0, 0], to: [100, 50] });
      });
    },
  },
  {
    name: "03-figuras-basicas",
    intent: "LINE, CIRCLE, ARC y POINT en la capa 0.",
    build: (d) => {
      d.section("ENTITIES", () => {
        line(d, { from: [10, 10], to: [90, 10] });
        circle(d, { center: [50, 45], radius: 20 });
        arc(d, { center: [50, 45], radius: 30, start: 30, end: 150 });
        point(d, { at: [5, 80] });
      });
    },
  },
  {
    name: "04-capas",
    intent:
      "Seis capas con colores ACI y linetype; CONGELADA lleva el bit frozen y BLOQUEADA el bit locked. Una entidad por capa.",
    build: (d) => {
      d.section("TABLES", () => {
        d.table("LTYPE", [LTYPE_CONTINUOUS(d), LTYPE_TRAZOS(d)]);
        const L = layerEntry(d);
        d.table("LAYER", [
          L({ name: "0", color: 7 }),
          L({ name: "MUROS", color: 1 }),
          L({ name: "EJES", color: 2, ltype: "TRAZOS" }),
          L({ name: "COTAS", color: 3 }),
          L({ name: "CONGELADA", color: 4, flags: 1 }),
          L({ name: "BLOQUEADA", color: 5, flags: 4 }),
          L({ name: "TEXTOS", color: 6 }),
        ]);
      });
      d.section("ENTITIES", () => {
        line(d, { layer: "MUROS", from: [0, 0], to: [50, 0] });
        line(d, { layer: "EJES", from: [0, 10], to: [50, 10] });
        line(d, { layer: "COTAS", from: [0, 20], to: [50, 20] });
        line(d, { layer: "CONGELADA", from: [0, 30], to: [50, 30] });
        line(d, { layer: "BLOQUEADA", from: [0, 40], to: [50, 40] });
        circle(d, { layer: "TEXTOS", center: [25, 60], radius: 8 });
      });
    },
  },
  {
    name: "05-lwpolyline-bulges",
    intent:
      "Polilíneas 2D: rectángulo cerrado con bulge 0.5 en un segmento y trazo abierto con ancho constante 2. Al guardarse como DWG moderno se convierten en LWPOLYLINE.",
    build: (d) => {
      d.section("ENTITIES", () => {
        polyline(d, {
          closed: true,
          vertices: [
            [0, 0],
            [60, 0, 0.5],
            [60, 40],
            [0, 40],
          ],
        });
        polyline(d, {
          width: 2,
          vertices: [
            [10, 60],
            [30, 80],
            [50, 60],
          ],
        });
      });
    },
  },
  {
    name: "06-texto",
    intent:
      "TEXT con estilos: STANDARD, ESTILO-VALLE y ROTULOS (factor de anchura 0.8); alturas y rotación conocidas.",
    build: (d) => {
      d.section("TABLES", () => {
        const S = styleEntry(d);
        d.table("STYLE", [
          S({ name: "STANDARD" }),
          S({ name: "ESTILO-VALLE" }),
          S({ name: "ROTULOS", widthFactor: 0.8 }),
        ]);
      });
      d.section("ENTITIES", () => {
        text(d, { at: [10, 10], height: 5, value: "VALLE DESIGN" });
        text(d, {
          at: [10, 30],
          height: 7,
          value: "PLANTA BAJA",
          rotation: 15,
          style: "ESTILO-VALLE",
        });
        text(d, {
          at: [10, 50],
          height: 4,
          value: "CORTE A-A",
          style: "ROTULOS",
          widthFactor: 0.8,
        });
      });
    },
  },
  {
    name: "07-bloques-insert",
    intent:
      "Bloque MARCO-A (cuatro LINE + un CIRCLE) e INSERTs trasladado, rotado 30, escalado 2x1.5 y rotado+escalado.",
    build: (d) => {
      d.section("BLOCKS", () => {
        block(d, {
          name: "MARCO-A",
          entities: [
            (dd) => line(dd, { from: [0, 0], to: [20, 0] }),
            (dd) => line(dd, { from: [20, 0], to: [20, 10] }),
            (dd) => line(dd, { from: [20, 10], to: [0, 10] }),
            (dd) => line(dd, { from: [0, 10], to: [0, 0] }),
            (dd) => circle(dd, { center: [10, 5], radius: 3 }),
          ],
        });
      });
      d.section("ENTITIES", () => {
        insert(d, { block: "MARCO-A", at: [10, 10] });
        insert(d, { block: "MARCO-A", at: [50, 10], rotation: 30 });
        insert(d, { block: "MARCO-A", at: [90, 10], scale: [2, 1.5, 1] });
        insert(d, { block: "MARCO-A", at: [10, 40], scale: [0.5, 0.5, 1], rotation: 90 });
      });
    },
  },
  {
    name: "08-plano-mini",
    intent:
      "Plantita mínima que combina capas, polilínea cerrada de muros, tabique, puerta como bloque insertado dos veces y rótulos de texto.",
    build: (d) => {
      d.section("TABLES", () => {
        d.table("LTYPE", [LTYPE_CONTINUOUS(d), LTYPE_TRAZOS(d)]);
        const L = layerEntry(d);
        d.table("LAYER", [
          L({ name: "0", color: 7 }),
          L({ name: "MUROS", color: 1 }),
          L({ name: "PUERTAS", color: 4 }),
          L({ name: "TEXTOS", color: 6 }),
          L({ name: "EJES", color: 2, ltype: "TRAZOS" }),
        ]);
      });
      d.section("BLOCKS", () => {
        block(d, {
          name: "PUERTA",
          entities: [
            (dd) => line(dd, { layer: "PUERTAS", from: [0, 0], to: [0, 9] }),
            (dd) =>
              arc(dd, { layer: "PUERTAS", center: [0, 0], radius: 9, start: 270, end: 0 }),
          ],
        });
      });
      d.section("ENTITIES", () => {
        polyline(d, {
          layer: "MUROS",
          closed: true,
          vertices: [
            [0, 0],
            [120, 0],
            [120, 90],
            [0, 90],
          ],
        });
        line(d, { layer: "MUROS", from: [60, 0], to: [60, 35] });
        line(d, { layer: "MUROS", from: [60, 55], to: [60, 90] });
        insert(d, { layer: "PUERTAS", block: "PUERTA", at: [60, 55], rotation: 0 });
        insert(d, {
          layer: "PUERTAS",
          block: "PUERTA",
          at: [60, 35],
          scale: [1, 1, 1],
          rotation: 90,
        });
        text(d, { layer: "TEXTOS", at: [20, 45], height: 5, value: "SALA" });
        text(d, { layer: "TEXTOS", at: [80, 45], height: 5, value: "COCINA" });
        line(d, { layer: "EJES", from: [-10, 45], to: [130, 45] });
      });
    },
  },
];

/** Serializa un dibujo a texto DXF (LF, determinista). */
export function renderDrawing(drawing) {
  const d = new Dxf();
  d.section("HEADER", () => {
    d.tag(9, "$ACADVER").tag(1, "AC1009");
  });
  drawing.build(d);
  return d.toString();
}

export async function writeDrawings(outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const drawing of DRAWINGS) {
    const file = resolve(outDir, `${drawing.name}.dxf`);
    await writeFile(file, renderDrawing(drawing), { encoding: "utf8" });
    written.push(file);
  }
  return written;
}

// --- CLI ----------------------------------------------------------------------

const outFlag = process.argv.indexOf("--out");
if (outFlag > -1) {
  const outDir = process.argv[outFlag + 1];
  if (!outDir) {
    process.stderr.write("Uso: node scripts/generate-foundational-dxf.mjs --out <directorio>\n");
    process.exit(1);
  }
  const files = await writeDrawings(resolve(outDir));
  process.stdout.write(`${files.length} DXF fundacionales escritos en ${resolve(outDir)}\n`);
} else if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())) {
  process.stdout.write("Uso: node scripts/generate-foundational-dxf.mjs --out <directorio>\n");
}
