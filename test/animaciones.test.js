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
