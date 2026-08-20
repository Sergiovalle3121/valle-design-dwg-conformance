#!/usr/bin/env node

// Generador de la OLA DE ENTIDADES del corpus (dibujos 09–15): siete dibujos
// escalonados de autoría propia (Valle Design / Sergio Valle Zárate) que
// ejercitan los tipos de la siguiente ola del decoder — MTEXT, DIMENSION con
// DIMSTYLE propio, HATCH, ATTDEF/ATTRIB, POLYLINE 2D/3D pesada, ELLIPSE,
// SPLINE, LTYPE personalizado y STYLE con oblicuo.
//
// Por qué DXF ASCII dialecto AC1015 (y no el R12 del corpus fundacional): las
// entidades de esta ola no existen en R12 — el lector R12 de la herramienta
// conversora reconoce el nombre MTEXT pero descarta sus grupos (verificado
// empíricamente el 2026-08-20). El dialecto 2000 exige un esqueleto mínimo
// (tablas con handles, bloques *Model_Space/*Paper_Space y el diccionario
// raíz); este archivo lo emite determinista y auditable línea a línea.
//
// Determinismo: mismo código → mismos bytes (LF, sin fechas, sin aleatoriedad,
// handles asignados secuencialmente). El SHA-256 de cada DXF queda congelado
// en el manifiesto de su bundle.
//
// Contenido 100% original: composiciones geométricas sencillas diseñadas para
// ejercitar tipos de entidad concretos. Sin datos de clientes ni material de
// terceros.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Formatea un real como lo esperan los parsers DXF clásicos. */
const real = (value) => {
  if (!Number.isFinite(value)) throw new Error(`real no finito: ${value}`);
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
};

// --- escritor de pares y asignador de handles --------------------------------

