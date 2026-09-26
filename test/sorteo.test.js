// El ultimo sorteo de la ruleta de objetos, el que enseña el widget de OBS.
//
// Aqui decide el servidor, al contrario que en la ruleta de nombres: esto solo
// se queda con el resultado. Lo que no puede fallar:
//
//  - Mientras gira no se dice QUE ha salido. Con la lista de premios delante,
//    quien mire el JSON del widget lo sabria antes de que se vea en pantalla.
//    El relleno si va, que es de lo que tira la tragaperras para dar vueltas.
//  - Lo que se guarda es lo justo para pintarlo. Si se guardara el objeto entero
//    del catalogo, una clave de solo mirar se llevaria mas de lo que le toca.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function montar(t) {
  const c = carpeta();
  t.after(c.quitar);
  const avisados = [];
  const sorteo = cargar('sorteo', deps(c.raiz, avisados));
  return { sorteo, avisados, raiz: c.raiz };
}

const COSAS = [
  { id: '1', nombre: 'Espada', imagen: '/i/espada.png', rareza: 'epic' },
  { id: '2', nombre: 'Escudo', imagen: '/i/escudo.png', rareza: 'rare' }
];
const RELLENO = [
  { id: '9', nombre: 'Pan', imagen: '/i/pan.png', rareza: 'common' },
  { id: '8', nombre: 'Cuerda', imagen: '/i/cuerda.png', rareza: 'common' }
];

test('sin sorteos no hay nada que enseñar', (t) => {
  const { sorteo } = montar(t);
  assert.strictEqual(sorteo.estado('u1'), null);
});

test('mientras gira NO se dice que ha salido, pero si hay relleno', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, relleno: RELLENO, duracion: 5000 });

  const s = sorteo.estado('u1');
  assert.strictEqual(s.girando, true);
  assert.deepStrictEqual(s.cosas, [], 'los premios no salen todavia');
  assert.strictEqual(s.quien, '', 'ni a quien le tocan');
  assert.strictEqual(s.relleno.length, 2, 'el relleno si, que es con lo que gira');
  assert.ok(s.terminaEn > Date.now());
});

test('al parar salen los premios y el nombre', async (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, relleno: RELLENO, duracion: 60 });
  assert.deepStrictEqual(sorteo.estado('u1').cosas, [], 'todavia gira');

  await espera(150);
  const s = sorteo.estado('u1');
  assert.strictEqual(s.girando, false);
  assert.strictEqual(s.quien, 'Ana');
  assert.deepStrictEqual(s.cosas.map((c) => c.nombre), ['Espada', 'Escudo']);
  assert.strictEqual(s.cosas[0].rareza, 'epic', 'con su rareza, que le da el color');
});

test('sin animacion sale al momento', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, duracion: 0 });
  const s = sorteo.estado('u1');
  assert.strictEqual(s.girando, false);
  assert.strictEqual(s.cosas.length, 2);
});

test('sin nombre escrito se guarda igual: el sorteo no siempre tiene dueño', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { cosas: COSAS, duracion: 0 });
  assert.strictEqual(sorteo.estado('u1').quien, '');
  assert.strictEqual(sorteo.estado('u1').cosas.length, 2);
});

test('sin premios no hay sorteo que guardar', (t) => {
  const { sorteo } = montar(t);
  assert.strictEqual(sorteo.guardar('u1', { quien: 'Ana', cosas: [] }), null);
  assert.strictEqual(sorteo.guardar('u1', { quien: 'Ana' }), null);
  assert.strictEqual(sorteo.guardar('u1', null), null);
  assert.strictEqual(sorteo.estado('u1'), null);
});

test('se guarda lo justo para pintarlo, no el objeto del catalogo', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', {
    cosas: [{
      id: '1', nombre: 'Espada', imagen: '/i/e.png', rareza: 'epic',
      // Lo que NO tiene que colarse: es un objeto del catalogo entero.
      description: 'una descripcion larguisima', level: 200, type: { name: 'Espada' },
      image_urls: { hd: '/enorme.png' }
    }],
    duracion: 0
  });
  const c = sorteo.estado('u1').cosas[0];
  assert.deepStrictEqual(Object.keys(c).sort(), ['id', 'imagen', 'nombre', 'rareza']);
});

test('una rareza que no existe se queda en la de por defecto', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', {
    cosas: [{ nombre: 'X', rareza: 'inventada' }, { nombre: 'Y' }],
    duracion: 0
  });
  const cs = sorteo.estado('u1').cosas;
  assert.strictEqual(cs[0].rareza, 'common');
  assert.strictEqual(cs[1].rareza, 'common');
});

test('una animacion absurda no deja el premio sin salir nunca', (t) => {
  const { sorteo } = montar(t);
  const s = sorteo.guardar('u1', { cosas: COSAS, duracion: 99999999 });
  assert.ok(s.terminaEn - Date.now() <= 30000, 'gira treinta segundos como mucho');
});

test('descartar el sorteo lo quita del widget', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, duracion: 0 });
  assert.ok(sorteo.estado('u1'));
  sorteo.olvidar('u1');
  assert.strictEqual(sorteo.estado('u1'), null);
});

test('cada cambio avisa, para que el widget se entere al momento', (t) => {
  const { sorteo, avisados } = montar(t);
  avisados.length = 0;
  sorteo.guardar('u1', { cosas: COSAS, duracion: 0 });
  assert.strictEqual(avisados.length, 1, 'al sortear');
  avisados.length = 0;
  sorteo.olvidar('u1');
  assert.strictEqual(avisados.length, 1, 'y al descartarlo');
});

test('el sorteo sobrevive a un reinicio', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const d = deps(c.raiz);

  let sorteo = cargar('sorteo', d);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, relleno: RELLENO, duracion: 0 });

  // El reinicio: el modulo se carga de nuevo, con la memoria en blanco.
  sorteo = cargar('sorteo', d);
  assert.strictEqual(sorteo.estado('u1'), null, 'antes de rehacer no hay nada');
  assert.strictEqual(sorteo.rehacer('u1'), true);
  const s = sorteo.estado('u1');
  assert.strictEqual(s.quien, 'Ana');
  assert.deepStrictEqual(s.cosas.map((x) => x.nombre), ['Espada', 'Escudo']);
});

test('lo de una cuenta no se cuela en otra', (t) => {
  const { sorteo } = montar(t);
  sorteo.guardar('u1', { quien: 'Ana', cosas: COSAS, duracion: 0 });
  assert.strictEqual(sorteo.estado('u2'), null);
  assert.strictEqual(sorteo.estado('u1').quien, 'Ana');
});
