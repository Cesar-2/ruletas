// Cajas misteriosas: se crea una caja con objetos del catalogo dentro, se
// subasta sin ensenar lo que lleva, y quien la gana decide si la abre o se la
// queda cerrada.
//
// La decision del juego es una sola: cuanto pagas por algo cuyo contenido no
// conoces. Todo lo de aqui existe para que esa decision sea dificil y no un
// puro dado.
//
// Tres cosas van separadas a proposito:
//
//  - El VALOR de catalogo de un objeto, en kamas. Es la vara de medir: sin
//    ella nadie sabe si una caja es cara o barata.
//  - La CAJA: que lleva dentro, decidido al crearla y no al abrirla. Esa
//    diferencia es la que separa una subasta de una tragaperras; si se
//    decidiera al abrir, nadie estaria pujando por unos objetos, estaria
//    pujando por una tirada de dados.
//  - La SUBASTA: como se puja y quien gana. No sabe nada del contenido.
//
// Se puja en PUNTOS y se tasa en KAMAS, y eso no es un descuido. Los puntos son
// los mismos de la carrera, la batalla y el plinko: la aplicacion los tiene, los
// retiene mientras vas ganando y los devuelve si te superan. Los kamas viven
// dentro de Dofus, aqui no se pueden ni retener ni comprobar, asi que sirven
// para medir y nunca para cobrar. El puente entre las dos monedas es un solo
// numero, puntosPorMillon, y esta en los ajustes.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Cronometro } from './cronometro';

// --- El valor de catalogo, en kamas --------------------------------------
// Lo que "vale" un objeto, para poder comparar cajas entre si. No es lo que se
// paga: eso son puntos y lo pone quien puja. La gracia del juego esta justo en
// la distancia entre las dos cosas.
//
// Se mide en kamas porque es la unica vara que el chat ya sabe leer: «esta caja
// vale 3M» dice algo, «esta caja vale 900» no dice nada.

export type Rareza = 'common' | 'rare' | 'epic' | 'mythic';

const ORDEN_RAREZA: Rareza[] = ['common', 'rare', 'epic', 'mythic'];

// La rareza es un COLOR, y nada mas. Sirve para pintar el objeto y para decidir
// de que puede salir cada categoria. Lo que vale un objeto lo dice su nivel (ver
// valorEnKamas), no su color: cuando el color era tambien el precio, el catalogo
// entero se reducia a cuatro cifras y no habia forma de armar una caja que
// valiera algo intermedio.
//
// Dentro de las cajas van EQUIPABLES, no recursos. Y los equipables no llevan
// rareza marcada: esa pestana del catalogo es solo de consulta, no hay donde
// pintarlos de un color. Asi que el color sale del nivel, y por eso esto
// funciona en cualquier servidor desde el primer dia, sin marcar nada a mano.
//
// El rojo se queda en el 20% del catalogo y no en el 5% que seria bonito,
// porque en Dofus el equipo de nivel maximo es abundante: hay 872 equipables
// por encima del nivel 190. Es el catalogo el que es asi.
export const BANDAS: { hasta: number; rareza: Rareza }[] = [
  { hasta: 50, rareza: 'common' },
  { hasta: 120, rareza: 'rare' },
  { hasta: 190, rareza: 'epic' },
  { hasta: Infinity, rareza: 'mythic' }
];

export function rarezaPorNivel(nivel: number): Rareza {
  const n = Number(nivel) || 0;
  return (BANDAS.find((b) => n <= b.hasta) || BANDAS[BANDAS.length - 1]).rareza;
}

// --- La referencia del servidor ------------------------------------------
// Lo que cuesta en ESE servidor un equipable de nivel 200 corriente. Es el
// unico precio que se escribe a mano, y se escribe una vez por servidor.
//
// No hay una tabla de precios objeto a objeto, y es a proposito: los kamas se
// mueven, una tabla de 4.000 precios envejece mal y no la va a mantener nadie.
// Lo que se mueve cuando se mueve el mercado es la escala entera, asi que se
// toca este numero y se recalcula todo lo demas.
export const KAMAS_REFERENCIA_POR_DEFECTO = 1000000;

export function limpiarReferencia(x: any): number {
  const n = Math.floor(Number(x) || 0);
  if (!Number.isFinite(n) || n <= 0) return KAMAS_REFERENCIA_POR_DEFECTO;
  return Math.max(1000, Math.min(1000000000, n));
}

// Cuanto vale un equipable, en kamas. Es una curva continua sobre el nivel y no
// cuatro escalones por color: con cuatro precios, el reparto de presupuesto de
// mas abajo no podia gastarlo (sobraba siempre calderilla que no compraba nada)
// y todas las cajas de una categoria acababan llevando lo mismo.
//
// El exponente sale de como se comporta el equipo de Dofus: un nivel 100 vale
// del orden de la octava parte que un nivel 200, no la mitad.
const CURVA = 3;
// Por debajo de nivel ~13 la curva da cifras ridiculas. El suelo evita que un
// objeto valga cero y que una caja pueda salir sin valor ninguno.
const SUELO = 1 / 4000;

export function valorEnKamas(nivel: number, referencia: number): number {
  const ref = limpiarReferencia(referencia);
  const n = Math.max(0, Math.min(200, Number(nivel) || 0));
  const proporcion = Math.max(SUELO, Math.pow(n / 200, CURVA));
  // Redondeado a diez kamas: nadie cotiza al kama exacto.
  return Math.max(10, Math.round(ref * proporcion / 10) * 10);
}

// Lo que se propone cuando todavia no has dicho nada. En cuanto pones un precio
// tuyo, manda el tuyo y esto no se vuelve a mirar.
export function precioSugerido(nivel: number, referencia: number): number {
  return valorEnKamas(nivel, referencia);
}

// --- El puente entre kamas y puntos --------------------------------------
// Se tasa en kamas y se cobra en puntos, asi que en algun punto hay que pasar
// de una moneda a la otra: el precio de salida y lo que cuestan las pistas
// salen del valor de la caja, que esta en kamas, pero se cobran en puntos.
export function enPuntos(kamas: number, puntosPorMillon: number): number {
  const tasa = Math.max(1, Number(puntosPorMillon) || 1);
  return Math.max(1, Math.round((Number(kamas) || 0) / 1000000 * tasa));
}

// --- Los tipos de caja ---------------------------------------------------
// Cada tipo es un perfil de riesgo distinto, no solo un precio distinto: si
// solo cambiara el precio, habria una sola decision disfrazada de tres.

