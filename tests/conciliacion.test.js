import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerMovimientos } from '../js/entrada.js';
import { conciliar } from '../js/conciliacion.js';
import { cuadroTSV, resultadoCSV } from '../js/salida.js';
import { csvAObjetos } from '../js/csv.js';

const tsv = (...filas) => filas.map((f) => f.join('\t')).join('\n');
const leer = (texto, lado) => leerMovimientos(texto, lado);
const conceptos = (movs) => movs.map((m) => m.concepto);

test('lectura con encabezado, validación y resumen (RF-01 a RF-04)', () => {
  const r = leer(tsv(
    ['Fecha', 'Concepto', 'Cargos', 'Abonos'],
    ['01/10/2026', 'Pago X', '$30.00', ''],
    ['02/10/2026', 'Depósito', '', '1,000.00'],
    ['31/02/2026', 'Fecha mala', '10', ''],
    ['03/10/2026', 'Ambos', '10', '10'],
    ['04/10/2026', 'Sin monto', '', ''],
  ), 'A');
  assert.equal(r.movimientos.length, 2);
  assert.deepEqual(r.errores.map((e) => e.fila), [4, 5, 6]);
  assert.match(r.errores[0].mensaje, /fecha inválida/);
  assert.match(r.errores[1].mensaje, /a la vez/);
  assert.match(r.errores[2].mensaje, /no trae monto/);
  assert.deepEqual(r.resumen, { total: 2, cargos: 3000, abonos: 100000, numCargos: 1, numAbonos: 1 });
  assert.equal(r.movimientos[0].id, 'A-2');
});

test('mapea columnas por encabezado e ignora columnas extra como Saldo', () => {
  const r = leer(tsv(
    ['Fecha de operación', 'Descripción', 'Retiros', 'Depósitos', 'Saldo'],
    ['01/10/2026', 'Pago', '30.00', '', '970.00'],
  ), 'B');
  assert.equal(r.errores.length, 0);
  assert.equal(r.movimientos[0].tipo, 'cargo');
  assert.equal(r.movimientos[0].centavos, 3000);
});

test('sin encabezado se toman las columnas en orden', () => {
  const r = leer(tsv(['01/10/2026', 'Pago', '30', '']), 'A');
  assert.equal(r.movimientos[0].concepto, 'Pago');
  assert.equal(r.movimientos[0].fila, 1);
});

test('montos repetidos: primero misma fecha, después la más cercana, uno a uno (RF-06 a RF-08)', () => {
  const A = leer(tsv(
    ['01/10/2026', 'A1', '30', ''],
    ['05/10/2026', 'A2', '30', ''],
    ['20/10/2026', 'A3', '30', ''],
  ), 'A').movimientos;
  const B = leer(tsv(
    ['06/10/2026', 'B1', '30', ''],
    ['01/10/2026', 'B2', '30', ''],
  ), 'B').movimientos;

  const [cargos] = conciliar(A, B).columnas;
  const pares = cargos.conciliados.map((c) => `${c.a.concepto}-${c.b.concepto}`);
  assert.deepEqual(pares, ['A1-B2', 'A2-B1']);
  assert.deepEqual(conceptos(cargos.pendientesA), ['A3']);
  assert.deepEqual(cargos.pendientesB, []);
});

test('la más cercana gana aunque no sea la primera capturada', () => {
  const A = leer(tsv(['10/10/2026', 'A1', '50', '']), 'A').movimientos;
  const B = leer(tsv(['01/10/2026', 'lejos', '50', ''], ['11/10/2026', 'cerca', '50', '']), 'B').movimientos;
  const [cargos] = conciliar(A, B).columnas;
  assert.equal(cargos.conciliados[0].b.concepto, 'cerca');
  assert.deepEqual(conceptos(cargos.pendientesB), ['lejos']);
});

test('una diferencia de centavos no concilia, pero se sugiere como posible (RF-14)', () => {
  const A = leer(tsv(['10/10/2026', 'Servicio', '150.00', '']), 'A').movimientos;
  const B = leer(tsv(['15/10/2026', 'Comisión', '150.40', '']), 'B').movimientos;
  const [cargos] = conciliar(A, B).columnas;
  assert.equal(cargos.conciliados.length, 0);
  const posible = cargos.posiblesA.get(A[0].id);
  assert.equal(posible.movimiento.concepto, 'Comisión');
  assert.equal(posible.difCentavos, 40);

  const sinTolerancia = conciliar(A, B, { toleranciaCentavos: 0 }).columnas[0];
  assert.equal(sinTolerancia.posiblesA.size, 0);
});

