// Objetivos: la lista de cosas que el streamer quiere hacer en el directo, para
// ir tachandolas delante del chat.
//
// No es un minijuego: no hay chat que escuchar, ni puntos, ni premio. Es una
// lista que se edita desde la pagina y que el widget enseña en OBS.
//
// Funciona como carpetas: cada objetivo puede tener sub-objetivos dentro, y
// cada uno de esos los suyos, sin limite. Cualquiera se puede mover a otro
// sitio: dentro de otro, delante o detras, o a la lista principal. Lo mismo a
// todos los niveles: una carpeta esta hecha cuando lo esta todo lo de dentro.
//
// Los de la lista principal son los «objetivos»: solo esos se ponen en proceso
// y salen en el widget, con todo lo que llevan dentro.
//
// Aparte van los Dofus: una coleccion fija de trece que se van consiguiendo.
// No son objetivos de la lista (no se escriben, no se quitan, no se reordenan):
// estan siempre los trece y solo se marca cual se tiene. Tienen su propio
// widget, una tira larga con todos los huevos.
//
// Vive en disco y no en memoria: se toca poco (a mano, desde la pagina) y tiene
// que seguir ahi al dia siguiente, que es cuando se retoman los que quedaron.

import fs from 'fs';
import path from 'path';

// Un objetivo o sub-objetivo, a cualquier nivel.
export interface Sub {
  // Unico en toda la lista, no solo entre hermanos: es por donde se dice cual
  // se toca o se mueve, este donde este.
  id: string;
  texto: string;
  hecho: boolean;
  subs: Sub[];
}

export interface Objetivo extends Sub {
  // Con el que se esta ahora mismo. Solo estos salen en el widget. Hecho y en
  // proceso no van juntos: al marcar uno se quita el otro.
  proceso: boolean;
}

export interface Dofus {
  id: string;           // el nombre del archivo del dibujo, sin extension
  texto: string;
  imagen: string;
  conseguido: boolean;
}

export interface Lista {
  // Lo que sale encima de la lista en el widget. Vacio, el de siempre.
  titulo: string;
  objetivos: Objetivo[];
  // Los trece, siempre en su orden. En disco solo se guarda cuales se tienen.
  dofus: Dofus[];
}

// Cuantos caben en total, contando todos los niveles. Es solo para que un
// bucle tonto en la pagina no llene el disco.
export const MAXIMO = 1000;
// Niveles no hay limite que se note; este tope solo protege la lectura de un
// archivo roto o hecho a mano que se anidara sin fin.
const PROFUNDIDAD_SEGURIDAD = 200;
export const LARGO_TEXTO = 140;
export const LARGO_TITULO = 60;

// Los Dofus, en el orden en que se persiguen. Las imagenes estan en
// public/assets/objetivos; si falta alguna, el widget lo enseña sin dibujo.
export const DOFUS: { id: string; texto: string; imagen: string }[] = [
  ['Dofawa', 'dofawa'], ['Esmeralda', 'esmeralda'], ['Púrpura', 'purpura'],
  ['Turquesa', 'turquesa'], ['Ocre', 'ocre'], ['Marfil', 'marfil'],
  ['Ébano', 'ebano'], ['Domakuro', 'domakuro'], ['Dorigami', 'dorigami'],
  ['Moteado', 'moteado'], ['Pesadilla', 'pesadilla'], ['Pino', 'pino'],
  ['Silvestre', 'silvestre']
].map(([texto, id]) => ({ id, texto, imagen: '/assets/objetivos/' + id + '.png' }));

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Para que el widget puesto en OBS se entere al momento. Ver avisos.ts.
  alCambiar?(uid: string): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

function archivo(uid: string): string {
  return path.join(deps.userDir(uid), 'objetivos.json');
}

function limpiar(texto: unknown, largo: number): string {
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);
}

function idLibre(usados: Set<string>): string {
  let id = '';
  do { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } while (usados.has(id));
  usados.add(id);
  return id;
}

function conDofus(titulo: string, objetivos: Objetivo[], conseguidos: Iterable<string>): Lista {
  const tiene = new Set(conseguidos);
  return { titulo, objetivos, dofus: DOFUS.map((d) => ({ ...d, conseguido: tiene.has(d.id) })) };
}