export interface TipoCaja {
  id: string;
  nombre: string;
  descripcion: string;
  minObjetos: number;
  maxObjetos: number;
  rarezas: Rareza[];      // de cuales puede salir
  // A que apunta una caja de esta clase, en porcentaje de la referencia del
  // servidor: 100 es «lo que cuesta ahi un nivel 200».
  //
  // Es un porcentaje y no una cifra en kamas para que no envejezca. Si el
  // mercado se mueve, mueves la referencia del servidor y esto sigue queriendo
  // decir lo mismo; una cifra en kamas guardada aqui empezaria a mentir al dia
  // siguiente.
  //
  // Ojo: esto es el OBJETIVO con el que se llena la caja, no lo que acaban
  // valiendo. Lo segundo se mide (ver mediaDe) y casi nunca coincide, porque los
  // objetos son piezas enteras y el presupuesto no siempre se gasta entero.
  objetivoPct: number;
  // Con que cara sale en la tarjeta y en la subasta.
  imagen?: string;
}

// Las categorias las pones tu en Configuracion. Estas tres son solo con las
// que arranca quien no ha tocado nada: en cuanto guardas las tuyas, mandan las
// tuyas y estas no se vuelven a mirar.
export const TIPOS_POR_DEFECTO: TipoCaja[] = [
  {
    id: 'chatarra',
    nombre: 'Saco de chatarra',
    descripcion: 'Mucho objeto malo. Casi nunca sorprende, casi nunca arruina.',
    minObjetos: 3, maxObjetos: 6,
    rarezas: ['common', 'rare'],
    objetivoPct: 13
  },
  {
    id: 'comun',
    nombre: 'Caja comun',
    descripcion: 'El pan de cada dia: puede salir algo morado, pero no cuentes con ello.',
    minObjetos: 2, maxObjetos: 4,
    rarezas: ['common', 'rare', 'epic'],
    objetivoPct: 30
  },
  {
    id: 'sellada',
    nombre: 'Caja sellada',
    descripcion: 'La del pelotazo. La mayoria de las veces sale por debajo de lo que costo.',
    minObjetos: 1, maxObjetos: 3,
    rarezas: ['rare', 'epic', 'mythic'],
    objetivoPct: 110
  }
];

// La categoria por su id, dentro de una lista. Si no esta (porque la borraste
// despues de armar una caja con ella), se cae en la primera que haya: mejor eso
// que una caja sin categoria que no se pueda ni subastar.
export function tipoDe(tipos: TipoCaja[], id: string): TipoCaja {
  const lista = tipos && tipos.length ? tipos : TIPOS_POR_DEFECTO;
  return lista.find((t) => t.id === id) || lista[0];
}

// El objetivo de una categoria, en porcentaje de la referencia.
//
// Antes esto era «valorMedio», una cifra suelta en una escala propia donde un
// nivel 200 valia 1200 puntos. Se convierte a porcentaje con esa misma vara
// para no perder lo que hubieras ajustado a mano.
function objetivoPct(x: any): number {
  const puesto = Number(x?.objetivoPct);
  const pct = Number.isFinite(puesto) && puesto > 0
    ? puesto
    : (Number(x?.valorMedio) || 0) / 1200 * 100;
  return Math.max(1, Math.min(2000, Math.round(pct))) || 30;
}

// Que una categoria sea utilizable: nombre, cuantos objetos, de que rarezas y a
// que apunta. Lo que venga mal se endereza en vez de rechazarse entero.
function limpiarTipo(x: any, n: number): TipoCaja {
  const rarezas = (Array.isArray(x?.rarezas) ? x.rarezas : [])
    .filter((r: any) => ORDEN_RAREZA.includes(r));
  const min = Math.max(1, Math.min(12, Math.floor(Number(x?.minObjetos) || 1)));
  const max = Math.max(min, Math.min(12, Math.floor(Number(x?.maxObjetos) || min)));
  return {
    id: String(x?.id || '').trim().slice(0, 40) || `tipo${n}`,
    nombre: String(x?.nombre || '').trim().slice(0, 60) || `Categoria ${n}`,
    descripcion: String(x?.descripcion || '').trim().slice(0, 200),
    minObjetos: min,
    maxObjetos: max,
    // Sin rarezas no habria de donde sacar objetos: se le dan todas.
    rarezas: rarezas.length ? rarezas : ORDEN_RAREZA.slice(),
    objetivoPct: objetivoPct(x),
    imagen: String(x?.imagen || '').trim().slice(0, 500)
  };
}

// --- La caja -------------------------------------------------------------

export interface ObjetoCaja {
  id: string;
  nombre: string;
  imagen: string;
  nivel: number;
  rareza: Rareza;
  // Lo que vale. En las cajas armadas es el precio que has puesto tu; en las
  // sorteadas, la sugerencia por nivel. Sea de donde sea, la caja vale la suma
  // de esto y nada mas: no hay un valor de caja que se calcule aparte.
  valor: number;
  // Si el precio lo pusiste tu o salio de la sugerencia. Solo para poder
  // decirlo en el panel; no cambia ninguna cuenta.
  propio?: boolean;
}

export interface Caja {
  id: string;
  tipo: string;
  creada: string;
  objetos: ObjetoCaja[];   // lo que lleva dentro; no sale de aqui hasta abrirla
  valor: number;           // la suma, oculta tambien
  // Lo unico que se ensena gratis de lo que hay dentro. El peso va con el valor
  // pero con ruido: un peso 4 suele ser bueno, pero no siempre, y esa duda es
  // justo lo que se esta subastando.
  peso: number;            // de 1 a 5
  abierta: boolean;
  duena: string;           // el nombre del chat que la gano; vacio si nadie
  pagado: number;          // lo que costo en la subasta
  // Si la preparaste a mano, como la llamaste. Vacio en las sorteadas.
  armada?: string;
  // Con que cara sale: la que le pusiste a la caja armada, o la del tipo. Si
  // no hay ninguna, la pagina pinta el dibujo de siempre.
  imagen?: string;
}

// Un objeto del catalogo, tal como lo pasa el servidor.
export interface ObjetoCatalogo {
  id: string;
  nombre: string;
  imagen: string;
  nivel: number;
  rareza: Rareza;
}

function alAzar<T>(lista: T[]): T {
  return lista[Math.floor(Math.random() * lista.length)];
}

