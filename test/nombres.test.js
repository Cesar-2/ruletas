// El sorteo de la ruleta de nombres.
//
// A esta ruleta la gira la PAGINA, no el servidor: la lista de nombres vive en su
// cuadro de texto, asi que el servidor no conoce a los participantes y no puede
// elegir. Lo que hace es guardar lo que la pagina dice que ha salido, para que el
// widget de OBS pueda contarlo. Es un espejo, no un arbitro.
//
// Dos cosas que si se rompen se ven en el directo:
//
//  - Mientras la ruleta gira, el servidor NO puede decir quien ha salido. Si lo
//    dijera, cualquiera con la direccion del widget veria el resultado antes que
//    la gente que esta mirando el stream.
//  - Los dos modos no son simetricos. Normalmente el de la banda gana, pero
//    eliminando el de la banda SE VA y gana quien aguanta hasta quedarse solo.
//    Confundirlos pone en el cartel justo lo contrario de lo que ha pasado.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, minijuegos } = require('./ayuda');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('sin sorteos, no hay sorteo que contar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  assert.strictEqual(minijuegos(c.raiz).nombres.estado('u1').sorteo, null);
});

test('mientras gira NO se dice quien ha salido', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, { cuantos: 5, quien: 'Ana', ganador: 'Ana', quedan: 4, duracion: 5000 });
  const s = nombres.estado(uid).sorteo;

  assert.strictEqual(s.girando, true);
  assert.strictEqual(s.quien, '', 'no se suelta quien ha parado en la banda');
  assert.strictEqual(s.ganador, '', 'ni quien gana');
  assert.strictEqual(s.cuantos, 5, 'lo que si se puede decir es cuantos jugaban');
  assert.ok(s.terminaEn > Date.now(), 'y cuando va a parar');
});

test('al parar se dice, y sin tener que preguntar dos veces', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, { cuantos: 3, quien: 'Ana', ganador: 'Ana', quedan: 2, duracion: 60 });
  assert.strictEqual(nombres.estado(uid).sorteo.quien, '', 'todavia gira');

  await espera(150);
  const s = nombres.estado(uid).sorteo;
  assert.strictEqual(s.girando, false);
  assert.strictEqual(s.quien, 'Ana');
  assert.strictEqual(s.ganador, 'Ana');
});

test('modo normal: el de la banda gana', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, { cuantos: 4, quien: 'Ana', seVa: false, ganador: 'Ana', quedan: 3, duracion: 0 });
  const s = nombres.estado(uid).sorteo;
  assert.strictEqual(s.seVa, false);
  assert.strictEqual(s.quien, 'Ana');
  assert.strictEqual(s.ganador, 'Ana');
});

test('eliminando y con gente de sobra: el de la banda se va y nadie gana todavia', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, { cuantos: 4, quien: 'Ana', seVa: true, ganador: '', quedan: 3, duracion: 0 });
  const s = nombres.estado(uid).sorteo;
  assert.strictEqual(s.seVa, true);
  assert.strictEqual(s.quien, 'Ana', 'el de la banda');
  assert.strictEqual(s.ganador, '', 'la cosa sigue: aqui no gana nadie');
  assert.strictEqual(s.quedan, 3);
});

test('eliminando y quedando uno: gana el que QUEDA, no el de la banda', (t) => {
  // Este es el que importa. El de la banda es el que se va; el que gana es el
  // otro. Darlo por hecho pondria en el cartel que ha ganado el eliminado.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, { cuantos: 2, quien: 'Ana', seVa: true, ganador: 'Beto', quedan: 1, duracion: 0 });
  const s = nombres.estado(uid).sorteo;
  assert.strictEqual(s.quien, 'Ana', 'Ana es la que se va');
  assert.strictEqual(s.ganador, 'Beto', 'y gana Beto, que es el que queda');
  assert.notStrictEqual(s.ganador, s.quien, 'no son el mismo');
});

test('sin nombre no hay sorteo que guardar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  assert.strictEqual(nombres.guardarSorteo(uid, { cuantos: 3 }), null);
  assert.strictEqual(nombres.guardarSorteo(uid, { quien: '   ' }), null);
  assert.strictEqual(nombres.guardarSorteo(uid, null), null);
  assert.strictEqual(nombres.estado(uid).sorteo, null);
});

