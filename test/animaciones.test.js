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
