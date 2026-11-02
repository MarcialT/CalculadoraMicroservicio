import * as grpc from '@grpc/grpc-js';
import { cargarPaquete, obtenerServicio } from './cargarProto.js';
import { aCalculadoraError } from './errores.js';
import { llamarUnario } from './llamarUnario.js';
import { ID_MAXIMO } from './tipos.js';
import type { NuevoRegistro, OpcionesCliente, Registro } from './tipos.js';

/** Rechaza antes de enviar si el valor no es un entero entre 1 y ID_MAXIMO (int32 en el proto). */
function validarRango(valor: number, nombre: string): void {
  if (!Number.isInteger(valor) || valor < 1 || valor > ID_MAXIMO) {
    throw aCalculadoraError({
      code: grpc.status.INVALID_ARGUMENT,
      details: `${nombre} debe ser un entero entre 1 y ${ID_MAXIMO}`,
    } as grpc.ServiceError);
  }
}

/** Cliente del servicio Historial (gRPC). */
export class HistorialClient {
  private cliente: grpc.Client;
  private deadlineMs: number;

  constructor(opciones: OpcionesCliente = {}) {
    const host = opciones.host ?? process.env.HIST_HOST ?? 'localhost';
    const port = opciones.port ?? Number(process.env.HIST_PORT ?? 50052);
    this.deadlineMs = opciones.deadlineMs ?? 5000;
    const Servicio = obtenerServicio(cargarPaquete('historial.proto'), 'historial', 'Historial');
    this.cliente = new Servicio(`${host}:${port}`, grpc.credentials.createInsecure());
  }

  /** Llama a un método unario del cliente con deadline y errores traducidos. */
  private llamar<Req, Res>(metodo: string, request: Req): Promise<Res> {
    return llamarUnario<Req, Res>(this.cliente, metodo, request, this.deadlineMs);
  }

  guardar(nuevo: NuevoRegistro): Promise<Registro> {
    return this.llamar<NuevoRegistro, Registro>('guardar', nuevo);
  }

  async listar(limite = 50): Promise<Registro[]> {
    validarRango(limite, 'El límite');
    const r = await this.llamar<{ limite: number }, { registros: Registro[] }>('listar', { limite });
    return r.registros;
  }

  async obtener(id: number): Promise<Registro> {
    validarRango(id, 'El id');
    return this.llamar<{ id: number }, Registro>('obtener', { id });
  }

  async eliminar(id: number): Promise<boolean> {
    validarRango(id, 'El id');
    const r = await this.llamar<{ id: number }, { eliminado: boolean }>('eliminar', { id });
    return r.eliminado;
  }

  async limpiar(): Promise<number> {
    const r = await this.llamar<Record<string, never>, { eliminados: number }>('limpiar', {});
    return r.eliminados;
  }

  /** Cierra la conexión. */
  cerrar(): void {
    this.cliente.close();
  }
}
