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
//  - El VALOR de catalogo de un objeto (rareza y nivel). Es la vara de medir:
//    sin ella nadie sabe si mil puntos es caro o barato.
//  - La CAJA: que lleva dentro, decidido al crearla y no al abrirla. Esa
//    diferencia es la que separa una subasta de una tragaperras; si se
//    decidiera al abrir, nadie estaria pujando por unos objetos, estaria
//    pujando por una tirada de dados.
//  - La SUBASTA: como se puja y quien gana. No sabe nada del contenido.
//
// Los puntos son los mismos de la carrera, la batalla y el plinko.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Cronometro } from './cronometro';

// --- El valor de catalogo -----------------------------------------------
// Lo que "vale" un objeto, para poder comparar cajas entre si. No es un precio:
// el precio lo pone quien puja. La gracia del juego esta justo en la distancia
// entre las dos cosas.

export type Rareza = 'common' | 'rare' | 'epic' | 'mythic';

const ORDEN_RAREZA: Rareza[] = ['common', 'rare', 'epic', 'mythic'];

// Dentro de las cajas van EQUIPABLES, no recursos. Y los equipables no llevan
// rareza marcada: esa pestana del catalogo es solo de consulta, no hay donde
// pintarlos de un color. Asi que el color sale del nivel, que para equipo de
// Dofus es justo lo que dice cuanto vale.
//
// Esto tiene una ventaja que no es menor: no hay que marcar nada a mano, asi
// que funciona en cualquier servidor desde el primer dia.
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

export const VALOR_BASE: Record<Rareza, number> = {
  common: 10,
  rare: 40,
  epic: 150,
  mythic: 600
};

// Cuanto vale un objeto lo decide el dueno, objeto a objeto, y una caja vale
// la suma de lo que lleva. Esto de aqui NO es ese precio: es solo lo que se
// propone cuando todavia no has dicho nada, para no empezar de cero y para que
// las cajas al azar (que sacan de 4.000 equipables, y a esos no les vas a poner
// precio uno a uno) tengan con que medirse. En cuanto pones un precio, manda el
// tuyo y esto no se vuelve a mirar.
//
// El nivel sube el valor, pero poco: manda la rareza. Un nivel 200 vale el
// doble que un nivel 1 de su mismo color, no diez veces mas.
export function precioSugerido(nivel: number): number {
  return valorDe(rarezaPorNivel(nivel), nivel);
}

export function valorDe(rareza: Rareza, nivel: number): number {
  const base = VALOR_BASE[rareza] ?? VALOR_BASE.common;
  const n = Math.max(0, Math.min(200, Number(nivel) || 0));
  return Math.round(base * (1 + n / 200));
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
  // Lo que se espera que valga una caja de esta clase. Manda en tres sitios: el
  // precio de salida, lo que cuestan las pistas, y con que se compara el peso.
  // En las cajas que armas a mano el valor es la suma de lo que metes; esto
  // sigue siendo la vara con la que se mide si eso es mucho o poco.
  valorMedio: number;
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
    valorMedio: 150
  },
  {
    id: 'comun',
    nombre: 'Caja comun',
    descripcion: 'El pan de cada dia: puede salir algo morado, pero no cuentes con ello.',
    minObjetos: 2, maxObjetos: 4,
    rarezas: ['common', 'rare', 'epic'],
    valorMedio: 350
  },
  {
    id: 'sellada',
    nombre: 'Caja sellada',
    descripcion: 'La del pelotazo. La mayoria de las veces sale por debajo de lo que costo.',
    minObjetos: 1, maxObjetos: 3,
    rarezas: ['rare', 'epic', 'mythic'],
    valorMedio: 900
  }
];

// La categoria por su id, dentro de una lista. Si no esta (porque la borraste
// despues de armar una caja con ella), se cae en la primera que haya: mejor eso
// que una caja sin categoria que no se pueda ni subastar.
export function tipoDe(tipos: TipoCaja[], id: string): TipoCaja {
  const lista = tipos && tipos.length ? tipos : TIPOS_POR_DEFECTO;
  return lista.find((t) => t.id === id) || lista[0];
}

// Que una categoria sea utilizable: nombre, cuantos objetos, de que rarezas y
// cuanto vale. Lo que venga mal se endereza en vez de rechazarse entero.
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
    valorMedio: Math.max(1, Math.min(1000000, Math.floor(Number(x?.valorMedio) || 100))),
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

// El peso: la pista gratis. Es lo que vale la caja comparado con lo que se
// espera de su categoria, en una escala de 1 a 5, y con ruido a proposito para
// que no sea una tasacion exacta disfrazada de barra: un peso 4 suele ser
// bueno, no siempre. Esa duda es justo lo que se esta subastando.
const ESCALA_PESO = [0.5, 0.8, 1.3, 1.8];

function pesoDe(valor: number, tipo: TipoCaja): number {
  const proporcion = valor / Math.max(1, tipo.valorMedio);
  const ruido = (Math.random() - 0.5) * 0.45;
  const conRuido = proporcion + ruido;
  return ESCALA_PESO.filter((corte) => conRuido >= corte).length + 1;
}

