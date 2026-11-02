/** Operaciones soportadas por la calculadora. */
export const OPERACIONES_VALIDAS = ['sumar', 'restar', 'multiplicar', 'dividir', 'potencia', 'raizCuadrada'] as const;
export type Operacion = (typeof OPERACIONES_VALIDAS)[number];

/** Mayor id/límite posible: los ids viajan como int32 y protobufjs trunca en silencio lo que lo excede. */
export const ID_MAXIMO = 2147483647;

/** Registro persistido en el historial. */
export interface Registro {
  id: number;
  operacion: string;
  a: number;
  b: number;
  tieneB: boolean;
  resultado: number;
  fecha: string; // ISO 8601
}

/** Resultado de una operación: es un registro ya guardado en el historial. */
export type Resultado = Registro;

/** Datos para crear un registro en el historial. */
export interface NuevoRegistro {
  operacion: string;
  a: number;
  b: number;
  tieneB: boolean;
  resultado: number;
}

/** Opciones de conexión de los clientes. */
export interface OpcionesCliente {
  host?: string;
  port?: number;
  deadlineMs?: number;
}
