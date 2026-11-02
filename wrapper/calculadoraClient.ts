import * as grpc from '@grpc/grpc-js';
import { cargarPaquete, obtenerServicio } from './cargarProto.js';
import { aCalculadoraError } from './errores.js';
import { llamarUnario } from './llamarUnario.js';
import type { Operacion, OpcionesCliente, Resultado } from './tipos.js';

/** Cliente del servicio Calculadora (gRPC). */
export class CalculadoraClient {
  private cliente: grpc.Client;
  private deadlineMs: number;

  constructor(opciones: OpcionesCliente = {}) {
    const host = opciones.host ?? process.env.CALC_HOST ?? 'localhost';
    const port = opciones.port ?? Number(process.env.CALC_PORT ?? 50051);
    this.deadlineMs = opciones.deadlineMs ?? 5000;
    const Servicio = obtenerServicio(cargarPaquete('calculadora.proto'), 'calculadora', 'Calculadora');
    this.cliente = new Servicio(`${host}:${port}`, grpc.credentials.createInsecure());
  }

  /** Llama a un método unario del cliente con deadline y errores traducidos. */
  private llamar<Req>(metodo: string, request: Req): Promise<Resultado> {
    return llamarUnario<Req, Resultado>(this.cliente, metodo, request, this.deadlineMs);
  }

  sumar(a: number, b: number): Promise<Resultado> {
    return this.llamar('sumar', { a, b });
  }

  restar(a: number, b: number): Promise<Resultado> {
    return this.llamar('restar', { a, b });
  }

  multiplicar(a: number, b: number): Promise<Resultado> {
    return this.llamar('multiplicar', { a, b });
  }

  dividir(a: number, b: number): Promise<Resultado> {
    return this.llamar('dividir', { a, b });
  }

  potencia(a: number, b: number): Promise<Resultado> {
    return this.llamar('potencia', { a, b });
  }

  raizCuadrada(a: number): Promise<Resultado> {
    return this.llamar('raizCuadrada', { a });
  }

  /** Despacha a la operación indicada. `b` es obligatorio salvo en raizCuadrada. */
  calcular(operacion: Operacion, a: number, b?: number): Promise<Resultado> {
    if (operacion === 'raizCuadrada') return this.raizCuadrada(a);
    if (b === undefined) {
      return Promise.reject(aCalculadoraError({
        code: grpc.status.INVALID_ARGUMENT,
        details: `La operación ${operacion} requiere el operando b`,
      } as grpc.ServiceError));
    }
    switch (operacion) {
      case 'sumar': return this.sumar(a, b);
      case 'restar': return this.restar(a, b);
      case 'multiplicar': return this.multiplicar(a, b);
      case 'dividir': return this.dividir(a, b);
      case 'potencia': return this.potencia(a, b);
      default:
        return Promise.reject(aCalculadoraError({
          code: grpc.status.INVALID_ARGUMENT,
          details: `Operación desconocida: ${String(operacion)}`,
        } as grpc.ServiceError));
    }
  }

  /** Cierra la conexión. */
  cerrar(): void {
    this.cliente.close();
  }
}
