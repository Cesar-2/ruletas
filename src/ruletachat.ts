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
import { Cronometro } from './cronometro';
import { Vivo, quedanSegundos } from './vivo';

export interface Ajustes {
  palabra: string;      // lo que se escribe en el chat para apuntarse
  // Que posibilidades hay de doblar el premio en el doble o nada, en tanto por
  // ciento. La mitad de las veces por defecto: es el envite que todo el mundo
  // entiende sin que se lo expliquen, y desde ahi se aprieta o se afloja.
  //
  // Vale el cero (no se dobla nunca) y vale el cien (se dobla siempre). Los dos
  // son absurdos jugando, pero son utiles para probar la animacion sin estar
  // girando hasta que salga.
  doblePct: number;
}

export const AJUSTES_POR_DEFECTO: Ajustes = { palabra: '!ruleta', doblePct: 50 };

// Con mas de esto la ruleta no se lee, y la lista es del navegador.
const MAX_NOMBRES = 200;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Se llama cuando cambia algo que se ve en pantalla, para que el servidor
  // avise a quien este mirando en vez de hacerle preguntar. Ver avisos.ts.
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// Lo apuntado es de un rato, pero ese rato es el directo: vive en memoria y se
// saca una foto a disco para que un reinicio no se lleve a los apuntados.
// Ver vivo.ts.
const listas = new Map<string, string[]>();
const vivo = new Vivo<{ nombres: string[]; sorteo?: Sorteo | null }>('nombres', () => deps);
// La palabra con la que se abrio, para rehacer la escucha tal cual estaba.
const palabras = new Map<string, string>();
const escuchas = new Map<string, chat.Conexion>();
// Al llegar la hora se suelta el chat, pero se recuerda cuando cerro.
const crono = new Cronometro((uid) => soltarChat(uid));

// El ultimo sorteo, para que el widget pueda contarlo en pantalla.
//
// AQUI NO SE SORTEA. A esta ruleta la gira la pagina y la lista de nombres vive
// en su cuadro de texto, asi que el servidor no conoce a los participantes y no
// puede elegir: lo unico que hace es guardar lo que la pagina dice que ha salido.
// Es distinto del resto de minijuegos, donde decide el servidor y el navegador
// solo lo anima, y se queda asi porque la lista es de la pagina.
//
// O sea que esto es un espejo, no un arbitro. Si alguien toca su propio
// navegador, cambia su propio sorteo; no hay nada que proteger aqui que no
// estuviera ya en sus manos.
export interface Sorteo {
  // Cuantos participaban.
  cuantos: number;
  // El que ha parado en la banda. NO se manda hasta que la ruleta para: ver
  // sorteoVisible().
  quien: string;
  // Si al de la banda lo que le toca es irse. La ruleta tiene dos modos y no son
  // simetricos: normalmente el de la banda gana, pero eliminando el de la banda
  // se VA, y el que gana es el que aguanta hasta quedarse solo. Por eso el
  // ganador va en su propio campo y no se da por hecho que sea el de la banda:
  // dandolo por hecho, el cartel diria que ha ganado justo el que se acaba de ir.
  seVa: boolean;
  // Quien gana, si es que este giro lo decide. '' si la cosa sigue.
  ganador: string;
  // Cuantos siguen en la lista despues de esto. Solo dice algo eliminando.
  quedan: number;
  // Cuando termina de girar (reloj del servidor).
  terminaEn: number;
  cuando: string;
}

// Lo que se manda afuera: igual, pero sin decir quien es mientras gira.
export interface SorteoVisible {
  cuantos: number;
  quien: string;        // '' mientras siga girando
  seVa: boolean;
  ganador: string;      // '' mientras gire, y '' si este giro no decide nada
  quedan: number;
  girando: boolean;
  terminaEn: number;
  cuando: string;
}

export interface Estado {
  abierta: boolean;
  nombres: string[];
  escuchando: string;
  // Como va la escucha: null si no se esta escuchando. Ver chat.ts.
  chat: chat.Salud | null;
  palabra: string;
  doblePct: number;     // posibilidades de doblar en el doble o nada
  cierraEn: number;     // cuando se cierra sola (reloj del servidor); 0 = sin limite
  ahora: number;        // la hora del servidor, para que la pagina cuadre la cuenta atras
  // El ultimo sorteo, o null si no ha habido ninguno.
  sorteo: SorteoVisible | null;
}

