// Diagnostico: para saber por que el servidor deja de contestar.
//
// En produccion el proceso se queda sin contestar (el proxy da 504 a los dos
// minutos) y desde fuera no se ve por que. Las causas posibles se distinguen
// mirando cuatro cosas, y esto apunta las cuatro en el registro (la consola,
// que es lo que guarda el hosting: con el proceso colgado no se puede
// preguntar por /api/admin/registro):
//
//  - El hilo bloqueado: algo sincrono (un JSON.parse enorme, un bucle) que no
//    suelta. Se nota en que un temporizador de cada segundo llega tarde;
//    «hilo-bloqueado» dice cuanto y que peticiones y operaciones habia en curso.
//  - Peticiones que esperan algo que no llega (una descarga, una promesa que
//    no se resuelve), con el hilo libre: «peticion-atascada» a los 20 s, con lo
//    que estaba haciendo.
//  - Memoria: «memoria» cada 5 minutos y cada vez que sube 100 MB por encima
//    de lo visto, con el limite del proceso. Si se acerca al limite, el
//    recolector se come la CPU y todo va a cámara lenta.
//  - El proceso que se va: la señal con la que lo para el hosting y el codigo
//    de salida. Un reinicio sin «senal» ni «salida» es que lo mataron de golpe
//    (sin memoria, por ejemplo).
//
// Las operaciones largas (leer o bajar un catalogo, comprimir una respuesta,
// la precarga) se marcan con medir(): si tardan mas de lo normal se apuntan
// solas, y mientras duran salen en los avisos de arriba.

import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import * as registro from './registro';

const MB = 1024 * 1024;
// Cada cuanto se mira el hilo, y desde cuanto retraso se apunta.
const PULSO_MS = 1000;
const BLOQUEO_MS = 1000;
// Una peticion que lleva esto sin contestar se apunta (una vez).
const ATASCO_MS = 20000;
// Una operacion marcada que tarda mas que esto se apunta al acabar.
const LENTA_MS = 2000;

interface EnCurso { id: number; metodo: string; ruta: string; desde: number; avisada?: boolean }

const peticiones = new Map<number, EnCurso>();
const operaciones = new Map<number, { nombre: string; desde: number; datos?: Record<string, unknown> }>();
// Las ultimas que acabaron. Una operacion sincrona que bloquea el hilo ya ha
// acabado cuando el pulso llega tarde: sin esto, el aviso no diria cual fue.
const recientes: { op: string; ms: number; acabo: number }[] = [];
let contador = 0;
let canales = 0;

function rutaCorta(req: any): string {
  return String(req.method) + ' ' + String(req.originalUrl || req.url || '').split('?')[0].slice(0, 120);
}

function memoria(): Record<string, number> {
  const m = process.memoryUsage();
  return {
    rssMB: Math.round(m.rss / MB),
    heapMB: Math.round(m.heapUsed / MB),
    heapTotalMB: Math.round(m.heapTotal / MB),
    externoMB: Math.round(m.external / MB),
    limiteHeapMB: Math.round(v8.getHeapStatistics().heap_size_limit / MB)
  };
}

// Lo que hay en marcha ahora mismo, de lo mas viejo a lo mas nuevo.
function enMarcha(ahora = Date.now()) {
  const p = Array.from(peticiones.values())
    .filter((x) => !x.ruta.endsWith('/eventos'))
    .sort((a, b) => a.desde - b.desde)
    .slice(0, 8)
    .map((x) => ({ ruta: x.ruta, ms: ahora - x.desde }));
  const o = Array.from(operaciones.values())
    .sort((a, b) => a.desde - b.desde)
    .slice(0, 8)
    .map((x) => ({ op: x.nombre, ms: ahora - x.desde, ...(x.datos || {}) }));
  return { peticiones: p, operaciones: o, totalPeticiones: peticiones.size, canalesAbiertos: canales };
}

// Va el primero de todos los middleware: asi cuenta tambien lo que se queda
// esperando el cuerpo.
export function middleware(req: any, res: any, next: () => void): void {
  const id = ++contador;
  const e: EnCurso = { id, metodo: req.method, ruta: rutaCorta(req), desde: Date.now() };
  const esCanal = e.ruta.endsWith('/eventos');
  peticiones.set(id, e);
  if (esCanal) canales++;
  let hecho = false;
  const fin = () => {
    if (hecho) return;
    hecho = true;
    peticiones.delete(id);
    if (esCanal) canales--;
  };
  res.on('finish', fin);
  res.on('close', fin);
  next();
}

