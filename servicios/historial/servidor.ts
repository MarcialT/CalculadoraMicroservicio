import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import type pg from 'pg';
import { cargarPaquete, obtenerServicio } from '../../wrapper/cargarProto.js';
import { OPERACIONES_VALIDAS } from '../../wrapper/tipos.js';
import type { NuevoRegistro } from '../../wrapper/tipos.js';
import { RepositorioOperaciones, crearPool } from './repositorio.js';

/** Error de validación que se traduce a INVALID_ARGUMENT. */
class ErrorValidacion extends Error {}

/** Marca de "no existe" que se traduce a NOT_FOUND. */
interface NoEncontrado {
  noEncontrado: string;
}

function validarNuevo(n: NuevoRegistro): void {
  if (!n.operacion || n.operacion.trim() === '') throw new ErrorValidacion('La operación es obligatoria');
  if (!(OPERACIONES_VALIDAS as readonly string[]).includes(n.operacion)) {
    throw new ErrorValidacion(`Operación inválida. Usa: ${OPERACIONES_VALIDAS.join(', ')}`);
  }
  if (!Number.isFinite(n.a) || !Number.isFinite(n.b) || !Number.isFinite(n.resultado)) {
    throw new ErrorValidacion('Los números deben ser finitos');
  }
}

function validarId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('El id debe ser mayor que 0');
}

function errorGrpc(code: grpc.status, mensaje: string): grpc.ServiceError {
  return { code, details: mensaje, name: 'Error', message: mensaje, metadata: new grpc.Metadata() };
}

/** Envuelve un handler unario: loguea y traduce errores (los de BD se ocultan al cliente). */
function manejar<Req, Res>(
  metodo: string,
  logica: (req: Req) => Promise<{ res: Res; log: string } | NoEncontrado>,
): grpc.handleUnaryCall<Req, Res> {
  return (llamada, callback) => {
    logica(llamada.request).then(
      (salida) => {
        if ('noEncontrado' in salida) {
          console.log(`[historial] ${metodo} → NOT_FOUND`);
          callback(errorGrpc(grpc.status.NOT_FOUND, salida.noEncontrado));
          return;
        }
        console.log(`[historial] ${metodo} ${salida.log}`);
        callback(null, salida.res);
      },
      (err: unknown) => {
        if (err instanceof ErrorValidacion) {
          console.log(`[historial] ${metodo} → INVALID_ARGUMENT (${err.message})`);
          callback(errorGrpc(grpc.status.INVALID_ARGUMENT, err.message));
          return;
        }
        console.error(`[historial] ${metodo} falló:`, err);
        callback(errorGrpc(grpc.status.INTERNAL, 'Error interno del servicio de historial'));
      },
    );
  };
}

/** Crea y arranca el servidor gRPC del historial. Devuelve el server y el puerto real. */
export async function iniciarServidorHistorial(
  puerto: number,
  pool: pg.Pool = crearPool(),
  host: string = process.env.BIND_HOST ?? '127.0.0.1',
): Promise<{ server: grpc.Server; puerto: number; pool: pg.Pool }> {
  const repo = new RepositorioOperaciones(pool);
  const Servicio = obtenerServicio(cargarPaquete('historial.proto'), 'historial', 'Historial');

  const handlers: grpc.UntypedServiceImplementation = {
    guardar: manejar<NuevoRegistro, unknown>('Guardar', async (req) => {
      validarNuevo(req);
      const r = await repo.guardar(req);
      return { res: r, log: `${req.operacion} → id ${r.id}` };
    }),
    listar: manejar<{ limite: number }, unknown>('Listar', async (req) => {
      const registros = await repo.listar(req.limite);
      return { res: { registros }, log: `→ ${registros.length} registros` };
    }),
    obtener: manejar<{ id: number }, unknown>('Obtener', async (req) => {
      validarId(req.id);
      const r = await repo.obtener(req.id);
      if (!r) return { noEncontrado: `No existe el registro ${req.id}` };
      return { res: r, log: `id ${r.id}` };
    }),
    eliminar: manejar<{ id: number }, unknown>('Eliminar', async (req) => {
      validarId(req.id);
      const eliminado = await repo.eliminar(req.id);
      return { res: { eliminado }, log: `id ${req.id} → ${eliminado}` };
    }),
    limpiar: manejar<Record<string, never>, unknown>('Limpiar', async () => {
      const eliminados = await repo.limpiar();
      return { res: { eliminados }, log: `→ ${eliminados} eliminados` };
    }),
  };

  const server = new grpc.Server();
  server.addService(Servicio.service, handlers);

  const puertoReal = await new Promise<number>((resolver, rechazar) => {
    server.bindAsync(`${host}:${puerto}`, grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) rechazar(err);
      else resolver(p);
    });
  });
  return { server, puerto: puertoReal, pool };
}

// Arranca solo cuando se ejecuta como script principal
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.HIST_PORT ?? 50052);
  const { server, puerto: real, pool } = await iniciarServidorHistorial(puerto);
  console.log(`[historial] Escuchando en ${process.env.BIND_HOST ?? '127.0.0.1'}:${real}`);

  let cerrando = false;
  const cerrar = (senal: string): void => {
    if (cerrando) return;
    cerrando = true;
    console.log(`[historial] ${senal} recibido, cerrando...`);
    server.tryShutdown(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => cerrar('SIGINT'));
  process.on('SIGTERM', () => cerrar('SIGTERM'));
}
