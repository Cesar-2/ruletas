// Tablero de clavijas: la bola cae de arriba, rebota por las clavijas y acaba
// en una casilla, que es la que dice el multiplicador. Se apuntan por el chat
// como en la carrera y cada uno tira su bola.
//
// Quien tira la bola es esto, no el navegador: la pagina solo reproduce el
// recorrido, punto por punto, igual que hace con la carrera. Pero el recorrido
// NO va hacia una casilla elegida de antemano: se simula la fisica (gravedad,
// choques y rebotes) y la casilla es donde acaba cayendo la bola. Nadie sabe
// donde va a caer hasta que se termina de simular, ni siquiera esto.
//
// Hay tres cosas separadas a proposito, para poder cambiar una sin tocar las
// otras: el TABLERO (cuantas filas y como se colocan las clavijas), la FISICA
// (gravedad, rebote, rozamiento) y los PREMIOS (los multiplicadores de cada
// casilla). Las dos primeras son constantes con valores por defecto; los
// premios y el numero de filas se guardan por usuario.
//
// Los puntos van al mismo marcador que la carrera y la batalla.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Cronometro } from './cronometro';

// --- El tablero ---------------------------------------------------------
// Todo se mide en "unidades de clavija": la separacion entre dos clavijas
// vecinas es 1. Asi el tablero no depende de los pixeles de nadie y la pagina
// lo dibuja al tamano que le quepa.

export interface Tablero {
  filas: number;        // cuantas filas de clavijas
  separacion: number;   // distancia horizontal entre clavijas vecinas
  altoFila: number;     // distancia vertical entre filas
  radioClavija: number;
  radioBola: number;
  alturaSalida: number; // desde donde cae la bola, por encima de la fila 1
  fondo: number;        // cuanto hay entre la ultima fila y el suelo
}

export const TABLERO_POR_DEFECTO: Tablero = {
  filas: 10,
  separacion: 1,
  // Algo menos que la separacion: las filas quedan en triangulo, como el
  // tablero de toda la vida, y la bola no se queda colgada entre dos.
  altoFila: 0.87,
  radioClavija: 0.16,
  radioBola: 0.26,
  alturaSalida: 2.2,
  fondo: 1.2
};

// La fila r (empezando en 0) tiene r+3 clavijas: 3 arriba del todo y una mas
// en cada fila. Asi la ultima fila deja tantos huecos como casillas hay.
export function clavijasDeFila(fila: number): number {
  return fila + 3;
}

export function casillasDe(filas: number): number {
  return clavijasDeFila(filas - 1) - 1;   // los huecos de la ultima fila
}

// Donde cae cada clavija, en unidades de tablero y con el 0 en el centro. Las
// de los extremos quedan justo debajo de las paredes, medio empotradas en
// ellas: la bola no puede pasar por fuera de esas.
export function clavijas(t: Tablero): { x: number; y: number; borde: boolean }[] {
  const sitios: { x: number; y: number; borde: boolean }[] = [];
  for (let r = 0; r < t.filas; r++) {
    const cuantas = clavijasDeFila(r);
    for (let c = 0; c < cuantas; c++) {
      sitios.push({
        x: (c - (cuantas - 1) / 2) * t.separacion,
        y: r * t.altoFila,
        borde: c === 0 || c === cuantas - 1
      });
    }
  }
  return sitios;
}

// Las paredes van justo sobre las clavijas de los extremos de la ultima fila.
// Ni un dedo mas afuera: con hueco entre la clavija y la pared queda un canal
// por el que la bola baja de seguido hasta la casilla de la punta, y entonces
// los extremos dejan de ser los dificiles, que es todo el sentido del juego.
export function medioAncho(t: Tablero): number {
  return (clavijasDeFila(t.filas - 1) - 1) / 2 * t.separacion;
}

export function sueloY(t: Tablero): number {
  return (t.filas - 1) * t.altoFila + t.fondo;
}

// Los bordes de las casillas: los huecos que deja la ultima fila de clavijas.
export function bordesCasillas(t: Tablero): number[] {
  const cuantas = clavijasDeFila(t.filas - 1);
  const bordes: number[] = [];
  for (let c = 0; c < cuantas; c++) bordes.push((c - (cuantas - 1) / 2) * t.separacion);
  return bordes;
}

