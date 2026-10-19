// El ritmo del rey de la colina.
//
// Los combates los lanza la página, pero quien dice cuándo puede empezar uno es
// el servidor. Antes no lo decía nadie: cada página abierta lanzaba los suyos
// sin saber de las demás, y con dos pestañas (o un moderador con la misma
// cuenta) los combates se pisaban. Cada pestaña enseñaba la mitad y el widget
// de OBS, que solo puede contar uno a la vez, se saltaba los que le llegaban
// mientras contaba otro.
//
// Lo que tiene que cumplirse siempre:
//
//  - Mientras se cuenta un combate no empieza otro.
//  - En cuanto acaba de contarse, sí.
//  - Lo que tarda en contarse es lo MISMO aquí que en la página.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, minijuegos } = require('./ayuda');

function abierta(t, nombres) {
  const c = carpeta();
  t.after(c.quitar);
  const j = minijuegos(c.raiz);
  const uid = 'u1';
  j.colina.abrir(uid, '');
  t.after(() => j.colina.cerrar(uid));
  nombres.forEach((n) => j.colina.entrar(uid, n));
  return { colina: j.colina, uid };
}

test('mientras se cuenta un combate no empieza otro', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto', 'Caro', 'Dani']);

  assert.strictEqual(colina.ocupada(uid), false, 'sin combate no está ocupada');
  assert.ok(colina.siguiente(uid), 'el primero sale');
  const e = colina.estado(uid);
  assert.strictEqual(e.peleados, 1);
  assert.strictEqual(e.combateHasta, e.combateDesde + colina.duracionDe(e.duelo),
    'acaba cuando se ha contado el último golpe y se ha visto la victoria');

  // Otra pestaña pide el siguiente a los dos segundos: todavía se está contando.
  t.mock.timers.tick(2000);
  assert.strictEqual(colina.ocupada(uid), true);
  assert.strictEqual(colina.siguiente(uid), null, 'no se pelea encima');
  assert.strictEqual(colina.estado(uid).peleados, 1, 'y no se ha gastado a nadie de la cola');
  assert.strictEqual(colina.estado(uid).cola.length, 2);

  // Acabado de contar, sale el siguiente.
  t.mock.timers.setTime(e.combateHasta);
  assert.strictEqual(colina.ocupada(uid), false);
  assert.ok(colina.siguiente(uid), 'ya sí');
  assert.strictEqual(colina.estado(uid).peleados, 2);
});

test('los que pelean no vuelven a la cola hasta que se acaba de ver, pero no se les descarta', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto']);
  colina.siguiente(uid);
  const e = colina.estado(uid);
  const perdedor = e.derrotado;

  // El que pierde pide la revancha a mitad del relato: espera, no se le tira.
  assert.strictEqual(colina.entrar(uid, perdedor).ok, true);
  assert.strictEqual(colina.estado(uid).cola.length, 0, 'a la cola todavía no');
  assert.deepStrictEqual(colina.estado(uid).esperan.map((r) => r.nombre), [perdedor]);
  assert.strictEqual(colina.entrar(uid, perdedor).ok, false, 'esperando solo se está una vez');

  // Un aviso de fin que llega antes de tiempo (una pestaña que iba con retraso
  // y avisa del combate anterior) no suelta a los que pelean ahora.
  colina.finCombate(uid);
  assert.strictEqual(colina.estado(uid).cola.length, 0, 'un aviso adelantado no los suelta');

  // Acabado de contar, entra solo.
  t.mock.timers.setTime(e.combateHasta);
  colina.finCombate(uid);
  assert.deepStrictEqual(colina.estado(uid).cola.map((r) => r.nombre), [perdedor]);
  assert.deepStrictEqual(colina.estado(uid).esperan, []);
});

test('quien espera entra a tiempo para el combate siguiente aunque nadie avise del fin', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto']);
  colina.siguiente(uid);
  const e = colina.estado(uid);
  colina.entrar(uid, e.derrotado);
  t.mock.timers.setTime(e.combateHasta);
  // Sin fincombate: la pagina estaba cerrada. El siguiente lo coge igual.
  assert.ok(colina.siguiente(uid), 'hay combate: el de la revancha');
});

test('el rey que escribe la palabra mientras pelea no se encola contra si mismo', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto']);
  colina.siguiente(uid);
  const e = colina.estado(uid);
  colina.entrar(uid, e.rey.nombre);
  t.mock.timers.setTime(e.combateHasta);
  colina.finCombate(uid);
  assert.strictEqual(colina.estado(uid).cola.length, 0);
});

test('la palabra es una sola, y cambiarla con la colina abierta vale ya', (t) => {
  const { colina, uid } = abierta(t, []);
  assert.strictEqual(colina.guardarAjustes(uid, { palabra: '  !pelea ya ' }).palabra, '!pelea');
  assert.strictEqual(colina.estado(uid).palabra, '!pelea');
});

