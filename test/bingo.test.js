// El bingo.
//
// Aqui se reparten puntos y se descalifica a gente, asi que un fallo no es un
// dibujo raro: es alguien que se queda sin premio habiendo ganado, o alguien
// fuera de la partida sin haber hecho trampa. Lo que se comprueba:
//
//  - El carton es un carton de bingo de verdad: cada columna con lo suyo, sin
//    repetidos y con el hueco libre en el centro.
//  - Cantar a tiempo gana y suma; cantar sin tenerlo descalifica; cantar tarde
//    no gana pero tampoco descalifica.
//  - El retraso del directo no castiga: quien completo con la penultima bola y
//    canta enseguida de salir la ultima, gana.
//  - Dos que completan con la misma bola ganan los dos.
//  - La partida sobrevive a un reinicio con sus cartones.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(raiz, sumados) {
  const d = deps(raiz);
  d.sumarPuntos = (uid, nombre, cuantos) => {
    if (sumados) sumados.push({ nombre, cuantos });
    return cuantos;
  };
  return cargar('bingo', d);
}

// Saca justo la bola que se le pide, sin trucos en el modulo: se le da el azar
// que cae en esa bola de entre las que quedan.
function sacarBola(bingo, uid, n) {
  const fuera = new Set(bingo.estado(uid).salidas);
  const quedan = [];
  for (let i = 1; i <= 75; i++) if (!fuera.has(i)) quedan.push(i);
  const i = quedan.indexOf(n);
  assert.ok(i >= 0, 'la bola ' + n + ' sigue dentro');
  const r = bingo.sacar(uid, () => (i + 0.5) / quedan.length);
  assert.strictEqual(r.bola, n);
}

// El carton de alguien, tal cual lo tiene el modulo (se puede retocar).
function cartonDe(bingo, uid, nombre) {
  return bingo.estado(uid).jugadores.find((j) => j.nombre === nombre).carton;
}

// La fila de arriba de un carton: una linea sin el hueco libre.
function filaDeArriba(carton) {
  return [0, 1, 2, 3, 4].map((c) => carton[c][0]);
}

const DESPUES = () => Date.now() + 60 * 1000;

test('el carton es de bingo de 75: cada columna con lo suyo y el centro libre', () => {
  const bingo = cargar('bingo');
  for (let vez = 0; vez < 200; vez++) {
    const carton = bingo.cartonNuevo();
    assert.strictEqual(carton.length, 5);
    const vistos = new Set();
    carton.forEach((col, c) => {
      assert.strictEqual(col.length, 5);
      col.forEach((n, f) => {
        if (c === 2 && f === 2) { assert.strictEqual(n, bingo.LIBRE, 'el centro es libre'); return; }
        assert.ok(n >= c * 15 + 1 && n <= c * 15 + 15, `${n} va en la columna ${bingo.LETRAS[c]}`);
        assert.ok(!vistos.has(n), 'sin repetidos');
        vistos.add(n);
      });
    });
    assert.strictEqual(vistos.size, 24);
  }
});

test('la primera bola cierra la inscripcion', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  assert.ok(bingo.apuntar(uid, 'Ana'));
  assert.ok(!bingo.apuntar(uid, 'ana'), 'la misma persona no tiene dos cartones');
  bingo.sacar(uid);
  assert.strictEqual(bingo.estado(uid).abierta, false);
  assert.ok(!bingo.apuntar(uid, 'Beto'), 'con bolas fuera ya no se entra');
  bingo.cancelar(uid);
});

test('sin nadie con carton no se saca bola', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  bingo.abrir('u1', '');
  assert.ok('error' in bingo.sacar('u1'));
  bingo.cancelar('u1');
});

test('cantar linea a tiempo gana, suma y pasa a jugarse el bingo', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const bingo = montar(c.raiz, sumados);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { puntosLinea: 7, puntosBingo: 30 });
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));

  const canto = bingo.cantarBingo(uid, 'ana');
  assert.strictEqual(canto.que, 'linea');
  assert.strictEqual(canto.puntos, 7);
  assert.deepStrictEqual(sumados, [{ nombre: 'Ana', cuantos: 7 }]);
  assert.strictEqual(bingo.estado(uid).fase, 'bingo');

  // Volver a escribirlo es celebrar, no cantar bingo en falso.
  assert.strictEqual(bingo.cantarBingo(uid, 'Ana'), null);
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  bingo.cancelar(uid);
});

test('cantar sin tenerlo descalifica, y descalificado ya no gana', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const bingo = montar(c.raiz, sumados);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');
  const fila = filaDeArriba(cartonDe(bingo, uid, 'Ana'));
  sacarBola(bingo, uid, fila[0]);

  assert.strictEqual(bingo.cantarBingo(uid, 'Ana').que, 'falso');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, true);

  // Aunque luego complete, ya esta fuera.
  fila.slice(1).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantarBingo(uid, 'Ana'), null);
  assert.deepStrictEqual(sumados, []);
  bingo.cancelar(uid);
});

test('cantar antes de la primera bola no descalifica a nadie', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  bingo.abrir('u1', '');
  bingo.apuntar('u1', 'Ana');
  assert.strictEqual(bingo.cantarBingo('u1', 'Ana'), null);
  assert.strictEqual(bingo.estado('u1').jugadores[0].descalificado, false);
  bingo.cancelar('u1');
});