// Cuanto se desvia del valor de su categoria una caja SORTEADA. Las que armas
// a mano no pasan por aqui: esas valen la suma de lo que les metes, sin mas.
//
// No es un sorteo plano entre el minimo y el maximo: se tuerce hacia abajo, de
// forma que la mayoria decepcionan un poco y unas pocas son el pelotazo. Esa es
// la forma que hace que se hable de las buenas.
//
// La horquilla es la misma para todas las categorias, y no algo que haya que
// decidir por categoria: lo que cambia de una a otra es cuanto valen y de que
// rarezas salen, que es lo que de verdad se nota.
const FACTOR_MIN = 0.4;
const FACTOR_MAX = 2.2;
// El exponente sale de exigir que la media del presupuesto caiga en valorMedio:
// E[r^k] = (1 - min) / rango. Lo que acaba dentro queda un 10-15% por debajo,
// porque los objetos son piezas enteras y casi siempre sobra calderilla sin
// gastar; eso esta bien y no se corrige.
const FACTOR_K = Math.max(0.2, (FACTOR_MAX - FACTOR_MIN) / (1 - FACTOR_MIN) - 1);

function factorDe(): number {
  return FACTOR_MIN + (FACTOR_MAX - FACTOR_MIN) * Math.pow(Math.random(), FACTOR_K);
}

// Se reparte un presupuesto en objetos, en vez de sortear objetos y sumar lo
// que salga. Asi se controla la media (y con ella la inflacion) y se controlan
// las colas: se sabe exactamente cada cuanto aparece el pelotazo.
export function crearCaja(tipos: TipoCaja[], tipoId: string, catalogo: ObjetoCatalogo[]): Caja | null {
  const tipo = tipoDe(tipos, tipoId);
  const candidatos = catalogo.filter((o) => tipo.rarezas.includes(o.rareza));
  if (!candidatos.length) return null;

  const factor = factorDe();
  let presupuesto = tipo.valorMedio * factor;
  const cuantos = tipo.minObjetos + Math.floor(Math.random() * (tipo.maxObjetos - tipo.minObjetos + 1));

  const objetos: ObjetoCaja[] = [];
  for (let i = 0; i < cuantos; i++) {
    const queda = cuantos - i;
    // Lo que toca gastar en este objeto para que lleguen todos. El ultimo se
    // come lo que sobre, que es de donde salen las sorpresas.
    const objetivo = queda === 1 ? presupuesto : presupuesto / queda;
    // El que mas se acerca a lo que toca, de los que quedan por debajo del
    // presupuesto. Si ninguno cabe, el mas barato que haya.
    const caben = candidatos.filter((o) => valorDe(o.rareza, o.nivel) <= presupuesto);
    const donde = caben.length ? caben : candidatos;
    const cerca = donde
      .map((o) => ({ o, dif: Math.abs(valorDe(o.rareza, o.nivel) - objetivo) }))
      .sort((a, b) => a.dif - b.dif)
      .slice(0, 12);
    if (!cerca.length) break;
    const elegido = alAzar(cerca).o;
    const valor = valorDe(elegido.rareza, elegido.nivel);
    objetos.push({ ...elegido, valor });
    presupuesto -= valor;
    if (presupuesto <= 0) break;
  }

  // Una caja nunca sale vacia. Pagar por nada vacia el juego mas rapido que
  // cualquier desequilibrio.
  if (!objetos.length) {
    const barato = candidatos.slice().sort((a, b) => valorDe(a.rareza, a.nivel) - valorDe(b.rareza, b.nivel))[0];
    objetos.push({ ...barato, valor: valorDe(barato.rareza, barato.nivel) });
  }

  const valor = objetos.reduce((s, o) => s + o.valor, 0);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: tipo.id,
    creada: new Date().toISOString(),
    objetos,
    valor,
    peso: pesoDe(valor, tipo),
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

// El peso de una caja armada no se inventa: sale de lo que lleva, comparado
// con lo que valdria una caja de ese tipo. Asi la pista gratis sigue queriendo
// decir lo mismo que en las sorteadas.
export function armar(
  tipos: TipoCaja[], nombre: string, tipoId: string, objetos: ObjetoCaja[], imagen = ''
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
        valor: propio ? Math.min(1000000, Math.round(puesto)) : precioSugerido(nivel),
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

// De caja armada a caja de verdad, con su peso calculado igual que las otras.
function deArmada(tipos: TipoCaja[], armada: CajaArmada): Caja {
  const tipo = tipoDe(tipos, armada.tipo);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tipo: tipo.id,
    creada: new Date().toISOString(),
    objetos: armada.objetos,
    valor: armada.valor,
    peso: pesoDe(armada.valor, tipo),
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
  salidaPct: number;      // precio de salida, sobre el valor medio del tipo
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
    abierta: false, caja: null, salida: 0, pujas: [], pistas: [], rechazadas: [],
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
export function abrir(uid: string, canal: string, tipoId: string, catalogo: ObjetoCatalogo[]): Subasta | null {
  const ajustes = leerAjustes(uid);
  const armada = leerArmario(uid).find((c) => c.id === tipoId);
  const caja = armada ? deArmada(ajustes.tipos, armada) : crearCaja(ajustes.tipos, tipoId, catalogo);
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
  // Sale barato a proposito: que arranque y suba es mejor que una salida alta
  // y un silencio.
  s.salida = Math.max(1, Math.round(tipo.valorMedio * ajustes.salidaPct / 100));
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
  const coste = Math.max(1, Math.round(tipoDe(ajustes.tipos, s.caja.tipo).valorMedio * COSTE_PISTA[tipo]));
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

  const coste = Math.max(0, Math.round(caja.valor * ajustes.costeAbrir / 100));
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
  uid: string, nombre: string, tipoId: string, objetos: ObjetoCaja[], imagen = ''
): CajaArmada | null {
  if (!objetos || !objetos.length) return null;
  const nueva = armar(leerAjustes(uid).tipos, nombre, tipoId, objetos, imagen);
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
