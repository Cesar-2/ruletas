// El registro: lo que pasa en produccion se apunta en la consola, en una linea
// JSON, y las ultimas se quedan en memoria para mirarlas desde la pagina.

const { test } = require('node:test');
const assert = require('node:assert');
const registro = require('../dist/registro');

test('se apunta, se lee de la mas nueva a la mas vieja y no crece sin limite', (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  registro.apuntar('info', 'uno', { a: 1 });
  registro.apuntar('error', 'dos', registro.comoDato(new Error('roto')));
  const [ultima, penultima] = registro.ultimos(2);
  assert.strictEqual(ultima.evento, 'dos');
  assert.strictEqual(ultima.mensaje, 'roto');
  assert.ok(ultima.pila.includes('roto'), 'con donde salto');
  assert.strictEqual(penultima.a, 1);
  assert.deepStrictEqual(registro.ultimos(10, 'error').map((e) => e.evento), ['dos'], 'filtra por nivel');
  assert.ok(JSON.parse(console.error.mock.calls[0].arguments[0].replace('[registro] ', '')).t, 'una linea JSON');

  for (let i = 0; i < registro.MAXIMO + 50; i++) registro.apuntar('info', 'x' + i);
  assert.strictEqual(registro.ultimos(registro.MAXIMO * 2).length, registro.MAXIMO);
  assert.strictEqual(registro.ultimos(1)[0].evento, 'x' + (registro.MAXIMO + 49));
});
