#!/usr/bin/env node

// Generador de la SEGUNDA OLA DE ENTIDADES del corpus (dibujos 16–25): diez
// dibujos escalonados de autoría propia (Valle Design / Sergio Valle Zárate)
// que ejercitan los tipos de la siguiente ola del decoder — LEADER/TOLERANCE,
// RAY/XLINE, SOLID/TRACE/3DFACE, DIMENSION radial/diametral/ordinate/angular,
// HATCH con isla circular, bloques anidados con ATTDEF/ATTRIB, LAYOUT de papel
// con VIEWPORT, MLINE con MLINESTYLE propio y mallas POLYLINE (mesh y pface)
// con sus VERTEX.
//
// Compone sobre el dialecto 2000 EXPORTADO por generate-entity-dxf.mjs
// (writer, esqueleto de tablas con handles fijos, emisores comunes). Los
// dibujos 09–15 no cambian ni un byte: este módulo sólo añade emisores para
// los tipos nuevos y dos ganchos que el esqueleto de la ola 1 no necesitaba —
// entidades de espacio papel (bandera 67) y una sección OBJECTS propia
// (diccionario ACAD_MLINESTYLE con su MLINESTYLE).
//
// Determinismo y autoría: mismas reglas que la ola 1 — mismo código → mismos
// bytes (LF, sin fechas, sin aleatoriedad, handles secuenciales desde 0x100) y
// contenido 100% original sin datos de clientes ni material de terceros.
//
// Decisiones registradas tras sondear la herramienta conversora 27.1:
// - DIMENSION: igual que en la ola 1, el bloque anónimo *D se omite a
//   propósito y el audit del conversor lo regenera.
// - LAYOUT/PLOTSETTINGS: no se escriben en OBJECTS; el audit del conversor
//   regenera los objetos LAYOUT a partir de las entidades de espacio papel.
// - HATCH de gradiente: FUERA de la ola (ver DOCUMENTED_EXCLUSIONS) — el
//   conversor acepta los grupos 450–470 sin error pero el DWG ACAD2000 no los
//   conserva; el round-trip devuelve un HATCH sólido plano.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Dxf2000,
  H,
  attdef,
  dimensionCommon,
  dimAngular3Point,
  entity,
  insert,
  line,
  objectsSection,
  real,
  skeleton,
} from "./generate-entity-dxf.mjs";

// --- emisores nuevos de la ola 2 ---------------------------------------------

/**
 * Prólogo de entidad de ESPACIO PAPEL: como `entity`, pero con la bandera 67
 * entre AcDbEntity y la capa, igual que el esqueleto la escribe en
 * *Paper_Space. Devuelve el handle.
 */
const paperEntity = (d, kind, owner, layer) => {
  const handle = d.handle();
  d.tag(0, kind).tag(5, handle).tag(330, owner);
  d.tag(100, "AcDbEntity").tag(67, 1).tag(8, layer);
  return handle;
};

/** MTEXT con estilo propio; devuelve el handle (lo necesita LEADER 340). */
const mtext2 = (
  d,
  owner,
  { layer = "0", at, height, width, value, attachment = 1, style },
) => {
  const handle = entity(d, "MTEXT", owner, layer);
  d.tag(100, "AcDbMText").point(10, at[0], at[1], 0);
  d.tag(40, real(height)).tag(41, real(width));
  d.tag(71, attachment).tag(72, 1).tag(1, value);
  if (style !== undefined) d.tag(7, style);
  return handle;
};

/**
 * LEADER con vértices y, opcionalmente, una anotación MTEXT asociada por
 * handle (grupo 340, tipo de creación 0). Sin anotación el tipo es 3.
 */
const leader = (d, owner, { layer = "0", style = "STANDARD", vertices, annotation }) => {
  entity(d, "LEADER", owner, layer);
  d.tag(100, "AcDbLeader").tag(3, style);
  d.tag(71, 1).tag(72, 0).tag(73, annotation ? 0 : 3).tag(74, 0).tag(75, annotation ? 1 : 0);
  if (annotation) d.tag(40, real(annotation.height)).tag(41, real(annotation.width));
  d.tag(76, vertices.length);
  for (const [x, y] of vertices) d.point(10, x, y, 0);
  if (annotation) d.tag(340, annotation.handle);
};

