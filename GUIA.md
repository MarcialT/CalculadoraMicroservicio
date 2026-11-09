# Guía del proyecto — Calculadora con microservicios gRPC

## Idea general

Sistema distribuido en **Node.js + TypeScript** con **dos microservicios gRPC** y una **web Express**.

- **Calculadora** (`:50051`): hace las operaciones matemáticas.
- **Historial** (`:50052`): guarda/consulta/borra en **PostgreSQL**. Es el **único** que toca la BD.
- **Web** (`:3000`): UI + API HTTP/JSON. Habla gRPC solo vía el **wrapper**.
- **Wrapper**: librería cliente reutilizable (`CalculadoraClient`, `HistorialClient`). La usan la web **y** el servicio Calculadora.

Regla de negocio clave: **no se responde un cálculo si no se persistió**. Si Historial cae, Calculadora responde `UNAVAILABLE` y la web `503`.

---

## Arquitectura y flujo

```
Navegador
   │ HTTP JSON
   ▼
Web Express (:3000) ──wrapper/gRPC──► Calculadora (:50051) ──wrapper/gRPC──► Historial (:50052) ──SQL──► PostgreSQL
        │                                                                              ▲
        └────────────────────────── wrapper/gRPC (listar/obtener/eliminar/limpiar) ────┘
```

### Flujo de un cálculo (`POST /api/calcular`)

1. Web valida JSON → `CalculadoraClient.calcular(...)`.
2. Calculadora ejecuta la operación en `operaciones.ts` (lógica pura).
3. Calculadora llama `HistorialClient.guardar(...)`.
4. Historial valida, hace `INSERT` y devuelve `Registro` con `id` + `fecha`.
5. Calculadora responde `Resultado` (mismo shape que el registro).
6. Web responde JSON al navegador.

Si el deadline de `Guardar` vence pero el `INSERT` sí corrió, puede quedar un registro sin respuesta al usuario. Es aceptable: **nunca** hay respuesta sin persistencia.

Credenciales gRPC: `createInsecure()` (solo local/demo). Bind por defecto `127.0.0.1` (`BIND_HOST`); usa `0.0.0.0` solo si otras máquinas deben conectar.

---

## Tecnologías

| Pieza | Tecnología |
|-------|------------|
| Runtime | Node.js 24+, TypeScript, `tsx` |
| RPC | gRPC (`@grpc/grpc-js` + `@grpc/proto-loader`) |
| Web | Express 5 + estáticos en `web/public/` |
| BD | PostgreSQL 16 (Docker), cliente `pg` |
| Orquestación local | `concurrently`, `docker compose` |
| Tests | Vitest (`test`), script `e2e` |

---

## Estructura

```
proto/                     contratos .proto (fuente de verdad del RPC)
servicios/calculadora/     servidor gRPC + operaciones.ts + tests
servicios/historial/       servidor gRPC + repositorio.ts + tests
wrapper/                   clientes, carga de proto, errores, tipos
web/                       Express + public/ (front)
db/init.sql                CREATE TABLE operaciones
docker-compose.yml         Postgres (puerto host 5434 → 5432)
scripts/e2e.ts             punta a punta real
.env.example               variables de entorno
```

---

## Qué es gRPC aquí (resumen práctico)

- Contratos en **Protocol Buffers** (`proto3`): definen **servicios**, **RPC** y **mensajes**.
- Comunicación binaria HTTP/2; más tipada y eficiente que REST entre servicios.
- Todos los RPC de este proyecto son **unarios** (1 request → 1 response).
- Errores = **códigos de estado gRPC** (`INVALID_ARGUMENT`, `NOT_FOUND`, `UNAVAILABLE`, `INTERNAL`, `DEADLINE_EXCEEDED`…), no HTTP.
- `proto-loader` carga `.proto` en runtime (`keepCase: false` → `tiene_b` llega como `tieneB` en JS).
- Deadline por defecto del wrapper: **5 s**.

---

## Contratos `.proto`

### `proto/calculadora.proto` — paquete `calculadora`

Servicio `Calculadora`:

