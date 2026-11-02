'use strict';

// Símbolos legibles para cada operación (nombre del servicio -> símbolo).
const SIMBOLOS = {
  sumar: '+',
  restar: '−',
  multiplicar: '×',
  dividir: '÷',
  potencia: '^',
  raizCuadrada: '√',
};

const entradaA = document.getElementById('entrada-a');
const entradaB = document.getElementById('entrada-b');
const campoB = document.getElementById('campo-b');
const botonesOp = Array.from(document.querySelectorAll('.op'));
const botonCalcular = document.getElementById('boton-calcular');
const formulario = document.getElementById('formulario');
const resultadoEl = document.getElementById('resultado');
const metaEl = document.getElementById('meta');
const avisoEl = document.getElementById('aviso');
const tabla = document.getElementById('tabla');
const cuerpoTabla = document.getElementById('cuerpo-tabla');
const vacioEl = document.getElementById('vacio');

let operacionActual = 'sumar';

/** Formatea un número para mostrarlo (sin ceros de más). */
function formatearNumero(n) {
  return Number.isFinite(n) ? String(Number(n.toPrecision(12))) : String(n);
}

/** Texto de la operación, p. ej. "12 ÷ 4" o "√9". */
function describirOperacion(operacion, a, b, tieneB) {
  const simbolo = SIMBOLOS[operacion] ?? operacion;
  if (operacion === 'raizCuadrada' || !tieneB) return `${simbolo}${formatearNumero(a)}`;
  return `${formatearNumero(a)} ${simbolo} ${formatearNumero(b)}`;
}

function fechaLocal(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? iso
    : fecha.toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' });
}

function mostrarError(mensaje) {
  avisoEl.textContent = mensaje;
  avisoEl.hidden = false;
}

function ocultarError() {
  avisoEl.hidden = true;
  avisoEl.textContent = '';
}

/** Llama a la API y lanza Error con el mensaje del servidor si falla. */
async function api(ruta, opciones) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, opciones);
  } catch {
    throw new Error('No se pudo contactar con el servidor web.');
  }
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  if (!respuesta.ok) {
    const base = datos?.error ?? `Error ${respuesta.status}`;
    throw new Error(respuesta.status === 503 ? `Servicio no disponible: ${base}` : base);
  }
  return datos;
}

function seleccionarOperacion(op) {
  operacionActual = op;
  for (const boton of botonesOp) {
    boton.setAttribute('aria-checked', String(boton.dataset.op === op));
  }
  const sinB = op === 'raizCuadrada';
  entradaB.disabled = sinB;
  campoB.classList.toggle('deshabilitado', sinB);
}

async function calcular() {
  ocultarError();
  const a = entradaA.value.trim() === '' ? NaN : Number(entradaA.value);
  const sinB = operacionActual === 'raizCuadrada';
  const b = entradaB.value.trim() === '' ? NaN : Number(entradaB.value);
  if (!Number.isFinite(a)) return mostrarError('Escribe un número válido en A.');
  if (!sinB && !Number.isFinite(b)) return mostrarError('Escribe un número válido en B.');

  const cuerpo = { operacion: operacionActual, a };
  if (!sinB) cuerpo.b = b;

  botonCalcular.disabled = true;
  try {
    const r = await api('/api/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    resultadoEl.textContent = `${describirOperacion(r.operacion, r.a, r.b, r.tieneB)} = ${formatearNumero(r.resultado)}`;
    metaEl.textContent = `Guardado en historial #${r.id} · ${fechaLocal(r.fecha)}`;
    await cargarHistorial();
  } catch (err) {
    mostrarError(err.message);
  } finally {
    botonCalcular.disabled = false;
  }
}

async function cargarHistorial() {
  try {
    const registros = await api('/api/historial?limite=50');
    pintarHistorial(registros);
  } catch (err) {
    mostrarError(`No se pudo cargar el historial. ${err.message}`);
  }
}

function pintarHistorial(registros) {
  cuerpoTabla.replaceChildren();
  const hayDatos = registros.length > 0;
  tabla.hidden = !hayDatos;
  vacioEl.hidden = hayDatos;

  for (const r of registros) {
    const fila = document.createElement('tr');
    const celdas = [
      ['num', `#${r.id}`],
      ['', describirOperacion(r.operacion, r.a, r.b, r.tieneB)],
      ['num', formatearNumero(r.resultado)],
      ['fecha', fechaLocal(r.fecha)],
    ];
    for (const [clase, texto] of celdas) {
      const td = document.createElement('td');
      if (clase) td.className = clase;
      td.textContent = texto;
      fila.appendChild(td);
    }
    const tdAccion = document.createElement('td');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'eliminar';
    boton.textContent = 'Eliminar';
    boton.setAttribute('aria-label', `Eliminar registro ${r.id}`);
    boton.addEventListener('click', () => eliminar(r.id));
    tdAccion.appendChild(boton);
    fila.appendChild(tdAccion);
    cuerpoTabla.appendChild(fila);
  }
}

async function eliminar(id) {
  ocultarError();
  try {
    await api(`/api/historial/${id}`, { method: 'DELETE' });
    await cargarHistorial();
  } catch (err) {
    mostrarError(err.message);
  }
}

async function limpiar() {
  if (!confirm('¿Seguro que quieres borrar todo el historial?')) return;
  ocultarError();
  try {
    await api('/api/historial', { method: 'DELETE' });
    await cargarHistorial();
  } catch (err) {
    mostrarError(err.message);
  }
}

for (const boton of botonesOp) {
  boton.addEventListener('click', () => seleccionarOperacion(boton.dataset.op));
}
// Enter dentro de los inputs envía el formulario y calcula.
formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  calcular();
});
document.getElementById('boton-actualizar').addEventListener('click', () => {
  ocultarError();
  cargarHistorial();
});
document.getElementById('boton-limpiar').addEventListener('click', limpiar);

seleccionarOperacion('sumar');
cargarHistorial();
