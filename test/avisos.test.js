// Los avisos de que algo cambio.
//
// Aqui hay dos cosas que si se rompen no se ve hasta que duele:
//
//  - Que los avisos seguidos se junten. Sin eso, cuarenta personas apuntandose
//    son cuarenta avisos y cuarenta peticiones del cliente para pintar lo mismo.
//  - Que al cerrarse una conexion se suelte el oyente. Sin eso, cada pestaña
//    que se cierra deja aqui basura a la que se sigue avisando, y eso crece
//    hasta tirar el servidor. Es el tipo de fuga que en desarrollo no se ve.

const { test } = require('node:test');
const assert = require('node:assert');
const { cargar } = require('./ayuda');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('solo se avisa a quien mira esa cuenta', () => {
  const avisos = cargar('avisos');
  const deU1 = [];
  const deU2 = [];
  const soltar1 = avisos.escuchar('u1', (j) => deU1.push(j));
  const soltar2 = avisos.escuchar('u2', (j) => deU2.push(j));

  avisos.cambio('u1', 'carrera');
  assert.deepStrictEqual(deU1, ['carrera']);
  assert.deepStrictEqual(deU2, [], 'lo de una cuenta no se cuela en la otra');

  soltar1();
  soltar2();
  assert.strictEqual(avisos.cuantos(), 0);
});

test('avisar sin nadie escuchando no revienta', () => {
  const avisos = cargar('avisos');
  assert.strictEqual(avisos.cuantos(), 0);
  avisos.cambio('nadie', 'carrera');
  assert.strictEqual(avisos.cuantos(), 0);
});

test('un oyente roto no impide avisar a los demas', () => {
  const avisos = cargar('avisos');
  const llegaron = [];
  const soltarMalo = avisos.escuchar('u1', () => { throw new Error('roto'); });
  const soltarBueno = avisos.escuchar('u1', (j) => llegaron.push(j));

  avisos.cambio('u1', 'colina');
  assert.deepStrictEqual(llegaron, ['colina']);

  soltarMalo();
  soltarBueno();
});

test('cuarenta cambios seguidos se juntan en un solo aviso', async () => {
  const avisos = cargar('avisos');
  const sueltas = [];
  const soltar = avisos.escucharJuntando('u1', 30, (juegos) => sueltas.push(juegos));

  for (let i = 0; i < 40; i++) avisos.cambio('u1', 'carrera');
  await espera(100);

  assert.strictEqual(sueltas.length, 1, 'una sola suelta');
  assert.deepStrictEqual(sueltas[0], ['carrera'], 'y un solo juego dentro');
  soltar();
});

test('dos juegos a la vez salen los dos, cada uno una vez', async () => {
  const avisos = cargar('avisos');
  const sueltas = [];
  const soltar = avisos.escucharJuntando('u1', 30, (juegos) => sueltas.push(juegos));

  avisos.cambio('u1', 'carrera');
  avisos.cambio('u1', 'colina');
  avisos.cambio('u1', 'carrera');
  await espera(100);

  assert.strictEqual(sueltas.length, 1);
  assert.deepStrictEqual(sueltas[0].slice().sort(), ['carrera', 'colina']);
  soltar();
});

test('lo que cambia despues de una suelta va en la siguiente', async () => {
  const avisos = cargar('avisos');
  const sueltas = [];
  const soltar = avisos.escucharJuntando('u1', 30, (juegos) => sueltas.push(juegos));

  avisos.cambio('u1', 'carrera');
  await espera(100);
  avisos.cambio('u1', 'plinko');
  await espera(100);

  assert.deepStrictEqual(sueltas, [['carrera'], ['plinko']]);
  soltar();
});

test('al soltar se va el oyente y no llega nada mas', async () => {
  const avisos = cargar('avisos');
  const sueltas = [];
  const soltar = avisos.escucharJuntando('u1', 30, (juegos) => sueltas.push(juegos));
  assert.strictEqual(avisos.cuantos(), 1);

  soltar();
  assert.strictEqual(avisos.cuantos(), 0, 'no queda ni rastro del oyente');

  avisos.cambio('u1', 'carrera');
  await espera(100);
  assert.deepStrictEqual(sueltas, [], 'y lo que pase despues no le llega');
});