// Lo que viene del disco, nivel a nivel. Un id repetido no se tira: se le da
// otro (antes los de cada objetivo solo eran unicos dentro de el).
function leerSubs(crudo: unknown, nivel: number, vistos: Set<string>, cuenta: { n: number }): Sub[] {
  const subs: Sub[] = [];
  if (nivel > PROFUNDIDAD_SEGURIDAD || !Array.isArray(crudo)) return subs;
  for (const s of crudo) {
    if (cuenta.n >= MAXIMO) break;
    const texto = limpiar(s?.texto, LARGO_TEXTO);
    if (!texto) continue;
    let id = String(s?.id || '');
    if (!id || vistos.has(id)) id = idLibre(vistos); else vistos.add(id);
    cuenta.n++;
    subs.push({ id, texto, hecho: Boolean(s.hecho), subs: leerSubs(s.subs, nivel + 1, vistos, cuenta) });
  }
  return subs;
}

export function leer(uid: string): Lista {
  try {
    const f = archivo(uid);
    if (!fs.existsSync(f)) return conDofus('', [], []);
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    const lista = Array.isArray(crudo.objetivos) ? crudo.objetivos : [];
    // Por id y no buscando cada uno en la lista: con muchos, eso era cuadratico.
    const procesoDe = new Map<string, boolean>(lista.map((o: any) => [String(o?.id || ''), Boolean(o?.proceso)]));
    const objetivos: Objetivo[] = leerSubs(lista, 0, new Set(), { n: 0 }).map((s) => ({
      ...s, proceso: !s.hecho && Boolean(procesoDe.get(s.id))
    }));
    const conseguidos = Array.isArray(crudo.conseguidos) ? crudo.conseguidos.map(String) : [];
    return conDofus(limpiar(crudo.titulo, LARGO_TITULO), objetivos, conseguidos);
  } catch (err) {
    console.error('Failed to read goals:', err);
    return conDofus('', [], []);
  }
}

function guardar(uid: string, lista: Lista): Lista {
  deps.ensureUserDir(uid);
  deps.writeJson(archivo(uid), {
    titulo: lista.titulo,
    objetivos: lista.objetivos,
    conseguidos: lista.dofus.filter((d) => d.conseguido).map((d) => d.id)
  });
  deps.alCambiar?.(uid);
  return lista;
}

// --- El arbol ----------------------------------------------------------------

// El camino hasta uno: los que lo contienen, de fuera a dentro (el primero es
// siempre un objetivo de la lista principal), y el propio al final. Vacio si
// no esta.
function caminoA(subs: Sub[], id: string): Sub[] {
  for (const s of subs) {
    if (s.id === id) return [s];
    const dentro = caminoA(s.subs, id);
    if (dentro.length) return [s, ...dentro];
  }
  return [];
}

function todosLosIds(subs: Sub[], ids: Set<string> = new Set()): Set<string> {
  for (const s of subs) { ids.add(s.id); todosLosIds(s.subs, ids); }
  return ids;
}

function cuantos(subs: Sub[]): number {
  return subs.reduce((n, s) => n + 1 + cuantos(s.subs), 0);
}

function marcarTodo(subs: Sub[], hecho: boolean): void {
  for (const s of subs) { s.hecho = hecho; marcarTodo(s.subs, hecho); }
}

// Donde vive uno: la lista de sus hermanos (la principal, o los subs de su
// carpeta).
function hermanosDe(lista: Lista, camino: Sub[]): Sub[] {
  return camino.length > 1 ? camino[camino.length - 2].subs : lista.objetivos;
}

// Marca o desmarca un objetivo de la lista principal. Si era con el que se
// estaba (en proceso) y se termina, se pasa al siguiente: el primero sin hacer
// ni empezar que venga detras, o si no queda ninguno, desde arriba.
function marcarHecho(lista: Lista, o: Objetivo, hecho: boolean): void {
  const estabaEnProceso = o.proceso;
  o.hecho = hecho;
  // Terminado ya no esta en proceso: se va del widget solo.
  if (o.hecho) o.proceso = false;
  if (o.hecho && estabaEnProceso) {
    const i = lista.objetivos.indexOf(o);
    const enOrden = lista.objetivos.slice(i + 1).concat(lista.objetivos.slice(0, i));
    const siguiente = enOrden.find((x) => !x.hecho && !x.proceso);
    if (siguiente) siguiente.proceso = true;
  }
}

