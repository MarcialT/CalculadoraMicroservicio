import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import {
  CalculadoraError,
  HistorialClient,
  OPERACIONES_VALIDAS,
  cargarPaquete,
  obtenerServicio,
  type Operacion,
  type Resultado,
} from '../../wrapper/index.js';
import { ErrorOperacion, ejecutar } from './operaciones.js';

/** Nombre legible de cada operación para los logs (Sumar, Restar...). */
const nombreLog = (operacion: Operacion): string => operacion[0].toUpperCase() + operacion.slice(1);

/** Mensaje cuando el servicio Historial no responde. */
const MENSAJE_HISTORIAL_CAIDO = 'El servicio de historial no está disponible';

/** Request entrante: `b` solo existe en operaciones binarias. */
type Peticion = { a: number; b?: number };

/**
 * Crea el handler gRPC de una operación. Flujo de ida y vuelta:
 *   1. Calcula el resultado con operaciones.ts (lógica pura).
 *   2. Llama al servicio Historial a través del wrapper (HistorialClient.guardar).
 *   3. Responde con el Resultado que incluye el id y la fecha asignados por Historial.
 * Si Historial no responde, NO se devuelve el resultado: nada se responde sin persistir.
 */
function crearHandler(
  operacion: Operacion,
  historial: HistorialClient,
): grpc.handleUnaryCall<Peticion, Resultado> {
  const unaria = operacion === 'raizCuadrada';
  return async (llamada, callback) => {
    const a = llamada.request.a;
    const b = unaria ? 0 : (llamada.request.b ?? 0);
    const texto = unaria ? `${a}` : `${a}, ${b}`;
    try {
      // 1. Cálculo
      const resultado = ejecutar(operacion, a, unaria ? undefined : b);
      // 2. Persistencia en Historial (vía wrapper)
      const registro = await historial.guardar({ operacion, a, b, tieneB: !unaria, resultado });
      console.log(`[calculadora] ${nombreLog(operacion)}(${texto}) = ${resultado} → historial id ${registro.id}`);
      // 3. Respuesta con el id y la fecha de Historial
      callback(null, {
        id: registro.id,
        operacion,
        a,
        b,
        tieneB: !unaria,
        resultado,
        fecha: registro.fecha,
      });
    } catch (err) {
      if (err instanceof ErrorOperacion) {
        console.log(`[calculadora] ${nombreLog(operacion)}(${texto}) rechazada: ${err.message}`);
        callback({ code: grpc.status.INVALID_ARGUMENT, details: err.message });
      } else if (
        err instanceof CalculadoraError &&
        (err.codigo === 'UNAVAILABLE' || err.codigo === 'DEADLINE_EXCEEDED')
      ) {
        console.error(`[calculadora] ${nombreLog(operacion)}(${texto}): historial no disponible (${err.codigo})`);
        callback({ code: grpc.status.UNAVAILABLE, details: MENSAJE_HISTORIAL_CAIDO });
      } else {
        console.error(`[calculadora] ${nombreLog(operacion)}(${texto}) falló:`, err);
        callback({ code: grpc.status.INTERNAL, details: 'Error interno del servicio de calculadora' });
      }
    }
  };
}

/** Levanta el servidor Calculadora. Con puerto 0 el sistema elige uno libre. */
export async function iniciarServidorCalculadora(
  puerto: number,
  historial: HistorialClient = new HistorialClient(),
  host: string = process.env.BIND_HOST ?? '127.0.0.1',
): Promise<{ server: grpc.Server; puerto: number }> {
  const Servicio = obtenerServicio(cargarPaquete('calculadora.proto'), 'calculadora', 'Calculadora');
  const server = new grpc.Server();
  const handlers: grpc.UntypedServiceImplementation = {};
  for (const op of OPERACIONES_VALIDAS) handlers[op] = crearHandler(op, historial);
  server.addService(Servicio.service, handlers);

  const puertoReal = await new Promise<number>((resolver, rechazar) => {
    server.bindAsync(`${host}:${puerto}`, grpc.ServerCredentials.createInsecure(), (err, p) => {
      if (err) rechazar(err);
      else resolver(p);
    });
  });
  return { server, puerto: puertoReal };
}

// Solo arranca cuando se ejecuta como script principal
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.CALC_PORT ?? 50051);
  const historial = new HistorialClient();
  const { server, puerto: puertoReal } = await iniciarServidorCalculadora(puerto, historial);
  console.log(`[calculadora] escuchando en ${process.env.BIND_HOST ?? '127.0.0.1'}:${puertoReal}`);

  // Cierre ordenado (una segunda señal no repite el cierre)
  let cerrando = false;
  const cerrar = (): void => {
    if (cerrando) return;
    cerrando = true;
    console.log('[calculadora] cerrando...');
    historial.cerrar();
    server.tryShutdown(() => process.exit(0));
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}
