// El bingo.
//
// Aqui se reparten premios y se descalifica a gente, asi que un fallo no es un
// dibujo raro: es alguien que se queda sin premio habiendo ganado, o alguien
// fuera de la partida sin haber hecho trampa. Lo que se comprueba:
//
//  - El carton es un carton de bingo de verdad: cada columna con lo suyo, sin
//    repetidos y con el hueco libre en el centro.
//  - Que se juega (linea, bingo o las dos) lo dicen dos casillas, no puntos.
//  - Se canta una cosa concreta: !linea o !bingo. Cantar a tiempo gana;
//    cantar lo que no se tiene descalifica; cantar tarde no gana pero tampoco
//    descalifica.
//  - Linea es cualquier fila o columna. Las diagonales no cuentan.
//  - El retraso del directo no castiga: quien completo con la penultima bola y
//    canta enseguida de salir la ultima, gana.
//  - Dos que completan con la misma bola ganan los dos.
//  - Los cartones se compran (canjeando puntos del canal): varios por persona
//    hasta un maximo, y si no se puede dar se dice por que, para devolver los
//    puntos.
//  - La partida sobrevive a un reinicio con sus cartones.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(raiz) {
  return cargar('bingo', deps(raiz));
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

// El (primer) carton de alguien, tal cual lo tiene el modulo (se puede retocar).
function cartonDe(bingo, uid, nombre, cual = 0) {
  return bingo.estado(uid).jugadores.find((j) => j.nombre === nombre).cartones[cual];
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
  assert.ok(bingo.apuntar(uid, 'ana'), 'la misma persona puede comprar otro');
  assert.strictEqual(bingo.estado(uid).jugadores.length, 1, 'y sigue siendo una persona');
  assert.strictEqual(bingo.estado(uid).jugadores[0].cartones.length, 2);
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

test('cantar linea a tiempo gana y pasa a jugarse el bingo', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));

  const canto = bingo.cantar(uid, 'ana', 'linea');
  assert.strictEqual(canto.que, 'linea');
  assert.strictEqual(bingo.estado(uid).fase, 'bingo');

  // Volver a escribirlo es celebrar, no cantar bingo en falso.
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea'), null);
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  bingo.cancelar(uid);
});

test('cantar sin tenerlo descalifica, y descalificado ya no gana', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');
  const fila = filaDeArriba(cartonDe(bingo, uid, 'Ana'));
  sacarBola(bingo, uid, fila[0]);

  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'falso');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, true);

  // Aunque luego complete, ya esta fuera.
  fila.slice(1).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea'), null);
  bingo.cancelar(uid);
});

test('cantar antes de la primera bola no descalifica a nadie', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  bingo.abrir('u1', '');
  bingo.apuntar('u1', 'Ana');
  assert.strictEqual(bingo.cantar('u1', 'Ana', 'linea'), null);
  assert.strictEqual(bingo.cantar('u1', 'Ana', 'bingo'), null);
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

  const canto = bingo.cantar(uid, 'Ana', 'linea', DESPUES());
  assert.strictEqual(canto.que, 'tarde');
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
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'linea');
  bingo.cancelar(uid);
});

test('dos que completan con la misma bola ganan los dos', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
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

  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'linea');
  assert.strictEqual(bingo.cantar(uid, 'Beto', 'linea').que, 'linea', 'el segundo tambien, aunque ya se juegue el bingo');
  bingo.cancelar(uid);
});

test('el bingo acaba la partida', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { jugarLinea: false, jugarBingo: true });
  bingo.abrir(uid, '');
  assert.strictEqual(bingo.estado(uid).fase, 'bingo', 'sin la casilla de la linea, directo al carton lleno');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  carton.flat().filter((n) => n !== bingo.LIBRE).forEach((n) => sacarBola(bingo, uid, n));

  const canto = bingo.cantar(uid, 'Ana', 'bingo');
  assert.strictEqual(canto.que, 'bingo');
  assert.strictEqual(bingo.estado(uid).fase, 'fin');
  assert.ok('error' in bingo.sacar(uid), 'acabada, no salen mas bolas');
  bingo.cancelar(uid);
});