| RPC | Request | Response |
|-----|---------|----------|
| `Sumar`, `Restar`, `Multiplicar`, `Dividir`, `Potencia` | `Operandos { double a, b }` | `Resultado` |
| `RaizCuadrada` | `Operando { double a }` | `Resultado` |

```
Resultado {
  int32 id
  string operacion
  double a, b
  bool tiene_b      # false en RaizCuadrada
  double resultado
  string fecha      # ISO 8601
}
```

El `id` y la `fecha` **no** los inventa Calculadora: vienen de Historial tras `Guardar`.

### `proto/historial.proto` — paquete `historial`

Servicio `Historial`:

| RPC | Request | Response |
|-----|---------|----------|
| `Guardar` | `NuevoRegistro { operacion, a, b, tiene_b, resultado }` | `Registro` |
| `Listar` | `ListarRequest { int32 limite }` | `ListaRegistros { repeated Registro }` |
| `Obtener` | `IdRequest { int32 id }` | `Registro` |
| `Eliminar` | `IdRequest { int32 id }` | `EliminarResponse { bool eliminado }` |
| `Limpiar` | `Vacio` | `LimpiarResponse { int32 eliminados }` |

`Registro` tiene la misma forma que `Resultado`. `limite <= 0` → default del servicio (50). Máximo efectivo en repo: **500**.

---

## Wrapper (`wrapper/`)

Capa que **esconde** gRPC crudo detrás de API TypeScript.

| Archivo | Rol |
|---------|-----|
| `cargarProto.ts` | Carga `.proto` y obtiene el constructor del servicio |
| `llamarUnario.ts` | Promise + deadline + traducción de errores |
| `errores.ts` | `CalculadoraError { codigo, codigoGrpc, message }` |
| `tipos.ts` | `Operacion`, `Registro`, `NuevoRegistro`, `ID_MAXIMO` (int32) |
| `calculadoraClient.ts` | Cliente: `sumar`, `restar`, …, `calcular`, `cerrar` |
| `historialClient.ts` | Cliente: `guardar`, `listar`, `obtener`, `eliminar`, `limpiar` |
| `index.ts` | Reexporta todo lo público |

Operaciones válidas: `sumar | restar | multiplicar | dividir | potencia | raizCuadrada`.

Quién lo usa:

- **Web** → ambos clientes.
- **Calculadora** → solo `HistorialClient` para persistir.

Ejemplo:

```ts
import { CalculadoraClient, HistorialClient, CalculadoraError } from './wrapper/index.js';

const calc = new CalculadoraClient({ host: 'localhost', port: 50051 });
const hist = new HistorialClient();

try {
  const r = await calc.sumar(2, 3);       // { id, resultado: 5, fecha, ... }
  const row = await hist.obtener(r.id);
  await calc.dividir(1, 0);              // INVALID_ARGUMENT
} catch (e) {
  if (e instanceof CalculadoraError) console.error(e.codigo, e.message);
} finally {
  calc.cerrar();
  hist.cerrar();
}
```

---

## Servicio Calculadora (`servicios/calculadora/`)

### `operaciones.ts` — lógica pura

Valida números finitos; rechaza división por 0, raíz de negativo, desbordamiento (`Infinity`/`NaN`). Lanza `ErrorOperacion` → gRPC `INVALID_ARGUMENT`.

### `servidor.ts` — handlers gRPC

Por cada operación: **calcular → guardar en Historial → responder**.

| Error | Código gRPC |
|-------|-------------|
| `ErrorOperacion` | `INVALID_ARGUMENT` |
| Historial caído (`UNAVAILABLE` / `DEADLINE_EXCEEDED`) | `UNAVAILABLE` |
| Otro | `INTERNAL` |

Puerto: `CALC_PORT` (default `50051`). Cierre ordenado con `SIGINT`/`SIGTERM`.

---

## Servicio Historial (`servicios/historial/`)

### `repositorio.ts` — único acceso a Postgres

Tabla `operaciones`. Consultas **parametrizadas** (`$1`, `$2`…).

