# Guía del proyecto — Calculadora con microservicios gRPC

## 1. Idea en una frase

Una **web HTTP** pide cálculos; un microservicio **Calculadora** (gRPC) los resuelve; otro microservicio **Historial** (gRPC) los guarda en **PostgreSQL**. Nadie habla gRPC “a pelo”: todos usan el **wrapper**. Regla clave: **si no se pudo guardar, no se responde el resultado**.

```
Navegador
   │  HTTP JSON
   ▼
Web Express (:3000 / WEB_PORT)
   │  wrapper → gRPC
   ▼
Calculadora (:50051) ──wrapper/gRPC──► Historial (:50052) ──SQL──► PostgreSQL
   ▲                                      ▲
   │                                      │
   └──── la web también lista/borra ──────┘
         historial directo (mismo wrapper)
```

| Pieza | Puerto | Qué es |
|-------|--------|--------|
| Calculadora | `50051` | Microservicio gRPC: math + pide guardar |
| Historial | `50052` | Microservicio gRPC: dueño de la BD |
| Web | `3000` | Express: UI + API JSON (no es microservicio RPC) |
| Wrapper | — | Librería cliente reutilizable |
| PostgreSQL | host `5434` → `5432` | Solo Historial la toca |

---

## 2. FAQ rápido

### ¿Dónde están los objetos de negocio?

En **`dominio/`** de cada servicio. Los `.proto` y `wrapper/tipos.ts` son **contrato/DTO** (transporte), no dominio.

| Objeto | Archivo | Rol |
|--------|---------|-----|
| `Calculo` | `servicios/calculadora/dominio/calculo.ts` | Operación + operandos + `resolver()` + shapes de salida |
| Math pura | `servicios/calculadora/operaciones.ts` | `sumar`, `dividir`, … sin red ni BD |
| `RegistroOperacion` | `servicios/historial/dominio/registro.ts` | Validar y representar un registro |
| Persistencia | `servicios/historial/repositorio.ts` | SQL; no decide reglas |

### ¿Dónde se aplican los microservicios?

Solo **dos** procesos gRPC: `servicios/calculadora` y `servicios/historial`. La web es fachada HTTP.

### ¿Dónde está el wrapper?

Carpeta **`wrapper/`**. Lo usan: web, Calculadora (solo `HistorialClient`) y `scripts/e2e.ts`.

### ¿Se puede usar gRPC sin handler?

**En el servidor, no.** El `.proto` dice *qué* se puede llamar; el **handler** es la función que se ejecuta *cuando* llega esa llamada. Sin handler registrado, el puerto escucha pero no atiende el RPC.

El **cliente no tiene handlers**: solo invoca (`CalculadoraClient.sumar(2, 3)`).

---

## 3. gRPC en este proyecto (cómo funciona de verdad)

### Piezas

1. **`.proto`** — contrato: servicio, RPCs y mensajes.
2. **Servidor** — `grpc.Server` + `addService(definición, handlers)`.
3. **Handler** — por cada RPC: lee request → dominio/repo → `callback(null, respuesta)` o `callback({ code, details })`.
4. **Cliente (wrapper)** — carga el mismo `.proto`, crea stub, llama con deadline, traduce errores.

Todos los RPC aquí son **unarios**: 1 request → 1 response.

### ¿Qué hace exactamente un handler?

Ejemplo mental de `Sumar` en Calculadora:

```
Cliente envía Operandos { a: 2, b: 3 }
        │
        ▼
Handler crearHandler('sumar', historial):
  1. Lee llamada.request.a / .b
  2. new Calculo('sumar', 2, 3) → calculo.resolver()  // = 5
  3. historial.guardar(...)                            // gRPC a Historial
  4. callback(null, calculo.aResultado(id, fecha))     // OK
     —o—
     callback({ code: INVALID_ARGUMENT, details: '...' })  // error de negocio
     callback({ code: UNAVAILABLE, details: '...' })       // Historial caído
```

En código se registran así:

```ts
for (const op of OPERACIONES_VALIDAS) handlers[op] = crearHandler(op, historial);
server.addService(Servicio.service, handlers);
```

