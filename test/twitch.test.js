// La conexion con Twitch: el aviso que se fija en el chat y los canjes.
//
// Aqui no se habla con Twitch de verdad: se cambia fetch por uno de mentira que
// apunta lo que se le pide y contesta lo que toca. Lo que se comprueba:
//
//  - Sin conectar, o con el aviso apagado, no se manda nada.
//  - Conectado, se escribe el aviso y se fija ese mismo mensaje, en el canal
//    de la cuenta y el tiempo que dure la inscripcion.
//  - Si la cuenta conectada no es la del canal que escuchan los minijuegos, no
//    se escribe en un chat donde nadie se esta apuntando.
//  - Un token caducado se refresca y se reintenta.
//  - Conectar Twitch no pone a regalar objetos por cualquier canje.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, cargar, deps } = require('./ayuda');

const CUENTA = {
  clientId: 'cid', clientSecret: 'secreto', accessToken: 'tok', refreshToken: 'ref',
  login: 'micanal', userId: '123', servidor: 's1', recompensa: '', objetos: 1
};

function montar(raiz, cuenta, sorteados) {
  const d = deps(raiz);
  d.sortearPara = async (uid, sid, nombre) => { if (sorteados) sorteados.push(nombre); return ['algo']; };
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  const twitch = cargar('twitch');
  twitch.iniciar(d, { usuarios: [] });
  if (cuenta) {
    fs.mkdirSync(path.join(raiz, 'u1'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'u1', 'twitch.json'), JSON.stringify(cuenta));
  }
  return twitch;
}

// Un fetch de mentira. `respuestas` son funciones (url, opciones) => {status,
// json}, una por llamada y en orden.
function fetchFalso(t, respuestas) {
  const antes = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, op = {}) => {
    // Helix va en JSON; el refresco del token, como formulario.
    let cuerpo = op.body ? String(op.body) : null;
    try { cuerpo = cuerpo && JSON.parse(cuerpo); } catch (e) { /* formulario */ }
    llamadas.push({ url: String(url), metodo: op.method || 'GET', cuerpo, cabeceras: op.headers || {} });
    const r = respuestas.shift();
    if (!r) throw new Error('llamada de mas: ' + url);
    const { status = 200, json = {} } = r(String(url), op) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  t.after(() => { globalThis.fetch = antes; });
  return llamadas;
}

const ENVIADO = () => ({ json: { data: [{ message_id: 'm-1', is_sent: true }] } });
const FIJADO = () => ({ status: 204 });

test('sin conectar no se manda nada', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, null);
  const llamadas = fetchFalso(t, []);
  const a = await twitch.fijarAviso('u1', 'micanal', 'Escribe !correr');
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.error, '', 'no es un fallo: es que no toca');
  assert.strictEqual(llamadas.length, 0);
});

test('conectado, escribe el aviso y fija ese mismo mensaje', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, [ENVIADO, FIJADO]);

  const a = await twitch.fijarAviso('u1', 'MiCanal', 'Escribe !correr para participar en la Carrera de balineras', 120);
  assert.strictEqual(a.ok, true, a.error);

  const [envio, fijo] = llamadas;
  assert.strictEqual(envio.metodo, 'POST');
  assert.ok(envio.url.endsWith('/helix/chat/messages'));
  assert.deepStrictEqual(envio.cuerpo, {
    broadcaster_id: '123', sender_id: '123',
    message: 'Escribe !correr para participar en la Carrera de balineras'
  });
  assert.strictEqual(envio.cabeceras.Authorization, 'Bearer tok');

  assert.strictEqual(fijo.metodo, 'PUT');
  const q = new URL(fijo.url).searchParams;
  assert.ok(fijo.url.includes('/helix/chat/pins?'));
  assert.strictEqual(q.get('message_id'), 'm-1', 'el mensaje que se acaba de escribir');
  assert.strictEqual(q.get('broadcaster_id'), '123');
  assert.strictEqual(q.get('moderator_id'), '123');
  assert.strictEqual(q.get('duration_seconds'), '120', 'lo que dura la inscripcion');
  assert.strictEqual(twitch.estado('u1').ultimoAviso.ok, true, 'y queda en el estado');
});

