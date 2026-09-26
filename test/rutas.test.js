// Las direcciones de la pagina.
//
// Se prueba la traduccion (direccion <-> seccion), que es donde estan los casos
// raros. Lo que NO se prueba aqui es el cableado con el DOM (el vigia de las
// clases y el pulsar los botones): eso necesita un navegador, y meter uno solo
// para esto seria cambiar «cero dependencias» por un test de un archivo.
//
// Lo importante de estas direcciones es que se pegan en un mensaje para que otro
// las abra. Asi que lo que no puede pasar es que una direccion que alguien tiene
// guardada deje de llevar a ningun sitio.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// El archivo del navegador, tal cual. Se apunta en globalThis, asi que cargarlo
// deja Rutas puesto.
require(path.join(__dirname, '..', 'public', 'js', 'rutas.js'));
const Rutas = globalThis.Rutas;

const JUEGOS = ['ruleta', 'carrera', 'batalla', 'plinko', 'colina'];
const hay = (j) => JUEGOS.includes(j);
const leer = (hash) => Rutas.estadoDe(hash, hay);

test('sin direccion se cae donde se caia antes', () => {
  assert.deepStrictEqual(leer(''), { seccion: 'games', juego: 'ruleta' });
  assert.deepStrictEqual(leer('#'), { seccion: 'games', juego: 'ruleta' });
  assert.deepStrictEqual(leer(null), { seccion: 'games', juego: 'ruleta' });
});

test('cada seccion tiene su direccion', () => {
  assert.strictEqual(leer('#puntos').seccion, 'puntos');
  assert.strictEqual(leer('#ganadores').seccion, 'winners');
  assert.strictEqual(leer('#historial').seccion, 'history');
  assert.strictEqual(leer('#estadisticas').seccion, 'uso');
  assert.strictEqual(leer('#configuracion').seccion, 'config');
  assert.strictEqual(leer('#minijuegos').seccion, 'games');
});

test('el minijuego va detras de la barra', () => {
  for (const j of JUEGOS) {
    assert.deepStrictEqual(leer('#minijuegos/' + j), { seccion: 'games', juego: j });
  }
});

test('da igual como se escriba: mayusculas y la barra de delante', () => {
  assert.deepStrictEqual(leer('#MiniJuegos/PLINKO'), { seccion: 'games', juego: 'plinko' });
  assert.deepStrictEqual(leer('#/historial'), { seccion: 'history', juego: 'ruleta' });
  assert.deepStrictEqual(leer('#PUNTOS'), { seccion: 'puntos', juego: 'ruleta' });
});

test('una direccion que no existe se dice que no existe', () => {
  // null es «esta no la conozco»: quien llama se cae al sitio de siempre y
  // arregla la barra de direcciones. Eso es distinto de una direccion valida.
  assert.strictEqual(leer('#inventada'), null);
  assert.strictEqual(leer('#games'), null, 'el nombre de dentro no vale como direccion');
  assert.strictEqual(leer('#winners'), null);
  assert.strictEqual(leer('#minijuegos.plinko'), null);
});

test('un minijuego que no existe lleva a Minijuegos, no a un error', () => {
  // Es a proposito: si algun dia se quita un minijuego, el enlace que alguien
  // tenga guardado sigue llevando a algun sitio.
  assert.deepStrictEqual(leer('#minijuegos/nose'), { seccion: 'games', juego: 'ruleta' });
  assert.deepStrictEqual(leer('#minijuegos/'), { seccion: 'games', juego: 'ruleta' });
});

test('el sub solo cuenta en Minijuegos', () => {
  // '#puntos/loquesea' no es media direccion rota: es Puntos.
  assert.strictEqual(leer('#puntos/plinko').seccion, 'puntos');
  assert.strictEqual(leer('#historial/plinko').seccion, 'history');
});

test('escribir la direccion de una seccion', () => {
  assert.strictEqual(Rutas.direccionDe({ seccion: 'puntos' }), '#puntos');
  assert.strictEqual(Rutas.direccionDe({ seccion: 'uso' }), '#estadisticas');
  assert.strictEqual(Rutas.direccionDe({ seccion: 'config' }), '#configuracion');
});

