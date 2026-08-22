# Donar planos al corpus de conformidad

El único activo de este proyecto que no se puede fabricar ni acelerar es la
evidencia INDEPENDIENTE: planos reales, de despachos reales, con permiso real.
Cada plano donado hace el producto más difícil de copiar y más digno de
confianza — es el foso que crece solo con el tiempo. Este documento es el
mecanismo completo para que una donación entre bien desde el primer usuario.

## Para el despacho donante: qué pedimos y qué prometemos

**Pedimos**: uno o más archivos DWG/DXF de SU autoría (no de sus clientes),
sin datos personales ni información confidencial, con un permiso escrito de
una página.

**Prometemos**: (1) el archivo se usa SÓLO para verificar la fidelidad del
software (abrir, comparar, medir — nunca redistribuir fuera de este
repositorio de conformidad); (2) su procedencia queda registrada con su
crédito o su anonimato, a elección; (3) cada versión del producto se verifica
contra su plano — si algún día Valle Design lo abriera mal, ese error detiene
la versión.

## El permiso escrito (mínimo suficiente)

Una página firmada (papel o correo desde el dominio del despacho) que diga:

> Yo, [nombre], titular de los derechos de los archivos [lista], autorizo a
> Sergio Valle Zárate a usarlos como material de prueba de compatibilidad de
> Valle Design, incluyendo su copia dentro del repositorio privado de
> conformidad, su apertura, conversión y comparación automática. Declaro que
> no contienen datos de terceros ni información confidencial. [Elegir:
> Deseo crédito como donante / Deseo permanecer anónimo.]

La referencia privada del acuerdo (dónde está guardado el correo o el papel)
se registra en la declaración; el documento firmado NUNCA se sube al
repositorio.

## El procedimiento (es el de admisión de siempre, con origen `donated`)

1. El titular registra la declaración en `incoming/<bundle-id>.declaration.json`
   con `origin: "donated"`, herramienta y versión de creación declaradas por
   el donante, y la referencia privada del permiso. El archivo queda en
   CUARENTENA: nadie lo abre todavía (regla fail-closed de
   `CORPUS_POLICY.md`).
2. Revisión humana de derechos y de ausencia de datos de clientes.
3. Congelación del bundle: fixture + oráculo externo independiente + manifest
   con SHA-256, como cualquier bundle (`manifest.schema.json`).
4. `npm run check` en verde y admisión firmada por el titular.

## El compromiso de fidelidad por versión

Desde el momento en que un bundle donado se admite, entra a la matriz que el
producto corre en cada corte (`check:dwg-evidence` en el repositorio del
producto consume este corpus por espejo). Un donado que deja de abrir con
cero discrepancias es un GATE ROJO del producto, con el mismo peso que
cualquier otro. La rúbrica competitiva del producto cuenta la evidencia
donada como INDEPENDIENTE — la única clase de evidencia que puede llevar una
fila a su tope.

## Registro de donaciones

| Bundle | Donante (o «anónimo») | Fecha de admisión | Nota |
| --- | --- | --- | --- |
| — | — | — | Todavía ninguna: el mecanismo queda listo antes que el primer cliente, que es el punto. |