/** TOLERANCE: marco de control de forma (AcDbFcf) con cadena de símbolos. */
const tolerance = (d, owner, { layer = "0", style = "STANDARD", at, value }) => {
  entity(d, "TOLERANCE", owner, layer);
  d.tag(100, "AcDbFcf").tag(3, style);
  d.point(10, at[0], at[1], 0);
  d.tag(1, value);
  d.point(11, 1, 0, 0);
};

/** RAY o XLINE: punto base y vector dirección unitario. */
const construction = (d, owner, kind, { layer = "0", base, direction }) => {
  entity(d, kind, owner, layer);
  d.tag(100, kind === "RAY" ? "AcDbRay" : "AcDbXline");
  d.point(10, base[0], base[1], 0);
  d.point(11, direction[0], direction[1], 0);
};

/**
 * SOLID o TRACE (ambos AcDbTrace): cuatro esquinas en el orden «pajarita» del
 * formato (13 repite a 12 para un triángulo).
 */
const filledQuad = (d, owner, kind, { layer = "0", corners }) => {
  entity(d, kind, owner, layer);
  d.tag(100, "AcDbTrace");
  const quad = corners.length === 3 ? [...corners, corners[2]] : corners;
  quad.forEach(([x, y], index) => d.point(10 + index, x, y, 0));
};

/** 3DFACE: cuatro esquinas 3D y banderas de invisibilidad de aristas (70). */
const face3d = (d, owner, { layer = "0", corners, invisible = 0 }) => {
  entity(d, "3DFACE", owner, layer);
  d.tag(100, "AcDbFace");
  corners.forEach(([x, y, z], index) => d.point(10 + index, x, y, z ?? 0));
  d.tag(70, invisible);
};

const circle = (d, owner, { layer = "0", center, radius }) => {
  entity(d, "CIRCLE", owner, layer);
  d.tag(100, "AcDbCircle").point(10, center[0], center[1], 0).tag(40, real(radius));
};

/** DIMENSION radial: defPoint (10) = centro, 15 = punto sobre el círculo. */
const dimRadial = (d, owner, { layer, center, chord, leaderLength, textMid, style }) => {
  dimensionCommon(d, owner, layer, { type: 4, defPoint: center, textMid, style });
  d.tag(100, "AcDbRadialDimension");
  d.point(15, chord[0], chord[1], 0);
  d.tag(40, real(leaderLength));
};

/** DIMENSION diametral: defPoint (10) y 15 son puntos opuestos del círculo. */
const dimDiametric = (d, owner, { layer, farChord, chord, leaderLength, textMid, style }) => {
  dimensionCommon(d, owner, layer, { type: 3, defPoint: farChord, textMid, style });
  d.tag(100, "AcDbDiametricDimension");
  d.point(15, chord[0], chord[1], 0);
  d.tag(40, real(leaderLength));
};

/**
 * DIMENSION ordinate: 13 = punto medido, 14 = final de la directriz; el bit
 * 64 del grupo 70 marca datum X (sin él, datum Y).
 */
const dimOrdinate = (d, owner, { layer, origin, feature, leaderEnd, xDatum, textMid, style }) => {
  dimensionCommon(d, owner, layer, {
    type: 6 + (xDatum ? 64 : 0),
    defPoint: origin,
    textMid,
    style,
  });
  d.tag(100, "AcDbOrdinateDimension");
  d.point(13, feature[0], feature[1], 0);
  d.point(14, leaderEnd[0], leaderEnd[1], 0);
};

/**
 * HATCH de la ola 2: como el de la ola 1 pero con vértices [x, y, bulge] en
 * los caminos de polilínea (una isla circular son dos vértices con bulge 1) y
 * cola opcional de gradiente (grupos 450–470, sondeados contra el conversor).
 */