test('la duracion del fijado se queda entre lo que admite Twitch', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const duracion = async (segundos) => {
    const llamadas = fetchFalso(t, [ENVIADO, FIJADO]);
    await twitch.fijarAviso('u1', 'micanal', 'x', segundos);
    return new URL(llamadas[1].url).searchParams.get('duration_seconds');
  };
  assert.strictEqual(await duracion(undefined), '1200', 'sin cronometro, 20 minutos');
  assert.strictEqual(await duracion(5), '30', 'menos de 30 s no se puede');
  assert.strictEqual(await duracion(3600), '1800', 'ni mas de 30 min');
});

test('con el aviso apagado no se manda nada', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, { ...CUENTA, fijarAviso: false });
  const llamadas = fetchFalso(t, []);
  await twitch.fijarAviso('u1', 'micanal', 'x');
  assert.strictEqual(llamadas.length, 0);
  assert.strictEqual(twitch.estado('u1').fijarAviso, false);
});

test('si la cuenta conectada no es la del canal, no escribe en otro chat', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, []);
  const a = await twitch.fijarAviso('u1', 'otrocanal', 'x');
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /micanal.*otrocanal/);
  assert.strictEqual(llamadas.length, 0);
});

test('un token caducado se refresca y se reintenta', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, [
    () => ({ status: 401 }),
    () => ({ json: { access_token: 'nuevo', refresh_token: 'ref2' } }),
    ENVIADO,
    FIJADO
  ]);
  const a = await twitch.fijarAviso('u1', 'micanal', 'x');
  assert.strictEqual(a.ok, true, a.error);
  assert.strictEqual(llamadas[2].cabeceras.Authorization, 'Bearer nuevo', 'con el token nuevo');
  assert.strictEqual(twitch.leerCuenta('u1').accessToken, 'nuevo', 'y queda guardado');
});

test('sin permiso para escribir lo dice claro, para volver a conectar', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  fetchFalso(t, [() => ({ status: 403, json: { message: 'Missing scope: user:write:chat' } })]);
  const a = await twitch.fijarAviso('u1', 'micanal', 'x');
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /vuelve a conectar/);
});

test('si no se puede fijar, dice que el aviso si salio', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  fetchFalso(t, [ENVIADO, () => ({ status: 403, json: { message: 'nope' } })]);
  const a = await twitch.fijarAviso('u1', 'micanal', 'x');
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /salio en el chat/);
});

test('un fallo de red no rompe nada: se cuenta y ya', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  fetchFalso(t, [() => { throw new Error('sin red'); }]);
  const a = await twitch.fijarAviso('u1', 'micanal', 'x');
  assert.strictEqual(a.ok, false);
  assert.match(a.error, /sin red/);
});

test('sin recompensa configurada, los canjes no regalan nada', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const sorteados = [];
  const twitch = montar(c.raiz, CUENTA, sorteados);
  const evento = { reward: { title: 'Hidratate' }, user_name: 'Ana' };
  assert.strictEqual(await twitch.alCanjear('u1', evento), false);
  assert.deepStrictEqual(sorteados, [], 'conectar para los avisos no reparte objetos');

  // Con la suya puesta, solo esa.
  fs.writeFileSync(path.join(c.raiz, 'u1', 'twitch.json'), JSON.stringify({ ...CUENTA, recompensa: 'Regalo' }));
  assert.strictEqual(await twitch.alCanjear('u1', evento), false, 'otra recompensa, nada');
  assert.strictEqual(await twitch.alCanjear('u1', { reward: { title: 'regalo' }, user_name: 'Ana' }), true);
  assert.deepStrictEqual(sorteados, ['Ana']);
});

// --- Los cartones del bingo con puntos de canal ---

