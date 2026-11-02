import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearPool, filaARegistro, RepositorioOperaciones } from './repositorio.js';
import { iniciarServidorHistorial } from './servidor.js';
import { HistorialClient } from '../../wrapper/historialClient.js';

const pool = crearPool();
const repo = new RepositorioOperaciones(pool);
const creados: number[] = []; // solo se eliminan los ids creados por este test

let bdDisponible = false;
try {
  await pool.query('SELECT 1 FROM operaciones LIMIT 1');
  bdDisponible = true;
} catch (e) {
  console.warn(`[test] PostgreSQL no disponible, se omiten las pruebas de BD: ${(e as Error).message}`);
}

afterAll(async () => {
  if (bdDisponible) {
    for (const id of creados) await repo.eliminar(id);
  }
  await pool.end();
});

describe('filaARegistro', () => {
  it('b NULL → b=0 y tieneB=false', () => {
    const r = filaARegistro({
      id: 1,
      operacion: 'raizCuadrada',
      a: 9,
      b: null,
      resultado: 3,
      creado_en: new Date('2026-01-01T00:00:00Z'),
    });
    expect(r).toEqual({
      id: 1,
      operacion: 'raizCuadrada',
      a: 9,
      b: 0,
      tieneB: false,
      resultado: 3,
      fecha: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe.skipIf(!bdDisponible)('RepositorioOperaciones (PostgreSQL real)', () => {
  it('guarda con b y lo recupera', async () => {
    const r = await repo.guardar({ operacion: 'sumar', a: 2, b: 3, tieneB: true, resultado: 5 });
    creados.push(r.id);
    expect(r).toMatchObject({ operacion: 'sumar', a: 2, b: 3, tieneB: true, resultado: 5 });
    expect(new Date(r.fecha).toISOString()).toBe(r.fecha);
    expect(await repo.obtener(r.id)).toEqual(r);
  });

  it('guarda b como NULL si tieneB es false', async () => {
    const r = await repo.guardar({ operacion: 'raizCuadrada', a: 16, b: 99, tieneB: false, resultado: 4 });
    creados.push(r.id);
    expect(r.tieneB).toBe(false);
    expect(r.b).toBe(0);
    const fila = await pool.query('SELECT b FROM operaciones WHERE id = $1', [r.id]);
    expect(fila.rows[0].b).toBeNull();
  });

  it('listar devuelve los más recientes primero y respeta el límite', async () => {
    const r1 = await repo.guardar({ operacion: 'restar', a: 5, b: 1, tieneB: true, resultado: 4 });
    const r2 = await repo.guardar({ operacion: 'multiplicar', a: 2, b: 4, tieneB: true, resultado: 8 });
    creados.push(r1.id, r2.id);
    // Con otros registros en la BD (o tests en paralelo) no hay que exigir que sean los dos primeros.
    const ids = (await repo.listar(500)).map((x) => x.id);
    expect(ids.indexOf(r2.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(r2.id)).toBeLessThan(ids.indexOf(r1.id));
    expect(await repo.listar(2)).toHaveLength(2);
    expect((await repo.listar(0)).length).toBeLessThanOrEqual(50);
    expect((await repo.listar(100000)).length).toBeLessThanOrEqual(500);
  });

  it('obtener inexistente devuelve null y eliminar devuelve booleano', async () => {
    expect(await repo.obtener(2147483647)).toBeNull();
    const r = await repo.guardar({ operacion: 'dividir', a: 8, b: 2, tieneB: true, resultado: 4 });
    expect(await repo.eliminar(r.id)).toBe(true);
    expect(await repo.eliminar(r.id)).toBe(false);
  });

  it('resiste inyección SQL en operacion (consultas parametrizadas)', async () => {
    const texto = "x'); DROP TABLE operaciones;--";
    const r = await repo.guardar({ operacion: texto, a: 1, b: 1, tieneB: true, resultado: 2 });
    creados.push(r.id);
    expect((await repo.obtener(r.id))?.operacion).toBe(texto);
  });
});

describe.skipIf(!bdDisponible)('Servidor gRPC del historial', () => {
  let cerrar: () => Promise<void>;
  let cliente: HistorialClient;

  beforeAll(async () => {
    const { server, puerto, pool: poolServidor } = await iniciarServidorHistorial(0);
    cliente = new HistorialClient({ host: 'localhost', port: puerto });
    cerrar = async () => {
      cliente.cerrar();
      await new Promise<void>((r) => server.tryShutdown(() => r()));
      await poolServidor.end();
    };
  });
  afterAll(async () => cerrar());

  it('guardar → obtener → listar → eliminar → obtener (NOT_FOUND)', async () => {
    const g = await cliente.guardar({ operacion: 'potencia', a: 2, b: 10, tieneB: true, resultado: 1024 });
    creados.push(g.id);
    expect(g.id).toBeGreaterThan(0);
    expect(await cliente.obtener(g.id)).toEqual(g);
    expect((await cliente.listar(5)).some((x) => x.id === g.id)).toBe(true);
    expect(await cliente.eliminar(g.id)).toBe(true);
    await expect(cliente.obtener(g.id)).rejects.toMatchObject({ codigo: 'NOT_FOUND' });
  });

  it('datos inválidos → INVALID_ARGUMENT', async () => {
    await expect(cliente.guardar({ operacion: '', a: 1, b: 1, tieneB: true, resultado: 2 })).rejects.toMatchObject({
      codigo: 'INVALID_ARGUMENT',
    });
    await expect(cliente.guardar({ operacion: 'sumar', a: NaN, b: 1, tieneB: true, resultado: 2 })).rejects.toMatchObject({
      codigo: 'INVALID_ARGUMENT',
    });
    await expect(cliente.obtener(0)).rejects.toMatchObject({ codigo: 'INVALID_ARGUMENT' });
    await expect(cliente.guardar({ operacion: 'inventada', a: 1, b: 1, tieneB: true, resultado: 2 })).rejects.toMatchObject({
      codigo: 'INVALID_ARGUMENT',
    });
  });
});
