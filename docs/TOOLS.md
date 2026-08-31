# Registro de herramientas

Registro que exige la enmienda 2026-08-20 de `CORPUS_POLICY.md` para el
origen `tool-converted-original`. Cada entrada archiva HECHOS observados y
verificables; donde una herramienta no publica términos, este registro lo
dice tal cual — no se inventan términos ni se parafrasean licencias que no
existen.

## ODA File Converter 27.1 <a id="oda-file-converter-27.1"></a>

- **Nombre:** ODA File Converter
- **Versión:** 27.1 (build QT6, vc16, amd64, DLLs)
- **Instalador:** `ODAFileConverter_QT6_vc16_amd64dll_27.1.msi`
- **SHA-256 del instalador:**
  `3d5961f510cf95f398b8e2920899dc8e8c51adecdaf5b20a40b3d1a29269de81`
- **Tamaño:** 28,812,288 bytes
- **Fuente de descarga:**
  <https://www.opendesign.com/guestfiles/oda_file_converter> (guest files de
  Open Design Alliance)
- **Fecha de descarga:** 2026-08-20
- **Estado de los términos (hecho observado, no interpretación):** la página
  de descarga NO publica términos de licencia y el MSI NO incorpora texto de
  EULA (tabla `Binary` inspeccionada: solo bitmaps). Se archiva el hecho tal
  cual. El uso que esta política autoriza es la ejecución local como
  conversor/validador sobre material de autoría propia; los bytes de la
  herramienta nunca entran a este repositorio ni al codec.
- **Uso autorizado en el corpus:** conversor DXF→DWG de los dibujos
  fundacionales y validador de round-trip (`oda-file-converter` y
  `dxf-source-roundtrip` en los manifiestos).

## Hechos de fuente registrados

Identificadores usados en `sourceFactIds` de los manifiestos:

- `VALLE-CORPUS-FUNDACIONAL-2026-08-20` — intake del corpus fundacional:
  ocho dibujos escalonados de autoría propia generados por
  `scripts/generate-foundational-dxf.mjs` y convertidos con la herramienta
  de este registro mediante `scripts/build-foundational-corpus.mjs`.
- `VALLE-CORPUS-ENTIDADES-2026-08-20` — intake de la ola de entidades:
  siete dibujos escalonados 09–15 de autoría propia (MTEXT, DIMENSION con
  DIMSTYLE propio, HATCH, ATTDEF/ATTRIB, POLYLINE 2D/3D pesada, ELLIPSE,
  SPLINE, LTYPE y STYLE propios) generados por
  `scripts/generate-entity-dxf.mjs` en dialecto DXF 2000 y convertidos
  SOLO a ACAD2000 con la herramienta de este registro mediante
  `scripts/build-entity-corpus.mjs`. Hecho observado 2026-08-20: el lector
  R12 de la herramienta reconoce el nombre MTEXT pero descarta sus grupos,
  por lo que esta ola exige el dialecto 2000 con esqueleto de tablas y
  handles.
- `VALLE-CORPUS-ENTIDADES-OLA3-2026-08-31` — intake de la tercera ola: seis
  dibujos escalonados 26–31 de autoría propia que cubren los dos huecos que
  ninguna ola anterior toca. **3D**: POLYLINE 3D con Z distinto en cada
  vértice, malla poligonal 7×9 y 5×5 cerrada en N, polyface de caja y
  tetraedro con índices negativos de arista invisible, seis 3DFACE con todas
  las combinaciones de bandera de arista más un triángulo degenerado, y
  elevación/espesor/extrusión no trivial en CIRCLE y LWPOLYLINE. **Escala**:
  un dibujo de 5070 entidades en cuatro capas, generado por retícula
  determinista, que existe para ejercitar la paginación del mapa de objetos y
  el presupuesto del lector — hasta hoy el archivo mayor del corpus eran
  98 708 bytes y ningún dibujo pasaba de 1100 objetos. Generados por
  `scripts/generate-entity-dxf-3.mjs` en dialecto DXF 2000 y convertidos SOLO
  a ACAD2000 con la herramienta de este registro mediante
  `scripts/build-entity-corpus-3.mjs`.

  Límite que consta por escrito: el comparador estructural del pipeline cuenta
  entidades por tipo, capas y nombres de bloque, y **no compara coordenadas**.
  Para el 3D eso no basta —un aplanado a Z=0 conserva el conteo—, así que la
  fidelidad del eje Z la falsa el códec contra el DXF oráculo que se congela
  junto al DWG, no este pipeline. «Round-trip OK» en esta ola no significa «el
  3D viajó bien».

  Exclusiones documentadas de la ola: 3DSOLID, REGION, BODY y la familia
  SURFACE quedan fuera porque todos llevan un flujo ACIS embebido y emitir SAT
  válido a mano es un problema propio, con su propia procedencia que registrar
  — ACIS es formato de Spatial/Dassault, no de ODA. MESH (subdivisión) es una
  clase R2010+ y no existe en el dialecto AC1015 que produce este generador.

- `VALLE-CORPUS-ENTIDADES-OLA2-2026-08-21` — intake de la segunda ola de
  entidades: diez dibujos escalonados 16–25 de autoría propia (LEADER con
  anotación y TOLERANCE, RAY/XLINE, SOLID/TRACE/3DFACE, DIMENSION
  radial/diametral/ordinate/angular, HATCH con isla circular, bloques
  anidados con ATTDEF/ATTRIB, LAYOUT de papel con VIEWPORT, MLINE con
  MLINESTYLE propio y mallas POLYLINE mesh/pface con sus VERTEX) generados
  por `scripts/generate-entity-dxf-2.mjs` en dialecto DXF 2000 y convertidos
  SOLO a ACAD2000 con la herramienta de este registro mediante
  `scripts/build-entity-corpus-2.mjs`. Hecho observado 2026-08-21: el
  conversor acepta los grupos de gradiente 450–470 en dialecto AC1015 sin
  error, pero el DWG ACAD2000 no los conserva (el round-trip devuelve un
  HATCH sólido plano); el HATCH de gradiente queda excluido de la ola y
  documentado en el conversion-log del bundle.
- `ODA-FILE-CONVERTER-27.1-MSI` — el instalador descrito arriba, con su
  SHA-256 y su estado de términos observado.