const hatch2 = (
  d,
  owner,
  { layer = "0", pattern, solid, angle = 0, scale = 1, definitionLines = [], paths, gradient },
) => {
  entity(d, "HATCH", owner, layer);
  d.tag(100, "AcDbHatch").point(10, 0, 0, 0).tag(210, "0.0").tag(220, "0.0").tag(230, "1.0");
  d.tag(2, pattern).tag(70, solid ? 1 : 0).tag(71, 0);
  d.tag(91, paths.length);
  for (const path of paths) {
    d.tag(92, path.external ? 3 : 2);
    const hasBulge = path.vertices.some((vertex) => vertex[2] !== undefined && vertex[2] !== 0);
    d.tag(72, hasBulge ? 1 : 0).tag(73, 1).tag(93, path.vertices.length);
    for (const [x, y, bulge] of path.vertices) {
      d.point(10, x, y);
      if (hasBulge) d.tag(42, real(bulge ?? 0));
    }
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
  if (gradient) {
    d.tag(450, 1).tag(451, 0);
    d.tag(460, real(gradient.angle ?? 0)).tag(461, "0.0").tag(452, 0).tag(462, "0.0");
    d.tag(453, 2);
    d.tag(463, "0.0").tag(63, gradient.colors[0]).tag(421, gradient.rgb[0]);
    d.tag(463, "1.0").tag(63, gradient.colors[1]).tag(421, gradient.rgb[1]);
    d.tag(470, gradient.name ?? "LINEAR");
  }
};

const unit = ([x, y]) => {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
};
const perp = ([x, y]) => [-y, x];

/**
 * MLINE con estilo propio (nombre + handle del MLINESTYLE en OBJECTS).
 * Direcciones de segmento y de inglete calculadas como las escriben las
 * implementaciones reales: unitaria hacia el siguiente vértice y bisectriz
 * perpendicular en los vértices interiores.
 */
const mline = (
  d,
  owner,
  { layer = "0", style, styleHandle, scale = 1, justification = 0, vertices },
) => {
  entity(d, "MLINE", owner, layer);
  d.tag(100, "AcDbMline");
  d.tag(2, style).tag(340, styleHandle);
  d.tag(40, real(scale)).tag(70, justification).tag(71, 1);
  d.tag(72, vertices.length).tag(73, 2);
  d.point(10, vertices[0][0], vertices[0][1], 0);
  d.point(210, 0, 0, 1);
  const directions = vertices.map((vertex, index) => {
    const next = vertices[index + 1] ?? vertex;
    const previous = vertices[index - 1] ?? vertex;
    return index < vertices.length - 1
      ? unit([next[0] - vertex[0], next[1] - vertex[1]])
      : unit([vertex[0] - previous[0], vertex[1] - previous[1]]);
  });
  vertices.forEach((vertex, index) => {
    d.point(11, vertex[0], vertex[1], 0);
    const direction = directions[index];
    d.point(12, direction[0], direction[1], 0);
    const before = index > 0 ? perp(directions[index - 1]) : perp(direction);
    const after = perp(direction);
    const miter = unit([before[0] + after[0], before[1] + after[1]]);
    d.point(13, miter[0], miter[1], 0);
    for (let element = 0; element < 2; element += 1) {
      d.tag(74, 2).tag(41, "0.0").tag(41, "0.0");
      d.tag(75, 0);
    }
  });
};

/** POLYLINE malla M×N (bandera 16) con VERTEX de malla (bandera 64). */
const meshPolyline = (d, owner, { layer = "0", m, n, origin, spacing, heights }) => {
  entity(d, "POLYLINE", owner, layer);
  d.tag(100, "AcDbPolygonMesh");
  d.tag(66, 1).point(10, 0, 0, 0).tag(70, 16);
  d.tag(71, m).tag(72, n);
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      entity(d, "VERTEX", owner, layer);
      d.tag(100, "AcDbVertex").tag(100, "AcDbPolygonMeshVertex");
      d.point(10, origin[0] + i * spacing, origin[1] + j * spacing, heights[i][j]);
      d.tag(70, 64);
    }
  }
  entity(d, "SEQEND", owner, layer);
};

/**
 * POLYLINE polyface (bandera 64): VERTEX de posición (bandera 192) más VERTEX
 * registro de cara (bandera 128, índices 71–74 base 1).
 */
