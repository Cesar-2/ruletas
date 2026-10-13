// Bingo de 75 bolas. Los espectadores piden carton por el chat y el streamer
// va sacando bolas con un boton. Nadie marca nada a mano: el servidor sabe que
// numeros han salido y que tiene cada carton.
//
// Lo que si tiene que hacer el jugador es CANTAR. Escribe la palabra de cantar
// (por defecto !bingo) en el chat y aqui se mira su carton:
//
//  - Si tiene lo que se esta jugando (la linea, o el carton lleno cuando la
//    linea ya se la llevo alguien) y lo canta a tiempo, gana.
//  - Si no lo tiene, queda descalificado: su carton deja de jugar. Es lo que
//    evita que medio chat cante a ver si cuela.
//  - Si lo tenia pero se le paso (ya ha salido otra bola), no gana, pero
//    tampoco se le descalifica: no ha mentido, ha llegado tarde.
//
// Cantar se hace por el chat y no con un boton en una pagina a proposito: el
// chat de Twitch es lo unico que garantiza QUIEN canta. Un boton en una pagina
// sin login lo podria pulsar cualquiera con el nombre de otro, y como cantar
// mal descalifica, eso seria descalificar a quien te de la gana.
//
// Los cartones se ven en una pagina publica (/bingo.html?p=CODIGO) con un
// codigo que se inventa en cada partida. Solo sirve para MIRAR cartones de esa
// partida: no deja cantar ni tocar nada.
//
// Los puntos van al mismo marcador que la carrera y la batalla.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as chat from './chat';
import { Cronometro } from './cronometro';
import { Vivo, quedanSegundos } from './vivo';

// --- El carton ----------------------------------------------------------

export const BOLAS = 75;
// Las columnas de toda la vida: B del 1 al 15, I del 16 al 30, y asi.
export const LETRAS = ['B', 'I', 'N', 'G', 'O'];
// El hueco del centro. No tiene numero y cuenta como marcado desde el principio.
export const LIBRE = 0;

// El carton va por columnas: carton[columna][fila]. Asi cada columna es la
// lista de numeros de su letra, que es como se lee un carton de bingo.
export type Carton = number[][];

export function letraDe(bola: number): string {
  return LETRAS[Math.floor((bola - 1) / 15)] || '';
}

function barajar<T>(lista: T[], azar: () => number): T[] {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cartonNuevo(azar: () => number = Math.random): Carton {
  return LETRAS.map((_, c) => {
    const suyos = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1);
    const cinco = barajar(suyos, azar).slice(0, 5).sort((a, b) => a - b);
    if (c === 2) cinco[2] = LIBRE;
    return cinco;
  });
}

// Las doce lineas: cinco filas, cinco columnas y las dos diagonales. Cada una
// es la lista de casillas [columna, fila] que la forman.
export const LINEAS: [number, number][][] = (() => {
  const l: [number, number][][] = [];
  for (let f = 0; f < 5; f++) l.push([0, 1, 2, 3, 4].map((c) => [c, f] as [number, number]));
  for (let c = 0; c < 5; c++) l.push([0, 1, 2, 3, 4].map((f) => [c, f] as [number, number]));
  l.push([0, 1, 2, 3, 4].map((i) => [i, i] as [number, number]));
  l.push([0, 1, 2, 3, 4].map((i) => [i, 4 - i] as [number, number]));
  return l;
})();

function marcada(carton: Carton, c: number, f: number, salidas: Set<number>): boolean {
  const n = carton[c][f];
  return n === LIBRE || salidas.has(n);
}

// Cuanto le falta a un carton con las bolas que han salido: para la linea que
// tenga mas cerca y para llenarlo entero. Es lo que se ensena en el panel para
// saber quien esta a punto.
export function faltan(carton: Carton, salidas: Set<number>): { linea: number; bingo: number } {
  let linea = 5;
  for (const l of LINEAS) {
    const sin = l.filter(([c, f]) => !marcada(carton, c, f, salidas)).length;
    if (sin < linea) linea = sin;
  }
  let bingo = 0;
  for (let c = 0; c < 5; c++) for (let f = 0; f < 5; f++) if (!marcada(carton, c, f, salidas)) bingo++;
  return { linea, bingo };
}

// Con que bola completo un carton la linea o el bingo: cuantas bolas habian
// salido en ese momento. 0 si todavia no lo tiene.
export function completadoCon(carton: Carton, salidas: number[], que: 'linea' | 'bingo'): number {
  const vistas = new Set<number>();
  for (let i = 0; i < salidas.length; i++) {
    vistas.add(salidas[i]);
    const f = faltan(carton, vistas);
    if (que === 'linea' ? f.linea === 0 : f.bingo === 0) return i + 1;
  }
  return 0;
}

