import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { CalculadoraClient, CalculadoraError, HistorialClient, ID_MAXIMO, aCalculadoraError } from './index.js';
import { cargarPaquete, obtenerServicio } from './cargarProto.js';

function errorGrpc(code: number, details: string): grpc.ServiceError {
  return { code, details, message: `${code} ${details}`, metadata: new grpc.Metadata(), name: 'Error' };
}

function iniciarServidor(servidor: grpc.Server): Promise<number> {
  return new Promise((resolver, rechazar) => {
    servidor.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, puerto) => {
      if (err) rechazar(err);
      else resolver(puerto);
    });
  });
}

describe('aCalculadoraError', () => {
  it.each([
    [grpc.status.INVALID_ARGUMENT, 'INVALID_ARGUMENT'],
    [grpc.status.NOT_FOUND, 'NOT_FOUND'],
    [grpc.status.UNAVAILABLE, 'UNAVAILABLE'],
    [grpc.status.DEADLINE_EXCEEDED, 'DEADLINE_EXCEEDED'],
    [grpc.status.INTERNAL, 'INTERNAL'],
  ])('mapea el código %i a %s', (code, nombre) => {
    const e = aCalculadoraError(errorGrpc(code, 'detalle'));
    expect(e).toBeInstanceOf(CalculadoraError);
    expect(e.codigo).toBe(nombre);
    expect(e.codigoGrpc).toBe(code);
    expect(e.message).toBe('detalle');
  });

  it('usa UNKNOWN para códigos no reconocidos', () => {
    expect(aCalculadoraError(errorGrpc(999, 'x')).codigo).toBe('UNKNOWN');
  });
});

describe('CalculadoraClient (servidor falso)', () => {
  const servidor = new grpc.Server();
  let cliente: CalculadoraClient;

  beforeAll(async () => {
    const Servicio = obtenerServicio(cargarPaquete('calculadora.proto'), 'calculadora', 'Calculadora');
    servidor.addService(Servicio.service, {
      sumar: (llamada: grpc.ServerUnaryCall<{ a: number; b: number }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
        const { a, b } = llamada.request;
        cb(null, { id: 1, operacion: 'sumar', a, b, tieneB: true, resultado: a + b, fecha: new Date().toISOString() });
      },
      dividir: (llamada: grpc.ServerUnaryCall<{ a: number; b: number }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
        const { a, b } = llamada.request;
        if (b === 0) return cb(errorGrpc(grpc.status.INVALID_ARGUMENT, 'No se puede dividir entre cero'));
        cb(null, { id: 2, operacion: 'dividir', a, b, tieneB: true, resultado: a / b, fecha: new Date().toISOString() });
      },
    });
    const puerto = await iniciarServidor(servidor);
    cliente = new CalculadoraClient({ host: '127.0.0.1', port: puerto });
  });

  afterAll(() => {
    cliente.cerrar();
    servidor.forceShutdown();
  });

  it('sumar devuelve el resultado', async () => {
    const r = await cliente.sumar(2, 3);
    expect(r.resultado).toBe(5);
    expect(r.tieneB).toBe(true);
  });

  it('calcular despacha a la operación correcta', async () => {
    const r = await cliente.calcular('dividir', 10, 4);
    expect(r.resultado).toBe(2.5);
  });

  it('dividir entre cero llega como CalculadoraError INVALID_ARGUMENT', async () => {
    const error = await cliente.dividir(1, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculadoraError);
    expect((error as CalculadoraError).codigo).toBe('INVALID_ARGUMENT');
    expect((error as CalculadoraError).message).toContain('cero');
  });

  it('calcular sin b en una operación binaria falla', async () => {
    await expect(cliente.calcular('sumar', 1)).rejects.toMatchObject({ codigo: 'INVALID_ARGUMENT' });
  });
});

describe('HistorialClient (servidor falso)', () => {
  const servidor = new grpc.Server();
  let cliente: HistorialClient;
  const registro = { id: 1, operacion: 'sumar', a: 1, b: 2, tieneB: true, resultado: 3, fecha: new Date().toISOString() };

  beforeAll(async () => {
    const Servicio = obtenerServicio(cargarPaquete('historial.proto'), 'historial', 'Historial');
    servidor.addService(Servicio.service, {
      listar: (_l: unknown, cb: grpc.sendUnaryData<unknown>) => cb(null, { registros: [registro] }),
      obtener: (llamada: grpc.ServerUnaryCall<{ id: number }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
        if (llamada.request.id !== 1) return cb(errorGrpc(grpc.status.NOT_FOUND, 'Registro no encontrado'));
        cb(null, registro);
      },
    });
    const puerto = await iniciarServidor(servidor);
    cliente = new HistorialClient({ host: '127.0.0.1', port: puerto });
  });

  afterAll(() => {
    cliente.cerrar();
    servidor.forceShutdown();
  });

  it('listar devuelve un arreglo de registros', async () => {
    const lista = await cliente.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0].resultado).toBe(3);
  });

  it('obtener devuelve el registro existente', async () => {
    expect((await cliente.obtener(1)).id).toBe(1);
  });

  it('rechaza ids y límites fuera de 1..ID_MAXIMO sin enviar nada', async () => {
    for (const malo of [0, -1, 1.5, NaN, ID_MAXIMO + 1, 4294967297]) {
      await expect(cliente.obtener(malo)).rejects.toMatchObject({ codigo: 'INVALID_ARGUMENT' });
      await expect(cliente.eliminar(malo)).rejects.toMatchObject({ codigo: 'INVALID_ARGUMENT' });
      await expect(cliente.listar(malo)).rejects.toMatchObject({ codigo: 'INVALID_ARGUMENT' });
    }
    expect(await cliente.obtener(ID_MAXIMO).catch((e: CalculadoraError) => e.codigo)).toBe('NOT_FOUND');
  });

  it('obtener de un id inexistente llega como NOT_FOUND', async () => {
    const error = await cliente.obtener(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CalculadoraError);
    expect((error as CalculadoraError).codigo).toBe('NOT_FOUND');
  });
});
