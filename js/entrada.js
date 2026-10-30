// Convierte el texto pegado (o un CSV importado) en movimientos validados (RF-01 a RF-04).

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

function esEncabezado(celdas) {
  return parsearFecha(celdas[0]) === null
    && celdas.some((c) => /fecha|concepto|cargo|abono|descripci/i.test(c));
}

/**
 * @param {string} texto  Texto pegado de Excel o contenido CSV.
 * @param {'A'|'B'} lado  Estado de cuenta al que pertenece.
 * @returns {{ movimientos: object[], errores: {fila:number, mensaje:string}[], resumen: object }}
 */
export function leerMovimientos(texto, lado) {
  const filas = parsearDelimitado(texto);
  const movimientos = [];
  const errores = [];
  let columnas = { fecha: 0, concepto: 1, cargo: 2, abono: 3 };
  let inicio = 0;

  if (filas.length && esEncabezado(filas[0].celdas)) {
    const mapa = mapearEncabezado(filas[0].celdas);
    if (mapa.fecha !== undefined && mapa.cargo !== undefined && mapa.abono !== undefined) {
      columnas = { concepto: -1, ...mapa };
    }
    inicio = 1;
  }

  for (const { celdas, linea } of filas.slice(inicio)) {
    const celda = (i) => (i >= 0 ? celdas[i] ?? '' : '');
    const fecha = parsearFecha(celda(columnas.fecha));
    const cargo = parsearMonto(celda(columnas.cargo));
    const abono = parsearMonto(celda(columnas.abono));
    const concepto = celda(columnas.concepto).replace(/\s+/g, ' ').trim();

    const problemas = [];
    if (fecha === null) problemas.push(`fecha inválida: "${celda(columnas.fecha)}"`);
    if (cargo.error) problemas.push(`cargo con ${cargo.error}`);
    if (abono.error) problemas.push(`abono con ${abono.error}`);
    if (cargo.centavos && abono.centavos) problemas.push('trae cargo y abono a la vez');
    if (!cargo.error && !abono.error && !cargo.centavos && !abono.centavos) {
      problemas.push('no trae monto de cargo ni de abono');
    }
    if (problemas.length) {
      errores.push({ fila: linea, mensaje: problemas.join('; ') });
      continue;
    }

    movimientos.push({
      id: `${lado}-${linea}`,
      lado,
      fila: linea,
      orden: movimientos.length,
      fecha,
      concepto,
      tipo: cargo.centavos ? 'cargo' : 'abono',
      centavos: cargo.centavos || abono.centavos,
    });
  }

  return { movimientos, errores, resumen: resumir(movimientos) };
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
