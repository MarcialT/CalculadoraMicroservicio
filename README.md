# Calculadora con microservicios gRPC

Calculadora con dos microservicios gRPC en Node.js y TypeScript. El servicio **Calculadora** resuelve las operaciones y le pide al servicio **Historial** que las guarde en PostgreSQL. Una web Express consume ambos a través de un **wrapper** cliente reutilizable.

## Arquitectura

```
 Navegador
     │ HTTP (JSON)
     ▼
┌───────────────┐    wrapper     ┌──────────────────────┐   wrapper    ┌──────────────────────┐   SQL    ┌────────────┐
│  Web (Express)│ ─────────────► │ Servicio Calculadora │ ───────────► │  Servicio Historial  │ ───────► │ PostgreSQL │
│  :3000        │     gRPC       │  gRPC :50051         │     gRPC     │  gRPC :50052         │          │ (Docker)   │
└───────┬───────┘                └──────────────────────┘              └──────────────────────┘          └────────────┘
        │  wrapper (gRPC)                                                        ▲
        └────────────────────────────────────────────────────────────────────────┘
          (la web también lista, consulta y elimina directamente en Historial)
```

Flujo de un cálculo: la web llama a `CalculadoraClient`; el servicio Calculadora calcula, guarda el registro con `HistorialClient` y responde con el resultado, el `id` y la `fecha` asignados por Historial. Si Historial no responde, no se devuelve el resultado y la web contesta 503.

Nota de diseño: si `Guardar` agota el deadline pero el INSERT sí llegó a ejecutarse, la fila queda guardada aunque la web responda 503. Es coherente con la regla "no se responde sin persistir": puede haber un registro sin respuesta al usuario, nunca una respuesta sin registro.

Los servicios gRPC escuchan por defecto en `127.0.0.1` (variable `BIND_HOST`); usa `0.0.0.0` solo para aceptar conexiones de otras máquinas.

Nota de seguridad: la contraseña por defecto de Postgres (`calculadora`) es solo para desarrollo local. Cámbiala en `.env` si usas `BIND_HOST=0.0.0.0` o si despliegas fuera de local.

## Requisitos de la tarea

| Requisito | Cómo se cumple | Archivo |
|---|---|---|
| Dos servicios RPC | Calculadora (`:50051`) e Historial (`:50052`), ambos gRPC | `servicios/calculadora/servidor.ts`, `servicios/historial/servidor.ts` |
| Datos de ida y vuelta | Cada RPC recibe operandos y devuelve `Resultado` con `id`, `resultado` y `fecha`; los errores viajan como códigos gRPC (`INVALID_ARGUMENT`, `NOT_FOUND`, `UNAVAILABLE`) | `proto/*.proto`, `wrapper/errores.ts` |
| Acceso a BD en el servidor | Solo el servicio Historial toca PostgreSQL (consultas parametrizadas con `pg`); ningún cliente accede a la BD | `servicios/historial/repositorio.ts`, `db/init.sql` |
| Wrapper reutilizado por la web Y por el servicio Calculadora | La web usa `CalculadoraClient` e `HistorialClient`; el servicio Calculadora usa `HistorialClient` para persistir | `wrapper/`, `web/servidor.ts`, `servicios/calculadora/servidor.ts` |

## Tecnologías

Node.js 24, TypeScript, gRPC (`@grpc/grpc-js`, `@grpc/proto-loader`), Express 5, PostgreSQL 16 en Docker (`pg`), vitest, tsx y concurrently.

## Estructura

```
proto/                 contratos .proto (calculadora, historial)
servicios/calculadora/ servicio gRPC de operaciones (+ pruebas)
servicios/historial/   servicio gRPC de persistencia (+ repositorio y pruebas)
wrapper/               librería cliente: CalculadoraClient, HistorialClient, CalculadoraError
web/                   servidor Express y front estático (public/)
db/init.sql            creación de la tabla operaciones
scripts/e2e.ts         prueba de punta a punta
docker-compose.yml     contenedor de PostgreSQL
```

## Requisitos previos

- Node.js 24 o superior
- Docker con Docker Compose

## Cómo correrlo

```bash
npm install
cp .env.example .env     # en Windows: copy .env.example .env
npm run db:up            # levanta PostgreSQL y crea la tabla
npm start                # historial + calculadora + web
```

Abre http://localhost:3000. Los servicios también se pueden levantar por separado con `npm run historial`, `npm run calculadora` y `npm run web`. `npm run db:down` detiene la base de datos.

## Pruebas

```bash
npm run typecheck   # verificación de tipos
npm test            # pruebas unitarias y de integración (vitest)
npm run e2e         # punta a punta contra los servicios reales (requiere npm start)
```

`npm test` usa el PostgreSQL de Docker (`npm run db:up`) para las pruebas del repositorio y del servidor de historial; si la BD no está arriba, esas pruebas se omiten (el resto corre sin servicios externos).

`npm run e2e` recorre el wrapper, la web y PostgreSQL, imprime ✔/✘ por paso, borra solo los registros que creó y termina con código 1 si algo falla.

## Contratos .proto

**`calculadora.proto`** (paquete `calculadora`)

| RPC | Request | Response |
|---|---|---|
| `Sumar`, `Restar`, `Multiplicar`, `Dividir`, `Potencia` | `Operandos { double a, b }` | `Resultado` |
| `RaizCuadrada` | `Operando { double a }` | `Resultado` |

`Resultado { int32 id, string operacion, double a, double b, bool tiene_b, double resultado, string fecha }`

**`historial.proto`** (paquete `historial`)

| RPC | Request | Response |
|---|---|---|
| `Guardar` | `NuevoRegistro { operacion, a, b, tiene_b, resultado }` | `Registro` |
| `Listar` | `ListarRequest { int32 limite }` | `ListaRegistros { repeated Registro }` |
| `Obtener` | `IdRequest { int32 id }` | `Registro` |
| `Eliminar` | `IdRequest { int32 id }` | `EliminarResponse { bool eliminado }` |
| `Limpiar` | `Vacio` | `LimpiarResponse { int32 eliminados }` |

## API web

| Método y ruta | Descripción |
|---|---|
| `POST /api/calcular` | Cuerpo `{ "operacion", "a", "b" }`; `b` no aplica en `raizCuadrada` |
| `GET /api/historial?limite=n` | Lista los últimos registros |
| `GET /api/historial/:id` | Obtiene un registro |
| `DELETE /api/historial/:id` | Elimina un registro |
| `DELETE /api/historial` | Vacía el historial |
| `GET /api/salud` | Estado de la web |

Códigos HTTP: 400 argumento inválido, 404 no encontrado, 503 servicio no disponible.

## Ejemplo de uso del wrapper

```ts
import { CalculadoraClient, HistorialClient, CalculadoraError } from './wrapper/index.js';

const calculadora = new CalculadoraClient({ host: 'localhost', port: 50051 });
const historial = new HistorialClient();

try {
  const r = await calculadora.sumar(2, 3);          // { id, resultado: 5, fecha, ... }
  const guardado = await historial.obtener(r.id);   // el registro persistido
  console.log(guardado.resultado);
  await calculadora.dividir(1, 0);
} catch (err) {
  if (err instanceof CalculadoraError) console.error(err.codigo, err.message); // INVALID_ARGUMENT
} finally {
  calculadora.cerrar();
  historial.cerrar();
}
```
