# Candidatos de terceros para el corpus DWG/DXF — 2026-09-07

> **PENDIENTE DE REVISIÓN HUMANA — ningún archivo fue descargado ni admitido;
> esto es investigación para que Sergio y un segundo revisor decidan conforme
> a `CORPUS_POLICY.md`.**

- **Autor**: agente de investigación (sub-agente "DWG-Corpus"), NO es un
  revisor humano y no cuenta como ninguno de los dos revisores que exige la
  política para origen `licensed-third-party`.
- **Fecha real de esta corrida** (obtenida con `date +%F`, no inventada):
  `2026-09-07`.
- **Alcance respetado**: no se descargó, abrió, transformó ni inspeccionó
  ningún byte DWG/DXF; no se tocó `bundles/`; no se editó `index.json`; no se
  hizo commit ni push. Este documento es el único entregable.
- **Resultado neto de esta corrida**: **cero candidatos listos para pasar a
  revisión humana como `licensed-third-party`.** Como dice el propio
  `README.md` del repositorio, "cero bundles también sería un resultado
  válido... preferible a incorporar material sin derechos". Las razones
  concretas están en las secciones siguientes: una restricción de red de este
  entorno impidió verificar la mayoría de las fuentes gubernamentales y de
  datos abiertos solicitadas, y las únicas fuentes que sí pude visitar
  (proyectos CAD libres) tienen licencias que `CORPUS_POLICY.md` prohíbe
  explícitamente.

---

## 0. Restricción de entorno detectada (léase antes que nada)

Esta sesión del agente sale a Internet a través de un proxy de egress con
lista de permitidos, no de bloqueados. En la práctica, **sólo `github.com` y
`raw.githubusercontent.com` resultaron alcanzables**; toda otra fuente
probada — gubernamental, de datos abiertos, o de referencia general —
devolvió un bloqueo explícito de política, tanto desde `curl` (Bash) como
desde la herramienta `WebFetch`:

| Dominio probado | Herramienta | Resultado |
| --- | --- | --- |
| `www.gsa.gov` | WebFetch y curl | `EGRESS_BLOCKED` / `403` en el CONNECT |
| `cadbimcenter.erdc.dren.mil` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `data.nist.gov` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `www.loc.gov` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `www.nps.gov`, `npgallery.nps.gov` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `www.usgs.gov` | curl | `403` en el CONNECT |
| `www.nasa.gov`, `data.nasa.gov` | curl | `403` |
| `www.nist.gov`, `www.army.mil`, `www.saj.usace.army.mil` | curl | `403` |
| `datos.cdmx.gob.mx`, `sig.cdmx.gob.mx`, `datos.gob.mx` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `commons.wikimedia.org` | WebFetch y curl | `EGRESS_BLOCKED` / `403` |
| `en.wikipedia.org`, `www.usa.gov`, `catalog.data.gov` | WebFetch | `EGRESS_BLOCKED` |
| `web.archive.org`, `archive.org` | WebFetch y curl | bloqueado / no soportado |
| `qcad.org`, `librecad.org`, `freecad.org` | curl | `403` |
| `cambridgegis.github.io` (subdominio *.github.io*) | WebFetch | `EGRESS_BLOCKED` |
| `data.jsdelivr.com` | curl | `403` |
| `www.google.com`, `example.com` | curl | `403` (control negativo: bloqueo general, no específico de gobierno) |
| `github.com`, `raw.githubusercontent.com` | WebFetch y curl | **alcanzables** |

Confirmé con `curl -sS "$HTTPS_PROXY/__agentproxy/status"` que se trata de una
denegación de política de la organización en el CONNECT (no un problema de
certificados ni algo que deba "solucionar" reintentando o rodeando), y el
propio `/root/.ccr/README.md` indica explícitamente: *"do not retry
organization policy denials (403/407) — report them instead"*. Así que no
insistí ni until intenté sortear el bloqueo.

**Esto no es evidencia sobre los derechos del material en esos sitios** — es
una limitación de herramienta de esta sesión. Por eso ninguna fuente
inalcanzable se reporta como "candidato válido": va a la sección 4,
"descartado, licencia no verificable", con la URL exacta que intenté visitar
y el motivo puntual, tal como pide el encargo.

---

## 1. Reglas de `CORPUS_POLICY.md` aplicadas en este expediente

- **Regla fail-closed**: ningún archivo se descarga/abre/transforma/usa en
  cuarentena; sólo metadata mínima de derechos, y aquí ni siquiera eso —
  ningún bundle se creó.
- **Dos revisores humanos** para origen `licensed-third-party` (la enmienda
  del 2026-08-20 sólo cambia el régimen de `tool-converted-original`, que no
  aplica a nada de este expediente).
