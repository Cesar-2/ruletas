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
const vivo = new Vivo<{ nombres: string[] }>('nombres', () => deps);
// La palabra con la que se abrio, para rehacer la escucha tal cual estaba.
const palabras = new Map<string, string>();
const escuchas = new Map<string, chat.Conexion>();
// Al llegar la hora se suelta el chat, pero se recuerda cuando cerro.
const crono = new Cronometro((uid) => soltarChat(uid));

export interface Estado {
  abierta: boolean;
  nombres: string[];
  escuchando: string;
  palabra: string;
  doblePct: number;     // posibilidades de doblar en el doble o nada
  cierraEn: number;     // cuando se cierra sola (reloj del servidor); 0 = sin limite
  ahora: number;        // la hora del servidor, para que la pagina cuadre la cuenta atras
}

// La foto de lo apuntado ahora mismo.
function apuntarEnDisco(uid: string): void {
  vivo.guardar(uid, {
    estado: { nombres: listas.get(uid) || [] },
    canal: escuchas.get(uid)?.canal || '',
    palabra: palabras.get(uid) || '',
    cierraEn: crono.cierraEn(uid)
  });
  deps.alCambiar?.(uid);
}

export function estado(uid: string): Estado {
  return {
    abierta: escuchas.has(uid),
    nombres: listas.get(uid) || [],
    escuchando: escuchas.get(uid)?.canal || '',
    palabra: leerAjustes(uid).palabra,
    doblePct: leerAjustes(uid).doblePct,
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now()
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
function escuchar(uid: string, canal: string, palabra: string): void {
  const buscada = String(palabra || '').trim().toLowerCase();
  palabras.set(uid, buscada);
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    apuntar(uid, m.autor);
  }));
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
  // Sin nombres no hay nada que rescatar.
  vivo.borrar(uid);
  deps.alCambiar?.(uid);
  return estado(uid);
}
