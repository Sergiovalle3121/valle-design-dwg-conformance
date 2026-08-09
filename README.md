# Valle Design DWG Conformance

Repositorio compañero **privado** para el corpus independiente, oráculos y
evidencia de conformidad del codec DWG first-party de Valle Design. Es software
y material propietario de Sergio Valle Zárate; no adopta una licencia open
source.

El repositorio se inicializa sin archivos DWG. Un fixture sólo entra después de
completar el flujo de cuarentena, derechos, revisión humana, hash y ground truth
descrito en `CORPUS_POLICY.md`.

## Estructura

- `index.json`: índice inmutable de bundles admitidos.
- `manifest.schema.json`: contrato de cada bundle.
- `bundles/<bundle-id>/manifest.json`: metadata, derechos y hashes.
- `bundles/<bundle-id>/fixtures/`: bytes aprobados exclusivamente.
- `bundles/<bundle-id>/oracles/`: ground truth independiente y sus hashes.
- `scripts/check-corpus.mjs`: gate fail-closed sin dependencias runtime.

`incoming/` es local, está ignorado y nunca se versiona. El repositorio
`valle-design` descarga únicamente bundles ya admitidos mediante credenciales
de mínimo alcance y fija el commit/hash esperado.

## Gate local

```bash
npm run check
```

El resultado vacío inicial es válido: cero bundles y cero DWG es preferible a
incorporar material sin derechos o a fabricar evidencia de compatibilidad.