const pfaceMesh = (d, owner, { layer = "0", vertices, faces }) => {
  entity(d, "POLYLINE", owner, layer);
  d.tag(100, "AcDbPolyFaceMesh");
  d.tag(66, 1).point(10, 0, 0, 0).tag(70, 64);
  d.tag(71, vertices.length).tag(72, faces.length);
  for (const [x, y, z] of vertices) {
    entity(d, "VERTEX", owner, layer);
    d.tag(100, "AcDbVertex").tag(100, "AcDbPolyFaceMeshVertex");
    d.point(10, x, y, z ?? 0);
    d.tag(70, 192);
  }
  for (const face of faces) {
    entity(d, "VERTEX", owner, layer);
    d.tag(100, "AcDbFaceRecord");
    d.point(10, 0, 0, 0);
    d.tag(70, 128);
    face.forEach((index, position) => d.tag(71 + position, index));
  }
  entity(d, "SEQEND", owner, layer);
};

/** VIEWPORT de espacio papel (67=1): centro/tamaño en papel y vista de modelo. */
const viewport = (
  d,
  owner,
  { layer = "0", center, width, height, id, status, viewCenter = [0, 0], viewHeight },
) => {
  paperEntity(d, "VIEWPORT", owner, layer);
  d.tag(100, "AcDbViewport");
  d.point(10, center[0], center[1], 0);
  d.tag(40, real(width)).tag(41, real(height));
  d.tag(68, status).tag(69, id);
  d.point(12, viewCenter[0], viewCenter[1]);
  d.point(13, 0, 0);
  d.point(14, 10, 10);
  d.point(15, 10, 10);
  d.point(16, 0, 0, 1);
  d.point(17, 0, 0, 0);
  d.tag(42, "50.0").tag(43, "0.0").tag(44, "0.0");
  d.tag(45, real(viewHeight));
  d.tag(50, "0.0").tag(51, "0.0").tag(72, 100);
  d.tag(90, 0);
};

// --- los diez dibujos de la ola 2 ---------------------------------------------

/** Offset del vector de ANSI31 a escala 1: 0.125·(cos135°, sin135°). */
const ANSI31_OFFSET = [-0.0883883476483184, 0.0883883476483184];

