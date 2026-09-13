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
import { Cronometro } from './cronometro';

export interface Corredor {
  nombre: string;       // como se escribe, para enseñarlo
  clave: string;        // en minusculas, para no duplicar a la misma persona
}

export interface Resultado {
  puesto: number;
  nombre: string;
  puntos: number;
}

// Algo que pasa a mitad de carrera y merece contarse.
export interface Evento {
  tick: number;
  texto: string;
}

export interface Carrera {
  abierta: boolean;         // si se admiten apuntados
  corredores: Corredor[];
  resultado: Resultado[];   // vacio hasta que se corre
  corridaEn: string;        // cuando se corrio
  // La carrera tick a tick: para cada instante, lo que lleva recorrido cada
  // corredor (de 0 a 1, en el mismo orden que `corredores`). La pagina no
  // decide nada; solo reproduce esto.
  marcas: number[][];
  eventos: Evento[];
}

// Cuantos instantes tiene la carrera. Ni tan pocos que se vea a saltos ni
// tantos que la respuesta se haga enorme con mucha gente.
const TICKS_MIN = 24;
const TICKS_MAX = 160;

// Quien corre. El resultado es el mismo con todos: solo cambia el bicho.
export const ANIMACIONES = ['caballos', 'patos', 'hormigas', 'larvas'] as const;
export type Animacion = typeof ANIMACIONES[number];

// Los puntos se los lleva solo quien gana; el resto corre por el honor.
export interface Ajustes {
  puntos: number;       // lo que gana el primero
  duracion: number;     // lo que tarda la carrera, en segundos
  palabra: string;      // lo que se escribe en el chat para apuntarse
  animacion: Animacion; // quien corre por la pista
}

export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 10, duracion: 8, palabra: '!correr', animacion: 'caballos' };

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
// Al llegar la hora deja de escuchar el chat. La carrera no se corre sola:
// sigue esperando a que el streamer pulse «¡Correr!».
const crono = new Cronometro((uid) => cerrarEscucha(uid));

export function estado(uid: string): Carrera & { escuchando: string; ajustes: Ajustes; cierraEn: number; ahora: number } {
  const c = carreras.get(uid) || { abierta: false, corredores: [], resultado: [], corridaEn: '', marcas: [], eventos: [] };
  return {
    ...c, escuchando: escuchas.get(uid)?.canal || '', ajustes: leerAjustes(uid),
    cierraEn: crono.cierraEn(uid), ahora: Date.now()
  };
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
    const ajustes = { ...AJUSTES_POR_DEFECTO, ...(parsed?.carrera || {}) };
    // Guardado hace tiempo, con animaciones que ya no existen.
    if (!ANIMACIONES.includes(ajustes.animacion)) ajustes.animacion = AJUSTES_POR_DEFECTO.animacion;
    return ajustes;
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
  if (ANIMACIONES.includes(ajustes.animacion as Animacion)) {
    actual.animacion = ajustes.animacion as Animacion;
  }
  deps.ensureUserDir(uid);
  // El archivo lo comparten los minijuegos: se reescribe entero para no
  // llevarse por delante los ajustes de los otros.
  let todo: Record<string, unknown> = {};
  try {
    const f = archivoAjustes(uid);
    if (fs.existsSync(f)) todo = JSON.parse(fs.readFileSync(f, "utf8")) || {};
  } catch (err) {
    console.error("Failed to read minigame settings:", err);
  }
  deps.writeJson(archivoAjustes(uid), { ...todo, carrera: actual });
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

// Pone una cantidad exacta, en vez de sumar. Sirve para corregir a mano y para
// dar de alta a alguien que no ha jugado todavia.
export function ponerPuntos(uid: string, nombre: string, cuantos: number): boolean {
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const valor = Math.max(0, Math.min(1000000000, Math.floor(Number(cuantos) || 0)));
  const m = leerPuntos(uid);
  m[limpio.toLowerCase()] = { nombre: limpio, puntos: valor };
  guardarPuntos(uid, m);
  return true;
}

export function borrarPuntos(uid: string, nombre: string): boolean {
  const clave = String(nombre || '').trim().toLowerCase();
  const m = leerPuntos(uid);
  if (!m[clave]) return false;
  delete m[clave];
  guardarPuntos(uid, m);
  return true;
}

// Deja el marcador a cero del todo.
export function vaciarPuntos(uid: string): void {
  guardarPuntos(uid, {});
}

// --- La carrera ---------------------------------------------------------

// Abre la inscripcion y se pone a escuchar el chat. Quien escriba la palabra
// se apunta; el resto de mensajes se ignoran.
// Con segundos, la inscripcion se cierra sola cuando se acaban.
export function abrir(uid: string, canal: string, palabra?: string, segundos?: unknown): Carrera {
  cerrarEscucha(uid);
  crono.poner(uid, segundos);
  const carrera: Carrera = { abierta: true, corredores: [], resultado: [], corridaEn: '', marcas: [], eventos: [] };
  carreras.set(uid, carrera);

  const buscada = (palabra || leerAjustes(uid).palabra).trim().toLowerCase();
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!carrera.abierta) return;
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    apuntar(uid, m.autor);
  }));
  return carrera;
}

