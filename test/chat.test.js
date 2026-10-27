// Saber si Twitch nos dejo entrar en el canal.
//
// Esto es lo que hacia falta y no estaba. El socket de Twitch abre igual
// escribas bien el canal o lo escribas mal; lo que cambia es que en un canal que
// no existe NO contesta al JOIN. Comprobado contra el IRC de verdad:
//
//   canalquenoexistejamas99xyz   readyState=1   001 002 003 004 375 372 376
//   twitch                       readyState=1   001 002 003 004 375 372 376 JOIN 353 366
//
// Sin mirar esa respuesta, un canal mal escrito se ve exactamente igual que un
// chat en el que todavia no ha escrito nadie, y la pagina decia que estaba
// escuchando en los dos casos.
//
// Aqui no se toca la red: se prueba el reconocedor de lineas, que es donde
// puede fallar de verdad, y que un minijuego que no escucha no se inventa salud.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, minijuegos } = require('./ayuda');

const chat = cargar('chat');

test('el eco del propio JOIN cuenta como entrada', () => {
  const l = ':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #micanal';
  assert.strictEqual(chat.esEntrada(l, 'micanal'), true);
});

test('el 366 (fin de la lista de nombres) tambien cuenta', () => {
  const l = ':justinfan12345.tmi.twitch.tv 366 justinfan12345 #micanal :End of /NAMES list';
  assert.strictEqual(chat.esEntrada(l, 'micanal'), true);
});

test('la bienvenida de Twitch NO cuenta como entrada', () => {
  // Estas son las que llegan igual en un canal que no existe. Si alguna colara,
  // el aviso no saltaria nunca y volveriamos a donde estabamos.
  const bienvenida = [
    ':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!',
    ':tmi.twitch.tv 002 justinfan12345 :Your host is tmi.twitch.tv',
    ':tmi.twitch.tv 003 justinfan12345 :This server is rather new',
    ':tmi.twitch.tv 004 justinfan12345 :-',
    ':tmi.twitch.tv 375 justinfan12345 :-',
    ':tmi.twitch.tv 372 justinfan12345 :You are in a maze of twisty passages',
    ':tmi.twitch.tv 376 justinfan12345 :>'
  ];
  for (const l of bienvenida) {
    assert.strictEqual(chat.esEntrada(l, 'micanal'), false, 'no cuenta: ' + l);
  }
});

test('la entrada de OTRO canal no cuenta', () => {
  // Con un canal parecido no vale: 'micanal' no es 'micanal2'.
  const join = ':justinfan1!j@j.tmi.twitch.tv JOIN #otrocanal';
  assert.strictEqual(chat.esEntrada(join, 'micanal'), false);
  const n366 = ':j.tmi.twitch.tv 366 justinfan1 #micanal2 :End of /NAMES list';
  assert.strictEqual(chat.esEntrada(n366, 'micanal'), false);
  const parecido = ':j.tmi.twitch.tv 366 justinfan1 #micana :End of /NAMES list';
  assert.strictEqual(chat.esEntrada(parecido, 'micanal'), false);
});

test('da igual como se escriban las mayusculas', () => {
  const l = ':justinfan1!j@j.tmi.twitch.tv JOIN #MiCanal';
  assert.strictEqual(chat.esEntrada(l, 'micanal'), true);
});

test('un mensaje del chat no es una entrada', () => {
  const l = ':ana!ana@ana.tmi.twitch.tv PRIVMSG #micanal :!correr';
  assert.strictEqual(chat.esEntrada(l, 'micanal'), false);
});

test('sin canal, nada cuenta como entrada', () => {
  const l = ':justinfan1!j@j.tmi.twitch.tv JOIN #micanal';
  assert.strictEqual(chat.esEntrada(l, ''), false);
  assert.strictEqual(chat.esEntrada(l, null), false);
});

test('una linea rota no revienta ni cuenta', () => {
  for (const l of ['', null, undefined, 'JOIN #micanal', ':solo', '366']) {
    assert.strictEqual(chat.esEntrada(l, 'micanal'), false, 'no cuenta: ' + JSON.stringify(l));
  }
});

