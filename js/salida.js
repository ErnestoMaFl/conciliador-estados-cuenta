// Formatos de salida: cuadros para copiar y pegar (RF-10, RF-11) y CSV de resultados (RF-15).

import { serializarDelimitado } from './csv.js';
import { fechaTexto, montoPlano } from './formato.js';

export const ENCABEZADO_CUADRO = ['Fecha', 'Concepto', 'Monto'];

const filaCuadro = (m) => [fechaTexto(m.fecha), m.concepto, montoPlano(m.centavos)];

/** Texto tabulado: al pegarlo en Excel cada dato cae en su columna. */
export function cuadroTSV(movimientos) {
  const limpio = (v) => String(v).replace(/[\t\r\n]+/g, ' ');
  return [ENCABEZADO_CUADRO, ...movimientos.map(filaCuadro)]
    .map((f) => f.map(limpio).join('\t')).join('\n');
}

const escaparHTML = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Tabla HTML: al pegarla en un correo o en Word conserva las columnas. */
export function cuadroHTML(movimientos) {
  const celda = (tag, v, derecha) =>
    `<${tag} style="border:1px solid #999;padding:4px 8px;${derecha ? 'text-align:right;' : 'text-align:left;'}">${escaparHTML(v)}</${tag}>`;
  const enc = ENCABEZADO_CUADRO.map((h, i) => celda('th', h, i === 2)).join('');
  const filas = movimientos.map((m) =>
    `<tr>${filaCuadro(m).map((v, i) => celda('td', v, i === 2)).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">`
    + `<thead><tr>${enc}</tr></thead><tbody>${filas}</tbody></table>`;
}

export const COLUMNAS_RESULTADO = [
  'estado', 'columna_a', 'columna_b', 'lado', 'fila', 'fecha', 'concepto', 'monto',
  'pareja_fila', 'pareja_fecha', 'pareja_concepto', 'dias_diferencia', 'posible_coincidencia',
];

const plural = { cargo: 'Cargos', abono: 'Abonos' };

/** Resultado completo como filas de CSV (una por movimiento), con trazabilidad a la fila original. */
export function filasResultado(resultado, nombres) {
  const filas = [];
  for (const col of resultado.columnas) {
    const base = { columna_a: plural[col.tipoA], columna_b: plural[col.tipoB] };
    for (const { a, b, dias } of col.conciliados) {
      filas.push({
        ...base, estado: 'Conciliado', lado: nombres.A, fila: a.fila, fecha: fechaTexto(a.fecha),
        concepto: a.concepto, monto: montoPlano(a.centavos), pareja_fila: b.fila,
        pareja_fecha: fechaTexto(b.fecha), pareja_concepto: b.concepto, dias_diferencia: dias,
      });
    }
    const pendientes = (lista, posibles, lado, otro) => {
      for (const m of lista) {
        const p = posibles.get(m.id);
        filas.push({
          ...base, estado: `No está en ${otro}`, lado, fila: m.fila, fecha: fechaTexto(m.fecha),
          concepto: m.concepto, monto: montoPlano(m.centavos),
          posible_coincidencia: p ? describirPosible(p) : '',
        });
      }
    };
    pendientes(col.pendientesA, col.posiblesA, nombres.A, nombres.B);
    pendientes(col.pendientesB, col.posiblesB, nombres.B, nombres.A);
  }
  return filas;
}

export function describirPosible({ movimiento: o, difCentavos, dias }) {
  const partes = [`fila ${o.fila}`, fechaTexto(o.fecha), montoPlano(o.centavos)];
  if (difCentavos) partes.push(`dif. ${montoPlano(difCentavos)}`);
  if (dias) partes.push(`${dias} día${dias === 1 ? '' : 's'}`);
  return partes.join(' · ');
}

export function resultadoCSV(resultado, nombres) {
  const filas = filasResultado(resultado, nombres);
  return serializarDelimitado([COLUMNAS_RESULTADO, ...filas.map((f) => COLUMNAS_RESULTADO.map((k) => f[k] ?? ''))]);
}
