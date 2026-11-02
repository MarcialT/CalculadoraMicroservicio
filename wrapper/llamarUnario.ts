import * as grpc from '@grpc/grpc-js';
import { aCalculadoraError } from './errores.js';

/** Forma de un método unario de un cliente gRPC generado dinámicamente. */
export type MetodoGrpc<Req, Res> = (
  request: Req,
  opciones: grpc.CallOptions,
  callback: (err: grpc.ServiceError | null, respuesta?: Res) => void,
) => grpc.ClientUnaryCall;

/** Llama a un método unario con deadline y errores traducidos a CalculadoraError. */
export function llamarUnario<Req, Res>(
  cliente: grpc.Client,
  metodo: string,
  request: Req,
  deadlineMs: number,
): Promise<Res> {
  return new Promise((resolver, rechazar) => {
    const fn = (cliente as unknown as Record<string, MetodoGrpc<Req, Res>>)[metodo];
    fn.call(cliente, request, { deadline: Date.now() + deadlineMs }, (err, respuesta) => {
      if (err) rechazar(aCalculadoraError(err));
      else resolver(respuesta as Res);
    });
  });
}