test('un minijuego que no escucha dice que no hay salud, no que todo va bien', (t) => {
  // Es la diferencia que importa: null es «no se esta escuchando», y la pagina
  // no pinta aviso. Lo que no puede pasar es que diga que esta escuchando.
  const c = carpeta();
  t.after(c.quitar);
  const j = minijuegos(c.raiz);
  const uid = 'u1';

  assert.strictEqual(j.carrera.estado(uid).chat, null);
  assert.strictEqual(j.plinko.estado(uid).chat, null);
  assert.strictEqual(j.colina.estado(uid).chat, null);
  assert.strictEqual(j.nombres.estado(uid).chat, null);
});

test('los minijuegos que leen el chat cuentan como va', (t) => {
  // Con canal '' no se abre ningun socket (asi funcionan todos los tests), pero
  // la escucha existe, y lo que tiene que decir es que no hay canal, no callarse.
  const c = carpeta();
  t.after(c.quitar);
  const j = minijuegos(c.raiz);
  const uid = 'u1';

  j.carrera.abrir(uid, '', '!correr');
  j.plinko.abrir(uid, '', '!tirar');
  j.colina.abrir(uid, '');
  j.nombres.abrir(uid, '', '!ruleta');

  // La batalla no: se entra canjeando puntos del canal, no lee el chat.
  for (const [nombre, m] of Object.entries(j).filter(([n]) => n !== 'batalla')) {
    const salud = m.estado(uid).chat;
    assert.ok(salud, nombre + ': hay salud que contar');
    assert.strictEqual(salud.dentro, false, nombre + ': no se ha entrado en ningun canal');
    assert.ok(salud.problema, nombre + ': y lo dice');
    assert.strictEqual(salud.grave, true, nombre + ': y dice que hay que arreglarlo');
  }

  j.carrera.cancelar(uid);
  j.plinko.cancelar(uid);
  j.colina.cerrar(uid);
  j.nombres.cerrar(uid);
});

// 7TV, Chatterino y compania pegan un caracter invisible al mensaje repetido
// para que Twitch no lo bloquee. Tiene que seguir contando.
test('la palabra cuenta aunque lleve caracteres invisibles', () => {
  const { esLaPalabra } = cargar('chat');
  assert.strictEqual(esLaPalabra('!reto \u{E0000}', '!reto'), true);
  assert.strictEqual(esLaPalabra('!reto\u{E0000}', '!reto'), true);
  assert.strictEqual(esLaPalabra('​!reto', '!reto'), true);
  assert.strictEqual(esLaPalabra('!reto͏', '!reto'), true);
  assert.strictEqual(esLaPalabra('!retos', '!reto'), false);
});

test('la batalla no lee el chat: se entra canjeando la recompensa', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { deps } = require('./ayuda');
  const batalla = cargar('batalla', { ...deps(c.raiz), recompensa: () => 'Pelea' });
  const uid = 'u1';

  assert.strictEqual(batalla.entrarCanje(uid, 'Ana'), false, 'sin batalla abierta, puntos devueltos');
  batalla.abrir(uid);
  const e = batalla.estado(uid);
  assert.strictEqual(e.chat, undefined, 'no hay escucha del chat');
  assert.strictEqual(e.recompensa, 'Pelea');

  assert.strictEqual(batalla.entrarCanje(uid, 'Ana'), true);
  assert.strictEqual(batalla.entrarCanje(uid, 'ana'), false, 'ya estaba dentro');
  batalla.entrarCanje(uid, 'Beto');
  batalla.empezar(uid);
  assert.strictEqual(batalla.entrarCanje(uid, 'Caro'), false, 'el torneo ya empezo');
  assert.deepStrictEqual(batalla.estado(uid).luchadores.map((l) => l.nombre), ['Ana', 'Beto']);
  batalla.cancelar(uid);
});
