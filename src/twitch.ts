// Conexion con Twitch, con la cuenta del propio streamer. Sirve para dos cosas:
//
//  - Fijar en el chat el aviso de cada minijuego al abrir su inscripcion
//    («Escribe !correr para participar en la Carrera de balineras»).
//  - Los canjes de puntos de canal: cuando alguien canjea la recompensa que se
//    haya configurado, se sortea un objeto y ese espectador queda como ganador.
//  - La Ruleta de objetos con la recompensa que crea el Ruleton: quien la
//    canjea queda en la fila de turnos y su nombre va a la ruleta de la
//    pagina, para que el streamer se la gire en directo (ver turnosruleta.ts).
//  - La Ruleta de nombres con otra recompensa que crea el Ruleton: quien la
//    canjea con la inscripcion abierta entra en la lista (ver ruletachat.ts).
//  - La Batalla Dofus, igual: es la unica forma de entrar en el torneo
//    (ver batalla.ts).
//  - Los cartones del bingo: se compran canjeando una recompensa que crea el
//    propio Ruleton. La crea el, y no el streamer a mano, porque Twitch solo
//    deja devolver los puntos de las recompensas creadas por la misma app: si
//    no se le puede dar carton (no hay partida, esta cerrada, o ya tiene el
//    maximo), se le devuelven.
//
// Casi todo vive aqui a proposito, para tocar server.ts lo menos posible.
//
// Cada usuario de la plataforma pone SUS credenciales, porque cada streamer
// registra su propia app en https://dev.twitch.tv/console/apps y conecta su
// propio canal. En la app hay que poner, como "OAuth Redirect URL", la misma
// direccion que se le pasa aqui (por defecto
// http://localhost:3000/api/twitch/callback).
//
// El Client Secret se guarda junto a los tokens, en la carpeta del usuario, y
// NO sale nunca hacia el navegador: del estado solo se dice si esta puesto.
//
// Los permisos que se piden son los minimos para esto: leer los canjes del
// canal, escribir en el chat y fijar mensajes. El aviso sale con la cuenta del
// streamer, que es la duena del canal y por eso puede fijar. Leer el chat no se
// pide: los minijuegos lo leen como anonimos (ver chat.ts).
//
// Quien conecto antes de que se pidiera escribir tiene un token sin esos
// permisos. No se nota hasta que se intenta fijar algo: entonces Twitch dice
// que no, y el estado lo cuenta para que vuelva a conectar.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const AUTORIZAR = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
const PERMISOS = ['channel:read:redemptions', 'channel:manage:redemptions', 'user:write:chat', 'moderator:manage:chat_messages'];

// Lo que se guarda de cada usuario. Va en su carpeta, nunca en settings.json,
// porque eso se le manda al navegador y aqui hay credenciales.
interface TwitchCuenta {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  login: string;        // el canal que salio al autorizar, en minusculas
  userId: string;       // el id del canal en Twitch
  servidor: string;     // en que servidor del Ruleton se apuntan los premios
  // El titulo de la recompensa que sortea objetos. Vacio = apagado: conectar
  // Twitch para fijar avisos no puede ponerse a regalar objetos por cualquier
  // canje sin que nadie lo haya pedido.
  recompensa: string;
  objetos: number;      // cuantos objetos se sortean por canje
  // Si se fija el aviso en el chat al abrir una inscripcion. Sin decir nada,
  // si: es para lo que se conecta casi siempre.
  fijarAviso?: boolean;
  // La recompensa que vende cartones del bingo, tal como se creo en Twitch.
  bingoRecompensa?: RecompensaBingo;
  // La que da un turno en la Ruleta de objetos, creada igual.
  objetosRecompensa?: RecompensaBingo;
  // La que apunta en la Ruleta de nombres, creada igual.
  nombresRecompensa?: RecompensaBingo;
  // La que apunta en la Batalla Dofus, creada igual.
  batallaRecompensa?: RecompensaBingo;
  // El state de la autorizacion en curso. Ver urlDeAutorizacion.
  oauthState?: { secreto: string; caduca: number; redireccion?: string };
  // La Redirect URL con la que se pidio la ultima autorizacion. Al canjear el
  // codigo hay que mandar la MISMA, o Twitch lo rechaza.
  oauthRedireccion?: string;
}

export interface RecompensaBingo {
  id: string;
  titulo: string;
  coste: number;
}

// Lo que server.ts tiene que prestarle a este modulo. Se pasa asi para no
// tener que exportar medio server.ts ni duplicar su logica.
export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Sortea n objetos del servidor indicado y apunta al ganador. Devuelve los
  // nombres de lo que ha tocado, para poder decirlo por consola.
  sortearPara(uid: string, sid: string, nombre: string, n: number): Promise<string[]>;
  servidoresDe(uid: string): { id: string; name: string }[];
  // Le da un carton del bingo. Si no puede, dice por que (y se devuelven los
  // puntos). Ver bingo.ts.
  darCarton?(uid: string, nombre: string, login: string): { ok: boolean; motivo?: string };
  // Le apunta un turno en la Ruleta de objetos. false si no se puede (y se
  // devuelven los puntos). Ver turnosruleta.ts.
  apuntarTurno?(uid: string, turno: { id: string; recompensa: string; nombre: string; login: string }): boolean;
  // Le apunta en la Ruleta de nombres. false si no se puede (y se devuelven
  // los puntos). Ver ruletachat.ts.
  apuntarNombre?(uid: string, nombre: string): boolean;
  // Le apunta en la Batalla Dofus. false si no se puede (y se devuelven los
  // puntos). Ver batalla.ts.
  apuntarLuchador?(uid: string, nombre: string): boolean;
}

