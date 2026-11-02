import * as grpc from '@grpc/grpc-js';

/** Error legible que expone el wrapper en lugar del error crudo de gRPC. */
export class CalculadoraError extends Error {
  codigo: string;
  codigoGrpc: number;

  constructor(mensaje: string, codigo: string, codigoGrpc: number) {
    super(mensaje);
    this.name = 'CalculadoraError';
    this.codigo = codigo;
    this.codigoGrpc = codigoGrpc;
  }
}

const nombresEstado: Record<number, string> = {
  [grpc.status.CANCELLED]: 'CANCELLED',
  [grpc.status.UNKNOWN]: 'UNKNOWN',
  [grpc.status.INVALID_ARGUMENT]: 'INVALID_ARGUMENT',
  [grpc.status.DEADLINE_EXCEEDED]: 'DEADLINE_EXCEEDED',
  [grpc.status.NOT_FOUND]: 'NOT_FOUND',
  [grpc.status.ALREADY_EXISTS]: 'ALREADY_EXISTS',
  [grpc.status.PERMISSION_DENIED]: 'PERMISSION_DENIED',
  [grpc.status.RESOURCE_EXHAUSTED]: 'RESOURCE_EXHAUSTED',
  [grpc.status.FAILED_PRECONDITION]: 'FAILED_PRECONDITION',
  [grpc.status.ABORTED]: 'ABORTED',
  [grpc.status.OUT_OF_RANGE]: 'OUT_OF_RANGE',
  [grpc.status.UNIMPLEMENTED]: 'UNIMPLEMENTED',
  [grpc.status.INTERNAL]: 'INTERNAL',
  [grpc.status.UNAVAILABLE]: 'UNAVAILABLE',
  [grpc.status.DATA_LOSS]: 'DATA_LOSS',
  [grpc.status.UNAUTHENTICATED]: 'UNAUTHENTICATED',
};

/** Convierte un error de gRPC en un CalculadoraError. */
export function aCalculadoraError(err: grpc.ServiceError): CalculadoraError {
  const codigoGrpc = typeof err.code === 'number' ? err.code : grpc.status.UNKNOWN;
  const codigo = nombresEstado[codigoGrpc] ?? 'UNKNOWN';
  let mensaje = err.details || err.message || 'Error desconocido';
  // Un fallo de conexión crudo de gRPC no es legible para el usuario final.
  if (codigoGrpc === grpc.status.UNAVAILABLE && mensaje.startsWith('No connection established')) {
    mensaje = 'No se pudo conectar con el servicio';
  }
  return new CalculadoraError(mensaje, codigo, codigoGrpc);
}