// --- La fisica ----------------------------------------------------------

export interface Fisica {
  gravedad: number;     // unidades de tablero por segundo al cuadrado
  rebote: number;       // cuanto devuelve un choque, de 0 (se queda) a 1
  rozamiento: number;   // lo que pierde al rozar la clavija de lado
  desvio: number;       // el empujon de azar de cada choque
  arrastre: number;     // freno del vaiven de lado, por segundo
  // A partir de que velocidad contra la clavija cuenta como golpe. Por debajo
  // no es un golpe, es que la bola se esta apoyando: entonces resbala.
  impacto: number;
  paso: number;         // cada cuanto se recalcula, en segundos
  velocidadMaxima: number;
}

// Estos numeros no son al gusto: se han ajustado mirando donde caen unos miles
// de bolas. Con ellos el tablero de 10 filas reparte en campana (un 20% por la
// casilla del medio y menos de un 1% por cada punta, que es lo que hace que la
// punta valga lo que vale) y la bola tarda unos 3,5 segundos en bajar, dando
// unos 20 botes por el camino.
//
// Cuidado al tocarlos, que no van cada uno por su lado. Con poca gravedad la
// bola deja de botar y baja escurriendose de clavija en clavija: tarda el
// triple y se va derecha a las puntas, porque al resbalar tira siempre para el
// mismo lado. Frenar mucho el vaiven hace lo mismo por el mismo motivo.
export const FISICA_POR_DEFECTO: Fisica = {
  gravedad: 48,
  // Ni una pelota de goma ni un saco de arena: rebota lo justo para que se
  // vea el golpe y siga cayendo.
  rebote: 0.4,
  rozamiento: 0.5,
  // Sin esto una bola que cae justo en el centro de una clavija se quedaria
  // clavada encima; y es lo que hace que dos tiradas iguales no lo sean.
  desvio: 0.3,
  // Un roce de aire para el vaiven de lado: le quita la carrerilla de cruzar
  // media fila de una tacada, sin llegar a dejarla escurriendose.
  arrastre: 1,
  impacto: 0.35,
  paso: 1 / 240,
  velocidadMaxima: 45
};

// --- Los premios --------------------------------------------------------

// Cuantas bolas de cada cien acaban en cada casilla, mas o menos. Es la cuenta
// de toda la vida del tablero de clavijas: en cada fila la bola tira a un lado
// o al otro, asi que el centro se lleva casi todas y las puntas casi ninguna.
// No es exacta (la bola de verdad rebota y se va mas lejos de lo que dice
// esto), pero para repartir los premios vale.
function repartoEsperado(casillas: number): number[] {
  const filas = casillas - 1;
  const pesos: number[] = [];
  let comb = 1;
  for (let i = 0; i <= filas; i++) {
    pesos.push(comb);
    comb = comb * (filas - i) / (i + 1);
  }
  const total = pesos.reduce((a, b) => a + b, 0);
  // La bola de verdad se va a las puntas mas de lo que dice la cuenta: rebota,
  // coge carrerilla y a veces cruza media fila. Se ensancha un poco el reparto
  // para que cuadre con lo medido; sin esto los premios de las puntas salen
  // demasiado gordos y el tablero reparte de mas.
  const ensanche = 0.1;
  return pesos.map((p) => (1 - ensanche) * (p / total) + ensanche / casillas);
}

// Multiplicadores por defecto: simetricos, sosos en el centro y gordos en los
// extremos, que es donde cuesta caer. Se estiran a las casillas que haya.
//
// Y se ajustan para que, tirando muchas bolas, el tablero devuelva de media
// una vez lo que vale la tirada. Si no, cambiar las filas cambiaria tambien lo
// que se reparte: con seis filas se cae en las puntas mucho mas a menudo que
// con dieciseis, y los mismos numeros darian el triple de puntos.
export function multiplicadoresPorDefecto(casillas: number): number[] {
  const medio = (casillas - 1) / 2;
  const forma = Array.from({ length: casillas }, (_, i) => {
    // 0 en el centro, 1 en los extremos.
    const lejos = medio > 0 ? Math.abs(i - medio) / medio : 0;
    // Crece de golpe al final: el centro paga poco y el borde paga mucho.
    return 0.3 + 11 * Math.pow(lejos, 3.2);
  });
  const reparto = repartoEsperado(casillas);
  const media = forma.reduce((s, m, i) => s + m * reparto[i], 0) || 1;
  return forma.map((m) => Math.round(m / media * 10) / 10);
}

