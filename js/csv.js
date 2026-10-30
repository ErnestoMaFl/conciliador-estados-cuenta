// Lectura y escritura de texto delimitado (CSV o el TSV que produce Excel al copiar).
// Respeta comillas según RFC 4180, incluyendo saltos de línea dentro de una celda.

/** Elige el separador: tabulador si lo hay (pegado de Excel); si no, ";" o ",". */
export function detectarSeparador(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  if (primera.includes('\t')) return '\t';
  const comas = (primera.match(/,/g) || []).length;
  const puntoYComa = (primera.match(/;/g) || []).length;
  return puntoYComa > comas ? ';' : ',';
}

/**
 * Devuelve una lista de filas; cada fila es { celdas: string[], linea: n } donde
 * `linea` es el número de renglón (1 = primero) en que empieza la fila.
 */
export function parsearDelimitado(texto, separador = detectarSeparador(texto)) {
  const filas = [];
  let celdas = [];
  let celda = '';
  let entreComillas = false;
  let linea = 1;
  let lineaInicio = 1;
  let i = 0;
  const t = String(texto ?? '').replace(/^﻿/, '');

  const cerrarCelda = () => { celdas.push(celda); celda = ''; };
  const cerrarFila = () => {
    cerrarCelda();
    filas.push({ celdas, linea: lineaInicio });
    celdas = [];
  };

  while (i < t.length) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i += 2; continue; }
      if (c === '"') { entreComillas = false; i++; continue; }
      if (c === '\n') linea++;
      celda += c;
      i++;
      continue;
    }
    if (c === '"' && celda === '') { entreComillas = true; i++; continue; }
    if (c === separador) { cerrarCelda(); i++; continue; }
    if (c === '\r' && t[i + 1] === '\n') i++;
    if (c === '\n' || c === '\r') {
      cerrarFila();
      linea++;
      lineaInicio = linea;
      i++;
      continue;
    }
    celda += c;
    i++;
  }
  if (celda !== '' || celdas.length) cerrarFila();

  return filas.filter((f) => f.celdas.some((x) => x.trim() !== ''));
}

function escaparCelda(valor, separador) {
  const s = String(valor ?? '');
  return /["\r\n]/.test(s) || s.includes(separador) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Convierte una matriz de valores a CSV (o TSV si separador = '\t'). */
export function serializarDelimitado(filas, separador = ',') {
  return filas.map((f) => f.map((v) => escaparCelda(v, separador)).join(separador)).join('\n') + '\n';
}

/** CSV con encabezado → arreglo de objetos { encabezado: valor }. */
export function csvAObjetos(texto) {
  const [enc, ...resto] = parsearDelimitado(texto, ',');
  if (!enc) return [];
  const claves = enc.celdas.map((c) => c.trim());
  return resto.map((f) => Object.fromEntries(claves.map((k, i) => [k, f.celdas[i] ?? ''])));
}

/** Arreglo de objetos → CSV con el encabezado indicado. */
export function objetosACsv(objetos, claves) {
  return serializarDelimitado([claves, ...objetos.map((o) => claves.map((k) => o[k] ?? ''))]);
}
