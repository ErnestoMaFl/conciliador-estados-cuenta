// Interfaz: captura, conciliación, resultados y sincronización con el Gist.

import { leerMovimientos, movimientosAFilas } from './entrada.js';
import { conciliar, CONFIG_INICIAL } from './conciliacion.js';
import { cuadroTSV, cuadroHTML, resultadoCSV, describirPosible } from './salida.js';
import { csvAObjetos, objetosACsv } from './csv.js';
import { parsearFecha, fechaTexto, montoMoneda, parsearMonto, montoPlano } from './formato.js';
import {
  leerGist, escribirArchivos, crearGist, claveDePeriodo, archivoPeriodo,
  ARCHIVO_PERIODOS, ARCHIVO_CONFIG, COLUMNAS_PERIODOS, COLUMNAS_MOVIMIENTOS,
} from './gist.js';

const $ = (id) => document.getElementById(id);
const LADOS = ['A', 'B'];
const PLURAL = { cargo: 'Cargos', abono: 'Abonos' };

const estado = {
  datos: { A: null, B: null },
  resultado: null,
  gist: null,        // { token, id, url, archivos }
  periodos: [],      // filas de periodos.csv
};

// ---------- utilidades de interfaz ----------

function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  // Todo el texto entra como nodo de texto: nunca se interpreta como HTML.
  for (const h of hijos.flat()) if (h !== null && h !== undefined && h !== false) n.append(h);
  return n;
}

let temporizadorAviso;
function avisar(texto) {
  const a = $('aviso');
  a.textContent = texto;
  a.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => a.classList.remove('visible'), 2600);
}

function mensajeGist(texto, tipo = '') {
  const m = $('mensajeGist');
  m.textContent = texto;
  m.className = `mensaje ${tipo}`;
}

const nombres = () => ({
  A: $('nombreA').value.trim() || 'A',
  B: $('nombreB').value.trim() || 'B',
});

function almacen(tipo) {
  try { return tipo === 'local' ? localStorage : sessionStorage; } catch { return null; }
}
function leerGuardado(clave) {
  for (const t of ['session', 'local']) {
    try { const v = almacen(t)?.getItem(clave); if (v !== null && v !== undefined) return v; } catch { /* sin acceso */ }
  }
  return null;
}
function guardar(clave, valor, tipo = 'local') {
  try { almacen(tipo)?.setItem(clave, valor); } catch { /* modo privado: se ignora */ }
}
function borrar(clave) {
  for (const t of ['session', 'local']) try { almacen(t)?.removeItem(clave); } catch { /* idem */ }
}

async function conBoton(boton, tarea) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  try { return await tarea(); } finally { boton.disabled = false; boton.textContent = textoOriginal; }
}

// ---------- reglas de conciliación (RNF-08) ----------

function leerConfigUI() {
  const tol = parsearMonto($('tolerancia').value);
  const dias = $('maxDias').value.trim();
  return {
    cruce: $('cruce').value,
    toleranciaCentavos: tol.centavos ?? 0,
    maxDias: dias === '' ? null : Math.max(0, Math.trunc(Number(dias))),
  };
}

function aplicarConfigUI(cfg) {
  const c = { ...CONFIG_INICIAL, ...cfg };
  $('cruce').value = c.cruce;
  $('tolerancia').value = montoPlano(c.toleranciaCentavos);
  $('maxDias').value = c.maxDias ?? '';
}

function configACsv(cfg) {
  return objetosACsv([
    { clave: 'cruce', valor: cfg.cruce },
    { clave: 'tolerancia', valor: montoPlano(cfg.toleranciaCentavos) },
    { clave: 'max_dias', valor: cfg.maxDias ?? '' },
  ], ['clave', 'valor']);
}