// --- El presupuesto ------------------------------------------------------
// Cuanto se desvia del objetivo de su categoria una caja SORTEADA. Las que
// armas a mano no pasan por aqui: esas valen la suma de lo que les metes.
//
// No es un sorteo plano entre el minimo y el maximo: se tuerce hacia abajo, de
// forma que la mayoria decepcionan un poco y unas pocas son el pelotazo. Esa es
// la forma que hace que se hable de las buenas.
//
// La horquilla es la misma para todas las categorias, y no algo que haya que
// decidir por categoria: lo que cambia de una a otra es a cuanto apuntan y de
// que rarezas salen, que es lo que de verdad se nota.
const FACTOR_MIN = 0.4;
const FACTOR_MAX = 2.2;
// El exponente sale de exigir que la media del presupuesto caiga en el
// objetivo: E[r^k] = (1 - min) / rango.
const FACTOR_K = Math.max(0.2, (FACTOR_MAX - FACTOR_MIN) / (1 - FACTOR_MIN) - 1);

function factorDe(): number {
  return FACTOR_MIN + (FACTOR_MAX - FACTOR_MIN) * Math.pow(Math.random(), FACTOR_K);
}

// A cuantos kamas apunta una caja de esta categoria en este servidor.
export function objetivoEnKamas(tipo: TipoCaja, referencia: number): number {
  return Math.max(1, Math.round(limpiarReferencia(referencia) * tipo.objetivoPct / 100));
}

// Se reparte un presupuesto en objetos, en vez de sortear objetos y sumar lo
// que salga. Asi se controla la media (y con ella la inflacion) y se controlan
// las colas: se sabe cada cuanto aparece el pelotazo.
//
// Esto va aparte de crearCaja porque la media de una categoria se mide llenando
// cajas (ver mediaDe), y el peso se calcula contra esa media: si llenar una caja
// calculara ya el peso, se llamaria a si mismo sin fin.
// --- La bolsa de una categoria -------------------------------------------
// Los candidatos de una categoria, ordenados por lo que valen y con sus valores
// aparte. Se calcula una vez y se reutiliza.
//
// Antes esto se hacia dentro del bucle: por cada objeto de cada caja se filtraba
// y se ordenaba el catalogo entero. Son cuatro mil objetos, y la media de una
// categoria se saca llenando cuatrocientas cajas, asi que la pagina se quedaba
// pensando varios segundos al abrir la pestana.
interface Bolsa {
  objetos: ObjetoCatalogo[];
  valores: number[];       // el mismo orden que objetos, ascendente
}

// Cada bolsa se queda con una referencia a unos miles de objetos, y la clave
// lleva la referencia del servidor dentro: cada vez que alguien la cambia
// aparece una entrada nueva. Se vacian enteras al pasarse en vez de ir echando
// la mas vieja: recalcular una bolsa cuesta milisegundos y asi no hay que
// llevar la cuenta de quien se uso cuando.
const TOPE_CACHE = 40;

function guardarEnCache<T>(cache: Map<string, T>, clave: string, valor: T): T {
  if (cache.size >= TOPE_CACHE) cache.clear();
  cache.set(clave, valor);
  return valor;
}

const bolsas = new Map<string, Bolsa>();

function bolsaDe(tipo: TipoCaja, catalogo: ObjetoCatalogo[], referencia: number): Bolsa {
  const clave = [tipo.rarezas.slice().sort().join(','), referencia, catalogo.length].join('|');
  const vista = bolsas.get(clave);
  if (vista) return vista;

  const juntos = catalogo
    .filter((o) => tipo.rarezas.includes(o.rareza))
    .map((o) => ({ o, v: valorEnKamas(o.nivel, referencia) }))
    .sort((a, b) => a.v - b.v);
  return guardarEnCache(bolsas, clave,
    { objetos: juntos.map((x) => x.o), valores: juntos.map((x) => x.v) });
}

// El ultimo que cuesta como mucho «limite», o -1 si no cabe ninguno.
function ultimoQueCabe(valores: number[], limite: number): number {
  let bajo = 0;
  let alto = valores.length - 1;
  let cual = -1;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    if (valores[medio] <= limite) { cual = medio; bajo = medio + 1; } else { alto = medio - 1; }
  }
  return cual;
}

// El mas cercano a «objetivo» sin pasar de «tope». Como la lista esta ordenada,
// basta mirar el punto de insercion y su vecino de la izquierda.
function masCercano(valores: number[], objetivo: number, tope: number): number {
  let bajo = 0;
  let alto = tope;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    if (valores[medio] < objetivo) bajo = medio + 1; else alto = medio - 1;
  }
  const derecha = Math.min(bajo, tope);
  const izquierda = Math.max(0, derecha - 1);
  return Math.abs(valores[izquierda] - objetivo) <= Math.abs(valores[derecha] - objetivo)
    ? izquierda : derecha;
}

// Se reparte un presupuesto en objetos, en vez de sortear objetos y sumar lo
// que salga. Asi se controla la media (y con ella la inflacion) y se controlan
// las colas: se sabe cada cuanto aparece el pelotazo.
//
// Esto va aparte de crearCaja porque la media de una categoria se mide llenando
// cajas (ver mediaDe), y el peso se calcula contra esa media: si llenar una caja
// calculara ya el peso, se llamaria a si mismo sin fin.
const VECINOS = 12;

// El factor y el numero de objetos se pueden imponer desde fuera. Solo lo hace
// mediaDe, para recorrer la horquilla entera en vez de sortearla: asi la media
// sale siempre la misma y no baila un 8% cada vez que se recalcula.
function construir(
  tipo: TipoCaja, catalogo: ObjetoCatalogo[], referencia: number,
  factorFijo?: number, cuantosFijo?: number
): ObjetoCaja[] {
  const bolsa = bolsaDe(tipo, catalogo, referencia);
  if (!bolsa.objetos.length) return [];

  let presupuesto = objetivoEnKamas(tipo, referencia) * (factorFijo ?? factorDe());
  const cuantos = cuantosFijo
    ?? tipo.minObjetos + Math.floor(Math.random() * (tipo.maxObjetos - tipo.minObjetos + 1));

  const objetos: ObjetoCaja[] = [];
  for (let i = 0; i < cuantos; i++) {
    const queda = cuantos - i;
    // Lo que toca gastar en este objeto para que lleguen todos. El ultimo se
    // come lo que sobre, que es de donde salen las sorpresas.
    const objetivo = queda === 1 ? presupuesto : presupuesto / queda;
    // Solo se mira entre los que caben. Si no cabe ninguno, entre los mas
    // baratos que haya: una caja no puede salir vacia.
    const cabe = ultimoQueCabe(bolsa.valores, presupuesto);
    const tope = cabe >= 0 ? cabe : Math.min(VECINOS - 1, bolsa.valores.length - 1);
    // Un puñado alrededor del que mejor encaja, y uno de ellos al azar: si se
    // cogiera siempre el mejor, todas las cajas de una categoria llevarian
    // exactamente lo mismo.
    const centro = masCercano(bolsa.valores, objetivo, tope);
    const desde = Math.max(0, Math.min(centro - (VECINOS >> 1), tope - VECINOS + 1));
    const cual = desde + Math.floor(Math.random() * Math.min(VECINOS, tope - desde + 1));
    const elegido = bolsa.objetos[cual];
    const valor = bolsa.valores[cual];
    objetos.push({ ...elegido, valor });
    presupuesto -= valor;
    if (presupuesto <= 0) break;
  }

  // Una caja nunca sale vacia. Pagar por nada vacia el juego mas rapido que
  // cualquier desequilibrio.
  if (!objetos.length) {
    objetos.push({ ...bolsa.objetos[0], valor: bolsa.valores[0] });
  }
  return objetos;
}

