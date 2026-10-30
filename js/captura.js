// Tabla editable tipo hoja de cálculo para capturar movimientos (RF-01).
// Se puede escribir celda por celda o pegar un bloque copiado de Excel en cualquier celda.
// Solo se dibujan las filas visibles (desplazamiento virtual) para que miles de
// movimientos no vuelvan lenta la página (RNF-04).

import { textoAFilas } from './entrada.js';
import { parsearFecha, fechaTexto, parsearMonto, montoEditable } from './formato.js';

const COLUMNAS = [
  { titulo: 'Fecha', clase: 'c-fecha', placeholder: 'dd/mm/aaaa', inputmode: 'numeric' },
  { titulo: 'Concepto', clase: 'c-concepto', placeholder: '' },
  { titulo: 'Cargo', clase: 'c-monto', placeholder: '0.00', inputmode: 'decimal' },
  { titulo: 'Abono', clase: 'c-monto', placeholder: '0.00', inputmode: 'decimal' },
];
const TOTAL_COLUMNAS = COLUMNAS.length + 2;
const MARGEN_FILAS = 20;   // filas extra dibujadas arriba y abajo de lo visible
const ALTO_INICIAL = 32;   // se reemplaza por la altura medida de una fila real

const vacia = () => ['', '', '', ''];
const esVacia = (f) => f.every((c) => c.trim() === '');

