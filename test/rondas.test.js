// La ronda abierta sobrevive a un reinicio.
//
// Esto es lo que se rompe en silencio: si un dia alguien añade una forma nueva
// de apuntar gente y se olvida de guardar la foto, nada falla y nadie se entera
// hasta que en medio de un directo se reinicia el servidor y cuarenta personas
// desaparecen de la pantalla. Ver vivo.ts.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, minijuegos, sinRuido } = require('./ayuda');

// «Reiniciar» es volver a cargar los modulos: la partida vive en un Map suyo,
// asi que cargarlos de nuevo es empezar con la memoria en blanco.
//
// Las rondas de estos tests se abren SIN cronometro a proposito. No es por
// comodidad: un cronometro deja un setTimeout puesto, y al descartar el modulo
// viejo ese temporizador se queda huerfano, sin nadie que pueda cancelarlo, y
// mantiene vivo al que corre los tests hasta que le toque la hora. El
// cronometro se prueba aparte, escribiendo la hora de cierre en la foto.
function reiniciar(raiz, uid, avisados) {
  for (const f of fs.readdirSync(path.join(raiz, uid))) {
    if (!f.startsWith('vivo-')) continue;
    const p = path.join(raiz, uid, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.guardadoEn = Date.now();
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
  }
  return minijuegos(raiz, avisados);
}

// Le pone a la foto una hora de cierre, para probar el cronometro sin dejar
// temporizadores de diez minutos por ahi.
function ponerCierre(raiz, uid, cual, cuando) {
  const p = path.join(raiz, uid, 'vivo-' + cual + '.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.cierraEn = cuando;
  j.guardadoEn = Date.now();
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}

test('la carrera recupera a los apuntados y sigue abierta', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  // canal '' no abre socket a Twitch, pero el resto del camino es el de verdad.
  let j = minijuegos(c.raiz);
  j.carrera.abrir(uid, '', '!correr');
  ['Ana', 'Beto', 'Caro'].forEach((n) => j.carrera.apuntar(uid, n));

  j = reiniciar(c.raiz, uid);
  assert.strictEqual(j.carrera.rehacer(uid), true);
  const e = j.carrera.estado(uid);
  assert.deepStrictEqual(e.corredores.map((x) => x.nombre), ['Ana', 'Beto', 'Caro']);
  assert.strictEqual(e.abierta, true, 'la inscripcion sigue abierta');

  // Y sigue viva de verdad: entra alguien nuevo y la carrera se puede correr.
  assert.strictEqual(j.carrera.apuntar(uid, 'Zoe'), true);
  assert.strictEqual(j.carrera.correr(uid).resultado.length, 4);
  j.carrera.cancelar(uid);
});

test('el rey de la colina y su cola sobreviven', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.colina.abrir(uid, '');
  ['Ana', 'Beto', 'Caro'].forEach((n) => j.colina.entrar(uid, n));
  j.colina.siguiente(uid);
  const reyAntes = j.colina.estado(uid).rey.nombre;
  const peleadosAntes = j.colina.estado(uid).peleados;

  j = reiniciar(c.raiz, uid);
  assert.strictEqual(j.colina.rehacer(uid), true);
  const e = j.colina.estado(uid);
  assert.strictEqual(e.rey.nombre, reyAntes, 'sigue reinando el mismo');
  assert.strictEqual(e.peleados, peleadosAntes);
  assert.strictEqual(e.cola.length, 1);
  // Nadie puede quedarse trabado: tras el reinicio la pagina ya no esta
  // contando ningun combate, asi que los que peleaban vuelven a poder entrar.
  assert.deepStrictEqual(e.enCombate, []);
  assert.strictEqual(j.colina.entrar(uid, 'Zoe').ok, true);
  j.colina.cerrar(uid);
});

test('el cuadro de la batalla sobrevive a medio torneo', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.batalla.abrir(uid, '');
  ['Ana', 'Beto', 'Caro', 'Dani'].forEach((n) => j.batalla.entrar(uid, n));
  j.batalla.empezar(uid);
  j.batalla.resolverRonda(uid);
  const rondasAntes = j.batalla.estado(uid).rondas.length;

  j = reiniciar(c.raiz, uid);
  assert.strictEqual(j.batalla.rehacer(uid), true);
  assert.strictEqual(j.batalla.estado(uid).rondas.length, rondasAntes);
  assert.strictEqual(j.batalla.estado(uid).luchadores.length, 4);
  j.batalla.cancelar(uid);
});

test('lo apuntado para la ruleta de nombres sobrevive', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.nombres.abrir(uid, '', '!ruleta');
  ['Ana', 'Beto', 'Caro'].forEach((n) => j.nombres.apuntar(uid, n));

  j = reiniciar(c.raiz, uid);
  assert.strictEqual(j.nombres.rehacer(uid), true);
  assert.deepStrictEqual(j.nombres.estado(uid).nombres, ['Ana', 'Beto', 'Caro']);
  j.nombres.cerrar(uid);
});