- **Material prohibido** (cita literal de la política): *"GPL, AGPL, LGPL,
  MPL, SSPL, BUSL, source-available, términos restringidos, desconocidos o
  incompatibles con el programa propietario"* y *"código, tablas, tests o
  fixtures de Autodesk, ODA, RealDWG, LibreDWG u otros codecs"*. Esta cláusula
  es la que descarta, por sí sola, toda la familia 4 del encargo (ver §3).

---

## 2. Metodología por candidato

Para cada candidato de la sección 3 realmente visité la página con `WebFetch`
o `curl` (verificable en el historial de herramientas de esta sesión), anoté
la URL exacta, la URL de la página que declara la licencia, una cita literal
de esa declaración, y mi veredicto razonado. Ninguna fila de la sección 3
está inventada ni asumida a partir de resultados de buscador solamente.

---

## 3. Candidatos verificados (fuente visitada de verdad)

Familia 4 del encargo — "archivos de ejemplo de proyectos libres" — fue la
única alcanzable desde este entorno (dominios `github.com` /
`raw.githubusercontent.com`). Los tres proyectos nombrados en el encargo
(QCAD, LibreCAD, FreeCAD) sí tienen archivos DXF/DWG de ejemplo reales, pero
los tres quedan **RECHAZADOS** porque su propia licencia — la que efectivamente
leí, no until la que asumí — cae en la lista de "Material prohibido" citada
arriba.

| Nombre | URL exacta (carpeta/archivo) | Página que declara la licencia | Origen | Licencia + cita literal | Veredicto |
| --- | --- | --- | --- | --- | --- |
| QCAD — `examples/` (10 DXF: `calibration.dxf`, `colors.dxf`, `entities.dxf`, `example00.dxf`, `example01.dxf`, `flange.dxf`, `isometric_grid.dxf`, `linetypes.dxf`, `lineweights.dxf`, `projection.dxf`) | https://github.com/qcad/qcad/tree/master/examples | https://github.com/qcad/qcad (README) y `https://raw.githubusercontent.com/qcad/qcad/master/LICENSE.txt` (confirmé con `curl` que existe, HTTP 200) | Proyecto CAD libre (familia 4 del encargo) | GPLv3: *"The QCAD 3 source code is released under the GPLv3 open source license"* / *"The QCAD 3 source code is open source and distributed under GPL version 3 with optional exceptions"*; nota aparte: *"Icons and documentation are distributed under the terms of the 'Creative Commons Attribution 3.0 Unported' license"* — pero esa CC-BY cubre íconos/documentación, NO los DXF de `examples/`, y no encontré ningún README o nota de licencia distinta dentro de `examples/` que saque esos DXF del régimen GPLv3 del repo. | **RECHAZADO** — GPLv3 está en la lista explícita de "Material prohibido" de `CORPUS_POLICY.md`. No asumí redistribuibilidad: leí la licencia del repo y no hay excepción documentada para `examples/`. |
| LibreCAD — `test_data` / `tests/fixtures` (contienen datos de prueba, no confirmé nombres de archivo DXF/DWG individuales porque la herramienta no lista contenidos de subcarpetas sin abrir bytes de CAD) | https://github.com/LibreCAD/LibreCAD | `https://raw.githubusercontent.com/LibreCAD/LibreCAD/master/LICENSE` | Proyecto CAD libre (familia 4 del encargo) | GPLv2: *"LibreCAD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License version 2 (GPLv2) as published by the Free Software Foundation."* | **RECHAZADO** — GPLv2 explícitamente prohibido por la política. |
| FreeCAD — `src/Mod/TechDraw/Templates` (sólo confirmé plantillas `.svg`: `Default_Template_A4_Landscape.svg`, `HowToExample.svg`, y subcarpetas `ASME/`, `ISO/`; NO hay DXF/DWG confirmado en esta ruta) | https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/TechDraw/Templates | `https://raw.githubusercontent.com/FreeCAD/FreeCAD/main/LICENSE` | Proyecto CAD libre (familia 4 del encargo) | LGPL v2.1 (texto completo confirmado, cabecera: *"GNU LESSER GENERAL PUBLIC LICENSE Version 2.1, February 1999"*) | **RECHAZADO por doble motivo**: (a) LGPL está prohibido explícitamente por la política, y (b) ni siquiera confirmé que existan archivos DXF/DWG reales en esta ruta — sólo SVG, formato fuera del alcance del corpus. |

**No hay ninguna fila con veredicto positivo en esta corrida.**

---

## 4. Descartados — licencia no verificable en este entorno

