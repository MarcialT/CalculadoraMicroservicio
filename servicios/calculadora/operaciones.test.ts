import { describe, expect, it } from 'vitest';
import {
  ErrorOperacion,
  dividir,
  ejecutar,
  multiplicar,
  potencia,
  raizCuadrada,
  restar,
  sumar,
} from './operaciones.js';

describe('operaciones', () => {
  it('opera con enteros', () => {
    expect(sumar(2, 3)).toBe(5);
    expect(restar(10, 4)).toBe(6);
    expect(multiplicar(6, 7)).toBe(42);
    expect(dividir(20, 4)).toBe(5);
    expect(potencia(2, 10)).toBe(1024);
    expect(raizCuadrada(81)).toBe(9);
  });

  it('opera con decimales', () => {
    expect(sumar(0.5, 0.25)).toBe(0.75);
    expect(multiplicar(1.5, 2)).toBe(3);
    expect(dividir(1, 4)).toBe(0.25);
    expect(raizCuadrada(2.25)).toBe(1.5);
  });

  it('opera con negativos', () => {
    expect(sumar(-2, -3)).toBe(-5);
    expect(restar(-2, 3)).toBe(-5);
    expect(multiplicar(-4, 2)).toBe(-8);
    expect(dividir(-9, 3)).toBe(-3);
    expect(potencia(-2, 3)).toBe(-8);
    expect(potencia(2, -1)).toBe(0.5);
  });

  it('rechaza dividir entre 0', () => {
    expect(() => dividir(5, 0)).toThrow(ErrorOperacion);
    expect(() => dividir(5, 0)).toThrow('No se puede dividir entre cero');
  });

  it('rechaza la raíz de un negativo', () => {
    expect(() => raizCuadrada(-4)).toThrow(ErrorOperacion);
  });

  it('rechaza resultados no finitos', () => {
    expect(() => potencia(10, 1000)).toThrow(ErrorOperacion);
    expect(() => multiplicar(Number.MAX_VALUE, 10)).toThrow(ErrorOperacion);
    expect(() => potencia(-8, 0.5)).toThrow(ErrorOperacion);
  });

  it('rechaza operandos no finitos', () => {
    expect(() => sumar(Infinity, 1)).toThrow(ErrorOperacion);
    expect(() => sumar(1, NaN)).toThrow(ErrorOperacion);
    expect(() => raizCuadrada(Infinity)).toThrow(ErrorOperacion);
  });

  it('ejecutar despacha por nombre', () => {
    expect(ejecutar('sumar', 1, 2)).toBe(3);
    expect(ejecutar('raizCuadrada', 16)).toBe(4);
    expect(() => ejecutar('sumar', 1)).toThrow(ErrorOperacion);
    expect(() => ejecutar('seno' as never, 1, 2)).toThrow(ErrorOperacion);
  });
});