const sorteos = new Map<string, Sorteo>();

// Mas viejo que esto, el sorteo deja de salir: lo que se quiere en pantalla es
// el de ahora, no el de hace media hora. El cartel del ganador se queda puesto
// un buen rato a proposito, que es lo que se ve en el directo, pero no toda la
// noche.
const CADUCA_SORTEO_MS = 10 * 60 * 1000;

// El ultimo sorteo tal y como se puede contar afuera. El ganador NO sale
// mientras la ruleta siga girando: la clave del widget es de solo mirar, pero
// aun asi mandar el ganador antes de que se vea en pantalla seria destriparlo a
// quien tenga la direccion.
function sorteoVisible(uid: string): SorteoVisible | null {
  const s = sorteos.get(uid);
  if (!s) return null;
  const ahora = Date.now();
  if (ahora - new Date(s.cuando).getTime() > CADUCA_SORTEO_MS) {
    sorteos.delete(uid);
    return null;
  }
  const girando = ahora < s.terminaEn;
  return {
    cuantos: s.cuantos,
    quien: girando ? '' : s.quien,
    seVa: s.seVa,
    ganador: girando ? '' : s.ganador,
    quedan: s.quedan,
    girando,
    terminaEn: s.terminaEn,
    cuando: s.cuando
  };
}

// La foto de lo apuntado ahora mismo.
function apuntarEnDisco(uid: string): void {
  vivo.guardar(uid, {
    estado: { nombres: listas.get(uid) || [], sorteo: sorteos.get(uid) || null },
    canal: escuchas.get(uid)?.canal || '',
    palabra: palabras.get(uid) || '',
    cierraEn: crono.cierraEn(uid)
  });
  deps.alCambiar?.(uid);
}

// La pagina dice lo que va a salir, al empezar a girar. `duracion` es lo que va
// a tardar en parar, para que el widget sepa cuando dejar de poner «girando» y
// sacar el cartel.
//
// Se manda al empezar y no al acabar a proposito: si se mandara al acabar y esa
// peticion se perdiera (se cierra la pestaña, se va la red), el widget se
// quedaria sin cartel justo cuando mas se esta mirando. Mandandolo al empezar,
// lo unico que hace falta despues es que pase el tiempo.
export function guardarSorteo(uid: string, datos: unknown): Sorteo | null {
  const d = (datos || {}) as Record<string, unknown>;
  const quien = String(d.quien ?? '').trim().slice(0, 40);
  if (!quien) return null;
  // El tope es por si llega una duracion absurda: un cartel que no sale nunca
  // porque «sigue girando» seria peor que no tener cartel.
  const gira = Math.max(0, Math.min(30000, Math.floor(Number(d.duracion) || 0)));
  const s: Sorteo = {
    cuantos: Math.max(0, Math.floor(Number(d.cuantos) || 0)),
    quien,
    seVa: d.seVa === true,
    ganador: String(d.ganador ?? '').trim().slice(0, 40),
    quedan: Math.max(0, Math.floor(Number(d.quedan) || 0)),
    terminaEn: Date.now() + gira,
    cuando: new Date().toISOString()
  };
  sorteos.set(uid, s);
  apuntarEnDisco(uid);
  // Y otro aviso cuando pare de girar, que es cuando cambia lo que se ve: sin
  // esto el widget tendria que esperar al reloj de repuesto para sacar el cartel.
  if (gira > 0) {
    setTimeout(() => {
      if (sorteos.get(uid) === s) deps.alCambiar?.(uid);
    }, gira + 50).unref?.();
  }
  return s;
}

export function estado(uid: string): Estado {
  return {
    abierta: escuchas.has(uid),
    nombres: listas.get(uid) || [],
    escuchando: escuchas.get(uid)?.canal || '',
    chat: saludChat(uid),
    palabra: leerAjustes(uid).palabra,
    doblePct: leerAjustes(uid).doblePct,
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now(),
    sorteo: sorteoVisible(uid)
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
  // El cero es un valor bueno, asi que no sirve el «|| por defecto» de siempre:
  // se mira si el numero es un numero y luego se recorta.
  if (ajustes.doblePct !== undefined) {
    const n = Math.round(Number(ajustes.doblePct));
    actual.doblePct = Number.isFinite(n)
      ? Math.max(0, Math.min(100, n))
      : AJUSTES_POR_DEFECTO.doblePct;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), { ...leerTodo(uid), ruleta: actual });
  return actual;
}