function configDeCsv(texto) {
  const v = Object.fromEntries(csvAObjetos(texto).map((f) => [f.clave, f.valor]));
  const cfg = {};
  if (v.cruce === 'directo' || v.cruce === 'cruzado') cfg.cruce = v.cruce;
  if (v.tolerancia !== undefined) cfg.toleranciaCentavos = parsearMonto(v.tolerancia).centavos ?? 0;
  if (v.max_dias !== undefined) cfg.maxDias = v.max_dias === '' ? null : Number(v.max_dias);
  return cfg;
}

// ---------- captura (RF-01 a RF-04) ----------

function analizar(lado) {
  const r = leerMovimientos($(`texto${lado}`).value, lado);
  estado.datos[lado] = r;

  const resumen = $(`resumen${lado}`);
  resumen.replaceChildren();
  if (r.movimientos.length || r.errores.length) {
    const s = (n) => (n === 1 ? '' : 's');
    resumen.append(
      el('span', {}, el('strong', {}, String(r.resumen.total)), ` movimiento${s(r.resumen.total)}`),
      el('span', {}, `${r.resumen.numCargos} cargo${s(r.resumen.numCargos)}: `, el('strong', {}, montoMoneda(r.resumen.cargos))),
      el('span', {}, `${r.resumen.numAbonos} abono${s(r.resumen.numAbonos)}: `, el('strong', {}, montoMoneda(r.resumen.abonos))),
    );
  }

  const errores = $(`errores${lado}`);
  const visibles = r.errores.slice(0, 100);
  errores.replaceChildren(...visibles.map((e) => el('li', {}, `Fila ${e.fila}: ${e.mensaje}`)));
  if (r.errores.length > visibles.length) {
    errores.append(el('li', {}, `… y ${r.errores.length - visibles.length} filas más con error.`));
  }
  return r;
}

let temporizadorAnalisis;
function alCambiarTexto(lado) {
  clearTimeout(temporizadorAnalisis);
  temporizadorAnalisis = setTimeout(() => {
    analizar(lado);
    if (estado.resultado) ejecutarConciliacion();
  }, 250);
}

function movimientosATexto(filasCsv) {
  const limpio = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
  const lineas = filasCsv.map((f) => {
    const dia = parsearFecha(f.fecha);
    return [dia === null ? f.fecha : fechaTexto(dia), f.concepto, f.cargo, f.abono].map(limpio).join('\t');
  });
  return ['Fecha\tConcepto\tCargos\tAbonos', ...lineas].join('\n');
}

// ---------- conciliación y resultados (RF-05 a RF-15) ----------

function ejecutarConciliacion() {
  const A = analizar('A');
  const B = analizar('B');
  if (!A.movimientos.length && !B.movimientos.length) {
    avisar('No hay movimientos válidos que conciliar.');
    return;
  }
  estado.resultado = conciliar(A.movimientos, B.movimientos, leerConfigUI());
  pintarResultado();
}

async function copiarCuadro(movimientos, boton) {
  const texto = cuadroTSV(movimientos);
  const html = cuadroHTML(movimientos);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([texto], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(texto);
    }
  } catch {
    // Respaldo para navegadores sin permiso de portapapeles.
    const t = el('textarea', { style: 'position:fixed;opacity:0' }, texto);
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  boton.textContent = '✓ Copiado';
  boton.classList.add('copiado');
  setTimeout(() => { boton.textContent = 'Copiar'; boton.classList.remove('copiado'); }, 1800);
  avisar(`${movimientos.length} movimientos copiados. Pégalos en Excel o en un correo.`);
}

