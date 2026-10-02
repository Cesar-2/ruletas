// Rey de la colina: una cola de retadores contra el que manda.
//
// Se abre la inscripcion, y quien escriba la palabra en el chat se pone en la
// cola. El primero pelea contra el rey; el que gana se queda arriba y el que
// pierde se va. Quien pierde puede volver a escribir la palabra y ponerse otra
// vez al final, asi que se participa cuantas veces se quiera, pero en la cola
// solo se esta una vez.
//
// Aqui no hay puntos: esto es espectaculo. Lo que se persigue es la racha, y
// lo unico que se guarda en disco es el record historico de victorias
// seguidas, que no se borra al acabar el directo.
//
// La pelea en si no se decide aqui: la resuelve batalla.ts con las mismas
// reglas que el torneo, para que un combate sea igual se juegue donde se
// juegue.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Vivo } from './vivo';
import * as batalla from './batalla';

export interface Retador {
  nombre: string;
  clave: string;        // en minusculas, para no colar dos veces a la misma persona
  clase: string;        // su clase de Dofus, sorteada al entrar en la cola
}

// El que manda ahora mismo, con las victorias que lleva encadenadas.
export interface Rey extends Retador {
  racha: number;
}

// La racha mas larga que se ha visto. La de este directo vive en memoria; la
// historica se guarda en disco y no se pierde.
export interface Marca {
  nombre: string;
  racha: number;
  cuando: number;       // en milisegundos, para poder decir de cuando es
}

export interface Colina {
  abierta: boolean;             // si se admiten retadores
  cola: Retador[];
  rey: Rey | null;
  // El ultimo combate peleado, con todos sus golpes: es lo que la pagina
  // cuenta poco a poco. Se queda hasta que se pelea el siguiente.
  duelo: batalla.Duelo | null;
  // Quien cayo en ese combate, para poder decir a quien acaba de tumbar.
  derrotado: string;
  mejor: Marca | null;          // la mejor racha de esta partida
  peleados: number;             // combates de esta partida, para las estadisticas
  // Los dos que estan peleando ahora mismo, por su clave, mientras la pagina
  // cuenta el combate. No pueden encolarse: todavia se les esta viendo pelear.
  enCombate: string[];
  // Cuando empezo ese combate y cuando se acaba de contar. Lo segundo lo sabe
  // el servidor sin que nadie se lo diga, porque el relato va a ritmo fijo: es
  // lo que impide que empiece otro combate encima, y lo que suelta a los dos
  // aunque la pagina se cierre a mitad y nunca avise.
  combateDesde: number;
  combateHasta: number;
  // La clase que le toco a cada uno, por su clave. Se guarda aparte de la cola
  // porque hace falta despues de salir de ella: al perdedor hay que seguir
  // dibujandolo mientras se cuenta el combate que acaba de perder. Y de paso,
  // quien vuelve a retar lo hace con la misma clase de antes.
  clases: Record<string, string>;
}

export interface Ajustes {
  palabra: string;              // lo que se escribe en el chat para retar
}

export const AJUSTES_POR_DEFECTO: Ajustes = { palabra: '!reto' };

// Lo que tarda en contarse un combate en pantalla: un golpe cada RITMO_GOLPE y
// un rato al final para ver la victoria. Son los mismos numeros que usa
// contarRonda() en public/js/dofus-arte.js, y tienen que serlo: de aqui sale
// cuando puede empezar el combate siguiente. Hay un test que los compara.
export const RITMO_GOLPE = 700;
export const COLA_COMBATE = 1800;

export function duracionDe(duelo: batalla.Duelo): number {
  return duelo.golpes.length * RITMO_GOLPE + COLA_COMBATE;
}

// Lo que se perdona al pedir el siguiente: los relojes de la pagina no clavan
// el milisegundo, y negarle el combate por llegar un pelo antes seria tonto.
const HOLGURA = 400;

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

// La partida vive en memoria, que es donde se toca a cada combate; de ahi se
// saca una foto a disco para que un reinicio no se lleve al rey ni a la cola.
// Esta es la que mas lo agradece: la colina no se resuelve de una, es el estado
// que mas dura de todos los minijuegos. Ver vivo.ts.
const colinas = new Map<string, Colina>();
const vivo = new Vivo<Colina>('colina', () => deps);
// La palabra con la que se abrio, para rehacer la escucha tal cual estaba.
const palabras = new Map<string, string>();