// Despues de tocar algo dentro de `arriba` (las carpetas que lo contienen, de
// fuera a dentro), se repasa de dentro a fuera: una carpeta con cosas esta
// hecha si lo estan todas. El objetivo de la lista principal, al completarse,
// pasa el siguiente a en proceso.
function repasar(lista: Lista, arriba: Sub[]): void {
  for (let i = arriba.length - 1; i >= 0; i--) {
    const s = arriba[i];
    if (!s.subs.length) continue;
    const todos = s.subs.every((x) => x.hecho);
    if (i === 0) {
      const o = s as Objetivo;
      if (todos && !o.hecho) marcarHecho(lista, o, true);
      else if (!todos && o.hecho) o.hecho = false;
    } else {
      s.hecho = todos;
    }
  }
}

export type Resultado = { ok: true; lista: Lista } | { ok: false; error: string };

// Uno nuevo: en la lista principal, o con `padre` dentro de ese.
export function anadir(uid: string, texto: unknown, padre?: unknown): Resultado {
  const t = limpiar(texto, LARGO_TEXTO);
  if (!t) return { ok: false, error: padre ? 'escribe el sub-objetivo' : 'escribe el objetivo' };
  const lista = leer(uid);
  if (cuantos(lista.objetivos) >= MAXIMO) return { ok: false, error: 'como mucho ' + MAXIMO + ' objetivos en total' };
  const id = idLibre(todosLosIds(lista.objetivos));
  if (!padre) {
    lista.objetivos.push({ id, texto: t, hecho: false, proceso: false, subs: [] });
    return { ok: true, lista: guardar(uid, lista) };
  }
  const camino = caminoA(lista.objetivos, String(padre));
  if (!camino.length) return { ok: false, error: 'ese objetivo ya no esta' };
  camino[camino.length - 1].subs.push({ id, texto: t, hecho: false, subs: [] });
  // Algo nuevo por hacer: ninguna de las carpetas de fuera sigue hecha.
  repasar(lista, camino);
  return { ok: true, lista: guardar(uid, lista) };
}

// Cambia lo que se le pase: el texto, si esta hecho, y (solo los de la lista
// principal) si esta en proceso. Marcarlo hecho marca todo lo de dentro; y
// hacia fuera, al hacer el ultimo que quedaba se hace la carpeta, y asi hasta
// el objetivo. Desmarcar uno deshace las de fuera.
export function cambiar(uid: string, id: unknown,
    cambios: { texto?: unknown; hecho?: unknown; proceso?: unknown }): Resultado {
  const lista = leer(uid);
  const camino = caminoA(lista.objetivos, String(id));
  if (!camino.length) return { ok: false, error: 'ese objetivo ya no esta' };
  const s = camino[camino.length - 1];
  const principal = camino.length === 1;
  if (cambios.texto !== undefined) {
    const t = limpiar(cambios.texto, LARGO_TEXTO);
    if (!t) return { ok: false, error: 'no puede quedar vacio' };
    s.texto = t;
  }
  if (cambios.proceso !== undefined && principal) {
    const o = s as Objetivo;
    o.proceso = Boolean(cambios.proceso);
    if (o.proceso) o.hecho = false;
  }
  if (cambios.hecho !== undefined) {
    const hecho = Boolean(cambios.hecho);
    if (hecho) marcarTodo(s.subs, true);
    if (principal) marcarHecho(lista, s as Objetivo, hecho);
    else { s.hecho = hecho; repasar(lista, camino.slice(0, -1)); }
  }
  return { ok: true, lista: guardar(uid, lista) };
}

// Quita uno con todo lo que tenga dentro.
export function quitar(uid: string, id: unknown): Lista {
  const lista = leer(uid);
  const camino = caminoA(lista.objetivos, String(id));
  if (!camino.length) return lista;
  const arriba = camino.slice(0, -1);
  if (!arriba.length) {
    lista.objetivos = lista.objetivos.filter((o) => o.id !== String(id));
  } else {
    const carpeta = arriba[arriba.length - 1];
    carpeta.subs = carpeta.subs.filter((x) => x.id !== String(id));
    // Si era lo unico que faltaba, la carpeta queda hecha. Solo si le queda
    // algo: una que se queda vacia vuelve a marcarse a mano.
    if (carpeta.subs.length) repasar(lista, arriba);
  }
  return guardar(uid, lista);
}