- `b NULL` en BD ↔ operación unaria (`tieneB: false`, `b: 0` en el mensaje).
- Pool desde `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

### `servidor.ts` — handlers gRPC

Valida operación, números e ids. Errores de BD **no** se filtran al cliente (solo log + `INTERNAL`).

| Caso | Código |
|------|--------|
| Validación | `INVALID_ARGUMENT` |
| Id inexistente | `NOT_FOUND` |
| Fallo BD/interno | `INTERNAL` |

Puerto: `HIST_PORT` (default `50052`).

---

## Base de datos

`db/init.sql` (se monta al crear el contenedor):

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

Docker: imagen `postgres:16-alpine`, volumen persistente, healthcheck, puerto **host `5434`** → contenedor `5432` (solo `127.0.0.1`). Password default `calculadora` = solo desarrollo.

---

## Web (`web/servidor.ts`)

Express sirve `public/` y expone API. No usa gRPC directo: solo wrapper.

| Método | Ruta | Qué hace |
|--------|------|----------|
| `POST` | `/api/calcular` | `{ operacion, a, b? }` → Calculadora |
| `GET` | `/api/historial?limite=n` | Lista (default 50) |
| `GET` | `/api/historial/:id` | Un registro |
| `DELETE` | `/api/historial/:id` | Borra uno |
| `DELETE` | `/api/historial` | Vacía todo |
| `GET` | `/api/salud` | `{ ok: true }` |

Mapeo errores → HTTP:

| Código gRPC / validación | HTTP |
|--------------------------|------|
| `INVALID_ARGUMENT` / JSON malo | 400 |
| `NOT_FOUND` | 404 |
| `UNAVAILABLE` / `DEADLINE_EXCEEDED` | 503 |
| Otro | 500 |

Validaciones extra: ids solo dígitos (rechaza `1e3`, `0x10`), rango hasta `ID_MAXIMO` (int32). No se exponen stack traces.

---

## Variables de entorno (`.env`)

| Variable | Default | Uso |
|----------|---------|-----|
| `DB_*` | localhost / 5434 / calculadora | Postgres |
| `CALC_HOST` / `CALC_PORT` | localhost / 50051 | Cliente → Calculadora |
| `HIST_HOST` / `HIST_PORT` | localhost / 50052 | Cliente → Historial |
| `WEB_PORT` | 3000 | Express |
| `BIND_HOST` | 127.0.0.1 | Interfaz de escucha gRPC |

---

## Cómo correrlo

Requisitos: **Node.js 24+**, **Docker**.

```bash
pnpm install
copy .env.example .env
pnpm run db:up          # Postgres + init.sql
pnpm start              # historial + calculadora + web
```

Abrir http://localhost:3000 (o el `WEB_PORT` de tu `.env`).

Por separado: `pnpm run historial` | `calculadora` | `web`. Bajar BD: `pnpm run db:down`.

Orden recomendado: **Historial → Calculadora → Web** (Calculadora depende de Historial para persistir).

---

## Pruebas

```bash
pnpm run typecheck   # tsc --noEmit
pnpm test            # unitarias + integración (vitest)
pnpm run e2e         # contra servicios reales (requiere stack arriba)
```

- Con BD abajo, tests de repositorio/historial se **omitirán**; el resto corre.
- `e2e` valida wrapper + web + Postgres, limpia solo lo que creó, exit `1` si falla.

---

## Cumplimiento de requisitos (mapa rápido)

| Requisito | Dónde |
|-----------|-------|
| Dos servicios RPC | `servicios/calculadora`, `servicios/historial` |
| Datos ida/vuelta + errores gRPC | `proto/*`, handlers, `wrapper/errores.ts` |
| BD solo en servidor | `historial/repositorio.ts` (nadie más usa `pg`) |
| Wrapper reutilizado | Web + Calculadora importan `wrapper/` |

---

## Checklist mental del sistema

1. Contratos viven en `proto/` — cambias RPC ahí primero.
2. Historial es dueño de la persistencia; Calculadora no conoce SQL.
3. Wrapper unifica clientes y errores para todos los consumidores.
4. Web es fachada HTTP; el “cerebro distribuido” es gRPC entre servicios.
5. Sin Historial disponible → no hay resultado de cálculo al cliente.
