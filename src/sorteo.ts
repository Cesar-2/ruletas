// El ultimo sorteo de la ruleta de recursos, para que el widget pueda contarlo.
//
// Esta es la ruleta de siempre, la del Ruleton: se sortean recursos del catalogo
// y se anuncia a quien le tocan.
//
// Recursos y no «objetos»: en este proyecto no es lo mismo. Lo que se sortea es
// la familia 'resources'; los equipables (los «objetos») son otro catalogo que
// no entra en el sorteo, solo se consulta. Ver fetchItemsCached en server.ts. Aqui SI decide el servidor (lo hace
// /api/random-items, con sus rarezas y sus exclusiones); esto solo se queda con
// el resultado para que la superposicion de OBS pueda ensenarlo, porque antes se
// resolvia y se acababa, sin dejar rastro.
//
// Lo que se guarda es lo justo para pintarlo: nombre, imagen y rareza. Ni la
// descripcion, ni el nivel, ni el tipo. Asi el widget no se baja medio catalogo
// por una clave que es de solo mirar.

import { Vivo } from './vivo';

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// Un recurso, con lo poco que hace falta para dibujarlo.
export interface Cosa {
  id: string;
  nombre: string;
  imagen: string;
  // 'common' | 'rare' | 'epic' | 'mythic'. Le da el color a la tarjeta.
  rareza: string;
}

export interface Sorteo {
  // A quien le toca, tal y como lo escribio el dueño. '' si sorteo sin nombre.
  quien: string;
  cosas: Cosa[];
  // Con que se rellena la tragaperras mientras gira: unos cuantos recursos mas,
  // que si no la animacion seria los premios dando vueltas y se veria venir lo
  // que va a salir. No son parte del resultado.
  relleno: Cosa[];
  // Cuando termina la animacion (reloj del servidor). 0 si no habia animacion.
  terminaEn: number;
  cuando: string;
}

export interface SorteoVisible extends Sorteo {
  girando: boolean;
  // Cuantos recursos se sortean. Va SIEMPRE, tambien mientras gira: la
  // tragaperras monta un rodillo por recurso, asi que sin esto no sabria cuantos
  // poner. Un numero no destripa nada; lo que ha salido si, y eso se calla.
  cuantos: number;
}

const sorteos = new Map<string, Sorteo>();
const vivo = new Vivo<Sorteo>('sorteo', () => deps);

// Mas viejo que esto deja de salir: en pantalla se quiere el sorteo de ahora.
// Se le da mas cuerda que a la ruleta de nombres porque aqui el resultado se
// queda a la vista mientras se apunta el premio del ganador, y eso lleva su
// rato.
const CADUCA_MS = 30 * 60 * 1000;

// Cuantos recursos de relleno se guardan. Los suficientes para que la
// tragaperras no repita siempre los mismos, sin mandar el catalogo entero.
const RELLENO_MAX = 24;

// Cuanto puede durar la animacion, como tope. Una animacion que no acaba nunca
// dejaria el widget girando para siempre y el resultado sin salir.
const GIRO_MAX_MS = 30000;

function limpiarCosa(x: unknown): Cosa | null {
  const c = (x || {}) as Record<string, unknown>;
  const nombre = String(c.nombre ?? '').trim().slice(0, 120);
  if (!nombre) return null;
  return {
    id: String(c.id ?? '').slice(0, 40),
    nombre,
    imagen: String(c.imagen ?? '').trim().slice(0, 500),
    rareza: ['common', 'rare', 'epic', 'mythic'].includes(String(c.rareza))
      ? String(c.rareza)
      : 'common'
  };
}

function limpiarCosas(x: unknown, tope: number): Cosa[] {
  return (Array.isArray(x) ? x : [])
    .map(limpiarCosa)
    .filter((c): c is Cosa => c !== null)
    .slice(0, tope);
}

export function guardar(uid: string, datos: unknown): Sorteo | null {
  const d = (datos || {}) as Record<string, unknown>;
  const cosas = limpiarCosas(d.cosas, 50);
  if (!cosas.length) return null;
  const gira = Math.max(0, Math.min(GIRO_MAX_MS, Math.floor(Number(d.duracion) || 0)));
  const s: Sorteo = {
    quien: String(d.quien ?? '').trim().slice(0, 40),
    cosas,
    relleno: limpiarCosas(d.relleno, RELLENO_MAX),
    terminaEn: Date.now() + gira,
    cuando: new Date().toISOString()
  };
  sorteos.set(uid, s);
  vivo.guardar(uid, { estado: s, canal: '', palabra: '', cierraEn: 0 });
  deps.alCambiar?.(uid);
  // Y otro aviso al parar, que es cuando cambia lo que se ve: sin esto el widget
  // esperaria al reloj de repuesto para sacar el resultado.
  if (gira > 0) {
    setTimeout(() => {
      if (sorteos.get(uid) === s) deps.alCambiar?.(uid);
    }, gira + 50).unref?.();
  }
  return s;
}

export function estado(uid: string): SorteoVisible | null {
  const s = sorteos.get(uid);
  if (!s) return null;
  const ahora = Date.now();
  if (ahora - new Date(s.cuando).getTime() > CADUCA_MS) {
    sorteos.delete(uid);
    vivo.borrar(uid);
    return null;
  }
  const girando = ahora < s.terminaEn;
  // Los premios van desde el principio, tambien mientras gira. Hay que decir por
  // que, porque la primera version los callaba:
  //
  // En la tragaperras los rodillos paran de uno en uno, de izquierda a derecha, y
  // cada uno para SOBRE SU premio. Sin los premios, los rodillos pararian sobre
  // relleno, o sea que el espectador veria aterrizar objetos que no son los que
  // ha ganado nadie. Eso no es «no destripar»: es enganar, y es peor que no
  // animar. Corregirlos de golpe al final tampoco vale, porque lo que se ve es
  // media docena de premios cambiando a la vez.
  //
  // Asi que quien tenga la direccion del widget puede mirar el JSON y saber lo
  // que va a salir durante los segundos que dura la animacion. Se acepta por lo
  // mismo que en la ruleta de nombres: esa direccion es del dueno del directo y
  // la reparte el. Lo unico que se sigue callando es a QUIEN le toca, que no hace
  // falta para animar.
  return {
    quien: girando ? '' : s.quien,
    cosas: s.cosas,
    relleno: s.relleno,
    girando,
    cuantos: s.cosas.length,
    terminaEn: s.terminaEn,
    cuando: s.cuando
  };
}

// Tira el sorteo: lo llama la pagina al descartar el resultado, para que el
// widget no siga ensenando algo que ya no esta en pantalla.
export function olvidar(uid: string): void {
  sorteos.delete(uid);
  vivo.borrar(uid);
  deps.alCambiar?.(uid);
}

// Recupera el ultimo sorteo tras un reinicio. La llama el servidor al arrancar.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const e = foto.estado;
  const cosas = limpiarCosas(e?.cosas, 50);
  if (!cosas.length) { vivo.borrar(uid); return false; }
  sorteos.set(uid, {
    quien: String(e.quien || ''),
    cosas,
    relleno: limpiarCosas(e.relleno, RELLENO_MAX),
    terminaEn: Number(e.terminaEn) || 0,
    cuando: String(e.cuando || new Date().toISOString())
  });
  return true;
}