const CON_BINGO = { ...CUENTA, bingoRecompensa: { id: 'rw-1', titulo: 'Cartón', coste: 500 } };
const CANJE = { id: 'red-9', reward: { id: 'rw-1', title: 'Cartón' }, user_name: 'Ana', user_login: 'ana' };

function montarBingo(raiz, cuenta, respuesta) {
  const twitch = montar(raiz, cuenta);
  const dados = [];
  // montar() ya llamo a iniciar: se le vuelve a llamar con darCarton.
  const d = deps(raiz);
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  d.sortearPara = async () => [];
  d.darCarton = (uid, nombre) => { dados.push(nombre); return respuesta; };
  twitch.iniciar(d, { usuarios: [] });
  return { twitch, dados };
}

test('canjear la recompensa del bingo da carton y marca el canje como cumplido', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch, dados } = montarBingo(c.raiz, CON_BINGO, { ok: true, cartones: 1 });
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: { data: [] } })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE), true);
  assert.deepStrictEqual(dados, ['Ana']);
  assert.strictEqual(llamadas[0].metodo, 'PATCH');
  const q = new URL(llamadas[0].url).searchParams;
  assert.ok(llamadas[0].url.includes('/channel_points/custom_rewards/redemptions?'));
  assert.strictEqual(q.get('id'), 'red-9', 'ese canje');
  assert.strictEqual(q.get('reward_id'), 'rw-1');
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'FULFILLED' });
});

test('si no se le puede dar carton, el canje se cancela: se le devuelven los puntos', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch } = montarBingo(c.raiz, CON_BINGO, { ok: false, motivo: 'la venta de cartones esta cerrada' });
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: { data: [] } })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE), false);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'CANCELED' });
});

test('la recompensa del bingo va por su id, no por el titulo', async (t) => {
  // El streamer le puede cambiar el nombre desde Twitch y tiene que seguir
  // vendiendo cartones; y otra recompensa con el mismo nombre no los vende.
  const c = carpeta();
  t.after(c.quitar);
  const { twitch, dados } = montarBingo(c.raiz, CON_BINGO, { ok: true, cartones: 1 });
  fetchFalso(t, [() => ({ status: 200, json: { data: [] } })]);
  await twitch.alCanjear('u1', { ...CANJE, reward: { id: 'otra', title: 'Cartón' } });
  assert.deepStrictEqual(dados, [], 'otra recompensa con el mismo nombre, nada');
  await twitch.alCanjear('u1', { ...CANJE, reward: { id: 'rw-1', title: 'Renombrada' } });
  assert.deepStrictEqual(dados, ['Ana']);
});

test('crear la recompensa la guarda con su id, y la segunda vez la actualiza', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, [
    () => ({ json: { data: [{ id: 'rw-nueva' }] } }),
    () => ({ json: { data: [{ id: 'rw-nueva' }] } })
  ]);
  assert.deepStrictEqual(await twitch.recompensaBingo('u1', 'Cartón de bingo', 300), { ok: true });
  assert.strictEqual(llamadas[0].metodo, 'POST');
  assert.ok(llamadas[0].url.includes('/channel_points/custom_rewards?'));
  assert.strictEqual(llamadas[0].cuerpo.cost, 300);
  assert.strictEqual(llamadas[0].cuerpo.should_redemptions_skip_request_queue, false,
    'por la cola: si no, no se pueden devolver los puntos');
  assert.deepStrictEqual(twitch.leerCuenta('u1').bingoRecompensa, { id: 'rw-nueva', titulo: 'Cartón de bingo', coste: 300 });

  await twitch.recompensaBingo('u1', 'Cartón', 450);
  assert.strictEqual(llamadas[1].metodo, 'PATCH', 'ya existe: se actualiza, no se crea otra');
  assert.strictEqual(new URL(llamadas[1].url).searchParams.get('id'), 'rw-nueva');
  assert.strictEqual(twitch.leerCuenta('u1').bingoRecompensa.coste, 450);
});