Todo lo que sigue es material que localicé por búsqueda pero **no pude
visitar realmente** por el bloqueo de red descrito en la §0. Por instrucción
explícita del encargo, nada de esto cuenta como candidato válido. Marco con
⭐ los que, por lo que dice la propia doctrina pública (17 U.S.C. §105 para
obra federal, o el propio README de terceros), me parecen los de mayor
probabilidad de éxito si alguien con acceso de red normal — Sergio, o una
corrida futura de este mismo agente desde otro entorno — repite la visita.

### Familia 1 — Gobierno federal de EE. UU.

| Candidato | URL que intenté visitar | Motivo de descarte |
| --- | --- | --- |
| ⭐ NIST PDR — *"Nanocalorimeter DWG and DXF drawings for microfabrication mask generation"* (dataset que, por el propio título del resultado de búsqueda, aloja archivos DWG **y** DXF reales) | `https://data.nist.gov/pdr/lps/ark:/88434/mds2-2113` | Bloqueado (`EGRESS_BLOCKED` / `403` en el CONNECT). No pude confirmar la URL de descarga del archivo ni la cita literal de licencia del Public Data Repository de NIST. Éste es, de todo lo que encontré, el candidato más prometedor de la familia 1 — vale la pena que alguien con acceso normal lo revise primero. |
| GSA — PBS CAD Standards / "Great Lakes CAD Policy" (plantillas DWG de rótulo, *Layer Seed Templates*) | `https://www.gsa.gov/about-us/gsa-regions/region-5-great-lakes/products-and-services/cad-policy` y `https://www.gsa.gov/system/files/PBS_CAD_Standard-2021.pdf` | Bloqueado. No pude confirmar si las plantillas DWG enlazadas ahí tienen una declaración de dominio público explícita más allá de ser obra de una agencia federal (lo cual, aun siendo cierto por 17 U.S.C. §105, no lo verifiqué visitando la página). |
| USACE — CAD/BIM Technology Center (Tri-Service), plantilla Civil 3D y CAD Details Library | `https://cadbimcenter.erdc.dren.mil/default.aspx?p=a&t=1&i=113` | Bloqueado. No hay cita literal de licencia disponible. |
| USGS — GIS Data Download / National Map Downloader | `https://www.usgs.gov/tools/download-data-maps-national-map`, `https://www.usgs.gov/faqs/are-usgs-topographic-maps-copyrighted` | Bloqueado. Además, sin poder visitar la página no pude confirmar que el exportador ofrezca formato DXF: los resultados de búsqueda sólo mencionan GeoTIFF, PDF geoespacial, JPEG y KMZ como formatos de `topoView`; DXF no aparece confirmado en ningún snippet, así que aunque el contenido de USGS sí es dominio público por ley, el formato del entregable queda sin verificar. |
| NASA — dibujos técnicos oficiales | (sin URL primaria de NASA.gov localizable vía búsqueda; sólo aparecieron revendedores de terceros como `designscad.com` y `cadforum.cz`, que no son la fuente primaria y quedan excluidos por eso, independientemente del bloqueo de red) | Descartado por falta de fuente primaria identificable, no sólo por bloqueo de red. |
| NASA — repositorio GitHub `nasa/NASA-3D-Resources` (éste sí lo pude visitar: `github.com` no está bloqueado) | `https://github.com/nasa/NASA-3D-Resources`, README en `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/README.md` | Verifiqué la cita de licencia — *"These assets are free and without copyright"* — pero **no pude confirmar que el repositorio contenga archivos DXF o DWG**; el README no lista formatos y el proyecto es conocido por modelos OBJ/3DS, no CAD nativo. Descartado por formato no confirmado, no por licencia. |
| NPS / HABS-HAER vía Library of Congress | `https://www.loc.gov/pictures/collection/hh/technote.html`, `https://www.nps.gov/subjects/heritagedocumentation/faqs.htm` | Bloqueadas ambas. Nota adicional para quien retome esto: aun si fueran accesibles, los planos HABS/HAER se archivan históricamente como láminas escaneadas (TIFF/JPEG2000), no como CAD nativo DWG/DXF — habría que confirmar primero si existe algún proyecto de registro reciente que sí entregó CAD nativo, antes de asumir que el formato encaja. |

### Familia 2 — Portales de datos abiertos (México y EE. UU.)

