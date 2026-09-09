// Batalla de viewers: un torneo de duelos uno contra uno. Se apuntan por el
// chat, como en la carrera, se emparejan de dos en dos, y el que gana pasa a
// la siguiente ronda hasta que queda un campeon.
//
// Quien decide cada duelo es esto, no el navegador: la pagina solo lo cuenta.
// Los puntos van al mismo marcador que la carrera de balineras.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';

export interface Luchador {
  nombre: string;
  clave: string;        // en minusculas, para no duplicar a la misma persona
}

// Cada golpe del combate, para poder contarlo en la pagina uno a uno.
export interface Golpe {
  quien: string;        // el que pega
  a: string;            // el que recibe
  ataque: string;       // como pega, solo para darle gracia
  dano: number;
  critico: boolean;
  fallo?: boolean;      // el otro lo esquivo: no quita nada
  furia?: boolean;      // pegado contra las cuerdas, pega mas fuerte
  aguanta?: boolean;    // deberia haber caido y se queda con un hilo de vida
  vidaA: number;        // como quedan los dos tras el golpe
  vidaB: number;
}

export interface Duelo {
  a: string;
  b: string;            // vacio = pasa de ronda sin pelear
  ganador: string;      // vacio hasta que se resuelve
  golpes: Golpe[];      // el combate, golpe a golpe
}

export const VIDA = 100;

// Solo para que no todos los golpes se cuenten igual.
const ATAQUES = [
  'golpea a', 'arrea un mandoble a', 'lanza un hechizo contra', 'embiste a',
  'da un cabezazo a', 'patea a', 'sacude a', 'aporrea a'
];

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
  palabra: string;      // lo que se escribe en el chat para apuntarse
}

export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 25, palabra: '!pelea' };

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
  if (typeof ajustes.palabra === 'string') {
    actual.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivoAjustes(uid), actual);
  return actual;
}

export function estado(uid: string): Batalla & { escuchando: string; palabra: string } {
  const b = batallas.get(uid) || {
    abierta: false, luchadores: [], rondas: [], campeon: '', puntos: leerAjustes(uid).puntos
  };
  const ajustes = leerAjustes(uid);
  // Los puntos que se enseñan son los ajustados ahora mismo, no los que
  // hubiera al abrir: se pueden cambiar en cualquier momento.
  return { ...b, puntos: ajustes.puntos, escuchando: escuchando(uid), palabra: ajustes.palabra };
}

// La conexion al chat mientras hay inscripcion abierta.
const escuchas = new Map<string, chat.Conexion>();

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Abre la inscripcion y se pone a escuchar el chat: quien escriba la palabra
// se apunta, igual que en la carrera.
export function abrir(uid: string, canal: string): Batalla {
  cerrarEscucha(uid);
  const ajustes = leerAjustes(uid);
  const batalla: Batalla = {
    abierta: true, luchadores: [], rondas: [], campeon: '', puntos: ajustes.puntos
  };
  batallas.set(uid, batalla);

  const buscada = ajustes.palabra.trim().toLowerCase();
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!batalla.abierta) return;
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    entrar(uid, m.autor);
  }));
  return batalla;
}

export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  batallas.delete(uid);
}

export function escuchando(uid: string): string {
  return escuchas.get(uid)?.canal || '';
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
    if (i + 1 >= orden.length) duelos.push({ a: orden[i], b: '', ganador: orden[i], golpes: [] });
    else duelos.push({ a: orden[i], b: orden[i + 1], ganador: '', golpes: [] });
  }
  return { numero, duelos };
}

// Cierra la inscripcion y monta la primera ronda.
export function empezar(uid: string): Batalla | null {
  const batalla = batallas.get(uid);
  if (!batalla || !batalla.abierta || batalla.luchadores.length < 2) return null;
  batalla.abierta = false;
  cerrarEscucha(uid);
  batalla.rondas = [emparejar(batalla.luchadores.map((l) => l.nombre), 1)];
  return batalla;
}

