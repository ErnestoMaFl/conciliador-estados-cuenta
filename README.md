# Conciliador de estados de cuenta

Página web estática (GitHub Pages) que concilia dos estados de cuenta **por monto exacto y después por fecha**, y saca en cuadros listos para copiar lo que **no está** en cada uno. Opcionalmente guarda cada periodo en un **GitHub Gist** como archivos CSV.

Es HTML, CSS y JavaScript sin dependencias ni compilación. Todo el cálculo ocurre en el navegador.

## Cómo se usa

1. Copia de Excel las columnas **Fecha · Concepto · Cargos · Abonos** de cada estado de cuenta y pégalas en A y en B. También puedes importar un CSV.
   - Si traes encabezado, se reconocen nombres como *Retiros/Depósitos*, *Descripción* o *Fecha de operación*, y se ignoran columnas extra como *Saldo*.
   - Fechas: `dd/mm/aaaa`, `dd/mm/aa`, `aaaa-mm-dd` o `01/OCT/2026`. Montos: `$1,234.50`, `1234.5`, `-30.00` o `(30.00)`.
2. Presiona **Conciliar**.
3. Usa **Copiar** en cada cuadro *"No está en …"* y pega en Excel o en un correo. Se pega como tabla con Fecha, Concepto y Monto.

### Reglas

| Regla | Detalle |
|---|---|
| Monto exacto | Solo se concilia si el monto es idéntico al centavo. |
| Montos repetidos | Primero se empareja con la **misma fecha** y después con la **más cercana**. |
| Uno a uno | Cada movimiento se usa una sola vez: tres pagos de 30 contra dos dejan uno pendiente. |
| Diferencias de centavos | Nunca se concilian solas; se marcan ⚠ *posible coincidencia* según la tolerancia configurada. |
| Columnas | *Directo*: cargos↔cargos y abonos↔abonos. *Cruzado*: cargos↔abonos (banco contra libros). |
| Máximo de días | Opcional. Un mismo monto más alejado que ese límite queda pendiente y se sugiere. |

Los montos se manejan en centavos enteros, sin errores de punto flotante. Con los mismos datos el resultado es siempre el mismo.

## Base de datos en GitHub Gist

### 1. Crear el token

1. GitHub → *Settings → Developer settings → Personal access tokens → **Fine-grained tokens*** → *Generate new token*.
2. Ponle una fecha de expiración.
3. En **Account permissions → Gists** elige **Read and write**. No hace falta ningún otro permiso ni acceso a repositorios.

### 2. Conectar

- **Primera vez:** pega el token y presiona **Crear Gist nuevo**. Se crea un Gist **secreto**; anota su ID para usarlo en otros equipos.
- **Después:** pega el token y el ID (o la URL del Gist) y presiona **Conectar**.

Marca *Recordar el token* solo en un equipo personal. Si no la marcas, el token se olvida al cerrar la pestaña.

### Estructura del Gist

| Archivo | Contenido |
|---|---|
| `periodos.csv` | Índice: `periodo, nombre, nombre_a, nombre_b, movimientos_a, movimientos_b, conciliados, pendientes_a, pendientes_b, actualizado` |
| `config.csv` | Reglas: `clave, valor` (`cruce`, `tolerancia`, `max_dias`) |
| `<periodo>__A.csv` | Movimientos de A: `fecha (aaaa-mm-dd), concepto, cargo, abono` |
| `<periodo>__B.csv` | Movimientos de B, mismo formato |
| `<periodo>__resultado.csv` | Resultado de la última conciliación, con la fila original de cada movimiento |

Los archivos son CSV normales: se pueden abrir o editar desde gist.github.com, y GitHub guarda el historial de revisiones.

### Privacidad: léelo antes de guardar datos reales

- Un Gist **secreto** no aparece en búsquedas ni en tu perfil, pero **cualquiera que tenga la URL puede leerlo**. No es cifrado.
- Los datos quedan almacenados en los servidores de GitHub.
- El token se guarda en el navegador (`sessionStorage`, o `localStorage` si marcas *Recordar*) y solo se envía a `api.github.com`. Las páginas de GitHub Pages de una misma cuenta comparten origen (`usuario.github.io`), así que usa un token que **solo** tenga permiso de Gists.
- Si no conectas un Gist, nada sale de tu navegador.

## Publicar en GitHub Pages

```bash
gh repo create conciliador-estados-cuenta --public --source . --push
gh api -X POST repos/{owner}/conciliador-estados-cuenta/pages -f "source[branch]=main" -f "source[path]=/"
```

La página queda en `https://<usuario>.github.io/conciliador-estados-cuenta/`. El repositorio solo contiene código, no datos ni tokens.

## Desarrollo

```bash
npm start   # sirve en http://localhost:8080 (los módulos ES no funcionan abriendo el archivo directo)
npm test    # pruebas de la lógica con node:test (Node 18 o más reciente)
```

| Archivo | Responsabilidad |
|---|---|
| `js/formato.js` | Fechas y montos (centavos enteros) |
| `js/csv.js` | Lectura y escritura de CSV/TSV con comillas |
| `js/entrada.js` | Texto pegado → movimientos validados |
| `js/conciliacion.js` | Motor de conciliación |
| `js/salida.js` | Cuadros para copiar y CSV de resultado |
| `js/gist.js` | API de GitHub Gists |
| `js/app.js` | Interfaz |

### Limitaciones conocidas

- Un Gist muestra hasta 300 archivos (unos 100 periodos). Para más, conviene un Gist por año.
- Las fechas ambiguas se interpretan como **día/mes** (formato de México).
- Si dos personas guardan el mismo periodo al mismo tiempo, gana el último guardado.