// Lo que se lleva quien cae en una casilla cuando el tablero va a premios: una
// cosa con nombre e imagen, en vez de un multiplicador de puntos. La imagen
// puede venir del catalogo de Dofus (su url) o ser una que se haya subido.
export interface Premio {
  nombre: string;
  imagen: string;
}

export const PREMIO_VACIO: Premio = { nombre: '', imagen: '' };

export interface Ajustes {
  puntos: number;        // lo que vale una tirada; el premio es esto por el multiplicador
  palabra: string;       // lo que se escribe en el chat para apuntarse
  filas: number;         // filas de clavijas del tablero
  multiplicadores: number[];
  // Que reparte el tablero. En 'puntos' cada casilla paga su multiplicador por
  // lo que vale la tirada, como siempre. En 'premios' no se toca el marcador:
  // cada casilla tiene una cosa con nombre e imagen, y lo que hace el tablero
  // es decir a quien le ha tocado que.
  modo: 'puntos' | 'premios';
  premios: Premio[];
}

export const FILAS_MIN = 6;
export const FILAS_MAX = 16;

export const AJUSTES_POR_DEFECTO: Ajustes = {
  puntos: 10,
  palabra: '!bola',
  filas: TABLERO_POR_DEFECTO.filas,
  multiplicadores: multiplicadoresPorDefecto(casillasDe(TABLERO_POR_DEFECTO.filas)),
  // Se arranca como siempre: quien no toque nada sigue repartiendo puntos.
  modo: 'puntos',
  premios: premiosVacios(casillasDe(TABLERO_POR_DEFECTO.filas))
};

// Tantos premios como casillas, todos en blanco. Un premio sin nombre ni
// imagen es una casilla que no da nada, que es un resultado legitimo.
export function premiosVacios(casillas: number): Premio[] {
  return Array.from({ length: casillas }, () => ({ ...PREMIO_VACIO }));
}

function limpiarPremio(x: unknown): Premio {
  const p = (x || {}) as any;
  return {
    nombre: String(p.nombre ?? '').trim().slice(0, 60),
    // Se admite una url del catalogo o una ya guardada por el servidor. Lo que
    // no se admite es un data: aqui: las imagenes subidas pasan por su endpoint,
    // que las guarda en disco, y en los ajustes solo queda su ruta.
    imagen: String(p.imagen ?? '').trim().slice(0, 500)
  };
}

// --- Estado -------------------------------------------------------------

export interface Jugador {
  nombre: string;
  clave: string;        // en minusculas, para no duplicar a la misma persona
}

export interface Tirada {
  nombre: string;
  casilla: number;          // en cual acabo, de izquierda a derecha
  multiplicador: number;
  puntos: number;           // lo que se le sumo al marcador (0 si van premios)
  // Lo que le ha tocado, si el tablero reparte premios. Va en la tirada y no
  // se mira en los ajustes al pintar: si luego se cambia un premio, lo que se
  // sorteo aquel dia sigue diciendo lo que de verdad toco.
  premio?: Premio;
  // El recorrido de la bola, en unidades de tablero: [x, y] por fotograma.
  // La pagina lo reproduce tal cual; no decide nada.
  recorrido: [number, number][];
  // Los golpes: en que fotograma y contra que clavija, para poder encenderla
  // justo cuando la bola le da. La clavija es su sitio en la lista que
  // devuelve clavijas(), y -1 es una pared.
  choques: [number, number][];
}

export interface Plinko {
  abierta: boolean;
  jugadores: Jugador[];
  tiradas: Tirada[];        // vacio hasta que se tira
  tiradoEn: string;
  // Copia de lo que se uso en esta tirada: la pagina dibuja el tablero con
  // esto y no tiene que adivinarlo.
  tablero: Tablero;
  multiplicadores: number[];
  // Lo que repartia el tablero cuando se tiro, congelado con la ronda: si
  // despues se cambia en Configuracion, lo ya tirado no cambia.
  modo?: 'puntos' | 'premios';
  premios?: Premio[];
}