let deps: Dependencias;
let redireccion = 'http://localhost:3000/api/twitch/callback';

// La app de Twitch del propio Ruleton, puesta en el servidor (TWITCH_CLIENT_ID y
// TWITCH_CLIENT_SECRET). Con ella, cada streamer solo tiene que pulsar
// «Conectar con Twitch»: no hace falta que cada uno se cree su app en
// dev.twitch.tv. Quien ya tenga la suya la sigue usando: manda la propia.
let appComun: { clientId: string; clientSecret: string } | null = null;

// Con que app habla esta cuenta con Twitch: la suya si la ha puesto, si no la
// comun. null si no hay ninguna.
function credencialesDe(c: TwitchCuenta | null): { clientId: string; clientSecret: string } | null {
  if (c?.clientId && c.clientSecret) return { clientId: c.clientId, clientSecret: c.clientSecret };
  return appComun;
}

function cuentaVacia(uid: string): TwitchCuenta {
  return {
    clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
    login: '', userId: '', servidor: deps.servidoresDe(uid)[0]?.id || '', recompensa: '', objetos: 1
  };
}

// Las conexiones abiertas, una por usuario conectado.
const sockets = new Map<string, WebSocket>();

// Si ese usuario ha puesto las credenciales de su app.
export function hayCredenciales(uid: string): boolean {
  const c = leerCuenta(uid);
  return Boolean(credencialesDe(c));
}

// Guarda las credenciales de la app del usuario. Un secreto vacio se entiende
// como "dejalo como estaba": asi se puede cambiar el id sin volver a teclearlo.
export function guardarCredenciales(uid: string, clientId: unknown, clientSecret: unknown): TwitchCuenta {
  const previa = leerCuenta(uid);
  const cuenta: TwitchCuenta = previa || {
    clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
    login: '', userId: '', servidor: deps.servidoresDe(uid)[0]?.id || '', recompensa: '', objetos: 1
  };
  const id = String(clientId || '').trim().slice(0, 100);
  const secreto = String(clientSecret || '').trim().slice(0, 100);
  if (id) cuenta.clientId = id;
  if (secreto) cuenta.clientSecret = secreto;
  guardarCuenta(uid, cuenta);
  return cuenta;
}

function archivoCuenta(uid: string): string {
  return path.join(deps.userDir(uid), 'twitch.json');
}

export function leerCuenta(uid: string): TwitchCuenta | null {
  try {
    const f = archivoCuenta(uid);
    if (!fs.existsSync(f)) return null;
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.error('Failed to read twitch account:', err);
    return null;
  }
}

function guardarCuenta(uid: string, cuenta: TwitchCuenta): void {
  deps.ensureUserDir(uid);
  deps.writeJson(archivoCuenta(uid), cuenta);
}

export function borrarCuenta(uid: string): void {
  try {
    fs.rmSync(archivoCuenta(uid), { force: true });
  } catch (err) {
    console.error('Failed to delete twitch account:', err);
  }
  cerrar(uid);
}

// --- OAuth --------------------------------------------------------------

// La direccion a la que se manda al usuario para que autorice. El "state" es
// un valor de un solo uso: sin el, cualquiera podria completar la vuelta.
//
// Se guarda en el archivo de la cuenta, no en memoria. Antes vivia en un Map,
// y con «npm run dev» el servidor se reinicia solo al cambiar el codigo: si
// eso pasaba mientras el usuario estaba en Twitch autorizando, a la vuelta el
// state ya no existia y salia «Vuelta de Twitch no valida». El state lleva
// delante de quien es («uid.secreto»), para saber que archivo mirar.
//
// «vuelta» es la Redirect URL: la de la direccion por la que ha entrado el
// streamer (https://su-dominio/api/twitch/callback), salvo que se haya fijado
// TWITCH_REDIRECT. Antes era siempre la fija, y sin TWITCH_REDIRECT eso es
// localhost: en un hosting Twitch contestaba «redirect_uri does not match».
export function urlDeAutorizacion(uid: string, vuelta: string = redireccion): string {
  // Con la app comun puede que todavia no tenga ni archivo: se le crea.
  const cuenta = leerCuenta(uid) || cuentaVacia(uid);
  const cred = credencialesDe(cuenta);
  if (!cred) throw new Error('falta el Client ID de la app de Twitch');
  const secreto = crypto.randomBytes(16).toString('hex');
  const state = uid + '.' + secreto;
  guardarCuenta(uid, { ...cuenta, oauthState: { secreto, caduca: Date.now() + 10 * 60 * 1000, redireccion: vuelta } });

  const p = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: vuelta,
    response_type: 'code',
    scope: PERMISOS.join(' '),
    state
  });
  return `${AUTORIZAR}?${p.toString()}`;
}

