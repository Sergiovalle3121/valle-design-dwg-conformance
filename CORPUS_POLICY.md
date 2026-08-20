# Política de admisión del corpus

## Regla fail-closed

Ningún archivo se descarga, abre, transforma, inspecciona técnicamente ni usa
para implementar el codec mientras esté en cuarentena. Sólo se conserva fuera
de Git la metadata mínima necesaria para decidir derechos. La admisión exige la
aprobación del titular y del segundo revisor humano.

## Material admisible

- dibujos originales de Sergio sin información de clientes;
- dibujos originales de un donante con permiso escrito suficiente; o
- material de terceros con licencia explícita que permita el uso concreto y,
  cuando corresponda, redistribución dentro de este repositorio privado.

Cada caso declara herramienta y versión de creación, titular del dibujo,
derechos sobre el output, ausencia de datos confidenciales, permiso de
modificación, alcance de redistribución y referencia privada del acuerdo.

## Material prohibido

- planos de clientes o información personal/confidencial;
- archivos encontrados al azar, samples instalados o trials con términos
  ambiguos;
- outputs de herramientas sin derecho comprobado;
- binarios filtrados, descompilados o usados para eludir protecciones;
- código, tablas, tests o fixtures de Autodesk, ODA, RealDWG, LibreDWG u otros
  codecs; y
- GPL, AGPL, LGPL, MPL, SSPL, BUSL, source-available, términos restringidos,
  desconocidos o incompatibles con el programa propietario.

## Admisión de un bundle

1. Registrar metadata segura fuera del árbol como `quarantined`.
2. Obtener revisión humana de derechos y ausencia de información de clientes.
3. Congelar fixture, oracle independiente y manifest; calcular SHA-256 y tamaño.
4. Verificar que el manifest satisface `manifest.schema.json` y que todos los
   paths permanecen dentro de `bundles/<bundle-id>`.
5. Ejecutar `npm run check`; revisar el diff sin mostrar bytes en logs.
6. Fusionar por PR protegido. El bundle es inmutable: una corrección crea un id
   y directorio nuevos, nunca reemplaza bytes bajo el mismo id.

El reader y writer Valle nunca son el único oráculo. Cada versión necesita dos
validaciones independientes autorizadas antes de promover una capability.

## Enmienda 2026-08-20 — origen `tool-converted-original`

Enmienda versionada de esta política, decidida y firmada por el propietario
del repositorio y titular único de todos los derechos sobre su contenido:
**Sergio Valle Zárate (@sergiovalle3121)**, 2026-08-20. Las secciones
anteriores permanecen intactas; lo que sigue las complementa.

### a) Nuevo origen admisible: `tool-converted-original`

Se admite material cuyo contenido es de autoría propia (Sergio / Valle
Design) — diseñado y escrito por el titular o por un agente que actúa por
encargo suyo, sin datos de clientes ni material de terceros — y cuyos bytes
DWG fueron producidos transformando esa fuente propia con una **herramienta
gratuita legítimamente obtenida**. Condiciones acumulativas:

- la fuente (p. ej. el DXF ASCII) es de autoría propia y queda congelada en
  el bundle como oráculo, junto con su generador reproducible versionado en
  este repositorio;
- la herramienta está registrada en `docs/TOOLS.md` con nombre, versión,
  hash SHA-256 del instalador, fuente de descarga, fecha y estado de sus
  términos, y el manifiesto la referencia vía `rights.toolRegistryRef`;
- la herramienta se ejecuta localmente como conversor/validador. Sus bytes,
  código, tablas o fixtures NUNCA entran a este repositorio ni al codec
  (la prohibición de la sección «Material prohibido» sigue íntegra).

### b) Revisión para bundles `tool-converted-original`

Para bundles de origen `tool-converted-original` — y SOLO para ellos — el
requisito de dos revisores humanos se sustituye por: **un revisor-propietario
(el titular) + dos validaciones automáticas independientes** con evidencia
hasheada. Los bundles `sergio-original`, `donated-original` y
`licensed-third-party` siguen exigiendo dos revisores humanos distintos.

**Riesgo asumido, por escrito:** con un solo revisor humano no existe una
segunda persona que pueda vetar un error de derechos del titular. El titular
lo acepta porque en este origen el material es 100 % de autoría propia y el
único derecho de tercero concebible sería el de la herramienta sobre sus
outputs, hecho que queda archivado en `docs/TOOLS.md` tal y como se observó,
sin inventar términos. Si un dictamen jurídico posterior contradice esta
lectura, los bundles afectados se retiran creando ids nuevos, nunca
reescribiendo historia.

### c) Caveat de representatividad

ODA File Converter es una implementación independiente y madura del formato,
pero **no es AutoCAD**. Un corpus convertido con ella demuestra
interoperabilidad con una segunda implementación, no compatibilidad con
archivos guardados por AutoCAD real. Esa prueba llegará con bundles
`donated-original` de usuarios reales, que siguen el flujo completo de dos
revisores. Ninguna evidencia derivada de este corpus puede afirmar
«compatible con AutoCAD».

### d) Nota de contrato

`manifest.schema.json`, `scripts/check-corpus.mjs`,
`scripts/build-manifest.mjs` y el consumidor de `valle-design` se enmiendan
en la misma fecha para reflejar (a) y (b). `schemaVersion` permanece en
`1.0.0` porque el cambio es retrocompatible: todo manifiesto válido antes de
la enmienda sigue siendo válido después.