// Cuantos fotogramas se guardan por segundo de caida. Con esto la pagina lo
// reproduce suave sin que la respuesta se haga enorme.
const FPS = 60;
// Tope de caida: una bola que se atasque no puede dejar la partida colgada. La
// mas lenta de unos miles no ha pasado de 5 segundos.
const SEGUNDOS_MAX = 8;
// Tope de puntos del recorrido de todas las bolas juntas. Con mucha gente se
// guardan menos fotogramas por bola antes que dejar a nadie fuera.
const PUNTOS_MAX = 60000;

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // El marcador es el mismo que el de la carrera.
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La partida en curso vive en memoria: dura lo que dura el directo.
const partidas = new Map<string, Plinko>();
const escuchas = new Map<string, chat.Conexion>();
const crono = new Cronometro((uid) => cerrarEscucha(uid));

function tableroDe(ajustes: Ajustes): Tablero {
  return { ...TABLERO_POR_DEFECTO, filas: ajustes.filas };
}

export function estado(uid: string): Plinko & {
  escuchando: string; ajustes: Ajustes; cierraEn: number; ahora: number; fisica: Fisica;
} {
  const ajustes = leerAjustes(uid);
  const p = partidas.get(uid) || {
    abierta: false, jugadores: [], tiradas: [], tiradoEn: '',
    tablero: tableroDe(ajustes), multiplicadores: ajustes.multiplicadores
  };
  return {
    ...p,
    // Mientras no se haya tirado, el tablero que se ve es el de los ajustes de
    // ahora: asi cambiar las filas se nota al momento.
    tablero: p.tiradas.length ? p.tablero : tableroDe(ajustes),
    multiplicadores: p.tiradas.length ? p.multiplicadores : ajustes.multiplicadores,
    modo: p.tiradas.length ? (p.modo || ajustes.modo) : ajustes.modo,
    premios: p.tiradas.length ? (p.premios || ajustes.premios) : ajustes.premios,
    fisica: FISICA_POR_DEFECTO,
    escuchando: escuchas.get(uid)?.canal || '',
    ajustes,
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now()
  };
}

// --- Ajustes ------------------------------------------------------------

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'minijuegos.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    const guardado = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8'))?.plinko || {}) : {};
    const ajustes: Ajustes = { ...AJUSTES_POR_DEFECTO, ...guardado };
    ajustes.filas = Math.max(FILAS_MIN, Math.min(FILAS_MAX, Math.floor(Number(ajustes.filas) || AJUSTES_POR_DEFECTO.filas)));
    // Los multiplicadores tienen que ser tantos como casillas: si se cambiaron
    // las filas, los de antes ya no valen y se rehacen.
    const casillas = casillasDe(ajustes.filas);
    if (!Array.isArray(ajustes.multiplicadores) || ajustes.multiplicadores.length !== casillas
        || ajustes.multiplicadores.some((m) => !Number.isFinite(Number(m)))) {
      ajustes.multiplicadores = multiplicadoresPorDefecto(casillas);
    } else {
      ajustes.multiplicadores = ajustes.multiplicadores.map((m) => limpiarMultiplicador(m));
    }
    // Los premios, igual: tantos como casillas. Los que falten salen en blanco.
    const premios = Array.isArray(ajustes.premios) ? ajustes.premios : [];
    ajustes.premios = premiosVacios(casillas).map((p, i) => (i < premios.length ? limpiarPremio(premios[i]) : p));
    ajustes.modo = ajustes.modo === 'premios' ? 'premios' : 'puntos';
    return ajustes;
  } catch (err) {
    console.error('Failed to read minigame settings:', err);
    return {
      ...AJUSTES_POR_DEFECTO,
      multiplicadores: AJUSTES_POR_DEFECTO.multiplicadores.slice(),
      premios: premiosVacios(casillasDe(AJUSTES_POR_DEFECTO.filas))
    };
  }
}

