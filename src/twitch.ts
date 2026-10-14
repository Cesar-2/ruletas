// Conexion con Twitch, con la cuenta del propio streamer. Sirve para dos cosas:
//
//  - Fijar en el chat el aviso de cada minijuego al abrir su inscripcion
//    («Escribe !correr para participar en la Carrera de balineras»).
//  - Los canjes de puntos de canal: cuando alguien canjea la recompensa que se
//    haya configurado, se sortea un objeto y ese espectador queda como ganador.
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
const PERMISOS = ['channel:read:redemptions', 'user:write:chat', 'moderator:manage:chat_messages'];

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
}

let deps: Dependencias;
let redireccion = 'http://localhost:3000/api/twitch/callback';

// Las conexiones abiertas, una por usuario conectado.
const sockets = new Map<string, WebSocket>();
// Los "state" de OAuth que estan en vuelo, para saber de quien es la vuelta.
const enVuelo = new Map<string, { uid: string; caduca: number }>();

// Si ese usuario ha puesto las credenciales de su app.
export function hayCredenciales(uid: string): boolean {
  const c = leerCuenta(uid);
  return Boolean(c && c.clientId && c.clientSecret);
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
export function urlDeAutorizacion(uid: string): string {
  const cuenta = leerCuenta(uid);
  if (!cuenta?.clientId) throw new Error('falta el Client ID de tu app de Twitch');
  const state = crypto.randomBytes(16).toString('hex');
  const ahora = Date.now();
  for (const [k, v] of enVuelo) if (v.caduca < ahora) enVuelo.delete(k);
  enVuelo.set(state, { uid, caduca: ahora + 10 * 60 * 1000 });

  const p = new URLSearchParams({
    client_id: cuenta.clientId,
    redirect_uri: redireccion,
    response_type: 'code',
    scope: PERMISOS.join(' '),
    state
  });
  return `${AUTORIZAR}?${p.toString()}`;
}

export function uidDelState(state: string): string | null {
  const reg = enVuelo.get(state);
  if (!reg || reg.caduca < Date.now()) return null;
  enVuelo.delete(state);   // de un solo uso
  return reg.uid;
}

// Cambia el codigo de la vuelta por los tokens y deja la cuenta guardada.
export async function completarAlta(uid: string, code: string): Promise<TwitchCuenta> {
  const previa = leerCuenta(uid);
  if (!previa?.clientId || !previa.clientSecret) throw new Error('faltan las credenciales de tu app de Twitch');
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: previa.clientId,
      client_secret: previa.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redireccion
    })
  });
  if (!r.ok) throw new Error('Twitch rechazo el codigo: ' + r.status);
  const t = await r.json() as any;

  const quien = await fetch(`${HELIX}/users`, {
    headers: { Authorization: `Bearer ${t.access_token}`, 'Client-Id': previa.clientId }
  });
  if (!quien.ok) throw new Error('no se pudo leer la cuenta de Twitch');
  const datos = (await quien.json() as any).data?.[0];
  if (!datos) throw new Error('Twitch no devolvio la cuenta');

  const anterior = previa;
  const cuenta: TwitchCuenta = {
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
      client_id: cuenta.clientId,
      client_secret: cuenta.clientSecret,
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

export function estado(uid: string) {
  const cuenta = leerCuenta(uid);
  return {
    // El Client ID no es secreto y conviene verlo para comprobar que es el
    // que toca; el Client Secret solo se dice si esta puesto o no.
    clientId: cuenta?.clientId || '',
    secretoPuesto: Boolean(cuenta?.clientSecret),
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
    // La «OAuth Redirect URL» que hay que poner en la app de Twitch. Se dice
    // la que usa el servidor de verdad: si no coincide letra a letra, Twitch
    // rechaza la autorizacion con un error que no explica nada.
    redireccion,
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

function abrir(uid: string, url: string): void {
  const ws = new WebSocket(url);
  sockets.set(uid, ws);

  ws.addEventListener('message', async (ev: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(String(ev.data)); } catch (e) { return; }
    const tipo = msg?.metadata?.message_type;

    if (tipo === 'session_welcome') {
      const sesion = msg.payload?.session?.id;
      if (sesion) await suscribir(uid, sesion);
    } else if (tipo === 'session_reconnect') {
      // Twitch pide mudarse a otra direccion sin perder los eventos.
      const nueva = msg.payload?.session?.reconnect_url;
      if (nueva) {
        sockets.delete(uid);
        try { ws.close(); } catch (e) { /* da igual */ }
        abrir(uid, nueva);
      }
    } else if (tipo === 'notification') {
      await alCanjear(uid, msg.payload?.event);
    }
  });

  ws.addEventListener('close', () => {
    if (sockets.get(uid) !== ws) return;   // ya se mudo a otra conexion
    sockets.delete(uid);
    // Si la cuenta sigue ahi, se vuelve a intentar; Twitch corta cada rato.
    if (leerCuenta(uid)?.refreshToken) setTimeout(() => escuchar(uid), 5000);
  });

  ws.addEventListener('error', () => { /* el close que viene detras se encarga */ });
}

async function suscribir(uid: string, sesion: string): Promise<void> {
  let cuenta = leerCuenta(uid);
  if (!cuenta) return;

  const pedir = async (c: TwitchCuenta) => fetch(`${HELIX}/eventsub/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      'Client-Id': c.clientId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
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
      'Client-Id': c.clientId,
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

// --- Arranque -----------------------------------------------------------

export function iniciar(d: Dependencias, opciones: { redirect?: string; usuarios: string[] }): void {
  deps = d;
  if (opciones.redirect) redireccion = opciones.redirect;
  // Se reconecta a cada usuario que tenga sus credenciales y haya autorizado.
  for (const uid of opciones.usuarios) escuchar(uid);
}
