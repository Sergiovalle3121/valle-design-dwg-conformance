# Política de admisión del corpus

## Regla fail-closed

Ningún archivo se descarga, abre, transforma, inspecciona técnicamente ni usa
para implementar el codec mientras esté en cuarentena. Sólo se conserva fuera
de Git la metadata mínima necesaria para decidir derechos. La admisión exige la
aprobación del titular y de un segundo revisor humano identificado en
`index.json`.

Mientras `admission.secondReviewers` o `admission.factSnapshots` estén vacíos,
el único corpus válido contiene cero bundles. No se inventa un usuario ni un
snapshot para abrir el gate.

Además, registrar esos valores en el candidate no abre admisión. El verifier
confiable conserva una allowlist separada, actualmente vacía. El reviewer y el
descriptor exacto del snapshot deben aprobarse primero en un cambio de tooling;
sólo un verifier posterior cargado desde la base puede reconocerlos.

## Material admisible

- dibujos originales de Sergio sin información de clientes;
- dibujos originales de un donante con permiso escrito suficiente; o
- material de terceros bajo una licencia permisiva enumerada por el checker que
  autorice expresamente uso, modificación y conservación en este repositorio
  privado.

Cada fixture tiene un intake content-addressed que declara herramienta y
versión de creación, titular, facts del snapshot fijado, derechos sobre el
output, permiso de modificación, alcance de redistribución y revisiones de
privacidad. Los acuerdos, revisiones y autorizaciones referidos por el intake
son objetos físicos hasheados; un identificador sin objeto no cuenta.

## Material prohibido

- planos de clientes o información personal, confidencial o secreta;
- archivos encontrados al azar, samples instalados o trials con términos
  ambiguos;
- outputs de herramientas sin derecho comprobado;
- binarios filtrados, descompilados o usados para eludir protecciones;
- código, tablas, tests o fixtures de Autodesk, ODA, RealDWG, LibreDWG u otros
  codecs; y
- GPL, AGPL, LGPL, MPL, SSPL, BUSL, source-available, términos restringidos,
  desconocidos o incompatibles con el programa propietario.

## Estructura de un bundle

Cada payload vive exactamente en
`bundles/<bundle-id>/objects/sha256/<sha256>`. El manifest repite hash y tamaño,
y el checker exige que el path coincida con el contenido. No se permiten hashes,
paths, IDs u objetos sin referencias duplicados.

Un fixture enlaza un intake JSON, oráculos, validaciones y evidencia físicos.
Cada dirección declarada exige un oráculo externo y dos validaciones aceptadas
de implementaciones y organizaciones independientes. Valle nunca cuenta como
la única fuente independiente. Los objetos se hashean como bytes inertes; el
gate no ejecuta ni resuelve macros, OLE, URLs, paths o xrefs.

Los `sourceFactIds` se resuelven exclusivamente contra un snapshot físico de
`FACT_REGISTER.json`. El descriptor fija repositorio, commit, path, SHA-256 y
tamaño sin requerir credenciales de red durante la verificación.

## Admisión e inmutabilidad

1. Registrar metadata segura fuera del árbol como `quarantined`.
2. Obtener revisión humana de derechos y privacidad.
3. Congelar fixture, intake, oráculos, evidence y attestations; calcular hashes
   y tamaños.
4. Añadir sólo objetos content-addressed y un manifest canónico.
5. Ejecutar `npm run check:all`; revisar el diff sin mostrar bytes en logs.
6. Fusionar por PR protegido con dos aprobaciones humanas.

Los registros admitidos son append-only. El CI compara contra el SHA base:
ningún bundle, snapshot u objeto existente puede modificarse, renombrarse o
borrarse. Una corrección crea un bundle nuevo.

## Frontera de CI

`pull_request_target` se usa únicamente para cargar workflow y checker desde el
SHA protegido de la base. El candidate se checkout en otro directorio y se trata
como datos: jamás se ejecutan su `package.json`, scripts, actions, hooks ni
binarios. El verifier tiene `contents:read`, no recibe secrets, no conserva
credenciales y tiene timeout. Cambios al checker y cambios de corpus deben
revisarse por separado antes de que el nuevo checker sea confiable.

El primer aterrizaje usa un bootstrap de dos PR porque el workflow confiable no
puede ejecutar `pull_request_target` antes de existir en `main`. El primer PR
permite `pull_request` únicamente contra el SHA vacío histórico
`48eaab09c4c0eb93d5149852a979e274b1aaa1d0`; un segundo PR ya preparado elimina
ese trigger y es validado por `pull_request_target`. Ningún reviewer, snapshot,
bundle ni byte de corpus puede admitirse hasta que ambos PR estén fusionados.