class Dxf2000 {
  constructor() {
    this.pairs = [];
    // Los handles fijos del esqueleto viven por debajo de 0x100; el contenido
    // de cada dibujo arranca en 0x100. $HANDSEED queda muy por encima.
    this.nextHandle = 0x100;
  }
  tag(code, value) {
    this.pairs.push([code, value]);
    return this;
  }
  handle() {
    const value = this.nextHandle.toString(16).toUpperCase();
    this.nextHandle += 1;
    return value;
  }
  point(baseCode, x, y, z) {
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
  toString() {
    const lines = [];
    for (const [code, value] of this.pairs) {
      lines.push(String(code), String(value));
    }
    lines.push("0", "EOF", "");
    return lines.join("\n");
  }
}

// --- esqueleto AC1015 ---------------------------------------------------------

/** Handles fijos del esqueleto (hex), estables entre dibujos. */
const H = {
  blockRecordTable: "1",
  layerTable: "2",
  styleTable: "3",
  ltypeTable: "5",
  viewTable: "6",
  ucsTable: "7",
  vportTable: "8",
  appidTable: "9",
  dimstyleTable: "A",
  rootDictionary: "C",
  groupDictionary: "D",
  ltypeByBlock: "14",
  ltypeByLayer: "15",
  ltypeContinuous: "16",
  layerZero: "10",
  styleStandard: "11",
  appidAcad: "12",
  dimstyleStandard: "27",
  modelSpaceRecord: "1F",
  paperSpaceRecord: "1B",
  modelSpaceBlock: "20",
  modelSpaceEndblk: "21",
  paperSpaceBlock: "1C",
  paperSpaceEndblk: "1D",
};

const tableHead = (d, name, handle, count) => {
  d.tag(0, "TABLE").tag(2, name).tag(5, handle).tag(100, "AcDbSymbolTable");
  d.tag(70, count);
};

const tableRecord = (d, kind, handle, subclass) => {
  d.tag(0, kind).tag(kind === "DIMSTYLE" ? 105 : 5, handle);
  d.tag(100, "AcDbSymbolTableRecord").tag(100, subclass);
};

const ltypeEntry = (d, handle, { name, description, pattern }) => {
  tableRecord(d, "LTYPE", handle, "AcDbLinetypeTableRecord");
  d.tag(2, name).tag(70, 0).tag(3, description).tag(72, 65);
  d.tag(73, pattern.length);
  d.tag(40, real(pattern.reduce((sum, dash) => sum + Math.abs(dash), 0)));
  for (const dash of pattern) d.tag(49, real(dash)).tag(74, 0);
};

const layerEntry = (d, handle, { name, color, ltype = "CONTINUOUS", flags = 0 }) => {
  tableRecord(d, "LAYER", handle, "AcDbLayerTableRecord");
  d.tag(2, name).tag(70, flags).tag(62, color).tag(6, ltype);
};

const styleEntry = (
  d,
  handle,
  { name, font = "txt", widthFactor = 1, oblique = 0 },
) => {
  tableRecord(d, "STYLE", handle, "AcDbTextStyleTableRecord");
  d.tag(2, name).tag(70, 0).tag(40, "0.0").tag(41, real(widthFactor));
  d.tag(50, real(oblique)).tag(71, 0).tag(42, "2.5").tag(3, font).tag(4, "");
};

/**
 * Variables de acotación de un DIMSTYLE propio: pares [código DXF, valor].
 * Sólo variables numéricas sencillas — suficientes para que el decoder tenga
 * valores reales distintos del defecto que contrastar.
 */
const dimstyleEntry = (d, handle, { name, variables = [] }) => {
  tableRecord(d, "DIMSTYLE", handle, "AcDbDimStyleTableRecord");
  d.tag(2, name).tag(70, 0);
  for (const [code, value] of variables) d.tag(code, value);
};

const blockRecordEntry = (d, handle, name) => {
  tableRecord(d, "BLOCK_RECORD", handle, "AcDbBlockTableRecord");
  d.tag(2, name);
};

/**
 * El esqueleto completo de un DXF 2000: HEADER, TABLES (con las entradas
 * extra que pida el dibujo), BLOCKS (espacios modelo/papel + bloques de
 * usuario) y el diccionario raíz. `blocks` es una lista
 * {name, recordHandle, base, entities} y cada emisor de entidad recibe el
 * writer y el handle del BLOCK_RECORD dueño.
 */
function skeleton(d, { ltypes = [], layers = [], styles = [], dimstyles = [], blocks = [] }) {
  d.section("HEADER", () => {
    d.tag(9, "$ACADVER").tag(1, "AC1015");
    d.tag(9, "$HANDSEED").tag(5, "FFFF");
  });
  d.section("TABLES", () => {
    tableHead(d, "VPORT", H.vportTable, 0);
    d.tag(0, "ENDTAB");

    tableHead(d, "LTYPE", H.ltypeTable, 3 + ltypes.length);
    ltypeEntry(d, H.ltypeByBlock, { name: "ByBlock", description: "", pattern: [] });
    ltypeEntry(d, H.ltypeByLayer, { name: "ByLayer", description: "", pattern: [] });
    ltypeEntry(d, H.ltypeContinuous, {
      name: "CONTINUOUS",
      description: "Linea continua",
      pattern: [],
    });
    for (const ltype of ltypes) ltypeEntry(d, d.handle(), ltype);
    d.tag(0, "ENDTAB");

    tableHead(d, "LAYER", H.layerTable, 1 + layers.length);
    layerEntry(d, H.layerZero, { name: "0", color: 7 });
    for (const layer of layers) layerEntry(d, d.handle(), layer);
    d.tag(0, "ENDTAB");

    tableHead(d, "STYLE", H.styleTable, 1 + styles.length);
    styleEntry(d, H.styleStandard, { name: "STANDARD" });
    for (const style of styles) styleEntry(d, d.handle(), style);
    d.tag(0, "ENDTAB");

    tableHead(d, "VIEW", H.viewTable, 0);
    d.tag(0, "ENDTAB");
    tableHead(d, "UCS", H.ucsTable, 0);
    d.tag(0, "ENDTAB");

    tableHead(d, "APPID", H.appidTable, 1);
    tableRecord(d, "APPID", H.appidAcad, "AcDbRegAppTableRecord");
    d.tag(2, "ACAD").tag(70, 0);
    d.tag(0, "ENDTAB");

    tableHead(d, "DIMSTYLE", H.dimstyleTable, 1 + dimstyles.length);
    dimstyleEntry(d, H.dimstyleStandard, { name: "STANDARD" });
    for (const dimstyle of dimstyles) dimstyleEntry(d, d.handle(), dimstyle);
    d.tag(0, "ENDTAB");

    tableHead(d, "BLOCK_RECORD", H.blockRecordTable, 2 + blocks.length);
    blockRecordEntry(d, H.modelSpaceRecord, "*Model_Space");
    blockRecordEntry(d, H.paperSpaceRecord, "*Paper_Space");
    for (const block of blocks) blockRecordEntry(d, block.recordHandle, block.name);
    d.tag(0, "ENDTAB");
  });
  d.section("BLOCKS", () => {
    spaceBlock(d, "*Model_Space", H.modelSpaceRecord, H.modelSpaceBlock, H.modelSpaceEndblk, false);
    spaceBlock(d, "*Paper_Space", H.paperSpaceRecord, H.paperSpaceBlock, H.paperSpaceEndblk, true);
    for (const block of blocks) {
      d.tag(0, "BLOCK").tag(5, d.handle()).tag(330, block.recordHandle);
      d.tag(100, "AcDbEntity").tag(8, "0").tag(100, "AcDbBlockBegin");
      d.tag(2, block.name).tag(70, block.hasAttdefs ? 2 : 0);
      d.point(10, block.base?.[0] ?? 0, block.base?.[1] ?? 0, 0);
      d.tag(3, block.name).tag(1, "");
      for (const emit of block.entities) emit(d, block.recordHandle);
      d.tag(0, "ENDBLK").tag(5, d.handle()).tag(330, block.recordHandle);
      d.tag(100, "AcDbEntity").tag(8, "0").tag(100, "AcDbBlockEnd");
    }
  });
}

const spaceBlock = (d, name, recordHandle, blockHandle, endblkHandle, paper) => {
  d.tag(0, "BLOCK").tag(5, blockHandle).tag(330, recordHandle);
  d.tag(100, "AcDbEntity");
  if (paper) d.tag(67, 1);
  d.tag(8, "0").tag(100, "AcDbBlockBegin");
  d.tag(2, name).tag(70, 0).point(10, 0, 0, 0).tag(3, name).tag(1, "");
  d.tag(0, "ENDBLK").tag(5, endblkHandle).tag(330, recordHandle);
  d.tag(100, "AcDbEntity");
  if (paper) d.tag(67, 1);
  d.tag(8, "0").tag(100, "AcDbBlockEnd");
};

const objectsSection = (d) => {
  d.section("OBJECTS", () => {
    d.tag(0, "DICTIONARY").tag(5, H.rootDictionary).tag(330, "0");
    d.tag(100, "AcDbDictionary").tag(281, 1);
    d.tag(3, "ACAD_GROUP").tag(350, H.groupDictionary);
    d.tag(0, "DICTIONARY").tag(5, H.groupDictionary).tag(330, H.rootDictionary);
    d.tag(100, "AcDbDictionary").tag(281, 1);
  });
};

// --- emisores de entidad (dialecto 2000) --------------------------------------

/** Prólogo común: nombre, handle propio, dueño y capa. Devuelve el handle. */
const entity = (d, kind, owner, layer) => {
  const handle = d.handle();
  d.tag(0, kind).tag(5, handle).tag(330, owner);
  d.tag(100, "AcDbEntity").tag(8, layer);
  return handle;
};

const line = (d, owner, { layer = "0", from, to }) => {
  entity(d, "LINE", owner, layer);
  d.tag(100, "AcDbLine");
  d.point(10, from[0], from[1], from[2] ?? 0).point(11, to[0], to[1], to[2] ?? 0);
};

const text = (d, owner, { layer = "0", at, height, value, rotation, style, widthFactor }) => {
  entity(d, "TEXT", owner, layer);
  d.tag(100, "AcDbText").point(10, at[0], at[1], 0);
  d.tag(40, real(height)).tag(1, value);
  if (rotation !== undefined) d.tag(50, real(rotation));
  if (widthFactor !== undefined) d.tag(41, real(widthFactor));
  if (style !== undefined) d.tag(7, style);
  d.tag(100, "AcDbText");
};

const mtext = (
  d,
  owner,
  { layer = "0", at, height, width, value, attachment = 1, rotation },
) => {
  entity(d, "MTEXT", owner, layer);
  d.tag(100, "AcDbMText").point(10, at[0], at[1], 0);
  d.tag(40, real(height)).tag(41, real(width));
  d.tag(71, attachment).tag(72, 1).tag(1, value);
  if (rotation !== undefined) d.tag(50, real(rotation));
};

/**
 * DIMENSION: bloque anónimo omitido a propósito — la herramienta conversora lo
 * regenera con audit y el DWG resultante lleva su bloque *D real. El grupo 70
 * lleva el subtipo más el bit 32 (referencia de bloque), como escriben las
 * implementaciones reales.
 */
const dimensionCommon = (d, owner, layer, { type, defPoint, textMid, style }) => {
  entity(d, "DIMENSION", owner, layer);
  d.tag(100, "AcDbDimension");
  d.point(10, defPoint[0], defPoint[1], 0);
  if (textMid) d.point(11, textMid[0], textMid[1], 0);
  d.tag(70, type + 32).tag(3, style);
};

const dimLinear = (d, owner, { layer, from, to, defPoint, textMid, style, angle = 0 }) => {
  dimensionCommon(d, owner, layer, { type: 0, defPoint, textMid, style });
  d.tag(100, "AcDbAlignedDimension");
  d.point(13, from[0], from[1], 0).point(14, to[0], to[1], 0);
  d.tag(50, real(angle));
  d.tag(100, "AcDbRotatedDimension");
};

const dimAligned = (d, owner, { layer, from, to, defPoint, textMid, style }) => {
  dimensionCommon(d, owner, layer, { type: 1, defPoint, textMid, style });
  d.tag(100, "AcDbAlignedDimension");
  d.point(13, from[0], from[1], 0).point(14, to[0], to[1], 0);
};

const dimAngular3Point = (
  d,
  owner,
  { layer, vertex, firstRay, secondRay, defPoint, textMid, style },
) => {
  dimensionCommon(d, owner, layer, { type: 5, defPoint, textMid, style });
  d.tag(100, "AcDb3PointAngularDimension");
  d.point(13, firstRay[0], firstRay[1], 0).point(14, secondRay[0], secondRay[1], 0);
  d.point(15, vertex[0], vertex[1], 0);
};

/** HATCH sólido o de patrón, con caminos de tipo polilínea. */
const hatch = (
  d,
  owner,
  { layer = "0", pattern, solid, angle = 0, scale = 1, definitionLines = [], paths },
) => {
  entity(d, "HATCH", owner, layer);
  d.tag(100, "AcDbHatch").point(10, 0, 0, 0).tag(210, "0.0").tag(220, "0.0").tag(230, "1.0");
  d.tag(2, pattern).tag(70, solid ? 1 : 0).tag(71, 0);
  d.tag(91, paths.length);
  for (const path of paths) {
    // 92: 1 externo | 2 polilínea | 16 exterior; una isla viaja sólo como 2.
    d.tag(92, path.external ? 3 : 2);
    d.tag(72, 0).tag(73, 1).tag(93, path.vertices.length);
    for (const [x, y] of path.vertices) d.point(10, x, y);
    d.tag(97, 0);
  }
  d.tag(75, 0).tag(76, 1);
  if (!solid) {
    d.tag(52, real(angle)).tag(41, real(scale)).tag(77, 0);
    d.tag(78, definitionLines.length);
    for (const defLine of definitionLines) {
      d.tag(53, real(defLine.angle));
      d.tag(43, real(defLine.base[0])).tag(44, real(defLine.base[1]));
      d.tag(45, real(defLine.offset[0])).tag(46, real(defLine.offset[1]));
      d.tag(79, defLine.dashes?.length ?? 0);
      for (const dash of defLine.dashes ?? []) d.tag(49, real(dash));
    }
  }
  d.tag(98, 0);
};

const attdef = (d, owner, { layer = "0", at, height, prompt, tag, value, flags = 0 }) => {
  entity(d, "ATTDEF", owner, layer);
  d.tag(100, "AcDbText").point(10, at[0], at[1], 0);
  d.tag(40, real(height)).tag(1, value);
  d.tag(100, "AcDbAttributeDefinition").tag(3, prompt).tag(2, tag).tag(70, flags);
};

const attrib = (d, owner, { layer = "0", at, height, tag, value, flags = 0 }) => {
  entity(d, "ATTRIB", owner, layer);
  d.tag(100, "AcDbText").point(10, at[0], at[1], 0);
  d.tag(40, real(height)).tag(1, value);
  d.tag(100, "AcDbAttribute").tag(2, tag).tag(70, flags);
};

/** INSERT; con `attributes` emite 66=1, los ATTRIB y su SEQEND. */
const insert = (d, owner, { layer = "0", block, at, scale, rotation, attributes }) => {
  entity(d, "INSERT", owner, layer);
  d.tag(100, "AcDbBlockReference");
  if (attributes) d.tag(66, 1);
  d.tag(2, block).point(10, at[0], at[1], 0);
  if (scale !== undefined) {
    d.tag(41, real(scale[0])).tag(42, real(scale[1])).tag(43, real(scale[2] ?? 1));
  }
  if (rotation !== undefined) d.tag(50, real(rotation));
  for (const item of attributes ?? []) attrib(d, owner, { layer, ...item });
  if (attributes) {
    entity(d, "SEQEND", owner, layer);
  }
};

/**
 * POLYLINE pesada. `mode`: "2d" (AcDb2dPolyline) o "3d" (AcDb3dPolyline).
 * `flags` va crudo al grupo 70 (1 cerrada, 2 curve-fit, 8 polilínea 3D);
 * los vértices son [x, y, z?, bulge?].
 */
const heavyPolyline = (d, owner, { layer = "0", mode, flags, width, vertices }) => {
  entity(d, "POLYLINE", owner, layer);
  d.tag(100, mode === "3d" ? "AcDb3dPolyline" : "AcDb2dPolyline");
  d.tag(66, 1).point(10, 0, 0, 0).tag(70, flags);
  if (width !== undefined) d.tag(40, real(width)).tag(41, real(width));
  for (const [x, y, z, bulge] of vertices) {
    entity(d, "VERTEX", owner, layer);
    d.tag(100, "AcDbVertex");
    d.tag(100, mode === "3d" ? "AcDb3dPolylineVertex" : "AcDb2dVertex");
    d.point(10, x, y, z ?? 0);
    if (bulge !== undefined && bulge !== 0) d.tag(42, real(bulge));
    d.tag(70, mode === "3d" ? 32 : 0);
  }
  entity(d, "SEQEND", owner, layer);
};

/** ELLIPSE completa o arco elíptico; ángulos paramétricos en RADIANES. */
const ellipse = (d, owner, { layer = "0", center, majorAxis, ratio, start = 0, end = 6.283185307179586 }) => {
  entity(d, "ELLIPSE", owner, layer);
  d.tag(100, "AcDbEllipse");
  d.point(10, center[0], center[1], 0).point(11, majorAxis[0], majorAxis[1], 0);
  d.tag(40, real(ratio)).tag(41, real(start)).tag(42, real(end));
};

/** SPLINE NURBS abierta con nudos explícitos. `flags` 8 = plana. */
const spline = (d, owner, { layer = "0", degree, knots, controlPoints, flags = 8 }) => {
  entity(d, "SPLINE", owner, layer);
  d.tag(100, "AcDbSpline");
  d.tag(70, flags).tag(71, degree);
  d.tag(72, knots.length).tag(73, controlPoints.length).tag(74, 0);
  for (const knot of knots) d.tag(40, real(knot));
  for (const [x, y] of controlPoints) d.point(10, x, y, 0);
};

// --- los siete dibujos de la ola ----------------------------------------------

/** Offset del vector de ANSI31 a escala 1: 0.125·(cos135°, sin135°). */
const ANSI31_OFFSET = [-0.0883883476483184, 0.0883883476483184];

export const ENTITY_DRAWINGS = [
  {
    name: "09-mtext",
    intent:
      "Tres MTEXT en TEXTOS: párrafos con \\P y alturas 5/7/2.5, anchos de referencia distintos, un anclaje middle-center y una rotación de 30 grados.",
    content: {
      layers: [{ name: "TEXTOS", color: 6 }],
      model: (d, owner) => {
        mtext(d, owner, {
          layer: "TEXTOS",
          at: [10, 80],
          height: 5,
          width: 140,
          value: "NOTAS GENERALES\\P1. COTAS EN CENTIMETROS\\P2. VERIFICAR EN OBRA",
        });
        mtext(d, owner, {
          layer: "TEXTOS",
          at: [10, 120],
          height: 7,
          width: 200,
          value: "PLANTA ARQUITECTONICA",
        });
        mtext(d, owner, {
          layer: "TEXTOS",
          at: [120, 40],
          height: 2.5,
          width: 60,
          attachment: 5,
          rotation: 30,
          value: "DETALLE\\PESCALERA",
        });
      },
    },
  },
  {
    name: "10-dimension",
    intent:
      "DIMENSION lineal, alineada y angular de 3 puntos sobre dos LINE guía, todas con el DIMSTYLE propio VALLE-COTAS (texto 4, flechas 3.5, extensiones 2/1).",
    content: {
      layers: [{ name: "COTAS", color: 3 }],
      dimstyles: [
        {
          name: "VALLE-COTAS",
          variables: [
            [40, "1.0"], // DIMSCALE
            [41, "3.5"], // DIMASZ
            [42, "1.0"], // DIMEXO
            [44, "2.0"], // DIMEXE
            [140, "4.0"], // DIMTXT
            [147, "1.5"], // DIMGAP
          ],
        },
      ],
      model: (d, owner) => {
        line(d, owner, { from: [0, 0], to: [100, 0] });
        line(d, owner, { from: [0, 0], to: [60, 45] });
        dimLinear(d, owner, {
          layer: "COTAS",
          from: [0, 0],
          to: [100, 0],
          defPoint: [100, -15],
          textMid: [50, -15],
          style: "VALLE-COTAS",
        });
        dimAligned(d, owner, {
          layer: "COTAS",
          from: [0, 0],
          to: [60, 45],
          defPoint: [51, 57],
          textMid: [25.5, 28.5],
          style: "VALLE-COTAS",
        });
        dimAngular3Point(d, owner, {
          layer: "COTAS",
          vertex: [0, 0],
          firstRay: [100, 0],
          secondRay: [60, 45],
          defPoint: [30, 12],
          textMid: [32, 13],
          style: "VALLE-COTAS",
        });
      },
    },
  },
  {
    name: "11-hatch",
    intent:
      "HATCH sólido en un cuadrado y HATCH ANSI31 a 45 grados con isla rectangular sin sombrear (dos caminos de polilínea, paridad normal).",
    content: {
      layers: [{ name: "MUROS", color: 1 }],
      model: (d, owner) => {
        hatch(d, owner, {
          layer: "MUROS",
          pattern: "SOLID",
          solid: true,
          paths: [
            {
              external: true,
              vertices: [
                [200, 0],
                [240, 0],
                [240, 40],
                [200, 40],
              ],
            },
          ],
        });
        hatch(d, owner, {
          layer: "MUROS",
          pattern: "ANSI31",
          solid: false,
          angle: 0,
          scale: 1,
          definitionLines: [
            { angle: 45, base: [0, 0], offset: ANSI31_OFFSET, dashes: [] },
          ],
          paths: [
            {
              external: true,
              vertices: [
                [0, 0],
                [80, 0],
                [80, 80],
                [0, 80],
              ],
            },
            {
              external: false,
              vertices: [
                [30, 30],
                [50, 30],
                [50, 50],
                [30, 50],
              ],
            },
          ],
        });
      },
    },
  },
  {
    name: "12-attrib",
    intent:
      "Bloque CAJETIN (marco de rótulo con dos ATTDEF: PLANO y ESCALA) insertado dos veces con ATTRIB de valores distintos y SEQEND.",
    content: {
      layers: [{ name: "TEXTOS", color: 6 }],
      blocks: [
        {
          name: "CAJETIN",
          hasAttdefs: true,
          entities: [
            (d, owner) => line(d, owner, { from: [0, 0], to: [90, 0] }),
            (d, owner) => line(d, owner, { from: [90, 0], to: [90, 30] }),
            (d, owner) => line(d, owner, { from: [90, 30], to: [0, 30] }),
            (d, owner) => line(d, owner, { from: [0, 30], to: [0, 0] }),
            (d, owner) => line(d, owner, { from: [0, 15], to: [90, 15] }),
            (d, owner) =>
              attdef(d, owner, {
                layer: "TEXTOS",
                at: [5, 20],
                height: 5,
                prompt: "Nombre del plano",
                tag: "PLANO",
                value: "SIN NOMBRE",
              }),
            (d, owner) =>
              attdef(d, owner, {
                layer: "TEXTOS",
                at: [5, 5],
                height: 4,
                prompt: "Escala",
                tag: "ESCALA",
                value: "1:100",
              }),
          ],
        },
      ],
      model: (d, owner, blocks) => {
        insert(d, owner, {
          block: "CAJETIN",
          at: [10, 10],
          attributes: [
            { layer: "TEXTOS", at: [15, 30], height: 5, tag: "PLANO", value: "PLANTA BAJA" },
            { layer: "TEXTOS", at: [15, 15], height: 4, tag: "ESCALA", value: "1:50" },
          ],
        });
        insert(d, owner, {
          block: "CAJETIN",
          at: [150, 10],
          attributes: [
            { layer: "TEXTOS", at: [155, 30], height: 5, tag: "PLANO", value: "CORTE A-A" },
            { layer: "TEXTOS", at: [155, 15], height: 4, tag: "ESCALA", value: "1:100" },
          ],
        });
        void blocks;
      },
    },
  },
  {
    name: "13-polyline2d",
    intent:
      "POLYLINE pesada: una 2D abierta con ancho constante 2 y bulge, una 2D cerrada con curve-fit (bandera 2) y una 3D cerrada con Z reales — formas que no caben en una LWPOLYLINE.",
    content: {
      layers: [{ name: "MUROS", color: 1 }],
      model: (d, owner) => {
        heavyPolyline(d, owner, {
          layer: "MUROS",
          mode: "2d",
          flags: 0,
          width: 2,
          vertices: [
            [0, 0],
            [40, 0, 0, 0.5],
            [80, 0],
            [80, 40],
          ],
        });
        heavyPolyline(d, owner, {
          layer: "MUROS",
          mode: "2d",
          flags: 3,
          vertices: [
            [120, 0],
            [160, 10],
            [200, 0],
            [180, 40],
            [140, 40],
          ],
        });
        heavyPolyline(d, owner, {
          layer: "MUROS",
          mode: "3d",
          flags: 9,
          vertices: [
            [0, 80, 0],
            [40, 80, 10],
            [40, 120, 20],
            [0, 120, 5],
          ],
        });
      },
    },
  },
  {
    name: "14-ellipse-spline",
    intent:
      "ELLIPSE completa (ratio 0.5), arco elíptico de 30 a 210 grados paramétricos y SPLINE NURBS plana de grado 3 con 8 puntos de control y nudos abiertos.",
    content: {
      layers: [{ name: "EJES", color: 2 }],
      model: (d, owner) => {
        ellipse(d, owner, {
          layer: "EJES",
          center: [40, 30],
          majorAxis: [30, 0],
          ratio: 0.5,
        });
        ellipse(d, owner, {
          layer: "EJES",
          center: [120, 30],
          majorAxis: [25, 0],
          ratio: 0.6,
          start: 0.5235987755982988,
          end: 3.665191429188092,
        });
        spline(d, owner, {
          layer: "EJES",
          degree: 3,
          knots: [0, 0, 0, 0, 1, 2, 3, 4, 5, 5, 5, 5],
          controlPoints: [
            [0, 100],
            [20, 130],
            [40, 100],
            [60, 70],
            [80, 100],
            [100, 130],
            [120, 100],
            [140, 85],
          ],
        });
      },
    },
  },
  {
    name: "15-ltype-style",
    intent:
      "LTYPE propio TRAZOS-VALLE (raya-punto-raya) aplicado a la capa EJES y STYLE ROTULOS-OBLICUOS con oblicuo de 15 grados y factor 0.9 usado por un TEXT.",
    content: {
      ltypes: [
        {
          name: "TRAZOS-VALLE",
          description: "Raya punto raya - . -",
          pattern: [0.75, -0.125, 0, -0.125],
        },
      ],
      layers: [
        { name: "EJES", color: 2, ltype: "TRAZOS-VALLE" },
        { name: "TEXTOS", color: 6 },
      ],
      styles: [
        { name: "ROTULOS-OBLICUOS", widthFactor: 0.9, oblique: 15 },
      ],
      model: (d, owner) => {
        line(d, owner, { layer: "EJES", from: [0, 0], to: [200, 0] });
        line(d, owner, { layer: "EJES", from: [100, -50], to: [100, 50] });
        text(d, owner, {
          layer: "TEXTOS",
          at: [10, 10],
          height: 6,
          value: "EJE PRINCIPAL",
          style: "ROTULOS-OBLICUOS",
          widthFactor: 0.9,
        });
      },
    },
  },
];

/** Serializa un dibujo de la ola a texto DXF 2000 (LF, determinista). */
export function renderEntityDrawing(drawing) {
  const d = new Dxf2000();
  const content = drawing.content;
  const blocks = (content.blocks ?? []).map((block) => ({
    ...block,
    recordHandle: d.handle(),
  }));
  skeleton(d, { ...content, blocks });
  d.section("ENTITIES", () => {
    content.model(d, H.modelSpaceRecord, blocks);
  });
  objectsSection(d);
  return d.toString();
}

export async function writeEntityDrawings(outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const drawing of ENTITY_DRAWINGS) {
    const file = resolve(outDir, `${drawing.name}.dxf`);
    await writeFile(file, renderEntityDrawing(drawing), { encoding: "utf8" });
    written.push(file);
  }
  return written;
}

// --- CLI ----------------------------------------------------------------------

const outFlag = process.argv.indexOf("--out");
if (outFlag > -1) {
  const outDir = process.argv[outFlag + 1];
  if (!outDir) {
    process.stderr.write("Uso: node scripts/generate-entity-dxf.mjs --out <directorio>\n");
    process.exit(1);
  }
  const files = await writeEntityDrawings(resolve(outDir));
  process.stdout.write(`${files.length} DXF de la ola de entidades escritos en ${resolve(outDir)}\n`);
}
