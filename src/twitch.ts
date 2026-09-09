// Conexion con Twitch: cuando alguien canjea una recompensa de puntos de
// canal, se sortea un objeto y ese espectador queda como ganador.
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
// canal. No se pide nada de escribir ni de leer el chat.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const AUTORIZAR = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
const PERMISOS = ['channel:read:redemptions'];

// Lo que se guarda de cada usuario. Va en su carpeta, nunca en settings.json,
// porque eso se le manda al navegador y aqui hay credenciales.
interface TwitchCuenta {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  login: string;        // el canal que salio al autorizar, en minusculas
  userId: string;       // el id del canal en Twitch
  // El canal cuyo chat se lee (carreras y demas minijuegos). Se puede poner
  // sin autorizar nada: leer un chat publico no necesita credenciales.
  canal: string;
  servidor: string;     // en que servidor del Ruleton se apuntan los premios
  recompensa: string;   // titulo de la recompensa; vacio = cualquiera
  objetos: number;      // cuantos objetos se sortean por canje
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
    login: '', userId: '', canal: '', servidor: deps.servidoresDe(uid)[0]?.id || '', recompensa: '', objetos: 1
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
    // Al autorizar se rellena el canal si aun no habia ninguno.
    canal: anterior?.canal || datos.login,
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

export function guardarAjustes(uid: string, ajustes: { canal?: string; servidor?: string; recompensa?: string; objetos?: number }): TwitchCuenta {
  const cuenta = leerCuenta(uid) || {
    clientId: '', clientSecret: '', accessToken: '', refreshToken: '',
    login: '', userId: '', canal: '', servidor: deps.servidoresDe(uid)[0]?.id || '', recompensa: '', objetos: 1
  };
  if (typeof ajustes.canal === 'string') {
    // Se admite pegar la direccion entera del canal, no solo el nombre.
    cuenta.canal = ajustes.canal.trim().toLowerCase()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/^#/, '').replace(/\/.*$/, '').slice(0, 30);
  }
  if (typeof ajustes.servidor === 'string') cuenta.servidor = ajustes.servidor;
  if (typeof ajustes.recompensa === 'string') cuenta.recompensa = ajustes.recompensa.trim().slice(0, 80);
  if (ajustes.objetos != null) cuenta.objetos = Math.max(1, Math.min(10, Math.floor(Number(ajustes.objetos) || 1)));
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
    // El canal que se escucha: el que haya puesto o, si no, el que salio al
    // autorizar la app.
    canal: cuenta?.canal || cuenta?.login || '',
    servidor: cuenta?.servidor || '',
    recompensa: cuenta?.recompensa || '',
    objetos: cuenta?.objetos || 1
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

  // Si se ha puesto una recompensa concreta, las demas se ignoran.
  const titulo = String(evento.reward?.title || '');
  if (cuenta.recompensa && titulo.trim().toLowerCase() !== cuenta.recompensa.trim().toLowerCase()) return false;

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

// --- Arranque -----------------------------------------------------------

export function iniciar(d: Dependencias, opciones: { redirect?: string; usuarios: string[] }): void {
  deps = d;
  if (opciones.redirect) redireccion = opciones.redirect;
  // Se reconecta a cada usuario que tenga sus credenciales y haya autorizado.
  for (const uid of opciones.usuarios) escuchar(uid);
}
