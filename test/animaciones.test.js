// Las animaciones que comparten la pagina y los widgets de OBS.
//
// Estaban duplicadas: yo escribi en los widgets una cinta y una tragaperras
// nuevas, con otro alto de fila, otro numero de rodillos y otro ritmo, asi que no
// se parecian a las de la pagina. Ahora las dos salen del mismo archivo, que es lo
// que ya hacia plinko-tablero.js.
//
// Lo que se prueba aqui es la cuenta, que es lo que decide si la animacion se ve
// igual: donde para la cinta y cuando para cada rodillo. El dibujo no se puede
// probar sin navegador, pero la cuenta si, y es donde estan los fallos que se
// notan (una cinta que para entre dos nombres, un rodillo que para tarde).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Los archivos del navegador, tal cual. Se apuntan en globalThis, asi que
// cargarlos deja CintaNombres y Tragaperras puestos. No hay DOM, asi que solo se
// llama a lo que no lo toca.
const JS = path.join(__dirname, '..', 'public', 'js');
require(path.join(JS, 'ruleta-nombres.js'));
require(path.join(JS, 'tragaperras.js'));
const Cinta = globalThis.CintaNombres;
const Traga = globalThis.Tragaperras;

// --- La cinta de la ruleta de nombres ---------------------------------------

test('la cinta repite la lista lo bastante para que desfilen todos', () => {
  // Con pocos nombres hacen falta muchas vueltas o no se veria girar nada; con
  // muchos, pocas, o serian miles de filas para nada.
  assert.strictEqual(Cinta.vueltas(2), 12, 'con dos nombres, el tope de vueltas');
  assert.strictEqual(Cinta.vueltas(4), 12);
  assert.strictEqual(Cinta.vueltas(20), 4);
  assert.strictEqual(Cinta.vueltas(200), 3, 'con doscientos, el minimo');
  // Sin nombres da el tope, que da igual: girar() se va antes de llegar aqui si
  // la lista esta vacia. Lo que importa es que no reviente.
  assert.ok(Cinta.vueltas(0) >= 3 && Cinta.vueltas(0) <= 12, 'sin nombres no revienta');
});

test('siempre se dan al menos tres vueltas', () => {
  // Es lo que garantiza que delante de la banda pase todo el mundo mas de una
  // vez antes de parar. Si bajara de tres, con una lista larga se veria un
  // tiron y ya.
  for (const n of [1, 2, 3, 7, 50, 199, 1000]) {
    assert.ok(Cinta.vueltas(n) >= 3, 'n=' + n);
  }
});

test('la parada deja la fila elegida en el centro de la ventana', () => {
  // Con siete filas visibles, la del medio es la cuarta: hay que subir la cinta
  // «i» filas y volver a bajarla tres. Si esto se descuadra, la cinta para entre
  // dos nombres y no se entiende quien ha salido.
  const caja = { getBoundingClientRect: () => ({ height: 7 * 46 }) };
  assert.strictEqual(Cinta.visibles(caja, 46), 7);
  assert.strictEqual(Cinta.parada(caja, 0, 46), 46 * 3, 'la primera fila');
  assert.strictEqual(Cinta.parada(caja, 10, 46), -10 * 46 + 46 * 3);
});

test('con una sola fila visible la parada no se desplaza', () => {
  const caja = { getBoundingClientRect: () => ({ height: 46 }) };
  assert.strictEqual(Cinta.visibles(caja, 46), 1);
  assert.strictEqual(Cinta.parada(caja, 5, 46), -5 * 46);
});

test('la cola tapa el hueco de abajo cuando para el ultimo', () => {
  // Sin cola, si el que sale es el ultimo de la lista, la cinta para con media
  // ventana vacia debajo.
  assert.deepStrictEqual(Cinta.cola(['a', 'b'], 5), ['a', 'b', 'a', 'b', 'a']);
  assert.deepStrictEqual(Cinta.cola(['solo'], 3), ['solo', 'solo', 'solo']);
});

test('las filas se escapan: un nombre no puede meter HTML', () => {
  const html = Cinta.filas(['<img src=x onerror=alert(1)>']);
  assert.ok(!html.includes('<img'), 'no queda la etiqueta');
  assert.ok(html.includes('&lt;img'), 'queda escapada');
});

// --- La tragaperras de la ruleta de recursos ---------------------------------

// La cuenta de las paradas es la DEL MODULO, no una copia.
//
// La primera version de este archivo la reimplementaba aqui con sus propios
// numeros, y eso hacia el test inutil: lo comprobe cambiando el reparto en
// tragaperras.js de 1800 a 1500 y no fallaba nada, porque el test seguia midiendo
// su propia copia. Por eso la cuenta salio del modulo a una funcion exportada.
const cuando = Traga.cuando;