test('una duracion absurda no deja el cartel sin salir nunca', (t) => {
  // Si se colara una duracion enorme, el widget se quedaria en «girando» para
  // siempre y el cartel no saldria jamas. Peor que no tener cartel.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  const s = nombres.guardarSorteo(uid, { quien: 'Ana', duracion: 99999999 });
  assert.ok(s.terminaEn - Date.now() <= 30000, 'gira treinta segundos como mucho');

  nombres.guardarSorteo(uid, { quien: 'Ana', duracion: -5 });
  assert.strictEqual(nombres.estado(uid).sorteo.girando, false, 'y una negativa no gira');
});

test('el sorteo sobrevive a un reinicio: el cartel sigue puesto', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.nombres.abrir(uid, '', '!ruleta');
  ['Ana', 'Beto'].forEach((n) => j.nombres.apuntar(uid, n));
  j.nombres.guardarSorteo(uid, { cuantos: 2, quien: 'Ana', ganador: 'Ana', quedan: 1, duracion: 0 });
  j.nombres.cerrar(uid);

  // El reinicio: los modulos se cargan de nuevo con la memoria en blanco.
  j = minijuegos(c.raiz);
  assert.strictEqual(j.nombres.rehacer(uid), true);
  const s = j.nombres.estado(uid).sorteo;
  assert.ok(s, 'el sorteo vuelve');
  assert.strictEqual(s.quien, 'Ana');
  assert.strictEqual(s.ganador, 'Ana');
  assert.strictEqual(s.cuantos, 2);
});

test('vaciar la lista no se lleva el cartel del ganador', (t) => {
  // La pagina vacia la lista en cuanto se lleva los nombres a su cuadro de
  // texto, y eso pasa justo despues de girar. Si el sorteo se fuera con ella, el
  // widget se quedaria en blanco en el momento que mas se esta mirando.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.abrir(uid, '', '!ruleta');
  nombres.apuntar(uid, 'Ana');
  nombres.guardarSorteo(uid, { cuantos: 1, quien: 'Ana', ganador: 'Ana', quedan: 0, duracion: 0 });

  nombres.vaciar(uid);
  assert.deepStrictEqual(nombres.estado(uid).nombres, [], 'la lista si se va');
  assert.strictEqual(nombres.estado(uid).sorteo.quien, 'Ana', 'el cartel se queda');
  nombres.cerrar(uid);
});

test('un sorteo de hace media hora deja de salir', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.nombres.abrir(uid, '', '!ruleta');
  j.nombres.guardarSorteo(uid, { cuantos: 2, quien: 'Ana', ganador: 'Ana', duracion: 0 });
  j.nombres.cerrar(uid);

  // Se le envejece la foto: lo que se quiere en pantalla es el sorteo de ahora,
  // no el de hace media hora.
  const f = path.join(c.raiz, uid, 'vivo-nombres.json');
  const foto = JSON.parse(fs.readFileSync(f, 'utf8'));
  foto.estado.sorteo.cuando = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  foto.guardadoEn = Date.now();
  fs.writeFileSync(f, JSON.stringify(foto, null, 2));

  j = minijuegos(c.raiz);
  j.nombres.rehacer(uid);
  assert.strictEqual(j.nombres.estado(uid).sorteo, null, 'ya no sale');
});

test('el sorteo lleva la lista y el sitio, para poder pintar la cinta', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, {
    cuantos: 3, quien: 'Beto', ganador: 'Beto', quedan: 2, duracion: 0,
    nombres: ['Ana', 'Beto', 'Caro'], elegido: 1
  });
  const s = nombres.estado(uid).sorteo;
  assert.deepStrictEqual(s.nombres, ['Ana', 'Beto', 'Caro']);
  assert.strictEqual(s.elegido, 1);
  assert.strictEqual(s.nombres[s.elegido], 'Beto', 'el sitio apunta al que salio');
});

test('un sitio que no cuadra con la lista se arregla por nombre', (t) => {
  // Si el sitio cayera fuera, la cinta pararia en un hueco vacio y no se veria
  // ningun nombre en la banda: peor que no animar.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  for (const malo of [99, -1, 'x', null, undefined, 1.5]) {
    nombres.guardarSorteo(uid, {
      quien: 'Caro', duracion: 0, nombres: ['Ana', 'Beto', 'Caro'], elegido: malo
    });
    const s = nombres.estado(uid).sorteo;
    assert.ok(s.elegido >= 0 && s.elegido < 3, 'cae dentro de la lista: ' + malo);
    assert.strictEqual(s.nombres[s.elegido], 'Caro',
      'y apunta al que salio, buscandolo por nombre: ' + malo);
  }

  // Y si el nombre tampoco esta, al menos apunta a una fila que existe.
  nombres.guardarSorteo(uid, {
    quien: 'Zoe', duracion: 0, nombres: ['Ana', 'Beto'], elegido: 77
  });
  assert.strictEqual(nombres.estado(uid).sorteo.elegido, 0);
});