export const ENTITY_DRAWINGS_2 = [
  {
    name: "16-leader-tolerance",
    intent:
      "Dos LEADER con vértices y anotación MTEXT asociada (tipo 0, grupo 340) en estilo propio ROTU-OLA2, y un TOLERANCE con marco de tolerancia geométrica (posición, 0.05, datum A) en cadena de símbolos gdt.",
    content: {
      layers: [{ name: "DETALLES", color: 4 }],
      styles: [{ name: "ROTU-OLA2", widthFactor: 1, oblique: 0 }],
      model: (d, owner) => {
        const nota1 = mtext2(d, owner, {
          layer: "DETALLES",
          at: [58, 44],
          height: 3.5,
          width: 40,
          value: "VER DETALLE 1",
          style: "ROTU-OLA2",
        });
        leader(d, owner, {
          layer: "DETALLES",
          vertices: [
            [10, 10],
            [35, 30],
            [55, 42],
          ],
          annotation: { handle: nota1, height: 3.5, width: 40 },
        });
        const nota2 = mtext2(d, owner, {
          layer: "DETALLES",
          at: [118, 10],
          height: 3.5,
          width: 45,
          value: "SOLDAR EN OBRA",
          style: "ROTU-OLA2",
        });
        leader(d, owner, {
          layer: "DETALLES",
          vertices: [
            [90, 40],
            [105, 22],
            [115, 12],
          ],
          annotation: { handle: nota2, height: 3.5, width: 45 },
        });
        tolerance(d, owner, {
          layer: "DETALLES",
          at: [20, 70],
          value: "{\\Fgdt;j}%%v0.05%%vA",
        });
      },
    },
  },
  {
    name: "17-ray-xline",
    intent:
      "Dos RAY desde un mismo punto base, dos XLINE a 45 y 135 grados sobre la capa CONSTRUCCION con LTYPE propio OCULTA-VALLE, y dos LINE normales de referencia en capa 0.",
    content: {
      ltypes: [
        {
          name: "OCULTA-VALLE",
          description: "Trazos de construccion - - -",
          pattern: [0.5, -0.25],
        },
      ],
      layers: [{ name: "CONSTRUCCION", color: 8, ltype: "OCULTA-VALLE" }],
      model: (d, owner) => {
        construction(d, owner, "RAY", {
          layer: "CONSTRUCCION",
          base: [20, 20],
          direction: [1, 0],
        });
        construction(d, owner, "RAY", {
          layer: "CONSTRUCCION",
          base: [20, 20],
          direction: [0, 1],
        });
        construction(d, owner, "XLINE", {
          layer: "CONSTRUCCION",
          base: [60, 0],
          direction: [0.7071067811865476, 0.7071067811865476],
        });
        construction(d, owner, "XLINE", {
          layer: "CONSTRUCCION",
          base: [100, 0],
          direction: [-0.7071067811865476, 0.7071067811865476],
        });
        line(d, owner, { from: [0, -20], to: [140, -20] });
        line(d, owner, { from: [0, -40], to: [140, -40] });
      },
    },
  },
  {
    name: "18-solid-trace-3dface",
    intent:
      "Dos SOLID (triángulo y cuadrilátero), un TRACE en banda y dos 3DFACE: una con todas las aristas visibles y otra con las aristas 1 y 3 invisibles (banderas 70=5).",
    content: {
      layers: [{ name: "RELLENOS", color: 30 }],
      model: (d, owner) => {
        filledQuad(d, owner, "SOLID", {
          layer: "RELLENOS",
          corners: [
            [0, 0],
            [30, 0],
            [15, 25],
          ],
        });
        filledQuad(d, owner, "SOLID", {
          layer: "RELLENOS",
          corners: [
            [50, 0],
            [90, 0],
            [50, 20],
            [90, 20],
          ],
        });
        filledQuad(d, owner, "TRACE", {
          layer: "RELLENOS",
          corners: [
            [0, 40],
            [90, 40],
            [0, 44],
            [90, 44],
          ],
        });
        face3d(d, owner, {
          layer: "RELLENOS",
          corners: [
            [0, 60, 0],
            [30, 60, 0],
            [30, 90, 15],
            [0, 90, 15],
          ],
        });
        face3d(d, owner, {
          layer: "RELLENOS",
          corners: [
            [50, 60, 0],
            [80, 60, 5],
            [80, 90, 20],
            [50, 90, 10],
          ],
          invisible: 5,
        });
      },
    },
  },
  {
    name: "19-dim-radial-diameter",
    intent:
      "Dos círculos acotados con una DIMENSION radial y una diametral, ambas con el DIMSTYLE propio VALLE-RADIAL (flechas 3, texto 3.5, gap 1).",
    content: {
      layers: [
        { name: "PIEZAS", color: 5 },
        { name: "COTAS-R", color: 3 },
      ],
      dimstyles: [
        {
          name: "VALLE-RADIAL",
          variables: [
            [40, "1.0"], // DIMSCALE
            [41, "3.0"], // DIMASZ
            [140, "3.5"], // DIMTXT
            [147, "1.0"], // DIMGAP
          ],
        },
      ],
      model: (d, owner) => {
        circle(d, owner, { layer: "PIEZAS", center: [40, 40], radius: 25 });
        circle(d, owner, { layer: "PIEZAS", center: [120, 40], radius: 15 });
        dimRadial(d, owner, {
          layer: "COTAS-R",
          center: [40, 40],
          chord: [61.65063509461097, 52.5],
          leaderLength: 8,
          textMid: [70, 57],
          style: "VALLE-RADIAL",
        });
        dimDiametric(d, owner, {
          layer: "COTAS-R",
          farChord: [105, 40],
          chord: [135, 40],
          leaderLength: 6,
          textMid: [143, 44],
          style: "VALLE-RADIAL",
        });
      },
    },
  },
  {
    name: "20-dim-ordinate-angular",
    intent:
      "Dos DIMENSION ordinate sobre el mismo punto medido (datum X con bit 64 y datum Y sin él) y una angular de 3 puntos entre dos LINE que salen de un vértice común.",
    content: {
      layers: [
        { name: "PIEZAS", color: 5 },
        { name: "COTAS-O", color: 3 },
      ],
      model: (d, owner) => {
        line(d, owner, { layer: "PIEZAS", from: [0, 0], to: [30, 20] });
        dimOrdinate(d, owner, {
          layer: "COTAS-O",
          origin: [0, 0],
          feature: [30, 20],
          leaderEnd: [30, -8],
          xDatum: true,
          textMid: [30, -10],
          style: "STANDARD",
        });
        dimOrdinate(d, owner, {
          layer: "COTAS-O",
          origin: [0, 0],
          feature: [30, 20],
          leaderEnd: [-8, 20],
          xDatum: false,
          textMid: [-10, 20],
          style: "STANDARD",
        });
        line(d, owner, { layer: "PIEZAS", from: [80, 0], to: [140, 0] });
        line(d, owner, { layer: "PIEZAS", from: [80, 0], to: [120, 40] });
        dimAngular3Point(d, owner, {
          layer: "COTAS-O",
          vertex: [80, 0],
          firstRay: [140, 0],
          secondRay: [120, 40],
          defPoint: [110, 12],
          textMid: [112, 13],
          style: "STANDARD",
        });
      },
    },
  },
  {
    name: "21-hatch-islands",
    intent:
      "HATCH ANSI31 con contorno rectangular y una isla CIRCULAR sin sombrear (camino de polilínea con dos vértices de bulge 1) y HATCH sólido de referencia. El HATCH de gradiente se sondeó y quedó fuera: ver DOCUMENTED_EXCLUSIONS.",
    content: {
      layers: [{ name: "MUROS-2", color: 1 }],
      model: (d, owner) => {
        hatch2(d, owner, {
          layer: "MUROS-2",
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
                [70, 0],
                [70, 70],
                [0, 70],
              ],
            },
            {
              external: false,
              vertices: [
                [23, 35, 1],
                [47, 35, 1],
              ],
            },
          ],
        });
        hatch2(d, owner, {
          layer: "MUROS-2",
          pattern: "SOLID",
          solid: true,
          paths: [
            {
              external: true,
              vertices: [
                [90, 0],
                [130, 0],
                [130, 40],
                [90, 40],
              ],
            },
          ],
        });
      },
    },
  },
  {
    name: "22-nested-attribs",
    intent:
      "Bloque TITULO con dos ATTDEF (CLAVE y REV), bloque CONJUNTO que anida un INSERT de TITULO con sus ATTRIB y SEQEND más un ATTDEF propio (PROYECTO), y en modelo un INSERT de CONJUNTO con ATTRIB y SEQEND.",
    content: {
      layers: [
        { name: "MARCOS", color: 4 },
        { name: "TEXTOS-2", color: 6 },
      ],
      blocks: [
        {
          name: "TITULO",
          hasAttdefs: true,
          entities: [
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [0, 0], to: [60, 0] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [60, 0], to: [60, 20] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [60, 20], to: [0, 20] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [0, 20], to: [0, 0] }),
            (d, owner) =>
              attdef(d, owner, {
                layer: "TEXTOS-2",
                at: [4, 12],
                height: 4,
                prompt: "Clave del plano",
                tag: "CLAVE",
                value: "S/C",
              }),
            (d, owner) =>
              attdef(d, owner, {
                layer: "TEXTOS-2",
                at: [4, 4],
                height: 3,
                prompt: "Revision",
                tag: "REV",
                value: "0",
              }),
          ],
        },
        {
          name: "CONJUNTO",
          hasAttdefs: true,
          entities: [
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [-5, -5], to: [75, -5] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [75, -5], to: [75, 35] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [75, 35], to: [-5, 35] }),
            (d, owner) => line(d, owner, { layer: "MARCOS", from: [-5, 35], to: [-5, -5] }),
            (d, owner) =>
              insert(d, owner, {
                block: "TITULO",
                at: [5, 5],
                attributes: [
                  { layer: "TEXTOS-2", at: [9, 17], height: 4, tag: "CLAVE", value: "VD-101" },
                  { layer: "TEXTOS-2", at: [9, 9], height: 3, tag: "REV", value: "B" },
                ],
              }),
            (d, owner) =>
              attdef(d, owner, {
                layer: "TEXTOS-2",
                at: [0, 28],
                height: 4,
                prompt: "Nombre del proyecto",
                tag: "PROYECTO",
                value: "SIN PROYECTO",
              }),
          ],
        },
      ],
      model: (d, owner) => {
        insert(d, owner, {
          block: "CONJUNTO",
          at: [20, 20],
          attributes: [
            {
              layer: "TEXTOS-2",
              at: [20, 48],
              height: 4,
              tag: "PROYECTO",
              value: "CASA VALLE",
            },
          ],
        });
      },
    },
  },
  {
    name: "23-layout-viewport",
    intent:
      "Planta sencilla en modelo (dos LINE y un CIRCLE) y espacio papel con dos VIEWPORT entity: el viewport global del layout (id 1) y una ventana a la planta (id 2). Los objetos LAYOUT/PLOTSETTINGS se omiten a propósito: el audit del conversor los regenera.",
    content: {
      layers: [{ name: "PLANTA", color: 3 }],
      model: (d, owner) => {
        line(d, owner, { layer: "PLANTA", from: [0, 0], to: [100, 0] });
        line(d, owner, { layer: "PLANTA", from: [0, 0], to: [0, 60] });
        circle(d, owner, { layer: "PLANTA", center: [50, 30], radius: 20 });
      },
      paper: (d, owner) => {
        viewport(d, owner, {
          center: [148.5, 105],
          width: 297,
          height: 210,
          id: 1,
          status: 1,
          viewCenter: [148.5, 105],
          viewHeight: 210,
        });
        viewport(d, owner, {
          center: [100, 80],
          width: 160,
          height: 120,
          id: 2,
          status: 2,
          viewCenter: [50, 30],
          viewHeight: 90,
        });
      },
    },
  },
  {
    name: "24-mline",
    intent:
      "MLINESTYLE propio VALLE-DOBLE en OBJECTS (dos elementos a ±0.5 con colores distintos) y dos MLINE en modelo: una recta de dos vértices y una en L de tres vértices con inglete calculado.",
    content: {
      layers: [{ name: "MUROS-ML", color: 1 }],
      prepare: (d, ctx) => {
        ctx.mlineDict = d.handle();
        ctx.mlineStyle = d.handle();
      },
      model: (d, owner, blocks, ctx) => {
        mline(d, owner, {
          layer: "MUROS-ML",
          style: "VALLE-DOBLE",
          styleHandle: ctx.mlineStyle,
          vertices: [
            [0, 0],
            [80, 0],
          ],
        });
        mline(d, owner, {
          layer: "MUROS-ML",
          style: "VALLE-DOBLE",
          styleHandle: ctx.mlineStyle,
          vertices: [
            [0, 30],
            [50, 30],
            [50, 80],
          ],
        });
      },
      objects: (d, ctx) => {
        d.tag(0, "DICTIONARY").tag(5, H.rootDictionary).tag(330, "0");
        d.tag(100, "AcDbDictionary").tag(281, 1);
        d.tag(3, "ACAD_GROUP").tag(350, H.groupDictionary);
        d.tag(3, "ACAD_MLINESTYLE").tag(350, ctx.mlineDict);
        d.tag(0, "DICTIONARY").tag(5, H.groupDictionary).tag(330, H.rootDictionary);
        d.tag(100, "AcDbDictionary").tag(281, 1);
        d.tag(0, "DICTIONARY").tag(5, ctx.mlineDict).tag(330, H.rootDictionary);
        d.tag(100, "AcDbDictionary").tag(281, 1);
        d.tag(3, "VALLE-DOBLE").tag(350, ctx.mlineStyle);
        d.tag(0, "MLINESTYLE").tag(5, ctx.mlineStyle);
        d.tag(102, "{ACAD_REACTORS").tag(330, ctx.mlineDict).tag(102, "}");
        d.tag(330, ctx.mlineDict);
        d.tag(100, "AcDbMlineStyle");
        d.tag(2, "VALLE-DOBLE").tag(70, 0).tag(3, "Muro doble de la ola 2");
        d.tag(62, 256).tag(51, "90.0").tag(52, "90.0");
        d.tag(71, 2);
        d.tag(49, "0.5").tag(62, 1).tag(6, "CONTINUOUS");
        d.tag(49, "-0.5").tag(62, 5).tag(6, "CONTINUOUS");
      },
    },
  },
  {
    name: "25-vertex-mesh",
    intent:
      "POLYLINE malla poligonal 3×4 (bandera 16, VERTEX de malla con Z variable) y POLYLINE polyface (bandera 64) de cinco vértices y dos caras — ejercitan VERTEX_MESH/VERTEX_PFACE/POLYLINE_MESH/POLYLINE_PFACE.",
    content: {
      layers: [{ name: "TERRENO", color: 84 }],
      model: (d, owner) => {
        meshPolyline(d, owner, {
          layer: "TERRENO",
          m: 3,
          n: 4,
          origin: [0, 0],
          spacing: 20,
          heights: [
            [0, 2, 3, 1],
            [1, 4, 6, 2],
            [0, 3, 5, 1],
          ],
        });
        pfaceMesh(d, owner, {
          layer: "TERRENO",
          vertices: [
            [100, 0, 0],
            [140, 0, 0],
            [140, 30, 0],
            [100, 30, 0],
            [120, 15, 20],
          ],
          faces: [
            [1, 2, 5],
            [1, 2, 3, 4],
          ],
        });
      },
    },
  },
];