test('los rodillos paran de izquierda a derecha, nunca todos juntos', () => {
  // Es lo que da la tension. Si paran juntos, no hay nada que esperar.
  for (const n of [2, 3, 5, 10, 20]) {
    for (let i = 1; i < n; i++) {
      assert.ok(cuando(n, i, 4500) > cuando(n, i - 1, 4500),
        'n=' + n + ': el rodillo ' + i + ' para despues que el ' + (i - 1));
    }
  }
});

test('el primero para a 1800 ms y el ultimo justo al final', () => {
  for (const n of [2, 3, 5, 10, 20]) {
    assert.strictEqual(cuando(n, 0, 4500), 1800, 'n=' + n + ': el primero');
    assert.strictEqual(cuando(n, n - 1, 4500), 4500, 'n=' + n + ': el ultimo');
  }
});

test('con un solo rodillo para a 3200 ms', () => {
  // No hay nada que repartir, asi que para a media espera y se ve el golpe.
  assert.strictEqual(cuando(1, 0, 4500), 3200);
});

test('las paradas son las mismas que antes de compartir el codigo', () => {
  // La cuenta de la version vieja, copiada de index.html tal cual estaba:
  //   parada = reels > 1 ? 1800 + (i * 2700) / (reels - 1) : 3200
  const vieja = (n, i) => (n > 1 ? 1800 + (i * 2700) / (n - 1) : 3200);
  for (const n of [1, 2, 3, 5, 6, 10, 20]) {
    for (let i = 0; i < n; i++) {
      assert.ok(Math.abs(vieja(n, i) - cuando(n, i, 4500)) < 0.001,
        'n=' + n + ' i=' + i + ': antes ' + vieja(n, i) + ', ahora ' + cuando(n, i, 4500));
    }
  }
});

test('si la espera se acorta, las paradas se encogen y caben todas', () => {
  // Es el caso del widget que se entera tarde: le quedan dos segundos de
  // animacion, no cuatro y medio. Todas las paradas tienen que caber dentro.
  for (const espera of [600, 1200, 2000, 4500]) {
    for (const n of [1, 3, 20]) {
      for (let i = 0; i < n; i++) {
        const t = cuando(n, i, espera);
        assert.ok(t >= 200, 'espera=' + espera + ' n=' + n + ' i=' + i + ': no antes de 200ms');
        assert.ok(t <= espera, 'espera=' + espera + ' n=' + n + ' i=' + i + ': cabe dentro');
      }
    }
  }
});

test('el ritmo y los topes son los de la pagina', () => {
  assert.strictEqual(Traga.RITMO, 190, 'cambian de imagen cada 190 ms');
  assert.strictEqual(Traga.POR_FILA, 5, 'cinco rodillos por fila');
  assert.strictEqual(Traga.MAX, 20, 'y veinte como mucho, que si no no caben');
});

// --- Que no se vuelvan a duplicar -------------------------------------------

test('la pagina y los widgets cargan los MISMOS archivos', () => {
  // Este es el test que evita volver atras. Si alguien se hace otra vez su
  // propia cinta en un widget, o se le olvida cargar la compartida, salta.
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  const index = leer('index.html');
  const wNombres = leer('widget/nombres.html');
  const wSorteo = leer('widget/sorteo.html');

  for (const [nombre, texto, archivos] of [
    ['index.html', index, ['css/ruleta-nombres.css', 'js/ruleta-nombres.js', 'css/tragaperras.css', 'js/tragaperras.js']],
    ['widget/nombres.html', wNombres, ['css/ruleta-nombres.css', 'js/ruleta-nombres.js']],
    ['widget/sorteo.html', wSorteo, ['css/tragaperras.css', 'js/tragaperras.js']]
  ]) {
    for (const a of archivos) {
      assert.ok(texto.includes('/' + a), nombre + ' carga ' + a);
    }
  }

  // Y que los widgets no se hayan hecho su propia version: los numeros que
  // definen la animacion solo pueden estar en los archivos compartidos.
  for (const [nombre, texto] of [['widget/nombres.html', wNombres], ['widget/sorteo.html', wSorteo]]) {
    assert.ok(!/cubic-bezier/.test(texto), nombre + ' no define su propia curva');
    assert.ok(!/setInterval\([^)]*190|RITMO\s*=/.test(texto), nombre + ' no define su propio ritmo');
  }
});

// --- Medir lo que está oculto -----------------------------------------------
//
// Este es el fallo por el que los widgets no animaban, y no lo pilló ningún test:
// la animación se lanzaba con su panel todavía oculto. Un elemento con
// display:none mide 0 de alto, y con 0 la parada de la cinta sale 0, así que la
// cinta se queda quieta. Se veía el panel aparecer, pero sin moverse.