function limpiarMultiplicador(m: unknown): number {
  const n = Number(m);
  if (!Number.isFinite(n)) return 0;
  // Un decimal basta, y sin negativos: una casilla puede no dar nada, pero no
  // puede quitar puntos.
  return Math.max(0, Math.min(1000, Math.round(n * 10) / 10));
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes.puntos != null) {
    actual.puntos = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.puntos) || 0)));
  }
  if (typeof ajustes.palabra === 'string') {
    actual.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  if (ajustes.filas != null) {
    const antes = actual.filas;
    actual.filas = Math.max(FILAS_MIN, Math.min(FILAS_MAX, Math.floor(Number(ajustes.filas) || antes)));
    // Cambiar las filas cambia cuantas casillas hay: los premios se rehacen,
    // salvo que en esta misma llamada vengan unos nuevos.
    if (actual.filas !== antes && !Array.isArray(ajustes.multiplicadores)) {
      actual.multiplicadores = multiplicadoresPorDefecto(casillasDe(actual.filas));
    }
    // Los premios tambien son por casilla: al cambiar las filas hay que
    // reajustarlos, pero conservando los que ya estuvieran puestos.
    if (actual.filas !== antes && !Array.isArray(ajustes.premios)) {
      const antesPremios = actual.premios;
      actual.premios = premiosVacios(casillasDe(actual.filas))
        .map((p, i) => (i < antesPremios.length ? antesPremios[i] : p));
    }
  }
  if (Array.isArray(ajustes.multiplicadores)) {
    const casillas = casillasDe(actual.filas);
    const dados = ajustes.multiplicadores.slice(0, casillas).map(limpiarMultiplicador);
    // Si vienen de menos se completan con los de por defecto: mejor eso que
    // dejar casillas sin premio.
    const relleno = multiplicadoresPorDefecto(casillas);
    actual.multiplicadores = relleno.map((m, i) => (i < dados.length ? dados[i] : m));
  }
  if (ajustes.modo === 'puntos' || ajustes.modo === 'premios') {
    actual.modo = ajustes.modo;
  }
  if (Array.isArray(ajustes.premios)) {
    const casillas = casillasDe(actual.filas);
    const dados = ajustes.premios.slice(0, casillas).map(limpiarPremio);
    actual.premios = premiosVacios(casillas).map((p, i) => (i < dados.length ? dados[i] : p));
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
  deps.writeJson(archivoAjustes(uid), { ...todo, plinko: actual });
  return actual;
}

// --- La simulacion ------------------------------------------------------

// Una bola cayendo por el tablero, paso a paso. Aqui no se elige casilla ni se
// mira quien tira: solo hay gravedad, choques y rebotes. Donde acabe, acabo.
//
// Devuelve el recorrido ya remuestreado a FPS y los golpes que hubo.
export function tirarBola(t: Tablero, f: Fisica, azar: () => number = Math.random): {
  recorrido: [number, number][]; choques: [number, number][]; casilla: number;
} {
  const postes = clavijas(t);
  const pared = medioAncho(t);
  const suelo = sueloY(t);
  const rChoque = t.radioClavija + t.radioBola;

  // Se suelta desde arriba del centro, con un empujoncito de lado: si cayera
  // siempre exactamente igual, el tablero seria un adorno.
  let x = (azar() - 0.5) * t.separacion * 0.6;
  let y = -t.alturaSalida;
  let vx = (azar() - 0.5) * 1.2;
  let vy = 0;

  const pasos = Math.ceil(SEGUNDOS_MAX / f.paso);
  const cadaCuantos = Math.max(1, Math.round(1 / (FPS * f.paso)));
  const crudo: [number, number][] = [];
  const golpes: [number, number][] = [];

  // Lo que le pasa a la velocidad al topar con algo, venga de una clavija o de
  // una pared. (nx, ny) es la normal: por donde empuja lo que ha topado.
  //
  // Hay dos casos y hace falta distinguirlos. Si viene fuerte es un golpe:
  // rebota, roza y se lleva un empujon de azar. Si viene despacio no es un
  // golpe, es que se esta apoyando encima: entonces solo se le quita lo que
  // va contra la clavija y se le deja resbalar, porque si tambien se le
  // rozara el deslizamiento se quedaria quieta ahi para siempre.
  //
  // Devuelve si ha sido golpe, para poder marcarlo en el recorrido.
  const topar = (nx: number, ny: number): boolean => {
    const contra = vx * nx + vy * ny;
    if (contra >= 0) return false;      // ya se estaba yendo: no hay nada que hacer
    const tx = -ny;
    const ty = nx;
    const tangente = vx * tx + vy * ty;
    const golpe = -contra >= f.impacto;
    const rebotado = golpe ? -contra * f.rebote : 0;
    const rozado = golpe ? tangente * (1 - f.rozamiento) : tangente;
    vx = nx * rebotado + tx * rozado;
    vy = ny * rebotado + ty * rozado;
    // El empujon de azar va siempre de lado: es lo que hace que dos caidas no
    // se parezcan y lo que saca a la bola de la punta de una clavija, donde si
    // no se quedaria haciendo equilibrio.
    const empujon = (azar() - 0.5) * 2 * f.desvio * (golpe ? 1 : 0.35);
    vx += tx * empujon;
    vy += ty * empujon;
    return golpe;
  };

  for (let n = 0; n < pasos; n++) {
    vy += f.gravedad * f.paso;
    // El freno es solo para lo que va de lado: hacia abajo manda la gravedad.
    vx -= vx * Math.min(1, f.arrastre * f.paso);
    x += vx * f.paso;
    y += vy * f.paso;

    // Contra las clavijas. Solo cuentan las que quedan a la altura de la bola:
    // mirarlas todas en cada paso no hace falta para nada.
    for (const p of postes) {
      if (Math.abs(p.y - y) > t.altoFila * 1.5) continue;
      const dx = x - p.x;
      const dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > rChoque * rChoque) continue;

      const d = Math.sqrt(d2) || 0.0001;
      // La normal del choque: de la clavija hacia la bola.
      const nx = dx / d;
      const ny = dy / d;
      // Se saca de dentro de la clavija antes de rebotar, que si no se queda
      // enganchada dando vueltas dentro.
      x = p.x + nx * rChoque;
      y = p.y + ny * rChoque;

      if (topar(nx, ny)) golpes.push([n, postes.indexOf(p)]);
      // Una clavija por paso: con dos a la vez el rebote sale raro y ademas
      // no puede pasar con las distancias del tablero.
      break;
    }

    // Contra las paredes de los lados. Las dos son iguales, asi que se mira
    // cuanto se ha separado del centro y el signo dice hacia donde devolverla.
    const lado = x < 0 ? -1 : 1;
    if (Math.abs(x) > pared - t.radioBola) {
      x = lado * (pared - t.radioBola);
      if (topar(-lado, 0)) golpes.push([n, -1]);
    }

    // Que no se dispare si encadena rebotes raros.
    const v = Math.hypot(vx, vy);
    if (v > f.velocidadMaxima) {
      vx = vx / v * f.velocidadMaxima;
      vy = vy / v * f.velocidadMaxima;
    }

    if (n % cadaCuantos === 0) crudo.push([redondear(x), redondear(y)]);

    // Ha llegado al suelo: se acabo la caida.
    if (y >= suelo - t.radioBola) {
      y = suelo - t.radioBola;
      crudo.push([redondear(x), redondear(y)]);
      break;
    }
  }

  // La casilla es donde ha acabado, no al reves.
  const bordes = bordesCasillas(t);
  let casilla = 0;
  while (casilla < bordes.length - 1 && x > bordes[casilla + 1]) casilla++;
  // Fuera de la ultima clavija (ha colado por el borde): cuenta como la de la
  // punta, que es la que tiene debajo.
  casilla = Math.max(0, Math.min(casillasDe(t.filas) - 1, casilla));

  return {
    recorrido: crudo,
    // De pasos a fotogramas, que es lo que reproduce la pagina.
    choques: golpes.map(([n, c]) => [Math.floor(n / cadaCuantos), c] as [number, number]),
    casilla
  };
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Con mucha gente se aligera el recorrido de cada bola en vez de dejar a
// nadie sin tirar: se guarda uno de cada dos fotogramas, o uno de cada tres.
function aligerar(tiradas: Tirada[]): void {
  const puntos = tiradas.reduce((s, t) => s + t.recorrido.length, 0);
  if (puntos <= PUNTOS_MAX) return;
  const salto = Math.ceil(puntos / PUNTOS_MAX);
  tiradas.forEach((t) => {
    t.recorrido = t.recorrido.filter((_, i) => i % salto === 0 || i === t.recorrido.length - 1);
    t.choques = t.choques.map(([n, c]) => [Math.floor(n / salto), c] as [number, number]);
  });
}

// --- La partida ---------------------------------------------------------

export function abrir(uid: string, canal: string, palabra?: string, segundos?: unknown): Plinko {
  cerrarEscucha(uid);
  crono.poner(uid, segundos);
  const ajustes = leerAjustes(uid);
  const partida: Plinko = {
    abierta: true, jugadores: [], tiradas: [], tiradoEn: '',
    tablero: tableroDe(ajustes), multiplicadores: ajustes.multiplicadores.slice()
  };
  partidas.set(uid, partida);

  const buscada = (palabra || ajustes.palabra).trim().toLowerCase();
  escuchas.set(uid, chat.conectar(canal, (m) => {
    if (!partida.abierta) return;
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    apuntar(uid, m.autor);
  }));
  return partida;
}

export function apuntar(uid: string, nombre: string): boolean {
  const partida = partidas.get(uid);
  if (!partida || !partida.abierta) return false;
  if (crono.vencido(uid)) return false;
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return false;
  const clave = limpio.toLowerCase();
  if (partida.jugadores.some((j) => j.clave === clave)) return false;
  partida.jugadores.push({ nombre: limpio, clave });
  return true;
}

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Cierra la inscripcion, tira una bola por cabeza y reparte. El premio sale de
// la casilla en la que cae cada bola: los puntos de la tirada por el
// multiplicador de esa casilla.
export function tirar(uid: string): Plinko | null {
  const partida = partidas.get(uid);
  if (!partida || !partida.jugadores.length) return null;
  // Se tira una sola vez: si no, pulsando otra vez se repartiria de nuevo.
  if (!partida.abierta) return null;

  partida.abierta = false;
  cerrarEscucha(uid);
  crono.quitar(uid);

  const ajustes = leerAjustes(uid);
  const tablero = tableroDe(ajustes);
  partida.tablero = tablero;
  partida.multiplicadores = ajustes.multiplicadores.slice();
  // El modo y los premios se congelan con la ronda: si despues se cambian en
  // Configuracion, lo ya tirado sigue contando lo que toco de verdad.
  partida.modo = ajustes.modo;
  const premios = ajustes.premios.map((p) => ({ ...p }));
  partida.premios = premios;

  const vanPremios = partida.modo === 'premios';

  partida.tiradas = partida.jugadores.map((j) => {
    const caida = tirarBola(tablero, FISICA_POR_DEFECTO);
    const multiplicador = partida.multiplicadores[caida.casilla] ?? 0;
    // Con premios el marcador no se toca: lo que reparte el tablero es la cosa
    // de la casilla, y quien la entrega eres tu.
    const puntos = vanPremios ? 0 : Math.floor(ajustes.puntos * multiplicador);
    if (puntos > 0) deps.sumarPuntos(uid, j.nombre, puntos);
    return {
      nombre: j.nombre,
      casilla: caida.casilla,
      multiplicador,
      puntos,
      ...(vanPremios ? { premio: { ...(premios[caida.casilla] || PREMIO_VACIO) } } : {}),
      recorrido: caida.recorrido,
      choques: caida.choques
    };
  });
  aligerar(partida.tiradas);
  partida.tiradoEn = new Date().toISOString();
  return partida;
}

// Otra ronda con los mismos, sin volver a pedirlos por el chat.
export function repetir(uid: string, canal: string): Plinko | null {
  const anterior = partidas.get(uid);
  if (!anterior || !anterior.jugadores.length) return null;
  const mismos = anterior.jugadores.slice();
  const nueva = abrir(uid, canal);
  nueva.jugadores = mismos;
  return nueva;
}

export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  crono.quitar(uid);
  partidas.delete(uid);
}
