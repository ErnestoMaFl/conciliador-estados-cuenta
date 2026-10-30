// Motor de conciliación (RF-05 a RF-08, RF-13, RF-14).
// Regla: primero monto exacto al centavo; dentro del mismo monto, primero la misma
// fecha y después la más cercana. Emparejamiento uno a uno y determinista (RNF-02).

export const CONFIG_INICIAL = {
  cruce: 'directo',   // 'directo': cargos↔cargos, abonos↔abonos | 'cruzado': cargos↔abonos
  toleranciaCentavos: 100, // diferencia máxima para sugerir "posible coincidencia"
  maxDias: null,      // null = sin límite de días para emparejar un mismo monto
};

export function paresDeColumnas(cruce) {
  return cruce === 'cruzado'
    ? [['cargo', 'abono'], ['abono', 'cargo']]
    : [['cargo', 'cargo'], ['abono', 'abono']];
}

const porFechaYOrden = (x, y) => x.fecha - y.fecha || x.orden - y.orden;

function agruparPorMonto(movs) {
  const grupos = new Map();
  for (const m of movs) {
    if (!grupos.has(m.centavos)) grupos.set(m.centavos, []);
    grupos.get(m.centavos).push(m);
  }
  return grupos;
}

/** Empareja dos listas de movimientos que ya tienen el mismo monto. */
function emparejarMismoMonto(listaA, listaB, maxDias) {
  const candidatos = [];
  for (const a of listaA) {
    for (const b of listaB) {
      const dias = Math.abs(a.fecha - b.fecha);
      if (maxDias === null || dias <= maxDias) candidatos.push({ a, b, dias });
    }
  }
  // Menor distancia en días primero; los empates se resuelven por el orden de captura.
  candidatos.sort((x, y) => x.dias - y.dias || x.a.orden - y.a.orden || x.b.orden - y.b.orden);

  const usados = new Set();
  const pares = [];
  for (const c of candidatos) {
    if (usados.has(c.a.id) || usados.has(c.b.id)) continue;
    usados.add(c.a.id);
    usados.add(c.b.id);
    pares.push(c);
  }
  return { pares, usados };
}

/**
 * Busca, para cada pendiente, el pendiente del otro lado más parecido: diferencia de
 * centavos dentro de la tolerancia, o mismo monto pero fuera del límite de días.
 * Solo es una sugerencia; no concilia nada (RF-14).
 */
function buscarPosibles(pendientes, otros, { toleranciaCentavos, maxDias }) {
  const posibles = new Map();
  for (const p of pendientes) {
    let mejor = null;
    for (const o of otros) {
      const difCentavos = Math.abs(p.centavos - o.centavos);
      const dias = Math.abs(p.fecha - o.fecha);
      const porCentavos = difCentavos > 0 && difCentavos <= toleranciaCentavos;
      const porDias = difCentavos === 0 && maxDias !== null && dias > maxDias;
      if (!porCentavos && !porDias) continue;
      if (!mejor || difCentavos < mejor.difCentavos
        || (difCentavos === mejor.difCentavos && dias < mejor.dias)) {
        mejor = { movimiento: o, difCentavos, dias };
      }
    }
    if (mejor) posibles.set(p.id, mejor);
  }
  return posibles;
}

const suma = (movs) => movs.reduce((s, m) => s + m.centavos, 0);

function conciliarColumna(movsA, movsB, config) {
  const gruposB = agruparPorMonto(movsB);
  const conciliados = [];
  const usados = new Set();

  for (const [monto, listaA] of agruparPorMonto(movsA)) {
    const listaB = gruposB.get(monto);
    if (!listaB) continue;
    const r = emparejarMismoMonto(listaA, listaB, config.maxDias);
    conciliados.push(...r.pares);
    r.usados.forEach((id) => usados.add(id));
  }

  const pendientesA = movsA.filter((m) => !usados.has(m.id)).sort(porFechaYOrden);
  const pendientesB = movsB.filter((m) => !usados.has(m.id)).sort(porFechaYOrden);
  conciliados.sort((x, y) => porFechaYOrden(x.a, y.a));

  return {
    conciliados,
    pendientesA,
    pendientesB,
    posiblesA: buscarPosibles(pendientesA, pendientesB, config),
    posiblesB: buscarPosibles(pendientesB, pendientesA, config),
    totales: {
      a: suma(movsA),
      b: suma(movsB),
      conciliado: suma(conciliados.map((c) => c.a)),
      pendienteA: suma(pendientesA),
      pendienteB: suma(pendientesB),
    },
  };
}

/**
 * Concilia los movimientos de A contra los de B.
 * @returns {{ columnas: object[] }} una entrada por par de columnas comparadas.
 */
export function conciliar(movsA, movsB, config = CONFIG_INICIAL) {
  const cfg = { ...CONFIG_INICIAL, ...config };
  return {
    config: cfg,
    columnas: paresDeColumnas(cfg.cruce).map(([tipoA, tipoB]) => ({
      tipoA,
      tipoB,
      ...conciliarColumna(
        movsA.filter((m) => m.tipo === tipoA),
        movsB.filter((m) => m.tipo === tipoB),
        cfg,
      ),
    })),
  };
}