test('sin ser afiliado, crear la recompensa lo dice claro', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  fetchFalso(t, [() => ({ status: 403, json: { message: 'The broadcaster must have partner or affiliate status.' } })]);
  const r = await twitch.recompensaBingo('u1', 'Cartón', 300);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /afiliados o partner/);
});

// --- La Ruleta de objetos con la recompensa que crea el Ruleton ---

const CON_RULETA = { ...CUENTA, recompensa: 'Vieja', objetosRecompensa: { id: 'rw-r', titulo: 'Ruleta', coste: 1000 } };
const CANJE_RULETA = { id: 'red-r', reward: { id: 'rw-r', title: 'Ruleta' }, user_name: 'Ana', user_login: 'ana' };

function montarRuleta(raiz, cuenta, puede) {
  const sorteados = [];
  const twitch = montar(raiz, cuenta, sorteados);
  const apuntados = [];
  const d = deps(raiz);
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  d.sortearPara = async (uid, sid, nombre) => { sorteados.push(nombre); return ['algo']; };
  d.apuntarTurno = (uid, turno) => { apuntados.push(turno); return puede; };
  twitch.iniciar(d, { usuarios: [] });
  return { twitch, apuntados, sorteados };
}

test('canjear la de la ruleta pone su nombre en la fila, sin sortear ni cerrar el canje', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch, apuntados, sorteados } = montarRuleta(c.raiz, CON_RULETA, true);
  const llamadas = fetchFalso(t, []);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_RULETA), true);
  assert.deepStrictEqual(apuntados, [{ id: 'red-r', recompensa: 'rw-r', nombre: 'Ana', login: 'ana' }]);
  assert.deepStrictEqual(sorteados, [], 'no sortea solo: la gira el streamer');
  assert.strictEqual(llamadas.length, 0, 'el canje se queda abierto hasta que se usa');
});

test('si no se le puede apuntar, se le devuelven los puntos', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch } = montarRuleta(c.raiz, CON_RULETA, false);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: { data: [] } })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_RULETA), false);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'CANCELED' });
  assert.strictEqual(new URL(llamadas[0].url).searchParams.get('id'), 'red-r');
});

test('al usar el turno el canje se cumple, y al quitarlo se cancela', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch } = montarRuleta(c.raiz, CON_RULETA, true);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: {} }), () => ({ status: 200, json: {} })]);
  assert.strictEqual(await twitch.cerrarCanje('u1', 'rw-r', 'red-r', true), true);
  assert.strictEqual(await twitch.cerrarCanje('u1', 'rw-r', 'red-s', false), true);
  assert.deepStrictEqual(llamadas.map((l) => l.cuerpo.status), ['FULFILLED', 'CANCELED']);
  assert.strictEqual(new URL(llamadas[1].url).searchParams.get('reward_id'), 'rw-r');
});

test('crear la de la ruleta la guarda y apaga la que se ponia por titulo', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, { ...CUENTA, recompensa: 'Vieja' });
  const llamadas = fetchFalso(t, [() => ({ json: { data: [{ id: 'rw-r' }] } })]);
  assert.deepStrictEqual(await twitch.recompensaObjetos('u1', '', 800), { ok: true });
  assert.strictEqual(llamadas[0].metodo, 'POST');
  assert.strictEqual(llamadas[0].cuerpo.title, 'Ruleta de objetos');
  assert.strictEqual(llamadas[0].cuerpo.should_redemptions_skip_request_queue, false);
  const cuenta = twitch.leerCuenta('u1');
  assert.deepStrictEqual(cuenta.objetosRecompensa, { id: 'rw-r', titulo: 'Ruleta de objetos', coste: 800 });
  assert.strictEqual(cuenta.recompensa, '', 'la vieja sorteaba sola: se apaga');
  assert.strictEqual(cuenta.bingoRecompensa, undefined, 'la del bingo no se toca');
  assert.deepStrictEqual(await twitch.recompensaObjetos('u1', 'x', 0), { ok: false, error: 'pon cuantos puntos cuesta la tirada' });
});