/**
 * Tipos sondeados contra la herramienta conversora que quedaron FUERA de la
 * ola, con el hecho observado que motivó cada exclusión. El pipeline los
 * embebe en conversion-log.json para que la evidencia viaje con el bundle.
 */
export const DOCUMENTED_EXCLUSIONS = [
  {
    drawing: "21-hatch-islands",
    type: "HATCH (gradiente)",
    observedAt: "2026-08-21",
    fact:
      "Sondeado con un DXF aparte (rectángulo con grupos 450–470, gradiente LINEAR de dos colores): la herramienta conversora 27.1 acepta la entrada sin .err y produce DWG ACAD2000 con firma AC1015, pero el round-trip DWG→DXF devuelve un HATCH sólido sin rastro de los grupos de gradiente (0 apariciones de 450/470 frente a 2 en la fuente). El contenedor AC1015 no conserva gradientes — llegaron con AC1018 — así que el tipo queda fuera de esta ola y entrará con un bundle AC1018.",
  },
];

/** Serializa un dibujo de la ola 2 a texto DXF 2000 (LF, determinista). */
export function renderEntityDrawing2(drawing) {
  const d = new Dxf2000();
  const content = drawing.content;
  const ctx = {};
  content.prepare?.(d, ctx);
  const blocks = (content.blocks ?? []).map((block) => ({
    ...block,
    recordHandle: d.handle(),
  }));
  skeleton(d, { ...content, blocks });
  d.section("ENTITIES", () => {
    content.model?.(d, H.modelSpaceRecord, blocks, ctx);
    content.paper?.(d, H.paperSpaceRecord, ctx);
  });
  if (content.objects) {
    d.section("OBJECTS", () => content.objects(d, ctx));
  } else {
    objectsSection(d);
  }
  return d.toString();
}

export async function writeEntityDrawings2(outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const drawing of ENTITY_DRAWINGS_2) {
    const file = resolve(outDir, `${drawing.name}.dxf`);
    await writeFile(file, renderEntityDrawing2(drawing), { encoding: "utf8" });
    written.push(file);
  }
  return written;
}

// --- CLI ----------------------------------------------------------------------

// Igual que en la ola 1: la CLI sólo corre cuando ESTE archivo es el punto de
// entrada, nunca al ser importado por el pipeline.
const isEntryPoint =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const outFlag = process.argv.indexOf("--out");
if (isEntryPoint && outFlag > -1) {
  const outDir = process.argv[outFlag + 1];
  if (!outDir) {
    process.stderr.write("Uso: node scripts/generate-entity-dxf-2.mjs --out <directorio>\n");
    process.exit(1);
  }
  const files = await writeEntityDrawings2(resolve(outDir));
  process.stdout.write(
    `${files.length} DXF de la ola de entidades 2 escritos en ${resolve(outDir)}\n`,
  );
}
