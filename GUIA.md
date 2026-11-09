# Guía rápida — Calculadora Microservicios

## Qué es

Calculadora con **2 microservicios gRPC** + web Express + PostgreSQL.

```
Navegador → Web (:3000) → Calculadora (:50051) → Historial (:50052) → PostgreSQL
```

## Requisitos

- Node.js 24+
- Docker

## Arrancar

```bash
pnpm install
copy .env.example .env
pnpm run db:up
pnpm start
```

Abrir: http://localhost:3001 (si 3000 está ocupado, usa `WEB_PORT` en `.env`)

## Puertos

| Servicio     | Puerto |
|--------------|--------|
| Web          | 3001   |
| Calculadora  | 50051  |
| Historial    | 50052  |
| PostgreSQL   | Docker |

## Carpetas clave

| Carpeta                 | Rol                          |
|-------------------------|------------------------------|
| `proto/`                | Contratos gRPC               |
| `servicios/calculadora` | Operaciones matemáticas      |
| `servicios/historial`   | Persistencia en BD           |
| `wrapper/`              | Cliente gRPC reutilizable    |
| `web/`                  | API Express + front          |

## API web

- `POST /api/calcular` — `{ "operacion", "a", "b" }`
- `GET /api/historial`
- `GET /api/historial/:id`
- `DELETE /api/historial/:id`
- `DELETE /api/historial`
- `GET /api/salud`

Operaciones: `sumar`, `restar`, `multiplicar`, `dividir`, `potencia`, `raizCuadrada`

## Pruebas

```bash
pnpm run typecheck
pnpm test
pnpm run e2e   # con los servicios ya corriendo
```

## Parar BD

```bash
pnpm run db:down
```