// La foto de lo que hay vivo ahora mismo.
//
// El duelo se deja fuera: es el relato golpe a golpe del ultimo combate, y solo
// sirve para que la pagina lo cuente. Si un reinicio pilla a mitad del relato,
// la pagina ya se recargo y no lo esta contando; lo que importa es quien quedo
// de rey, y eso si se guarda.
function apuntarEnDisco(uid: string): void {
  const colina = colinas.get(uid);
  if (!colina) { vivo.borrar(uid); return; }
  vivo.guardar(uid, {
    estado: { ...colina, duelo: null },
    canal: escuchas.get(uid)?.canal || '',
    palabra: palabras.get(uid) || '',
    cierraEn: 0
  });
  deps.alCambiar?.(uid);
}

function archivo(uid: string): string {
  return path.join(deps.userDir(uid), 'colina.json');
}

// En el archivo van juntas dos cosas que no cambian al mismo ritmo: la palabra
// del chat y el record. Es un solo archivo porque tampoco dan para dos.
interface Guardado {
  palabra: string;
  record: Marca | null;
}

function leerGuardado(uid: string): Guardado {
  try {
    const f = archivo(uid);
    if (!fs.existsSync(f)) return { palabra: AJUSTES_POR_DEFECTO.palabra, record: null };
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      palabra: typeof crudo?.palabra === 'string' && crudo.palabra.trim()
        ? crudo.palabra.trim() : AJUSTES_POR_DEFECTO.palabra,
      record: crudo?.record && typeof crudo.record.nombre === 'string' && crudo.record.racha > 0
        ? {
            nombre: crudo.record.nombre,
            racha: Math.floor(crudo.record.racha),
            cuando: Number(crudo.record.cuando) || 0
          }
        : null
    };
  } catch (err) {
    console.error('Failed to read hill settings:', err);
    return { palabra: AJUSTES_POR_DEFECTO.palabra, record: null };
  }
}

function escribir(uid: string, datos: Guardado): void {
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), datos);
}

export function leerAjustes(uid: string): Ajustes {
  return { palabra: leerGuardado(uid).palabra };
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const datos = leerGuardado(uid);
  if (typeof ajustes.palabra === 'string') {
    datos.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  escribir(uid, datos);
  return { palabra: datos.palabra };
}

export function record(uid: string): Marca | null {
  return leerGuardado(uid).record;
}

// Borra el record historico, que es lo unico que «Reiniciar la colina» no
// toca. Se lleva tambien la mejor racha de la partida: si se quedara, seguiria
// saliendo como record en el widget, que la enseña cuando no hay historico.
// Al rey de ahora no se le quita la racha: su proxima victoria lo estrena.
export function borrarRecord(uid: string): void {
  const datos = leerGuardado(uid);
  datos.record = null;
  escribir(uid, datos);
  const colina = colinas.get(uid);
  if (colina) {
    colina.mejor = null;
    apuntarEnDisco(uid);
  } else {
    // Sin partida abierta no hay foto que guardar, pero el widget puede estar
    // puesto igual y tiene que enterarse.
    deps.alCambiar?.(uid);
  }
}

// El record solo se toca cuando de verdad se supera: empatar no destrona a
// quien lo tenia, que llego antes.
function puedeSerRecord(uid: string, nombre: string, racha: number): void {
  const datos = leerGuardado(uid);
  if (datos.record && racha <= datos.record.racha) return;
  datos.record = { nombre, racha, cuando: Date.now() };
  escribir(uid, datos);
}

function vacia(): Colina {
  return {
    abierta: false, cola: [], rey: null, duelo: null,
    derrotado: '', mejor: null, peleados: 0, clases: {},
    enCombate: [], combateDesde: 0, combateHasta: 0
  };
}

export function estado(uid: string): Colina & {
  escuchando: string; chat: chat.Salud | null; palabra: string; record: Marca | null; ahora: number;
} {
  const c = colinas.get(uid) || vacia();
  const datos = leerGuardado(uid);
  return {
    ...c, escuchando: escuchando(uid), chat: saludChat(uid), palabra: datos.palabra, record: datos.record,
    // La hora de aqui, para que quien mira sepa cuanto le queda al combate sin
    // fiarse de su propio reloj.
    ahora: Date.now()
  };
}

// La conexion al chat mientras la colina esta abierta.
const escuchas = new Map<string, chat.Conexion>();

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Abre la colina y se pone a escuchar. A diferencia del torneo, esto no se
// cierra al empezar a pelear: la cola sigue abierta mientras se pelea, que es
// justo la gracia.
export function abrir(uid: string, canal: string): Colina {
  cerrarEscucha(uid);
  const colina = vacia();
  colina.abierta = true;
  colinas.set(uid, colina);
  escuchar(uid, canal, leerGuardado(uid).palabra);
  apuntarEnDisco(uid);
  return colina;
}

// Ponerse a escuchar el chat. Aparte de `abrir` porque al arrancar hay que
// rehacer la escucha de una colina que se abrio antes del reinicio.
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
    const colina = colinas.get(uid);
    if (!colina || !colina.abierta) return;
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    entrar(uid, m.autor);
  }, () => deps.alCambiar?.(uid)));
}