test('límite de días: mismo monto fuera de rango queda pendiente y se sugiere', () => {
  const A = leer(tsv(['01/10/2026', 'A', '30', '']), 'A').movimientos;
  const B = leer(tsv(['21/10/2026', 'B', '30', '']), 'B').movimientos;
  assert.equal(conciliar(A, B).columnas[0].conciliados.length, 1);

  const col = conciliar(A, B, { maxDias: 5 }).columnas[0];
  assert.equal(col.conciliados.length, 0);
  assert.equal(col.posiblesA.get(A[0].id).dias, 20);
});

test('cargos y abonos no se mezclan en modo directo; sí se cruzan en modo cruzado (RF-05)', () => {
  const A = leer(tsv(['01/10/2026', 'Pago', '30', ''], ['02/10/2026', 'Depósito', '', '100']), 'A').movimientos;
  const B = leer(tsv(['01/10/2026', 'Pago', '', '30'], ['02/10/2026', 'Depósito', '100', '']), 'B').movimientos;

  const directo = conciliar(A, B, { cruce: 'directo' });
  assert.equal(directo.columnas.reduce((n, c) => n + c.conciliados.length, 0), 0);

  const cruzado = conciliar(A, B, { cruce: 'cruzado' });
  assert.deepEqual(cruzado.columnas.map((c) => [c.tipoA, c.tipoB, c.conciliados.length]),
    [['cargo', 'abono', 1], ['abono', 'cargo', 1]]);
});

test('totales del resumen (RF-13)', () => {
  const A = leer(tsv(['01/10/2026', 'x', '30', ''], ['02/10/2026', 'y', '10.50', '']), 'A').movimientos;
  const B = leer(tsv(['01/10/2026', 'x', '30', ''], ['03/10/2026', 'z', '7', '']), 'B').movimientos;
  const { totales } = conciliar(A, B).columnas[0];
  assert.deepEqual(totales, { a: 4050, b: 3700, conciliado: 3000, pendienteA: 1050, pendienteB: 700 });
});

test('mismo resultado siempre con los mismos datos (RNF-02)', () => {
  const filas = Array.from({ length: 40 }, (_, i) => [`0${1 + (i % 9)}/10/2026`, `m${i}`, '30', '']);
  const A = leer(tsv(...filas), 'A').movimientos;
  const B = leer(tsv(...filas.slice(5).reverse()), 'B').movimientos;
  const firma = () => JSON.stringify(conciliar(A, B).columnas[0].conciliados.map((c) => [c.a.id, c.b.id]));
  assert.equal(firma(), firma());
  assert.equal(conciliar(A, B).columnas[0].pendientesA.length, 5);
});

test('cuadro para copiar y CSV de resultado (RF-10, RF-11, RF-15)', () => {
  const A = leer(tsv(['20/10/2026', 'Pago   Z', '1,030.5', '']), 'A').movimientos;
  const res = conciliar(A, []);
  assert.equal(cuadroTSV(res.columnas[0].pendientesA), 'Fecha\tConcepto\tMonto\n20/10/2026\tPago Z\t1030.50');

  const filas = csvAObjetos(resultadoCSV(res, { A: 'Banco', B: 'Libros' }));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].estado, 'No está en Libros');
  assert.equal(filas[0].fila, '1');
});

test('rendimiento: 5,000 movimientos por lado en menos de 3 segundos (RNF-04)', () => {
  const filas = (n, desfase) => Array.from({ length: n }, (_, i) => [
    `${String(1 + ((i + desfase) % 28)).padStart(2, '0')}/10/2026`, `mov ${i}`, String(100 + (i % 700)), '',
  ]);
  const A = leer(tsv(...filas(5000, 0)), 'A').movimientos;
  const B = leer(tsv(...filas(5000, 3)), 'B').movimientos;
  const inicio = performance.now();
  const res = conciliar(A, B);
  const ms = performance.now() - inicio;
  assert.equal(res.columnas[0].conciliados.length, 5000);
  assert.ok(ms < 3000, `tardó ${ms.toFixed(0)} ms`);
});