| Lado | ¿Handler? | Rol |
|------|-----------|-----|
| Servidor | **Sí, obligatorio** | Ejecuta la lógica al recibir el RPC |
| Cliente / wrapper | No | Solo empaqueta, llama y espera |

### Errores

gRPC no usa HTTP 400/404. Usa **códigos**:

| Código | Cuándo (en este repo) |
|--------|------------------------|
| `INVALID_ARGUMENT` | División entre 0, id inválido, JSON malo (en web → 400) |
| `NOT_FOUND` | Registro inexistente |
| `UNAVAILABLE` / `DEADLINE_EXCEEDED` | Historial caído o timeout |
| `INTERNAL` | Bug / fallo de BD (mensaje genérico al cliente) |

La web traduce esos códigos a HTTP con `estadoHttp()`.

### Detalles técnicos útiles

- Credenciales: `createInsecure()` (solo local/demo).
- Bind: `BIND_HOST` default `127.0.0.1` (usa `0.0.0.0` solo si otras PCs deben conectar).
- `proto-loader` con `keepCase: false` → `tiene_b` en proto llega como `tieneB` en JS.
- Deadline del wrapper: **5 s** por defecto.

---

## 4. Flujo completo de un cálculo

`POST /api/calcular` con `{ "operacion": "sumar", "a": 2, "b": 3 }`:

1. **`web/public/app.js`** — `fetch('/api/calcular', …)`.
2. **`web/servidor.ts`** — valida JSON → `calculadora.calcular('sumar', 2, 3)`.
3. **`wrapper/calculadoraClient.ts`** — gRPC `Sumar` a `:50051`.
4. **Handler Calculadora** — `Calculo` → `resolver()` → `HistorialClient.guardar(...)`.
5. **Handler Historial** — `RegistroOperacion.desdeNuevo` → `repo.guardar` (INSERT) → `Registro` con `id` + `fecha`.
6. Calculadora arma `Resultado` con ese `id`/`fecha` y responde.
7. Web responde JSON al navegador; el front pinta resultado e historial.

Si el paso 5 falla o vence el deadline: Calculadora → `UNAVAILABLE` → web → **503**. No hay resultado “huérfano” hacia el usuario (puede quedar un INSERT si el timeout llegó tarde; la regla es no responder sin persistir).

---

## 5. Mapa de carpetas

```
proto/                         contratos .proto
servicios/calculadora/
  dominio/calculo.ts           objeto de negocio
  dominio/index.ts             reexporta dominio
  operaciones.ts               math pura
  servidor.ts                  handlers gRPC + arranque
  *.test.ts                    pruebas
servicios/historial/
  dominio/registro.ts          objeto de negocio
  dominio/index.ts
  repositorio.ts               SQL con pg
  servidor.ts                  handlers gRPC + arranque
  *.test.ts
wrapper/                       clientes + carga proto + errores + DTOs
web/
  servidor.ts                  Express API
  public/app.js                UI del navegador
  public/index.html, styles…
db/init.sql                    CREATE TABLE
docker-compose.yml             Postgres
scripts/e2e.ts                 prueba punta a punta real
.env.example                   variables
```

---

## 6. Contratos `.proto`

### `proto/calculadora.proto` (paquete `calculadora`)

Servicio `Calculadora`:

| RPC | Request | Response |
|-----|---------|----------|
| `Sumar`, `Restar`, `Multiplicar`, `Dividir`, `Potencia` | `Operandos { double a, b }` | `Resultado` |
| `RaizCuadrada` | `Operando { double a }` | `Resultado` |

`Resultado`: `id`, `operacion`, `a`, `b`, `tiene_b`, `resultado`, `fecha` (ISO).  
`id` y `fecha` **vienen de Historial**, no los inventa Calculadora.

### `proto/historial.proto` (paquete `historial`)

| RPC | Request | Response |
|-----|---------|----------|
| `Guardar` | `NuevoRegistro` | `Registro` |
| `Listar` | `ListarRequest { limite }` | `ListaRegistros` |
| `Obtener` / `Eliminar` | `IdRequest { id }` | `Registro` / `{ eliminado }` |
| `Limpiar` | `Vacio` | `{ eliminados }` |