// El premio de verdad (kamas o un objeto) va solo a Ganadores, en el servidor
// en el que se abrio la partida. Lo apunta el servidor al cantar, porque quien
// gana lo decide el chat y el panel puede no estar mirando.
function montarConPremios(raiz, apuntados, falla) {
  const d = deps(raiz);
  d.apuntarGanador = (ambito, nombre, premio, que) => {
    if (falla) throw new Error('disco lleno');
    apuntados.push({ ambito, nombre, premio, que });
    return true;
  };
  return cargar('bingo', d);
}

test('la linea y el bingo apuntan su premio en Ganadores del servidor de la partida', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const apuntados = [];
  const bingo = montarConPremios(c.raiz, apuntados);
  const uid = 'u1';
  bingo.guardarAjustes(uid, {
    premioLinea: { kamas: 500000, texto: '' },
    premioBingo: { kamas: 5000000, texto: 'Dofus Ocre' }
  });
  bingo.abrir(uid, '', undefined, 'u1/dofus/s1');

  // Cambiar el premio a mitad no cambia lo que ya se prometio.
  bingo.guardarAjustes(uid, { premioBingo: { kamas: 1, texto: '' } });

  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  filaDeArriba(carton).forEach((n) => sacarBola(bingo, uid, n));
  const linea = bingo.cantar(uid, 'Ana', 'linea');
  assert.strictEqual(linea.que, 'linea');
  assert.strictEqual(linea.apuntado, true);
  assert.deepStrictEqual(apuntados[0], {
    ambito: 'u1/dofus/s1', nombre: 'Ana', premio: { kamas: 500000, texto: '' }, que: 'linea'
  });

  const fuera = new Set(bingo.estado(uid).salidas);
  carton.flat().filter((n) => n !== bingo.LIBRE && !fuera.has(n)).forEach((n) => sacarBola(bingo, uid, n));
  const lleno = bingo.cantar(uid, 'Ana', 'bingo');
  assert.strictEqual(lleno.que, 'bingo');
  assert.deepStrictEqual(apuntados[1].premio, { kamas: 5000000, texto: 'Dofus Ocre' }, 'el premio de cuando se abrio');
  assert.strictEqual(apuntados.length, 2);
  bingo.cancelar(uid);
});

test('el premio es un objeto del catalogo, con su icono', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const apuntados = [];
  const bingo = montarConPremios(c.raiz, apuntados);
  const uid = 'u1';
  const a = bingo.guardarAjustes(uid, {
    premioBingo: { kamas: 0, texto: 'Dofus Ocre', imagen: 'https://api.dofusdu.de/img/ocre.png' }
  });
  assert.deepStrictEqual(a.premioBingo, { kamas: 0, texto: 'Dofus Ocre', imagen: 'https://api.dofusdu.de/img/ocre.png' });

  // Una direccion que no es una imagen de verdad no se guarda.
  const b = bingo.guardarAjustes(uid, { premioBingo: { kamas: 0, texto: 'X', imagen: 'javascript:alert(1)' } });
  assert.strictEqual(b.premioBingo.imagen, undefined);
  // Y quitar el objeto se lleva la imagen.
  const d = bingo.guardarAjustes(uid, { premioBingo: { kamas: 5, texto: '', imagen: 'https://x/y.png' } });
  assert.deepStrictEqual(d.premioBingo, { kamas: 5, texto: '' });

  bingo.guardarAjustes(uid, { jugarLinea: false, premioBingo: { kamas: 0, texto: 'Dofus Ocre', imagen: '/assets/ocre.png' } });
  bingo.abrir(uid, '', undefined, 'u1/dofus/s1');
  bingo.darCarton(uid, 'Ana');
  cartonDe(bingo, uid, 'Ana').flat().filter((n) => n !== bingo.LIBRE).forEach((n) => sacarBola(bingo, uid, n));
  bingo.cantar(uid, 'Ana', 'bingo');
  assert.deepStrictEqual(apuntados[0].premio, { kamas: 0, texto: 'Dofus Ocre', imagen: '/assets/ocre.png' }, 'a Ganadores, con su icono');
  bingo.cancelar(uid);
});

test('cantar en falso o tarde no apunta nada, y sin premio tampoco', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const apuntados = [];
  const bingo = montarConPremios(c.raiz, apuntados);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { premioLinea: { kamas: 0, texto: '' } });
  bingo.abrir(uid, '', undefined, 'u1/dofus/s1');
  bingo.apuntar(uid, 'Ana');
  bingo.apuntar(uid, 'Beto');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));
  const linea = bingo.cantar(uid, 'Ana', 'linea');
  assert.strictEqual(linea.que, 'linea');
  assert.strictEqual(linea.premio, undefined, 'la linea no tenia premio');
  assert.strictEqual(apuntados.length, 0);
  assert.strictEqual(bingo.cantar(uid, 'Beto', 'bingo').que, 'falso');
  assert.strictEqual(apuntados.length, 0, 'quien no lo tiene no se lleva nada');
  bingo.cancelar(uid);
});