// Un DOM de mentira, lo justo para girar() y con la trampa de verdad: la fila
// mide 0 mientras el panel esté oculto, igual que en el navegador.
function domFalso() {
  const panel = { hidden: true };
  const alto = () => (panel.hidden ? 0 : 46);
  // Se apunta si el panel estaba oculto CADA VEZ que se mide. Así el test puede
  // decir si se midió antes de destapar, que es el fallo de verdad; mirar solo el
  // resultado no sirve, porque el respaldo de alto() lo tapa.
  const medidasOcultas = [];
  const medir = () => { medidasOcultas.push(panel.hidden); return alto(); };
  const tira = {
    innerHTML: '',
    style: {},
    offsetHeight: 0,
    querySelector: () => ({ getBoundingClientRect: () => ({ height: medir() }) })
  };
  const caja = { getBoundingClientRect: () => ({ height: medir() * 7 }) };
  return { panel, caja, tira, medidasOcultas };
}

test('girar destapa el panel antes de medir, o la cinta no se movería', () => {
  const d = domFalso();
  const cual = Cinta.girar({
    panel: d.panel, caja: d.caja, tira: d.tira,
    lista: ['Ana', 'Beto', 'Caro'], elegido: 1, ms: 5000
  });

  assert.strictEqual(d.panel.hidden, false, 'el panel queda a la vista');
  // Lo que de verdad se comprueba: que NINGUNA medida se tomó con el panel
  // oculto. Sin esto el test pasaba igual con el fallo puesto, porque el respaldo
  // de alto() lo disimula.
  assert.ok(d.medidasOcultas.length > 0, 'se mide algo');
  assert.ok(!d.medidasOcultas.some((oculto) => oculto),
    'se destapó ANTES de medir (medidas con el panel oculto: '
      + d.medidasOcultas.filter(Boolean).length + ')');
  assert.ok(cual >= 0, 'y dice en qué fila para');
  // Lo que importa: que la cinta se MUEVA. Con el panel oculto esto salía
  // 'translateY(0px)' y no se veía girar nada.
  const t = d.tira.style.transform;
  assert.ok(/^translateY\(-?\d/.test(t), 'pone un transform: ' + t);
  assert.notStrictEqual(t, 'translateY(0px)', 'y NO es cero, que es no moverse');
  assert.ok(d.tira.style.transition.includes('5000ms'), 'con la duración que se le pasó');
});

test('girar sin panel también mide bien si la caja ya está a la vista', () => {
  const d = domFalso();
  d.panel.hidden = false;   // ya visible, como en la página
  const cual = Cinta.girar({ caja: d.caja, tira: d.tira, lista: ['A', 'B'], elegido: 0, ms: 1000 });
  assert.ok(cual >= 0);
  assert.notStrictEqual(d.tira.style.transform, 'translateY(0px)');
});

test('una medida de cero se trata como «no se puede medir», no como cero', () => {
  const nada = { getBoundingClientRect: () => ({ height: 0 }) };
  const tiraNada = { querySelector: () => ({ getBoundingClientRect: () => ({ height: 0 }) }) };
  // Antes: alto 0, visibles 1, parada 0. O sea, quieta.
  assert.strictEqual(Cinta.alto(tiraNada), 46, 'cae al alto que dice el CSS');
  assert.strictEqual(Cinta.visibles(nada, 46), 7, 'y a la ventana de siete');
  assert.notStrictEqual(Cinta.parada(nada, 10, Cinta.alto(tiraNada)), 0, 'así la parada no es cero');
});

test('girar no hace nada si no hay a quién girar', () => {
  const d = domFalso();
  assert.strictEqual(Cinta.girar({ panel: d.panel, caja: d.caja, tira: d.tira, lista: [], ms: 1000 }), -1);
  assert.strictEqual(d.panel.hidden, true, 'y no destapa un panel vacío');
});

// Un document de mentira, lo justo para que la tragaperras pueda crear rodillos.
// Con esto el test prueba la funcion de verdad y no una copia.
function conDocumento(fn) {
  const antes = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      className: '',
      innerHTML: '',
      style: {},
      hijos: [],
      classList: {
        clases: new Set(),
        add(c) { this.clases.add(c); },
        remove(c) { this.clases.delete(c); },
        contains(c) { return this.clases.has(c); }
      },
      appendChild(h) { this.hijos.push(h); }
    })
  };
  try { return fn(); } finally { globalThis.document = antes; }
}

function montarFalsa(opciones) {
  const panel = { hidden: true };
  const caja = { innerHTML: '', hijos: [], appendChild(h) { this.hijos.push(h); } };
  const mando = conDocumento(() => Traga.montar(Object.assign({
    panel, caja,
    relleno: [{ nombre: 'Pan', imagen: '/p.png', rareza: 'common' }],
    espera: 4500
  }, opciones)));
  return { panel, caja, mando };
}

test('la tragaperras también destapa su panel al montarse', () => {
  const { panel, mando } = montarFalsa({ cuantos: 3 });
  assert.strictEqual(panel.hidden, false, 'el panel queda a la vista');
  if (mando) mando.quitar();
});