// Marca una operacion larga. Devuelve la funcion de acabarla.
export function medir(nombre: string, datos?: Record<string, unknown>): () => void {
  const id = ++contador;
  const desde = Date.now();
  operaciones.set(id, { nombre, desde, datos });
  return () => {
    if (!operaciones.delete(id)) return;
    const ms = Date.now() - desde;
    recientes.push({ op: nombre, ms, acabo: Date.now() });
    if (recientes.length > 20) recientes.shift();
    if (ms >= LENTA_MS) registro.apuntar('aviso', 'operacion-lenta', { op: nombre, ms, ...(datos || {}), memoria: memoria() });
  };
}

// Lo mismo para una promesa: la marca mientras dura.
export async function medida<T>(nombre: string, datos: Record<string, unknown> | undefined, hacer: () => Promise<T>): Promise<T> {
  const acabar = medir(nombre, datos);
  try { return await hacer(); } finally { acabar(); }
}

// El commit que esta corriendo, para saber que version hay de verdad en
// produccion. Leido de .git sin lanzar git; si no hay, vacio.
function commit(): string {
  try {
    const git = path.join(process.cwd(), '.git');
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head.slice(0, 12);
    const ref = head.slice(4).trim();
    const suelto = path.join(git, ref);
    if (fs.existsSync(suelto)) return fs.readFileSync(suelto, 'utf8').trim().slice(0, 12);
    const empaquetados = fs.readFileSync(path.join(git, 'packed-refs'), 'utf8');
    const linea = empaquetados.split('\n').find((l) => l.trim().endsWith(' ' + ref));
    return linea ? linea.slice(0, 12) : '';
  } catch {
    return '';
  }
}

let iniciado = false;

export function iniciar(datos: Record<string, unknown> = {}): void {
  if (iniciado) return;
  iniciado = true;
  registro.apuntar('info', 'inicio', {
    pid: process.pid, node: process.version, commit: commit(), cwd: process.cwd(), ...datos, memoria: memoria()
  });

  // El hilo: un pulso cada segundo que tendria que llegar a su hora.
  let esperado = Date.now() + PULSO_MS;
  const pulso = setInterval(() => {
    const ahora = Date.now();
    const retraso = ahora - esperado;
    esperado = ahora + PULSO_MS;
    if (retraso >= BLOQUEO_MS) {
      const desdeBloqueo = ahora - retraso - PULSO_MS;
      const acabadas = recientes.filter((r) => r.acabo >= desdeBloqueo).map((r) => ({ op: r.op, ms: r.ms }));
      registro.apuntar('aviso', 'hilo-bloqueado', { ms: retraso, acabadasEntreMedias: acabadas, ...enMarcha(ahora), memoria: memoria() });
    }
  }, PULSO_MS);
  pulso.unref();

  // Peticiones que no acaban, con el hilo libre.
  const vigia = setInterval(() => {
    const ahora = Date.now();
    for (const p of peticiones.values()) {
      if (p.avisada || p.ruta.endsWith('/eventos') || ahora - p.desde < ATASCO_MS) continue;
      p.avisada = true;
      registro.apuntar('aviso', 'peticion-atascada', { ruta: p.ruta, ms: ahora - p.desde, ...enMarcha(ahora), memoria: memoria() });
    }
  }, 5000);
  vigia.unref();

  // La memoria: de vez en cuando, y en cuanto sube de golpe.
  let maximoRss = process.memoryUsage().rss;
  let ultimaVez = Date.now();
  const medidor = setInterval(() => {
    const rss = process.memoryUsage().rss;
    const sube = rss > maximoRss + 100 * MB;
    if (rss > maximoRss) maximoRss = rss;
    if (sube || Date.now() - ultimaVez >= 5 * 60000) {
      ultimaVez = Date.now();
      registro.apuntar(sube ? 'aviso' : 'info', 'memoria', { ...memoria(), ...enMarcha() });
    }
  }, 15000);
  medidor.unref();

  // Como se va el proceso. Con una señal hay que salir a mano: escucharla
  // quita la salida de siempre.
  for (const senal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(senal, () => {
      registro.apuntar('aviso', 'senal', { senal, ...enMarcha(), memoria: memoria() });
      process.exit(0);
    });
  }
  process.on('exit', (codigo) => {
    registro.apuntar('aviso', 'salida', { codigo, memoria: memoria() });
  });
  process.on('warning', (w) => {
    registro.apuntar('aviso', 'aviso-node', { nombre: w.name, mensaje: w.message });
  });
}