// --- La inscripcion -----------------------------------------------------

// Abre el chat. No se vacia la lista: puede que ya hubiera gente escrita a
// mano en la pagina, y se apuntan encima.
// Con segundos, se cierra sola cuando se acaban.
export function abrir(uid: string, canal: string, palabra?: string, segundos?: unknown): Estado {
  cerrar(uid);
  if (!listas.has(uid)) listas.set(uid, []);
  escuchar(uid, canal, (palabra || leerAjustes(uid).palabra));
  crono.poner(uid, segundos);
  apuntarEnDisco(uid);
  return estado(uid);
}

// Ponerse a escuchar el chat. Aparte de `abrir` porque al arrancar hay que
// rehacer la escucha de una inscripcion que se abrio antes del reinicio.
// Como va la escucha del chat, para poder decirlo en pantalla. null si no se
// esta escuchando.
//
// Hace falta porque el nombre del canal NO prueba que se este leyendo su chat:
// con un canal mal escrito el socket abre igual y Twitch se calla. Ver chat.ts.
function saludChat(uid: string): chat.Salud | null {
  return escuchas.get(uid)?.salud() || null;
}

function escuchar(uid: string, canal: string, palabra: string): void {
  const buscada = String(palabra || '').trim().toLowerCase();
  palabras.set(uid, buscada);
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    apuntar(uid, m.autor);
  }, () => deps.alCambiar?.(uid)));
}

// Recupera lo que estaba apuntado al apagarse. La llama el servidor al
// arrancar, una vez por cuenta.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const nombres = Array.isArray(foto.estado.nombres)
    ? foto.estado.nombres.filter((n) => typeof n === 'string').slice(0, MAX_NOMBRES)
    : [];
  listas.set(uid, nombres);

  // El ultimo sorteo tambien vuelve: si el servidor se reinicia con el cartel
  // del ganador en pantalla, el cartel sigue ahi. Que caduque o no lo decide
  // sorteoVisible() con la hora que trae dentro.
  const s = foto.estado.sorteo;
  if (s && typeof s.quien === 'string' && s.quien) {
    sorteos.set(uid, {
      cuantos: Number(s.cuantos) || 0,
      quien: s.quien,
      seVa: s.seVa === true,
      ganador: String(s.ganador || ''),
      quedan: Number(s.quedan) || 0,
      terminaEn: Number(s.terminaEn) || 0,
      cuando: String(s.cuando || new Date().toISOString())
    });
  }

  // Con la hora de cierre ya pasada no se vuelve a escuchar: la inscripcion
  // cerro sola mientras el servidor estaba apagado. Los nombres se quedan, que
  // es lo que la pagina va a recoger.
  const quedan = quedanSegundos(foto.cierraEn);
  if (foto.canal && quedan >= 0) {
    if (quedan > 0) crono.poner(uid, quedan);
    escuchar(uid, foto.canal, foto.palabra);
  } else if (quedan < 0) {
    crono.rehacerVencido(uid, foto.cierraEn);
  }
  apuntarEnDisco(uid);
  return true;
}

function soltarChat(uid: string): void {
  escuchas.get(uid)?.cerrar();
  escuchas.delete(uid);
}

// Cerrar a mano: sin chat y sin cronometro.
export function cerrar(uid: string): Estado {
  crono.quitar(uid);
  soltarChat(uid);
  palabras.delete(uid);
  // La foto se queda, pero ya sin canal: los nombres siguen haciendo falta
  // (la pagina se los lleva a su lista) aunque no se escuche mas el chat.
  apuntarEnDisco(uid);
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
  apuntarEnDisco(uid);
  return true;
}

// La pagina ya se ha llevado los nombres a su lista: aqui no hacen falta.
export function vaciar(uid: string): Estado {
  listas.set(uid, []);
  // La pagina ya se llevo los nombres, pero el cartel del ganador sigue en
  // pantalla: si se tirara el sorteo aqui, el widget se quedaria en blanco justo
  // al acabar de girar, que es cuando mas se esta mirando.
  if (sorteos.has(uid)) apuntarEnDisco(uid);
  else { vivo.borrar(uid); deps.alCambiar?.(uid); }
  return estado(uid);
}