test('un rodillo por recurso, en filas de cinco como máximo', () => {
  // Es la diferencia más gorda que tenía mi versión del widget: tres rodillos
  // fijos en vez de uno por recurso.
  const casos = [[1, 1, [1]], [3, 1, [3]], [5, 1, [5]], [6, 2, [3, 3]], [12, 3, [4, 4, 4]]];
  for (const [cuantos, filas, reparto] of casos) {
    const { caja, mando } = montarFalsa({ cuantos });
    assert.strictEqual(caja.hijos.length, filas, cuantos + ' recursos -> ' + filas + ' fila(s)');
    assert.deepStrictEqual(caja.hijos.map((f) => f.hijos.length), reparto,
      cuantos + ' recursos se reparten ' + reparto.join('+'));
    if (mando) mando.quitar();
  }
});

test('no se montan más de veinte rodillos, que no caben', () => {
  const { caja, mando } = montarFalsa({ cuantos: 50 });
  const total = caja.hijos.reduce((n, f) => n + f.hijos.length, 0);
  assert.strictEqual(total, 20);
  if (mando) mando.quitar();
});

test('sin relleno no se monta nada: no hay con qué dar vueltas', () => {
  const { panel, mando } = montarFalsa({ cuantos: 3, relleno: [] });
  assert.strictEqual(mando, null);
  assert.strictEqual(panel.hidden, true, 'y no se destapa un panel vacío');
});

test('el relleno sin imagen no cuenta', () => {
  const { mando } = montarFalsa({ cuantos: 2, relleno: [{ nombre: 'Sin foto' }] });
  assert.strictEqual(mando, null, 'un rodillo sin imagen no es un rodillo');
});

// --- El vídeo del doble o nada ----------------------------------------------
//
// La página y el widget enseñan el MISMO archivo. Eso no es solo para no
// duplicar: como es el mismo, dura lo mismo, así que los dos acaban a la vez sin
// tener que mandar duraciones ni cuadrar relojes.

// Un <video> de mentira que se puede hacer arrancar, acabar o fallar a mano.
function videoFalso() {
  const caja = { hidden: false };
  const video = {
    src: '',
    paused: false,
    onplaying: null, onended: null, onerror: null,
    play() { return { catch: () => {} }; },
    pause() { this.paused = true; }
  };
  return { caja, video };
}

test('el vídeo se pide según cómo salga, y tapa solo cuando arranca', async () => {
  const { caja, video } = videoFalso();
  caja.hidden = true;
  const fin = Cinta.animacion(caja, video, 'perder');

  assert.strictEqual(video.src, '/assets/perder.mp4');
  assert.strictEqual(caja.hidden, true, 'todavía no tapa: el vídeo no ha arrancado');

  video.onplaying();
  assert.strictEqual(caja.hidden, false, 'al arrancar, tapa');

  video.onended();
  await fin;
  assert.strictEqual(caja.hidden, true, 'y al acabar se destapa');
  assert.strictEqual(video.paused, true, 'y se para');
});

test('ganar pide el otro archivo', async () => {
  const { caja, video } = videoFalso();
  const fin = Cinta.animacion(caja, video, 'ganar');
  assert.strictEqual(video.src, '/assets/ganar.mp4');
  video.onended();
  await fin;
});

test('cualquier cosa que no sea perder pide ganar', async () => {
  for (const cual of ['ganar', '', null, undefined, 'loquesea']) {
    const { caja, video } = videoFalso();
    const fin = Cinta.animacion(caja, video, cual);
    assert.strictEqual(video.src, '/assets/ganar.mp4', JSON.stringify(cual));
    video.onended();
    await fin;
  }
});

test('si el archivo no está, no se tapa nada y se sigue', async () => {
  // Las animaciones las pone quien monta el Ruleton y puede no haberlas hecho.
  // Lo que no puede pasar es que se vea un recuadro negro, ni que el sorteo se
  // quede colgado esperando un vídeo que no existe.
  const { caja, video } = videoFalso();
  caja.hidden = true;
  const fin = Cinta.animacion(caja, video, 'ganar');
  video.onerror();
  await fin;
  assert.strictEqual(caja.hidden, true, 'nunca tapó');
});

test('sin video no revienta: se sigue igual', async () => {
  await Cinta.animacion(null, null, 'ganar');
  await Cinta.animacion({ hidden: true }, null, 'perder');
});

test('el seguro del vídeo es el mismo que espera la página', () => {
  // El servidor usa este mismo numero para no dejar al widget tapado si el vídeo
  // se atasca. Si aquí cambia y allí no, el widget se destaparía antes o después
  // que la página.
  assert.strictEqual(Cinta.SEGURO_VIDEO, 15000);
});

