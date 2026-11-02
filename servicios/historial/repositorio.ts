import pg from 'pg';
import type { NuevoRegistro, Registro } from '../../wrapper/tipos.js';

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 500;

/** Fila tal como la devuelve PostgreSQL en la tabla operaciones. */
interface FilaOperacion {
  id: number;
  operacion: string;
  a: number;
  b: number | null;
  resultado: number;
  creado_en: Date;
}

/** Arma el pool de conexiones desde las variables DB_* de process.env. */
export function crearPool(): pg.Pool {
  return new pg.Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5434),
    user: process.env.DB_USER ?? 'calculadora',
    password: process.env.DB_PASSWORD ?? 'calculadora',
    database: process.env.DB_NAME ?? 'calculadora',
  });
}

/** Convierte una fila de la BD en un Registro (b NULL → b=0, tieneB=false). */
export function filaARegistro(fila: FilaOperacion): Registro {
  return {
    id: fila.id,
    operacion: fila.operacion,
    a: fila.a,
    b: fila.b ?? 0,
    tieneB: fila.b !== null,
    resultado: fila.resultado,
    fecha: fila.creado_en.toISOString(),
  };
}

/** Acceso a la tabla operaciones (siempre con consultas parametrizadas). */
export class RepositorioOperaciones {
  constructor(private readonly pool: pg.Pool) {}

  async guardar(nuevo: NuevoRegistro): Promise<Registro> {
    const b = nuevo.tieneB ? nuevo.b : null;
    const r = await this.pool.query<FilaOperacion>(
      'INSERT INTO operaciones (operacion, a, b, resultado) VALUES ($1, $2, $3, $4) RETURNING *',
      [nuevo.operacion, nuevo.a, b, nuevo.resultado],
    );
    return filaARegistro(r.rows[0]!);
  }

  async listar(limite: number): Promise<Registro[]> {
    const usar = limite > 0 ? Math.min(Math.floor(limite), LIMITE_MAXIMO) : LIMITE_POR_DEFECTO;
    const r = await this.pool.query<FilaOperacion>(
      'SELECT * FROM operaciones ORDER BY id DESC LIMIT $1',
      [usar],
    );
    return r.rows.map(filaARegistro);
  }

  async obtener(id: number): Promise<Registro | null> {
    const r = await this.pool.query<FilaOperacion>('SELECT * FROM operaciones WHERE id = $1', [id]);
    return r.rows[0] ? filaARegistro(r.rows[0]) : null;
  }

  async eliminar(id: number): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM operaciones WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async limpiar(): Promise<number> {
    const r = await this.pool.query('DELETE FROM operaciones');
    return r.rowCount ?? 0;
  }
}