test('el minijuego de siempre no se escribe en la direccion', () => {
  // '#minijuegos' ya es la ruleta: escribir '#minijuegos/ruleta' seria decir dos
  // veces lo mismo y ensuciar la barra al arrancar.
  assert.strictEqual(Rutas.direccionDe({ seccion: 'games', juego: 'ruleta' }), '#minijuegos');
  assert.strictEqual(Rutas.direccionDe({ seccion: 'games', juego: 'plinko' }), '#minijuegos/plinko');
});

test('una seccion que no existe no se escribe', () => {
  assert.strictEqual(Rutas.direccionDe({ seccion: 'nose' }), '');
  assert.strictEqual(Rutas.direccionDe(null), '');
  assert.strictEqual(Rutas.direccionDe({}), '');
});

test('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
  const estados = [
    { seccion: 'games', juego: 'ruleta' },
    { seccion: 'games', juego: 'plinko' },
    { seccion: 'games', juego: 'colina' },
    { seccion: 'puntos', juego: 'ruleta' },
    { seccion: 'winners', juego: 'ruleta' },
    { seccion: 'history', juego: 'ruleta' },
    { seccion: 'uso', juego: 'ruleta' },
    { seccion: 'config', juego: 'ruleta' }
  ];
  for (const e of estados) {
    assert.deepStrictEqual(leer(Rutas.direccionDe(e)), e, JSON.stringify(e));
  }
});

// Estos dos leen el index.html de verdad. No es un test de DOM: es comprobar
// que el router y la pagina hablan de las mismas secciones. Es el fallo mas
// probable a futuro, porque anadir una pestaña y darle nombre aqui son dos sitios
// distintos y nada obliga a tocar los dos.
const fs = require('fs');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('todas las pestañas del index.html tienen su direccion', () => {
  const suyas = [];
  const re = /<button[^>]*class="tab[^"]*"[^>]*data-tab="([^"]+)"/g;
  let m;
  while ((m = re.exec(INDEX))) suyas.push(m[1]);

  assert.ok(suyas.length >= 5, 'se encuentran las pestañas (salieron ' + suyas.length + ')');
  const conNombre = Object.values(Rutas.SECCIONES);
  for (const s of suyas) {
    assert.ok(conNombre.includes(s),
      `la pestaña «${s}» esta en la pagina pero no tiene direccion en rutas.js`);
  }
  for (const c of conNombre) {
    assert.ok(suyas.includes(c),
      `rutas.js habla de «${c}» pero esa pestaña ya no esta en la pagina`);
  }
});

test('todos los minijuegos del index.html se pueden enlazar', () => {
  const suyos = [];
  const re = /<button[^>]*class="subtab[^"]*"[^>]*data-game="([^"]+)"/g;
  let m;
  while ((m = re.exec(INDEX))) suyos.push(m[1]);

  assert.ok(suyos.length >= 5, 'se encuentran los minijuegos (salieron ' + suyos.length + ')');
  assert.ok(suyos.includes(Rutas.POR_DEFECTO.juego),
    'el minijuego por defecto sigue existiendo en la pagina');
  // Con la lista de verdad, cada uno se lee de su direccion.
  const deVerdad = (j) => suyos.includes(j);
  for (const j of suyos) {
    assert.deepStrictEqual(
      Rutas.estadoDe('#minijuegos/' + j, deVerdad),
      { seccion: 'games', juego: j },
      'se puede enlazar a ' + j
    );
  }
});

test('todas las secciones de la pagina tienen nombre, y no se repite ninguno', () => {
  // Si alguien anade una pestaña y se olvida de ponerla aqui, su direccion
  // saldria vacia y la barra no diria donde estas.
  const dentro = Object.values(Rutas.SECCIONES);
  assert.strictEqual(new Set(dentro).size, dentro.length, 'ningun data-tab repetido');
  const fuera = Object.keys(Rutas.SECCIONES);
  assert.strictEqual(new Set(fuera).size, fuera.length, 'ningun nombre repetido');
  for (const d of dentro) {
    assert.ok(Rutas.direccionDe({ seccion: d, juego: 'ruleta' }), 'sabe escribir ' + d);
  }
});
