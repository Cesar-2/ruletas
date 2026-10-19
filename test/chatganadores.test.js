// Lo que escriben en el chat los ganadores pendientes (chatganadores.ts).
//
// Lo que se comprueba:
//  - Solo salen los mensajes de los ganadores que se piden, lo mas nuevo primero.
//  - El nombre vale con otras mayusculas, tildes o una @ delante.
//  - Se avisa cuando escribe alguien con un premio pendiente, y solo entonces.

const { test } = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./ayuda');

function montar(ganadores) {
  const avisos = [];
  const m = cargar('chatganadores');
  m.iniciar({
    canalDe: () => '',
    nombresGanadores: () => ganadores,
    alCambiar: (uid) => avisos.push(uid)
  });
  return { m, avisos };
}

test('solo los de los ganadores pedidos, lo mas nuevo primero', () => {
  const { m } = montar([]);
  m.alMensaje('u1', { autor: 'ana', texto: 'hola' }, new Date(1000));
  m.alMensaje('u1', { autor: 'luis', texto: 'gg' }, new Date(2000));
  m.alMensaje('u1', { autor: 'ana', texto: 'estoy en Astrub' }, new Date(3000));
  m.alMensaje('u2', { autor: 'ana', texto: 'otra cuenta' }, new Date(4000));
  assert.deepStrictEqual(m.de('u1', ['Ana']).map((l) => l.texto), ['estoy en Astrub', 'hola']);
  assert.deepStrictEqual(m.de('u1', []), []);
});

test('el nombre vale con mayusculas, tildes o @', () => {
  const { m } = montar([]);
  m.alMensaje('u1', { autor: 'Ramon', texto: 'aqui' });
  assert.strictEqual(m.de('u1', ['@ramón']).length, 1);
});

test('avisa solo cuando escribe un ganador pendiente', () => {
  const { m, avisos } = montar(['Ana']);
  m.alMensaje('u1', { autor: 'luis', texto: 'gg' });
  assert.deepStrictEqual(avisos, []);
  m.alMensaje('u1', { autor: 'ana', texto: 'hola' });
  assert.deepStrictEqual(avisos, ['u1']);
});
