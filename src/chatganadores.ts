// Lo que escriben en el chat los ganadores pendientes de entrega.
//
// Para entregar un premio hay que saber donde esta la persona o con que
// personaje: eso lo dice en el chat, y entre cien mensajes se pierde. Aqui se
// escucha el chat del perfil todo el rato (como anonimo, ver chat.ts) y la
// pestaña de Ganadores enseña solo lo de quien tiene algo pendiente.
//
// Se guarda todo lo ultimo que pasa por el chat, no solo lo de los ganadores:
// asi lo que alguien escribio un momento antes de ganar tambien sale. Y solo en
// memoria: un reinicio lo borra, que el chat no es algo que tenga que quedarse
// en disco.

import * as chat from './chat';

export interface Linea {
  autor: string;
  texto: string;
  fecha: string;        // ISO
}

// Cuantos mensajes del chat se recuerdan por cuenta, y cuantos se devuelven.
const RECUERDA = 2000;
const DEVUELVE = 200;

// Cuanto vale la lista de nombres de ganadores antes de volver a leerla. Se
// mira con cada mensaje del chat, y leer los archivos de ganadores cada vez en
// un chat movido seria leer disco sin parar.
const NOMBRES_MS = 5000;

export interface Dependencias {
  canalDe(uid: string): string;
  // Los ganadores pendientes de todos los servidores de la cuenta.
  nombresGanadores(uid: string): string[];
  // Ha escrito alguien que tiene un premio pendiente.
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
const escuchas = new Map<string, chat.Conexion>();
const lineas = new Map<string, Linea[]>();
const nombres = new Map<string, { set: Set<string>; hasta: number }>();

// Igual que en Ganadores: sin mayusculas ni tildes, y sin la @ que se pone al
// escribir el nombre de alguien de Twitch.
export function normalizar(nombre: unknown): string {
  return String(nombre ?? '').trim().replace(/^@+/, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function nombresDe(uid: string): Set<string> {
  const ahora = Date.now();
  const c = nombres.get(uid);
  if (c && c.hasta > ahora) return c.set;
  const set = new Set(deps.nombresGanadores(uid).map(normalizar).filter(Boolean));
  nombres.set(uid, { set, hasta: ahora + NOMBRES_MS });
  return set;
}

// Han cambiado los ganadores: la proxima vez se leen de nuevo.
export function olvidarNombres(uid: string): void {
  nombres.delete(uid);
}

// Un mensaje del chat. Exportada para poder probarla sin chat.
export function alMensaje(uid: string, m: chat.Mensaje, fecha = new Date()): void {
  let suyas = lineas.get(uid);
  if (!suyas) { suyas = []; lineas.set(uid, suyas); }
  suyas.push({ autor: m.autor, texto: String(m.texto).slice(0, 500), fecha: fecha.toISOString() });
  if (suyas.length > RECUERDA) suyas.splice(0, suyas.length - RECUERDA);
  if (nombresDe(uid).has(normalizar(m.autor))) deps.alCambiar?.(uid);
}

// Lo que han escrito esos ganadores, lo mas nuevo primero.
export function de(uid: string, ganadores: string[]): Linea[] {
  const buscados = new Set(ganadores.map(normalizar).filter(Boolean));
  if (!buscados.size) return [];
  const suyas = lineas.get(uid) || [];
  const r: Linea[] = [];
  for (let i = suyas.length - 1; i >= 0 && r.length < DEVUELVE; i--) {
    if (buscados.has(normalizar(suyas[i].autor))) r.push(suyas[i]);
  }
  return r;
}


export function salud(uid: string): chat.Salud | null {
  return escuchas.get(uid)?.salud() || null;
}

// Abre la escucha del canal del perfil, o la cierra si no hay. Se llama al
// arrancar y al cambiar el canal.
export function rehacer(uid: string): void {
  const canal = deps.canalDe(uid);
  const actual = escuchas.get(uid);
  if (actual && actual.canal === canal) return;
  if (actual) { actual.cerrar(); escuchas.delete(uid); }
  // Otro canal es otro chat: lo de antes no es de este.
  lineas.delete(uid);
  if (!canal) return;
  escuchas.set(uid, chat.conectar(canal, (m) => alMensaje(uid, m)));
}

export function iniciar(d: Dependencias, usuarios: string[] = []): void {
  deps = d;
  for (const uid of usuarios) {
    try { rehacer(uid); } catch (err) { console.error('chat de ganadores: no se pudo escuchar', uid, err); }
  }
}
