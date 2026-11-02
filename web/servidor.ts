import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
// Reutilización: la web NO habla gRPC directamente, usa el mismo wrapper que cualquier otro consumidor.
import { CalculadoraClient, HistorialClient, CalculadoraError, ID_MAXIMO, OPERACIONES_VALIDAS } from '../wrapper/index.js';
import type { Operacion } from '../wrapper/index.js';

const rutaPublica = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const operaciones: readonly Operacion[] = OPERACIONES_VALIDAS;

/** Traduce el código de CalculadoraError a un estado HTTP. */
function estadoHttp(codigo: string): number {
  switch (codigo) {
    case 'INVALID_ARGUMENT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
      return 503;
    default:
      return 500;
  }
}

/** Error de validación de la entrada HTTP (se responde 400). */
class ErrorValidacion extends Error {}

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/** Solo dígitos: rechaza formatos que Number acepta como `1e3`, `0x10`, ` 5` o `+5`. */
const SOLO_DIGITOS = /^\d+$/;

/** Valida el id de la ruta (entero positivo que cabe en int32). */
function leerId(req: Request): number {
  const bruto = String(req.params.id);
  const id = SOLO_DIGITOS.test(bruto) ? Number(bruto) : NaN;
  if (!Number.isInteger(id) || id <= 0 || id > ID_MAXIMO) {
    throw new ErrorValidacion(`El id debe ser un entero positivo de hasta ${ID_MAXIMO}`);
  }
  return id;
}

/**
 * Crea la aplicación Express. Recibe los clientes ya construidos
 * para poder inyectar falsos en las pruebas.
 */
export function crearApp(calculadora: CalculadoraClient, historial: HistorialClient): Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(rutaPublica));

  // Express 5 propaga los rechazos de los handlers async al middleware de errores.
  app.post('/api/calcular', async (req, res) => {
    const cuerpo = (req.body ?? {}) as { operacion?: unknown; a?: unknown; b?: unknown };
    const { operacion, a, b } = cuerpo;
    if (typeof operacion !== 'string' || !operaciones.includes(operacion as Operacion)) {
      throw new ErrorValidacion(`Operación inválida. Usa: ${operaciones.join(', ')}`);
    }
    if (!esNumeroFinito(a)) throw new ErrorValidacion('A debe ser un número finito');
    if (operacion === 'raizCuadrada') {
      res.json(await calculadora.calcular('raizCuadrada', a));
      return;
    }
    if (!esNumeroFinito(b)) throw new ErrorValidacion('B es obligatorio y debe ser un número finito');
    res.json(await calculadora.calcular(operacion as Operacion, a, b));
  });

  app.get('/api/historial', async (req, res) => {
    const bruto = req.query.limite;
    let limite = 50;
    if (bruto !== undefined) {
      limite = typeof bruto === 'string' && SOLO_DIGITOS.test(bruto) ? Number(bruto) : NaN;
      if (!Number.isInteger(limite) || limite <= 0 || limite > ID_MAXIMO) {
        throw new ErrorValidacion(`limite debe ser un entero positivo de hasta ${ID_MAXIMO}`);
      }
    }
    res.json(await historial.listar(limite));
  });

  app.get('/api/historial/:id', async (req, res) => {
    res.json(await historial.obtener(leerId(req)));
  });

  app.delete('/api/historial/:id', async (req, res) => {
    res.json({ eliminado: await historial.eliminar(leerId(req)) });
  });

  app.delete('/api/historial', async (_req, res) => {
    res.json({ eliminados: await historial.limpiar() });
  });

  app.get('/api/salud', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada', codigo: 'NOT_FOUND' });
  });

  // Middleware de errores: nunca expone stack traces.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CalculadoraError) {
      res.status(estadoHttp(err.codigo)).json({ error: err.message, codigo: err.codigo });
    } else if (err instanceof ErrorValidacion) {
      res.status(400).json({ error: err.message, codigo: 'INVALID_ARGUMENT' });
    } else if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'JSON inválido', codigo: 'INVALID_ARGUMENT' });
    } else {
      console.error('Error inesperado:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Error interno del servidor', codigo: 'INTERNAL' });
    }
  });

  return app;
}

// Solo arranca cuando se ejecuta como script principal.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.WEB_PORT ?? 3000);
  const calculadora = new CalculadoraClient();
  const historial = new HistorialClient();
  const servidor: Server = crearApp(calculadora, historial).listen(puerto, () => {
    console.log(`Web lista en http://localhost:${puerto}`);
  });

  let cerrando = false;
  const cerrar = () => {
    if (cerrando) return;
    cerrando = true;
    console.log('Cerrando servidor web...');
    servidor.close(() => {
      calculadora.cerrar();
      historial.cerrar();
      process.exit(0);
    });
    servidor.closeAllConnections();
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}