// --- La Ruleta de nombres con puntos de canal ---

const CON_NOMBRES = { ...CUENTA, nombresRecompensa: { id: 'rw-n', titulo: 'Nombres', coste: 500 } };
const CANJE_NOMBRES = { id: 'red-n', reward: { id: 'rw-n', title: 'Nombres' }, user_name: 'Ana', user_login: 'ana' };

function montarNombres(raiz, puede) {
  const twitch = montar(raiz, CON_NOMBRES);
  const apuntados = [];
  const d = deps(raiz);
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  d.apuntarNombre = (uid, nombre) => { apuntados.push(nombre); return puede; };
  twitch.iniciar(d, { usuarios: [] });
  return { twitch, apuntados };
}

test('canjear la de nombres le mete en la lista y cierra el canje como cumplido', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch, apuntados } = montarNombres(c.raiz, true);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: {} })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_NOMBRES), true);
  assert.deepStrictEqual(apuntados, ['Ana']);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'FULFILLED' });
  assert.strictEqual(new URL(llamadas[0].url).searchParams.get('id'), 'red-n');
});

test('si no puede entrar en la de nombres, se le devuelven los puntos', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch } = montarNombres(c.raiz, false);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: {} })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_NOMBRES), false);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'CANCELED' });
});

test('crear la de nombres la guarda sin tocar las otras', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, { ...CON_RULETA });
  const llamadas = fetchFalso(t, [() => ({ json: { data: [{ id: 'rw-n' }] } })]);
  assert.deepStrictEqual(await twitch.recompensaNombres('u1', '', 500), { ok: true });
  assert.strictEqual(llamadas[0].cuerpo.title, 'Ruleta de nombres');
  const cuenta = twitch.leerCuenta('u1');
  assert.deepStrictEqual(cuenta.nombresRecompensa, { id: 'rw-n', titulo: 'Ruleta de nombres', coste: 500 });
  assert.strictEqual(cuenta.recompensa, 'Vieja', 'la de objetos por titulo no se apaga');
  assert.deepStrictEqual(cuenta.objetosRecompensa, CON_RULETA.objetosRecompensa);
});

// --- La Batalla Dofus con puntos de canal ---

const CON_BATALLA = { ...CUENTA, batallaRecompensa: { id: 'rw-b', titulo: 'Pelea', coste: 300 } };
const CANJE_BATALLA = { id: 'red-b', reward: { id: 'rw-b', title: 'Pelea' }, user_name: 'Ana', user_login: 'ana' };

function montarBatalla(raiz, puede) {
  const twitch = montar(raiz, CON_BATALLA);
  const apuntados = [];
  const d = deps(raiz);
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  d.apuntarLuchador = (uid, nombre) => { apuntados.push(nombre); return puede; };
  twitch.iniciar(d, { usuarios: [] });
  return { twitch, apuntados };
}

test('canjear la de la batalla le mete en el torneo y cierra el canje como cumplido', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch, apuntados } = montarBatalla(c.raiz, true);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: {} })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_BATALLA), true);
  assert.deepStrictEqual(apuntados, ['Ana']);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'FULFILLED' });
  assert.strictEqual(new URL(llamadas[0].url).searchParams.get('id'), 'red-b');
  assert.strictEqual(twitch.tituloBatalla('u1'), 'Pelea');
});

test('si no puede entrar en la batalla, se le devuelven los puntos', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const { twitch } = montarBatalla(c.raiz, false);
  const llamadas = fetchFalso(t, [() => ({ status: 200, json: {} })]);
  assert.strictEqual(await twitch.alCanjear('u1', CANJE_BATALLA), false);
  assert.deepStrictEqual(llamadas[0].cuerpo, { status: 'CANCELED' });
});

