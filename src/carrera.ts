// Carrera de balineras: los espectadores se apuntan por el chat, corren, y
// los primeros se llevan puntos.
//
// Quien decide el resultado es esto, no el navegador: la pagina solo lo
// anima. Asi nadie gana toqueteando la animacion, igual que en las ruletas.
//
// Los puntos se guardan por usuario de la plataforma, en su carpeta.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';

export interface Corredor {
  nombre: string;       // como se escribe, para enseñarlo
  clave: string;        // en minusculas, para no duplicar a la misma persona
}

export interface Resultado {
  puesto: number;
  nombre: string;
  puntos: number;
}

export interface Carrera {
  abierta: boolean;         // si se admiten apuntados
  corredores: Corredor[];
  resultado: Resultado[];   // vacio hasta que se corre
  corridaEn: string;        // cuando se corrio
}

// Los puntos se los lleva solo quien gana; el resto corre por el honor.
export interface Ajustes {
  puntos: number;       // lo que gana el primero
  duracion: number;     // lo que tarda la carrera, en segundos
  palabra: string;      // lo que se escribe en el chat para apuntarse
}

export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 10, duracion: 8, palabra: '!correr' };
const MAX_CORREDORES = 50;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La carrera en curso vive en memoria: es de un rato, no de guardarla.
const carreras = new Map<string, Carrera>();
// La conexion al chat mientras hay inscripcion abierta.
const escuchas = new Map<string, chat.Conexion>();

export function estado(uid: string): Carrera & { escuchando: string; ajustes: Ajustes } {
  const c = carreras.get(uid) || { abierta: false, corredores: [], resultado: [], corridaEn: '' };
  return { ...c, escuchando: escuchas.get(uid)?.canal || '', ajustes: leerAjustes(uid) };
}

// --- Ajustes del minijuego ---------------------------------------------

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'minijuegos.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    if (!fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO };
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...AJUSTES_POR_DEFECTO, ...(parsed?.carrera || {}) };
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes.puntos != null) {
    actual.puntos = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.puntos) || 0)));
  }
  if (ajustes.duracion != null) {
    // Entre 3 segundos y 10 minutos: da para una carrera larga en directo.
    actual.duracion = Math.max(3, Math.min(600, Math.floor(Number(ajustes.duracion) || 8)));
  }
  if (typeof ajustes.palabra === 'string') {
    actual.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivoAjustes(uid), { carrera: actual });
  return actual;
}

// --- Puntos -------------------------------------------------------------

export type Monedero = Record<string, { nombre: string; puntos: number }>;

function archivoPuntos(uid: string): string {
  return path.join(deps.userDir(uid), 'puntos.json');
}

export function leerPuntos(uid: string): Monedero {
  try {
    const f = archivoPuntos(uid);
    if (!fs.existsSync(f)) return {};
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('Failed to read points:', err);
    return {};
  }
}

function guardarPuntos(uid: string, m: Monedero): void {
  deps.ensureUserDir(uid);
  deps.writeJson(archivoPuntos(uid), m);
}

export function sumarPuntos(uid: string, nombre: string, cuantos: number): number {
  const m = leerPuntos(uid);
  const clave = nombre.trim().toLowerCase();
  if (!clave) return 0;
  const antes = m[clave]?.puntos || 0;
  m[clave] = { nombre: nombre.trim().slice(0, 40), puntos: Math.max(0, antes + cuantos) };
  guardarPuntos(uid, m);
  return m[clave].puntos;
}

// Descuenta si llega; devuelve false y no toca nada si no hay bastante. Es lo
// que usara el canje de tiradas cuando este el paqueton.
export function gastarPuntos(uid: string, nombre: string, cuantos: number): boolean {
  const m = leerPuntos(uid);
  const clave = nombre.trim().toLowerCase();
  const tiene = m[clave]?.puntos || 0;
  if (cuantos <= 0 || tiene < cuantos) return false;
  m[clave] = { nombre: m[clave].nombre, puntos: tiene - cuantos };
  guardarPuntos(uid, m);
  return true;
}

export function tabla(uid: string, limite = 20): { nombre: string; puntos: number }[] {
  return Object.values(leerPuntos(uid))
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, limite);
}

// --- La carrera ---------------------------------------------------------

// Abre la inscripcion y se pone a escuchar el chat. Quien escriba la palabra
// se apunta; el resto de mensajes se ignoran.
export function abrir(uid: string, canal: string, palabra?: string): Carrera {
  cerrarEscucha(uid);
  const carrera: Carrera = { abierta: true, corredores: [], resultado: [], corridaEn: '' };
  carreras.set(uid, carrera);

  const buscada = (palabra || leerAjustes(uid).palabra).trim().toLowerCase();
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!carrera.abierta) return;
    if (m.texto.trim().toLowerCase() !== buscada) return;
    apuntar(uid, m.autor);
  }));
  return carrera;
}

// Apuntar a alguien. Separada del chat para poder añadir a mano y para probar.
export function apuntar(uid: string, nombre: string): boolean {
  const carrera = carreras.get(uid);
  if (!carrera || !carrera.abierta) return false;
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const clave = limpio.toLowerCase();
  // Ni repetidos ni mas de la cuenta: con demasiados, la carrera no se ve.
  if (carrera.corredores.some((c) => c.clave === clave)) return false;
  if (carrera.corredores.length >= MAX_CORREDORES) return false;
  carrera.corredores.push({ nombre: limpio, clave });
  return true;
}

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Cierra la inscripcion, decide el orden de llegada y reparte los puntos.
export function correr(uid: string): Carrera | null {
  const carrera = carreras.get(uid);
  if (!carrera || carrera.corredores.length < 2) return null;
  // Una carrera se corre una sola vez: si no, pulsando otra vez se repartirian
  // los puntos de nuevo con los mismos corredores.
  if (!carrera.abierta) return null;

  carrera.abierta = false;
  cerrarEscucha(uid);

  // Orden al azar, que es lo que hace una carrera de balineras: el resultado
  // no depende de nada del corredor.
  const orden = carrera.corredores.slice();
  for (let i = orden.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [orden[i], orden[j]] = [orden[j], orden[i]];
  }

  const premio = leerAjustes(uid).puntos;
  carrera.resultado = orden.map((c, i) => {
    // Solo gana puntos el que llega primero.
    const puntos = i === 0 ? premio : 0;
    if (puntos > 0) sumarPuntos(uid, c.nombre, puntos);
    return { puesto: i + 1, nombre: c.nombre, puntos };
  });
  carrera.corridaEn = new Date().toISOString();
  return carrera;
}

// Tira la carrera actual y deja de escuchar.
export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  carreras.delete(uid);
}
