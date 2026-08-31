#!/usr/bin/env node

// Generador de la TERCERA OLA del corpus (dibujos 26–31): seis dibujos
// escalonados de autoría propia (Valle Design / Sergio Valle Zárate) que
// cubren los dos huecos que ninguna ola anterior toca.
//
// HUECO 1 — 3D. El corpus admitido no tiene UN SOLO byte que ejercite el eje
// Z de verdad. La ola 2 dejó una malla 3×4 y una polyface mínimas como
// aperitivo, pero el decoder lee POLYLINE_3D, POLYLINE_MESH, POLYLINE_PFACE y
// 3DFACE sin que exista un archivo real donde falsarlos, y el puente al
// producto los aplana sin que nada lo denuncie. Sin corpus, ese frente no se
// puede promover por política.
//
// HUECO 2 — ESCALA. El archivo más grande del corpus son 98 708 bytes y el
// total de objetos de un dibujo no llega a 1100. Nada ejerce la paginación
// del mapa de objetos, ni el presupuesto de `DwgLimits`, ni el camino de
// memoria del lector. Un códec que sólo se prueba con dibujos de juguete no
// ha demostrado nada sobre un plano real.
//
// LO QUE ESTA OLA NO CUBRE, y consta para que nadie lo suponga: 3DSOLID,
// REGION, BODY y la familia SURFACE. Todos ellos llevan un flujo ACIS
// embebido, y emitir SAT válido a mano es un problema propio —no una variante
// de éste— con su propia procedencia que registrar. Es una ola aparte.
//
// Compone sobre el dialecto 2000 de `generate-entity-dxf.mjs` (writer,
// esqueleto de tablas con handles fijos, emisores comunes). Los dibujos
// 09–25 no cambian ni un byte: este módulo sólo añade emisores nuevos.
//
// Determinismo y autoría: mismas reglas que las olas anteriores — mismo
// código → mismos bytes (LF, sin fechas, sin aleatoriedad, handles
// secuenciales desde 0x100) y contenido 100% original, sin datos de clientes
// ni material de terceros.
//
// TOPE DE HANDLES. El esqueleto fija `$HANDSEED` en FFFF (65535) y el
// contenido arranca en 0x100. El dibujo de escala se dimensiona para quedar
// holgadamente por debajo de ese techo en vez de tocar el esqueleto, que
// obligaría a regenerar las dos olas anteriores y romper su inmutabilidad.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Dxf2000,
  H,
  entity,
  line,
  real,
  skeleton,
  objectsSection,
} from "./generate-entity-dxf.mjs";

// --- emisores nuevos de la ola 3 ---------------------------------------------

/**
 * POLYLINE 3D (bandera 8) con VERTEX 3D (bandera 32).
 *
 * Es la forma que más se confunde con la POLYLINE 2D al leerla: comparten
 * tipo de entidad y sólo las distinguen las banderas del grupo 70. Un lector
 * que las trate igual aplana el recorrido al plano Z=0 y ninguna prueba de
 * conteo lo nota — por eso este dibujo lleva Z distinto en CADA vértice.
 */
const polyline3d = (d, owner, { layer = "0", vertices, closed = false }) => {
  entity(d, "POLYLINE", owner, layer);
  d.tag(100, "AcDb3dPolyline");
  d.tag(66, 1).point(10, 0, 0, 0);
  d.tag(70, 8 | (closed ? 1 : 0));
  for (const [x, y, z] of vertices) {
    entity(d, "VERTEX", owner, layer);
    d.tag(100, "AcDbVertex").tag(100, "AcDb3dPolylineVertex");
    d.point(10, x, y, z ?? 0);
    d.tag(70, 32);
  }
  entity(d, "SEQEND", owner, layer);
};

/** POLYLINE malla M×N (bandera 16) con VERTEX de malla (bandera 64). */
const meshPolyline = (
  d,
  owner,
  { layer = "0", m, n, origin, spacing, height, closedM = false, closedN = false },
) => {
  entity(d, "POLYLINE", owner, layer);
  d.tag(100, "AcDbPolygonMesh");
  d.tag(66, 1).point(10, 0, 0, 0);
  d.tag(70, 16 | (closedM ? 1 : 0) | (closedN ? 32 : 0));
  d.tag(71, m).tag(72, n);
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      entity(d, "VERTEX", owner, layer);
      d.tag(100, "AcDbVertex").tag(100, "AcDbPolygonMeshVertex");
      d.point(10, origin[0] + i * spacing, origin[1] + j * spacing, height(i, j));
      d.tag(70, 64);
    }
  }
  entity(d, "SEQEND", owner, layer);
};