test('si no se puede apuntar, el canto lo dice y la partida sigue', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montarConPremios(c.raiz, [], true);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { premioLinea: { kamas: 100, texto: '' } });
  bingo.abrir(uid, '', undefined, 'u1/dofus/s1');
  bingo.apuntar(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));
  const canto = bingo.cantar(uid, 'Ana', 'linea');
  assert.strictEqual(canto.que, 'linea', 'gana igual');
  assert.strictEqual(canto.apuntado, false, 'pero queda dicho que no se apunto');
  assert.strictEqual(bingo.estado(uid).fase, 'bingo');
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
  assert.deepStrictEqual(suyo.jugador.cartones, [cartonDe(bingo, uid, 'Ana')]);
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
  bingo.cantar(uid, 'Beto', 'linea');
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

// Un carton al que se le pone a mano lo que haga falta, para probar lineas
// concretas. Se cambian los numeros de las casillas que se piden por otros de
// su misma columna que no esten ya en el carton.
function conCasillas(carton, casillas) {
  return casillas.map(([c, f]) => carton[c][f]).filter((n) => n !== 0);
}

test('linea es cualquier fila o columna; la diagonal no cuenta', (t) => {
  const bingo = cargar('bingo');
  assert.strictEqual(bingo.LINEAS.length, 10, 'cinco filas y cinco columnas');
  const carton = bingo.cartonNuevo();
  const diagonal = [0, 1, 2, 3, 4].map((i) => [i, i]);
  const columna = [0, 1, 2, 3, 4].map((f) => [1, f]);
  const fila = [0, 1, 2, 3, 4].map((c) => [c, 3]);
  const con = (casillas) => bingo.faltan(carton, new Set(conCasillas(carton, casillas))).linea;
  assert.strictEqual(con(columna), 0, 'una columna es linea');
  assert.strictEqual(con(fila), 0, 'una fila es linea');
  assert.notStrictEqual(con(diagonal), 0, 'la diagonal no');
});

test('cantar linea con solo la diagonal descalifica', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  conCasillas(carton, [0, 1, 2, 3, 4].map((i) => [i, i])).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'falso');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, true);
  bingo.cancelar(uid);
});

test('cantar bingo con solo una linea es cantar en falso', (t) => {
  // Antes se miraba lo que tenia y se le daba la linea. Ahora se juzga lo que
  // canta: dijo bingo y no tiene el carton lleno.
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'bingo').que, 'falso');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, true);
  assert.ok(!bingo.estado(uid).cantos.some((x) => x.que === 'linea'), 'y no se lleva la linea por equivocarse de palabra');
  bingo.cancelar(uid);
});

test('cantar linea con el carton lleno vale: tiene linea', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  carton.flat().filter((n) => n !== bingo.LIBRE).forEach((n) => sacarBola(bingo, uid, n));
  // La ultima bola completa a la vez una fila y una columna nuevas: tiene una
  // linea a tiempo, aunque su primera linea fuera de hace muchas bolas.
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'linea');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'bingo').que, 'bingo');
  bingo.cancelar(uid);
});

test('cantar linea cuando la linea no se juega no hace nada', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { jugarLinea: false });
  bingo.abrir(uid, '');
  bingo.apuntar(uid, 'Ana');
  sacarBola(bingo, uid, cartonDe(bingo, uid, 'Ana')[0][0]);
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea'), null);
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  bingo.cancelar(uid);
});

test('cuando no se puede cantar, se dice por que', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  assert.match(bingo.porQueNoCanta(uid, 'Ana', 'linea'), /ninguna partida/);
  bingo.guardarAjustes(uid, { jugarLinea: false });
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  assert.match(bingo.porQueNoCanta(uid, 'Ana', 'linea'), /ninguna bola/);
  sacarBola(bingo, uid, cartonDe(bingo, uid, 'Ana')[0][0]);
  assert.match(bingo.porQueNoCanta(uid, 'Nadie', 'bingo'), /nadie con ese nombre/);
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea'), null);
  assert.match(bingo.porQueNoCanta(uid, 'Ana', 'linea'), /no se juega linea/,
    'la linea sin marcar: lo dice, en vez de un error que no explica nada');
  bingo.cancelar(uid);
});

