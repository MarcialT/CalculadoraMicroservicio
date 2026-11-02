import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Carpeta proto/ en la raíz del proyecto (wrapper/ está un nivel abajo)
const carpetaProto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'proto');

/** Constructor de un cliente gRPC generado dinámicamente. */
export type ConstructorServicio = grpc.ServiceClientConstructor;

/** Carga un archivo .proto de la carpeta proto/ (p. ej. 'calculadora.proto'). */
export function cargarPaquete(nombreArchivo: string): grpc.GrpcObject {
  const definicion = protoLoader.loadSync(path.join(carpetaProto, nombreArchivo), {
    keepCase: false, // tiene_b llega como tieneB
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(definicion);
}

/** Obtiene el constructor de un servicio: obtenerServicio(paquete, 'calculadora', 'Calculadora'). */
export function obtenerServicio(
  paquete: grpc.GrpcObject,
  nombrePaquete: string,
  nombreServicio: string,
): ConstructorServicio {
  const ns = paquete[nombrePaquete] as grpc.GrpcObject | undefined;
  const servicio = ns?.[nombreServicio];
  if (typeof servicio !== 'function') {
    throw new Error(`Servicio ${nombrePaquete}.${nombreServicio} no encontrado en el proto`);
  }
  return servicio as ConstructorServicio;
}