/**
 * POLYLINE polyface (bandera 64): VERTEX de posición (bandera 192) más VERTEX
 * registro de cara (bandera 128, índices 71–74 en base 1).
 *
 * Un índice NEGATIVO marca la arista que le sigue como invisible. Se incluye
 * a propósito: es el detalle que un lector descuidado convierte en un índice
 * fuera de rango o en una cara que no existe.
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

/** 3DFACE: cuatro esquinas 3D y banderas de invisibilidad de aristas (70). */
const face3d = (d, owner, { layer = "0", corners, invisible = 0 }) => {
  entity(d, "3DFACE", owner, layer);
  d.tag(100, "AcDbFace");
  corners.forEach(([x, y, z], index) => d.point(10 + index, x, y, z ?? 0));
  d.tag(70, invisible);
};

/**
 * CIRCLE con elevación, espesor y extrusión arbitraria.
 *
 * Es la trampa clásica del sistema de coordenadas de objeto: el punto 10 de un
 * CIRCLE con extrusión NO está en coordenadas del mundo, sino en el plano que
 * define el grupo 210. Un lector que copie X/Y/Z tal cual coloca el círculo en
 * otro sitio y, como el resultado sigue siendo un círculo del radio correcto,
 * ninguna prueba de forma lo detecta.
 */
const circleOcs = (d, owner, { layer = "0", center, radius, thickness, extrusion }) => {
  entity(d, "CIRCLE", owner, layer);
  d.tag(100, "AcDbCircle");
  d.point(10, center[0], center[1], center[2] ?? 0).tag(40, real(radius));
  if (thickness !== undefined) d.tag(39, real(thickness));
  if (extrusion !== undefined)
    d.tag(210, real(extrusion[0])).tag(220, real(extrusion[1])).tag(230, real(extrusion[2]));
  d.tag(100, "AcDbCircle");
};

/** LWPOLYLINE con elevación y espesor: la misma trampa, en la otra entidad. */
const lwpolylineOcs = (
  d,
  owner,
  { layer = "0", points, elevation, thickness, closed = false, extrusion },
) => {
  entity(d, "LWPOLYLINE", owner, layer);
  d.tag(100, "AcDbPolyline");
  d.tag(90, points.length).tag(70, closed ? 1 : 0);
  if (thickness !== undefined) d.tag(39, real(thickness));
  for (const [x, y] of points) d.tag(10, real(x)).tag(20, real(y));
  if (elevation !== undefined) d.tag(38, real(elevation));
  if (extrusion !== undefined)
    d.tag(210, real(extrusion[0])).tag(220, real(extrusion[1])).tag(230, real(extrusion[2]));
};

// --- dibujos ------------------------------------------------------------------

/** Altura determinista de la malla: una silla de montar, sin aleatoriedad. */
const saddle = (i, j) => Number((((i - 3) * (i - 3) - (j - 4) * (j - 4)) / 4).toFixed(6));

/** Ocho esquinas de una caja, en el orden que esperan las caras de abajo. */
const BOX = [
  [0, 0, 0], [40, 0, 0], [40, 25, 0], [0, 25, 0],
  [0, 0, 18], [40, 0, 18], [40, 25, 18], [0, 25, 18],
];

