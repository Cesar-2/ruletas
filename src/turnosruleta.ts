// Los turnos de la Ruleta de objetos: quien ha canjeado la recompensa de puntos
// de canal que crea el Ruleton y espera a que le giren la ruleta.
//
// Antes el canje sorteaba solo, por detras, y en directo no se veia nada.
// Ahora el nombre llega a la pagina, al «Nombre del ganador», y el streamer
// gira delante del chat como con cualquier otro ganador. Igual que con los
// cartones del bingo: canjeas y sale tu nombre. Si llegan varios seguidos se
// quedan en fila, por orden de llegada.
//
// El canje se queda en la cola de Twitch hasta que se usa: al ponerlo en la
// ruleta se marca como cumplido, y si el streamer lo quita se cancela, que es
// lo que le devuelve los puntos (ver twitch.ts).
//
// Vive en disco y no en memoria: quien ha pagado no puede quedarse sin su
// tirada porque el servidor se reinicie.

import fs from 'fs';
import path from 'path';

export interface Turno {
  id: string;           // el id del canje en Twitch
  recompensa: string;   // el id de la recompensa, para cerrar el canje
  nombre: string;       // como sale en el chat: es lo que va a la ruleta
  login: string;
  cuando: string;
}

// Es una fila de espera, no un registro: si se acumulan mas, algo va mal y no
// interesa que crezca sin fin.
export const MAXIMO = 200;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Para que la pagina ponga el nombre al momento. Ver avisos.ts.
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

function archivo(uid: string): string {
  return path.join(deps.userDir(uid), 'turnos-ruleta.json');
}

export function leer(uid: string): Turno[] {
  try {
    const f = archivo(uid);
    if (!fs.existsSync(f)) return [];
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(crudo) ? crudo.filter((t) => t && t.id && t.nombre) : [];
  } catch (err) {
    console.error('Failed to read roulette turns:', err);
    return [];
  }
}

function guardar(uid: string, turnos: Turno[]): void {
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), turnos);
  deps.alCambiar?.(uid);
}

// Uno mas al final de la fila. false si no cabe (y entonces se le devuelven
// los puntos). El mismo canje dos veces (Twitch puede repetir un aviso) cuenta
// una.
export function apuntar(uid: string, t: { id: string; recompensa: string; nombre: string; login?: string }): boolean {
  const id = String(t.id || '');
  const nombre = String(t.nombre || '').trim().slice(0, 120);
  if (!id || !nombre) return false;
  const turnos = leer(uid);
  if (turnos.some((x) => x.id === id)) return true;
  if (turnos.length >= MAXIMO) return false;
  turnos.push({
    id, nombre,
    recompensa: String(t.recompensa || ''),
    login: String(t.login || '').toLowerCase(),
    cuando: new Date().toISOString()
  });
  guardar(uid, turnos);
  return true;
}

// Lo saca de la fila, sea para girarle la ruleta o para quitarlo. Devuelve el
// que era, o null si ya no estaba.
export function sacar(uid: string, id: unknown): Turno | null {
  const turnos = leer(uid);
  const i = turnos.findIndex((x) => x.id === String(id));
  if (i < 0) return null;
  const [t] = turnos.splice(i, 1);
  guardar(uid, turnos);
  return t;
}