`limite <= 0` → default 50 en repo. Tope efectivo: **500**.

---

## 7. Wrapper — archivo por archivo

Capa que **esconde** gRPC crudo detrás de TypeScript legible.

### `wrapper/tipos.ts` — DTOs (no dominio)

| Export | Qué es |
|--------|--------|
| `OPERACIONES_VALIDAS` | Lista fija: sumar…raizCuadrada |
| `Operacion` | Tipo unión de esos nombres |
| `ID_MAXIMO` | `2147483647` (int32; protobufjs trunca si te pasas) |
| `Registro` / `Resultado` | Shape persistido / respuesta de cálculo |
| `NuevoRegistro` | Shape para `Guardar` (sin id/fecha) |
| `OpcionesCliente` | `host`, `port`, `deadlineMs` |

### `wrapper/cargarProto.ts`

| Función | Qué hace por dentro |
|---------|---------------------|
| `cargarPaquete(nombre)` | Resuelve `proto/`, `protoLoader.loadSync`, `grpc.loadPackageDefinition` |
| `obtenerServicio(paquete, ns, nombre)` | Navega `paquete.calculadora.Calculadora` (o historial) y devuelve el constructor; si falta, lanza Error |

### `wrapper/errores.ts`

| Pieza | Qué hace |
|-------|----------|
| `CalculadoraError` | Error del wrapper: `codigo` (string), `codigoGrpc` (número), `message` |
| `aCalculadoraError(err)` | Mapea `err.code` → nombre (`UNAVAILABLE`, …); suaviza mensajes tipo “No connection established” |

### `wrapper/llamarUnario.ts`

| Función | Qué hace |
|---------|----------|
| `llamarUnario(cliente, metodo, request, deadlineMs)` | Envuelve el callback de gRPC en `Promise`; pone `deadline: Date.now() + deadlineMs`; si falla → `aCalculadoraError` |

### `wrapper/calculadoraClient.ts` — clase `CalculadoraClient`

| Método | Interno |
|--------|---------|
| `constructor` | Lee `CALC_HOST`/`CALC_PORT`, carga proto, `createInsecure()` |
| `llamar` (privado) | Delega a `llamarUnario` |
| `sumar`…`raizCuadrada` | RPC homónimo |
| `calcular(op, a, b?)` | Switch por nombre; exige `b` si no es raíz |
| `cerrar` | `cliente.close()` |

### `wrapper/historialClient.ts` — clase `HistorialClient`

| Método | Interno |
|--------|---------|
| `guardar` | RPC `guardar` con `NuevoRegistro` |
| `listar(limite)` | Valida rango → RPC → devuelve `registros[]` |
| `obtener` / `eliminar` | `validarRango(id)` antes de enviar |
| `limpiar` | RPC vacío → número de borrados |
| `validarRango` | Entero 1…`ID_MAXIMO` o `INVALID_ARGUMENT` local |

### `wrapper/index.ts`

Reexporta lo público para un solo import: `from './wrapper/index.js'`.

---

## 8. Servicio Calculadora — archivo por archivo

### `operaciones.ts` — math pura (sin I/O)

| Pieza | Qué hace |
|-------|----------|
| `ErrorOperacion` | Error de negocio matemático |
| `validar(valor, nombre)` | Assert: número finito |
| `verificarResultado(n)` | Rechaza `Infinity`/`NaN` (desbordamiento) |
| `sumar` / `restar` / `multiplicar` / `dividir` / `potencia` / `raizCuadrada` | Operan tras validar; dividir rechaza `b===0`; raíz rechaza `a<0` |
| `OPERACIONES` | Mapa nombre → función |
| `ejecutar(op, a, b?)` | Despacha por nombre; exige `b` si no es raíz |

### `dominio/calculo.ts` — objeto de negocio `Calculo`

| Pieza | Qué hace |
|-------|----------|
| `constructor(op, a, b?)` | Valida operación; marca `tieneB`; exige `b` en binarias |
| `resolver()` | Llama `ejecutar` y guarda `_resultado` |
| `resultado` / `resuelto` | Getter; falla si aún no resolviste |
| `aNuevoRegistro()` | Payload para Historial |
| `aResultado(id, fecha)` | Respuesta gRPC final |
| `textoOperandos()` | Para logs (`"2, 3"` o `"9"`) |