test('el vídeo del doble o nada también sale de un solo sitio', () => {
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  // Ni la página ni el widget pueden pedir el archivo por su cuenta: eso es lo
  // que hacía que se separaran.
  for (const p of ['index.html', 'widget/nombres.html']) {
    const texto = leer(p);
    assert.ok(!/['"]\/assets\/(ganar|perder)\.mp4/.test(texto),
      p + ' no pide el vídeo por su cuenta, lo pide CintaNombres');
    assert.ok(texto.includes('CintaNombres.animacion'), p + ' usa el compartido');
  }
});

test('doblar dos veces vuelve a poner el vídeo desde cero', async () => {
  // Doblar dos veces seguidas pide el MISMO archivo las dos veces (ganar.mp4 si
  // se gana). Reasignar src con el mismo valor no garantiza que el vídeo vuelva a
  // empezar: el elemento se quedó en «acabado». Por eso se llama a load().
  const veces = [];
  const caja = { hidden: true };
  const video = {
    src: '',
    onplaying: null, onended: null, onerror: null,
    load() { veces.push(this.src); },
    play() { return { catch: () => {} }; },
    pause() {}
  };

  const una = Cinta.animacion(caja, video, 'ganar');
  video.onplaying();
  video.onended();
  await una;

  const dos = Cinta.animacion(caja, video, 'ganar');
  video.onplaying();
  assert.strictEqual(caja.hidden, false, 'la segunda vez también tapa');
  video.onended();
  await dos;

  assert.deepStrictEqual(veces, ['/assets/ganar.mp4', '/assets/ganar.mp4'],
    'se reinicia el vídeo las DOS veces, no solo la primera');
});

test('sin load() en el elemento no revienta', async () => {
  // Por si algún día se le pasa algo que no es un <video> de verdad.
  const caja = { hidden: true };
  const video = { src: '', onplaying: null, onended: null, onerror: null,
    play: () => ({ catch: () => {} }), pause: () => {} };
  const fin = Cinta.animacion(caja, video, 'ganar');
  video.onended();
  await fin;
});

// --- El combate del rey de la colina ----------------------------------------
//
// El widget no enseñaba la pelea: salía el rey y el resultado, pero no el
// combate. El relato y el dibujo estaban en index.html, así que el widget no
// tenía con qué. Ahora salen de js/dofus-arte.js y css/combate.css, los dos.
//
// Estos tests CARGAN el archivo de verdad, no solo comprueban su sintaxis. Y hay
// un motivo concreto: al darle su propio escapado, la definición no llegó a
// entrar (el script se ancló en un 'use strict' que ese archivo no tiene) y
// quedó usada pero sin definir. `node --check` pasaba, porque es un error de
// ejecución. Cargarlo lo pilla.

const vm = require('node:vm');

function cargarArte(estado) {
  const codigo = fs.readFileSync(path.join(JS, 'dofus-arte.js'), 'utf8');
  const hecho = {};
  const elemento = () => ({
    hidden: false, innerHTML: '', style: {}, dataset: {},
    classList: {
      c: new Set(), add(x) { this.c.add(x); }, remove(x) { this.c.delete(x); },
      toggle(x, v) { if (v === false) this.c.delete(x); else this.c.add(x); },
      contains(x) { return this.c.has(x); }
    },
    children: [], appendChild() {}, querySelector: () => null, querySelectorAll: () => []
  });
  const ctx = {
    colina: (estado && estado.colina) || { clases: {}, peleados: 1 },
    batalla: (estado && estado.batalla) || { luchadores: [], arte: { clases: {} } },
    document: {
      getElementById: (id) => (hecho[id] = hecho[id] || elemento()),
      createElement: () => elemento()
    },
    setTimeout, clearTimeout, Promise, Math, Object, Array, String, Number, JSON, console
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'dofus-arte.js' });
  return { ctx, hecho };
}

test('el arte de los combates se carga sin la página detrás', () => {
  // Es lo que hace falta para que el widget pueda usarlo: que no dependa de nada
  // de index.html. Si le faltara una función, esto revienta al cargar.
  const { ctx } = cargarArte();
  for (const f of ['esc', 'claseDe', 'hechizoDe', 'muneco', 'lineaDeGolpe', 'etiquetaClase',
    'abrirRing', 'dofusSvg', 'dofusHuevoSvg', 'escenarioColina', 'htmlDueloColina',
    'dibujarDueloColina', 'contarRonda']) {
    assert.strictEqual(typeof ctx[f], 'function', 'falta ' + f);
  }
});