test('solo la linea: la partida acaba en cuanto alguien la gana', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { jugarLinea: true, jugarBingo: false });
  bingo.abrir(uid, '');
  assert.strictEqual(bingo.estado(uid).fase, 'linea');
  bingo.darCarton(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'linea');
  assert.strictEqual(bingo.estado(uid).fase, 'fin', 'no se sigue con el carton lleno');
  assert.ok('error' in bingo.sacar(uid), 'acabada, no salen mas bolas');
  bingo.cancelar(uid);
});

test('solo el bingo: cantar linea no hace nada ni descalifica', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.guardarAjustes(uid, { jugarLinea: false, jugarBingo: true });
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  filaDeArriba(cartonDe(bingo, uid, 'Ana')).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea'), null);
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, false);
  bingo.cancelar(uid);
});

test('sin ninguna casilla no hay partida: se queda el carton lleno', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const a = bingo.guardarAjustes('u1', { jugarLinea: false, jugarBingo: false });
  assert.strictEqual(a.jugarBingo, true);
  assert.strictEqual(a.jugarLinea, false);
});

test('los ajustes de antes, con puntos, se leen como casillas', (t) => {
  // Antes la linea se jugaba si daba puntos o premio. Quien la tenia a 0 sin
  // premio no la jugaba, y tiene que seguir sin jugarla.
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(path.join(c.raiz, 'u1'), { recursive: true });
  fs.writeFileSync(path.join(c.raiz, 'u1', 'minijuegos.json'), JSON.stringify({ bingo: { puntosLinea: 0, puntosBingo: 50 } }));
  assert.strictEqual(bingo.leerAjustes('u1').jugarLinea, false);
  fs.writeFileSync(path.join(c.raiz, 'u1', 'minijuegos.json'), JSON.stringify({ bingo: { puntosLinea: 10 } }));
  assert.strictEqual(bingo.leerAjustes('u1').jugarLinea, true);
  fs.writeFileSync(path.join(c.raiz, 'u1', 'minijuegos.json'), JSON.stringify({ bingo: { puntosLinea: 0, premioLinea: { kamas: 100, texto: '' } } }));
  assert.strictEqual(bingo.leerAjustes('u1').jugarLinea, true, 'sin puntos pero con premio, se jugaba');
});

test('las palabras de linea y de bingo son distintas', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const a = bingo.guardarAjustes('u1', {});
  assert.strictEqual(a.cantarLinea, '!linea', 'por defecto, !linea');
  assert.strictEqual(a.cantar, '!bingo', 'y !bingo');
  const b = bingo.guardarAjustes('u1', { cantarLinea: '!BINGO' });
  assert.strictEqual(b.cantarLinea, '!linea', 'la misma que la de bingo no: se queda la de antes');
  const d = bingo.guardarAjustes('u1', { cantar: '!linea', cantarLinea: '!linea' });
  assert.notStrictEqual(d.cantar.toLowerCase(), d.cantarLinea.toLowerCase(), 'nunca iguales');
});

test('una linea vieja que se le paso no le quita la nueva', (t) => {
  // El fallo: se miraba solo la PRIMERA linea que completo. Si hizo una fila
  // hace bolas sin darse cuenta y ahora completa una columna con la ultima
  // bola, al cantar se le decia «tarde» aunque la columna fuera buena.
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  const carton = cartonDe(bingo, uid, 'Ana');
  // La fila de arriba entera...
  filaDeArriba(carton).forEach((n) => sacarBola(bingo, uid, n));
  // ...y unas cuantas bolas despues, sin cantar...
  const suyos = new Set(carton.flat());
  const ajenas = [];
  for (let n = 1; ajenas.length < 3; n++) if (!suyos.has(n)) ajenas.push(n);
  ajenas.forEach((n) => sacarBola(bingo, uid, n));
  // ...la columna B entera: la ultima bola es la que la completa.
  const columnaB = carton[0].filter((n) => !bingo.estado(uid).salidas.includes(n));
  columnaB.forEach((n) => sacarBola(bingo, uid, n));
  const canto = bingo.cantar(uid, 'Ana', 'linea', DESPUES());
  assert.strictEqual(canto.que, 'linea', 'la columna nueva es linea a tiempo');
  bingo.cancelar(uid);
});

