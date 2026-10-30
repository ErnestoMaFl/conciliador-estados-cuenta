// Acceso a un GitHub Gist usado como base de datos de archivos CSV.
//
// Estructura del Gist:
//   periodos.csv               índice: un renglón por conciliación guardada
//   config.csv                 clave,valor con las reglas de conciliación (RNF-08)
//   <periodo>__A.csv           movimientos del estado de cuenta A
//   <periodo>__B.csv           movimientos del estado de cuenta B
//   <periodo>__resultado.csv   resultado de la última conciliación del periodo

const API = 'https://api.github.com';

export const ARCHIVO_PERIODOS = 'periodos.csv';
export const ARCHIVO_CONFIG = 'config.csv';
export const COLUMNAS_PERIODOS = [
  'periodo', 'nombre', 'nombre_a', 'nombre_b', 'movimientos_a', 'movimientos_b',
  'conciliados', 'pendientes_a', 'pendientes_b', 'actualizado',
];
export const COLUMNAS_MOVIMIENTOS = ['fecha', 'concepto', 'cargo', 'abono'];

export const archivoPeriodo = (periodo, parte) => `${periodo}__${parte}.csv`;

/** "Octubre 2026 / Banorte" → "octubre-2026-banorte" (nombre seguro para archivo). */
export function claveDePeriodo(nombre) {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export class ErrorGist extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

async function solicitar(token, ruta, opciones = {}) {
  const resp = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (resp.ok) return resp.json();

  const mensajes = {
    401: 'El token no es válido o ya expiró.',
    403: 'El token no tiene permiso de escritura en Gists (o se alcanzó el límite de la API).',
    404: 'No se encontró el Gist. Revisa el ID y que el token pertenezca a la cuenta dueña del Gist.',
    422: 'GitHub rechazó los datos enviados.',
  };
  let detalle = '';
  try { detalle = (await resp.json()).message ?? ''; } catch { /* sin cuerpo */ }
  throw new ErrorGist(mensajes[resp.status] ?? `Error ${resp.status} de GitHub. ${detalle}`, resp.status);
}

/** Lee el Gist y devuelve { id, url, archivos: { nombre: contenido } }. */
export async function leerGist(token, id) {
  const g = await solicitar(token, `/gists/${encodeURIComponent(id)}`);
  const archivos = {};
  await Promise.all(Object.values(g.files).map(async (f) => {
    // La API corta el contenido de archivos de más de ~1 MB; en ese caso se baja completo.
    if (f.truncated) {
      const r = await fetch(f.raw_url);
      if (!r.ok) throw new ErrorGist(`No se pudo leer completo el archivo ${f.filename}.`, r.status);
      archivos[f.filename] = await r.text();
    } else {
      archivos[f.filename] = f.content ?? '';
    }
  }));
  return { id: g.id, url: g.html_url, archivos };
}

/**
 * Crea, reemplaza o borra archivos. `cambios` = { nombre: contenido | null }.
 * null borra el archivo.
 */
export async function escribirArchivos(token, id, cambios) {
  const files = Object.fromEntries(Object.entries(cambios)
    .map(([nombre, contenido]) => [nombre, contenido === null ? null : { content: contenido }]));
  return solicitar(token, `/gists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ files }),
  });
}

/** Crea un Gist secreto con los archivos iniciales. Devuelve { id, url }. */
export async function crearGist(token, archivosIniciales) {
  const files = Object.fromEntries(Object.entries(archivosIniciales)
    .map(([nombre, contenido]) => [nombre, { content: contenido }]));
  const g = await solicitar(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: 'BD del Conciliador de estados de cuenta', public: false, files }),
  });
  return { id: g.id, url: g.html_url };
}