### `dominio/index.ts`

Reexporta `Calculo` y lo útil de `operaciones`.

### `servidor.ts` — handlers + proceso

| Pieza | Qué hace |
|-------|----------|
| `nombreLog(op)` | Capitaliza para logs |
| `crearHandler(op, historial)` | **El handler gRPC**: `Calculo` → `resolver` → `historial.guardar` → `callback` con éxito o códigos de error |
| `iniciarServidorCalculadora(puerto, historial?, host?)` | Carga proto, registra handlers, `bindAsync`, devuelve `{ server, puerto }` |
| Arranque (`import.meta.url`) | Lee `CALC_PORT`, crea `HistorialClient`, escucha, cierra limpio en SIGINT/SIGTERM |

Tabla de errores del handler:

| Excepción | Código gRPC |
|-----------|-------------|
| `ErrorOperacion` | `INVALID_ARGUMENT` |
| `CalculadoraError` UNAVAILABLE / DEADLINE | `UNAVAILABLE` |
| Otro | `INTERNAL` |

---

## 9. Servicio Historial — archivo por archivo

### `dominio/registro.ts` — objeto de negocio `RegistroOperacion`

| Pieza | Qué hace |
|-------|----------|
| `ErrorValidacionRegistro` | → se traduce a `INVALID_ARGUMENT` |
| `desdeNuevo(nuevo)` | Valida y crea pendiente (`id`/`fecha` null); unaria → `b=0` |
| `desdePersistido(dto)` | Rehidrata tras BD; valida id |
| `validarNuevo` | Operación en lista + números finitos |
| `validarId` | Entero `> 0` |
| `persistido` | `id` y `fecha` no null |
| `aNuevoRegistro()` | Payload INSERT |
| `aRegistro()` | DTO completo (falla si no persistido) |

### `repositorio.ts` — único acceso a Postgres

| Pieza | Qué hace |
|-------|----------|
| `crearPool()` | `pg.Pool` desde `DB_HOST`, `DB_PORT` (5434), user/pass/db |
| `filaARegistro(fila)` | `b NULL` → `b=0`, `tieneB=false`; fecha → ISO |
| `RepositorioOperaciones.guardar` | `INSERT … RETURNING *` parametrizado; `tieneB=false` → `b=NULL` |
| `listar(limite)` | Default 50, max 500, `ORDER BY id DESC` |
| `obtener` / `eliminar` / `limpiar` | SELECT/DELETE por id o DELETE all |

### `servidor.ts` — handlers + proceso

| Pieza | Qué hace |
|-------|----------|
| `errorGrpc(code, mensaje)` | Arma `ServiceError` |
| `manejar(metodo, logica)` | Wrapper de handler: ejecuta lógica, loguea, traduce `ErrorValidacionRegistro` / `NOT_FOUND` / `INTERNAL` |
| Handlers | `guardar` usa dominio+repo; `listar`/`obtener`/`eliminar`/`limpiar` delegan al repo tras validar |
| `iniciarServidorHistorial` | Pool + proto + bind |
| Arranque | `HIST_PORT`, cierre: `tryShutdown` + `pool.end()` |

Errores de BD **no** se reenvían al cliente (solo log + `INTERNAL`).

---

## 10. Base de datos

### `db/init.sql`

Se monta al **crear** el contenedor (`docker-entrypoint-initdb.d`):

