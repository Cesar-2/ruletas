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
  // Cuantos segundos tiene el ganador para escribir en el chat desde que para
  // la ruleta. Si no escribe, pierde: es la forma de no darle el premio a quien
  // ni esta mirando. 0 = sin plazo, como siempre. Ver vencePlazo().
  plazoHablar: number;
}

export const AJUSTES_POR_DEFECTO: Ajustes = { palabra: '!ruleta', doblePct: 50, plazoHablar: 0 };

// El plazo mas largo. El cartel del widget caduca a los diez minutos, y el plazo
// tiene que acabar con el cartel todavia puesto.
const MAX_PLAZO_S = 300;

// Con mas de esto la ruleta no se lee, y la lista es del navegador.
const MAX_NOMBRES = 200;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Se llama cuando cambia algo que se ve en pantalla, para que el servidor
  // avise a quien este mirando en vez de hacerle preguntar. Ver avisos.ts.
  alCambiar?(uid: string): void;
  // Ha parado un giro con ganador: el chat del ganador pasa a ser el suyo.
  alGanar?(uid: string): void;
  // Si «nombre» ha escrito en el chat desde «desde» (ms). null si no se puede
  // saber (no hay chat puesto, o esta caido): entonces no se le quita nada, que
  // no es culpa suya. Lo lleva chatganadores.ts, que ya escucha al ganador.
  haHablado?(uid: string, nombre: string, desde: number): boolean | null;
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
  // La lista tal y como estaba al girar, y en que sitio de ella para la cinta.
  // Es lo que hace falta para que el widget PINTE la ruleta girando en vez de
  // poner un cartel de «girando».
  //
  // Hay que decir lo que esto cuesta, sin adornos: con la lista y el sitio, quien
  // mire el JSON del widget sabe quien va a salir antes de que se vea en
  // pantalla. No hay forma de evitarlo, porque no se puede animar una parada que
  // no se conoce. Quien y ganador se siguen callando hasta que para, pero eso ya
  // solo evita el vistazo perezoso, no a quien haga la cuenta.
  //
  // Se acepta porque la direccion del widget es del dueño del directo y la
  // reparte el: es su propia superposicion de OBS. Y el rato en que se puede
  // sacar es solo lo que dura el giro.
  nombres: string[];
  elegido: number;
  // Los kamas que se juegan en este giro, o 0 si no se juega nada. Es lo que el
  // dueño escribio antes de girar; el widget lo ensena con el ganador, y lo
  // dobla si sale bien el doble o nada. Aqui no se guarda ningun premio: quien
  // lo apunta en Ganadores es la pagina, al cobrar.
  kamas: number;
  // Por cuanto quedo multiplicado el premio despues del doble o nada: 1 sin
  // doblar, 2, 4... y 0 si lo perdio. Va en el sorteo y no solo en el doble
  // porque el doble caduca en cuanto acaba el video, y el cartel del widget
  // tiene que seguir diciendo lo que se lleva despues.
  multiplicador: number;
  // Hasta cuando tiene el ganador para escribir en el chat (reloj del
  // servidor), o 0 si no hay plazo. Ver Ajustes.plazoHablar.
  plazoHasta: number;
  // Ya ha escrito: el plazo deja de contar.
  hablo: boolean;
  // Se le acabo el plazo sin escribir: pierde, y el premio queda a cero.
  sinHablar: boolean;
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
  // Para pintar la ruleta girando. Ver el comentario de Sorteo.
  nombres: string[];
  elegido: number;
  kamas: number;
  multiplicador: number;
  plazoHasta: number;
  hablo: boolean;
  sinHablar: boolean;
}

// Los kamas de un giro, limpios: un entero, sin negativos y con un tope para
// que un numero absurdo no rompa el cartel.
function limpiarKamas(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1e12) : 0;
}

// Por cuanto va multiplicado un premio. Un sorteo guardado antes de que
// existiera esto no lo trae: sin doblar.
function limpiarMultiplicador(n: unknown): number {
  if (n === undefined || n === null) return 1;
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 1000000) : 1;
}