export const ENTITY_DRAWINGS_3 = [
  {
    name: "26-polilinea-3d",
    intent:
      "Dos POLYLINE 3D en MONTAJE: una escalera de nueve vértices con Z creciente y una cerrada de seis vértices que no vive en ningún plano. Cada vértice lleva Z distinto a propósito: un lector que aplane al plano Z=0 conserva el conteo y la forma en planta, así que sólo la coordenada lo delata.",
    content: {
      layers: [{ name: "MONTAJE", color: 4 }],
      model: (d, owner) => {
        polyline3d(d, owner, {
          layer: "MONTAJE",
          vertices: [
            [0, 0, 0], [10, 0, 3], [10, 10, 3], [20, 10, 6],
            [20, 20, 6], [30, 20, 9], [30, 30, 9], [40, 30, 12], [40, 40, 12],
          ],
        });
        polyline3d(d, owner, {
          layer: "MONTAJE",
          closed: true,
          vertices: [
            [60, 0, 0], [80, 5, 7], [90, 20, 2],
            [80, 35, 11], [60, 30, 4], [55, 15, 9],
          ],
        });
      },
    },
  },
  {
    name: "27-malla-poligonal",
    intent:
      "POLYLINE de malla 7×9 en SUPERFICIE con alturas de silla de montar (fórmula determinista, sin aleatoriedad) y una segunda malla 5×5 cerrada en N. 63 y 25 VERTEX de malla: la ola 2 sólo dejó una 3×4, insuficiente para ejercitar el recorrido de índices ni el cierre.",
    content: {
      layers: [{ name: "SUPERFICIE", color: 3 }],
      model: (d, owner) => {
        meshPolyline(d, owner, {
          layer: "SUPERFICIE",
          m: 7, n: 9, origin: [0, 0], spacing: 8, height: saddle,
        });
        meshPolyline(d, owner, {
          layer: "SUPERFICIE",
          m: 5, n: 5, origin: [80, 0], spacing: 6, closedN: true,
          height: (i, j) => Number((i * 1.5 + j * 0.75).toFixed(6)),
        });
      },
    },
  },
  {
    name: "28-polyface-caras",
    intent:
      "POLYLINE polyface en ESTRUCTURA: una caja cerrada de 8 vértices y 6 caras, más un tetraedro de 4 y 4. Dos caras llevan un índice NEGATIVO para marcar una arista invisible — el detalle que convierte un índice mal leído en una cara inexistente o en un desbordamiento.",
    content: {
      layers: [{ name: "ESTRUCTURA", color: 5 }],
      model: (d, owner) => {
        pfaceMesh(d, owner, {
          layer: "ESTRUCTURA",
          vertices: BOX,
          faces: [
            [1, 2, 3, 4], [5, 6, 7, 8], [1, 2, 6, 5],
            [2, 3, 7, -6], [3, 4, 8, 7], [4, 1, 5, -8],
          ],
        });
        pfaceMesh(d, owner, {
          layer: "ESTRUCTURA",
          vertices: [[60, 0, 0], [80, 0, 0], [70, 17, 0], [70, 6, 16]],
          faces: [[1, 2, 3], [1, 2, 4], [2, 3, 4], [3, 1, 4]],
        });
      },
    },
  },
  {
    name: "29-3dface-caja",
    intent:
      "Seis 3DFACE en CASCARON formando una caja cerrada, cada cara con una combinación distinta de banderas de arista invisible (0, 1, 2, 4, 8 y 15). Una cara adicional degenerada repite la cuarta esquina, que es la forma en que un 3DFACE representa un triángulo.",
    content: {
      layers: [{ name: "CASCARON", color: 2 }],
      model: (d, owner) => {
        const [a, b, c, e, f, g, h, i] = BOX;
        const faces = [
          { corners: [a, b, c, e], invisible: 0 },
          { corners: [f, g, h, i], invisible: 1 },
          { corners: [a, b, g, f], invisible: 2 },
          { corners: [b, c, h, g], invisible: 4 },
          { corners: [c, e, i, h], invisible: 8 },
          { corners: [e, a, f, i], invisible: 15 },
        ];
        for (const face of faces) face3d(d, owner, { layer: "CASCARON", ...face });
        // Triángulo: la cuarta esquina repite la tercera, que es como el
        // formato representa una cara de tres lados.
        face3d(d, owner, {
          layer: "CASCARON",
          corners: [[60, 0, 0], [90, 0, 0], [75, 20, 14], [75, 20, 14]],
        });
      },
    },
  },
  {
    name: "30-elevacion-espesor-ocs",
    intent:
      "Elevación, espesor y extrusión no trivial en ALZADO: tres CIRCLE con extrusión distinta (mundo, un eje volteado y un plano oblicuo normalizado) y dos LWPOLYLINE con elevación y espesor. Un lector que copie X/Y/Z sin transformar por el grupo 210 coloca la geometría en otro sitio conservando su forma, así que ninguna prueba de conteo ni de radio lo detecta.",
    content: {
      layers: [{ name: "ALZADO", color: 1 }],
      model: (d, owner) => {
        circleOcs(d, owner, {
          layer: "ALZADO", center: [20, 20, 0], radius: 10,
          thickness: 12, extrusion: [0, 0, 1],
        });
        circleOcs(d, owner, {
          layer: "ALZADO", center: [50, 20, 5], radius: 8,
          thickness: 6, extrusion: [0, 0, -1],
        });
        // Extrusión oblicua ya normalizada: 3-4-5 en el plano XZ.
        circleOcs(d, owner, {
          layer: "ALZADO", center: [80, 20, 0], radius: 6,
          thickness: 9, extrusion: [0.6, 0, 0.8],
        });
        lwpolylineOcs(d, owner, {
          layer: "ALZADO", closed: true, elevation: 14, thickness: 4,
          points: [[0, 50], [30, 50], [30, 70], [0, 70]],
        });
        lwpolylineOcs(d, owner, {
          layer: "ALZADO", elevation: 3, thickness: 20, extrusion: [0, -1, 0],
          points: [[40, 50], [70, 50], [70, 68], [95, 68]],
        });
      },
    },
  },
  {
    name: "31-escala-densa",
    intent:
      "Dibujo de ESCALA: 5000 entidades deterministas (2400 LINE, 1600 LWPOLYLINE y 1000 CIRCLE) repartidas en cuatro capas. Existe para ejercitar lo que ningún otro fixture toca — la paginación del mapa de objetos, el presupuesto de DwgLimits y el camino de memoria del lector — porque hasta hoy el archivo mayor del corpus son 98 KB y ningún dibujo pasa de 1100 objetos. Sin aleatoriedad: la retícula y los radios salen de índices.",
    content: {
      layers: [
        { name: "MUROS", color: 1 },
        { name: "EJES", color: 4 },
        { name: "MOBILIARIO", color: 3 },
        { name: "COTAS", color: 2 },
      ],
      model: (d, owner) => {
        // Retícula de muros: 40 crujías × 30, líneas horizontales y verticales.
        for (let i = 0; i < 40; i += 1) {
          for (let j = 0; j < 30; j += 1) {
            const x = i * 300;
            const y = j * 250;
            line(d, owner, { layer: "MUROS", from: [x, y], to: [x + 280, y] });
            line(d, owner, { layer: "MUROS", from: [x, y], to: [x, y + 230] });
          }
        }
        // Ejes: una línea larga por crujía en cada dirección.
        for (let i = 0; i < 40; i += 1)
          line(d, owner, { layer: "EJES", from: [i * 300, -200], to: [i * 300, 7700] });
        for (let j = 0; j < 30; j += 1)
          line(d, owner, { layer: "EJES", from: [-200, j * 250], to: [12200, j * 250] });
        // Mobiliario: una polilínea cerrada de cuatro puntos por celda de 40×40.
        for (let i = 0; i < 40; i += 1) {
          for (let j = 0; j < 40; j += 1) {
            const x = i * 300 + 60;
            const y = j * 185 + 40;
            lwpolylineOcs(d, owner, {
              layer: "MOBILIARIO", closed: true,
              points: [[x, y], [x + 90, y], [x + 90, y + 60], [x, y + 60]],
            });
          }
        }
        // Cotas: círculos de radio variable, 25 × 40.
        for (let i = 0; i < 25; i += 1) {
          for (let j = 0; j < 40; j += 1) {
            circleOcs(d, owner, {
              layer: "COTAS",
              center: [i * 480 + 120, j * 190 + 90],
              radius: 8 + ((i + j) % 7),
            });
          }
        }
      },
    },
  },
];

