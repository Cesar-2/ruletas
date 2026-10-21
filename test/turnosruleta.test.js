// Los turnos de la Ruleta de objetos: quien canjea la recompensa espera en
// fila a que le giren la ruleta. Lo que se comprueba:
//
//  - Se apuntan por orden de llegada, y el mismo canje dos veces cuenta una.
//  - Sacar uno devuelve cual era, y avisa a la pagina.
//  - La fila sigue ahi tras un reinicio: quien pago no se queda sin tirada.
//  - Llena, no se apunta a nadie mas (y twitch.ts le devuelve los puntos).

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

test('se apuntan por orden, sin repetir el mismo canje', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const avisados = [];
  const turnos = cargar('turnosruleta', deps(c.raiz, avisados));
  assert.strictEqual(turnos.apuntar('u1', { id: 'c1', recompensa: 'rw', nombre: 'Ana', login: 'Ana' }), true);
  assert.strictEqual(turnos.apuntar('u1', { id: 'c2', recompensa: 'rw', nombre: 'Pepe' }), true);
  assert.strictEqual(turnos.apuntar('u1', { id: 'c1', recompensa: 'rw', nombre: 'Ana' }), true, 'Twitch puede repetir un aviso');
  assert.deepStrictEqual(turnos.leer('u1').map((x) => x.nombre), ['Ana', 'Pepe']);
  assert.strictEqual(turnos.leer('u1')[0].login, 'ana');
  assert.deepStrictEqual(avisados, ['u1', 'u1'], 'la pagina se entera de cada uno nuevo');
  assert.strictEqual(turnos.apuntar('u1', { id: 'c3', recompensa: 'rw', nombre: '  ' }), false, 'sin nombre no hay turno');
});

test('sacar uno dice cual era, y la fila sigue tras un reinicio', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  let turnos = cargar('turnosruleta', deps(c.raiz));
  turnos.apuntar('u1', { id: 'c1', recompensa: 'rw', nombre: 'Ana' });
  turnos.apuntar('u1', { id: 'c2', recompensa: 'rw', nombre: 'Pepe' });
  turnos = cargar('turnosruleta', deps(c.raiz));
  assert.deepStrictEqual(turnos.leer('u1').map((x) => x.id), ['c1', 'c2']);
  assert.strictEqual(turnos.sacar('u1', 'c1').nombre, 'Ana');
  assert.strictEqual(turnos.sacar('u1', 'c1'), null, 'ya no estaba');
  assert.deepStrictEqual(turnos.leer('u1').map((x) => x.nombre), ['Pepe']);
  assert.deepStrictEqual(turnos.leer('otro'), [], 'cada cuenta tiene su fila');
});

test('llena, no se apunta a nadie mas', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const turnos = cargar('turnosruleta', deps(c.raiz));
  for (let i = 0; i < turnos.MAXIMO; i++) turnos.apuntar('u1', { id: 'c' + i, recompensa: 'rw', nombre: 'N' + i });
  assert.strictEqual(turnos.apuntar('u1', { id: 'otro', recompensa: 'rw', nombre: 'Tarde' }), false);
  assert.strictEqual(turnos.leer('u1').length, turnos.MAXIMO);
});