test('el combate dura lo mismo aquí que en la página', (t) => {
  // El servidor calcula cuándo acaba el relato con sus propios números. Si
  // alguien cambia el ritmo en contarRonda() y no aquí, los combates volverían
  // a pisarse (o habría parones) sin que nada fallara.
  const c = carpeta();
  t.after(c.quitar);
  const { colina } = minijuegos(c.raiz);
  const arte = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dofus-arte.js'), 'utf8');
  const ritmo = /const RITMO = (\d+);/.exec(arte);
  const cola = /masLargo \* RITMO \+ (\d+)\)/.exec(arte);
  assert.ok(ritmo && cola, 'se encuentran el ritmo y la espera final de contarRonda');
  assert.strictEqual(Number(ritmo[1]), colina.RITMO_GOLPE);
  assert.strictEqual(Number(cola[1]), colina.COLA_COMBATE);
});

test('el widget vuelve a mirar al acabar de contar y no se salta combates al reiniciar', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', 'public', 'widget', 'colina.html'), 'utf8');
  // Lo que llega mientras cuenta se deja pasar; si al acabar no mira otra vez,
  // se queda con el combate viejo hasta el siguiente aviso.
  assert.ok(/contando = false;[\s\S]{0,400}widget\.mirar\(\)/.test(w), 'mira otra vez al acabar');
  // Al reiniciar la colina los combates se numeran desde uno otra vez.
  assert.ok(/contados = e\.peleados \|\| 0/.test(w), 'y sin combate puesto reinicia su cuenta');
});

test('la página mira el combate que lanza otra pantalla', () => {
  const p = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(p.includes('mirarCombateColina'), 'lo cuenta en vez de lanzar otro');
  assert.ok(/e\.datos && e\.datos\.ocupada/.test(p), 'y «ocupada» no lo trata como un fallo');
  const rutas = fs.readFileSync(path.join(__dirname, '..', 'src', 'rutas', 'minijuegos.ts'), 'utf8');
  assert.ok(/ocupada: true/.test(rutas), 'que es lo que contesta el servidor');
});

test('borrar el récord lo olvida del todo, sin tocar la partida', (t) => {
  // «Reiniciar la colina» no toca el récord histórico a propósito, así que hace
  // falta otra manera de borrarlo.
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto', 'Caro']);
  colina.siguiente(uid);
  const antes = colina.estado(uid);
  assert.ok(antes.record && antes.record.racha >= 1, 'hay récord tras el primer combate');

  // Reiniciar no lo borra.
  colina.abrir(uid, '');
  assert.ok(colina.estado(uid).record, 'reiniciar la colina lo deja');

  ['Ana', 'Beto'].forEach((n) => colina.entrar(uid, n));
  colina.siguiente(uid);
  const rey = colina.estado(uid).rey;

  colina.borrarRecord(uid);
  const e = colina.estado(uid);
  assert.strictEqual(e.record, null, 'el histórico se va');
  assert.strictEqual(e.mejor, null, 'y la mejor racha de la partida, que el widget enseña en su lugar');
  assert.deepStrictEqual(e.rey, rey, 'el rey sigue con su racha');
  assert.strictEqual(e.abierta, true, 'y la colina sigue abierta');
});

// Los combates automaticos los lanza el servidor: la colina sigue aunque la
// pagina este en otra pestaña, recargada o cerrada. Antes los lanzaba la
// pagina y, sin ella mirando, se quedaba parada.
test('en automatico el servidor lanza los combates solo, sin pagina', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const { colina, uid } = abierta(t, ['Ana', 'Beto']);
  assert.strictEqual(colina.estado(uid).auto, true, 'por defecto va solo');
  assert.strictEqual(colina.estado(uid).peleados, 0);

  t.mock.timers.tick(colina.RESPIRO);
  const e = colina.estado(uid);
  assert.strictEqual(e.peleados, 1, 'el primero sale solo tras el respiro');

  // Entra otro mientras se cuenta: sale cuando acaba este y pasa el respiro.
  colina.entrar(uid, 'Caro');
  t.mock.timers.tick(e.combateHasta - Date.now() + colina.RESPIRO - 1);
  assert.strictEqual(colina.estado(uid).peleados, 1, 'no antes de tiempo');
  t.mock.timers.tick(1);
  assert.strictEqual(colina.estado(uid).peleados, 2);
});

test('en pausa el servidor no lanza nada, y al reanudar sigue', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
  const { colina, uid } = abierta(t, []);
  colina.ponerAuto(uid, false);
  colina.entrar(uid, 'Ana');
  colina.entrar(uid, 'Beto');
  t.mock.timers.tick(60000);
  assert.strictEqual(colina.estado(uid).peleados, 0);
  colina.ponerAuto(uid, true);
  t.mock.timers.tick(colina.RESPIRO);
  assert.strictEqual(colina.estado(uid).peleados, 1);
  colina.ponerAuto(uid, true);
});
