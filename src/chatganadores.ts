// Lo que escribe en el chat el ganador actual.
//
// Para entregar un premio hay que saber donde esta la persona o con que
// personaje: eso lo dice en el chat, y entre cien mensajes se pierde. Aqui se
// escucha el chat del perfil todo el rato (como anonimo, ver chat.ts) y se
// enseña solo lo que dice el ultimo que ha ganado.
//
// Solo se guarda eso: lo que escribe el ganador actual desde que gano. Del
// resto del chat no se guarda nada, y en cuanto gana otro (o el mismo vuelve a
// ganar) lo de antes se tira. Y solo en memoria: un reinicio lo borra, que el
// chat no es algo que tenga que quedarse en disco.

import * as chat from './chat';

export interface Linea {
  autor: string;
  texto: string;
  fecha: string;        // ISO
}

// El ganador actual de un servidor: quien es y desde cuando (en ms). Una cuenta
// tiene uno por servidor.
export interface Actual {
  nombre: string;
  desde: number;
}

// Cuantos mensajes del ganador se recuerdan por cuenta, y cuantos se devuelven.
const RECUERDA = 500;
const DEVUELVE = 200;

// Cuanto vale la lista de ganadores actuales antes de volver a leerla. Se mira
// con cada mensaje del chat, y leer los archivos de ganadores cada vez en un
// chat movido seria leer disco sin parar. Al cambiar los ganadores se tira
// antes (ver olvidarNombres).
const NOMBRES_MS = 5000;

export interface Dependencias {
  canalDe(uid: string): string;
  // El ultimo ganador de cada servidor de la cuenta.
  ganadoresActuales(uid: string): Actual[];
  // Ha escrito el ganador actual.
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
const escuchas = new Map<string, chat.Conexion>();
const lineas = new Map<string, Linea[]>();
// uid -> nombre normalizado -> desde cuando es ganador.
const actuales = new Map<string, { de: Map<string, number>; hasta: number }>();

// Igual que en Ganadores: sin mayusculas ni tildes, y sin la @ que se pone al
// escribir el nombre de alguien de Twitch.
export function normalizar(nombre: unknown): string {
  return String(nombre ?? '').trim().replace(/^@+/, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function actualesDe(uid: string): Map<string, number> {
  const ahora = Date.now();
  const c = actuales.get(uid);
  if (c && c.hasta > ahora) return c.de;
  const de = new Map<string, number>();
  for (const a of deps.ganadoresActuales(uid)) {
    const n = normalizar(a.nombre);
    if (!n) continue;
    // Si gana en dos servidores, vale desde la primera vez.
    const antes = de.get(n);
    de.set(n, antes === undefined ? a.desde : Math.min(antes, a.desde));
  }
  actuales.set(uid, { de, hasta: ahora + NOMBRES_MS });
  return de;
}

// Han cambiado los ganadores: se vuelven a leer, y lo que ya no es del ganador
// actual (o es de antes de que volviera a ganar) se tira.
export function olvidarNombres(uid: string): void {
  actuales.delete(uid);
  const suyas = lineas.get(uid);
  if (!suyas || !suyas.length) return;
  const de = actualesDe(uid);
  const quedan = suyas.filter((l) => {
    const desde = de.get(normalizar(l.autor));
    return desde !== undefined && Date.parse(l.fecha) >= desde;
  });
  if (quedan.length) lineas.set(uid, quedan); else lineas.delete(uid);
}

// Un mensaje del chat. Exportada para poder probarla sin chat.
export function alMensaje(uid: string, m: chat.Mensaje, fecha = new Date()): void {
  const desde = actualesDe(uid).get(normalizar(m.autor));
  // De quien no es el ganador actual no se guarda nada.
  if (desde === undefined || fecha.getTime() < desde) return;
  let suyas = lineas.get(uid);
  if (!suyas) { suyas = []; lineas.set(uid, suyas); }
  suyas.push({ autor: m.autor, texto: String(m.texto).slice(0, 500), fecha: fecha.toISOString() });
  if (suyas.length > RECUERDA) suyas.splice(0, suyas.length - RECUERDA);
  deps.alCambiar?.(uid);
}

// Lo que ha escrito ese ganador desde «desde» (ms), lo mas nuevo primero.
export function de(uid: string, ganador: string, desde = 0): Linea[] {
  const buscado = normalizar(ganador);
  if (!buscado) return [];
  const suyas = lineas.get(uid) || [];
  const r: Linea[] = [];
  for (let i = suyas.length - 1; i >= 0 && r.length < DEVUELVE; i--) {
    if (Date.parse(suyas[i].fecha) < desde) break;
    if (normalizar(suyas[i].autor) === buscado) r.push(suyas[i]);
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
