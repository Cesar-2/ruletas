// Bingo de 75 bolas. Los espectadores COMPRAN cartones canjeando una recompensa
// de puntos de canal (ver twitch.ts) y el streamer va sacando bolas con un
// boton. Cada canje es un carton mas, hasta un maximo por persona; si no se le
// puede dar (no hay partida, la inscripcion esta cerrada, o ya tiene el
// maximo), twitch.ts le devuelve los puntos. Nadie marca nada a mano: el servidor sabe que
// numeros han salido y que tiene cada carton.
//
// Lo que si tiene que hacer el jugador es CANTAR, y decir QUE canta: !linea
// para una linea (cualquier fila o columna; las diagonales no cuentan) y !bingo
// para el carton lleno. Aqui se mira su carton:
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
// Los puntos van al mismo marcador que la carrera y la batalla. Ademas, la
// linea y el bingo pueden llevar un PREMIO de verdad (kamas, o lo que diga el
// streamer): ese se apunta solo en Ganadores, en el servidor en el que se abrio
// la partida. Lo apunta el servidor y no el panel porque quien gana lo decide
// el chat, y el panel puede no estar mirando en ese momento.

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

// Las diez lineas: cinco filas y cinco columnas. Las diagonales NO cuentan.
// Cada una es la lista de casillas [columna, fila] que la forman.
export const LINEAS: [number, number][][] = (() => {
  const l: [number, number][][] = [];
  for (let f = 0; f < 5; f++) l.push([0, 1, 2, 3, 4].map((c) => [c, f] as [number, number]));
  for (let c = 0; c < 5; c++) l.push([0, 1, 2, 3, 4].map((f) => [c, f] as [number, number]));
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
// Con que bola se completo cada una de las lineas que tiene hechas. Hace falta
// mirarlas todas: quien hizo una fila hace bolas sin darse cuenta y ahora
// completa una columna con la ultima, canta a tiempo por la columna. Mirando
// solo la primera linea se le decia «tarde».
export function lineasCon(carton: Carton, salidas: number[]): number[] {
  const cuando = new Map<number, number>();
  salidas.forEach((n, i) => { if (!cuando.has(n)) cuando.set(n, i + 1); });
  const hechas: number[] = [];
  for (const l of LINEAS) {
    let k = 0;
    let completa = true;
    for (const [c, f] of l) {
      const n = carton[c][f];
      if (n === LIBRE) continue;
      const i = cuando.get(n);
      if (!i) { completa = false; break; }
      if (i > k) k = i;
    }
    if (completa && k > 0) hechas.push(k);
  }
  return hechas;
}

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
  maxCartones: number;  // cuantos cartones puede comprar cada persona
  cantar: string;       // lo que se escribe para cantar el carton lleno
  cantarLinea: string;  // lo que se escribe para cantar linea
  puntosLinea: number;  // a quien cante la primera linea
  puntosBingo: number;  // a quien cante carton lleno
  // El premio que va a Ganadores. Kamas, un texto ("Dofus Ocre"), o las dos
  // cosas. Sin nada no se apunta nada. La linea solo se juega si da puntos o
  // premio.
  premioLinea: Premio;
  premioBingo: Premio;
}

export interface Premio {
  kamas: number;
  texto: string;        // el objeto del catalogo, por su nombre
  imagen?: string;      // y su icono, para Ganadores y la pantalla
}

// Solo iconos que se pueden pintar sin miedo: de internet o de /assets.
function limpiarImagen(x: unknown): string {
  const t = String(x ?? '').trim().slice(0, 500);
  return /^https?:\/\//i.test(t) || t.startsWith('/assets/') ? t : '';
}

const SIN_PREMIO: Premio = { kamas: 0, texto: '' };

export const AJUSTES_POR_DEFECTO: Ajustes = {
  maxCartones: 5,
  cantar: '!bingo',
  cantarLinea: '!linea',
  puntosLinea: 10,
  puntosBingo: 50,
  premioLinea: SIN_PREMIO,
  premioBingo: SIN_PREMIO
};

// Lo que se le deja a quien canta despues de que salga la bola siguiente. El
// directo de Twitch llega al espectador con varios segundos de retraso: sin
// esto, quien canta en cuanto VE la bola llegaria siempre tarde si el streamer
// saca la siguiente rapido.
export const GRACIA_MS = 8000;

// --- Estado -------------------------------------------------------------

// Una persona, con todos los cartones que ha comprado. Se canta por persona:
// gana si ALGUNO de sus cartones lo tiene, y si canta en falso se queda fuera
// con todos.
export interface Jugador {
  nombre: string;
  clave: string;          // en minusculas, para no duplicar a la misma persona
  // El login de Twitch de quien compro (en minusculas). En el chat la gente
  // sale con el login, no con el nombre visible, y no siempre coinciden: un
  // nombre en otro alfabeto, por ejemplo, tiene un login distinto.
  login?: string;
  cartones: Carton[];
  descalificado: boolean;
}

export const MAX_CARTONES = 50;

// Si «quien» (un nombre o un login, como venga) es esta persona.
function esEl(j: Jugador, quien: string): boolean {
  const q = String(quien || '').trim().toLowerCase().replace(/^@/, '');
  return Boolean(q) && (j.clave === q || j.login === q);
}

// Lo que le falta a la persona: lo de su mejor carton.
function faltanJugador(j: Jugador, salidas: Set<number>): { linea: number; bingo: number } {
  let linea = 5;
  let bingo = 25;
  for (const c of j.cartones) {
    const f = faltan(c, salidas);
    if (f.linea < linea) linea = f.linea;
    if (f.bingo < bingo) bingo = f.bingo;
  }
  return { linea, bingo };
}

// Lo que se va contando en pantalla: quien canto y que paso.
export interface Canto {
  nombre: string;
  que: 'linea' | 'bingo' | 'falso' | 'tarde';
  bola: number;           // cuantas bolas habian salido cuando canto
  puntos: number;
  // Lo que se lleva y si quedo apuntado en Ganadores. Solo en linea y bingo.
  premio?: Premio;
  apuntado?: boolean;
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
  premioLinea: Premio;
  premioBingo: Premio;
  // En que servidor del Ruleton se apuntan los premios: en el que estaba el
  // streamer al abrir la partida.
  ambito: string;
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
  // Apunta el premio en Ganadores del servidor "ambito". Devuelve si se pudo.
  apuntarGanador?(ambito: string, nombre: string, premio: Premio, que: 'linea' | 'bingo'): boolean;
  // El titulo de la recompensa de puntos con la que se compran cartones, para
  // decirlo en pantalla. '' si no hay ninguna creada. Ver twitch.ts.
  recompensa?(uid: string): string;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La partida vive en memoria y se saca una foto a disco para que un reinicio
// no se la lleve. Ver vivo.ts.
const partidas = new Map<string, Bingo>();
const vivo = new Vivo<Bingo>('bingo', () => deps);
// Las palabras con las que se abrio cada partida, para rehacer la escucha tal
// cual estaba tras un reinicio: los ajustes pueden haber cambiado desde entonces.
const palabras = new Map<string, Palabras>();

interface Palabras { cantar: string; cantarLinea: string }
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

function limpiarPremio(x: unknown, siNo: Premio = SIN_PREMIO): Premio {
  if (!x || typeof x !== 'object') return { ...siNo };
  const p = x as Record<string, unknown>;
  const limpio: Premio = {
    // Las kamas no caben en el tope de los puntos: 5m es un premio normal.
    kamas: p.kamas === undefined ? siNo.kamas
      : Math.max(0, Math.min(1e10, Math.floor(Number(p.kamas) || 0))),
    texto: p.texto === undefined ? siNo.texto : String(p.texto ?? '').trim().slice(0, 80)
  };
  // La imagen va con el objeto: sin objeto no hay imagen que valga.
  const imagen = p.imagen === undefined && p.texto === undefined ? (siNo.imagen || '') : limpiarImagen(p.imagen);
  if (imagen && limpio.texto) limpio.imagen = imagen;
  return limpio;
}

export function hayPremio(p: Premio | undefined): boolean {
  return Boolean(p && (p.kamas > 0 || p.texto));
}

// La linea se juega si da algo: puntos o premio. Si no, directo al bingo.
function juegaLinea(x: { puntosLinea: number; premioLinea: Premio }): boolean {
  return x.puntosLinea > 0 || hayPremio(x.premioLinea);
}

function limpiarMax(n: unknown, siNo: number): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(MAX_CARTONES, v) : siNo;
}

function limpiarPalabra(p: unknown, siNo: string): string {
  return String(p ?? '').trim().slice(0, 30) || siNo;
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    const g = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8'))?.bingo || {}) : {};
    return {
      maxCartones: limpiarMax(g.maxCartones, AJUSTES_POR_DEFECTO.maxCartones),
      cantar: limpiarPalabra(g.cantar, AJUSTES_POR_DEFECTO.cantar),
      cantarLinea: limpiarPalabra(g.cantarLinea, AJUSTES_POR_DEFECTO.cantarLinea),
      puntosLinea: limpiarPuntos(g.puntosLinea, AJUSTES_POR_DEFECTO.puntosLinea),
      puntosBingo: limpiarPuntos(g.puntosBingo, AJUSTES_POR_DEFECTO.puntosBingo),
      premioLinea: limpiarPremio(g.premioLinea),
      premioBingo: limpiarPremio(g.premioBingo)
    };
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  const antes = { cantar: actual.cantar, cantarLinea: actual.cantarLinea };
  if (ajustes.maxCartones != null) actual.maxCartones = limpiarMax(ajustes.maxCartones, actual.maxCartones);
  if (typeof ajustes.cantar === 'string') actual.cantar = limpiarPalabra(ajustes.cantar, actual.cantar);
  if (typeof ajustes.cantarLinea === 'string') actual.cantarLinea = limpiarPalabra(ajustes.cantarLinea, actual.cantarLinea);
  if (ajustes.puntosLinea != null) actual.puntosLinea = limpiarPuntos(ajustes.puntosLinea, actual.puntosLinea);
  if (ajustes.puntosBingo != null) actual.puntosBingo = limpiarPuntos(ajustes.puntosBingo, actual.puntosBingo);
  if (ajustes.premioLinea != null) actual.premioLinea = limpiarPremio(ajustes.premioLinea, actual.premioLinea);
  if (ajustes.premioBingo != null) actual.premioBingo = limpiarPremio(ajustes.premioBingo, actual.premioBingo);
  // Las dos palabras tienen que ser distintas: cantar linea con la de bingo no
  // diria que se canta. La que choca vuelve a como estaba, y si aun choca, a una
  // libre.
  const usadas = () => [actual.cantar, actual.cantarLinea].map((x) => x.toLowerCase());
  const libre = (opciones: string[]) => opciones.find((o) => !usadas().includes(o.toLowerCase())) || opciones[0];
  // Primero la que se acaba de cambiar: es esa la que vuelve atras, no la otra.
  const orden = (['cantar', 'cantarLinea'] as const).slice()
    .sort((x, y) => Number(typeof ajustes[y] === 'string') - Number(typeof ajustes[x] === 'string'));
  for (const k of orden) {
    const otras = usadas().filter((_, i) => i !== (k === 'cantar' ? 0 : 1));
    if (otras.includes(actual[k].toLowerCase())) {
      actual[k] = !otras.includes(antes[k].toLowerCase())
        ? antes[k]
        : libre(k === 'cantar' ? ['!bingo', '!lleno', '!cantar'] : ['!linea', '!fila', '!raya']);
    }
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
    premioLinea: p ? p.premioLinea : ajustes.premioLinea,
    premioBingo: p ? p.premioBingo : ajustes.premioBingo,
    jugadores: p ? p.jugadores.map((j) => ({
      nombre: j.nombre,
      descalificado: j.descalificado,
      cartones: j.cartones,
      ...faltanJugador(j, salidas)
    })) : [],
    cartones: p ? p.jugadores.reduce((n, j) => n + j.cartones.length, 0) : 0,
    recompensa: deps.recompensa?.(uid) || '',
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

export function abrir(uid: string, canal: string, segundos?: unknown, ambito = ''): Bingo {
  cerrarEscucha(uid);
  crono.poner(uid, segundos);
  const ajustes = leerAjustes(uid);
  const partida: Bingo = {
    abierta: true,
    codigo: codigoNuevo(),
    jugadores: [],
    salidas: [],
    salidasEn: [],
    // Si la linea no da nada (ni puntos ni premio) no se juega: directo al bingo.
    fase: juegaLinea(ajustes) ? 'linea' : 'bingo',
    cantos: [],
    lineaBola: 0,
    bingoBola: 0,
    puntosLinea: ajustes.puntosLinea,
    puntosBingo: ajustes.puntosBingo,
    premioLinea: { ...ajustes.premioLinea },
    premioBingo: { ...ajustes.premioBingo },
    ambito,
    empezadaEn: new Date().toISOString()
  };
  partidas.set(uid, partida);
  escuchar(uid, canal, ajustes);
  apuntarEnDisco(uid);
  return partida;
}

// Ponerse a escuchar el chat. Aparte de `abrir` porque al arrancar hay que
// rehacer la escucha de una partida que se abrio antes del reinicio.
// El chat ya solo sirve para cantar: los cartones se compran con puntos.
function escuchar(uid: string, canal: string, w: Palabras): void {
  const p: Palabras = {
    cantar: w.cantar.trim().toLowerCase(),
    cantarLinea: w.cantarLinea.trim().toLowerCase()
  };
  palabras.set(uid, p);
  if (!canal) return;
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (chat.esLaPalabra(m.texto, p.cantarLinea)) { cantar(uid, m.autor, 'linea'); return; }
    if (chat.esLaPalabra(m.texto, p.cantar)) cantar(uid, m.autor, 'bingo');
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
    // Las partidas de antes de poder comprar varios traen un solo «carton».
    jugadores: e.jugadores.map((j: any) => ({
      nombre: j.nombre,
      clave: j.clave,
      ...(j.login ? { login: String(j.login) } : {}),
      cartones: Array.isArray(j.cartones) ? j.cartones : (j.carton ? [j.carton] : []),
      descalificado: Boolean(j.descalificado)
    })),
    salidas: Array.isArray(e.salidas) ? e.salidas : [],
    salidasEn: Array.isArray(e.salidasEn) ? e.salidasEn : [],
    fase: e.fase === 'bingo' || e.fase === 'fin' ? e.fase : 'linea',
    cantos: Array.isArray(e.cantos) ? e.cantos : [],
    lineaBola: Math.max(0, Math.floor(Number(e.lineaBola) || 0)),
    bingoBola: Math.max(0, Math.floor(Number(e.bingoBola) || 0)),
    puntosLinea: limpiarPuntos(e.puntosLinea, 0),
    puntosBingo: limpiarPuntos(e.puntosBingo, 0),
    premioLinea: limpiarPremio(e.premioLinea),
    premioBingo: limpiarPremio(e.premioBingo),
    ambito: String(e.ambito || ''),
    empezadaEn: String(e.empezadaEn || '')
  };
  partidas.set(uid, partida);

  let p: Partial<Palabras> = {};
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
    escuchar(uid, foto.canal, {
      cantar: p.cantar || ajustes.cantar,
      // Las partidas de antes de que hubiera !linea no la traen.
      cantarLinea: p.cantarLinea || ajustes.cantarLinea
    });
  }
  apuntarEnDisco(uid);
  return true;
}

// Le da un carton mas a alguien. Lo llama el canje de puntos (twitch.ts) y el
// boton del panel. Si no se puede, dice por que: con eso twitch.ts decide
// devolverle los puntos.
export function darCarton(uid: string, nombre: string, login = '', azar: () => number = Math.random):
    { ok: true; cartones: number } | { ok: false; motivo: string } {
  const partida = partidas.get(uid);
  if (!partida) return { ok: false, motivo: 'no hay ninguna partida de bingo abierta' };
  if (!partida.abierta || crono.vencido(uid)) return { ok: false, motivo: 'la venta de cartones esta cerrada' };
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, motivo: 'falta el nombre' };
  const clave = limpio.toLowerCase();
  const max = leerAjustes(uid).maxCartones;
  const suLogin = String(login || '').trim().toLowerCase();
  let jugador = partida.jugadores.find((j) => esEl(j, clave) || Boolean(suLogin && esEl(j, suLogin)));
  if (jugador && jugador.cartones.length >= max) {
    return { ok: false, motivo: 'ya tiene el maximo de ' + max + ' carton(es)' };
  }
  if (!jugador) {
    jugador = { nombre: limpio, clave, cartones: [], descalificado: false };
    if (suLogin && suLogin !== clave) jugador.login = suLogin;
    partida.jugadores.push(jugador);
  }
  jugador.cartones.push(cartonNuevo(azar));
  apuntarEnDisco(uid);
  return { ok: true, cartones: jugador.cartones.length };
}

