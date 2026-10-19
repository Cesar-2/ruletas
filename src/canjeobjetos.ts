// La Ruleta de objetos pagando con los puntos de la pagina.
//
// La ruleta ya se podia jugar canjeando una recompensa de puntos de canal (ver
// twitch.ts). Esto anade la otra forma: con los puntos del marcador del
// Ruleton, los que se ganan en la carrera, la batalla y el plinko. Quien
// escribe la palabra en el chat y tiene bastantes, paga y se le sortea, igual
// que si hubiera canjeado en Twitch.
//
// Twitch no deja tocar los puntos de canal de nadie, asi que las dos monedas
// van cada una por su lado: no se convierten la una en la otra.
//
// Se lee el chat como anonimo (ver chat.ts): no hace falta conectar Twitch.
// Conectado, ademas se le contesta en el chat a quien no le llega.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';

export interface Ajustes {
  palabra: string;      // lo que se escribe en el chat para jugar
  coste: number;        // puntos del marcador por tirada; 0 = apagado
}

// Apagado por defecto: ponerse a cobrar puntos a la gente tiene que decidirlo
// el streamer.
export const AJUSTES_POR_DEFECTO: Ajustes = { palabra: '!objeto', coste: 0 };

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // El canal del perfil, que es el chat que se escucha.
  canalDe(uid: string): string;
  gastarPuntos(uid: string, nombre: string, cuantos: number): boolean;
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
  // Sortea para alguien y lo apunta como ganador. Devuelve lo que le ha tocado.
  sortear(uid: string, nombre: string): Promise<string[]>;
  // Contesta en el chat, si se puede. No lanza.
  decir?(uid: string, texto: string): void;
}

let deps: Dependencias;
const escuchas = new Map<string, chat.Conexion>();

function archivo(uid: string): string {
  return path.join(deps.userDir(uid), 'canje-objetos.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivo(uid);
    if (fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch (err) {
    console.error('Failed to read item redemption settings:', err);
  }
  return { ...AJUSTES_POR_DEFECTO };
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (typeof ajustes.palabra === 'string') {
    // Una sola palabra: es lo que busca esLaPalabra.
    const palabra = ajustes.palabra.trim().split(/\s+/)[0].slice(0, 30);
    if (palabra) actual.palabra = palabra;
  }
  if (ajustes.coste != null) {
    actual.coste = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.coste) || 0)));
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), actual);
  rehacer(uid);
  return actual;
}

export function estado(uid: string) {
  const e = escuchas.get(uid);
  return { ...leerAjustes(uid), escuchando: e?.canal || '', chat: e ? e.salud() : null };
}

// Alguien ha escrito la palabra. Exportada para poder probarla sin chat.
export async function alEscribir(uid: string, autor: string): Promise<boolean> {
  const { coste } = leerAjustes(uid);
  const quien = String(autor || '').trim();
  if (!quien || coste <= 0) return false;

  if (!deps.gastarPuntos(uid, quien, coste)) {
    deps.decir?.(uid, `@${quien} no tienes ${coste} puntos para la Ruleta de objetos.`);
    return false;
  }
  try {
    const premios = await deps.sortear(uid, quien);
    console.log(`Canje con puntos: ${quien} pago ${coste} y le toco: ${premios.join(', ')}`);
    deps.decir?.(uid, `@${quien} gasta ${coste} puntos en la Ruleta de objetos y le toca: ${premios.join(', ')}`);
    return true;
  } catch (err) {
    // Si no se pudo sortear (no quedan objetos...), se le devuelve lo pagado.
    deps.sumarPuntos(uid, quien, coste);
    console.error('Canje con puntos: fallo al sortear para', quien, err);
    deps.decir?.(uid, `@${quien} no se pudo sortear ahora; te devuelvo los ${coste} puntos.`);
    return false;
  }
}

// Abre o cierra la escucha segun los ajustes y el canal del perfil. Se llama al
// arrancar, al cambiar los ajustes y al cambiar el canal.
export function rehacer(uid: string): void {
  const { palabra, coste } = leerAjustes(uid);
  const canal = deps.canalDe(uid);
  const actual = escuchas.get(uid);
  if (actual) { actual.cerrar(); escuchas.delete(uid); }
  if (coste <= 0 || !canal) return;
  escuchas.set(uid, chat.conectar(canal, (m) => {
    // Con su catch: suelta, una promesa rechazada tumbaria el servidor.
    if (chat.esLaPalabra(m.texto, palabra)) {
      alEscribir(uid, m.autor).catch((err) => console.error('Canje con puntos: fallo con', m.autor, err));
    }
  }));
}

export function iniciar(d: Dependencias, usuarios: string[] = []): void {
  deps = d;
  for (const uid of usuarios) rehacer(uid);
}