// Recupera la colina que estaba en marcha al apagarse. La llama el servidor al
// arrancar, una vez por cuenta.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const e = foto.estado;
  const base = vacia();
  const colina: Colina = {
    ...base,
    abierta: Boolean(e.abierta),
    cola: Array.isArray(e.cola) ? e.cola : [],
    rey: e.rey || null,
    derrotado: String(e.derrotado || ''),
    mejor: e.mejor || null,
    peleados: Number(e.peleados) || 0,
    clases: (e.clases && typeof e.clases === 'object') ? e.clases : {},
    // El duelo no se guarda, y con el se van los que estaban peleando: tras un
    // reinicio la pagina ya no esta contando nada, asi que dejar a dos
    // marcados como «peleando ahora mismo» solo les impediria volver a la cola.
    duelo: null,
    enCombate: [],
    combateDesde: 0,
    combateHasta: 0
  };
  colinas.set(uid, colina);
  if (colina.abierta && foto.canal) escuchar(uid, foto.canal, foto.palabra);
  apuntarEnDisco(uid);
  return true;
}

export function cerrar(uid: string): void {
  cerrarEscucha(uid);
  colinas.delete(uid);
  palabras.delete(uid);
  vivo.borrar(uid);
  deps.alCambiar?.(uid);
}

export function escuchando(uid: string): string {
  return escuchas.get(uid)?.canal || '';
}

// Si todavia se esta contando un combate en pantalla. Mientras tanto no empieza
// otro: antes cada pagina abierta lanzaba los suyos sin saber de las demas, y
// con dos pestañas (o un moderador con la misma cuenta) los combates se pisaban
// y el widget, que solo puede contar uno a la vez, se saltaba la mitad.
export function ocupada(uid: string): boolean {
  const colina = colinas.get(uid);
  return Boolean(colina && colina.duelo && Date.now() < colina.combateHasta - HOLGURA);
}

// Si a esta persona se le esta viendo pelear ahora mismo. Acabado el relato se
// le suelta sola, avise alguien o no.
function estaPeleando(colina: Colina, clave: string): boolean {
  if (!colina.enCombate.length) return false;
  if (Date.now() >= colina.combateHasta) return false;
  return colina.enCombate.includes(clave);
}

// La pagina avisa de que ya ha terminado de contar el combate: los dos que
// peleaban quedan libres para volver a la cola.
//
// Solo vale si de verdad ha terminado. Una pestaña que va con retraso avisaria
// del combate anterior con el siguiente ya empezado, y soltaria a los que
// estan peleando ahora.
export function finCombate(uid: string): void {
  const colina = colinas.get(uid);
  if (!colina || !colina.enCombate.length) return;
  if (Date.now() < colina.combateHasta - HOLGURA) return;
  colina.enCombate = [];
  apuntarEnDisco(uid);
}

// Ponerse en la cola. Lo llama el chat y tambien el dueno a mano.
export function entrar(uid: string, nombre: string): { ok: boolean; error?: string } {
  const colina = colinas.get(uid);
  if (!colina || !colina.abierta) return { ok: false, error: 'no hay ninguna colina abierta' };

  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, error: 'hace falta un nombre' };
  const clave = limpio.toLowerCase();
  // En la cola solo se esta una vez: si no, uno solo podria llenarla.
  if (colina.cola.some((r) => r.clave === clave)) return { ok: false, error: 'ya estabas en la cola' };
  // Y el rey no se reta a si mismo: ya esta arriba, no tiene donde entrar.
  if (colina.rey && colina.rey.clave === clave) return { ok: false, error: 'ya eres el rey' };
  // Ni el que esta peleando ahora mismo: hasta que no se acabe de ver el
  // combate no vuelve a la cola, gane o pierda.
  if (estaPeleando(colina, clave)) return { ok: false, error: 'estas peleando ahora mismo' };

  if (!colina.clases[clave]) colina.clases[clave] = batalla.sortearClase();
  colina.cola.push({ nombre: limpio, clave, clase: colina.clases[clave] });
  apuntarEnDisco(uid);
  return { ok: true };
}