// El doble o nada: el que ha ganado se juega el premio.
//
// Como el sorteo, lo tira la PAGINA (una tirada contra doblePct) y esto solo
// guarda lo que ha salido, para que el widget de OBS pueda ensenar el mismo
// video y el mismo cartel.
//
// Aqui NO hay nada que callar mientras dura, al contrario que en el sorteo: el
// video ya dice como acaba, porque son dos archivos distintos (ganar.mp4 y
// perder.mp4). Esconder el resultado y ensenar el video seria absurdo.
export interface Doble {
  // Quien se la juega.
  quien: string;
  gana: boolean;
  // Por cuanto queda multiplicado el premio al acabar: el doble si sale bien, 0
  // si sale mal. Es lo que tiene que poner el cartel.
  premio: number;
  cuando: string;
  // Si es de mentira: el «¿qué habría pasado?» que se juega DESPUES de
  // retirarse, solo para ensenarlo. Se ve el mismo video, pero no cambia el
  // premio de nadie.
  hipotetico: boolean;
  // Hasta cuando se da por hecho que el video sigue. Es un SEGURO, no la
  // duracion: el video es del dueno y esto no sabe lo que dura. Al widget le da
  // igual, porque ensena el mismo archivo y se entera de que acaba por el propio
  // video; esto solo evita que se quede tapado para siempre si el video no
  // existe o se atasca.
  terminaEn: number;
}

export interface Estado {
  abierta: boolean;
  nombres: string[];
  escuchando: string;
  // Como va la escucha: null si no se esta escuchando. Ver chat.ts.
  chat: chat.Salud | null;
  palabra: string;
  doblePct: number;     // posibilidades de doblar en el doble o nada
  plazoHablar: number;  // segundos para escribir en el chat tras ganar (0 = sin plazo)
  cierraEn: number;     // cuando se cierra sola (reloj del servidor); 0 = sin limite
  ahora: number;        // la hora del servidor, para que la pagina cuadre la cuenta atras
  // El ultimo sorteo, o null si no ha habido ninguno.
  sorteo: SorteoVisible | null;
  // El doble o nada que se este jugando, o null. Ver Doble.
  doble: Doble | null;
}

const sorteos = new Map<string, Sorteo>();
const dobles = new Map<string, Doble>();

// El ultimo que ha ganado esta ruleta, para el chat del ganador (ver
// chatganadores.ts): sin esto solo contaba quien llegaba a Ganadores, y un giro
// sin kamas dejaba en pantalla el chat del de antes. Va aparte del sorteo
// porque el cartel caduca a los diez minutos y esto no: sigue siendo el ultimo
// ganador hasta que gane otro. `desde` es cuando para la ruleta.
const ganadoresChat = new Map<string, { nombre: string; desde: number }>();

// El ultimo ganador de esta ruleta, o null. Mientras gira no se dice: el chat
// del ganador no puede destripar la ruleta.
export function ultimoGanador(uid: string): { nombre: string; desde: number } | null {
  const g = ganadoresChat.get(uid);
  return g && Date.now() >= g.desde ? g : null;
}

