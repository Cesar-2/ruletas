// El reparto del tablero de clavijas.
//
// Aqui se reparten puntos y premios de verdad, asi que un fallo no es un dibujo
// raro: es alguien que se lleva lo que no le toca, o que no se lleva lo que si.
// Lo que se comprueba es lo que no puede fallar nunca:
//
//  - Una bola por persona, ni una mas.
//  - La bola cae DENTRO del tablero. Una casilla fuera de rango daria un
//    multiplicador undefined y de ahi salen los NaN.
//  - Los puntos son los de la casilla en la que cayo, no otros.
//  - Con premios el marcador no se toca, y lo que toco se congela con la ronda:
//    cambiar un premio despues no cambia lo que se sorteo aquel dia.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(raiz, sumados) {
  const d = deps(raiz);
  d.sumarPuntos = (uid, nombre, cuantos) => {
    if (sumados) sumados.push({ nombre, cuantos });
    return cuantos;
  };
  return cargar('plinko', d);
}

const GENTE = ['Ana', 'Beto', 'Caro', 'Dani', 'Eva'];

test('una bola por persona y todas caen dentro del tablero', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const plinko = montar(c.raiz);
  const uid = 'u1';

  plinko.abrir(uid, '', '!tirar');
  GENTE.forEach((n) => plinko.apuntar(uid, n));
  const p = plinko.tirar(uid);

  assert.strictEqual(p.tiradas.length, GENTE.length, 'una tirada por cabeza');
  assert.deepStrictEqual(p.tiradas.map((x) => x.nombre), GENTE, 'y en su orden');

  const casillas = plinko.casillasDe(p.tablero.filas);
  for (const tirada of p.tiradas) {
    assert.ok(Number.isInteger(tirada.casilla), 'la casilla es un entero');
    assert.ok(tirada.casilla >= 0 && tirada.casilla < casillas,
      `la casilla ${tirada.casilla} cae dentro de las ${casillas} que hay`);
    assert.ok(Number.isFinite(tirada.multiplicador), 'el multiplicador no es NaN');
    assert.ok(Number.isFinite(tirada.puntos), 'los puntos no son NaN');
    assert.ok(tirada.recorrido.length > 0, 'la bola deja su recorrido para animarla');
  }
});

test('los puntos son los de la casilla en la que cayo cada uno', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const plinko = montar(c.raiz, sumados);
  const uid = 'u1';

  const ajustes = plinko.guardarAjustes(uid, { puntos: 10, modo: 'puntos' });
  plinko.abrir(uid, '', '!tirar');
  GENTE.forEach((n) => plinko.apuntar(uid, n));
  const p = plinko.tirar(uid);

  for (const tirada of p.tiradas) {
    assert.strictEqual(
      tirada.puntos,
      Math.floor(ajustes.puntos * tirada.multiplicador),
      `${tirada.nombre} se lleva lo de su casilla`
    );
    // El multiplicador guardado en la tirada es el de su casilla, no el de otra.
    assert.strictEqual(tirada.multiplicador, p.multiplicadores[tirada.casilla]);
  }

  // Y al marcador se le suma exactamente lo de las tiradas que dieron algo.
  const conPuntos = p.tiradas.filter((x) => x.puntos > 0);
  assert.strictEqual(sumados.length, conPuntos.length,
    'no se suma a quien saco cero, ni se suma dos veces');
  for (const s of sumados) {
    const suya = p.tiradas.find((x) => x.nombre === s.nombre);
    assert.strictEqual(s.cuantos, suya.puntos);
  }
});

test('con premios el marcador no se toca y a cada uno le toca el de su casilla', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const plinko = montar(c.raiz, sumados);
  const uid = 'u1';

  const casillas = plinko.casillasDe(plinko.leerAjustes(uid).filas);
  const premios = [];
  for (let i = 0; i < casillas; i++) premios.push({ nombre: 'Premio ' + i, imagen: '' });
  plinko.guardarAjustes(uid, { puntos: 10, modo: 'premios', premios });

  plinko.abrir(uid, '', '!tirar');
  GENTE.forEach((n) => plinko.apuntar(uid, n));
  const p = plinko.tirar(uid);

  assert.deepStrictEqual(sumados, [], 'con premios el marcador no se toca');
  for (const tirada of p.tiradas) {
    assert.strictEqual(tirada.puntos, 0);
    assert.ok(tirada.premio, 'la tirada dice lo que toco');
    assert.strictEqual(tirada.premio.nombre, 'Premio ' + tirada.casilla,
      'y es el de la casilla en la que cayo');
  }
});