// --- La media de una categoria -------------------------------------------
// Lo que de VERDAD acaban valiendo las cajas de una categoria, medido llenando
// unas cuantas. No es el objetivo: el presupuesto se reparte en piezas enteras y
// casi siempre sobra calderilla que ya no compra nada, asi que lo que queda
// dentro se queda por debajo de lo que se pidio.
//
// Se mide en vez de guardarse porque cualquier cifra guardada empieza a mentir
// en cuanto tocas la referencia, el catalogo o la categoria. Es la vara contra
// la que se pesa una caja, y una vara que miente es peor que no tener vara.
// Cuantos puntos de la horquilla se recorren. Con 120 por cada numero posible
// de objetos, la media queda estable en la tercera cifra y tarda unos pocos
// milisegundos.
const PASOS = 120;
const medias = new Map<string, number>();

export function mediaDe(tipo: TipoCaja, catalogo: ObjetoCatalogo[], referencia: number): number {
  const ref = limpiarReferencia(referencia);
  const clave = [
    tipo.id, tipo.objetivoPct, tipo.minObjetos, tipo.maxObjetos,
    tipo.rarezas.slice().sort().join(','), ref, catalogo.length
  ].join('|');
  const visto = medias.get(clave);
  if (visto !== undefined) return visto;

  // Se recorre la horquilla de presupuestos por sus cuantiles, y cada numero de
  // objetos posible una vez. Es la misma cuenta que sortear muchas cajas, pero
  // sin el temblor de la suerte: dos llamadas seguidas dan lo mismo.
  let suma = 0;
  let hechas = 0;
  for (let n = tipo.minObjetos; n <= tipo.maxObjetos; n++) {
    for (let i = 0; i < PASOS; i++) {
      const cuantil = (i + 0.5) / PASOS;
      const factor = FACTOR_MIN + (FACTOR_MAX - FACTOR_MIN) * Math.pow(cuantil, FACTOR_K);
      const objetos = construir(tipo, catalogo, ref, factor, n);
      if (!objetos.length) continue;
      suma += objetos.reduce((s2, o) => s2 + o.valor, 0);
      hechas++;
    }
  }
  // Sin objetos en el catalogo no hay nada que medir: se cae en el objetivo,
  // que al menos no es cero y no parte ninguna division.
  const media = hechas ? Math.round(suma / hechas) : objetivoEnKamas(tipo, ref);
  return guardarEnCache(medias, clave, media);
}

// --- El peso -------------------------------------------------------------
// La pista gratis: lo que vale la caja comparado con lo normal en su categoria,
// de 1 a 5, y con ruido a proposito para que no sea una tasacion exacta
// disfrazada de barra. Un peso 4 suele ser bueno, no siempre. Esa duda es justo
// lo que se esta subastando.
//
// Se compara contra la media MEDIDA y no contra el objetivo: contra el objetivo
// casi todas las cajas caian por debajo de 1 y la barra se apelotonaba en los
// dos primeros escalones, que es como no tener pista.
// Los cortes estan medidos, no elegidos a ojo: con el catalogo real reparten
// las cajas en 29 / 23 / 21 / 16 / 12 por ciento. Bajan poco a poco, y el 5 es
// raro de verdad sin llegar a no salir nunca.
const ESCALA_PESO = [0.6, 0.9, 1.3, 1.8];
const RUIDO_PESO = 0.45;

function pesoDe(valor: number, media: number): number {
  const proporcion = valor / Math.max(1, media);
  const ruido = (Math.random() - 0.5) * RUIDO_PESO;
  const conRuido = proporcion + ruido;
  return ESCALA_PESO.filter((corte) => conRuido >= corte).length + 1;
}

// --- La caja sorteada ----------------------------------------------------

export function crearCaja(
  tipos: TipoCaja[], tipoId: string, catalogo: ObjetoCatalogo[], referencia: number
): Caja | null {
  const tipo = tipoDe(tipos, tipoId);
  const ref = limpiarReferencia(referencia);
  const objetos = construir(tipo, catalogo, ref);
  if (!objetos.length) return null;

  const valor = objetos.reduce((s2, o) => s2 + o.valor, 0);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: tipo.id,
    creada: new Date().toISOString(),
    objetos,
    valor,
    peso: pesoDe(valor, mediaDe(tipo, catalogo, ref)),
    abierta: false,
    duena: '',
    pagado: 0
  };
}

// --- Cajas armadas a mano ------------------------------------------------
// Ademas de las que se sortean solas, se pueden preparar cajas eligiendo uno a
// uno lo que llevan. Sirve para los premios gordos del directo, para repetir
// una caja que gusto, y para montar cajas tematicas.
//
// Una caja armada se prepara una vez y se subasta cuando toque; al subastarla
// se saca del armario, porque su contenido ya es suyo y no se puede dar dos
// veces. Si se quiere repetir, se arma otra.

export interface CajaArmada {
  id: string;
  nombre: string;          // como se llama en el panel: «la del martes»
  tipo: string;            // solo para heredar la descripcion y el precio de salida
  objetos: ObjetoCaja[];
  valor: number;
  creada: string;
  // Con que se la ve en la tarjeta y en la subasta. Es la caja por fuera, no
  // lo que lleva: ensenar lo de dentro seria reventar el juego.
  imagen?: string;
}