```sql
CREATE TABLE IF NOT EXISTS operaciones (
  id SERIAL PRIMARY KEY,
  operacion TEXT NOT NULL,
  a DOUBLE PRECISION NOT NULL,
  b DOUBLE PRECISION NULL,          -- NULL = unaria
  resultado DOUBLE PRECISION NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `docker-compose.yml`

- Imagen `postgres:16-alpine`, volumen persistente, healthcheck.
- Puerto host **`5434`** → `5432` solo en `127.0.0.1`.
- Password default `calculadora` = solo desarrollo.

---

## 11. Web — archivo por archivo

### `web/servidor.ts`

| Pieza | Qué hace |
|-------|----------|
| `estadoHttp(codigo)` | gRPC/string → 400/404/503/500 |
| `ErrorValidacion` | Input HTTP malo → 400 |
| `esNumeroFinito` | Type guard |
| `leerId(req)` | Solo dígitos, 1…`ID_MAXIMO` (rechaza `1e3`, `0x10`) |
| `crearApp(calc, hist)` | Rutas API + estáticos + middleware de errores (sin stack traces) |
| Arranque | `WEB_PORT`, construye ambos clientes wrapper, cierra conexiones al salir |

| Ruta | Acción |
|------|--------|
| `POST /api/calcular` | Valida → `calculadora.calcular` |
| `GET /api/historial` | `historial.listar` (default 50) |
| `GET/DELETE /api/historial/:id` | obtener / eliminar |
| `DELETE /api/historial` | limpiar |
| `GET /api/salud` | `{ ok: true }` |

### `web/public/app.js` (front)

| Función | Rol |
|---------|-----|
| `api(ruta, opciones)` | `fetch` + parse JSON + error legible (503 destacado) |
| `seleccionarOperacion` | Cambia op; oculta campo B en raíz |
| `formatearNumero` / `describirOperacion` | UI legible |
| Submit del form | `POST /api/calcular` + refresca tabla |
| Carga/borrado historial | Llama a las rutas DELETE/GET del API |

No conoce gRPC: solo HTTP al Express.

---

## 12. Scripts y config

| Archivo | Rol |
|---------|-----|
| `scripts/e2e.ts` | Contra stack real: wrapper + web + SQL; registra ids y limpia solo esos; exit 1 si falla |
| `package.json` | `pnpm start` = concurrently historial+calculadora+web; `db:up`/`db:down`; `test`; `e2e` |
| `vitest.config.ts` | Runner de tests |
| `.env` / `.env.example` | `DB_*`, `CALC_*`, `HIST_*`, `WEB_PORT`, `BIND_HOST` |
| `pnpm-workspace.yaml` | Aprueba builds de `esbuild` / `protobufjs` |
| `.npmrc` | `verify-deps-before-run=false`, permite builds locales |

---

## 13. Cómo correrlo

Requisitos: **Node 24+**, **Docker Desktop**.

```bash
pnpm install
copy .env.example .env
pnpm run db:up
pnpm start
```

Abrir http://localhost:3000 (o tu `WEB_PORT`; si 3000 ocupado → `WEB_PORT=3001`).

Orden si arrancas aparte: **Historial → Calculadora → Web**.

```bash
pnpm run typecheck
pnpm test
pnpm run e2e          # con el stack arriba
```

Si `ERR_PNPM_IGNORED_BUILDS`:

```bash
pnpm rebuild esbuild protobufjs
pnpm install
```

---

## 14. Desacoplamiento (qué sí / qué no)

| Separación | Estado |
|------------|--------|
| Calculadora ↔ Historial | Solo red gRPC + wrapper |
| Web ↔ servicios | Solo wrapper |
| BD | Solo Historial (`pg`) |
| Dominio ↔ transporte | `dominio/` vs proto/tipos |
| Math | Sin I/O |

Acoplamientos normales: mismo contrato proto; Calculadora depende de Historial para persistir (regla de negocio).

---

## 15. Cumplimiento de requisitos

| Requisito | Dónde |
|-----------|-------|
| Dos servicios RPC | `servicios/calculadora`, `servicios/historial` |
| Objetos de negocio | `Calculo`, `RegistroOperacion` |
| Ida/vuelta + errores gRPC | proto + handlers + `wrapper/errores.ts` |
| BD solo en servidor | `historial/repositorio.ts` |
| Wrapper reutilizado | Web + Calculadora |

---

## 16. Checklist mental

1. Cambias un RPC → empiezas en `proto/`.
2. Reglas → `dominio/`; handlers solo orquestan.
3. Historial dueño de SQL; Calculadora no conoce tablas.
4. Wrapper = única forma de hablar gRPC desde consumidores.
5. Web = HTTP; el “cerebro” distribuido es gRPC.
6. Sin Historial → no hay resultado de cálculo al cliente.
7. Sin handler en el server → el RPC no existe en la práctica.