// --- Ajustes ------------------------------------------------------------

export interface Ajustes {
  palabra: string;      // lo que se escribe para pedir carton
  cantar: string;       // lo que se escribe para cantar
  puntosLinea: number;  // a quien cante la primera linea; 0 = no se juega linea
  puntosBingo: number;  // a quien cante carton lleno
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  palabra: '!carton',
  cantar: '!bingo',
  puntosLinea: 10,
  puntosBingo: 50
};

// Lo que se le deja a quien canta despues de que salga la bola siguiente. El
// directo de Twitch llega al espectador con varios segundos de retraso: sin
// esto, quien canta en cuanto VE la bola llegaria siempre tarde si el streamer
// saca la siguiente rapido.
export const GRACIA_MS = 8000;

// --- Estado -------------------------------------------------------------

export interface Jugador {
  nombre: string;
  clave: string;          // en minusculas, para no duplicar a la misma persona
  carton: Carton;
  descalificado: boolean;
}

// Lo que se va contando en pantalla: quien canto y que paso.
export interface Canto {
  nombre: string;
  que: 'linea' | 'bingo' | 'falso' | 'tarde';
  bola: number;           // cuantas bolas habian salido cuando canto
  puntos: number;
  en: string;
}

export type Fase = 'linea' | 'bingo' | 'fin';

export interface Bingo {
  abierta: boolean;       // se pueden pedir cartones
  codigo: string;         // el de la pagina publica de cartones
  jugadores: Jugador[];
  salidas: number[];      // las bolas, en el orden en que salieron
  // Cuando salio cada bola, para la gracia de los que cantan tarde.
  salidasEn: number[];
  fase: Fase;
  cantos: Canto[];
  // Con cuantas bolas fuera se gano la linea y el bingo (0 = todavia no). Los
  // que completaron con esa misma bola tambien ganan si cantan a tiempo.
  lineaBola: number;
  bingoBola: number;
  // Lo que se jugaba al empezar, congelado: cambiar los puntos a mitad de
  // partida no cambia lo que ya se prometio.
  puntosLinea: number;
  puntosBingo: number;
  empezadaEn: string;
}

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Se llama cuando cambia algo que se ve en pantalla. Ver avisos.ts.
  alCambiar?(uid: string): void;
  // El marcador es el mismo que el de la carrera.
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La partida vive en memoria y se saca una foto a disco para que un reinicio
// no se la lleve. Ver vivo.ts.
const partidas = new Map<string, Bingo>();
const vivo = new Vivo<Bingo>('bingo', () => deps);
// Las palabras con las que se abrio cada partida, para rehacer la escucha tal
// cual estaba tras un reinicio: los ajustes pueden haber cambiado desde entonces.
const palabras = new Map<string, { palabra: string; cantar: string }>();
const escuchas = new Map<string, chat.Conexion>();
// El cronometro cierra la inscripcion, no la partida: el chat se sigue
// escuchando porque hace falta para cantar.
const crono = new Cronometro((uid) => {
  const p = partidas.get(uid);
  if (p && p.abierta) { p.abierta = false; apuntarEnDisco(uid); }
});

function apuntarEnDisco(uid: string): void {
  const partida = partidas.get(uid);
  if (!partida) { vivo.borrar(uid); return; }
  // A diferencia del plinko, aqui no hay relleno que tirar: la partida entera
  // es lo vivo, cartones incluidos, y es lo que hay que rescatar.
  const p = palabras.get(uid);
  vivo.guardar(uid, {
    estado: partida,
    canal: escuchas.get(uid)?.canal || '',
    palabra: p ? JSON.stringify(p) : '',
    cierraEn: crono.cierraEn(uid)
  });
  deps.alCambiar?.(uid);
}

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'minijuegos.json');
}

function limpiarPuntos(n: unknown, siNo: number): number {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return siNo;
  return Math.max(0, Math.min(1000000, Math.floor(v)));
}