export function uidDelState(state: string): string | null {
  const corte = String(state || '').lastIndexOf('.');
  if (corte <= 0) return null;
  const uid = state.slice(0, corte);
  const secreto = state.slice(corte + 1);
  // El uid viene de fuera: que no sirva para salirse de la carpeta de datos.
  if (!secreto || /[\\/]|\.\./.test(uid)) return null;
  const cuenta = leerCuenta(uid);
  const esperado = cuenta?.oauthState;
  if (!cuenta || !esperado || esperado.caduca < Date.now()) return null;
  const a = Buffer.from(esperado.secreto);
  const b = Buffer.from(secreto);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // De un solo uso. Se queda con que Redirect URL se pidio, para canjear el
  // codigo con la misma.
  const { oauthState, ...sin } = cuenta;
  guardarCuenta(uid, { ...sin, oauthRedireccion: esperado.redireccion || redireccion });
  return uid;
}

// Cambia el codigo de la vuelta por los tokens y deja la cuenta guardada.
export async function completarAlta(uid: string, code: string): Promise<TwitchCuenta> {
  const previa = leerCuenta(uid);
  const cred = credencialesDe(previa);
  if (!previa || !cred) throw new Error('faltan las credenciales de la app de Twitch');
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: previa.oauthRedireccion || redireccion
    })
  });
  if (!r.ok) throw new Error('Twitch rechazo el codigo: ' + r.status);
  const t = await r.json() as any;

  const quien = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${t.access_token}`, 'Client-Id': cred.clientId }
  });
  if (!quien.ok) throw new Error('no se pudo leer la cuenta de Twitch');
  const datos = (await quien.json() as any).data?.[0];
  if (!datos) throw new Error('Twitch no devolvio la cuenta');

  const anterior = previa;
  const cuenta: TwitchCuenta = {
    // Lo demas (el aviso, la recompensa del bingo...) se queda como estaba:
    // volver a conectar para un permiso nuevo no puede borrarlo.
    ...anterior,
    clientId: previa.clientId,
    clientSecret: previa.clientSecret,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    login: datos.login,
    userId: datos.id,
    // Lo que ya estuviera configurado se respeta; si no, el primer servidor.
    servidor: anterior?.servidor || deps.servidoresDe(uid)[0]?.id || '',
    recompensa: anterior?.recompensa || '',
    objetos: anterior?.objetos || 1
  };
  guardarCuenta(uid, cuenta);
  return cuenta;
}

// El token de acceso caduca en unas horas; el de refresco es el que dura.
async function refrescar(uid: string, cuenta: TwitchCuenta): Promise<TwitchCuenta | null> {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credencialesDe(cuenta)?.clientId || '',
      client_secret: credencialesDe(cuenta)?.clientSecret || '',
      grant_type: 'refresh_token',
      refresh_token: cuenta.refreshToken
    })
  });
  if (!r.ok) {
    console.error('Twitch: no se pudo refrescar el token de', uid, r.status);
    return null;
  }
  const t = await r.json() as any;
  const nueva = { ...cuenta, accessToken: t.access_token, refreshToken: t.refresh_token || cuenta.refreshToken };
  guardarCuenta(uid, nueva);
  return nueva;
}

// --- Ajustes que toca el usuario ---------------------------------------

export function guardarAjustes(uid: string, ajustes: { servidor?: string; recompensa?: string; objetos?: number; fijarAviso?: boolean }): TwitchCuenta {
  const cuenta = leerCuenta(uid) || {
    clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
    login: '', userId: '', servidor: deps.servidoresDe(uid)[0]?.id || '', recompensa: '', objetos: 1
  };
  if (typeof ajustes.servidor === 'string') cuenta.servidor = ajustes.servidor;
  if (typeof ajustes.recompensa === 'string') cuenta.recompensa = ajustes.recompensa.trim().slice(0, 80);
  if (ajustes.objetos != null) cuenta.objetos = Math.max(1, Math.min(10, Math.floor(Number(ajustes.objetos) || 1)));
  if (typeof ajustes.fijarAviso === 'boolean') cuenta.fijarAviso = ajustes.fijarAviso;
  guardarCuenta(uid, cuenta);
  return cuenta;
}

// «vuelta» es la Redirect URL que toca para quien pregunta (ver
// urlDeAutorizacion): es la que se le ensena para que la ponga en su app.
export function estado(uid: string, vuelta: string = redireccion) {
  const cuenta = leerCuenta(uid);
  return {
    // El Client ID no es secreto y conviene verlo para comprobar que es el
    // que toca; el Client Secret solo se dice si esta puesto o no.
    clientId: cuenta?.clientId || '',
    secretoPuesto: Boolean(cuenta?.clientSecret),
    // Si el servidor trae su propia app: entonces no hace falta poner nada,
    // solo pulsar «Conectar con Twitch».
    appComun: Boolean(appComun),
    propia: Boolean(cuenta?.clientId && cuenta?.clientSecret),
    credenciales: hayCredenciales(uid),
    conectado: Boolean(cuenta?.refreshToken),
    escuchando: sockets.has(uid),
    // El canal que salio al autorizar la app; el que se escucha en el chat
    // vive en el perfil del usuario.
    login: cuenta?.login || '',
    servidor: cuenta?.servidor || '',
    recompensa: cuenta?.recompensa || '',
    objetos: cuenta?.objetos || 1,
    fijarAviso: cuenta?.fijarAviso !== false,
    bingoRecompensa: cuenta?.bingoRecompensa || null,
    objetosRecompensa: cuenta?.objetosRecompensa || null,
    nombresRecompensa: cuenta?.nombresRecompensa || null,
    batallaRecompensa: cuenta?.batallaRecompensa || null,
    // La «OAuth Redirect URL» que hay que poner en la app de Twitch. Se dice
    // la que usa el servidor de verdad: si no coincide letra a letra, Twitch
    // rechaza la autorizacion con un error que no explica nada.
    redireccion: vuelta,
    // Como fue el ultimo aviso, para poder decir en pantalla por que no sale.
    ultimoAviso: ultimosAvisos.get(uid) || null
  };
}

// --- EventSub por WebSocket --------------------------------------------
// Se conecta hacia fuera, asi que no hace falta que el Ruleton sea accesible
// desde internet: funciona igual en local que en un hosting.

export function cerrar(uid: string): void {
  const ws = sockets.get(uid);
  if (ws) {
    sockets.delete(uid);
    try { ws.close(); } catch (e) { /* ya estaba cerrado */ }
  }
}

export function escuchar(uid: string): void {
  if (sockets.has(uid) || !hayCredenciales(uid)) return;
  const cuenta = leerCuenta(uid);
  if (!cuenta?.refreshToken) return;   // tiene credenciales pero no ha autorizado
  abrir(uid, EVENTSUB_WS);
}

// anterior: la conexion de la que se viene en una mudanza (session_reconnect).
// Sus suscripciones pasan solas a la nueva, asi que la nueva NO se suscribe:
// volver a hacerlo creaba una de mas en cada mudanza, y con unas cuantas
// Twitch contesta 429 («maximum subscriptions with type and condition
// exceeded»). La vieja se cierra cuando la nueva ya ha dado la bienvenida, que
// es lo que pide Twitch para no perder canjes entre medias.
function abrir(uid: string, url: string, anterior?: WebSocket): void {
  const ws = new WebSocket(url);
  sockets.set(uid, ws);
  let vieja = anterior;
  const soltarVieja = () => {
    if (!vieja) return;
    try { vieja.close(); } catch (e) { /* da igual */ }
    vieja = undefined;
  };

  ws.addEventListener('message', async (ev: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(String(ev.data)); } catch (e) { return; }
    const tipo = msg?.metadata?.message_type;

    // Todo dentro de un try: esto corre suelto, sin nadie que recoja lo que
    // falle, y un fetch a Twitch que se corta (red, DNS, un 5xx raro) era una
    // promesa rechazada sin recoger. Eso tumba el proceso entero (ver el
    // unhandledRejection de server.ts): se caia el Ruleton por un corte de red
    // con Twitch.
    try {
      if (tipo === 'session_welcome') {
        const sesion = msg.payload?.session?.id;
        if (vieja) soltarVieja();
        else if (sesion) await suscribir(uid, sesion);
      } else if (tipo === 'session_reconnect') {
        // Twitch pide mudarse a otra direccion sin perder los eventos. Esta
        // sigue abierta (y recibiendo) hasta que la nueva este lista.
        const nueva = msg.payload?.session?.reconnect_url;
        if (nueva) abrir(uid, nueva, ws);
      } else if (tipo === 'notification') {
        await alCanjear(uid, msg.payload?.event);
      }
    } catch (err) {
      console.error('Twitch: fallo al tratar un mensaje de ' + (tipo || '?') + ':', err);
    }
  });

  ws.addEventListener('close', () => {
    // Si la nueva se cae antes de estar lista, la vieja no se queda huerfana:
    // se cierra, y lo de abajo vuelve a empezar de cero, suscribiendose.
    soltarVieja();
    if (sockets.get(uid) !== ws) return;   // ya se mudo a otra conexion
    sockets.delete(uid);
    // Si la cuenta sigue ahi, se vuelve a intentar; Twitch corta cada rato.
    if (leerCuenta(uid)?.refreshToken) {
      setTimeout(() => {
        try { escuchar(uid); } catch (err) { console.error('Twitch: no se pudo volver a conectar:', err); }
      }, 5000);
    }
  });

  ws.addEventListener('error', () => { /* el close que viene detras se encarga */ });
}

const TIPO_CANJE = 'channel.channel_points_custom_reward_redemption.add';

function cabecerasHelix(c: TwitchCuenta): Record<string, string> {
  return {
    Authorization: `Bearer ${c.accessToken}`,
    'Client-Id': credencialesDe(c)?.clientId || '',
    'Content-Type': 'application/json'
  };
}

// Quita las suscripciones a los canjes de este canal que son de otra conexion
// (de antes de un reinicio o un despliegue, que Twitch tarda en soltar).
// Devuelve cuantas quito.
async function quitarViejas(c: TwitchCuenta, sesion: string): Promise<number> {
  const r = await fetch(`${HELIX}/eventsub/subscriptions?type=${encodeURIComponent(TIPO_CANJE)}`, {
    headers: cabecerasHelix(c)
  });
  if (!r.ok) return 0;
  const lista: any[] = (await r.json())?.data || [];
  let quitadas = 0;
  for (const s of lista) {
    if (s?.condition?.broadcaster_user_id !== c.userId) continue;
    if (s?.transport?.method !== 'websocket' || s?.transport?.session_id === sesion) continue;
    const d = await fetch(`${HELIX}/eventsub/subscriptions?id=${encodeURIComponent(s.id)}`, {
      method: 'DELETE', headers: cabecerasHelix(c)
    });
    if (d.ok) quitadas++;
  }
  return quitadas;
}

// Exportada para poder probarla sin Twitch.
export async function suscribir(uid: string, sesion: string): Promise<void> {
  let cuenta = leerCuenta(uid);
  if (!cuenta) return;

  const pedir = async (c: TwitchCuenta) => fetch(`${HELIX}/eventsub/subscriptions`, {
    method: 'POST',
    headers: cabecerasHelix(c),
    body: JSON.stringify({
      type: TIPO_CANJE,
      version: '1',
      condition: { broadcaster_user_id: c.userId },
      transport: { method: 'websocket', session_id: sesion }
    })
  });

  let r = await pedir(cuenta);
  // 401: el token de acceso ha caducado. Se refresca y se reintenta una vez.
  if (r.status === 401) {
    const nueva = await refrescar(uid, cuenta);
    if (!nueva) { cerrar(uid); return; }
    cuenta = nueva;
    r = await pedir(cuenta);
  }
  // 429: ya hay demasiadas iguales. Son de conexiones que ya no estan: se
  // quitan y se reintenta una vez.
  if (r.status === 429) {
    const quitadas = await quitarViejas(cuenta, sesion);
    if (quitadas) {
      console.log(`Twitch: quitadas ${quitadas} suscripcion(es) vieja(s) a los canjes; se reintenta`);
      r = await pedir(cuenta);
    }
  }
  if (!r.ok) {
    console.error('Twitch: no se pudo suscribir a los canjes:', r.status, await r.text());
    return;
  }
  console.log(`Twitch: escuchando los canjes de ${cuenta.login}`);
}

// Lo que pasa cuando alguien canjea. Exportada para poder probarla sin Twitch.
export async function alCanjear(uid: string, evento: any): Promise<boolean> {
  const cuenta = leerCuenta(uid);
  if (!cuenta?.refreshToken || !evento) return false;

  // La de los cartones del bingo va por su id, no por el titulo: es la que creo
  // el Ruleton, y el streamer le puede cambiar el nombre desde Twitch.
  if (cuenta.bingoRecompensa && evento.reward?.id === cuenta.bingoRecompensa.id) {
    return venderCarton(uid, cuenta, evento);
  }
  // La de la Ruleta de objetos, lo mismo: por su id.
  if (cuenta.objetosRecompensa && evento.reward?.id === cuenta.objetosRecompensa.id) {
    return darTurno(uid, cuenta, evento);
  }
  // Y la de la Ruleta de nombres.
  if (cuenta.nombresRecompensa && evento.reward?.id === cuenta.nombresRecompensa.id) {
    return apuntarPorCanje(uid, cuenta, evento, deps.apuntarNombre, 'la ruleta de nombres');
  }
  // Y la de la Batalla Dofus.
  if (cuenta.batallaRecompensa && evento.reward?.id === cuenta.batallaRecompensa.id) {
    return apuntarPorCanje(uid, cuenta, evento, deps.apuntarLuchador, 'la batalla');
  }

  // Solo la recompensa que se haya puesto. Sin ninguna puesta, ninguna: antes
  // vacio era «cualquiera», y conectar Twitch para fijar avisos habria puesto a
  // regalar objetos por cada canje del canal.
  const titulo = String(evento.reward?.title || '');
  if (!cuenta.recompensa || titulo.trim().toLowerCase() !== cuenta.recompensa.trim().toLowerCase()) return false;

  const quien = String(evento.user_name || evento.user_login || 'Espectador');
  if (!cuenta.servidor) {
    console.error('Twitch: canje de', quien, 'sin servidor configurado; se ignora');
    return false;
  }

  try {
    const premios = await deps.sortearPara(uid, cuenta.servidor, quien, cuenta.objetos);
    console.log(`Twitch: ${quien} canjeo "${titulo}" y le toco: ${premios.join(', ')}`);
    return true;
  } catch (err) {
    console.error('Twitch: fallo al sortear para', quien, err);
    return false;
  }
}

// --- Los cartones del bingo, con puntos de canal -------------------------

// Alguien ha canjeado la recompensa de los cartones: se le da uno. Si se pudo,
// el canje se marca como cumplido; si no, se cancela, que es lo que le devuelve
// los puntos.
async function venderCarton(uid: string, cuenta: TwitchCuenta, evento: any): Promise<boolean> {
  const quien = String(evento.user_name || evento.user_login || '').trim();
  let r: { ok: boolean; motivo?: string } = { ok: false, motivo: 'el bingo no esta listo' };
  try {
    // El login va aparte: es como sale en el chat cuando cante.
    if (quien && deps.darCarton) r = deps.darCarton(uid, quien, String(evento.user_login || ''));
  } catch (err) {
    console.error('Twitch: fallo al dar carton a', quien, err);
  }
  await marcarCanje(uid, cuenta, String(evento.reward?.id || ''), String(evento.id || ''), r.ok, quien);
  if (!r.ok) console.log(`Twitch: ${quien} canjeo un carton y no se le dio (${r.motivo}); puntos devueltos`);
  return r.ok;
}

// Cumplido, o cancelado (que le devuelve los puntos). true si Twitch dijo que
// si. No lanza: un fallo aqui no puede deshacer lo que ya se le dio.
async function marcarCanje(uid: string, cuenta: TwitchCuenta, recompensa: string, canje: string,
    cumplido: boolean, quien: string): Promise<boolean> {
  const estado = cumplido ? 'FULFILLED' : 'CANCELED';
  try {
    const q = new URLSearchParams({ broadcaster_id: cuenta.userId, reward_id: recompensa, id: canje });
    const resp = await helix(uid, 'PATCH', '/channel_points/custom_rewards/redemptions?' + q.toString(), { status: estado });
    if (!resp.ok) console.error('Twitch: no se pudo marcar el canje de', quien, 'como', estado + ':', resp.status);
    return resp.ok;
  } catch (err) {
    console.error('Twitch: no se pudo marcar el canje de', quien, err);
    return false;
  }
}

// --- Los turnos de la Ruleta de objetos ----------------------------------

// Alguien ha canjeado la recompensa de la ruleta: se le apunta en la fila y su
// nombre va a la pagina. El canje se queda sin cerrar en Twitch hasta que el
// streamer lo usa (cerrarCanje). Si no se le puede apuntar, se le devuelven
// los puntos ya.
async function darTurno(uid: string, cuenta: TwitchCuenta, evento: any): Promise<boolean> {
  const quien = String(evento.user_name || evento.user_login || '').trim();
  const recompensa = String(evento.reward?.id || '');
  const canje = String(evento.id || '');
  let ok = false;
  try {
    if (quien && canje && deps.apuntarTurno) {
      ok = deps.apuntarTurno(uid, { id: canje, recompensa, nombre: quien, login: String(evento.user_login || '') });
    }
  } catch (err) {
    console.error('Twitch: fallo al apuntar el turno de', quien, err);
  }
  if (!ok) {
    await marcarCanje(uid, cuenta, recompensa, canje, false, quien);
    console.log(`Twitch: ${quien} canjeo la ruleta y no se le pudo apuntar; puntos devueltos`);
  }
  return ok;
}

// --- Ruleta de nombres y Batalla Dofus, con puntos de canal --------------

// Alguien ha canjeado la recompensa de una inscripcion (la ruleta de nombres o
// la batalla): entra en la lista. Aqui no hay fila que esperar, asi que el
// canje se cierra ya: cumplido si entro, cancelado (le devuelve los puntos) si
// no, que es estar cerrada, estar ya apuntado o estar llena.
async function apuntarPorCanje(uid: string, cuenta: TwitchCuenta, evento: any,
    apuntar: ((uid: string, nombre: string) => boolean) | undefined, juego: string): Promise<boolean> {
  const quien = String(evento.user_name || evento.user_login || '').trim();
  let ok = false;
  try {
    if (quien && apuntar) ok = apuntar(uid, quien);
  } catch (err) {
    console.error(`Twitch: fallo al apuntar en ${juego} a`, quien, err);
  }
  await marcarCanje(uid, cuenta, String(evento.reward?.id || ''), String(evento.id || ''), ok, quien);
  if (!ok) console.log(`Twitch: ${quien} canjeo ${juego} y no se le pudo apuntar; puntos devueltos`);
  return ok;
}

// Cierra en Twitch el canje de un turno: cumplido al ponerlo en la ruleta, o
// cancelado si se le quita, que le devuelve los puntos.
export async function cerrarCanje(uid: string, recompensa: string, canje: string, cumplido: boolean): Promise<boolean> {
  const cuenta = leerCuenta(uid);
  if (!cuenta?.refreshToken || !recompensa || !canje) return false;
  return marcarCanje(uid, cuenta, recompensa, canje, cumplido, canje);
}

// Crea en Twitch la recompensa que vende cartones, o la actualiza si ya existe.
// Twitch solo deja crearlas a canales afiliados o partner.
export function recompensaBingo(uid: string, titulo: unknown, coste: unknown): Promise<{ ok: boolean; error?: string }> {
  return crearRecompensa(uid, 'bingoRecompensa', titulo, coste, 'Cartón de bingo', 'el carton',
    'Te da un cartón para el bingo. Si no se puede dar (no hay partida o ya tienes el máximo), se te devuelven los puntos.');
}

// La de la Ruleta de objetos: quien la canjea pone su nombre en la ruleta.
// Sustituye a la que se configuraba por el titulo (que sorteaba sola, sin que
// se viera): al crear esta, aquella se apaga.
export function recompensaObjetos(uid: string, titulo: unknown, coste: unknown): Promise<{ ok: boolean; error?: string }> {
  return crearRecompensa(uid, 'objetosRecompensa', titulo, coste, 'Ruleta de objetos', 'la tirada',
    'Tu nombre va a la Ruleta de objetos y el streamer te la gira en directo. Si al final no te la gira, se te devuelven los puntos.');
}

// La de la Ruleta de nombres: quien la canjea entra en la lista mientras la
// inscripcion este abierta.
export function recompensaNombres(uid: string, titulo: unknown, coste: unknown): Promise<{ ok: boolean; error?: string }> {
  return crearRecompensa(uid, 'nombresRecompensa', titulo, coste, 'Ruleta de nombres', 'entrar',
    'Tu nombre entra en la Ruleta de nombres. Si la inscripción está cerrada o ya estás dentro, se te devuelven los puntos.');
}

// La de la Batalla Dofus: quien la canjea con la inscripcion abierta entra en
// el torneo. Es la unica forma de apuntarse: la batalla no lee el chat.
export function recompensaBatalla(uid: string, titulo: unknown, coste: unknown): Promise<{ ok: boolean; error?: string }> {
  return crearRecompensa(uid, 'batallaRecompensa', titulo, coste, 'Batalla Dofus', 'entrar',
    'Entras en el torneo de la Batalla Dofus. Si la inscripción está cerrada o ya estás dentro, se te devuelven los puntos.');
}

// El titulo de la recompensa de la batalla, o '' si no hay: con ella se entra
// canjeando y no escribiendo. Ver batalla.ts.
export function tituloBatalla(uid: string): string {
  return leerCuenta(uid)?.batallaRecompensa?.titulo || '';
}

async function crearRecompensa(uid: string, campo: 'bingoRecompensa' | 'objetosRecompensa' | 'nombresRecompensa' | 'batallaRecompensa', titulo: unknown,
    coste: unknown, porDefecto: string, que: string, explicacion: string): Promise<{ ok: boolean; error?: string }> {
  const cuenta = leerCuenta(uid);
  if (!cuenta?.refreshToken) return { ok: false, error: 'conecta primero tu cuenta de Twitch en Configuracion › Twitch' };
  const t = String(titulo ?? '').trim().slice(0, 45) || porDefecto;
  const c = Math.max(1, Math.min(10000000, Math.floor(Number(coste) || 0)));
  if (!Number(coste)) return { ok: false, error: 'pon cuantos puntos cuesta ' + que };
  const cuerpo = {
    title: t,
    cost: c,
    prompt: explicacion,
    is_enabled: true,
    // Por la cola, para poder devolver los puntos si no se le puede dar.
    should_redemptions_skip_request_queue: false
  };
  try {
    const previa = cuenta[campo];
    let r: Response | null = null;
    if (previa?.id) {
      const q = new URLSearchParams({ broadcaster_id: cuenta.userId, id: previa.id });
      r = await helix(uid, 'PATCH', '/channel_points/custom_rewards?' + q.toString(), cuerpo);
      // La borraron desde Twitch: se crea otra.
      if (r.status === 404) r = null;
    }
    if (!r) {
      const q = new URLSearchParams({ broadcaster_id: cuenta.userId });
      r = await helix(uid, 'POST', '/channel_points/custom_rewards?' + q.toString(), cuerpo);
    }
    if (!r.ok) return { ok: false, error: await porQueRecompensa(r) };
    const dato = ((await r.json()) as any)?.data?.[0];
    const nueva: RecompensaBingo = { id: String(dato?.id || previa?.id || ''), titulo: t, coste: c };
    const actual: TwitchCuenta = { ...(leerCuenta(uid) || cuenta), [campo]: nueva };
    if (campo === 'objetosRecompensa') actual.recompensa = '';
    guardarCuenta(uid, actual);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'fallo de conexion con Twitch' };
  }
}

async function porQueRecompensa(r: Response): Promise<string> {
  let detalle = '';
  try { detalle = String(((await r.json()) as any)?.message || ''); } catch (e) { /* sin cuerpo */ }
  if (r.status === 401 || (r.status === 403 && /scope|token|permission/i.test(detalle))) {
    return 'a la conexion con Twitch le falta el permiso de recompensas: vuelve a conectarla en Configuracion › Twitch';
  }
  if (r.status === 403) return 'Twitch solo deja crear recompensas a canales afiliados o partner' + (detalle ? ' (' + detalle + ')' : '');
  if (/DUPLICATE/i.test(detalle)) return 'ya hay una recompensa con ese nombre en tu canal: ponle otro nombre aqui, o borra la de Twitch';
  return 'Twitch contesto ' + r.status + (detalle ? ': ' + detalle : '');
}

// --- El aviso fijado en el chat -----------------------------------------
//
// Al abrir la inscripcion de un minijuego se escribe en el chat que hay que
// escribir para participar, y se fija arriba. Va con la cuenta del streamer:
// es la duena del canal, asi que puede fijar sin que haga falta un bot ni
// hacerlo moderador.
//
// Se fija con su propia llamada y no con el «pin» de enviar, porque ese lo deja
// siempre 20 minutos; aparte se puede decir cuanto. Si la inscripcion tiene
// cronometro, lo que dure (entre 30 s y 30 min, que es lo que admite Twitch);
// si no, 20 minutos.

export interface Aviso {
  ok: boolean;
  texto: string;
  error: string;        // '' si ha ido bien
  cuando: string;
}

const ultimosAvisos = new Map<string, Aviso>();

// Lo que se fija por defecto, sin cronometro.
const FIJADO_POR_DEFECTO_S = 20 * 60;

// Una peticion a Helix con el token de la cuenta. Si el token ha caducado se
// refresca y se reintenta una vez, como al suscribirse a los canjes.
async function helix(uid: string, metodo: string, ruta: string, cuerpo?: unknown): Promise<Response> {
  let cuenta = leerCuenta(uid);
  if (!cuenta?.refreshToken) throw new Error('Twitch no esta conectado');
  const pedir = (c: TwitchCuenta) => fetch(HELIX + ruta, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      'Client-Id': credencialesDe(c)?.clientId || '',
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {})
  });
  let r = await pedir(cuenta);
  if (r.status === 401) {
    const nueva = await refrescar(uid, cuenta);
    if (!nueva) return r;
    cuenta = nueva;
    r = await pedir(cuenta);
  }
  return r;
}

// Lo que Twitch dice cuando algo falla, ya para ensenarlo al streamer.
async function porQue(r: Response): Promise<string> {
  let detalle = '';
  try { detalle = String(((await r.json()) as any)?.message || ''); } catch (e) { /* sin cuerpo */ }
  if (r.status === 401 || (r.status === 403 && /scope|token/i.test(detalle))) {
    return 'a la conexion con Twitch le faltan permisos para escribir en el chat: vuelve a conectarla en Configuracion › Twitch';
  }
  if (r.status === 403) return 'Twitch no deja escribir o fijar en ese canal' + (detalle ? ': ' + detalle : '');
  if (r.status === 429) return 'Twitch pide esperar un poco antes de volver a escribir';
  return 'Twitch contesto ' + r.status + (detalle ? ': ' + detalle : '');
}

// Escribe el aviso y lo fija. «canal» es el que tiene puesto en su perfil, que
// es el chat que escuchan los minijuegos: si la cuenta conectada es otra, el
// aviso saldria en un chat donde nadie se esta apuntando, y no se manda.
//
// No lanza nunca: abrir la inscripcion no puede fallar porque Twitch no conteste.
// Lo que pase se queda en el estado (ultimoAviso) para ensenarlo.
export async function fijarAviso(uid: string, canal: string, texto: string, segundos?: unknown): Promise<Aviso> {
  const apunta = (ok: boolean, error: string): Aviso => {
    const a = { ok, texto, error, cuando: new Date().toISOString() };
    ultimosAvisos.set(uid, a);
    if (!ok) console.error('Twitch: no se pudo fijar el aviso de', uid + ':', error);
    return a;
  };
  try {
    const cuenta = leerCuenta(uid);
    if (!cuenta?.refreshToken || cuenta.fijarAviso === false) {
      // Sin conectar, o con el aviso apagado: no es un fallo, es que no toca.
      return { ok: false, texto, error: '', cuando: new Date().toISOString() };
    }
    if (canal && cuenta.login && canal.trim().toLowerCase() !== cuenta.login.toLowerCase()) {
      return apunta(false, 'la cuenta de Twitch conectada (' + cuenta.login + ') no es la del canal de tu perfil (' + canal + ')');
    }

    const enviado = await helix(uid, 'POST', '/chat/messages', {
      broadcaster_id: cuenta.userId,
      sender_id: cuenta.userId,
      message: texto.slice(0, 500)
    });
    if (!enviado.ok) return apunta(false, await porQue(enviado));
    const dato = ((await enviado.json()) as any)?.data?.[0];
    if (!dato?.is_sent) {
      return apunta(false, 'Twitch no publico el mensaje' + (dato?.drop_reason?.message ? ': ' + dato.drop_reason.message : ''));
    }

    const s = Math.floor(Number(segundos) || 0);
    const duracion = Math.max(30, Math.min(1800, s > 0 ? s : FIJADO_POR_DEFECTO_S));
    const q = new URLSearchParams({
      broadcaster_id: cuenta.userId,
      moderator_id: cuenta.userId,
      message_id: String(dato.message_id),
      duration_seconds: String(duracion)
    });
    const fijado = await helix(uid, 'PUT', '/chat/pins?' + q.toString());
    // El mensaje ya esta en el chat aunque no se haya podido fijar: se dice,
    // pero es medio exito.
    if (!fijado.ok) return apunta(false, 'el aviso salio en el chat, pero no se pudo fijar: ' + await porQue(fijado));
    return apunta(true, '');
  } catch (err) {
    return apunta(false, (err as Error).message || 'fallo de conexion con Twitch');
  }
}

// Escribe en el chat sin fijar, para contestar a un espectador. Como el aviso,
// solo si la cuenta conectada es la del canal del perfil. No lanza nunca.
export async function decir(uid: string, canal: string, texto: string): Promise<boolean> {
  try {
    const cuenta = leerCuenta(uid);
    if (!cuenta?.refreshToken) return false;
    if (canal && cuenta.login && canal.trim().toLowerCase() !== cuenta.login.toLowerCase()) return false;
    const r = await helix(uid, 'POST', '/chat/messages', {
      broadcaster_id: cuenta.userId,
      sender_id: cuenta.userId,
      message: texto.slice(0, 500)
    });
    return r.ok;
  } catch (err) {
    return false;
  }
}

// --- Arranque -----------------------------------------------------------

export function iniciar(d: Dependencias, opciones: { redirect?: string; usuarios: string[]; clientId?: string; clientSecret?: string }): void {
  deps = d;
  if (opciones.redirect) redireccion = opciones.redirect;
  const id = String(opciones.clientId || '').trim();
  const secreto = String(opciones.clientSecret || '').trim();
  appComun = id && secreto ? { clientId: id, clientSecret: secreto } : null;
  // Se reconecta a cada usuario que tenga sus credenciales y haya autorizado.
  for (const uid of opciones.usuarios) escuchar(uid);
}
