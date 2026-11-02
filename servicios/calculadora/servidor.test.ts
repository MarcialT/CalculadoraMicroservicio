import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import {
  CalculadoraClient,
  CalculadoraError,
  HistorialClient,
  cargarPaquete,
  obtenerServicio,
  type NuevoRegistro,
} from '../../wrapper/index.js';
import { iniciarServidorCalculadora } from './servidor.js';

const FECHA = '2026-01-01T00:00:00.000Z';

let historialFalso: grpc.Server;
let guardados: NuevoRegistro[] = [];
let siguienteId = 1;
let clienteHistorial: HistorialClient;
let servidorCalc: grpc.Server;
let cliente: CalculadoraClient;
let clienteHistorialCaido: HistorialClient;
let servidorSinHistorial: grpc.Server;
let clienteSinHistorial: CalculadoraClient;

beforeAll(async () => {
  // Historial FALSO: guarda en memoria y devuelve id incremental y fecha fija
  const Historial = obtenerServicio(cargarPaquete('historial.proto'), 'historial', 'Historial');
  historialFalso = new grpc.Server();
  historialFalso.addService(Historial.service, {
    guardar: (llamada: grpc.ServerUnaryCall<NuevoRegistro, unknown>, callback: grpc.sendUnaryData<unknown>) => {
      guardados.push(llamada.request);
      callback(null, { ...llamada.request, id: siguienteId++, fecha: FECHA });
    },
  });
  const puertoFalso = await new Promise<number>((resolver, rechazar) => {
    historialFalso.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? rechazar(err) : resolver(p),
    );
  });

  clienteHistorial = new HistorialClient({ host: '127.0.0.1', port: puertoFalso });
  const calc = await iniciarServidorCalculadora(0, clienteHistorial);
  servidorCalc = calc.server;
  cliente = new CalculadoraClient({ host: '127.0.0.1', port: calc.puerto });

  // Segunda Calculadora apuntando a un Historial caído (puerto sin servidor)
  clienteHistorialCaido = new HistorialClient({ host: '127.0.0.1', port: 1, deadlineMs: 1500 });
  const calc2 = await iniciarServidorCalculadora(0, clienteHistorialCaido);
  servidorSinHistorial = calc2.server;
  clienteSinHistorial = new CalculadoraClient({ host: '127.0.0.1', port: calc2.puerto });
});

beforeEach(() => {
  guardados = [];
});

afterAll(() => {
  cliente.cerrar();
  clienteSinHistorial.cerrar();
  clienteHistorial.cerrar();
  clienteHistorialCaido.cerrar();
  servidorCalc.forceShutdown();
  servidorSinHistorial.forceShutdown();
  historialFalso.forceShutdown();
});

describe('servidor Calculadora', () => {
  it('sumar devuelve el resultado con el id y la fecha del historial', async () => {
    const r = await cliente.sumar(2, 3);
    expect(r.resultado).toBe(5);
    expect(r.operacion).toBe('sumar');
    expect(r.tieneB).toBe(true);
    expect(r.id).toBe(siguienteId - 1);
    expect(r.fecha).toBe(FECHA);
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ operacion: 'sumar', a: 2, b: 3, tieneB: true, resultado: 5 });
  });

  it('cada operación recibe un id nuevo', async () => {
    const r1 = await cliente.multiplicar(3, 4);
    const r2 = await cliente.potencia(2, 3);
    expect(r1.resultado).toBe(12);
    expect(r2.resultado).toBe(8);
    expect(r2.id).toBe(r1.id + 1);
  });

  it('dividir entre 0 da INVALID_ARGUMENT y no llama a guardar', async () => {
    const error = await cliente.dividir(1, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculadoraError);
    expect((error as CalculadoraError).codigo).toBe('INVALID_ARGUMENT');
    expect(guardados).toHaveLength(0);
  });

  it('raizCuadrada devuelve tieneB false', async () => {
    const r = await cliente.raizCuadrada(49);
    expect(r.resultado).toBe(7);
    expect(r.tieneB).toBe(false);
    expect(guardados[0].tieneB).toBe(false);
  });

  it('raíz de un negativo da INVALID_ARGUMENT', async () => {
    const error = await cliente.raizCuadrada(-1).catch((e: unknown) => e);
    expect((error as CalculadoraError).codigo).toBe('INVALID_ARGUMENT');
    expect(guardados).toHaveLength(0);
  });

  it('con el historial caído responde UNAVAILABLE', async () => {
    const error = await clienteSinHistorial.sumar(1, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculadoraError);
    expect((error as CalculadoraError).codigo).toBe('UNAVAILABLE');
    expect((error as CalculadoraError).message).toBe('El servicio de historial no está disponible');
  });

  it('un fallo interno del historial da INTERNAL sin filtrar detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Historial falso que falla con INTERNAL y un detalle que no debe llegar al cliente
    const Historial = obtenerServicio(cargarPaquete('historial.proto'), 'historial', 'Historial');
    const historialRoto = new grpc.Server();
    historialRoto.addService(Historial.service, {
      guardar: (_llamada: grpc.ServerUnaryCall<NuevoRegistro, unknown>, callback: grpc.sendUnaryData<unknown>) => {
        callback({ code: grpc.status.INTERNAL, details: 'detalle secreto' });
      },
    });
    const puertoRoto = await new Promise<number>((resolver, rechazar) => {
      historialRoto.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
        err ? rechazar(err) : resolver(p),
      );
    });
    const clienteRoto = new HistorialClient({ host: '127.0.0.1', port: puertoRoto });
    const calc = await iniciarServidorCalculadora(0, clienteRoto);
    const clienteCalc = new CalculadoraClient({ host: '127.0.0.1', port: calc.puerto });
    try {
      const error = await clienteCalc.sumar(1, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CalculadoraError);
      expect((error as CalculadoraError).codigo).toBe('INTERNAL');
      expect((error as CalculadoraError).message).toBe('Error interno del servicio de calculadora');
      expect((error as CalculadoraError).message).not.toContain('secreto');
    } finally {
      clienteCalc.cerrar();
      clienteRoto.cerrar();
      calc.server.forceShutdown();
      historialRoto.forceShutdown();
    }
  });
});