test('escapa el HTML sin usar el DOM', () => {
  const { ctx } = cargarArte();
  assert.strictEqual(ctx.esc('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
  assert.strictEqual(ctx.esc(null), '');
});

test('la clase del muñeco es la que repartió la colina, no una inventada', () => {
  // Sin esto los muñecos del widget saldrían con otra clase que en la página,
  // porque claseDe() se la saca del nombre cuando no la tiene.
  const { ctx } = cargarArte({
    colina: { clases: { ana: 'Yopuka', beto: 'Ocra' }, peleados: 1 },
    batalla: { luchadores: [], arte: { clases: {} } }
  });
  assert.strictEqual(ctx.claseDe('Ana').clase, 'Yopuka');
  assert.strictEqual(ctx.claseDe('Beto').clase, 'Ocra');
  // Y da igual cómo se escriban las mayúsculas, que la colina las guarda en bajas.
  assert.strictEqual(ctx.claseDe('ANA').clase, 'Yopuka');
});

test('el duelo se monta con lo que contarRonda va a buscar', () => {
  const { ctx } = cargarArte({
    colina: { clases: { ana: 'Yopuka', beto: 'Ocra' }, peleados: 2 },
    batalla: { luchadores: [], arte: { clases: {} } }
  });
  const duelo = {
    a: 'Ana', b: 'Beto', ganador: 'Ana',
    golpes: [{ quien: 'Ana', a: 'Beto', dano: 30, vidaA: 100, vidaB: 70 }]
  };
  const html = ctx.htmlDueloColina(duelo, true);

  // contarRonda busca .duelo[data-ronda][data-duelo] y dentro las barras, el
  // texto del golpe y los dos muñecos. Si falta algo, no anima nada.
  assert.ok(html.includes('data-ronda="0"'), 'la ronda');
  assert.ok(html.includes('data-duelo="0"'), 'el duelo');
  assert.ok(html.includes('class="muneco lado-a'), 'el muñeco de la izquierda');
  assert.ok(html.includes('class="muneco lado-b'), 'y el de la derecha');
  assert.ok(/data-lado="a"/.test(html) && /data-lado="b"/.test(html), 'las dos barras de vida');
  assert.ok(html.includes('class="golpe"'), 'donde va el texto del golpe');
  assert.ok(html.includes('class="lineas"'), 'y el relato');
});

test('el que pierde va marcado para caerse', () => {
  const { ctx } = cargarArte();
  const html = ctx.htmlDueloColina({
    a: 'Ana', b: 'Beto', ganador: 'Ana',
    golpes: [{ quien: 'Ana', a: 'Beto', dano: 100, vidaA: 100, vidaB: 0 }]
  }, true);
  assert.ok(/class="muneco lado-b cae/.test(html), 'Beto se cae');
  assert.ok(!/class="muneco lado-a cae/.test(html), 'y Ana no');
});

test('un nombre con HTML no se cuela en el duelo', () => {
  const { ctx } = cargarArte();
  const html = ctx.htmlDueloColina({ a: '<img src=x onerror=alert(1)>', b: 'Beto', golpes: [] }, false);
  assert.ok(!html.includes('<img src=x'), 'no queda la etiqueta');
  assert.ok(html.includes('&lt;img'), 'queda escapada');
});

test('el escenario del combate cambia con cada pelea', () => {
  // Así dos combates seguidos no salen en el mismo sitio.
  for (const [peleados, esperado] of [[1, 0], [2, 1], [5, 4], [0, 0]]) {
    const { ctx } = cargarArte({ colina: { clases: {}, peleados } });
    assert.strictEqual(ctx.escenarioColina(), esperado, 'peleados=' + peleados);
  }
});

test('el widget del rey de la colina carga el combate compartido', () => {
  // El test que evita volver atrás: si alguien se hace otra vez su propia versión
  // del combate en el widget, o se le olvida cargar la compartida, salta.
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget', 'colina.html'), 'utf8');
  assert.ok(w.includes('/css/combate.css'), 'carga el CSS del combate');
  assert.ok(w.includes('/js/dofus-arte.js'), 'y el arte');
  assert.ok(w.includes('dibujarDueloColina'), 'monta el duelo con el código compartido');
  assert.ok(w.includes('contarRonda'), 'y lo cuenta con el compartido');
  assert.ok(w.includes('colinaCuadro'), 'con el mismo id que la página, para compartir el CSS');
  // Y no puede tener su propio dibujo.
  assert.ok(!/<svg/.test(w), 'el widget no dibuja muñecos por su cuenta');
});

test('la página y el widget cargan el MISMO combate', () => {
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  for (const p of ['index.html', 'widget/colina.html']) {
    const texto = leer(p);
    assert.ok(texto.includes('/css/combate.css'), p + ' carga css/combate.css');
    assert.ok(texto.includes('/js/dofus-arte.js'), p + ' carga js/dofus-arte.js');
  }
});

// --- La pista de la carrera -------------------------------------------------
//
// El widget tenía su propia pista: emojis deslizándose por un carril. La página
// dibuja los bichos del pliego con sus poses (correr, tropezar, acelerar, ganar),
// con semáforo de salida, puestos y relato. No se parecían en nada.
//
// Ahora salen de css/carrera.css y js/carrera-pista.js, los dos. Y estos tests
// CARGAN el módulo de verdad, por lo mismo que los del combate: al moverlo se
// quedaron fuera cinco cosas que usaba (BICHOS, COLORES_BOLA, adornosDe,
// escapeHtml, corriendo y los cuatro dibujos de los bichos) y `node --check` no
// ve ninguna, porque son errores de ejecución.

function cargarPista(estado) {
  const codigo = fs.readFileSync(path.join(JS, 'carrera-pista.js'), 'utf8');
  const hecho = {};
  const elemento = (clase) => ({
    className: clase || '', hidden: false, innerHTML: '', textContent: '', dataset: {},
    hijos: [], clientWidth: 600, offsetWidth: 22,
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    classList: {
      c: new Set((clase || '').split(' ').filter(Boolean)),
      add(...x) { x.forEach((y) => this.c.add(y)); },
      remove(...x) { x.forEach((y) => this.c.delete(y)); },
      toggle(x, v) { if (v === false) this.c.delete(x); else if (v === true) this.c.add(x); else if (this.c.has(x)) this.c.delete(x); else this.c.add(x); },
      contains(x) { return this.c.has(x); }
    },
    appendChild(h) { this.hijos.push(h); return h; },
    prepend(h) { this.hijos.unshift(h); return h; },
    remove() {}, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ width: 600, height: 300 })
  });
  const ctx = {
    carrera: estado || {
      abierta: false,
      corredores: [{ nombre: 'Ana', clave: 'ana' }, { nombre: 'Beto', clave: 'beto' }],
      resultado: [], corridaEn: '', marcas: [], eventos: [],
      ajustes: { duracion: 8, animacion: 'caballos' }
    },
    document: { getElementById: (id) => (hecho[id] = hecho[id] || elemento()), createElement: () => elemento() },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 },
    Image: function () { return { src: '', onload: null, onerror: null }; },
    Promise, Math, Object, Array, String, Number, JSON, Map, Set, WeakMap, Date, console
  };
  // El modulo se apunta al resize para recolocar la pista cuando cambia el
  // tamaño, asi que window necesita los oyentes.
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'carrera-pista.js' });
  return { ctx, hecho, dentro: (expr) => vm.runInContext(expr, ctx) };
}