test('crear la de la batalla la guarda sin tocar las otras', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, { ...CON_RULETA });
  assert.strictEqual(twitch.tituloBatalla('u1'), '', 'sin recompensa se entra por el chat');
  const llamadas = fetchFalso(t, [() => ({ json: { data: [{ id: 'rw-b' }] } })]);
  assert.deepStrictEqual(await twitch.recompensaBatalla('u1', '', 300), { ok: true });
  assert.strictEqual(llamadas[0].cuerpo.title, 'Batalla Dofus');
  const cuenta = twitch.leerCuenta('u1');
  assert.deepStrictEqual(cuenta.batallaRecompensa, { id: 'rw-b', titulo: 'Batalla Dofus', coste: 300 });
  assert.strictEqual(cuenta.recompensa, 'Vieja', 'la de objetos por titulo no se apaga');
  assert.deepStrictEqual(cuenta.objetosRecompensa, CON_RULETA.objetosRecompensa);
});

test('dos peticiones a la vez no crean dos recompensas', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, { ...CUENTA });
  const llamadas = fetchFalso(t, [
    () => ({ json: { data: [{ id: 'rw-b' }] } }),
    () => ({ json: { data: [{ id: 'rw-b' }] } })
  ]);
  const [una, otra] = await Promise.all([
    twitch.recompensaBatalla('u1', 'Pelea', 300),
    twitch.recompensaBatalla('u1', 'Pelea', 300)
  ]);
  assert.deepStrictEqual(una, { ok: true });
  assert.strictEqual(otra.ok, false, 'la segunda no crea otra');
  assert.deepStrictEqual(llamadas.map((l) => l.metodo), ['POST'], 'una sola llamada a Twitch');
  // Acabada la primera, otra peticion ya actualiza la que hay.
  assert.deepStrictEqual(await twitch.recompensaBatalla('u1', 'Pelea', 400), { ok: true });
  assert.strictEqual(llamadas[1].metodo, 'PATCH', 'actualiza, no crea otra');
  assert.strictEqual(twitch.leerCuenta('u1').batallaRecompensa.coste, 400);
});

// --- La vuelta de la autorizacion ---

test('la vuelta de Twitch sigue valiendo aunque el servidor se reinicie', (t) => {
  // El fallo: el state vivia en memoria, y «npm run dev» reinicia el servidor
  // al cambiar el codigo. Si pasaba mientras se autorizaba en Twitch, a la
  // vuelta salia «Vuelta de Twitch no valida».
  const c = carpeta();
  t.after(c.quitar);
  let twitch = montar(c.raiz, CUENTA);
  const state = new URL(twitch.urlDeAutorizacion('u1')).searchParams.get('state');
  twitch = montar(c.raiz, null);   // reinicio: el modulo se carga de nuevo
  assert.strictEqual(twitch.uidDelState(state), 'u1');
  assert.strictEqual(twitch.uidDelState(state), null, 'y solo vale una vez');
});

test('una vuelta con un state falso o raro no vale', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const state = new URL(twitch.urlDeAutorizacion('u1')).searchParams.get('state');
  assert.strictEqual(twitch.uidDelState('u1.' + 'f'.repeat(32)), null, 'otro secreto');
  assert.strictEqual(twitch.uidDelState('../u1.' + state.split('.').pop()), null, 'salirse de la carpeta');
  assert.strictEqual(twitch.uidDelState(''), null);
  assert.strictEqual(twitch.uidDelState('sinpunto'), null);
  assert.strictEqual(twitch.uidDelState(state), 'u1', 'el bueno sigue valiendo');
});

