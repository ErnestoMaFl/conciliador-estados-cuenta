// Convierte lo capturado (tabla, texto pegado o CSV importado) en movimientos validados
// (RF-01 a RF-04). Primero todo se lleva a filas de 4 celdas [fecha, concepto, cargo, abono]
// y después se valida; así la tabla de captura y el texto pegado usan las mismas reglas.

import { parsearDelimitado } from './csv.js';
import { parsearFecha, parsearMonto, fechaISO, montoPlano } from './formato.js';

// Nombres de encabezado reconocidos para cada columna. Permite pegar exportaciones de
// banco con columnas extra (Saldo, Referencia...) siempre que traigan encabezado.
const ALIAS = {
  fecha: /^(fecha|fecha de operaci[oó]n|fecha operaci[oó]n|f\. ?operaci[oó]n|date)$/,
  concepto: /^(concepto|descripci[oó]n|detalle|movimiento|referencia ?\/ ?concepto)$/,
  cargo: /^(cargos?|retiros?|debe|d[eé]bitos?|egresos?)$/,
  abono: /^(abonos?|dep[oó]sitos?|haber|cr[eé]ditos?|ingresos?)$/,
};

export const COLUMNAS_CAPTURA = ['fecha', 'concepto', 'cargo', 'abono'];

const normalizar = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function mapearEncabezado(celdas) {
  const mapa = {};
  celdas.forEach((c, i) => {
    const t = normalizar(c);
    for (const [col, re] of Object.entries(ALIAS)) {
      if (mapa[col] === undefined && re.test(t)) mapa[col] = i;
    }
  });
  return mapa;
}

export function esEncabezado(celdas) {
  return parsearFecha(celdas[0]) === null
    && celdas.some((c) => /fecha|concepto|cargo|abono|descripci|retiro|dep[oó]sito/i.test(c));
}

/**
 * Texto pegado o CSV → { filas, conEncabezado }, donde cada fila es
 * [fecha, concepto, cargo, abono] en texto. Si hay encabezado reconocible, las
 * columnas se toman por nombre; si no, en el orden en que vienen.
 * Sin `separador`, se detecta (tabulador, coma o punto y coma).
 */
export function textoAFilas(texto, separador) {
  const filas = parsearDelimitado(texto, separador);
  if (!filas.length || !esEncabezado(filas[0].celdas)) {
    return { filas: filas.map((f) => f.celdas), conEncabezado: false };
  }
  const mapa = mapearEncabezado(filas[0].celdas);
  const completo = mapa.fecha !== undefined && mapa.cargo !== undefined && mapa.abono !== undefined;
  const indices = completo
    ? COLUMNAS_CAPTURA.map((c) => mapa[c] ?? -1)
    : [0, 1, 2, 3];
  return {
    filas: filas.slice(1).map((f) => indices.map((i) => (i >= 0 ? f.celdas[i] ?? '' : ''))),
    conEncabezado: true,
  };
}

const filaVacia = (celdas) => celdas.every((c) => String(c ?? '').trim() === '');

/**
 * Valida filas [fecha, concepto, cargo, abono]. El número de fila es la posición en la
 * lista (1 = primera), que coincide con el número que muestra la tabla de captura.
 * Las filas totalmente vacías se ignoran sin marcar error.
 * @returns {{ movimientos: object[], errores: {fila:number, mensaje:string}[], resumen: object }}
 */
export function leerFilas(filas, lado) {
  const movimientos = [];
  const errores = [];

  filas.forEach((celdas, i) => {
    if (filaVacia(celdas)) return;
    const fila = i + 1;
    const [textoFecha = '', textoConcepto = '', textoCargo = '', textoAbono = ''] = celdas;
    const fecha = parsearFecha(textoFecha);
    const cargo = parsearMonto(textoCargo);
    const abono = parsearMonto(textoAbono);
    const concepto = String(textoConcepto).replace(/\s+/g, ' ').trim();

    const problemas = [];
    if (fecha === null) problemas.push(textoFecha.trim() ? `fecha inválida: "${textoFecha}"` : 'falta la fecha');
    if (cargo.error) problemas.push(`cargo con ${cargo.error}`);
    if (abono.error) problemas.push(`abono con ${abono.error}`);
    if (cargo.centavos && abono.centavos) problemas.push('trae cargo y abono a la vez');
    if (!cargo.error && !abono.error && !cargo.centavos && !abono.centavos) {
      problemas.push('no trae monto de cargo ni de abono');
    }
    if (problemas.length) {
      errores.push({ fila, mensaje: problemas.join('; ') });
      return;
    }

    movimientos.push({
      id: `${lado}-${fila}`,
      lado,
      fila,
      orden: movimientos.length,
      fecha,
      concepto,
      tipo: cargo.centavos ? 'cargo' : 'abono',
      centavos: cargo.centavos || abono.centavos,
    });
  });

  return { movimientos, errores, resumen: resumir(movimientos) };
}

/** Atajo: texto pegado o CSV → movimientos validados. */
export function leerMovimientos(texto, lado) {
  return leerFilas(textoAFilas(texto).filas, lado);
}

export function resumir(movimientos) {
  const r = { total: movimientos.length, cargos: 0, abonos: 0, numCargos: 0, numAbonos: 0 };
  for (const m of movimientos) {
    if (m.tipo === 'cargo') { r.cargos += m.centavos; r.numCargos++; }
    else { r.abonos += m.centavos; r.numAbonos++; }
  }
  return r;
}

/** Movimientos → filas normalizadas para guardarlas en el Gist. */
export function movimientosAFilas(movimientos) {
  return movimientos.map((m) => ({
    fecha: fechaISO(m.fecha),
    concepto: m.concepto,
    cargo: m.tipo === 'cargo' ? montoPlano(m.centavos) : '',
    abono: m.tipo === 'abono' ? montoPlano(m.centavos) : '',
  }));
}
