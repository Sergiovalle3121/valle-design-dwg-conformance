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