test('la Redirect URL es la del dominio por el que se entra, y se canjea con la misma', async (t) => {
  // El fallo: sin TWITCH_REDIRECT se mandaba siempre localhost, y en un hosting
  // Twitch contestaba «The provided redirect_uri does not match».
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const vuelta = 'https://dofusspin.com/api/twitch/callback';
  const url = new URL(twitch.urlDeAutorizacion('u1', vuelta));
  assert.strictEqual(url.searchParams.get('redirect_uri'), vuelta);
  assert.strictEqual(twitch.estado('u1', vuelta).redireccion, vuelta, 'y es la que se ensena en Configuracion');

  assert.strictEqual(twitch.uidDelState(url.searchParams.get('state')), 'u1');
  const llamadas = fetchFalso(t, [
    () => ({ json: { access_token: 'a', refresh_token: 'r' } }),
    () => ({ json: { data: [{ login: 'micanal', id: '123' }] } })
  ]);
  await twitch.completarAlta('u1', 'el-codigo');
  assert.strictEqual(new URLSearchParams(llamadas[0].cuerpo).get('redirect_uri'), vuelta,
    'el codigo se canjea con la misma Redirect URL, o Twitch lo rechaza');
});

// --- La app de Twitch del Ruleton, comun a todos ---

function montarConApp(raiz, cuenta) {
  const d = deps(raiz);
  d.sortearPara = async () => [];
  d.servidoresDe = () => [{ id: 's1', name: 'Principal' }];
  const twitch = cargar('twitch');
  twitch.iniciar(d, { usuarios: [], clientId: 'app-comun', clientSecret: 'secreto-comun' });
  if (cuenta) {
    fs.mkdirSync(path.join(raiz, 'u1'), { recursive: true });
    fs.writeFileSync(path.join(raiz, 'u1', 'twitch.json'), JSON.stringify(cuenta));
  }
  return twitch;
}

test('con la app comun, conectar no pide credenciales a nadie', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montarConApp(c.raiz, null);   // sin archivo siquiera
  assert.strictEqual(twitch.hayCredenciales('u1'), true);
  const e = twitch.estado('u1');
  assert.strictEqual(e.appComun, true);
  assert.strictEqual(e.propia, false);

  const url = new URL(twitch.urlDeAutorizacion('u1', 'https://dofusspin.com/api/twitch/callback'));
  assert.strictEqual(url.searchParams.get('client_id'), 'app-comun');
  assert.strictEqual(twitch.uidDelState(url.searchParams.get('state')), 'u1');

  const llamadas = fetchFalso(t, [
    () => ({ json: { access_token: 'a', refresh_token: 'r' } }),
    () => ({ json: { data: [{ login: 'micanal', id: '123' }] } })
  ]);
  await twitch.completarAlta('u1', 'codigo');
  const canje = new URLSearchParams(llamadas[0].cuerpo);
  assert.strictEqual(canje.get('client_id'), 'app-comun');
  assert.strictEqual(canje.get('client_secret'), 'secreto-comun');
  assert.strictEqual(llamadas[1].cabeceras['Client-Id'], 'app-comun');
  const guardada = twitch.leerCuenta('u1');
  assert.strictEqual(guardada.clientSecret, '', 'el secreto comun no se copia a la cuenta de nadie');
  assert.strictEqual(guardada.login, 'micanal');
});

test('quien tiene su propia app la sigue usando aunque haya comun', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montarConApp(c.raiz, CUENTA);
  const url = new URL(twitch.urlDeAutorizacion('u1'));
  assert.strictEqual(url.searchParams.get('client_id'), 'cid', 'la suya, no la comun');
  assert.strictEqual(twitch.estado('u1').propia, true);
});

test('sin app comun ni propia no se puede conectar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, null);
  assert.strictEqual(twitch.hayCredenciales('u1'), false);
  assert.strictEqual(twitch.estado('u1').appComun, false);
});

test('la vuelta caduca a los diez minutos', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const state = new URL(twitch.urlDeAutorizacion('u1')).searchParams.get('state');
  const cuenta = twitch.leerCuenta('u1');
  cuenta.oauthState.caduca = Date.now() - 1;
  fs.writeFileSync(path.join(c.raiz, 'u1', 'twitch.json'), JSON.stringify(cuenta));
  assert.strictEqual(twitch.uidDelState(state), null);
});

test('se piden los permisos de escribir y fijar', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const scope = new URL(twitch.urlDeAutorizacion('u1')).searchParams.get('scope').split(' ');
  for (const p of ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:chat_messages']) {
    assert.ok(scope.includes(p), 'pide ' + p);
  }
});

