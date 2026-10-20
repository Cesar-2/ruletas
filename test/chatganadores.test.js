// Lo que escribe en el chat el ganador actual (chatganadores.ts).
//
// Lo que se comprueba:
//  - Solo se guarda lo del ganador actual, y solo desde que gano: del resto
//    del chat no se guarda nada.
//  - Al ganar otro, lo del anterior se tira; si el mismo vuelve a ganar, se
//    empieza de cero.
//  - El nombre vale con otras mayusculas, tildes o una @ delante.
//  - Se avisa cuando escribe el ganador actual, y solo entonces.

const { test } = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./ayuda');

// `ganadores` es la lista de { nombre, desde } que devuelve el servidor; se
// puede cambiar despues para simular que gana otro.
function montar(ganadores) {
  const avisos = [];
  const estado = { ganadores };
  const m = cargar('chatganadores');
  m.iniciar({
    canalDe: () => '',
    ganadoresActuales: () => estado.ganadores,
    alCambiar: (uid) => avisos.push(uid)
  });
  return { m, avisos, estado };
}

test('solo se guarda lo del ganador actual desde que gano', () => {
  const { m } = montar([{ nombre: 'Ana', desde: 2000 }]);
  m.alMensaje('u1', { autor: 'ana', texto: '!correr' }, new Date(1000));
  m.alMensaje('u1', { autor: 'luis', texto: 'gg' }, new Date(2500));
  m.alMensaje('u1', { autor: 'ana', texto: 'estoy en Astrub' }, new Date(3000));
  m.alMensaje('u1', { autor: 'ana', texto: 'en el zaap' }, new Date(4000));
  assert.deepStrictEqual(m.de('u1', 'Ana', 2000).map((l) => l.texto), ['en el zaap', 'estoy en Astrub']);
  assert.deepStrictEqual(m.de('u1', 'Ana').map((l) => l.texto), ['en el zaap', 'estoy en Astrub'],
    'lo de antes de ganar no se llego a guardar');
  assert.deepStrictEqual(m.de('u1', 'luis'), [], 'de quien no ha ganado no se guarda nada');
  assert.deepStrictEqual(m.de('u2', 'Ana'), [], 'cada cuenta lo suyo');
});

test('al ganar otro se tira lo del anterior, y al volver a ganar se empieza de cero', () => {
  const { m, estado } = montar([{ nombre: 'Ana', desde: 1000 }]);
  m.alMensaje('u1', { autor: 'ana', texto: 'hola' }, new Date(2000));
  estado.ganadores = [{ nombre: 'Beto', desde: 3000 }];
  m.olvidarNombres('u1');
  assert.deepStrictEqual(m.de('u1', 'Ana'), []);
  m.alMensaje('u1', { autor: 'beto', texto: 'yo' }, new Date(4000));
  assert.strictEqual(m.de('u1', 'Beto').length, 1);
  estado.ganadores = [{ nombre: 'Beto', desde: 5000 }];
  m.olvidarNombres('u1');
  assert.deepStrictEqual(m.de('u1', 'Beto'), [], 'lo de su victoria anterior tampoco');
});

test('el nombre vale con mayusculas, tildes o @', () => {
  const { m } = montar([{ nombre: '@Ramón', desde: 0 }]);
  m.alMensaje('u1', { autor: 'Ramon', texto: 'aqui' });
  assert.strictEqual(m.de('u1', 'ramon').length, 1);
});

test('avisa solo cuando escribe el ganador actual', () => {
  const { m, avisos } = montar([{ nombre: 'Ana', desde: 0 }]);
  m.alMensaje('u1', { autor: 'luis', texto: 'gg' });
  assert.deepStrictEqual(avisos, []);
  m.alMensaje('u1', { autor: 'ana', texto: 'hola' });
  assert.deepStrictEqual(avisos, ['u1']);
});
