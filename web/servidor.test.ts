import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CalculadoraError } from '../wrapper/index.js';
import type { CalculadoraClient, HistorialClient, Registro, Resultado } from '../wrapper/index.js';
import { crearApp } from './servidor.js';

const fecha = '2026-01-01T00:00:00.000Z';
const resultadoBase: Resultado = { id: 1, operacion: 'dividir', a: 12, b: 4, tieneB: true, resultado: 3, fecha };
const registroBase: Registro = { ...resultadoBase };

// Clientes falsos: solo implementan los métodos que usa el servidor.
const calculadora = { calcular: vi.fn(), cerrar: vi.fn() };
const historial = { listar: vi.fn(), obtener: vi.fn(), eliminar: vi.fn(), limpiar: vi.fn(), cerrar: vi.fn() };

let servidor: Server;
let base: string;

beforeAll(async () => {
  const app = crearApp(calculadora as unknown as CalculadoraClient, historial as unknown as HistorialClient);
  servidor = app.listen(0);
  await new Promise<void>((r) => servidor.once('listening', () => r()));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => {
  servidor.close();
});

beforeEach(() => {
  vi.resetAllMocks();
});

function postCalcular(cuerpo: unknown) {
  return fetch(`${base}/api/calcular`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

describe('POST /api/calcular', () => {
  it('calcula correctamente', async () => {
    calculadora.calcular.mockResolvedValue(resultadoBase);
    const res = await postCalcular({ operacion: 'dividir', a: 12, b: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultadoBase);
    expect(calculadora.calcular).toHaveBeenCalledWith('dividir', 12, 4);
  });

  it('raizCuadrada no requiere b', async () => {
    calculadora.calcular.mockResolvedValue({ ...resultadoBase, operacion: 'raizCuadrada', tieneB: false });
    const res = await postCalcular({ operacion: 'raizCuadrada', a: 9 });
    expect(res.status).toBe(200);
    expect(calculadora.calcular).toHaveBeenCalledWith('raizCuadrada', 9);
  });

  it('rechaza una operación inválida con 400', async () => {
    const res = await postCalcular({ operacion: 'hackear', a: 1, b: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(calculadora.calcular).not.toHaveBeenCalled();
  });

  it('rechaza b faltante con 400', async () => {
    const res = await postCalcular({ operacion: 'sumar', a: 1 });
    expect(res.status).toBe(400);
    expect(calculadora.calcular).not.toHaveBeenCalled();
  });

  it('rechaza a no numérico con 400', async () => {
    const res = await postCalcular({ operacion: 'sumar', a: '1', b: 2 });
    expect(res.status).toBe(400);
  });

  it('mapea INVALID_ARGUMENT a 400', async () => {
    calculadora.calcular.mockRejectedValue(new CalculadoraError('No se puede dividir entre cero', 'INVALID_ARGUMENT', 3));
    const res = await postCalcular({ operacion: 'dividir', a: 1, b: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No se puede dividir entre cero', codigo: 'INVALID_ARGUMENT' });
  });

  it('mapea UNAVAILABLE a 503', async () => {
    calculadora.calcular.mockRejectedValue(new CalculadoraError('Servicio caído', 'UNAVAILABLE', 14));
    const res = await postCalcular({ operacion: 'sumar', a: 1, b: 2 });
    expect(res.status).toBe(503);
    expect((await res.json()).codigo).toBe('UNAVAILABLE');
  });

  it('un error desconocido da 500 sin exponer detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    calculadora.calcular.mockRejectedValue(new Error('boom'));
    const res = await postCalcular({ operacion: 'sumar', a: 1, b: 2 });
    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain('boom');
    expect(texto).not.toContain('stack');
  });
});

describe('historial', () => {
  it('GET /api/historial devuelve la lista y respeta limite', async () => {
    historial.listar.mockResolvedValue([registroBase]);
    const res = await fetch(`${base}/api/historial?limite=5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([registroBase]);
    expect(historial.listar).toHaveBeenCalledWith(5);
  });

  it('GET /api/historial/:id devuelve un registro', async () => {
    historial.obtener.mockResolvedValue(registroBase);
    const res = await fetch(`${base}/api/historial/1`);
    expect(await res.json()).toEqual(registroBase);
  });

  it('GET /api/historial/:id inexistente da 404', async () => {
    historial.obtener.mockRejectedValue(new CalculadoraError('No existe', 'NOT_FOUND', 5));
    const res = await fetch(`${base}/api/historial/99`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/historial/:id', async () => {
    historial.eliminar.mockResolvedValue(true);
    const res = await fetch(`${base}/api/historial/1`, { method: 'DELETE' });
    expect(await res.json()).toEqual({ eliminado: true });
  });

  it('DELETE /api/historial limpia todo', async () => {
    historial.limpiar.mockResolvedValue(7);
    const res = await fetch(`${base}/api/historial`, { method: 'DELETE' });
    expect(await res.json()).toEqual({ eliminados: 7 });
  });

  it('id inválido da 400', async () => {
    const res = await fetch(`${base}/api/historial/abc`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('id mayor que int32 da 400 sin llamar al historial', async () => {
    const del = await fetch(`${base}/api/historial/4294967297`, { method: 'DELETE' });
    expect(del.status).toBe(400);
    const get = await fetch(`${base}/api/historial/2147483648`);
    expect(get.status).toBe(400);
    expect(historial.eliminar).not.toHaveBeenCalled();
    expect(historial.obtener).not.toHaveBeenCalled();
  });

  it('el id máximo int32 sí se acepta', async () => {
    historial.eliminar.mockResolvedValue(false);
    const res = await fetch(`${base}/api/historial/2147483647`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(historial.eliminar).toHaveBeenCalledWith(2147483647);
  });

  it('id con formato no decimal da 400 sin llamar al historial', async () => {
    for (const id of ['1e3', '0x10', '%205', '%2B5', '1.0', '-1']) {
      const res = await fetch(`${base}/api/historial/${id}`);
      expect(res.status, id).toBe(400);
    }
    expect(historial.obtener).not.toHaveBeenCalled();
  });

  it('limite con formato no decimal da 400 sin llamar al historial', async () => {
    for (const limite of ['1e3', '0x10', '%205', '%2B5', '1.0', '']) {
      const res = await fetch(`${base}/api/historial?limite=${limite}`);
      expect(res.status, limite).toBe(400);
    }
    expect(historial.listar).not.toHaveBeenCalled();
  });

  it('limite mayor que int32 da 400', async () => {
    const res = await fetch(`${base}/api/historial?limite=2147483648`);
    expect(res.status).toBe(400);
    expect(historial.listar).not.toHaveBeenCalled();
  });
});

describe('otros', () => {
  it('GET /api/salud', async () => {
    const res = await fetch(`${base}/api/salud`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sirve el index.html', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html');
  });
});