/**
 * Exclusiones documentadas de esta ola. Se archivan aquí, no en un comentario
 * suelto, porque el motivo es una decisión de alcance y no un olvido.
 */
export const DOCUMENTED_EXCLUSIONS = [
  {
    tipo: "3DSOLID / REGION / BODY / familia SURFACE",
    motivo:
      "Todos llevan un flujo ACIS embebido. Emitir SAT válido a mano es un problema propio, con su propia procedencia que registrar en SOURCE_REGISTER.json — ACIS es formato de Spatial/Dassault, no de ODA. Es una ola aparte, no una variante de ésta.",
  },
  {
    tipo: "MESH (malla de subdivisión)",
    motivo:
      "Es una clase R2010+ y no existe en el dialecto AC1015 que produce este generador. Entra cuando el corpus tenga una ola de dialecto moderno.",
  },
];

export function renderEntityDrawing3(drawing) {
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

export async function writeEntityDrawings3(outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const drawing of ENTITY_DRAWINGS_3) {
    const file = resolve(outDir, `${drawing.name}.dxf`);
    await writeFile(file, renderEntityDrawing3(drawing), { encoding: "utf8" });
    written.push(file);
  }
  return written;
}

// --- CLI ----------------------------------------------------------------------

// Igual que en las olas anteriores: la CLI sólo corre cuando ESTE archivo es
// el punto de entrada, nunca al ser importado por el pipeline.
const isEntryPoint =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const outFlag = process.argv.indexOf("--out");
if (isEntryPoint && outFlag > -1) {
  const outDir = process.argv[outFlag + 1];
  if (!outDir) {
    process.stderr.write("Uso: node scripts/generate-entity-dxf-3.mjs --out <directorio>\n");
    process.exit(1);
  }
  const files = await writeEntityDrawings3(resolve(outDir));
  process.stdout.write(
    `${files.length} DXF de la ola 3 (3D y escala) escritos en ${resolve(outDir)}\n`,
  );
}
