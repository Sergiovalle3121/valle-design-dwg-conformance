# Reglas del corpus DWG privado

- Mantener este repositorio privado y propietario (`UNLICENSED`).
- No consultar ni incorporar material en cuarentena.
- No añadir fixtures sin derechos, hash, tamaño, oracle y dos revisores humanos.
- No usar archivos de clientes, samples instalados ni archivos encontrados en
  Internet.
- No copiar, traducir, portar ni adaptar codecs, tablas o tests externos.
- No imprimir bytes, nombres sensibles, metadata privada o contenidos en CI.
- Toda ruta se resuelve dentro de su bundle; symlinks y escapes se rechazan.
- Los bundles admitidos son inmutables. Una revisión crea un bundle nuevo.
- En CI de PR sólo se ejecuta el verifier del SHA base protegido. El candidate
  es datos inertes y nunca aporta scripts, packages, actions o hooks ejecutados.
- Mientras falte el segundo revisor o el snapshot local de FACT_REGISTER, todo
  corpus no vacío debe rechazarse.
- Cero dependencias runtime. Tooling adicional requiere licencia permisiva,
  versión fija, SBOM y revisión.
