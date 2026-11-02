import 'dotenv/config';
import { CalculadoraClient, CalculadoraError, HistorialClient } from '../wrapper/index.js';
import { crearPool } from '../servicios/historial/repositorio.js';
import type { Resultado } from '../wrapper/index.js';

// Prueba de punta a punta contra los servicios REALES (deben estar corriendo: npm start).
const urlWeb = `http://localhost:${process.env.WEB_PORT ?? 3000}`;

const calculadora = new CalculadoraClient();
const historial = new HistorialClient();
const pool = crearPool();

/** Ids creados por esta prueba: son los únicos que se limpian al final. */
const idsCreados: number[] = [];
let fallos = 0;

function verificar(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(mensaje);
}

async function paso(nombre: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (err) {
    fallos++;
    console.log(`✘ ${nombre}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Espera que la promesa falle con un CalculadoraError del código indicado. */
async function esperarError(promesa: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await promesa;
  } catch (err) {
    verificar(err instanceof CalculadoraError, `se esperaba CalculadoraError y llegó ${String(err)}`);
    verificar(err.codigo === codigo, `se esperaba ${codigo} y llegó ${err.codigo}`);
    return;
  }
  throw new Error(`se esperaba ${codigo} pero la llamada tuvo éxito`);
}

function registrar(r: Resultado): Resultado {
  idsCreados.push(r.id);
  return r;
}

async function json(ruta: string, init?: RequestInit): Promise<{ estado: number; cuerpo: any }> {
  const resp = await fetch(`${urlWeb}${ruta}`, init);
  return { estado: resp.status, cuerpo: await resp.json() };
}

const sumaCreada: { r?: Resultado } = {};
const raizCreada: { r?: Resultado } = {};

try {
  await paso('Salud de la web', async () => {
    const { estado, cuerpo } = await json('/api/salud');
    verificar(estado === 200 && cuerpo.ok === true, `estado ${estado}`);
  });

  await paso('CalculadoraClient.sumar(2, 3) = 5 con id > 0', async () => {
    const r = registrar(await calculadora.sumar(2, 3));
    verificar(r.resultado === 5, `resultado ${r.resultado}`);
    verificar(r.id > 0, `id ${r.id}`);
    sumaCreada.r = r;
  });

  const casos: Array<[string, () => Promise<Resultado>, number]> = [
    ['sumar', () => calculadora.sumar(10, 5), 15],
    ['restar', () => calculadora.restar(10, 5), 5],
    ['multiplicar', () => calculadora.multiplicar(10, 5), 50],
    ['dividir', () => calculadora.dividir(10, 4), 2.5],
    ['potencia', () => calculadora.potencia(2, 10), 1024],
    ['raizCuadrada', () => calculadora.raizCuadrada(16), 4],
  ];
  for (const [nombre, llamar, esperado] of casos) {
    await paso(`Operación ${nombre} = ${esperado}`, async () => {
      const r = registrar(await llamar());
      verificar(r.resultado === esperado, `resultado ${r.resultado}`);
      verificar(r.id > 0, `id ${r.id}`);
      if (nombre === 'raizCuadrada') raizCreada.r = r;
    });
  }

  await paso('dividir entre 0 → INVALID_ARGUMENT', () => esperarError(calculadora.dividir(1, 0), 'INVALID_ARGUMENT'));
  await paso('raizCuadrada(-4) → INVALID_ARGUMENT', () => esperarError(calculadora.raizCuadrada(-4), 'INVALID_ARGUMENT'));

  await paso('HistorialClient.obtener(id) coincide con el resultado', async () => {
    const r = sumaCreada.r;
    verificar(r !== undefined, 'no hay suma previa');
    const reg = await historial.obtener(r.id);
    verificar(
      reg.id === r.id && reg.operacion === 'sumar' && reg.a === 2 && reg.b === 3 && reg.tieneB && reg.resultado === 5,
      `registro distinto: ${JSON.stringify(reg)}`,
    );
  });

  await paso('HistorialClient.listar contiene los ids creados', async () => {
    const ids = new Set((await historial.listar(500)).map((x) => x.id));
    const faltan = idsCreados.filter((id) => !ids.has(id));
    verificar(faltan.length === 0, `faltan ids: ${faltan.join(', ')}`);
  });

  await paso('Postgres: la fila existe y b es NULL en la raíz', async () => {
    const suma = sumaCreada.r;
    const raiz = raizCreada.r;
    verificar(suma !== undefined && raiz !== undefined, 'faltan resultados previos');
    const fs = await pool.query('SELECT operacion, a, b, resultado FROM operaciones WHERE id = $1', [suma.id]);
    verificar(fs.rowCount === 1, 'la fila de la suma no existe');
    verificar(fs.rows[0].operacion === 'sumar' && fs.rows[0].b === 3 && fs.rows[0].resultado === 5, 'datos de la suma incorrectos');
    const fr = await pool.query('SELECT operacion, b, resultado FROM operaciones WHERE id = $1', [raiz.id]);
    verificar(fr.rowCount === 1, 'la fila de la raíz no existe');
    verificar(fr.rows[0].b === null, `b debería ser NULL y es ${fr.rows[0].b}`);
  });

  await paso('POST /api/calcular por la web', async () => {
    const { estado, cuerpo } = await json('/api/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operacion: 'multiplicar', a: 6, b: 7 }),
    });
    verificar(estado === 200, `estado ${estado}`);
    verificar(cuerpo.resultado === 42 && cuerpo.id > 0, `cuerpo ${JSON.stringify(cuerpo)}`);
    idsCreados.push(cuerpo.id);
  });

  await paso('POST /api/calcular dividir entre 0 → 400', async () => {
    const { estado, cuerpo } = await json('/api/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operacion: 'dividir', a: 1, b: 0 }),
    });
    verificar(estado === 400 && cuerpo.codigo === 'INVALID_ARGUMENT', `estado ${estado} ${JSON.stringify(cuerpo)}`);
  });

  await paso('GET /api/historial contiene los ids creados', async () => {
    const { estado, cuerpo } = await json('/api/historial?limite=500');
    verificar(estado === 200 && Array.isArray(cuerpo), `estado ${estado}`);
    const ids = new Set((cuerpo as Array<{ id: number }>).map((x) => x.id));
    const faltan = idsCreados.filter((id) => !ids.has(id));
    verificar(faltan.length === 0, `faltan ids: ${faltan.join(', ')}`);
  });

  await paso('Eliminar un id → obtener da NOT_FOUND', async () => {
    const id = idsCreados[0]!;
    verificar(await historial.eliminar(id) === true, 'eliminar devolvió false');
    await esperarError(historial.obtener(id), 'NOT_FOUND');
  });
} finally {
  // Limpieza: solo los ids creados por esta prueba
  try {
    for (const id of idsCreados) await historial.eliminar(id);
    console.log(`Limpieza: ${idsCreados.length} registros de prueba eliminados`);
  } catch (err) {
    fallos++;
    console.log(`✘ Limpieza: ${err instanceof Error ? err.message : String(err)}`);
  }
  calculadora.cerrar();
  historial.cerrar();
  await pool.end();
}

console.log(fallos === 0 ? '\nE2E: todo correcto' : `\nE2E: ${fallos} paso(s) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