test('la pista de la carrera se carga sin la página detrás', () => {
  const { ctx } = cargarPista();
  for (const f of ['bichoDeLaPista', 'pintarCorredores', 'pulsarCorredores', 'ponerPose',
    'dibujarPista', 'animarCarrera', 'adornosDe', 'esc',
    'caballoSvg', 'patoSvg', 'hormigaSvg', 'larvaSvg']) {
    assert.strictEqual(typeof ctx[f], 'function', 'falta ' + f);
  }
});

test('el pliego de sprites tiene los cuatro bichos con sus poses', () => {
  const { dentro } = cargarPista();
  const filas = dentro('PLIEGO.filas');
  for (const b of ['caballos', 'patos', 'hormigas', 'larvas']) {
    assert.ok(b in filas, 'falta la fila de ' + b);
  }
  // Las poses son lo que hace que el bicho corra en vez de deslizarse.
  const pose = dentro('POSE');
  assert.ok(Array.isArray(pose.correr) && pose.correr.length > 1, 'el ciclo de correr');
  for (const p of ['idle', 'acelera', 'tropieza', 'esfuerzo', 'gana', 'pierde']) {
    assert.notStrictEqual(pose[p], undefined, 'falta la pose ' + p);
  }
});

test('dibujarPista y animarCarrera se pueden llamar sin reventar', () => {
  // Es lo que de verdad comprobaba el fallo: al mover el módulo se quedaron fuera
  // BICHOS, COLORES_BOLA, adornosDe, corriendo y los cuatro dibujos, y cada una
  // reventaba aquí.
  const { ctx } = cargarPista({
    abierta: false,
    corredores: [{ nombre: 'Ana', clave: 'ana' }, { nombre: 'Beto', clave: 'beto' }],
    resultado: [{ puesto: 1, nombre: 'Ana', puntos: 10 }],
    corridaEn: new Date().toISOString(),
    marcas: [[0, 0], [0.5, 0.4], [1, 0.9]],
    eventos: [{ tick: 1, texto: 'Ana se pone primero' }],
    ajustes: { duracion: 8, animacion: 'patos' }
  });
  ctx.dibujarPista();
  ctx.animarCarrera([{ puesto: 1, nombre: 'Ana', puntos: 10 }]);
  ctx.pintarCorredores();
  ctx.pulsarCorredores(false);
});

test('el bicho de la pista se lee de su clase', () => {
  const { ctx } = cargarPista();
  const pista = (clase) => ({ classList: { c: new Set(clase.split(' ')), contains(x) { return this.c.has(x); } } });
  assert.strictEqual(ctx.bichoDeLaPista(pista('pista patos')), 'patos');
  assert.strictEqual(ctx.bichoDeLaPista(pista('pista larvas')), 'larvas');
  assert.strictEqual(ctx.bichoDeLaPista(pista('pista')), 'caballos', 'sin clase, caballos');
});