// Apuntar a alguien. Separada del chat para poder añadir a mano y para probar.
export function apuntar(uid: string, nombre: string): boolean {
  const carrera = carreras.get(uid);
  if (!carrera || !carrera.abierta) return false;
  // Con el cronometro vencido ya no entra nadie, ni por el chat ni a mano.
  if (crono.vencido(uid)) return false;
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const clave = limpio.toLowerCase();
  // Repetidos no; de resto, cabe todo el mundo.
  if (carrera.corredores.some((c) => c.clave === clave)) return false;
  carrera.corredores.push({ nombre: limpio, clave });
  return true;
}

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Simula la carrera instante a instante. Cada balinera avanza un poco al azar
// en cada tick, con algun tropiezo y algun tiron, asi que se adelantan entre
// ellas por el camino. Todas juegan con las mismas reglas: nadie tiene ventaja.
//
// Deja en la carrera las marcas (lo recorrido por cada uno en cada instante) y
// los eventos que merece la pena contar, y devuelve el orden de llegada.
function simular(carrera: Carrera, duracion: number): Corredor[] {
  const cuantos = carrera.corredores.length;
  // Cuanta mas gente, menos instantes se guardan: no limita a nadie, pero
  // evita que la respuesta se vuelva enorme con una carrera multitudinaria.
  const porDuracion = Math.max(TICKS_MIN, Math.min(TICKS_MAX, Math.round(duracion * 4)));
  const cabe = cuantos > 0 ? Math.floor(20000 / cuantos) : TICKS_MAX;
  const ticks = Math.max(TICKS_MIN, Math.min(porDuracion, cabe));

  // Se simula tick a tick porque lo que corre cada uno depende de por donde
  // va: el que se queda atras aprieta y al de delante le cuesta mas. Sin esto
  // el que coge ventaja al principio gana casi siempre, y no hay carrera.
  const EMPUJE = 2.4;
  const recorrido: number[][] = Array.from({ length: cuantos }, () => [] as number[]);
  const posicion = new Array(cuantos).fill(0);
  const tropiezos: Evento[] = [];

  for (let t = 0; t < ticks; t++) {
    const lider = Math.max(...posicion);
    // Hacia el final la cosa se descontrola un poco mas, para que se decida
    // en la recta final y no a mitad de carrera.
    const recta = 1 + 1.2 * (t / ticks);

    for (let c = 0; c < cuantos; c++) {
      // Cuanto le falta para alcanzar al primero, de 0 (va lider) a 1.
      const atras = lider > 0 ? Math.min(1, (lider - posicion[c]) / lider) : 0;
      let paso = (0.6 + Math.random() * 0.8) * (1 + EMPUJE * atras);

      if (Math.random() < 0.05 * recta) {
        paso *= 0.2;
        tropiezos.push({ tick: t, texto: `${carrera.corredores[c].nombre} tropieza` });
      } else if (Math.random() < 0.05 * recta) {
        paso *= 2.4;
        tropiezos.push({ tick: t, texto: `${carrera.corredores[c].nombre} pega un tirón` });
      }

      posicion[c] += paso;
      recorrido[c].push(posicion[c]);
    }
  }

  const totales = recorrido.map((r) => r[ticks - 1]);
  const meta = Math.max(...totales);

  // Se normaliza para que el ganador acabe justo en la meta (1) y los demas
  // se queden por detras, que es lo que se vera en la pista.
  carrera.marcas = [];
  for (let t = 0; t < ticks; t++) {
    carrera.marcas.push(recorrido.map((r) => Math.min(1, r[t] / meta)));
  }

  // Los eventos: los tropiezos y tirones, y los cambios de lider.
  const eventos: Evento[] = tropiezos.slice();
  let lider = -1;
  for (let t = 0; t < ticks; t++) {
    const posiciones = carrera.marcas[t];
    let mejor = 0;
    for (let c = 1; c < cuantos; c++) if (posiciones[c] > posiciones[mejor]) mejor = c;
    if (mejor !== lider) {
      // El primer lider no es un adelantamiento: es la salida.
      eventos.push({
        tick: t,
        texto: lider < 0
          ? `${carrera.corredores[mejor].nombre} sale en cabeza`
          : `${carrera.corredores[mejor].nombre} se pone primero`
      });
      lider = mejor;
    }
  }
  eventos.sort((a, b) => a.tick - b.tick);
  carrera.eventos = eventos;

  // El orden de llegada es el de lo recorrido al final.
  return carrera.corredores
    .map((c, i) => ({ c, total: totales[i] }))
    .sort((x, y) => y.total - x.total)
    .map((x) => x.c);
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
  crono.quitar(uid);

  // La carrera se simula aqui: todos corren con las mismas reglas, asi que
  // gana cualquiera por igual, pero por el camino hay adelantamientos.
  const orden = simular(carrera, leerAjustes(uid).duracion);

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

// Otra carrera con los mismos corredores, sin volver a pedirlos por el chat.
// Se deja la inscripcion abierta y el chat escuchando, por si se apunta
// alguien mas mientras tanto.
export function repetir(uid: string, canal: string): Carrera | null {
  const anterior = carreras.get(uid);
  if (!anterior || anterior.corredores.length < 2) return null;
  const mismos = anterior.corredores.slice();
  const nueva = abrir(uid, canal);
  nueva.corredores = mismos;
  return nueva;
}

// Tira la carrera actual y deja de escuchar.
export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  crono.quitar(uid);
  carreras.delete(uid);
}
