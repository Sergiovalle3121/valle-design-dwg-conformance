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
- `ODA-FILE-CONVERTER-27.1-MSI` — el instalador descrito arriba, con su
  SHA-256 y su estado de términos observado.