test('la lista del sorteo se limpia como los apuntados', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarSorteo(uid, {
    quien: 'Ana', duracion: 0,
    nombres: ['Ana', '', '   ', null, 42, { x: 1 }, 'B'.repeat(80), '  Caro  '],
    elegido: 0
  });
  const l = nombres.estado(uid).sorteo.nombres;
  assert.deepStrictEqual(l, ['Ana', 'B'.repeat(40), 'Caro'],
    'fuera lo vacio y lo que no es texto, y recortado a 40');
});

// --- El doble o nada --------------------------------------------------------
//
// El que ha ganado se juega el premio. Como el sorteo, lo tira la pagina; el
// servidor solo guarda lo que ha salido para que el widget ensene el mismo video
// y el mismo cartel.
//
// Aqui NO se calla el resultado, al contrario que en el sorteo, y es a proposito:
// el video ya lo dice, porque ganar.mp4 y perder.mp4 son dos archivos distintos.
// Callarlo y a la vez decir que video poner seria absurdo.

test('sin doble o nada, no hay doble que contar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  assert.strictEqual(minijuegos(c.raiz).nombres.estado('u1').doble, null);
});

test('el doble o nada se guarda con su resultado y su premio', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarDoble(uid, { quien: 'Ana', gana: true, premio: 4 });
  const d = nombres.estado(uid).doble;
  assert.strictEqual(d.quien, 'Ana');
  assert.strictEqual(d.gana, true);
  assert.strictEqual(d.premio, 4, 'por cuanto queda multiplicado');
  assert.ok(d.terminaEn > Date.now(), 'y hasta cuando se da por hecho que suena');
});

test('perder deja el premio en cero', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  nombres.guardarDoble('u1', { quien: 'Ana', gana: false, premio: 0 });
  const d = nombres.estado('u1').doble;
  assert.strictEqual(d.gana, false);
  assert.strictEqual(d.premio, 0);
});

test('sin nombre no hay doble que guardar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  assert.strictEqual(nombres.guardarDoble('u1', { gana: true, premio: 2 }), null);
  assert.strictEqual(nombres.guardarDoble('u1', { quien: '  ' }), null);
  assert.strictEqual(nombres.guardarDoble('u1', null), null);
  assert.strictEqual(nombres.estado('u1').doble, null);
});

test('girar otra vez cierra el doble o nada de antes', (t) => {
  // El premio de aquel ya no esta en pantalla: si se quedara, el widget pondria
  // «Premio x4» debajo de un sorteo nuevo.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  nombres.guardarDoble(uid, { quien: 'Ana', gana: true, premio: 4 });
  assert.ok(nombres.estado(uid).doble);

  nombres.guardarSorteo(uid, { quien: 'Beto', ganador: 'Beto', cuantos: 2, duracion: 0 });
  assert.strictEqual(nombres.estado(uid).doble, null, 'el doble de antes se va');
});

test('un doble o nada al que se le paso el seguro deja de salir', (t) => {
  // El video es del dueno y esto no sabe lo que dura. Si no existe o se atasca, el
  // seguro evita que el widget se quede tapado para siempre.
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  const uid = 'u1';

  const d = nombres.guardarDoble(uid, { quien: 'Ana', gana: true, premio: 2 });
  assert.ok(nombres.estado(uid).doble);
  // Se le adelanta el seguro, para no esperar quince segundos en un test.
  d.terminaEn = Date.now() - 1;
  assert.strictEqual(nombres.estado(uid).doble, null);
});

test('cada doble o nada avisa, para que el widget lo enseñe al momento', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const avisados = [];
  const { nombres } = minijuegos(c.raiz, avisados);
  avisados.length = 0;
  nombres.guardarDoble('u1', { quien: 'Ana', gana: true, premio: 2 });
  assert.strictEqual(avisados.length, 1);
});

test('un premio absurdo se recorta', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { nombres } = minijuegos(c.raiz);
  nombres.guardarDoble('u1', { quien: 'Ana', gana: true, premio: 1e12 });
  assert.ok(nombres.estado('u1').doble.premio <= 1000000);
  nombres.guardarDoble('u1', { quien: 'Ana', gana: true, premio: -5 });
  assert.strictEqual(nombres.estado('u1').doble.premio, 0);
});
