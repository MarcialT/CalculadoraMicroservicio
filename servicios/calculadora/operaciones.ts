import type { Operacion } from '../../wrapper/index.js';

/** Error de una operación matemática inválida (división entre cero, raíz negativa, etc.). */
export class ErrorOperacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorOperacion';
  }
}

/** Valida que el operando sea un número finito. */
function validar(valor: unknown, nombre: string): asserts valor is number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ErrorOperacion(`El operando ${nombre} debe ser un número finito`);
  }
}

/** Verifica que el resultado sea finito (evita Infinity/NaN por desbordamiento). */
function verificarResultado(resultado: number): number {
  if (!Number.isFinite(resultado)) {
    throw new ErrorOperacion('El resultado no es un número finito (desbordamiento)');
  }
  return resultado;
}

export function sumar(a: number, b: number): number {
  validar(a, 'a');
  validar(b, 'b');
  return verificarResultado(a + b);
}

export function restar(a: number, b: number): number {
  validar(a, 'a');
  validar(b, 'b');
  return verificarResultado(a - b);
}

export function multiplicar(a: number, b: number): number {
  validar(a, 'a');
  validar(b, 'b');
  return verificarResultado(a * b);
}

export function dividir(a: number, b: number): number {
  validar(a, 'a');
  validar(b, 'b');
  if (b === 0) throw new ErrorOperacion('No se puede dividir entre cero');
  return verificarResultado(a / b);
}

export function potencia(a: number, b: number): number {
  validar(a, 'a');
  validar(b, 'b');
  // Base negativa con exponente fraccionario da NaN, que verificarResultado rechaza
  return verificarResultado(a ** b);
}

export function raizCuadrada(a: number): number {
  validar(a, 'a');
  if (a < 0) throw new ErrorOperacion('No se puede calcular la raíz cuadrada de un número negativo');
  return verificarResultado(Math.sqrt(a));
}

/** Tabla de operaciones por nombre (el mismo que usa el wrapper). */
export const OPERACIONES: Record<Operacion, (a: number, b: number) => number> = {
  sumar,
  restar,
  multiplicar,
  dividir,
  potencia,
  raizCuadrada: (a) => raizCuadrada(a),
};

/** Ejecuta una operación por nombre. `b` es obligatorio salvo en raizCuadrada. */
export function ejecutar(operacion: Operacion, a: number, b?: number): number {
  const funcion = OPERACIONES[operacion];
  if (!funcion) throw new ErrorOperacion(`Operación desconocida: ${String(operacion)}`);
  if (operacion !== 'raizCuadrada' && b === undefined) {
    throw new ErrorOperacion(`La operación ${operacion} requiere el operando b`);
  }
  return funcion(a, b as number);
}