// El mismo seguro que usa la pagina para no quedarse esperando a un video.
const SEGURO_VIDEO_MS = 15000;

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
    cuando: s.cuando,
    nombres: s.nombres,
    elegido: s.elegido,
    kamas: s.kamas || 0,
    multiplicador: s.multiplicador ?? 1,
    plazoHasta: s.plazoHasta || 0,
    hablo: s.hablo === true,
    sinHablar: s.sinHablar === true
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
  // La lista con la que se giro, para poder pintar la cinta. Se limpia igual que
  // los apuntados: nada de objetos raros ni nombres de mil caracteres.
  const lista = (Array.isArray(d.nombres) ? d.nombres : [])
    .filter((n): n is string => typeof n === 'string' && Boolean(n.trim()))
    .slice(0, MAX_NOMBRES)
    .map((n) => n.trim().slice(0, 40));
  const s: Sorteo = {
    cuantos: Math.max(0, Math.floor(Number(d.cuantos) || 0)),
    quien,
    seVa: d.seVa === true,
    ganador: String(d.ganador ?? '').trim().slice(0, 40),
    quedan: Math.max(0, Math.floor(Number(d.quedan) || 0)),
    terminaEn: Date.now() + gira,
    cuando: new Date().toISOString(),
    nombres: lista,
    kamas: limpiarKamas(d.kamas),
    multiplicador: 1,
    plazoHasta: 0,
    hablo: false,
    sinHablar: false,
    // Si el sitio no cuadra con la lista, se busca por nombre; y si tampoco, 0.
    // Una parada fuera de la lista dejaria la cinta parada en un hueco vacio.
    elegido: (() => {
      // Tiene que venir un entero de verdad. No vale pasarlo por Number(): de
      // ahi, un `elegido` que no venga se convierte en 0 (Number(null) es 0) y
      // la cinta pararia en la primera fila en vez de en el que salio.
      const i = d.elegido;
      if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < lista.length) return i;
      const porNombre = lista.indexOf(quien);
      return porNombre >= 0 ? porNombre : 0;
    })()
  };
  // Con plazo, el ganador tiene ese rato desde que para para escribir en el
  // chat. Sin ganador no hay a quien pedirselo.
  const plazo = leerAjustes(uid).plazoHablar;
  if (s.ganador && plazo > 0) s.plazoHasta = s.terminaEn + plazo * 1000;
  sorteos.set(uid, s);
  // Eliminando sin quedarse uno solo, este giro no decide nada: el chat sigue
  // con el ganador de antes.
  if (s.ganador) ganadoresChat.set(uid, { nombre: s.ganador, desde: s.terminaEn });
  // Girar otra vez cierra el doble o nada de antes: el premio de aquel ya no
  // esta en pantalla.
  dobles.delete(uid);
  apuntarEnDisco(uid);
  // Y otro aviso cuando pare de girar, que es cuando cambia lo que se ve: sin
  // esto el widget tendria que esperar al reloj de repuesto para sacar el cartel.
  // El nuevo ganador tambien se cuenta entonces y no antes, por lo mismo.
  const alParar = () => {
    if (sorteos.get(uid) !== s) return;
    deps.alCambiar?.(uid);
    if (s.ganador) deps.alGanar?.(uid);
  };
  if (gira > 0) setTimeout(alParar, gira + 50).unref?.();
  else if (s.ganador) deps.alGanar?.(uid);
  if (s.plazoHasta) setTimeout(() => vencePlazo(uid, s), s.plazoHasta - Date.now() + 50).unref?.();
  return s;
}

// Se acabo el plazo para escribir: si no ha dicho nada, pierde. El premio
// queda a cero, como al perder el doble o nada, y el cartel lo dice.
//
// Si no se puede saber (no hay chat, o esta caido) no se le quita nada: perder
// por un fallo del chat no seria culpa suya. El plazo simplemente se quita.
function vencePlazo(uid: string, s: Sorteo): void {
  if (sorteos.get(uid) !== s || !s.plazoHasta || s.hablo || s.sinHablar) return;
  const hablo = deps.haHablado?.(uid, s.ganador, s.terminaEn) ?? null;
  if (hablo === true) s.hablo = true;
  else if (hablo === false) { s.sinHablar = true; s.multiplicador = 0; }
  else s.plazoHasta = 0;
  apuntarEnDisco(uid);
}

// Ha escrito alguien que es ganador. Lo llama el servidor con cada mensaje del
// ganador (ver chatganadores.ts): si es el de esta ruleta y aun estaba en
// plazo, ya no pierde, y la pagina y el widget quitan la cuenta atras.
export function comprobarHabla(uid: string): void {
  const s = sorteos.get(uid);
  if (!s || !s.plazoHasta || s.hablo || s.sinHablar) return;
  const ahora = Date.now();
  if (ahora < s.terminaEn || ahora > s.plazoHasta) return;
  if (deps.haHablado?.(uid, s.ganador, s.terminaEn) !== true) return;
  s.hablo = true;
  apuntarEnDisco(uid);
}

// El doble o nada de ahora, o null si no hay o si ya se le paso el seguro.
function dobleVisible(uid: string): Doble | null {
  const d = dobles.get(uid);
  if (!d) return null;
  if (Date.now() > d.terminaEn) { dobles.delete(uid); return null; }
  return d;
}

