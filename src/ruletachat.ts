// Inscripcion por chat para la ruleta de nombres.
//
// La ruleta de nombres vive en el navegador: la lista es un textarea que se
// guarda en local. Esto solo anade una forma mas de llenarla, la misma que ya
// usan la carrera y la batalla: se abre el chat, quien escribe la palabra
// entra en la lista, y la pagina se la va llevando.
//
// Aqui no se sortea nada: quien gira sigue siendo la pagina.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';

export interface Ajustes {
  palabra: string;      // lo que se escribe en el chat para apuntarse
}

export const AJUSTES_POR_DEFECTO: Ajustes = { palabra: '!ruleta' };

// Con mas de esto la ruleta no se lee, y la lista es del navegador.
const MAX_NOMBRES = 200;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// Lo apuntado es de un rato: vive en memoria, como la carrera.
const listas = new Map<string, string[]>();
const escuchas = new Map<string, chat.Conexion>();

export interface Estado {
  abierta: boolean;
  nombres: string[];
  escuchando: string;
  palabra: string;
}

export function estado(uid: string): Estado {
  return {
    abierta: escuchas.has(uid),
    nombres: listas.get(uid) || [],
    escuchando: escuchas.get(uid)?.canal || '',
    palabra: leerAjustes(uid).palabra
  };
}

// --- Ajustes ------------------------------------------------------------

// El mismo archivo que la carrera: una llave por minijuego. Se lee entero y se
// reescribe entero, para no llevarse por delante lo de los otros.
function archivo(uid: string): string {
  return path.join(deps.userDir(uid), 'minijuegos.json');
}

function leerTodo(uid: string): Record<string, unknown> {
  try {
    const f = archivo(uid);
    if (!fs.existsSync(f)) return {};
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
    return {};
  }
}

export function leerAjustes(uid: string): Ajustes {
  const guardado = leerTodo(uid).ruleta as Partial<Ajustes> | undefined;
  return { ...AJUSTES_POR_DEFECTO, ...(guardado || {}) };
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (typeof ajustes.palabra === 'string') {
    actual.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), { ...leerTodo(uid), ruleta: actual });
  return actual;
}

// --- La inscripcion -----------------------------------------------------

// Abre el chat. No se vacia la lista: puede que ya hubiera gente escrita a
// mano en la pagina, y se apuntan encima.
export function abrir(uid: string, canal: string, palabra?: string): Estado {
  cerrar(uid);
  if (!listas.has(uid)) listas.set(uid, []);
  const buscada = (palabra || leerAjustes(uid).palabra).trim().toLowerCase();
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (m.texto.trim().toLowerCase() !== buscada) return;
    apuntar(uid, m.autor);
  }));
  return estado(uid);
}

export function cerrar(uid: string): Estado {
  escuchas.get(uid)?.cerrar();
  escuchas.delete(uid);
  return estado(uid);
}

// Apuntar a alguien. Separada del chat para poder probarla y para anadir a
// mano si alguna vez hace falta.
export function apuntar(uid: string, nombre: string): boolean {
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const lista = listas.get(uid) || [];
  // Ni repetidos ni mas de la cuenta.
  if (lista.some((n) => n.toLowerCase() === limpio.toLowerCase())) return false;
  if (lista.length >= MAX_NOMBRES) return false;
  lista.push(limpio);
  listas.set(uid, lista);
  return true;
}

// La pagina ya se ha llevado los nombres a su lista: aqui no hacen falta.
export function vaciar(uid: string): Estado {
  listas.set(uid, []);
  return estado(uid);
}
