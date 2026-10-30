import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearFecha, fechaTexto, fechaISO, parsearMonto, montoPlano } from '../js/formato.js';
import { parsearDelimitado, serializarDelimitado, csvAObjetos } from '../js/csv.js';

test('fechas en formatos comunes de México', () => {
  const oct1 = parsearFecha('01/10/2026');
  assert.equal(fechaTexto(oct1), '01/10/2026');
  assert.equal(parsearFecha('1/10/26'), oct1);
  assert.equal(parsearFecha('2026-10-01'), oct1);
  assert.equal(parsearFecha('01-OCT-2026'), oct1);
  assert.equal(parsearFecha('01/Oct/2026'), oct1);
  assert.equal(parsearFecha('01.10.2026'), oct1);
  assert.equal(fechaISO(oct1), '2026-10-01');
  assert.equal(parsearFecha('02/10/2026') - oct1, 1);
});

test('fechas inválidas', () => {
  assert.equal(parsearFecha('31/02/2026'), null);
  assert.equal(parsearFecha('13/13/2026'), null);
  assert.equal(parsearFecha('mañana'), null);
  assert.equal(parsearFecha(''), null);
});

test('montos a centavos enteros', () => {
  assert.deepEqual(parsearMonto('$1,234.50'), { centavos: 123450 });
  assert.deepEqual(parsearMonto('1234.5'), { centavos: 123450 });
  assert.deepEqual(parsearMonto('30'), { centavos: 3000 });
  assert.deepEqual(parsearMonto('-30.00'), { centavos: 3000 });
  assert.deepEqual(parsearMonto('(1,000.00)'), { centavos: 100000 });
  assert.deepEqual(parsearMonto('1234,50'), { centavos: 123450 });
  assert.deepEqual(parsearMonto('.10'), { centavos: 10 });
  assert.deepEqual(parsearMonto('$ 12,345,678.09 MXN'), { centavos: 1234567809 });
  assert.deepEqual(parsearMonto(''), { vacio: true });
  assert.deepEqual(parsearMonto('0.00'), { vacio: true });
  assert.ok(parsearMonto('abc').error);
  assert.ok(parsearMonto('1.005').error);
});

test('sumas exactas sin errores de punto flotante', () => {
  const total = ['0.10', '0.20'].map((t) => parsearMonto(t).centavos).reduce((a, b) => a + b);
  assert.equal(montoPlano(total), '0.30');
  assert.equal(montoPlano(5), '0.05');
  assert.equal(montoPlano(-150040), '-1500.40');
});

test('CSV con comillas, separadores y saltos de línea', () => {
  const texto = 'a,b\n"x, y","dijo ""hola""\notra línea"\n\n';
  const filas = parsearDelimitado(texto, ',');
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[1].celdas, ['x, y', 'dijo "hola"\notra línea']);
  assert.equal(filas[1].linea, 2);

  const ida = serializarDelimitado([['fecha', 'concepto'], ['2026-10-01', 'Pago, "urgente"']]);
  assert.deepEqual(csvAObjetos(ida), [{ fecha: '2026-10-01', concepto: 'Pago, "urgente"' }]);
});

test('detecta tabulador al pegar desde Excel', () => {
  const filas = parsearDelimitado('01/10/2026\tPago, uno\t30.00\t\r\n02/10/2026\tPago\t\t5');
  assert.deepEqual(filas[0].celdas, ['01/10/2026', 'Pago, uno', '30.00', '']);
  assert.equal(filas[1].linea, 2);
});
