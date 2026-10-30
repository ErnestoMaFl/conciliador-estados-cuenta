// Conversión de fechas y montos. Los montos se manejan siempre en centavos
// enteros para no depender del punto flotante (RNF-01).

const MESES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
};

const MS_POR_DIA = 86400000;

function diaDesdeEpoch(anio, mes, dia) {
  const ms = Date.UTC(anio, mes - 1, dia);
  const f = new Date(ms);
  // Rechaza fechas imposibles como 31/02 (Date.UTC las "corre" al mes siguiente).
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) {
    return null;
  }
  return Math.round(ms / MS_POR_DIA);
}

function normalizarAnio(anio) {
  return anio < 100 ? 2000 + anio : anio;
}

/**
 * Convierte texto a número de día (días desde 1970-01-01, UTC).
 * Acepta dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd y dd/OCT/aaaa. Devuelve null si no es válida.
 * Se asume el orden día/mes de México; no se intenta adivinar mm/dd.
 */
export function parsearFecha(texto) {
  const t = String(texto ?? '').trim().toLowerCase();
  if (!t) return null;

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ t].*)?$/);
  if (m) return diaDesdeEpoch(+m[1], +m[2], +m[3]);

  m = t.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})(?: .*)?$/);
  if (m) return diaDesdeEpoch(normalizarAnio(+m[3]), +m[2], +m[1]);

  m = t.match(/^(\d{1,2})[-/. ]([a-z]{3})[a-z]*\.?[-/. ](\d{2}|\d{4})$/);
  if (m && MESES[m[2]]) return diaDesdeEpoch(normalizarAnio(+m[3]), MESES[m[2]], +m[1]);

  return null;
}

function partesDeDia(dia) {
  const f = new Date(dia * MS_POR_DIA);
  return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
}

const dos = (n) => String(n).padStart(2, '0');

/** Día → "dd/mm/aaaa" (formato de pantalla y de copiado). */
export function fechaTexto(dia) {
  const [a, m, d] = partesDeDia(dia);
  return `${dos(d)}/${dos(m)}/${a}`;
}

/** Día → "aaaa-mm-dd" (formato con que se guarda en el Gist). */
export function fechaISO(dia) {
  const [a, m, d] = partesDeDia(dia);
  return `${a}-${dos(m)}-${dos(d)}`;
}

/**
 * Convierte texto a centavos enteros. Devuelve:
 *   { vacio: true }            si la celda está vacía
 *   { centavos: n }            si es un monto válido (siempre positivo)
 *   { error: 'mensaje' }       si no se puede interpretar
 * Los negativos y los paréntesis contables se toman en valor absoluto, porque
 * muchos bancos exportan los cargos con signo menos.
 */
export function parsearMonto(texto) {
  let t = String(texto ?? '').trim();
  if (!t || t === '-' || t === '$') return { vacio: true };

  t = t.replace(/\s|\$|mxn|usd/gi, '');
  if (/^\(.*\)$/.test(t)) t = t.slice(1, -1);
  t = t.replace(/^[-+]|-$/g, '');

  // "1234,50" (coma decimal, sin punto) → "1234.50"; en otro caso la coma es de miles.
  if (!t.includes('.') && /^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');

  const m = t.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (m[1] === '' && !m[2])) return { error: `monto no numérico: "${texto}"` };
  if (m[2] && m[2].length > 2) return { error: `más de 2 decimales: "${texto}"` };

  const centavos = Number(m[1] || '0') * 100 + Number((m[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos)) return { error: `monto demasiado grande: "${texto}"` };
  if (centavos === 0) return { vacio: true };
  return { centavos };
}

const formatoMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Centavos → "$1,234.50" (pantalla). */
export function montoMoneda(centavos) {
  return formatoMoneda.format(centavos / 100);
}

/** Centavos → "1234.50" (copiado a Excel y guardado en CSV, sin separador de miles). */
export function montoPlano(centavos) {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${signo}${Math.trunc(abs / 100)}.${dos(abs % 100)}`;
}
