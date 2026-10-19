// El registro: lo que pasa en produccion, para poder mirarlo despues.
//
// Cada entrada sale por la consola en una sola linea JSON, que es lo que
// guarda el hosting en sus logs (y en local, %TEMP%\ruleton-server.log). Y las
// ultimas se quedan tambien en memoria, para verlas desde la pagina con
// GET /api/admin/registro sin tener que entrar al hosting.
//
// Lo de memoria se pierde al reiniciar; lo que de verdad queda es la consola.
// Por eso un fallo que tumba el proceso se apunta ahi antes de salir.

export type Nivel = 'info' | 'aviso' | 'error';

export interface Entrada {
  t: string;
  nivel: Nivel;
  evento: string;
  [dato: string]: unknown;
}

// Las que se guardan en memoria. Las mas viejas se van.
export const MAXIMO = 500;
const ultimas: Entrada[] = [];

export function apuntar(nivel: Nivel, evento: string, datos: Record<string, unknown> = {}): void {
  const e: Entrada = { t: new Date().toISOString(), nivel, evento, ...datos };
  ultimas.push(e);
  if (ultimas.length > MAXIMO) ultimas.splice(0, ultimas.length - MAXIMO);
  let linea: string;
  try { linea = JSON.stringify(e); } catch (err) { linea = JSON.stringify({ t: e.t, nivel, evento, nota: 'datos sin JSON' }); }
  if (nivel === 'error') console.error('[registro] ' + linea); else console.log('[registro] ' + linea);
}

// Las ultimas, de la mas nueva a la mas vieja.
export function ultimos(cuantas = 100, nivel?: unknown): Entrada[] {
  const n = Math.max(1, Math.min(MAXIMO, Math.floor(Number(cuantas)) || 100));
  const lista = nivel ? ultimas.filter((e) => e.nivel === nivel) : ultimas;
  return lista.slice(-n).reverse();
}

// Un error, en algo que se pueda guardar: el mensaje y donde salto.
export function comoDato(err: unknown): { mensaje: string; pila?: string } {
  if (err instanceof Error) return { mensaje: err.message, pila: err.stack };
  return { mensaje: String(err) };
}

// Lo que manda el navegador viene de fuera: se corta para que no llene nada.
export function recortar(valor: unknown, largo: number): string {
  return String(valor ?? '').slice(0, largo);
}