/** Da formato uniforme a una celda válida; si no es válida la deja como está. */
export function normalizarCelda(columna, valor) {
  const v = String(valor ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  if (columna === 0) {
    const dia = parsearFecha(v);
    return dia === null ? v : fechaTexto(dia);
  }
  if (columna >= 2) {
    const m = parsearMonto(v);
    return m.centavos ? montoEditable(m.centavos) : v;
  }
  return v.replace(/\s+/g, ' ');
}

function espaciador() {
  const tr = document.createElement('tr');
  tr.className = 'espaciador';
  tr.setAttribute('aria-hidden', 'true');
  const td = document.createElement('td');
  td.colSpan = TOTAL_COLUMNAS;
  tr.append(td);
  return tr;
}

export class TablaCaptura {
  /**
   * @param {HTMLElement} contenedor  Elemento con scroll vertical que aloja la tabla.
   * @param {{ etiqueta: string, alCambiar: () => void }} opciones
   */
  constructor(contenedor, { etiqueta, alCambiar }) {
    this.contenedor = contenedor;
    this.etiqueta = etiqueta;
    this.alCambiar = alCambiar;
    this.filas = [vacia()];
    this.errores = new Map();   // índice de fila (base 0) → mensaje
    this.alto = ALTO_INICIAL;
    this.ventana = { inicio: 0, fin: 0 };

    this.tabla = document.createElement('table');
    this.tabla.className = 'captura-tabla';
    const thead = this.tabla.createTHead().insertRow();
    for (const t of ['#', ...COLUMNAS.map((c) => c.titulo), '']) {
      const th = document.createElement('th');
      th.textContent = t;
      thead.append(th);
    }
    this.cuerpo = this.tabla.createTBody();
    this.arriba = espaciador();
    this.abajo = espaciador();
    this.cuerpo.append(this.arriba, this.abajo);
    contenedor.replaceChildren(this.tabla);

    this.cuerpo.addEventListener('input', (e) => this.alEscribir(e));
    this.cuerpo.addEventListener('keydown', (e) => this.alTeclear(e));
    this.cuerpo.addEventListener('paste', (e) => this.alPegar(e));
    this.cuerpo.addEventListener('focusout', (e) => this.alSalir(e));
    this.cuerpo.addEventListener('click', (e) => {
      const boton = e.target.closest('button[data-eliminar]');
      if (boton) this.eliminarFila(Number(boton.closest('tr').dataset.r));
    });
    let pendiente = false;
    contenedor.addEventListener('scroll', () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => { pendiente = false; this.pintar(); });
    });
    this.pintar(true);
  }

  /** Filas capturadas, sin las filas vacías del final. */
  obtenerFilas() {
    const filas = this.filas.map((f) => [...f]);
    while (filas.length && esVacia(filas[filas.length - 1])) filas.pop();
    return filas;
  }

  ponerFilas(filas) {
    this.filas = filas.map((f) => [0, 1, 2, 3].map((i) => normalizarCelda(i, f[i])));
    this.errores.clear();
    this.asegurarFilaFinal();
    this.contenedor.scrollTop = 0;
    this.pintar(true);
    this.alCambiar();
  }

  get vacia() {
    return this.filas.every(esVacia);
  }

  asegurarFilaFinal() {
    if (!this.filas.length || !esVacia(this.filas[this.filas.length - 1])) this.filas.push(vacia());
  }

  crearRenglon(r) {
    const tr = document.createElement('tr');
    tr.dataset.r = r;
    const num = document.createElement('td');
    num.className = 'c-num';
    num.textContent = String(r + 1);
    tr.append(num);
    COLUMNAS.forEach((col, c) => {
      const td = document.createElement('td');
      td.className = col.clase;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = this.filas[r][c];
      input.dataset.c = c;
      input.placeholder = col.placeholder;
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (col.inputmode) input.inputMode = col.inputmode;
      input.setAttribute('aria-label', `${this.etiqueta}, fila ${r + 1}, ${col.titulo}`);
      td.append(input);
      tr.append(td);
    });
    const tdBorrar = document.createElement('td');
    tdBorrar.className = 'c-borrar';
    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.dataset.eliminar = '';
    borrar.textContent = '×';
    borrar.title = 'Eliminar fila';
    borrar.setAttribute('aria-label', `Eliminar fila ${r + 1}`);
    tdBorrar.append(borrar);
    tr.append(tdBorrar);
    if (this.errores.has(r)) {
      tr.classList.add('con-error');
      tr.title = this.errores.get(r);
    }
    return tr;
  }

  /** Dibuja solo las filas que caen en la parte visible (más un margen). */
  pintar(forzar = false) {
    const visibles = Math.ceil((this.contenedor.clientHeight || 420) / this.alto);
    const primera = Math.floor(this.contenedor.scrollTop / this.alto);
    const inicio = Math.max(0, primera - MARGEN_FILAS);
    const fin = Math.min(this.filas.length, primera + visibles + MARGEN_FILAS);
    if (!forzar && inicio === this.ventana.inicio && fin === this.ventana.fin) return;

    // Si la celda con el foco sigue dentro de la ventana, se le regresa el foco al redibujar.
    const activo = this.cuerpo.contains(document.activeElement) ? document.activeElement : null;
    const foco = activo?.dataset.c !== undefined
      ? { r: Number(activo.closest('tr').dataset.r), c: Number(activo.dataset.c),
        desde: activo.selectionStart, hasta: activo.selectionEnd }
      : null;
    if (foco && (foco.r < inicio || foco.r >= fin)) this.normalizarEn(foco.r, foco.c);

    this.ventana = { inicio, fin };
    // Orden importante: primero se agregan las filas nuevas y al final se quitan las viejas.
    // Así la tabla nunca se "encoge" a la mitad del cambio; si el navegador la midiera en
    // ese momento (pasa al quitar el campo con foco), recortaría el scroll y saltaría.
    const viejas = [...this.cuerpo.querySelectorAll('tr[data-r]')];
    const fragmento = document.createDocumentFragment();
    for (let r = inicio; r < fin; r++) fragmento.append(this.crearRenglon(r));
    this.arriba.after(fragmento);
    this.arriba.firstChild.style.height = `${inicio * this.alto}px`;
    this.abajo.firstChild.style.height = `${(this.filas.length - fin) * this.alto}px`;
    for (const tr of viejas) tr.remove();

    const medido = this.cuerpo.rows[1]?.getBoundingClientRect().height;
    if (medido && Math.abs(medido - this.alto) > 0.5) {
      this.alto = medido;
      this.pintar(true);
      return;
    }
    if (foco && foco.r >= inicio && foco.r < fin) {
      const input = this.celda(foco.r, foco.c);
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(foco.desde, foco.hasta);
    }
  }

  celda(r, c) {
    return this.cuerpo.querySelector(`tr[data-r="${r}"] input[data-c="${c}"]`);
  }

  posicion(input) {
    return { r: Number(input.closest('tr').dataset.r), c: Number(input.dataset.c) };
  }

  normalizarEn(r, c) {
    if (this.filas[r]) this.filas[r][c] = normalizarCelda(c, this.filas[r][c]);
  }

  enfocar(r, c) {
    while (r >= this.filas.length) this.filas.push(vacia());
    // Lleva la fila a la vista antes de dibujar, para que exista su campo.
    const arribaFila = r * this.alto;
    const encabezado = this.tabla.tHead.offsetHeight;
    const visible = this.contenedor.clientHeight - encabezado;
    if (arribaFila < this.contenedor.scrollTop) this.contenedor.scrollTop = arribaFila;
    else if (arribaFila + this.alto > this.contenedor.scrollTop + visible) {
      this.contenedor.scrollTop = arribaFila + this.alto - visible;
    }
    this.pintar(true);
    const input = this.celda(r, c);
    if (input) { input.focus({ preventScroll: true }); input.select(); }
  }

  agregarFila() {
    this.asegurarFilaFinal();
    this.enfocar(this.filas.length - 1, 0);
  }

  eliminarFila(r) {
    this.filas.splice(r, 1);
    this.asegurarFilaFinal();
    this.pintar(true);
    this.alCambiar();
  }

  alEscribir(e) {
    if (!e.target.matches('input[data-c]')) return;
    const { r, c } = this.posicion(e.target);
    this.filas[r][c] = e.target.value;
    // Al escribir en la última fila aparece otra vacía, como en una hoja de cálculo.
    if (r === this.filas.length - 1 && e.target.value.trim()) {
      this.filas.push(vacia());
      this.pintar(true);
    }
    this.alCambiar();
  }

  alSalir(e) {
    if (!e.target.matches('input[data-c]') || !e.target.isConnected) return;
    const { r, c } = this.posicion(e.target);
    const normal = normalizarCelda(c, e.target.value);
    if (normal !== e.target.value) {
      e.target.value = normal;
      this.filas[r][c] = normal;
    }
  }

  alTeclear(e) {
    if (!e.target.matches('input[data-c]')) return;
    const { r, c } = this.posicion(e.target);
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown') {
      e.preventDefault();
      this.enfocar(r + 1, c);
    } else if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp') {
      e.preventDefault();
      if (r > 0) this.enfocar(r - 1, c);
    }
  }

  alPegar(e) {
    if (!e.target.matches('input[data-c]')) return;
    const texto = e.clipboardData?.getData('text/plain') ?? '';
    // Un solo valor se pega normal dentro de la celda.
    if (!/[\t\n]/.test(texto.replace(/[\r\n]+$/, ''))) return;
    e.preventDefault();

    // Excel separa columnas con tabulador. Sin tabuladores, cada renglón es una sola celda
    // (así "1,234.50" no se parte en la coma).
    const separador = texto.includes('\t') ? '\t' : '\u001f';
    const { filas, conEncabezado } = textoAFilas(texto, separador);
    const inicio = this.posicion(e.target);
    const c0 = conEncabezado ? 0 : inicio.c;

    filas.forEach((celdas, i) => {
      const r = inicio.r + i;
      while (r >= this.filas.length) this.filas.push(vacia());
      celdas.slice(0, 4 - c0).forEach((valor, j) => {
        this.filas[r][c0 + j] = normalizarCelda(c0 + j, valor);
      });
    });
    this.asegurarFilaFinal();
    this.alCambiar();
    this.enfocar(Math.min(inicio.r + filas.length, this.filas.length - 1), c0);
  }

  /** Resalta las filas con error; `errores` = [{ fila, mensaje }] con fila base 1. */
  marcarErrores(errores) {
    this.errores = new Map(errores.map((e) => [e.fila - 1, e.mensaje]));
    for (const tr of this.cuerpo.rows) {
      if (tr.dataset.r === undefined) continue;
      const mensaje = this.errores.get(Number(tr.dataset.r));
      tr.classList.toggle('con-error', Boolean(mensaje));
      if (mensaje) tr.title = mensaje; else tr.removeAttribute('title');
    }
  }
}