function tablaMovimientos(movimientos, posibles) {
  const conPosibles = movimientos.some((m) => posibles.has(m.id));
  const total = movimientos.reduce((s, m) => s + m.centavos, 0);
  return el('div', { class: 'tabla-desliza' }, el('table', { class: 'tabla' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Fecha'), el('th', {}, 'Concepto'), el('th', { class: 'num' }, 'Monto'),
      el('th', { class: 'fila' }, 'Fila'), conPosibles && el('th', {}, 'Posible coincidencia'))),
    el('tbody', {}, movimientos.map((m) => {
      const p = posibles.get(m.id);
      return el('tr', {},
        el('td', { class: 'fecha' }, fechaTexto(m.fecha)),
        el('td', {}, m.concepto),
        el('td', { class: 'num' }, montoMoneda(m.centavos)),
        el('td', { class: 'fila' }, String(m.fila)),
        conPosibles && el('td', { class: 'posible' }, p ? `⚠ ${describirPosible(p)}` : ''));
    })),
    el('tfoot', {}, el('tr', {},
      el('td', {}, 'Total'), el('td', {}), el('td', { class: 'num' }, montoMoneda(total)),
      el('td', {}), conPosibles && el('td', {}))),
  ));
}

function cuadroPendientes(titulo, movimientos, posibles) {
  const tarjeta = el('div', { class: 'tarjeta' });
  const botonCopiar = el('button', { type: 'button', class: 'secundario' }, 'Copiar');
  botonCopiar.addEventListener('click', () => copiarCuadro(movimientos, botonCopiar));
  tarjeta.append(el('div', { class: 'cabecera-cuadro' },
    el('div', {}, el('h3', {}, titulo),
      el('span', { class: 'total' }, `${movimientos.length} movimiento${movimientos.length === 1 ? '' : 's'}`)),
    movimientos.length ? botonCopiar : null));
  tarjeta.append(movimientos.length
    ? tablaMovimientos(movimientos, posibles)
    : el('p', { class: 'vacio' }, 'Nada pendiente. ✓'));
  return tarjeta;
}

function tablaConciliados(col, n) {
  const det = el('details', { class: 'tarjeta' },
    el('summary', {}, el('h2', {}, `Conciliados · ${PLURAL[col.tipoA]} de ${n.A} ↔ ${PLURAL[col.tipoB]} de ${n.B} (${col.conciliados.length})`)));
  if (!col.conciliados.length) {
    det.append(el('p', { class: 'vacio' }, 'Sin movimientos conciliados.'));
    return det;
  }
  det.append(el('div', { class: 'tabla-desliza' }, el('table', { class: 'tabla' },
    el('thead', {}, el('tr', {},
      el('th', { class: 'num' }, 'Monto'),
      el('th', {}, `Fecha ${n.A}`), el('th', {}, `Concepto ${n.A}`), el('th', { class: 'fila' }, 'Fila'),
      el('th', {}, `Fecha ${n.B}`), el('th', {}, `Concepto ${n.B}`), el('th', { class: 'fila' }, 'Fila'),
      el('th', { class: 'num' }, 'Días'))),
    el('tbody', {}, col.conciliados.map(({ a, b, dias }) => el('tr', {},
      el('td', { class: 'num' }, montoMoneda(a.centavos)),
      el('td', { class: 'fecha' }, fechaTexto(a.fecha)), el('td', {}, a.concepto), el('td', { class: 'fila' }, String(a.fila)),
      el('td', { class: 'fecha' }, fechaTexto(b.fecha)), el('td', {}, b.concepto), el('td', { class: 'fila' }, String(b.fila)),
      el('td', { class: 'num' }, String(dias))))),
  )));
  return det;
}