function limpiarPalabra(p: unknown, siNo: string): string {
  return String(p ?? '').trim().slice(0, 30) || siNo;
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    const g = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8'))?.bingo || {}) : {};
    return {
      palabra: limpiarPalabra(g.palabra, AJUSTES_POR_DEFECTO.palabra),
      cantar: limpiarPalabra(g.cantar, AJUSTES_POR_DEFECTO.cantar),
      puntosLinea: limpiarPuntos(g.puntosLinea, AJUSTES_POR_DEFECTO.puntosLinea),
      puntosBingo: limpiarPuntos(g.puntosBingo, AJUSTES_POR_DEFECTO.puntosBingo)
    };
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  const antesCantar = actual.cantar;
  if (typeof ajustes.palabra === 'string') actual.palabra = limpiarPalabra(ajustes.palabra, actual.palabra);
  if (typeof ajustes.cantar === 'string') actual.cantar = limpiarPalabra(ajustes.cantar, actual.cantar);
  if (ajustes.puntosLinea != null) actual.puntosLinea = limpiarPuntos(ajustes.puntosLinea, actual.puntosLinea);
  if (ajustes.puntosBingo != null) actual.puntosBingo = limpiarPuntos(ajustes.puntosBingo, actual.puntosBingo);
  // Pedir carton y cantar con la misma palabra haria que pedir carton fuera
  // cantar en falso. Se deja la de cantar como estaba.
  if (actual.cantar.toLowerCase() === actual.palabra.toLowerCase()) {
    actual.cantar = antesCantar.toLowerCase() !== actual.palabra.toLowerCase()
      ? antesCantar
      : (actual.palabra.toLowerCase() === AJUSTES_POR_DEFECTO.cantar ? '!linea' : AJUSTES_POR_DEFECTO.cantar);
  }

  deps.ensureUserDir(uid);
  // El archivo lo comparten los minijuegos: se reescribe entero para no
  // llevarse por delante los ajustes de los otros.
  let todo: Record<string, unknown> = {};
  try {
    const f = archivoAjustes(uid);
    if (fs.existsSync(f)) todo = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
  }
  deps.writeJson(archivoAjustes(uid), { ...todo, bingo: actual });
  return actual;
}

// Como va la escucha del chat, para poder decirlo en pantalla. Ver chat.ts.
function saludChat(uid: string): chat.Salud | null {
  return escuchas.get(uid)?.salud() || null;
}

// Lo que necesita el panel. Va todo, cartones incluidos: es el streamer quien
// lo mira.
export function estado(uid: string) {
  const ajustes = leerAjustes(uid);
  const p = partidas.get(uid) || null;
  const salidas = new Set(p ? p.salidas : []);
  return {
    hay: Boolean(p),
    abierta: p ? p.abierta : false,
    codigo: p ? p.codigo : '',
    fase: (p ? p.fase : 'linea') as Fase,
    salidas: p ? p.salidas : [],
    cantos: p ? p.cantos : [],
    puntosLinea: p ? p.puntosLinea : ajustes.puntosLinea,
    puntosBingo: p ? p.puntosBingo : ajustes.puntosBingo,
    jugadores: p ? p.jugadores.map((j) => ({
      nombre: j.nombre,
      descalificado: j.descalificado,
      carton: j.carton,
      ...faltan(j.carton, salidas)
    })) : [],
    escuchando: escuchas.get(uid)?.canal || '',
    chat: saludChat(uid),
    ajustes,
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now()
  };
}

// --- La partida ---------------------------------------------------------

function codigoNuevo(): string {
  // Seis letras sin las que se confunden (0/O, 1/I/L): se dicta en voz alta.
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  return Array.from(b, (x) => letras[x % letras.length]).join('');
}

export function abrir(uid: string, canal: string, segundos?: unknown): Bingo {
  cerrarEscucha(uid);
  crono.poner(uid, segundos);
  const ajustes = leerAjustes(uid);
  const partida: Bingo = {
    abierta: true,
    codigo: codigoNuevo(),
    jugadores: [],
    salidas: [],
    salidasEn: [],
    // Con la linea a 0 puntos no se juega linea: se va directo al bingo.
    fase: ajustes.puntosLinea > 0 ? 'linea' : 'bingo',
    cantos: [],
    lineaBola: 0,
    bingoBola: 0,
    puntosLinea: ajustes.puntosLinea,
    puntosBingo: ajustes.puntosBingo,
    empezadaEn: new Date().toISOString()
  };
  partidas.set(uid, partida);
  escuchar(uid, canal, ajustes.palabra, ajustes.cantar);
  apuntarEnDisco(uid);
  return partida;
}