// Sube (-1) o baja (+1) un puesto entre sus hermanos. En los bordes no hace
// nada.
export function mover(uid: string, id: unknown, hacia: unknown): Lista {
  const lista = leer(uid);
  const camino = caminoA(lista.objetivos, String(id));
  if (!camino.length) return lista;
  const hermanos = hermanosDe(lista, camino);
  const i = hermanos.indexOf(camino[camino.length - 1]);
  const j = i + (Number(hacia) < 0 ? -1 : 1);
  if (j < 0 || j >= hermanos.length) return lista;
  [hermanos[i], hermanos[j]] = [hermanos[j], hermanos[i]];
  return guardar(uid, lista);
}

// Lo lleva a otro sitio, como una carpeta: `dentro` de `destino` (al final),
// `antes` o `despues` de el, o con destino vacio al final de la lista
// principal. Se lleva todo lo que tenga dentro.
export function moverA(uid: string, id: unknown, destino: unknown, como: unknown): Resultado {
  const lista = leer(uid);
  const camino = caminoA(lista.objetivos, String(id));
  if (!camino.length) return { ok: false, error: 'ese objetivo ya no esta' };
  const nodo = camino[camino.length - 1];
  const destinoId = String(destino ?? '');
  const donde = como === 'antes' || como === 'despues' ? como : 'dentro';
  if (destinoId === nodo.id) return { ok: true, lista };
  // Meterlo dentro de si mismo, o de algo suyo, lo haria desaparecer.
  if (destinoId && caminoA(nodo.subs, destinoId).length) {
    return { ok: false, error: 'no se puede meter dentro de lo que lleva dentro' };
  }
  const caminoDestino = destinoId ? caminoA(lista.objetivos, destinoId) : [];
  if (destinoId && !caminoDestino.length) return { ok: false, error: 'ese sitio ya no esta' };

  // Fuera de donde estaba.
  const arribaAntes = camino.slice(0, -1);
  const origen = hermanosDe(lista, camino);
  origen.splice(origen.indexOf(nodo), 1);

  // Adentro de donde va. Al salir de la lista principal deja de estar en
  // proceso; al entrar en ella llega sin estarlo.
  let arribaDespues: Sub[];
  let lugar: Sub[];
  let pos: number;
  if (!destinoId) {
    arribaDespues = [];
    lugar = lista.objetivos;
    pos = lugar.length;
  } else if (donde === 'dentro') {
    arribaDespues = caminoDestino;
    lugar = caminoDestino[caminoDestino.length - 1].subs;
    pos = lugar.length;
  } else {
    arribaDespues = caminoDestino.slice(0, -1);
    lugar = hermanosDe(lista, caminoDestino);
    pos = lugar.indexOf(caminoDestino[caminoDestino.length - 1]) + (donde === 'despues' ? 1 : 0);
  }
  const movido: Sub = arribaDespues.length
    ? { id: nodo.id, texto: nodo.texto, hecho: nodo.hecho, subs: nodo.subs }
    : { id: nodo.id, texto: nodo.texto, hecho: nodo.hecho, subs: nodo.subs, proceso: false } as Objetivo;
  lugar.splice(pos, 0, movido);

  // Las dos carpetas se repasan: la de antes puede haberse quedado con todo
  // hecho, y la de ahora con algo por hacer. Solo si siguen teniendo algo.
  if (arribaAntes.length && arribaAntes[arribaAntes.length - 1].subs.length) repasar(lista, arribaAntes);
  repasar(lista, arribaDespues);
  return { ok: true, lista: guardar(uid, lista) };
}