// La pagina dice que se ha jugado el doble o nada y como ha salido.
export function guardarDoble(uid: string, datos: unknown): Doble | null {
  const d = (datos || {}) as Record<string, unknown>;
  const quien = String(d.quien ?? '').trim().slice(0, 40);
  if (!quien) return null;
  // Quien ha perdido por no escribir ya no tiene premio que jugarse.
  const giro = sorteos.get(uid);
  if (giro && giro.sinHablar && (giro.ganador || giro.quien) === quien) return null;
  const doble: Doble = {
    quien,
    gana: d.gana === true,
    premio: Math.max(0, Math.min(1000000, Math.floor(Number(d.premio) || 0))),
    cuando: new Date().toISOString(),
    hipotetico: d.hipotetico === true,
    terminaEn: Date.now() + SEGURO_VIDEO_MS
  };
  dobles.set(uid, doble);
  // Uno de verdad cambia lo que se lleva el ganador, y eso se queda en su
  // sorteo para cuando el doble caduque. Uno de mentira no toca nada.
  const s = sorteos.get(uid);
  if (!doble.hipotetico && s && (s.ganador || s.quien) === quien) {
    s.multiplicador = doble.premio;
    apuntarEnDisco(uid);
  } else {
    deps.alCambiar?.(uid);
  }
  // Y otro aviso al caerse el seguro, para que el widget quite el video si nunca
  // llego a arrancar.
  setTimeout(() => {
    if (dobles.get(uid) === doble) { dobles.delete(uid); deps.alCambiar?.(uid); }
  }, SEGURO_VIDEO_MS + 50).unref?.();
  return doble;
}

export function estado(uid: string): Estado {
  return {
    abierta: escuchas.has(uid),
    nombres: listas.get(uid) || [],
    escuchando: escuchas.get(uid)?.canal || '',
    chat: saludChat(uid),
    palabra: leerAjustes(uid).palabra,
    doblePct: leerAjustes(uid).doblePct,
    plazoHablar: leerAjustes(uid).plazoHablar,
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now(),
    sorteo: sorteoVisible(uid),
    doble: dobleVisible(uid)
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
  if (ajustes.plazoHablar !== undefined) {
    const n = Math.round(Number(ajustes.plazoHablar));
    actual.plazoHablar = Number.isFinite(n) ? Math.max(0, Math.min(MAX_PLAZO_S, n)) : 0;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), { ...leerTodo(uid), ruleta: actual });
  return actual;
}

// --- La inscripcion -----------------------------------------------------

// Abre el chat, con la ruleta limpia: la pagina vacia tambien su cuadro de
// texto al abrir. Con segundos, se cierra sola cuando se acaban.
export function abrir(uid: string, canal: string, palabra?: string, segundos?: unknown): Estado {
  cerrar(uid);
  // Cada inscripcion es una ruleta nueva: se empieza de cero. Fuera los que
  // quedaran apuntados y el cartel del giro de antes, que si no el widget
  // seguiria enseñando al ganador viejo en vez de quien se va apuntando. El
  // chat del ganador no se toca: sigue siendo el del ultimo que gano.
  listas.set(uid, []);
  sorteos.delete(uid);
  dobles.delete(uid);
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
      cuando: String(s.cuando || new Date().toISOString()),
      nombres: Array.isArray(s.nombres) ? s.nombres.filter((n: unknown) => typeof n === 'string') : [],
      elegido: Number(s.elegido) || 0,
      kamas: limpiarKamas((s as any).kamas),
      multiplicador: limpiarMultiplicador((s as any).multiplicador),
      // Un plazo que estaba corriendo no vuelve: lo que escribio el ganador se
      // guarda solo en memoria y el reinicio se lo ha llevado, asi que no hay
      // forma de saber si hablo. Antes que quitarle el premio sin razon, se
      // queda sin plazo. Lo que ya estaba decidido si vuelve.
      plazoHasta: 0,
      hablo: (s as any).hablo === true,
      sinHablar: (s as any).sinHablar === true
    });
    // Y con el, de quien es el chat del ganador.
    if (s.ganador) ganadoresChat.set(uid, { nombre: String(s.ganador), desde: Number(s.terminaEn) || 0 });
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

// Apuntar a quien ha canjeado la recompensa de puntos de canal (ver
// twitch.ts). Solo con la inscripcion abierta: cerrada, la pagina ya no recoge
// a nadie y se quedaria pagado y fuera de la ruleta. false = se le devuelven
// los puntos.
export function apuntarCanje(uid: string, nombre: string): boolean {
  return escuchas.has(uid) && apuntar(uid, nombre);
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