// Ponerse a escuchar el chat. Aparte de `abrir` porque al arrancar hay que
// rehacer la escucha de una partida que se abrio antes del reinicio.
function escuchar(uid: string, canal: string, palabra: string, cantar: string): void {
  const p = { palabra: palabra.trim().toLowerCase(), cantar: cantar.trim().toLowerCase() };
  palabras.set(uid, p);
  if (!canal) return;
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (chat.esLaPalabra(m.texto, p.cantar)) { cantarBingo(uid, m.autor); return; }
    if (chat.esLaPalabra(m.texto, p.palabra)) apuntar(uid, m.autor);
  }, () => deps.alCambiar?.(uid)));
}

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Recupera la partida que estaba en juego al apagarse, si la hay. La llama el
// servidor al arrancar, una vez por cuenta.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const e = foto.estado;
  if (!e || !Array.isArray(e.jugadores)) return false;
  const partida: Bingo = {
    abierta: Boolean(e.abierta),
    codigo: String(e.codigo || codigoNuevo()),
    jugadores: e.jugadores,
    salidas: Array.isArray(e.salidas) ? e.salidas : [],
    salidasEn: Array.isArray(e.salidasEn) ? e.salidasEn : [],
    fase: e.fase === 'bingo' || e.fase === 'fin' ? e.fase : 'linea',
    cantos: Array.isArray(e.cantos) ? e.cantos : [],
    lineaBola: Math.max(0, Math.floor(Number(e.lineaBola) || 0)),
    bingoBola: Math.max(0, Math.floor(Number(e.bingoBola) || 0)),
    puntosLinea: limpiarPuntos(e.puntosLinea, 0),
    puntosBingo: limpiarPuntos(e.puntosBingo, 0),
    empezadaEn: String(e.empezadaEn || '')
  };
  partidas.set(uid, partida);

  let p = { palabra: '', cantar: '' };
  try { p = JSON.parse(foto.palabra || '{}'); } catch (err) { /* se queda en blanco */ }
  const ajustes = leerAjustes(uid);
  // El cronometro sigue contando desde la hora que se guardo: si se le paso
  // con el servidor apagado, la inscripcion ya cerro.
  const quedan = quedanSegundos(foto.cierraEn);
  if (partida.abierta && quedan > 0) crono.poner(uid, quedan);
  else if (partida.abierta && quedan < 0) partida.abierta = false;
  // Una partida terminada no necesita chat; cualquier otra si, aunque la
  // inscripcion este cerrada: es por donde se canta.
  if (partida.fase !== 'fin' && foto.canal) {
    escuchar(uid, foto.canal, p.palabra || ajustes.palabra, p.cantar || ajustes.cantar);
  }
  apuntarEnDisco(uid);
  return true;
}

export function apuntar(uid: string, nombre: string, azar: () => number = Math.random): boolean {
  const partida = partidas.get(uid);
  if (!partida || !partida.abierta) return false;
  if (crono.vencido(uid)) return false;
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const clave = limpio.toLowerCase();
  if (partida.jugadores.some((j) => j.clave === clave)) return false;
  partida.jugadores.push({ nombre: limpio, clave, carton: cartonNuevo(azar), descalificado: false });
  apuntarEnDisco(uid);
  return true;
}

// Saca una bola. La primera cierra la inscripcion: con bolas fuera, entrar
// tarde seria entrar sabiendo lo que ha salido.
export function sacar(uid: string, azar: () => number = Math.random): { bola: number } | { error: string } {
  const partida = partidas.get(uid);
  if (!partida) return { error: 'no hay partida; abre una' };
  if (partida.fase === 'fin') return { error: 'la partida ya termino; abre otra' };
  if (!partida.jugadores.length) return { error: 'no hay nadie con carton' };
  const fuera = new Set(partida.salidas);
  const quedan: number[] = [];
  for (let n = 1; n <= BOLAS; n++) if (!fuera.has(n)) quedan.push(n);
  if (!quedan.length) return { error: 'ya salieron las 75 bolas' };

  if (partida.abierta) {
    partida.abierta = false;
    crono.quitar(uid);
  }
  const bola = quedan[Math.floor(azar() * quedan.length)];
  partida.salidas.push(bola);
  partida.salidasEn.push(Date.now());
  apuntarEnDisco(uid);
  return { bola };
}