test('los cuatro bichos se dibujan y devuelven SVG', () => {
  const { ctx } = cargarPista();
  // El cuarto es el numero de pinta que le toca, no un texto: de ahi salen el
  // sombrero, el cuello y la cara de cada pato.
  for (const f of ['caballoSvg', 'patoSvg', 'hormigaSvg', 'larvaSvg']) {
    for (const pinta of [0, 1, 2, 7]) {
      const svg = ctx[f]('#fff', '#000', 3, pinta);
      assert.ok(typeof svg === 'string' && svg.includes('<svg'),
        f + ' devuelve SVG con la pinta ' + pinta);
    }
  }
});

test('el widget de la carrera usa la pista compartida, no una propia', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget', 'carrera.html'), 'utf8');
  assert.ok(w.includes('/css/carrera.css'), 'carga el CSS de la pista');
  assert.ok(w.includes('/js/carrera-pista.js'), 'y la pista');
  assert.ok(w.includes('dibujarPista'), 'dibuja con el código compartido');
  assert.ok(w.includes('animarCarrera'), 'y anima con el compartido');
  assert.ok(w.includes('carreraPista') && w.includes('carreraRelato'),
    'con los mismos ids que la página, para compartir el CSS');
  // Y no puede tener su propia versión.
  assert.ok(!/🐎|🦆|🐜|🐛/.test(w), 'el widget ya no dibuja emojis por su cuenta');
  assert.ok(!/requestAnimationFrame/.test(w), 'ni su propio bucle de animación');
});

test('la página y el widget de la carrera cargan lo MISMO', () => {
  const leer = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
  for (const p of ['index.html', 'widget/carrera.html']) {
    const texto = leer(p);
    assert.ok(texto.includes('/css/carrera.css'), p + ' carga css/carrera.css');
    assert.ok(texto.includes('/js/carrera-pista.js'), p + ' carga js/carrera-pista.js');
  }
});

test('el widget de la colina solo cuenta el combate si se está peleando ahora', () => {
  // Al abrir el widget puede haber un combate ya peleado en el servidor. Contarlo
  // sería soltar en pantalla una pelea de hace cinco minutos, así que en el primer
  // vistazo solo se cuenta el que acaba de empezar.
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget', 'colina.html'), 'utf8');
  assert.ok(w.includes('primerVistazo'), 'distingue el primer vistazo');
  assert.ok(/combateDesde/.test(w), 'y mira cuándo empezó el combate');
  assert.ok(/e\.ahora - e\.combateDesde/.test(w),
    'con el reloj del servidor, no con el del PC que corre OBS');
});

test('el endpoint de la colina manda cuándo empezó el combate', () => {
  // Sin esto el widget no puede saber si el combate es de ahora o de antes.
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.ts'), 'utf8');
  const i = s.indexOf("app.get('/api/widget/colina'");
  assert.ok(i > 0, 'la ruta existe');
  const bloque = s.slice(i, i + 1600);
  assert.ok(bloque.includes('combateDesde'), 'manda combateDesde');
  assert.ok(bloque.includes('ahora'), 'y su propia hora');
  assert.ok(bloque.includes('clases'), 'y las clases, para dibujar los muñecos igual');
  assert.ok(bloque.includes('arte'), 'y el arte');
});

test('la hoja del combate trae TODO lo que el combate necesita', () => {
  // El widget del rey de la colina solo carga css/combate.css. Lo que se quede
  // en el <style> de index.html, el widget no lo tiene: así se quedaron fuera
  // las animaciones y los efectos de cada golpe, y en OBS los muñecos no se
  // movían y los letreros salían amontonados en una esquina.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'combate.css'), 'utf8');
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Un trozo de comentario suelto se come la regla que viene detrás sin que
  // nada avise. Pasó con la que centra el combate de la colina: se quedaba a
  // la izquierda, a la mitad de ancho.
  assert.ok(!sinComentarios.includes('*/'), 'no hay cierres de comentario sueltos');
  assert.ok(!sinComentarios.includes('/*'), 'ni comentarios sin cerrar');
  assert.ok(/#colinaCuadro \.duelos\{[^}]*justify-content:center/.test(sinComentarios),
    'y la regla que centra el combate de la colina está viva');

  // Toda animación que se usa aquí está definida aquí.
  const definidas = new Set([...sinComentarios.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]));
  const usadas = [...sinComentarios.matchAll(/animation:([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== 'none');
  for (const n of usadas) assert.ok(definidas.has(n), 'la animación «' + n + '» está en la hoja compartida');

  // Y los efectos que monta contarRonda() tienen su estilo aquí.
  for (const clase of ['.fx span', '.fx .dano', '.fx .letrero', '.fx .hechizo']) {
    assert.ok(sinComentarios.includes(clase), clase + ' tiene estilo en la hoja compartida');
  }
});