function pintarResultado() {
  const { columnas } = estado.resultado;
  const n = nombres();

  const pendientes = columnas.reduce((s, c) => s + c.pendientesA.length + c.pendientesB.length, 0);
  const cuadre = $('estadoCuadre');
  cuadre.className = `estado-cuadre ${pendientes ? 'pendiente' : 'ok'}`;
  cuadre.textContent = pendientes
    ? `${pendientes} movimiento${pendientes === 1 ? '' : 's'} sin pareja. Revisa los cuadros de abajo.`
    : '✓ Los dos estados de cuenta cuadran: todos los movimientos están conciliados.';

  const celdaMonto = (c) => el('td', { class: 'num' }, montoMoneda(c));
  $('tablaResumen').replaceChildren(
    el('thead', {}, el('tr', {},
      el('th', {}, 'Columna'), el('th', { class: 'num' }, `Total ${n.A}`), el('th', { class: 'num' }, `Total ${n.B}`),
      el('th', { class: 'num' }, 'Conciliado'), el('th', { class: 'num' }, `Pendiente ${n.A}`),
      el('th', { class: 'num' }, `Pendiente ${n.B}`), el('th', { class: 'num' }, `Diferencia (${n.A} − ${n.B})`))),
    el('tbody', {}, columnas.map((c) => el('tr', {},
      el('td', {}, `${PLURAL[c.tipoA]} ${n.A} ↔ ${PLURAL[c.tipoB]} ${n.B}`),
      celdaMonto(c.totales.a), celdaMonto(c.totales.b),
      el('td', { class: 'num' }, `${montoMoneda(c.totales.conciliado)} (${c.conciliados.length})`),
      el('td', { class: 'num' }, `${montoMoneda(c.totales.pendienteA)} (${c.pendientesA.length})`),
      el('td', { class: 'num' }, `${montoMoneda(c.totales.pendienteB)} (${c.pendientesB.length})`),
      celdaMonto(c.totales.a - c.totales.b)))),
  );

  $('cuadros').replaceChildren(...columnas.map((c) => {
    const cruzado = c.tipoA !== c.tipoB;
    return el('section', {},
      el('h2', { class: 'titulo-columna' }, cruzado
        ? `${PLURAL[c.tipoA]} de ${n.A} contra ${PLURAL[c.tipoB].toLowerCase()} de ${n.B}`
        : PLURAL[c.tipoA]),
      el('div', { class: 'rejilla-cuadros' },
        cuadroPendientes(`No está en ${n.B} · ${PLURAL[c.tipoA].toLowerCase()} de ${n.A}`, c.pendientesA, c.posiblesA),
        cuadroPendientes(`No está en ${n.A} · ${PLURAL[c.tipoB].toLowerCase()} de ${n.B}`, c.pendientesB, c.posiblesB)));
  }));

  $('conciliados').replaceChildren(...columnas.map((c) => tablaConciliados(c, n)));
  $('resultados').hidden = false;
}