test('el cronometro sigue contando desde donde estaba, no desde cero', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.carrera.abrir(uid, '', '!correr');
  j.carrera.apuntar(uid, 'Ana');
  // Cierra dentro de un rato: se guarda la HORA, no los segundos que quedaban,
  // asi que el tiempo que el servidor pasa apagado tiene que contar.
  const cuando = Date.now() + 4000;
  ponerCierre(c.raiz, uid, 'carrera', cuando);

  j = minijuegos(c.raiz);
  assert.strictEqual(j.carrera.rehacer(uid), true);
  const e = j.carrera.estado(uid);
  assert.ok(e.cierraEn > 0, 'se recupera la hora de cierre');
  assert.ok(Math.abs(e.cierraEn - cuando) < 1500,
    'y es la misma hora de antes, no un plazo nuevo empezando de cero');
  assert.strictEqual(j.carrera.apuntar(uid, 'Beto'), true, 'todavia entra gente');

  // Se cancela: de paso se lleva el temporizador que acaba de ponerse.
  j.carrera.cancelar(uid);
});

test('si al cronometro se le paso la hora estando apagado, la ronda queda cerrada', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.carrera.abrir(uid, '', '!correr');
  ['Ana', 'Beto'].forEach((n) => j.carrera.apuntar(uid, n));

  // El cierre en el pasado: es lo que pasa cuando el servidor estuvo apagado
  // mas de lo que quedaba de inscripcion.
  ponerCierre(c.raiz, uid, 'carrera', Date.now() - 5000);

  j = minijuegos(c.raiz);
  assert.strictEqual(j.carrera.rehacer(uid), true);
  const e = j.carrera.estado(uid);
  assert.deepStrictEqual(e.corredores.map((x) => x.nombre), ['Ana', 'Beto'],
    'los apuntados se recuperan igual');
  assert.strictEqual(e.escuchando, '', 'no se vuelve a entrar en el chat');
  assert.ok(e.cierraEn > 0, 'se sigue sabiendo cuando cerro');
  assert.strictEqual(j.carrera.apuntar(uid, 'Zoe'), false, 'ya no entra nadie nuevo');
  // Pero lo que quedaba por hacer se puede hacer: la carrera se corre.
  assert.strictEqual(j.carrera.correr(uid).resultado.length, 2);
  j.carrera.cancelar(uid);
});

test('una foto vieja se tira en vez de reaparecer en pantalla', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  let j = minijuegos(c.raiz);
  j.carrera.abrir(uid, '', '!correr');
  j.carrera.apuntar(uid, 'Ana');

  // Del dia anterior: un directo dura horas, no dias.
  const f = path.join(c.raiz, uid, 'vivo-carrera.json');
  const foto = JSON.parse(fs.readFileSync(f, 'utf8'));
  foto.guardadoEn = Date.now() - 13 * 60 * 60 * 1000;
  fs.writeFileSync(f, JSON.stringify(foto, null, 2));

  j = minijuegos(c.raiz);
  assert.strictEqual(j.carrera.rehacer(uid), false, 'no se recupera');
  assert.strictEqual(fs.existsSync(f), false, 'y la foto se borra');
  assert.deepStrictEqual(j.carrera.estado(uid).corredores, []);
});

test('una foto ilegible no impide arrancar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';
  fs.mkdirSync(path.join(c.raiz, uid), { recursive: true });
  const f = path.join(c.raiz, uid, 'vivo-carrera.json');
  fs.writeFileSync(f, 'esto no es json');

  const j = minijuegos(c.raiz);
  const quejas = sinRuido(() => {
    assert.strictEqual(j.carrera.rehacer(uid), false);
  });
  assert.strictEqual(fs.existsSync(f), false, 'se borra: reintentarla no la va a arreglar');
  assert.ok(quejas.some((q) => q.includes('Failed to read live carrera')),
    'y queda dicho en el registro, que si no nadie sabria que paso');
});

test('resolver la ronda tira la foto: el resultado no se rescata', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';

  const j = minijuegos(c.raiz);
  j.plinko.abrir(uid, '', '!tirar');
  ['Ana', 'Beto'].forEach((n) => j.plinko.apuntar(uid, n));
  assert.ok(fs.existsSync(path.join(c.raiz, uid, 'vivo-plinko.json')),
    'mientras se apuntan, hay foto');

  j.plinko.tirar(uid);
  assert.strictEqual(fs.existsSync(path.join(c.raiz, uid, 'vivo-plinko.json')), false,
    'ya tirado, lo que queda en pantalla es el resultado y no hay que rescatarlo');
});