test('el carton es de quien lo compro aunque en el chat salga con su login', (t) => {
  // La compra trae el nombre visible («Señor_X», o uno en otro alfabeto) y el
  // chat solo el login («senor_x»). Si no coinciden, cantar no hacia nada.
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.darCarton(uid, '사용자', 'usuario123');
  filaDeArriba(cartonDe(bingo, uid, '사용자')).forEach((n) => sacarBola(bingo, uid, n));
  const canto = bingo.cantar(uid, 'usuario123', 'linea');
  assert.ok(canto, 'el chat lo reconoce por su login');
  assert.strictEqual(canto.que, 'linea');
  assert.strictEqual(canto.nombre, '사용자', 'y se le anuncia con su nombre de verdad');
  assert.ok(bingo.cartonPublico(bingo.estado(uid).codigo, 'usuario123').jugador, 'la pagina lo encuentra por el login');
  assert.ok(bingo.cartonPublico(bingo.estado(uid).codigo, '사용자').jugador, 'y por el nombre');
  bingo.cancelar(uid);
});

test('cada canje es un carton mas, hasta el maximo; luego dice por que no', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  assert.deepStrictEqual(bingo.darCarton(uid, 'Ana'), { ok: false, motivo: 'no hay ninguna partida de bingo abierta' },
    'sin partida no se vende: se le devuelven los puntos');
  bingo.guardarAjustes(uid, { maxCartones: 2 });
  bingo.abrir(uid, '');
  assert.deepStrictEqual(bingo.darCarton(uid, 'Ana'), { ok: true, cartones: 1 });
  assert.deepStrictEqual(bingo.darCarton(uid, 'ANA'), { ok: true, cartones: 2 }, 'el nombre da igual como se escriba');
  const tercero = bingo.darCarton(uid, 'Ana');
  assert.strictEqual(tercero.ok, false);
  assert.match(tercero.motivo, /maximo de 2/);
  bingo.darCarton(uid, 'Beto');
  assert.strictEqual(bingo.estado(uid).cartones, 3, 'se cuentan cartones, no personas');
  // Con la primera bola se cierra la venta.
  bingo.sacar(uid);
  const tarde = bingo.darCarton(uid, 'Caro');
  assert.strictEqual(tarde.ok, false);
  assert.match(tarde.motivo, /cerrada/);
  bingo.cancelar(uid);
});

test('con varios cartones gana si alguno lo tiene', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  bingo.darCarton(uid, 'Ana');
  // La linea la hace el SEGUNDO carton.
  filaDeArriba(cartonDe(bingo, uid, 'Ana', 1)).forEach((n) => sacarBola(bingo, uid, n));
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'linea');
  bingo.cancelar(uid);
});

test('con varios cartones, si ninguno lo tiene, fuera con todos', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const bingo = montar(c.raiz);
  const uid = 'u1';
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  bingo.darCarton(uid, 'Ana');
  sacarBola(bingo, uid, cartonDe(bingo, uid, 'Ana')[0][0]);
  assert.strictEqual(bingo.cantar(uid, 'Ana', 'linea').que, 'falso');
  assert.strictEqual(bingo.estado(uid).jugadores[0].descalificado, true);
  bingo.cancelar(uid);
});

test('una partida guardada con un solo carton por persona se recupera', (t) => {
  // Las de antes de poder comprar varios guardaban «carton», no «cartones».
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';
  let bingo = montar(c.raiz);
  bingo.abrir(uid, '');
  bingo.darCarton(uid, 'Ana');
  const suyo = cartonDe(bingo, uid, 'Ana');
  const fs = require('fs');
  const path = require('path');
  const buscar = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? buscar(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const foto = buscar(c.raiz).find((f) => /bingo/.test(path.basename(f)));
  assert.ok(foto, 'hay foto de la partida en disco');
  const datos = JSON.parse(fs.readFileSync(foto, 'utf8'));
  datos.estado.jugadores = datos.estado.jugadores.map((j) => ({ nombre: j.nombre, clave: j.clave, carton: j.cartones[0], descalificado: false }));
  fs.writeFileSync(foto, JSON.stringify(datos));

  bingo = montar(c.raiz);
  assert.ok(bingo.rehacer(uid));
  assert.deepStrictEqual(cartonDe(bingo, uid, 'Ana'), suyo);
  bingo.cancelar(uid);
});