test('soltar con una junta a medias no deja el aviso colgado', async () => {
  const avisos = cargar('avisos');
  const sueltas = [];
  const soltar = avisos.escucharJuntando('u1', 50, (juegos) => sueltas.push(juegos));

  // Se avisa y se suelta ANTES de que la junta llegue a soltar: es exactamente
  // lo que pasa cuando alguien recarga la pagina justo mientras se apunta gente.
  avisos.cambio('u1', 'carrera');
  soltar();
  await espera(150);

  assert.deepStrictEqual(sueltas, [], 'no se llama a una conexion que ya no esta');
  assert.strictEqual(avisos.cuantos(), 0);
});

test('los cinco minijuegos avisan al cambiar', (t) => {
  const { carpeta, minijuegos } = require('./ayuda');
  const c = carpeta();
  t.after(c.quitar);
  const uid = 'u1';
  const avisados = [];
  const j = minijuegos(c.raiz, avisados);

  const cuenta = (fn) => { avisados.length = 0; fn(); return avisados.length; };

  assert.ok(cuenta(() => j.carrera.abrir(uid, '', '!correr')) > 0, 'carrera abrir');
  assert.strictEqual(cuenta(() => j.carrera.apuntar(uid, 'Ana')), 1, 'carrera apuntar');
  assert.strictEqual(cuenta(() => j.carrera.apuntar(uid, 'Ana')), 0,
    'un apuntado repetido no cambia nada, asi que no avisa');
  assert.ok(cuenta(() => { j.carrera.apuntar(uid, 'Beto'); j.carrera.correr(uid); }) > 0, 'carrera correr');

  assert.ok(cuenta(() => j.plinko.abrir(uid, '', '!tirar')) > 0, 'plinko abrir');
  assert.strictEqual(cuenta(() => j.plinko.apuntar(uid, 'Ana')), 1, 'plinko apuntar');
  assert.ok(cuenta(() => j.plinko.tirar(uid)) > 0, 'plinko tirar');

  assert.ok(cuenta(() => j.batalla.abrir(uid, '')) > 0, 'batalla abrir');
  assert.strictEqual(cuenta(() => j.batalla.entrar(uid, 'Ana').ok, true), 1, 'batalla entrar');
  assert.ok(cuenta(() => {
    ['Beto', 'Caro', 'Dani'].forEach((n) => j.batalla.entrar(uid, n));
    j.batalla.empezar(uid);
  }) > 0, 'batalla empezar');
  assert.ok(cuenta(() => j.batalla.resolverRonda(uid)) > 0, 'batalla resolver');

  assert.ok(cuenta(() => j.colina.abrir(uid, '')) > 0, 'colina abrir');
  assert.strictEqual(cuenta(() => j.colina.entrar(uid, 'Ana')), 1, 'colina entrar');
  assert.ok(cuenta(() => { j.colina.entrar(uid, 'Beto'); j.colina.siguiente(uid); }) > 0, 'colina combate');
  assert.ok(cuenta(() => j.colina.destronar(uid)) > 0, 'colina destronar');

  assert.ok(cuenta(() => j.nombres.abrir(uid, '', '!ruleta')) > 0, 'nombres abrir');
  assert.strictEqual(cuenta(() => j.nombres.apuntar(uid, 'Ana')), 1, 'nombres apuntar');
  assert.ok(cuenta(() => j.nombres.vaciar(uid)) > 0, 'nombres vaciar');

  // Los cronometros dejan temporizadores puestos.
  j.carrera.cancelar(uid);
  j.plinko.cancelar(uid);
  j.batalla.cancelar(uid);
  j.colina.cerrar(uid);
  j.nombres.cerrar(uid);
});
