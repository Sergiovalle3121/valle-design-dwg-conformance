# Valle Design DWG Conformance

Repositorio compañero **privado** para corpus, oráculos y evidencia de
conformidad del codec DWG first-party de Valle Design. Es software y material
propietario de Sergio Valle Zárate; no adopta una licencia open source.

El repositorio permanece deliberadamente vacío. `index.json` no registra un
segundo revisor ni un snapshot de facts todavía, por lo que el gate rechaza
cualquier bundle no vacío. Cero corpus es preferible a fabricar derechos,
ground truth o independencia.

La allowlist del verifier confiable también está vacía. Un PR no puede
auto-registrar un reviewer o snapshot modificando únicamente `index.json`.

## Contrato

- `index.json`: registro append-only de reviewers, snapshots y manifests.
- `fact-snapshots/sha256/<hash>`: snapshots físicos fijados por repo, commit,
  path, hash y tamaño.
- `bundles/<id>/manifest.json`: relaciones tipadas entre fixture, intake,
  oráculos, validaciones y revisiones.
- `bundles/<id>/objects/sha256/<hash>`: todos los payloads inertes y
  content-addressed.
- `scripts/corpus-gate.mjs`: verifier first-party sin dependencias runtime.
- `tests/check-corpus.spec.mjs`: casos adversariales sobre repos temporales; no
  contienen corpus real.

Los schemas documentan el contrato. El checker aplica además canonical JSON,
inventario Git exacto, paths portables, rechazo de symlinks, hashes/tamaños,
presupuestos agregados, resolución de facts, revisores distintos e independencia
por organización e implementación.

## Gate local

```bash
npm run check:all
```

`incoming/` y `private-notes/` son locales e ignorados. El gate nunca abre su
contenido, pero falla si Git contiene cualquier path bajo ellos o cualquier
archivo tracked fuera del inventario explícito.

En PR, CI ejecuta el verifier del SHA base y trata el candidate sólo como datos.
No ejecuta código procedente del candidate. El repositorio principal consumirá
únicamente manifests ya admitidos y fijará commit e index hash exactos.

El bootstrap inicial se divide en dos PR apilados. El primero instala el
verifier manteniendo un trigger `pull_request` restringido al SHA vacío
histórico; el segundo elimina ese trigger y activa la frontera confiable
definitiva. El gate prohíbe admitir corpus hasta que ambos hayan aterrizado.
