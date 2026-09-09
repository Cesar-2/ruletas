// Batalla de viewers: un torneo de duelos uno contra uno. Se apuntan con el
// mismo codigo de invitado que usan los paquetones, se emparejan de dos en
// dos, y el que gana pasa a la siguiente ronda hasta que queda un campeon.
//
// Quien decide cada duelo es esto, no el navegador: la pagina solo lo cuenta.
// Los puntos van al mismo marcador que la carrera de balineras.

import fs from 'fs';
import path from 'path';

export interface Luchador {
  nombre: string;
  clave: string;        // en minusculas, para no duplicar a la misma persona
}

export interface Duelo {
  a: string;
  b: string;            // vacio = pasa de ronda sin pelear
  ganador: string;      // vacio hasta que se resuelve
}

export interface Ronda {
  numero: number;
  duelos: Duelo[];
}

export interface Batalla {
  abierta: boolean;         // si se admiten apuntados
  luchadores: Luchador[];
  rondas: Ronda[];
  campeon: string;
  puntos: number;           // lo que se lleva el campeon
}

export interface Ajustes {
  puntos: number;
}

export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 25 };
const MAX_LUCHADORES = 64;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // El marcador es el mismo que el de la carrera.
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La batalla en curso vive en memoria: dura lo que dura el directo.
const batallas = new Map<string, Batalla>();

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'batalla.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    if (!fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO };
    return { ...AJUSTES_POR_DEFECTO, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch (err) {
    console.error('Failed to read battle settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes.puntos != null) {
    actual.puntos = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.puntos) || 0)));
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivoAjustes(uid), actual);
  return actual;
}

export function estado(uid: string): Batalla {
  return batallas.get(uid) || {
    abierta: false, luchadores: [], rondas: [], campeon: '', puntos: leerAjustes(uid).puntos
  };
}

export function abrir(uid: string): Batalla {
  const batalla: Batalla = {
    abierta: true, luchadores: [], rondas: [], campeon: '', puntos: leerAjustes(uid).puntos
  };
  batallas.set(uid, batalla);
  return batalla;
}

export function cancelar(uid: string): void {
  batallas.delete(uid);
}

// Apuntarse. Lo llama tanto el invitado con su codigo como el dueño a mano.
export function entrar(uid: string, nombre: string): { ok: boolean; error?: string } {
  const batalla = batallas.get(uid);
  if (!batalla) return { ok: false, error: 'no hay ninguna batalla abierta' };
  if (!batalla.abierta) return { ok: false, error: 'la batalla ya ha empezado' };

  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, error: 'hace falta un nombre' };
  const clave = limpio.toLowerCase();
  if (batalla.luchadores.some((l) => l.clave === clave)) return { ok: false, error: 'ya estabas apuntado' };
  if (batalla.luchadores.length >= MAX_LUCHADORES) return { ok: false, error: 'la batalla esta llena' };

  batalla.luchadores.push({ nombre: limpio, clave });
  return { ok: true };
}

function barajar<T>(lista: T[]): T[] {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Empareja a los que quedan. Si son impares, uno pasa de ronda sin pelear.
function emparejar(nombres: string[], numero: number): Ronda {
  const orden = barajar(nombres);
  const duelos: Duelo[] = [];
  for (let i = 0; i < orden.length; i += 2) {
    // El ultimo, si sobra, pasa directo: su duelo ya viene resuelto.
    if (i + 1 >= orden.length) duelos.push({ a: orden[i], b: '', ganador: orden[i] });
    else duelos.push({ a: orden[i], b: orden[i + 1], ganador: '' });
  }
  return { numero, duelos };
}

// Cierra la inscripcion y monta la primera ronda.
export function empezar(uid: string): Batalla | null {
  const batalla = batallas.get(uid);
  if (!batalla || !batalla.abierta || batalla.luchadores.length < 2) return null;
  batalla.abierta = false;
  batalla.rondas = [emparejar(batalla.luchadores.map((l) => l.nombre), 1)];
  return batalla;
}

// Resuelve la ronda pendiente y, si queda mas de uno, monta la siguiente.
// Devuelve null si no habia nada que resolver.
export function resolverRonda(uid: string): Batalla | null {
  const batalla = batallas.get(uid);
  if (!batalla || batalla.abierta || batalla.campeon) return null;
  const ronda = batalla.rondas[batalla.rondas.length - 1];
  if (!ronda || ronda.duelos.every((d) => d.ganador)) return null;

  for (const duelo of ronda.duelos) {
    // Los pases de ronda ya venian resueltos.
    if (duelo.ganador) continue;
    duelo.ganador = Math.random() < 0.5 ? duelo.a : duelo.b;
  }

  const siguen = ronda.duelos.map((d) => d.ganador);
  if (siguen.length === 1) {
    batalla.campeon = siguen[0];
    if (batalla.puntos > 0) deps.sumarPuntos(uid, batalla.campeon, batalla.puntos);
  } else {
    batalla.rondas.push(emparejar(siguen, batalla.rondas.length + 1));
  }
  return batalla;
}