test('cambiar un premio despues no cambia lo que ya se sorteo', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const plinko = montar(c.raiz);
  const uid = 'u1';

  const casillas = plinko.casillasDe(plinko.leerAjustes(uid).filas);
  const premios = [];
  for (let i = 0; i < casillas; i++) premios.push({ nombre: 'Antes ' + i, imagen: '' });
  plinko.guardarAjustes(uid, { modo: 'premios', premios });

  plinko.abrir(uid, '', '!tirar');
  plinko.apuntar(uid, 'Ana');
  const p = plinko.tirar(uid);
  const toco = p.tiradas[0].premio.nombre;
  assert.ok(toco.startsWith('Antes '));

  // Se cambian todos los premios despues de haber tirado.
  const otros = [];
  for (let i = 0; i < casillas; i++) otros.push({ nombre: 'Despues ' + i, imagen: '' });
  plinko.guardarAjustes(uid, { premios: otros });

  assert.strictEqual(plinko.estado(uid).tiradas[0].premio.nombre, toco,
    'lo que toco aquel dia sigue diciendo lo que toco de verdad');
});

test('no se tira dos veces la misma ronda', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sumados = [];
  const plinko = montar(c.raiz, sumados);
  const uid = 'u1';

  plinko.guardarAjustes(uid, { puntos: 10, modo: 'puntos' });
  plinko.abrir(uid, '', '!tirar');
  GENTE.forEach((n) => plinko.apuntar(uid, n));
  plinko.tirar(uid);
  const cuantosSumaron = sumados.length;

  assert.strictEqual(plinko.tirar(uid), null, 'la segunda vez no hace nada');
  assert.strictEqual(sumados.length, cuantosSumaron, 'y no reparte otra vez');
});

test('sin nadie apuntado no se tira', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const plinko = montar(c.raiz);
  const uid = 'u1';

  plinko.abrir(uid, '', '!tirar');
  assert.strictEqual(plinko.tirar(uid), null);
  plinko.cancelar(uid);
});

test('no se apunta dos veces a la misma persona, escriba como escriba', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const plinko = montar(c.raiz);
  const uid = 'u1';

  plinko.abrir(uid, '', '!tirar');
  assert.strictEqual(plinko.apuntar(uid, 'Ana'), true);
  assert.strictEqual(plinko.apuntar(uid, 'ANA'), false, 'da igual como lo escriba');
  assert.strictEqual(plinko.apuntar(uid, '  Ana  '), false, 'ni con espacios');
  assert.strictEqual(plinko.apuntar(uid, ''), false, 'ni sin nombre');
  assert.strictEqual(plinko.estado(uid).jugadores.length, 1);
  plinko.cancelar(uid);
});

test('la bola siempre acaba en una casilla, tirando muchas', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const plinko = montar(c.raiz);

  // Sin pasar por una partida: solo la fisica, muchas veces, para que no cuele
  // una casilla fuera de rango una vez entre mil.
  const ajustes = plinko.leerAjustes('u1');
  const tablero = { ...plinko.estado('u1').tablero, filas: ajustes.filas };
  const casillas = plinko.casillasDe(tablero.filas);
  const salieron = new Set();

  for (let i = 0; i < 400; i++) {
    const caida = plinko.tirarBola(tablero, plinko.estado('u1').fisica);
    assert.ok(caida.casilla >= 0 && caida.casilla < casillas,
      `tirada ${i}: la casilla ${caida.casilla} cae dentro de ${casillas}`);
    salieron.add(caida.casilla);
  }
  assert.ok(salieron.size > 1, 'y no caen todas en la misma, que seria un tablero roto');
});