// El precio que pones tu son KAMAS, igual que la estimacion por nivel: por eso
// el tope es de mil millones y no de un millon, que era el tope de la escala
// vieja y recortaba cualquier premio gordo de verdad.
//
// El peso de una caja armada no se inventa: sale de lo que lleva, comparado
// con lo normal en su categoria. Asi la pista gratis sigue queriendo decir lo
// mismo que en las sorteadas.
export function armar(
  tipos: TipoCaja[], nombre: string, tipoId: string, objetos: ObjetoCaja[],
  imagen = '', referencia: number = KAMAS_REFERENCIA_POR_DEFECTO
): CajaArmada {
  const limpios = objetos
    .filter((o) => o && o.id && o.nombre)
    .slice(0, 12)
    .map((o) => {
      const nivel = Math.max(0, Math.floor(Number(o.nivel) || 0));
      // El precio que venga es el que manda. Solo si no viene ninguno (o viene
      // algo que no es un numero) se cae en la sugerencia por nivel.
      const puesto = Number(o.valor);
      const propio = Number.isFinite(puesto) && puesto >= 0;
      return {
        id: String(o.id),
        nombre: String(o.nombre).slice(0, 120),
        imagen: String(o.imagen || ''),
        nivel,
        rareza: rarezaPorNivel(nivel),
        valor: propio ? Math.min(1000000000, Math.round(puesto)) : precioSugerido(nivel, referencia),
        propio
      };
    });
  return {
    id: `a${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    nombre: String(nombre || '').trim().slice(0, 60) || 'Caja preparada',
    tipo: tipoDe(tipos, tipoId).id,
    objetos: limpios,
    valor: limpios.reduce((s, o) => s + o.valor, 0),
    creada: new Date().toISOString(),
    imagen: String(imagen || '').trim().slice(0, 500)
  };
}

// De caja armada a caja de verdad, con su peso calculado igual que las otras:
// contra la media medida de su categoria, no contra lo que lleva.
function deArmada(tipos: TipoCaja[], armada: CajaArmada, media: number): Caja {
  const tipo = tipoDe(tipos, armada.tipo);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: tipo.id,
    creada: new Date().toISOString(),
    objetos: armada.objetos,
    valor: armada.valor,
    peso: pesoDe(armada.valor, media),
    abierta: false,
    duena: '',
    pagado: 0,
    armada: armada.nombre,
    imagen: armada.imagen || ''
  };
}

// --- Las pistas ----------------------------------------------------------
// Se compran durante la subasta y se ensenan A TODO EL CHAT. Que sean publicas
// es lo mas importante de este apartado: pagas tu y aprovecha tambien quien
// puja contra ti, asi que comprar informacion es un dilema y no un tramite. Y
// de paso evita que el que mas puntos tiene compre todo y gane siempre.

export type TipoPista = 'rareza' | 'objeto' | 'tasacion';

export interface Pista {
  tipo: TipoPista;
  texto: string;
  quien: string;
  cuando: string;
  // Una de cada diez pistas de objeto ensena el peor a proposito. No se avisa
  // de cual es: la duda sobre si lo que acabas de pagar es representativo vale
  // mas que la pista misma.
  envenenada?: boolean;
}

export const COSTE_PISTA: Record<TipoPista, number> = {
  rareza: 0.05,
  objeto: 0.15,
  tasacion: 0.20
};

const NOMBRE_RAREZA: Record<Rareza, string> = {
  common: 'gris', rare: 'azul', epic: 'morado', mythic: 'rojo'
};



export function textoPista(tipo: TipoPista, caja: Caja): { texto: string; envenenada: boolean } {
  if (tipo === 'rareza') {
    const mejor = caja.objetos.reduce((m, o) =>
      ORDEN_RAREZA.indexOf(o.rareza) > ORDEN_RAREZA.indexOf(m) ? o.rareza : m, 'common' as Rareza);
    return { texto: `Lo mejor que hay dentro es ${NOMBRE_RAREZA[mejor]}.`, envenenada: false };
  }
  if (tipo === 'objeto') {
    const envenenada = Math.random() < 0.1;
    const elegido = envenenada
      ? caja.objetos.slice().sort((a, b) => a.valor - b.valor)[0]
      : alAzar(caja.objetos);
    return { texto: `Dentro hay: ${elegido.nombre}.`, envenenada };
  }
  // La tasacion es una horquilla, no una cifra: sigue habiendo que decidir.
  const margen = 0.25 + Math.random() * 0.2;
  const bajo = Math.max(0, Math.round(caja.valor * (1 - margen) / 10) * 10);
  const alto = Math.round(caja.valor * (1 + margen) / 10) * 10;
  return { texto: `Vale entre ${bajo} y ${alto} puntos.`, envenenada: false };
}

// --- La subasta ----------------------------------------------------------

export interface Puja {
  nombre: string;
  clave: string;
  cuantos: number;
  cuando: string;
}

// Un intento que no colo. Se guardan para poder ensenarlos en el panel: el
// chat se lee pero no se le contesta, asi que si alguien puja mas de lo que
// tiene no se entera ni el ni tu, y parece que el juego no funciona.
export interface Rechazada {
  nombre: string;
  cuantos: number;
  porque: string;
  cuando: string;
}

export interface Subasta {
  abierta: boolean;
  caja: Caja | null;
  salida: number;
  // La referencia del servidor y la media de la categoria, tal y como estaban
  // al abrir. Se congelan aqui por dos razones: que el precio de las pistas no
  // cambie a media subasta porque alguien toque la configuracion, y que no haga
  // falta el catalogo entero para cobrar una pista.
  referencia: number;
  media: number;
  pujas: Puja[];
  pistas: Pista[];
  rechazadas: Rechazada[];
  cerradaEn: string;
  // Quien gano y cuanto pago, una vez cerrada.
  ganadora: string;
  precio: number;
  // Las cajas ya adjudicadas, con su dueno. Aqui viven hasta que se abren.
  guardadas: Caja[];
}

export interface Ajustes {
  palabra: string;        // lo que se escribe para pujar
  palabraPista: string;   // lo que se escribe para comprar una pista
  segundos: number;       // reloj al abrir la subasta
  // Lo que queda tras cada puja. Corto a proposito: es donde estan las
  // remontadas del ultimo momento, y lo que hace que la subasta no se eternice.
  segundosTrasPuja: number;
  salidaPct: number;      // precio de salida, sobre lo que vale de media el tipo
  // Cuantos PUNTOS vale un millon de kamas. Es el unico sitio donde las dos
  // monedas se tocan: la caja se tasa en kamas, pero la salida y las pistas se
  // cobran en puntos, y algo tiene que traducir.
  //
  // Subirlo encarece el juego entero sin tocar ninguna otra cosa.
  puntosPorMillon: number;
  subidaPct: number;      // cuanto hay que subir como minimo sobre la puja actual
  // Lo que cuesta abrir la caja, en porcentaje de lo que lleva dentro. De
  // momento cero, y a proposito: quien gano ya pago la caja, y cobrarle un
  // segundo peaje puede dejarsela bloqueada para siempre si se quedo sin
  // puntos. Cuando se pueda revender, guardarla cerrada tendra una ventaja de
  // verdad y entonces cobrar por abrir sera una decision y no una trampa.
  costeAbrir: number;
  // Las categorias de caja, que las pones tu.
  tipos: TipoCaja[];
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  palabra: '!pujar',
  palabraPista: '!pista',
  segundos: 45,
  segundosTrasPuja: 15,
  salidaPct: 25,
  puntosPorMillon: 350,
  subidaPct: 5,
  costeAbrir: 0,
  tipos: TIPOS_POR_DEFECTO
};

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
  gastarPuntos(uid: string, nombre: string, cuantos: number): boolean;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

const subastas = new Map<string, Subasta>();
const escuchas = new Map<string, chat.Conexion>();
// Al vencer el reloj la subasta se cierra sola y se adjudica: no hace falta
// que nadie pregunte ni que el presentador pulse nada.
const crono = new Cronometro((uid) => cerrar(uid));

function vacia(): Subasta {
  return {
    abierta: false, caja: null, salida: 0, referencia: KAMAS_REFERENCIA_POR_DEFECTO,
    media: 0, pujas: [], pistas: [], rechazadas: [],
    cerradaEn: '', ganadora: '', precio: 0, guardadas: []
  };
}

function subastaDe(uid: string): Subasta {
  let s = subastas.get(uid);
  if (!s) {
    s = vacia();
    subastas.set(uid, s);
    // La primera vez se recuperan del disco las cajas que ya tenia adjudicadas:
    // un reinicio del servidor no puede llevarselas.
    s.guardadas = leerInventario(uid);
  }
  return s;
}

// Lo que ve la pagina. El contenido de la caja NO sale de aqui mientras este
// cerrada: ni siquiera al panel, que se ve en directo y lo leeria el chat.
export function estado(uid: string): any {
  const s = subastaDe(uid);
  const ajustes = leerAjustes(uid);
  const caja = s.caja;
  const mejor = s.pujas[s.pujas.length - 1] || null;
  return {
    abierta: s.abierta,
    ajustes,
    tipos: ajustes.tipos,
    caja: caja ? enPublico(ajustes.tipos, caja, s.abierta) : null,
    salida: s.salida,
    referencia: s.referencia,
    media: s.media,
    pujas: s.pujas.slice(-12),
    rechazadas: s.rechazadas.slice(-6),
    mejor,
    minimo: mejor ? siguientePuja(mejor.cuantos, ajustes) : s.salida,
    pistas: s.pistas,
    cerradaEn: s.cerradaEn,
    ganadora: s.ganadora,
    precio: s.precio,
    guardadas: s.guardadas.map((c) => enPublico(ajustes.tipos, c, !c.abierta)),
    // El armario se ensena entero, con contenido: es el panel del dueno y de
    // ahi las elige. Lo que no sale nunca es lo que hay en una caja EN SUBASTA.
    armario: leerArmario(uid),
    cierraEn: crono.cierraEn(uid),
    ahora: Date.now()
  };
}

// Una caja como la ve todo el mundo: con lo de dentro tapado mientras siga
// cerrada.
function enPublico(tipos: TipoCaja[], caja: Caja, tapada: boolean): any {
  const tipo = tipoDe(tipos, caja.tipo);
  const base = {
    id: caja.id,
    tipo: caja.tipo,
    tipoNombre: tipo.nombre,
    descripcion: tipo.descripcion,
    cuantos: caja.objetos.length,
    peso: caja.peso,
    abierta: caja.abierta,
    duena: caja.duena,
    pagado: caja.pagado,
    armada: caja.armada || '',
    imagen: caja.imagen || ''
  };
  if (tapada) return base;
  return { ...base, objetos: caja.objetos, valor: caja.valor };
}

export function siguientePuja(actual: number, ajustes: Ajustes): number {
  return Math.max(actual + 1, Math.ceil(actual * (1 + ajustes.subidaPct / 100)));
}

// --- Abrir la subasta ----------------------------------------------------

// Se subasta o una caja sorteada del tipo que se diga, o una que hayas armado
// tu (pasando su id en vez del tipo). La armada se saca del armario al salir a
// subasta: su contenido ya es suyo y no se puede dar dos veces.
export function abrir(
  uid: string, canal: string, tipoId: string, catalogo: ObjetoCatalogo[], referencia: number
): Subasta | null {
  const ajustes = leerAjustes(uid);
  const ref = limpiarReferencia(referencia);
  const armada = leerArmario(uid).find((c) => c.id === tipoId);
  const media = mediaDe(tipoDe(ajustes.tipos, armada ? armada.tipo : tipoId), catalogo, ref);
  const caja = armada
    ? deArmada(ajustes.tipos, armada, media)
    : crearCaja(ajustes.tipos, tipoId, catalogo, ref);
  if (!caja) return null;
  if (armada) borrarArmada(uid, armada.id);
  // Las sorteadas salen con la cara de su categoria, si le has puesto una.
  if (!caja.imagen) caja.imagen = tipoDe(ajustes.tipos, caja.tipo).imagen || '';

  cerrarEscucha(uid);
  const tipo = tipoDe(ajustes.tipos, caja.tipo);
  const s = vacia();
  s.guardadas = subastaDe(uid).guardadas;   // el inventario no se pierde
  s.abierta = true;
  s.caja = caja;
  s.referencia = ref;
  s.media = media;
  // Sale barato a proposito: que arranque y suba es mejor que una salida alta
  // y un silencio. La caja se tasa en kamas y la salida se cobra en puntos, asi
  // que aqui es donde se cruza la frontera.
  s.salida = enPuntos(media * ajustes.salidaPct / 100, ajustes.puntosPorMillon);
  subastas.set(uid, s);
  crono.poner(uid, ajustes.segundos);

  if (canal) {
    escuchas.set(uid, chat.conectar(canal, (m) => alMensaje(uid, m.autor, m.texto)));
  }
  return s;
}

function alMensaje(uid: string, autor: string, texto: string): void {
  const ajustes = leerAjustes(uid);
  if (chat.esLaPalabra(texto, ajustes.palabra)) {
    const cuantos = numeroDe(texto);
    if (cuantos <= 0) return;
    pujar(uid, autor, cuantos);
    return;
  }
  if (chat.esLaPalabra(texto, ajustes.palabraPista)) {
    const cual = pistaDe(texto);
    if (!cual) return;
    comprarPista(uid, autor, cual);
  }
}

// El primer numero que traiga el mensaje. «!pujar 500» y «!pujar 500 puntos»
// valen los dos; «!pujar» a secas no hace nada.
function apuntarRechazada(uid: string, nombre: string, cuantos: number, porque: string): void {
  const s = subastaDe(uid);
  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return;
  // Uno por persona: si alguien insiste diez veces, se queda su ultimo intento
  // y no llena el panel.
  s.rechazadas = s.rechazadas.filter((r) => r.nombre.toLowerCase() !== limpio.toLowerCase());
  s.rechazadas.push({ nombre: limpio, cuantos, porque, cuando: new Date().toISOString() });
  if (s.rechazadas.length > 6) s.rechazadas = s.rechazadas.slice(-6);
}

function numeroDe(texto: string): number {
  const m = /(\d[\d.\s]*)/.exec(String(texto || '').replace(/[,]/g, ''));
  if (!m) return 0;
  const n = Number(m[1].replace(/[.\s]/g, ''));
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function pistaDe(texto: string): TipoPista | null {
  const t = String(texto || '').toLowerCase();
  if (t.includes('rareza') || t.includes('color')) return 'rareza';
  if (t.includes('objeto') || t.includes('uno')) return 'objeto';
  if (t.includes('tasa') || t.includes('valor') || t.includes('precio')) return 'tasacion';
  return null;
}

// --- Pujar ---------------------------------------------------------------
// Los puntos se retienen al pujar, no al ganar: si no, se podria pujar con
// puntos que no se tienen, o con los mismos puntos en dos sitios.

export interface ResultadoPuja {
  ok: boolean;
  porque?: string;
  puja?: Puja;
}

export function pujar(uid: string, nombre: string, cuantos: number): ResultadoPuja {
  const s = subastaDe(uid);
  const ajustes = leerAjustes(uid);
  if (!s.abierta || !s.caja) return { ok: false, porque: 'no hay subasta abierta' };
  if (crono.vencido(uid)) return { ok: false, porque: 'la subasta ya se cerro' };

  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, porque: 'sin nombre' };
  const clave = limpio.toLowerCase();

  // Lo que no cuela se apunta para poder ensenarlo: el chat se lee pero no se
  // le contesta, asi que este es el unico sitio donde alguien se entera.
  const no = (porque: string): ResultadoPuja => {
    apuntarRechazada(uid, limpio, cuantos, porque);
    return { ok: false, porque };
  };

  const mejor = s.pujas[s.pujas.length - 1] || null;
  const minimo = mejor ? siguientePuja(mejor.cuantos, ajustes) : s.salida;
  if (cuantos < minimo) return no(`hay que pujar al menos ${minimo}`);
  // Pujarse a uno mismo por encima solo sirve para inflar el precio que va a
  // pagar: no se admite.
  if (mejor && mejor.clave === clave) return no('ya vas ganando');
  if (!deps.gastarPuntos(uid, limpio, cuantos)) return no('no tiene tantos puntos');

  // Al anterior se le devuelve lo suyo: solo hay un puntos retenido a la vez.
  if (mejor) deps.sumarPuntos(uid, mejor.nombre, mejor.cuantos);

  const puja: Puja = { nombre: limpio, clave, cuantos, cuando: new Date().toISOString() };
  s.pujas.push(puja);
  s.rechazadas = s.rechazadas.filter((r) => r.nombre.toLowerCase() !== clave);
  // Cada puja reinicia el reloj corto: ahi estan las remontadas.
  crono.poner(uid, ajustes.segundosTrasPuja);
  return { ok: true, puja };
}

// --- Comprar una pista ---------------------------------------------------

export function comprarPista(uid: string, nombre: string, tipo: TipoPista): { ok: boolean; porque?: string } {
  const s = subastaDe(uid);
  const ajustes = leerAjustes(uid);
  if (!s.abierta || !s.caja) return { ok: false, porque: 'no hay subasta abierta' };
  if (crono.vencido(uid)) return { ok: false, porque: 'la subasta ya se cerro' };
  // Cada pista se vende una vez: pagar dos veces por lo mismo seria robar.
  if (s.pistas.some((p) => p.tipo === tipo)) return { ok: false, porque: 'esa pista ya esta comprada' };

  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, porque: 'sin nombre' };
  // Sobre la media de la categoria, no sobre lo que lleva ESTA caja: si
  // costaran mas en las cajas buenas, el precio de la pista seria ya una pista.
  const coste = enPuntos(s.media * COSTE_PISTA[tipo], ajustes.puntosPorMillon);
  if (!deps.gastarPuntos(uid, limpio, coste)) {
    const porque = `la pista cuesta ${coste} y no le llega`;
    apuntarRechazada(uid, limpio, 0, porque);
    return { ok: false, porque };
  }

  const { texto, envenenada } = textoPista(tipo, s.caja);
  s.pistas.push({ tipo, texto, quien: limpio, cuando: new Date().toISOString(), envenenada });
  return { ok: true };
}

// --- Cerrar --------------------------------------------------------------

export function cerrar(uid: string): Subasta | null {
  const s = subastaDe(uid);
  if (!s.abierta || !s.caja) return null;
  const ajustes = leerAjustes(uid);

  s.abierta = false;
  cerrarEscucha(uid);
  crono.quitar(uid);
  s.cerradaEn = new Date().toISOString();

  const mejor = s.pujas[s.pujas.length - 1] || null;
  if (!mejor) {
    // Sin pujas la caja se queda sin dueno y desaparece. Nadie la quiso.
    s.caja = null;
    return s;
  }

  // Los puntos ya estaban retenidos desde que pujo: aqui solo se reparte.
  s.ganadora = mejor.nombre;
  s.precio = mejor.cuantos;
  s.caja.duena = mejor.nombre;
  s.caja.pagado = mejor.cuantos;
  s.guardadas.push(s.caja);
  guardarInventario(uid, s.guardadas);
  return s;
}

export function cancelar(uid: string): void {
  const s = subastaDe(uid);
  if (!s.abierta) return;
  // Se devuelve lo retenido: la caja no se adjudica.
  const mejor = s.pujas[s.pujas.length - 1];
  if (mejor) deps.sumarPuntos(uid, mejor.nombre, mejor.cuantos);
  s.abierta = false;
  s.caja = null;
  s.pujas = [];
  s.pistas = [];
  cerrarEscucha(uid);
  crono.quitar(uid);
}

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// --- Abrir la caja -------------------------------------------------------
// Quien la gano decide: abrirla y saber, o quedarsela cerrada. Abrir cuesta un
// poco, para que sea una decision y no un reflejo.

export function abrirCaja(uid: string, cajaId: string): { ok: boolean; porque?: string; caja?: Caja } {
  const s = subastaDe(uid);
  const ajustes = leerAjustes(uid);
  const caja = s.guardadas.find((c) => c.id === cajaId);
  if (!caja) return { ok: false, porque: 'esa caja no existe' };
  if (caja.abierta) return { ok: false, porque: 'esa caja ya estaba abierta' };

  // Sobre lo que PAGO, que son puntos, y no sobre lo que vale, que son kamas:
  // un porcentaje de kamas cobrado en puntos seria un peaje de otro orden de
  // magnitud, y dejaria la caja bloqueada para siempre.
  const coste = Math.max(0, Math.round(caja.pagado * ajustes.costeAbrir / 100));
  if (coste > 0 && !deps.gastarPuntos(uid, caja.duena, coste)) {
    return { ok: false, porque: `a ${caja.duena} le faltan puntos: abrirla cuesta ${coste}` };
  }

  caja.abierta = true;
  guardarInventario(uid, s.guardadas);
  return { ok: true, caja };
}

// --- Ajustes e inventario ------------------------------------------------

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'minijuegos.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    const guardado = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8'))?.cajas || {}) : {};
    const a: Ajustes = { ...AJUSTES_POR_DEFECTO, ...guardado };
    a.palabra = String(a.palabra || '').trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
    a.palabraPista = String(a.palabraPista || '').trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabraPista;
    a.segundos = Math.max(10, Math.min(600, Math.floor(Number(a.segundos) || AJUSTES_POR_DEFECTO.segundos)));
    a.segundosTrasPuja = Math.max(3, Math.min(300,
      Math.floor(Number(a.segundosTrasPuja) || AJUSTES_POR_DEFECTO.segundosTrasPuja)));
      a.salidaPct = Math.max(1, Math.min(100, Number(a.salidaPct) || AJUSTES_POR_DEFECTO.salidaPct));
    a.subidaPct = Math.max(1, Math.min(100, Number(a.subidaPct) || AJUSTES_POR_DEFECTO.subidaPct));
    a.puntosPorMillon = Math.max(1, Math.min(1000000,
      Math.floor(Number(a.puntosPorMillon) || AJUSTES_POR_DEFECTO.puntosPorMillon)));
    a.costeAbrir = Math.max(0, Math.min(50, Number(a.costeAbrir) || 0));
    // Las categorias: las tuyas si las has guardado, y si no las de arranque.
    const guardados = Array.isArray(a.tipos) ? a.tipos : [];
    a.tipos = guardados.length
      ? guardados.slice(0, 20).map((t: any, i: number) => limpiarTipo(t, i + 1))
      : TIPOS_POR_DEFECTO.map((t) => ({ ...t }));
    // Las imagenes vivian en un mapa aparte: se pasan a su categoria y el mapa
    // se olvida. Solo hace algo la primera vez.
    const viejas = (a as any).imagenes;
    if (viejas && typeof viejas === 'object') {
      a.tipos = a.tipos.map((t) => (t.imagen || !viejas[t.id] ? t : { ...t, imagen: String(viejas[t.id]) }));
      delete (a as any).imagenes;
    }
    return a;
  } catch (err) {
    console.error('Failed to read auction settings:', err);
    return { ...AJUSTES_POR_DEFECTO, tipos: TIPOS_POR_DEFECTO.map((t) => ({ ...t })) };
  }
}

export function guardarAjustes(uid: string, cambios: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  const nuevo: Ajustes = { ...actual, ...cambios };
  deps.ensureUserDir(uid);
  const f = archivoAjustes(uid);
  // El archivo lo comparten los minijuegos: se reescribe entero para no
  // llevarse por delante los ajustes de los otros.
  let todo: any = {};
  try { if (fs.existsSync(f)) todo = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { todo = {}; }
  todo.cajas = nuevo;
  deps.writeJson(f, todo);
  return leerAjustes(uid);
}

function archivoArmario(uid: string): string {
  return path.join(deps.userDir(uid), 'cajas-armadas.json');
}

export function leerArmario(uid: string): CajaArmada[] {
  try {
    const f = archivoArmario(uid);
    if (!fs.existsSync(f)) return [];
    const guardado = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(guardado) ? guardado : [];
  } catch (err) {
    console.error('Failed to read prepared boxes:', err);
    return [];
  }
}

function guardarArmario(uid: string, lista: CajaArmada[]): void {
  deps.ensureUserDir(uid);
  deps.writeJson(archivoArmario(uid), lista.slice(0, 100));
}

export function guardarArmada(
  uid: string, nombre: string, tipoId: string, objetos: ObjetoCaja[], imagen = '',
  referencia: number = KAMAS_REFERENCIA_POR_DEFECTO
): CajaArmada | null {
  if (!objetos || !objetos.length) return null;
  const nueva = armar(leerAjustes(uid).tipos, nombre, tipoId, objetos, imagen, referencia);
  if (!nueva.objetos.length) return null;
  guardarArmario(uid, [nueva, ...leerArmario(uid)]);
  return nueva;
}

export function borrarArmada(uid: string, id: string): boolean {
  const antes = leerArmario(uid);
  const despues = antes.filter((c) => c.id !== id);
  if (despues.length === antes.length) return false;
  guardarArmario(uid, despues);
  return true;
}

function archivoInventario(uid: string): string {
  return path.join(deps.userDir(uid), 'cajas.json');
}

function guardarInventario(uid: string, cajas: Caja[]): void {
  try {
    deps.ensureUserDir(uid);
    // Se guardan las ultimas: el historial entero no hace falta y el archivo
    // creceria sin fin.
    deps.writeJson(archivoInventario(uid), cajas.slice(-200));
  } catch (err) {
    console.error('Failed to save boxes:', err);
  }
}

function leerInventario(uid: string): Caja[] {
  try {
    const f = archivoInventario(uid);
    if (!fs.existsSync(f)) return [];
    const guardado = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(guardado) ? guardado : [];
  } catch (err) {
    console.error('Failed to read boxes:', err);
    return [];
  }
}