// Sacar a alguien de la cola, por si se cuela quien no debe.
export function sacar(uid: string, nombre: string): boolean {
  const colina = colinas.get(uid);
  if (!colina) return false;
  const clave = String(nombre || '').trim().toLowerCase();
  const antes = colina.cola.length;
  colina.cola = colina.cola.filter((r) => r.clave !== clave);
  if (colina.cola.length < antes) { apuntarEnDisco(uid); return true; }
  return false;
}

// Si hay con quien pelear el siguiente combate.
export function hayCombate(uid: string): boolean {
  const colina = colinas.get(uid);
  if (!colina) return false;
  // Sin rey hacen falta dos: uno sube y el otro le reta.
  return colina.cola.length >= (colina.rey ? 1 : 2);
}

// Lleva la cuenta de la mejor racha de la partida, y de paso mira el record.
function apuntarMejor(uid: string, colina: Colina, nombre: string, racha: number): void {
  if (!colina.mejor || racha > colina.mejor.racha) {
    colina.mejor = { nombre, racha, cuando: Date.now() };
  }
  puedeSerRecord(uid, nombre, racha);
}

// El siguiente combate: el rey contra el primero de la cola. Si no hay rey,
// sube el primero sin pelear y le reta el segundo.
//
// Devuelve la colina ya resuelta, con el duelo entero dentro: la pagina lo
// cuenta golpe a golpe, pero quien ha ganado ya esta decidido aqui.
//
// Tampoco si el anterior se esta contando todavia: ver ocupada().
export function siguiente(uid: string): Colina | null {
  const colina = colinas.get(uid);
  if (!colina || !hayCombate(uid) || ocupada(uid)) return null;

  if (!colina.rey) {
    const primero = colina.cola.shift() as Retador;
    colina.rey = { ...primero, racha: 0 };
  }
  const rey = colina.rey;
  // Nadie pelea consigo mismo. No deberia poder colarse el propio rey en la
  // cola, pero si alguna vez se cuela se le tira y se coge al de detras, en
  // vez de montar un combate imposible.
  while (colina.cola.length && colina.cola[0].clave === rey.clave) {
    const repe = colina.cola.shift() as Retador;
    console.error('Rey de la colina: ' + repe.nombre + ' estaba en la cola siendo el rey; se descarta');
  }
  if (!colina.cola.length) return null;
  const retador = colina.cola.shift() as Retador;

  const duelo = batalla.pelearSueltos(rey.nombre, retador.nombre);
  colina.duelo = duelo;
  colina.peleados++;
  // Los dos quedan ocupados hasta que la pagina avise de que ya se ha contado.
  colina.enCombate = [rey.clave, retador.clave];
  colina.combateDesde = Date.now();
  colina.combateHasta = colina.combateDesde + duracionDe(duelo);

  if (duelo.ganador === rey.nombre) {
    rey.racha++;
    colina.derrotado = retador.nombre;
    apuntarMejor(uid, colina, rey.nombre, rey.racha);
  } else {
    // Destronado: el retador se queda arriba y empieza su propia racha. Al
    // perdedor no se le devuelve a la cola: si quiere revancha, la pide.
    colina.derrotado = rey.nombre;
    colina.rey = { ...retador, racha: 1 };
    apuntarMejor(uid, colina, retador.nombre, 1);
  }
  apuntarEnDisco(uid);
  return colina;
}

// Baja al rey y deja el sitio libre, sin pelear. Para cuando quien manda se va
// del directo y la cola se queda parada esperandole.
export function destronar(uid: string): Colina | null {
  const colina = colinas.get(uid);
  if (!colina || !colina.rey) return null;
  colina.rey = null;
  colina.duelo = null;
  colina.derrotado = '';
  colina.enCombate = [];
  colina.combateDesde = 0;
  colina.combateHasta = 0;
  apuntarEnDisco(uid);
  return colina;
}

// La clase de alguien, para que la pagina lo dibuje. El duelo solo lleva
// nombres; la clase la tienen el rey y la cola.
export function claseDe(uid: string, nombre: string): string {
  const colina = colinas.get(uid);
  if (!colina) return '';
  return colina.clases[String(nombre || '').toLowerCase()] || '';
}