// Lo que pasa cuando alguien canta. Se llama desde el chat, y tambien desde el
// panel por si el streamer quiere cantar por alguien.
//
// Se juzga por la bola con la que completo, no por lo que tiene ahora:
//
//  - A tiempo es haberlo completado con la ultima bola, o con la penultima si
//    la ultima acaba de salir (GRACIA_MS). Quien completo con la penultima y
//    canta en cuanto lo VE no tiene la culpa del retraso del directo.
//  - Si dos completan con la misma bola, ganan los dos. Por eso, cuando alguien
//    gana, la fase no se cierra para los que completaron con esa misma bola:
//    se les sigue dejando cantar mientras sigan a tiempo.
export function cantarBingo(uid: string, nombre: string, ahora: number = Date.now()): Canto | null {
  const partida = partidas.get(uid);
  if (!partida) return null;
  // Sin bolas no hay nada que cantar: es alguien que escribio la palabra antes
  // de tiempo, no alguien que miente sobre su carton.
  if (!partida.salidas.length) return null;
  const clave = String(nombre || '').trim().toLowerCase();
  const jugador = partida.jugadores.find((j) => j.clave === clave);
  if (!jugador || jugador.descalificado) return null;

  const total = partida.salidas.length;
  const ultimaEn = partida.salidasEn[total - 1] || 0;
  const enGracia = ahora - ultimaEn < GRACIA_MS;
  const aTiempo = (k: number) => k > 0 && (k === total || (enGracia && k === total - 1));
  const yaGano = (que: 'linea' | 'bingo') => partida.cantos.some((c) => c.nombre === jugador.nombre && c.que === que);

  const conBingo = completadoCon(jugador.carton, partida.salidas, 'bingo');
  const conLinea = completadoCon(jugador.carton, partida.salidas, 'linea');

  let resultado: Canto['que'];
  if (aTiempo(conBingo) && (!partida.bingoBola || conBingo === partida.bingoBola) && !yaGano('bingo')) {
    resultado = 'bingo';
  } else if (partida.puntosLinea > 0 && aTiempo(conLinea)
      && (!partida.lineaBola || conLinea === partida.lineaBola) && !yaGano('linea')) {
    resultado = 'linea';
  } else if (partida.fase === 'fin') {
    // Ya se canto bingo: lo que llegue ahora no es mentir, es llegar tarde a
    // una partida acabada. Ni se apunta.
    return null;
  } else if (yaGano('linea') && !conBingo) {
    // El que gano la linea y lo vuelve a escribir (el chat repite mucho): no
    // es cantar bingo en falso, es celebrar.
    return null;
  } else if (partida.fase === 'linea' ? conLinea > 0 : conBingo > 0) {
    resultado = 'tarde';
  } else {
    resultado = 'falso';
    jugador.descalificado = true;
  }

  const puntos = resultado === 'linea' ? partida.puntosLinea : resultado === 'bingo' ? partida.puntosBingo : 0;
  if (puntos > 0) deps.sumarPuntos(uid, jugador.nombre, puntos);
  const canto: Canto = { nombre: jugador.nombre, que: resultado, bola: total, puntos, en: new Date(ahora).toISOString() };
  partida.cantos.push(canto);

  if (resultado === 'bingo') {
    partida.bingoBola = conBingo;
    partida.fase = 'fin';
    crono.quitar(uid);
    // Se sigue escuchando un rato por si otro completo con la misma bola y
    // todavia no le ha llegado el directo.
    const t = setTimeout(() => {
      if (partidas.get(uid) === partida) cerrarEscucha(uid);
    }, GRACIA_MS);
    t.unref?.();
  } else if (resultado === 'linea') {
    partida.lineaBola = conLinea;
    if (partida.fase === 'linea') partida.fase = 'bingo';
  } else if (partida.jugadores.every((j) => j.descalificado)) {
    // Todos fuera: no queda nadie que pueda ganar.
    partida.fase = 'fin';
    cerrarEscucha(uid);
  }
  apuntarEnDisco(uid);
  return canto;
}

// La partida de un codigo, para la pagina publica de cartones. El que entra no
// tiene sesion ni clave de widget: solo el codigo que se dijo en el directo.
export function porCodigo(codigo: unknown): { uid: string; partida: Bingo } | null {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return null;
  for (const [uid, partida] of partidas) {
    if (partida.codigo === c) return { uid, partida };
  }
  return null;
}

// Lo que ve un espectador de su carton: el carton, las bolas y como va. Nada
// de los cartones de los demas.
export function cartonPublico(codigo: unknown, nombre: unknown) {
  const hallada = porCodigo(codigo);
  if (!hallada) return null;
  const { uid, partida } = hallada;
  const clave = String(nombre ?? '').trim().toLowerCase();
  const j = clave ? partida.jugadores.find((x) => x.clave === clave) : undefined;
  const p = palabras.get(uid);
  return {
    abierta: partida.abierta,
    palabra: p?.palabra || AJUSTES_POR_DEFECTO.palabra,
    cantar: p?.cantar || AJUSTES_POR_DEFECTO.cantar,
    fase: partida.fase,
    salidas: partida.salidas,
    cantos: partida.cantos.filter((c) => c.que === 'linea' || c.que === 'bingo'),
    jugador: j ? { nombre: j.nombre, carton: j.carton, descalificado: j.descalificado } : null
  };
}

export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  crono.quitar(uid);
  partidas.delete(uid);
  palabras.delete(uid);
  vivo.borrar(uid);
  deps.alCambiar?.(uid);
}