// Otro torneo con los mismos luchadores. El cuadro se sortea de nuevo, asi
// que no repite los mismos duelos: va directo a la primera ronda.
export function repetir(uid: string): Batalla | null {
  const anterior = batallas.get(uid);
  if (!anterior || anterior.luchadores.length < 2) return null;
  const nueva: Batalla = {
    abierta: false,
    luchadores: anterior.luchadores.slice(),
    rondas: [],
    campeon: '',
    puntos: leerAjustes(uid).puntos
  };
  nueva.rondas = [emparejar(nueva.luchadores.map((l) => l.nombre), 1)];
  batallas.set(uid, nueva);
  return nueva;
}

// El combate: los dos empiezan con la misma vida y se turnan a golpes hasta
// que uno cae. Quien empieza se sortea, para que empezar no de ventaja: con
// las mismas reglas para los dos, cada uno gana la mitad de las veces.
// Lo que hace que una pelea no se sepa de antemano:
// - se falla, y el turno perdido lo cambia todo;
// - se repite golpe, asi que empezar no da la ventaja que daba;
// - contra las cuerdas se pega mas fuerte, que es de donde salen las remontadas.
const ESQUIVA = 0.16;
const CRITICO = 0.15;
const REPETIR = 0.2;
const CUERDAS = 30;   // vida a partir de la cual entra la furia
const AGUANTE = 0.22; // de librarse del golpe final, una vez por pelea

function pelear(duelo: Duelo): void {
  const vidas: Record<string, number> = { [duelo.a]: VIDA, [duelo.b]: VIDA };
  let turno = Math.random() < 0.5 ? duelo.a : duelo.b;
  // Cada uno se libra como mucho una vez: si no, la pelea no acabaria nunca.
  const aguante: Record<string, boolean> = { [duelo.a]: true, [duelo.b]: true };
  duelo.golpes = [];

  // Un tope por si acaso: con este dano no se llega ni de lejos, pero mas vale
  // que se corte a que se quede dando vueltas para siempre.
  for (let i = 0; i < 200; i++) {
    const otro = turno === duelo.a ? duelo.b : duelo.a;
    const fallo = Math.random() < ESQUIVA;
    const critico = !fallo && Math.random() < CRITICO;
    const furia = !fallo && vidas[turno] <= CUERDAS;
    let dano = 0;
    if (!fallo) {
      dano = Math.floor(6 + Math.random() * 17);
      if (critico) dano *= 2;
      if (furia) dano = Math.round(dano * 1.5);
    }
    vidas[otro] = Math.max(0, vidas[otro] - dano);
    // El que deberia caer a veces se queda en pie por los pelos. De aqui salen
    // las peleas que parecian sentenciadas y no lo estaban.
    const aguanta = vidas[otro] <= 0 && aguante[otro] && Math.random() < AGUANTE;
    if (aguanta) { vidas[otro] = 1; aguante[otro] = false; }

    duelo.golpes.push({
      quien: turno,
      a: otro,
      ataque: ATAQUES[Math.floor(Math.random() * ATAQUES.length)],
      dano,
      critico,
      fallo,
      furia,
      aguanta,
      vidaA: vidas[duelo.a],
      vidaB: vidas[duelo.b]
    });

    if (vidas[otro] <= 0) { duelo.ganador = turno; return; }
    // A veces no se suelta el turno: es lo que quita la ventaja de empezar.
    if (Math.random() >= REPETIR) turno = otro;
  }
  // Si por lo que sea no ha caido ninguno, gana el que mas vida tenga.
  duelo.ganador = vidas[duelo.a] >= vidas[duelo.b] ? duelo.a : duelo.b;
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
    pelear(duelo);
  }

  const siguen = ronda.duelos.map((d) => d.ganador);
  if (siguen.length === 1) {
    batalla.campeon = siguen[0];
    // Se mira el ajuste ahora, no el de cuando se abrio el torneo: asi se
    // puede cambiar el premio con la batalla ya en marcha.
    const premio = leerAjustes(uid).puntos;
    batalla.puntos = premio;
    if (premio > 0) deps.sumarPuntos(uid, batalla.campeon, premio);
  } else {
    batalla.rondas.push(emparejar(siguen, batalla.rondas.length + 1));
  }
  return batalla;
}