export function apuntar(uid: string, nombre: string, azar: () => number = Math.random): boolean {
  return darCarton(uid, nombre, '', azar).ok;
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
// Se canta una cosa concreta: «linea» (!linea) o «bingo» (!bingo). Se juzga SOLO
// eso: cantar linea con el carton lleno vale, porque tiene linea; cantar bingo
// con solo una linea es cantar en falso, y descalifica.
//
// Se juzga por la bola con la que completo, no por lo que tiene ahora:
//
//  - A tiempo es haberlo completado con la ultima bola, o con la penultima si
//    la ultima acaba de salir (GRACIA_MS). Quien completo con la penultima y
//    canta en cuanto lo VE no tiene la culpa del retraso del directo.
//  - Si dos completan con la misma bola, ganan los dos. Por eso, cuando alguien
//    gana, la fase no se cierra para los que completaron con esa misma bola:
//    se les sigue dejando cantar mientras sigan a tiempo.
// Por que no se puede cantar, cuando cantar() no apunta nada. En el chat da
// igual (no se contesta), pero desde el panel el streamer tiene que saberlo:
// antes salia siempre «no tiene carton en juego, o no hay nada que cantar».
export function porQueNoCanta(uid: string, nombre: string, que: 'linea' | 'bingo'): string {
  const partida = partidas.get(uid);
  if (!partida) return 'no hay ninguna partida de bingo';
  if (!partida.salidas.length) return 'todavia no ha salido ninguna bola';
  const jugador = partida.jugadores.find((j) => esEl(j, nombre));
  if (!jugador) return 'nadie con ese nombre tiene carton en esta partida';
  if (jugador.descalificado) return jugador.nombre + ' esta descalificado';
  if (partida.cantos.some((c) => c.nombre === jugador.nombre && c.que === que)) {
    return jugador.nombre + ' ya canto ' + (que === 'linea' ? 'linea' : 'bingo') + ' y lo gano';
  }
  if (que === 'linea' && !juegaLinea(partida)) {
    return 'en esta partida no se juega linea: se abrio sin puntos ni premio para la linea';
  }
  if (partida.fase === 'fin') return 'la partida ya termino';
  return 'no hay nada que cantar';
}

export function cantar(uid: string, nombre: string, que: 'linea' | 'bingo', ahora: number = Date.now()): Canto | null {
  const partida = partidas.get(uid);
  if (!partida) return null;
  // Sin bolas no hay nada que cantar: es alguien que escribio la palabra antes
  // de tiempo, no alguien que miente sobre su carton.
  if (!partida.salidas.length) return null;
  // En el chat sale con su login; desde el panel, con el nombre que se teclee.
  const jugador = partida.jugadores.find((j) => esEl(j, nombre));
  if (!jugador || jugador.descalificado) return null;

  const total = partida.salidas.length;
  const ultimaEn = partida.salidasEn[total - 1] || 0;
  const enGracia = ahora - ultimaEn < GRACIA_MS;
  const aTiempo = (k: number) => k > 0 && (k === total || (enGracia && k === total - 1));
  const yaGano = (que: 'linea' | 'bingo') => partida.cantos.some((c) => c.nombre === jugador.nombre && c.que === que);

  // Volverlo a escribir despues de ganarlo (el chat repite mucho) no es
  // cantar en falso: es celebrar.
  if (yaGano(que)) return null;
  // Cantar linea cuando no se juega linea no es mentir: no hay nada que ganar.
  if (que === 'linea' && !juegaLinea(partida)) return null;

  const bolaGanadora = que === 'linea' ? partida.lineaBola : partida.bingoBola;
  // Con varios cartones se mira cada uno: si alguno lo tiene a tiempo, gana con
  // ese; si no, el que lo completo mas tarde, para decir si llega tarde.
  const vale = (k: number) => aTiempo(k) && (!bolaGanadora || k === bolaGanadora);
  // En la linea, TODAS las lineas de cada carton: vale cualquiera que se haya
  // completado a tiempo, no solo la primera.
  const todos = que === 'linea'
    ? jugador.cartones.flatMap((c) => lineasCon(c, partida.salidas))
    : jugador.cartones.map((c) => completadoCon(c, partida.salidas, que));
  const con = todos.find(vale) ?? Math.max(0, ...todos);

  let resultado: Canto['que'];
  if (vale(con)) {
    // A tiempo, y nadie lo habia ganado antes (o lo gano con la misma bola).
    resultado = que;
  } else if (partida.fase === 'fin') {
    // Ya se canto bingo: lo que llegue ahora no es mentir, es llegar tarde a
    // una partida acabada. Ni se apunta.
    return null;
  } else if (con > 0) {
    // Lo tiene, pero se le paso, o ya se lo llevo otro antes.
    resultado = 'tarde';
  } else {
    resultado = 'falso';
    jugador.descalificado = true;
  }
  const conLinea = que === 'linea' ? con : 0;
  const conBingo = que === 'bingo' ? con : 0;

  const puntos = resultado === 'linea' ? partida.puntosLinea : resultado === 'bingo' ? partida.puntosBingo : 0;
  if (puntos > 0) deps.sumarPuntos(uid, jugador.nombre, puntos);
  const canto: Canto = { nombre: jugador.nombre, que: resultado, bola: total, puntos, en: new Date(ahora).toISOString() };
  // El premio de verdad, a Ganadores. Si no se pudo (sin servidor, o falla al
  // escribir), el canto lo dice para que el streamer lo apunte a mano.
  if (resultado === 'linea' || resultado === 'bingo') {
    const premio = resultado === 'linea' ? partida.premioLinea : partida.premioBingo;
    if (hayPremio(premio)) {
      canto.premio = { ...premio };
      let ok = false;
      try {
        ok = Boolean(partida.ambito && deps.apuntarGanador?.(partida.ambito, jugador.nombre, premio, resultado));
      } catch (err) {
        console.error('Failed to save bingo winner:', err);
      }
      canto.apuntado = ok;
    }
  }
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
  const j = partida.jugadores.find((x) => esEl(x, String(nombre ?? '')));
  const p = palabras.get(uid);
  return {
    abierta: partida.abierta,
    recompensa: deps.recompensa?.(uid) || '',
    maxCartones: leerAjustes(uid).maxCartones,
    cantar: p?.cantar || AJUSTES_POR_DEFECTO.cantar,
    cantarLinea: p?.cantarLinea || AJUSTES_POR_DEFECTO.cantarLinea,
    fase: partida.fase,
    salidas: partida.salidas,
    cantos: partida.cantos.filter((c) => c.que === 'linea' || c.que === 'bingo'),
    jugador: j ? { nombre: j.nombre, cartones: j.cartones, descalificado: j.descalificado } : null
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