| Candidato | URL que intenté visitar | Motivo de descarte |
| --- | --- | --- |
| Información catastral / SIG de la Ciudad de México | `https://datos.cdmx.gob.mx/dataset/informacion-catastral-de-la-ciudad-de-mexico`, `https://sig.cdmx.gob.mx/datos/descarga` | Bloqueadas ambas. No pude confirmar formato de descarga (¿DXF/DWG o sólo shapefile/geojson?) ni la licencia exacta del portal. |
| `datos.gob.mx` (catálogo nacional) | `https://datos.gob.mx/busca/dataset?tags=catastral` | Bloqueado. |
| Portales de ciudades de EE. UU. con espejo en GitHub — Chicago (`ChicagoCityscape/gis-data`) y Cambridge, MA (`cambridgegis/*`) — éstos sí los pude visitar en `github.com` | `https://github.com/ChicagoCityscape/gis-data`, `https://github.com/cambridgegis` | Visité ambos repositorios (alcanzables). Confirmé licencia CC0 explícita en Chicago sólo para un dataset puntual (*"This data is licensed CC0, public domain"*, atribuido a ubicaciones de estaciones de tren), pero **ningún archivo `.dxf` o `.dwg` aparece listado en ninguno de los dos repositorios** — sólo GeoJSON, shapefile, CSV. Descartados por formato, no por licencia. |
| `cambridgegis.github.io` (portal de descargas propiamente dicho, con explicación de formatos disponibles) | `https://cambridgegis.github.io/gisdata.html` | Bloqueado — a pesar de ser un subdominio `*.github.io`, quedó fuera del permitido (sólo `github.com` y `raw.githubusercontent.com` funcionaron). |

### Familia 3 — Wikimedia Commons

| Candidato | URL que intenté visitar | Motivo de descarte |
| --- | --- | --- |
| Categoría `Category:DXF_files` en Wikimedia Commons | `https://commons.wikimedia.org/wiki/Category:DXF_files` | Bloqueado (`EGRESS_BLOCKED`). No pude listar un solo archivo ni su licencia declarada por archivo, que es justo el requisito del encargo para esta familia ("licencia declarada por archivo"). Sin poder abrir la página de cada archivo individual, ningún ítem de Commons puede pasar a la sección 3. |

### Familia 4 — ya cubierta en la sección 3 (verificados, pero rechazados por licencia)

No hay entradas adicionales de descarte aquí: QCAD, LibreCAD y FreeCAD sí se
verificaron y quedaron documentados con veredicto negativo en la §3, no en
ésta.

---

## 5. Nota fuera de alcance (no evaluada como candidato)

Al buscar alternativas a QCAD/LibreCAD/FreeCAD dentro de la familia 4, apareció
`mozman/ezdxf` (`https://github.com/mozman/ezdxf`), una librería Python para
DXF bajo licencia **MIT**. Esa licencia no habilita sus fixtures: la política
prohíbe también los tests y fixtures de otros codecs, con independencia de
su licencia. No se verificaron derechos particulares sobre sus archivos de
prueba y no se descargaron ni inspeccionaron. Sus fixtures quedan excluidos
por `CORPUS_POLICY.md`; esta referencia no recomienda incorporarlos ni
autoriza una excepción.

---

## 6. Recomendación para el titular

1. **No hay nada que enviar a los dos revisores humanos todavía** — cero
   candidatos de esta corrida cumplen a la vez (a) verificación real de la
   fuente y (b) compatibilidad con la lista de licencias prohibidas de
   `CORPUS_POLICY.md`.
2. El cuello de botella real no fue la disponibilidad de material sino el
   acceso de red de este entorno de agente. Si quieres continuar esta línea,
   lo más eficiente es que tú (o un agente en un entorno sin este bloqueo de
   egress) visites directamente el candidato marcado ⭐ en la §4 — el dataset
   de NIST PDR con DWG y DXF de un nanocalorímetro. Su título de catálogo
   menciona ambos formatos, pero en esta corrida no se verificaron la autoría,
   los derechos de los archivos ni la aplicabilidad de 17 U.S.C. §105. Que lo
   aloje NIST no basta para declararlo de dominio público. Sólo procede una
   revisión de metadata de derechos conforme a la política, fuera de Git y
   sin descargar ni abrir los archivos; sigue sin haber material admitido.
3. Si decides perseguir la familia 4 igual, la única vía compatible con la
   política exige verificar los derechos de cada dibujo y cumplir también
   las restricciones de procedencia. Una licencia permisiva (MIT/BSD/CC0)
   por sí sola no basta: los tests y fixtures de otros codecs, incluidos
   los de `ezdxf` (§5), están excluidos. Tampoco se admiten GPL, LGPL ni
   otros términos prohibidos, aunque el archivo sea "sólo un ejemplo".
4. Nada de este documento modifica `bundles/` ni `index.json`; ambos quedan
   exactamente como estaban antes de esta corrida.
