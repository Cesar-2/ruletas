// El diagnostico: que se apunte cuando el hilo se bloquea, y que diga que
// operacion lo hizo aunque ya hubiera acabado.

const { test } = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./ayuda');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('un bloqueo del hilo se apunta, con la operacion que lo causo', async () => {
  const registro = cargar('registro');
  const diagnostico = cargar('diagnostico');
  diagnostico.iniciar();
  await esperar(1100);

  const acabar = diagnostico.medir('leer-catalogo', { que: 'prueba' });
  const hasta = Date.now() + 2200;
  while (Date.now() < hasta) { /* bloquea el hilo, como un JSON.parse enorme */ }
  acabar();
  await esperar(1200);

  const bloqueos = registro.ultimos(50).filter((e) => e.evento === 'hilo-bloqueado');
  assert.ok(bloqueos.length >= 1, 'se apunta el bloqueo');
  assert.ok(bloqueos[0].ms >= 1000);
  assert.ok(bloqueos.some((b) => b.acabadasEntreMedias.some((a) => a.op === 'leer-catalogo')), 'dice cual fue');
  const lenta = registro.ultimos(50).find((e) => e.evento === 'operacion-lenta');
  assert.strictEqual(lenta.op, 'leer-catalogo');
  assert.strictEqual(lenta.que, 'prueba');
});
