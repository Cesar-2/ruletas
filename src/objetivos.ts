// Objetivos: la lista de cosas que el streamer quiere hacer en el directo, para
// ir tachandolas delante del chat.
//
// No es un minijuego: no hay chat que escuchar, ni puntos, ni premio. Es una
// lista que se edita desde la pagina y que el widget enseña en OBS, con las ya
// hechas tachadas.
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

export interface Objetivo {
  id: string;
  texto: string;
  hecho: boolean;
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

// Cuantos caben. Mas no se lee en un widget encima del directo, y asi un
// bucle tonto en la pagina no llena el disco.
export const MAXIMO = 50;
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

function conDofus(titulo: string, objetivos: Objetivo[], conseguidos: Iterable<string>): Lista {
  const tiene = new Set(conseguidos);
  return { titulo, objetivos, dofus: DOFUS.map((d) => ({ ...d, conseguido: tiene.has(d.id) })) };
}

export function leer(uid: string): Lista {
  try {
    const f = archivo(uid);
    if (!fs.existsSync(f)) return conDofus('', [], []);
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    const vistos = new Set<string>();
    const objetivos: Objetivo[] = [];
    for (const o of Array.isArray(crudo.objetivos) ? crudo.objetivos : []) {
      const texto = limpiar(o?.texto, LARGO_TEXTO);
      const id = String(o?.id || '');
      if (!texto || !id || vistos.has(id)) continue;
      vistos.add(id);
      objetivos.push({ id, texto, hecho: Boolean(o.hecho) });
      if (objetivos.length >= MAXIMO) break;
    }
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

function nuevoId(lista: Lista): string {
  let id = '';
  do { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  while (lista.objetivos.some((o) => o.id === id));
  return id;
}

export type Resultado = { ok: true; lista: Lista } | { ok: false; error: string };

export function anadir(uid: string, texto: unknown): Resultado {
  const t = limpiar(texto, LARGO_TEXTO);
  if (!t) return { ok: false, error: 'escribe el objetivo' };
  const lista = leer(uid);
  if (lista.objetivos.length >= MAXIMO) return { ok: false, error: 'como mucho ' + MAXIMO + ' objetivos' };
  lista.objetivos.push({ id: nuevoId(lista), texto: t, hecho: false });
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

// Cambia lo que se le pase: el texto, si esta hecho, o las dos cosas.
export function cambiar(uid: string, id: unknown, cambios: { texto?: unknown; hecho?: unknown }): Resultado {
  const lista = leer(uid);
  const o = lista.objetivos.find((x) => x.id === String(id));
  if (!o) return { ok: false, error: 'ese objetivo ya no esta' };
  if (cambios.texto !== undefined) {
    const t = limpiar(cambios.texto, LARGO_TEXTO);
    if (!t) return { ok: false, error: 'el objetivo no puede quedar vacio' };
    o.texto = t;
  }
  if (cambios.hecho !== undefined) o.hecho = Boolean(cambios.hecho);
  return { ok: true, lista: guardar(uid, lista) };
}

export function quitar(uid: string, id: unknown): Lista {
  const lista = leer(uid);
  lista.objetivos = lista.objetivos.filter((o) => o.id !== String(id));
  return guardar(uid, lista);
}

// Sube (-1) o baja (+1) un puesto. En los bordes no hace nada.
export function mover(uid: string, id: unknown, hacia: unknown): Lista {
  const lista = leer(uid);
  const i = lista.objetivos.findIndex((o) => o.id === String(id));
  const j = i + (Number(hacia) < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= lista.objetivos.length) return lista;
  [lista.objetivos[i], lista.objetivos[j]] = [lista.objetivos[j], lista.objetivos[i]];
  return guardar(uid, lista);
}

export function ponerTitulo(uid: string, titulo: unknown): Lista {
  const lista = leer(uid);
  lista.titulo = limpiar(titulo, LARGO_TITULO);
  return guardar(uid, lista);
}

// Todos otra vez sin hacer. Los objetivos se repiten de un directo a otro:
// se desmarcan, no se borran.
export function desmarcarTodos(uid: string): Lista {
  const lista = leer(uid);
  lista.objetivos.forEach((o) => { o.hecho = false; });
  return guardar(uid, lista);
}

export function vaciar(uid: string): Lista {
  const lista = leer(uid);
  lista.objetivos = [];
  return guardar(uid, lista);
}
