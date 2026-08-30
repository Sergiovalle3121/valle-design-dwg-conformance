# Valle Design DWG Conformance

Repositorio compañero para el corpus independiente, oráculos y evidencia de
conformidad del codec DWG first-party de Valle Design. Es material propietario
de Sergio Valle Zárate con licencia `UNLICENSED`: que el repositorio sea
visible públicamente en GitHub no concede ninguna licencia de uso, copia o
derivación sobre fixtures, oráculos o herramientas.

Un fixture sólo entra después de completar el flujo de derechos, revisión
humana, hash y ground truth descrito en `CORPUS_POLICY.md` (incluida la
enmienda 2026-08-20 para el origen `tool-converted-original`). El estado
admitido vive en `index.json` — hoy, siete bundles: cinco fundacionales
(R2000/2004/2010/2013/2018) y dos olas de entidades AC1015, cada DWG con su
fuente DXF de autoría propia congelada como oráculo.

## Estructura

- `index.json` (+ `index.schema.json`): índice inmutable de bundles admitidos.
- `manifest.schema.json`: contrato de cada bundle.
- `bundles/<bundle-id>/manifest.json`: metadata, derechos y hashes.
- `bundles/<bundle-id>/fixtures/`: bytes aprobados exclusivamente.
- `bundles/<bundle-id>/oracles/`: ground truth independiente y sus hashes.
- `scripts/check-corpus.mjs`: gate fail-closed sin dependencias runtime, con
  su spec (`check-corpus.spec.mjs`).
- `scripts/generate-*.mjs`: generadores deterministas de los DXF de autoría
  propia (mismo código → mismos bytes; SHA-256 congelados en los manifiestos).
- `scripts/build-foundational-corpus.mjs`, `build-entity-corpus.mjs`,
  `build-entity-corpus-2.mjs`: productores que convierten con la herramienta
  registrada, verifican el round-trip y empaquetan bundles bajo supervisión
  humana.
- `scripts/build-manifest.mjs` (+ spec): construye y firma manifiestos e
  índice.
- `scripts/corpus-tools.mjs` (+ spec): utilidades compartidas de hash,
  contención de rutas e inventario.
- `docs/TOOLS.md`: registro de herramientas conversoras (nombre, versión,
  hash del instalador, términos tal y como se observaron).
- `docs/DONACIONES.md`: procedimiento de donación de planos.

`incoming/` es local, está ignorado y nunca se versiona. El repositorio
`valle-design` descarga únicamente bundles ya admitidos mediante credenciales
de mínimo alcance y fija el commit/hash esperado.

## Verificación local

```bash
npm test        # specs del productor, las herramientas y el gate
npm run check   # el gate del corpus; hoy: {"bundles":7,"status":"ok"}
```

Cero bundles también sería un resultado válido del gate: preferible a
incorporar material sin derechos o a fabricar evidencia de compatibilidad.