test('el aviso dice que escribir y en que minijuego', () => {
  const { aviso } = cargar('rutas/minijuegos');
  assert.strictEqual(aviso('!correr', 'la Carrera de balineras'), 'Escribe !correr para participar en la Carrera de balineras');
  assert.strictEqual(aviso('!carton', 'el Bingo', 'mira tu cartón en x'), 'Escribe !carton para participar en el Bingo · mira tu cartón en x');
});

// Cada reinicio o despliegue deja su suscripcion a los canjes, y Twitch acaba
// contestando 429. Se quitan las de otras conexiones y se reintenta una vez.
test('con 429 se quitan las suscripciones viejas y se reintenta', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, [
    () => ({ status: 429, json: { message: 'maximum subscriptions with type and condition exceeded' } }),
    () => ({ json: { data: [
      { id: 'vieja', condition: { broadcaster_user_id: '123' }, transport: { method: 'websocket', session_id: 'antes' } },
      { id: 'esta', condition: { broadcaster_user_id: '123' }, transport: { method: 'websocket', session_id: 'ahora' } },
      { id: 'otro-canal', condition: { broadcaster_user_id: '999' }, transport: { method: 'websocket', session_id: 'antes' } }
    ] } }),
    () => ({ status: 204 }),
    () => ({ status: 202 })
  ]);
  await twitch.suscribir('u1', 'ahora');
  assert.deepStrictEqual(llamadas.map((l) => l.metodo + ' ' + l.url.replace('https://api.twitch.tv/helix', '')), [
    'POST /eventsub/subscriptions',
    'GET /eventsub/subscriptions?type=channel.channel_points_custom_reward_redemption.add',
    'DELETE /eventsub/subscriptions?id=vieja',
    'POST /eventsub/subscriptions'
  ]);
});

test('con 429 y nada que quitar no se insiste', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const llamadas = fetchFalso(t, [
    () => ({ status: 429, json: {} }),
    () => ({ json: { data: [] } })
  ]);
  await twitch.suscribir('u1', 'ahora');
  assert.strictEqual(llamadas.length, 2);
});

// Un WebSocket de mentira: se apuntan los que se abren y se les hace hablar.
function wsFalso(t) {
  const antes = globalThis.WebSocket;
  const abiertos = [];
  globalThis.WebSocket = class {
    constructor(url) { this.url = url; this.oyentes = {}; this.cerrado = false; abiertos.push(this); }
    addEventListener(tipo, f) { (this.oyentes[tipo] = this.oyentes[tipo] || []).push(f); }
    close() { if (this.cerrado) return; this.cerrado = true; (this.oyentes.close || []).forEach((f) => f()); }
    async decir(msg) { for (const f of this.oyentes.message || []) await f({ data: JSON.stringify(msg) }); }
  };
  t.after(() => { globalThis.WebSocket = antes; });
  return abiertos;
}

const bienvenida = (id) => ({ metadata: { message_type: 'session_welcome' }, payload: { session: { id } } });

test('al mudarse de conexion no se vuelve a suscribir, y la vieja se cierra al final', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const twitch = montar(c.raiz, CUENTA);
  const abiertos = wsFalso(t);
  const llamadas = fetchFalso(t, [() => ({ status: 202 })]);
  twitch.escuchar('u1');
  await abiertos[0].decir(bienvenida('s1'));
  assert.strictEqual(llamadas.length, 1);

  await abiertos[0].decir({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://otra' } } });
  assert.strictEqual(abiertos[1].url, 'wss://otra');
  assert.strictEqual(abiertos[0].cerrado, false, 'la vieja sigue hasta que la nueva este lista');

  await abiertos[1].decir(bienvenida('s2'));
  assert.strictEqual(abiertos[0].cerrado, true);
  assert.strictEqual(llamadas.length, 1, 'las suscripciones se mudan solas');
  twitch.cerrar('u1');
});