// El orden entero de una vez: es lo que manda el boton «Guardar» de la
// pagina, que va moviendo en el navegador y solo al final dice como queda.
// `arbol` es solo la forma, [{ id, subs: [...] }]: el texto y lo marcado
// salen de lo guardado, que puede haber cambiado mientras se ordenaba (se
// sigue marcando en directo). Por eso no se exige que cuadre del todo:
//
//  - un id que ya no existe (se quito entre medias) se ignora;
//  - uno que no viene (se añadio entre medias) se queda en su carpeta de
//    antes, al final, o en la lista principal si su carpeta ya no esta.
//
// Como en moverA, el que sale de la lista principal deja de estar en proceso.
// Al final se repasan todas las carpetas: alguna puede haber quedado hecha, o
// con algo por hacer.
export function ordenar(uid: string, arbol: unknown): Resultado {
  if (!Array.isArray(arbol)) return { ok: false, error: 'falta el orden' };
  const lista = leer(uid);
  const nodos = new Map<string, Sub>();
  const padreDe = new Map<string, string>();
  const enOrden: Sub[] = [];
  const apuntar = (subs: Sub[], padre: string) => {
    for (const s of subs) {
      nodos.set(s.id, s);
      padreDe.set(s.id, padre);
      enOrden.push(s);
      apuntar(s.subs, s.id);
    }
  };
  apuntar(lista.objetivos, '');
  const proceso = new Map(lista.objetivos.map((o) => [o.id, o.proceso]));
  for (const s of nodos.values()) s.subs = [];

  const puestos = new Set<string>();
  const colocar = (crudo: unknown, nivel: number): Sub[] => {
    const subs: Sub[] = [];
    if (!Array.isArray(crudo) || nivel > PROFUNDIDAD_SEGURIDAD) return subs;
    for (const c of crudo) {
      const s = nodos.get(String((c as any)?.id ?? ''));
      if (!s || puestos.has(s.id)) continue;
      puestos.add(s.id);
      s.subs = colocar((c as any)?.subs, nivel + 1);
      subs.push(s);
    }
    return subs;
  };
  const raiz = colocar(arbol, 0);
  // Los que no venian, en el orden en que estaban: su carpeta siempre va
  // antes que ellos, asi que cuando llegan ya se sabe donde quedo.
  for (const s of enOrden) {
    if (puestos.has(s.id)) continue;
    puestos.add(s.id);
    const padre = nodos.get(padreDe.get(s.id) || '');
    if (padre && puestos.has(padre.id)) padre.subs.push(s); else raiz.push(s);
  }

  lista.objetivos = raiz.map((s) => ({
    id: s.id, texto: s.texto, hecho: s.hecho, subs: s.subs, proceso: Boolean(proceso.get(s.id)) && !s.hecho
  }));
  const repasarTodo = (s: Sub, arriba: Sub[]) => {
    s.subs.forEach((x) => repasarTodo(x, arriba.concat(s)));
    if (s.subs.length) repasar(lista, arriba.concat(s));
  };
  lista.objetivos.forEach((o) => repasarTodo(o, []));
  return { ok: true, lista: guardar(uid, lista) };
}

// Junta todos los completados de la lista principal en uno nuevo con ese
// nombre, ya hecho, con cada uno (y lo que lleve) dentro. La lista queda
// limpia y lo terminado sigue guardado: con «Desmarcar todos» se repite.
export function agruparHechos(uid: string, nombre: unknown): Resultado {
  const t = limpiar(nombre, LARGO_TEXTO);
  if (!t) return { ok: false, error: 'ponle un nombre' };
  const lista = leer(uid);
  const hechos = lista.objetivos.filter((o) => o.hecho);
  if (!hechos.length) return { ok: false, error: 'no hay ningun objetivo completado' };
  const subs: Sub[] = hechos.map((o) => ({ id: o.id, texto: o.texto, hecho: true, subs: o.subs }));
  lista.objetivos = lista.objetivos.filter((o) => !o.hecho);
  lista.objetivos.push({ id: idLibre(todosLosIds(lista.objetivos.concat(subs as Objetivo[]))), texto: t, hecho: true, proceso: false, subs });
  return { ok: true, lista: guardar(uid, lista) };
}

// Marca un Dofus como conseguido, o lo desmarca si se pulso sin querer.
export function marcarDofus(uid: string, id: unknown, conseguido: unknown): Resultado {
  const lista = leer(uid);
  const d = lista.dofus.find((x) => x.id === String(id));
  if (!d) return { ok: false, error: 'ese Dofus no existe' };
  d.conseguido = Boolean(conseguido);
  return { ok: true, lista: guardar(uid, lista) };
}

export function ponerTitulo(uid: string, titulo: unknown): Lista {
  const lista = leer(uid);
  lista.titulo = limpiar(titulo, LARGO_TITULO);
  return guardar(uid, lista);
}

// Todos otra vez sin hacer, a todos los niveles. Los objetivos se repiten de
// un directo a otro: se desmarcan, no se borran.
export function desmarcarTodos(uid: string): Lista {
  const lista = leer(uid);
  marcarTodo(lista.objetivos, false);
  lista.objetivos.forEach((o) => { o.proceso = false; });
  return guardar(uid, lista);
}

export function vaciar(uid: string): Lista {
  const lista = leer(uid);
  lista.objetivos = [];
  return guardar(uid, lista);
}