test('quien canta tarde no gana, pero no se le descalifica', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  filaDeArriba(carton).forEach((n) => sacarBola(bingo, uid, n));
  // Sale otra que no tiene, y pasa la gracia.
  const suyos = new Set(carton.flat());
  let otra = 1;
  while (suyos.has(otra) || bingo.estado(uid).salidas.includes(otra)) otra++;
  sacarBola(bingo, uid, otra);

  const canto = bingo.cantarBingo(uid, 'Ana', DESPUES());
  assert.strictEqual(canto.que, 'tarde');
  assert.strictEqual(canto.puntos, 0);
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  assert.strictEqual(bingo.estado(uid).fase, 'linea', 'la linea sigue en juego');
  bingo.cancelar(uid);
});

test('el retraso del directo no castiga: con la penultima y enseguida, gana', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  filaDeArriba(carton).forEach((n) => sacarBola(bingo, uid, n));
  const suyos = new Set(carton.flat());
  let otra = 1;
  while (suyos.has(otra) || bingo.estado(uid).salidas.includes(otra)) otra++;
  sacarBola(bingo, uid, otra);

  // Ahora mismo: la ultima acaba de salir.
  assert.strictEqual(bingo.cantarBingo(uid, 'Ana').que, 'linea');
  bingo.cancelar(uid);
});

test('dos que completan con la misma bola ganan los dos', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const bingo = montar(c.raiz, sumados);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { puntosLinea: 5 });
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');
  const deAna = cartonDe(bingo, uid, 'Ana');
  const deBeto = cartonDe(bingo, uid, 'Beto');
  // Beto con la misma fila de arriba que Ana. El resto de su carton no puede
  // repetir esos numeros, asi que se le cambian por los que sobren.
  for (let col = 0; col < 5; col++) {
    const libres = [];
    for (let n = col * 15 + 1; n <= col * 15 + 15; n++) if (n !== deAna[col][0]) libres.push(n);
    deBeto[col][0] = deAna[col][0];
    for (let f = 1; f < 5; f++) if (!(col === 2 && f === 2)) deBeto[col][f] = libres[f];
  }
  filaDeArriba(deAna).forEach((n) => sacarBola(bingo, uid, n));

  assert.strictEqual(bingo.cantarBingo(uid, 'Ana').que, 'linea');
  assert.strictEqual(bingo.cantarBingo(uid, 'Beto').que, 'linea', 'el segundo no se juzga ya por bingo');
  assert.deepStrictEqual(sumados.map((s) => s.nombre), ['Ana', 'Beto']);
  bingo.cancelar(uid);
});

test('el bingo acaba la partida', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const bingo = montar(c.raiz, sumados);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { puntosLinea: 0, puntosBingo: 40 });
  bingo.abrir(uid, '');
  assert.strictEqual(bingo.estado(uid).fase, 'bingo', 'con la linea a 0 no se juega linea');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  carton.flat().filter((n) => n !== bingo.LIBRE).forEach((n) => sacarBola(bingo, uid, n));

  const canto = bingo.cantarBingo(uid, 'Ana');
  assert.strictEqual(canto.que, 'bingo');
  assert.deepStrictEqual(sumados, [{ nombre: 'Ana', cuantos: 40 }]);
  assert.strictEqual(bingo.estado(uid).fase, 'fin');
  assert.ok('error' in bingo.sacar(uid), 'acabada, no salen mas bolas');
  bingo.cancelar(uid);
});

test('la pagina publica solo ensena el carton que se pide', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  const p = bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');

  assert.strictEqual(bingo.cartonPublico('NOEXISTE', 'Ana'), null);
  const suyo = bingo.cartonPublico(p.codigo.toLowerCase(), 'ANA');
  assert.strictEqual(suyo.jugador.nombre, 'Ana');
  assert.deepStrictEqual(suyo.jugador.carton, cartonDe(bingo, uid, 'Ana'));
  assert.ok(!JSON.stringify(suyo).includes('Beto'), 'nada de los demas');
  assert.strictEqual(bingo.cartonPublico(p.codigo, 'Nadie').jugador, null);
  bingo.cancelar(uid);
  assert.strictEqual(bingo.cartonPublico(p.codigo, 'Ana'), null, 'cancelada, el codigo deja de valer');
});

test('la partida sobrevive a un reinicio con sus cartones y sus bolas', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';
  let bingo = montar(c.raiz);
  const p = bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');
  bingo.sacar(uid);
  bingo.cantarBingo(uid, 'Beto');
  const antes = bingo.estado(uid);

  bingo = montar(c.raiz);   // reinicio
  assert.ok(bingo.rehacer(uid));
  const despues = bingo.estado(uid);
  assert.strictEqual(despues.codigo, p.codigo);
  assert.deepStrictEqual(despues.salidas, antes.salidas);
  assert.deepStrictEqual(despues.jugadores, antes.jugadores);
  assert.deepStrictEqual(despues.cantos, antes.cantos);
  bingo.cancelar(uid);
});

test('pedir carton y cantar no pueden ser la misma palabra', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const a = bingo.guardarAjustes('u1', { palabra: '!bingo' });
  assert.notStrictEqual(a.cantar.toLowerCase(), a.palabra.toLowerCase());
  const b = bingo.guardarAjustes('u1', { palabra: '!yo', cantar: '!YO' });
  assert.notStrictEqual(b.cantar.toLowerCase(), b.palabra.toLowerCase());
});