function descargarCSV() {
  if (!estado.resultado) return;
  const contenido = '﻿' + resultadoCSV(estado.resultado, nombres());
  const sufijo = claveDePeriodo($('nombrePeriodo').value) || new Date().toISOString().slice(0, 10);
  const a = el('a', {
    href: URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' })),
    download: `conciliacion_${sufijo}.csv`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- base de datos en Gist ----------

function pintarEstadoGist() {
  const conectado = Boolean(estado.gist);
  const chip = $('chipGist');
  chip.textContent = conectado ? 'Gist conectado' : 'Sin base de datos';
  chip.classList.toggle('conectado', conectado);
  $('panelPeriodos').hidden = !conectado;
  const enlace = $('enlaceGist');
  enlace.hidden = !conectado;
  if (conectado) enlace.href = estado.gist.url;

  const lista = $('listaPeriodos');
  const seleccionado = lista.value;
  lista.replaceChildren(el('option', { value: '' }, estado.periodos.length ? '— Selecciona —' : '— Aún no hay periodos —'),
    ...[...estado.periodos]
      .sort((x, y) => String(y.actualizado).localeCompare(String(x.actualizado)))
      .map((p) => el('option', { value: p.periodo }, `${p.nombre || p.periodo} · ${p.pendientes_a || 0}/${p.pendientes_b || 0} pendientes`)));
  lista.value = estado.periodos.some((p) => p.periodo === seleccionado) ? seleccionado : '';
}

function guardarCredenciales(token, id) {
  borrar('conciliador.token');
  guardar('conciliador.token', token, $('recordarToken').checked ? 'local' : 'session');
  guardar('conciliador.recordar', $('recordarToken').checked ? '1' : '0');
  guardar('conciliador.gistId', id);
}

async function refrescarGist() {
  const { token, id } = estado.gist;
  const g = await leerGist(token, id);
  estado.gist = { token, ...g };
  estado.periodos = g.archivos[ARCHIVO_PERIODOS] ? csvAObjetos(g.archivos[ARCHIVO_PERIODOS]) : [];
  return g;
}

async function conectar() {
  const token = $('token').value.trim();
  const id = $('gistId').value.trim().replace(/^https?:\/\/gist\.github\.com\/[^/]+\//, '').replace(/[/#?].*$/, '');
  if (!token) return mensajeGist('Escribe el token de GitHub.', 'error');
  if (!id) return mensajeGist('Escribe el ID del Gist o usa “Crear Gist nuevo”.', 'error');

  mensajeGist('Conectando…');
  try {
    estado.gist = { token, id };
    const g = await refrescarGist();
    $('gistId').value = g.id;
    guardarCredenciales(token, g.id);
    if (g.archivos[ARCHIVO_CONFIG]) {
      aplicarConfigUI(configDeCsv(g.archivos[ARCHIVO_CONFIG]));
      guardar('conciliador.config', JSON.stringify(leerConfigUI()));
    }
    pintarEstadoGist();
    mensajeGist(`Conectado. ${estado.periodos.length} periodo(s) guardado(s).`, 'ok');
  } catch (e) {
    estado.gist = null;
    pintarEstadoGist();
    mensajeGist(e.message, 'error');
  }
}

async function nuevoGist() {
  const token = $('token').value.trim();
  if (!token) return mensajeGist('Escribe primero el token de GitHub.', 'error');
  mensajeGist('Creando Gist secreto…');
  try {
    const g = await crearGist(token, {
      [ARCHIVO_PERIODOS]: objetosACsv([], COLUMNAS_PERIODOS),
      [ARCHIVO_CONFIG]: configACsv(leerConfigUI()),
    });
    $('gistId').value = g.id;
    await conectar();
    mensajeGist(`Gist creado (${g.id}). Guarda este ID para usarlo en otros equipos.`, 'ok');
  } catch (e) {
    mensajeGist(e.message, 'error');
  }
}

function olvidar() {
  borrar('conciliador.token');
  $('token').value = '';
  estado.gist = null;
  estado.periodos = [];
  pintarEstadoGist();
  mensajeGist('Se borró el token de este navegador.');
}

async function guardarPeriodo() {
  const nombre = $('nombrePeriodo').value.trim();
  const clave = claveDePeriodo(nombre);
  if (!clave) return mensajeGist('Escribe un nombre para el periodo (ej. “Octubre 2026 Banorte”).', 'error');

  ejecutarConciliacion();
  const { A, B } = estado.datos;
  if (!A.movimientos.length && !B.movimientos.length) return mensajeGist('No hay movimientos que guardar.', 'error');

  const conError = A.errores.length + B.errores.length;
  if (conError && !confirm(`Hay ${conError} fila(s) con error que NO se guardarán. ¿Guardar de todos modos?`)) return;

  mensajeGist('Guardando…');
  try {
    await refrescarGist();
    const existente = estado.periodos.find((p) => p.periodo === clave);
    if (existente && $('listaPeriodos').value !== clave
      && !confirm(`Ya existe el periodo “${existente.nombre || clave}”. ¿Reemplazarlo?`)) {
      return mensajeGist('No se guardó.');
    }

    const n = nombres();
    const cols = estado.resultado.columnas;
    const fila = {
      periodo: clave,
      nombre,
      nombre_a: n.A,
      nombre_b: n.B,
      movimientos_a: A.movimientos.length,
      movimientos_b: B.movimientos.length,
      conciliados: cols.reduce((s, c) => s + c.conciliados.length, 0),
      pendientes_a: cols.reduce((s, c) => s + c.pendientesA.length, 0),
      pendientes_b: cols.reduce((s, c) => s + c.pendientesB.length, 0),
      actualizado: new Date().toISOString(),
    };
    const periodos = [...estado.periodos.filter((p) => p.periodo !== clave), fila];

    await escribirArchivos(estado.gist.token, estado.gist.id, {
      [archivoPeriodo(clave, 'A')]: objetosACsv(movimientosAFilas(A.movimientos), COLUMNAS_MOVIMIENTOS),
      [archivoPeriodo(clave, 'B')]: objetosACsv(movimientosAFilas(B.movimientos), COLUMNAS_MOVIMIENTOS),
      [archivoPeriodo(clave, 'resultado')]: resultadoCSV(estado.resultado, n),
      [ARCHIVO_PERIODOS]: objetosACsv(periodos, COLUMNAS_PERIODOS),
      [ARCHIVO_CONFIG]: configACsv(leerConfigUI()),
    });
    estado.periodos = periodos;
    pintarEstadoGist();
    $('listaPeriodos').value = clave;
    mensajeGist(`Periodo “${nombre}” guardado en el Gist.`, 'ok');
  } catch (e) {
    mensajeGist(e.message, 'error');
  }
}

async function abrirPeriodo() {
  const clave = $('listaPeriodos').value;
  if (!clave) return mensajeGist('Selecciona un periodo.', 'error');
  mensajeGist('Abriendo…');
  try {
    const g = await refrescarGist();
    pintarEstadoGist();
    const p = estado.periodos.find((x) => x.periodo === clave);
    const textoA = g.archivos[archivoPeriodo(clave, 'A')];
    const textoB = g.archivos[archivoPeriodo(clave, 'B')];
    if (!p || textoA === undefined || textoB === undefined) {
      return mensajeGist('Faltan archivos de este periodo en el Gist.', 'error');
    }
    $('listaPeriodos').value = clave;
    $('nombrePeriodo').value = p.nombre || clave;
    $('nombreA').value = p.nombre_a || 'A';
    $('nombreB').value = p.nombre_b || 'B';
    $('textoA').value = movimientosATexto(csvAObjetos(textoA));
    $('textoB').value = movimientosATexto(csvAObjetos(textoB));
    ejecutarConciliacion();
    mensajeGist(`Periodo “${p.nombre || clave}” abierto.`, 'ok');
  } catch (e) {
    mensajeGist(e.message, 'error');
  }
}

async function eliminarPeriodo() {
  const clave = $('listaPeriodos').value;
  if (!clave) return mensajeGist('Selecciona el periodo a eliminar.', 'error');
  const p = estado.periodos.find((x) => x.periodo === clave);
  if (!confirm(`¿Eliminar el periodo “${p?.nombre || clave}” del Gist? GitHub conserva el historial de revisiones del Gist.`)) return;
  mensajeGist('Eliminando…');
  try {
    const g = await refrescarGist();
    const periodos = estado.periodos.filter((x) => x.periodo !== clave);
    const cambios = { [ARCHIVO_PERIODOS]: objetosACsv(periodos, COLUMNAS_PERIODOS) };
    for (const parte of ['A', 'B', 'resultado']) {
      const archivo = archivoPeriodo(clave, parte);
      if (archivo in g.archivos) cambios[archivo] = null;
    }
    await escribirArchivos(estado.gist.token, estado.gist.id, cambios);
    estado.periodos = periodos;
    pintarEstadoGist();
    mensajeGist('Periodo eliminado.', 'ok');
  } catch (e) {
    mensajeGist(e.message, 'error');
  }
}

// ---------- datos de ejemplo ----------

const EJEMPLO_A = `Fecha\tConcepto\tCargos\tAbonos
01/10/2026\tPago X\t30.00\t
03/10/2026\tDepósito cliente Ruiz\t\t5,000.00
05/10/2026\tPago Y\t30.00\t
10/10/2026\tServicio de limpieza\t150.00\t
20/10/2026\tPago Z\t30.00\t
28/10/2026\tTransferencia nómina\t12,480.75\t`;

const EJEMPLO_B = `Fecha\tConcepto\tCargos\tAbonos
01/10/2026\tPago X\t30.00\t
03/10/2026\tDepósito cliente Ruiz\t\t5,000.00
06/10/2026\tPago Y\t30.00\t
12/10/2026\tIntereses ganados\t\t12.35
15/10/2026\tComisión bancaria\t150.40\t
28/10/2026\tTransferencia nómina\t12,480.75\t`;

// ---------- arranque ----------

function iniciar() {
  try {
    const cfg = JSON.parse(leerGuardado('conciliador.config') || 'null');
    if (cfg) aplicarConfigUI(cfg);
  } catch { /* configuración dañada: se usan los valores iniciales */ }
  for (const lado of LADOS) {
    const nombre = leerGuardado(`conciliador.nombre${lado}`);
    if (nombre) $(`nombre${lado}`).value = nombre;
  }

  for (const lado of LADOS) {
    $(`texto${lado}`).addEventListener('input', () => alCambiarTexto(lado));
    $(`nombre${lado}`).addEventListener('change', (e) => {
      guardar(`conciliador.nombre${lado}`, e.target.value);
      if (estado.resultado) pintarResultado();
    });
    $(`archivo${lado}`).addEventListener('change', async (e) => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      $(`texto${lado}`).value = await archivo.text();
      e.target.value = '';
      analizar(lado);
      if (estado.resultado) ejecutarConciliacion();
    });
  }
  document.querySelectorAll('[data-limpiar]').forEach((b) => b.addEventListener('click', () => {
    const lado = b.dataset.limpiar;
    $(`texto${lado}`).value = '';
    analizar(lado);
    if (estado.resultado) ejecutarConciliacion();
  }));

  for (const id of ['cruce', 'tolerancia', 'maxDias']) {
    $(id).addEventListener('change', () => {
      guardar('conciliador.config', JSON.stringify(leerConfigUI()));
      if (estado.resultado) ejecutarConciliacion();
    });
  }

  $('btnConciliar').addEventListener('click', () => {
    ejecutarConciliacion();
    if (estado.resultado) $('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btnEjemplo').addEventListener('click', () => {
    $('textoA').value = EJEMPLO_A;
    $('textoB').value = EJEMPLO_B;
    ejecutarConciliacion();
  });
  $('btnExportar').addEventListener('click', descargarCSV);

  $('btnConectar').addEventListener('click', (e) => conBoton(e.target, conectar));
  $('btnCrearGist').addEventListener('click', (e) => conBoton(e.target, nuevoGist));
  $('btnDesconectar').addEventListener('click', olvidar);
  $('btnGuardarPeriodo').addEventListener('click', (e) => conBoton(e.target, guardarPeriodo));
  $('btnCargarPeriodo').addEventListener('click', (e) => conBoton(e.target, abrirPeriodo));
  $('btnEliminarPeriodo').addEventListener('click', (e) => conBoton(e.target, eliminarPeriodo));
  $('listaPeriodos').addEventListener('change', (e) => {
    const p = estado.periodos.find((x) => x.periodo === e.target.value);
    if (p) $('nombrePeriodo').value = p.nombre || p.periodo;
  });

  const token = leerGuardado('conciliador.token');
  const gistId = leerGuardado('conciliador.gistId');
  $('recordarToken').checked = leerGuardado('conciliador.recordar') === '1';
  if (gistId) $('gistId').value = gistId;
  if (token) {
    $('token').value = token;
    if (gistId) conectar();
  } else {
    $('panelGist').open = true;
  }
}

iniciar();
