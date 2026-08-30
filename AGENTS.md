# Reglas del corpus DWG propietario

- El material es propietario (`UNLICENSED`): la visibilidad del repositorio la
  decide el titular, y que hoy sea público en GitHub no concede licencia
  alguna. No añadir licencias open source ni conceder derechos sobre fixtures,
  oráculos o herramientas.
- No consultar ni incorporar material en cuarentena.
- No añadir fixtures sin derechos, hash, tamaño, oracle y la revisión que
  `CORPUS_POLICY.md` exige para su origen: dos revisores humanos, salvo
  `tool-converted-original` (enmienda 2026-08-20 §b: revisor-propietario más
  dos validaciones automáticas independientes con evidencia hasheada).
- No usar archivos de clientes, samples instalados ni archivos encontrados en
  Internet.
- No copiar, traducir, portar ni adaptar codecs, tablas o tests externos.
- No imprimir bytes, nombres sensibles, metadata privada o contenidos en CI.
- Toda ruta se resuelve dentro de su bundle; symlinks y escapes se rechazan.
- Los bundles admitidos son inmutables. Una revisión crea un bundle nuevo.
- Cero dependencias runtime. Tooling adicional requiere licencia permisiva,
  versión fija, SBOM y revisión.
