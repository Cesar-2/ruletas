// Los retoques del catalogo: lo que cada usuario anade, cambia o borra de la
// lista de recursos que se sortea.
//
// Por que existe esto en vez de tocar el catalogo directamente: el catalogo es
// una DESCARGA. Se baja de la API (o del volcado de Touch) y se deja en
// data/items*.json como copia; el dia que se actualiza, ese archivo se
// reescribe entero. Cualquier cosa escrita ahi dentro se perderia sin avisar.
//
// Asi que los retoques viven aparte, uno por usuario y juego, y se aplican
// ENCIMA al servir. El catalogo descargado no se toca nunca: se puede volver a
// bajar cuantas veces haga falta y los retoques siguen ahi.
//
// Es la misma idea que las exclusiones, pero no es lo mismo. Excluir saca un
// objeto del sorteo y se sigue viendo en su pestana; borrar lo quita del
// catalogo entero, como si no existiera.

import fs from 'fs';

// Lo que se le cambia a un objeto que vino del catalogo. Solo estas dos cosas:
// el nivel, el tipo y lo demas siguen siendo los que trajo la descarga.
export interface Cambio {
  name?: string;
  imagen?: string;
}

export interface Retoques {
  // Objetos que no estaban y los pone el usuario, ya en el formato comun.
  nuevos: any[];
  // Lo cambiado de los que si estaban, por ankama_id.
  cambios: Record<string, Cambio>;
  // Los que se han borrado del catalogo, por ankama_id.
  borrados: string[];
}

export const VACIO: Retoques = { nuevos: [], cambios: {}, borrados: [] };

export function vacio(): Retoques {
  return { nuevos: [], cambios: {}, borrados: [] };
}

// --- Lectura y escritura ------------------------------------------------

// Nunca se fia de lo que haya en el archivo: puede venir de una version vieja,
// de una copia a mano o de un disco a medio escribir. Lo que no encaje se
// ignora, que un retoque roto no puede dejar sin catalogo a nadie.
export function leer(file: string): Retoques {
  try {
    if (!fs.existsSync(file)) return vacio();
    const crudo = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    const r = vacio();
    if (Array.isArray(crudo.nuevos)) {
      r.nuevos = crudo.nuevos.filter((x: any) => x && Number.isFinite(Number(x.ankama_id)));
    }
    if (crudo.cambios && typeof crudo.cambios === 'object') {
      for (const [id, c] of Object.entries(crudo.cambios as Record<string, any>)) {
        const limpio = limpiarCambio(c);
        if (limpio) r.cambios[String(id)] = limpio;
      }
    }
    if (Array.isArray(crudo.borrados)) {
      r.borrados = crudo.borrados.map((x: unknown) => String(x)).filter(Boolean);
    }
    return r;
  } catch (err) {
    console.error('Failed to read catalog edits:', err);
    return vacio();
  }
}

function limpiarCambio(c: any): Cambio | null {
  if (!c || typeof c !== 'object') return null;
  const cambio: Cambio = {};
  if (typeof c.name === 'string' && c.name.trim()) cambio.name = c.name.trim().slice(0, 120);
  if (typeof c.imagen === 'string' && c.imagen.trim()) cambio.imagen = c.imagen.trim().slice(0, 500);
  return Object.keys(cambio).length ? cambio : null;
}

// Un retoque que ya no cambia nada se borra en vez de guardarse vacio: asi el
// archivo no engorda con restos y volver al nombre original lo deja limpio.
export function estaVacio(r: Retoques): boolean {
  return !r.nuevos.length && !r.borrados.length && !Object.keys(r.cambios).length;
}

// --- Aplicarlos ---------------------------------------------------------

// El catalogo tal como lo tiene que ver este usuario. Este es el unico sitio
// donde se juntan la descarga y los retoques.
export function aplicar(items: any[], r: Retoques): any[] {
  if (!Array.isArray(items)) return [];
  if (estaVacio(r)) return items;

  const fuera = new Set(r.borrados);
  const salida: any[] = [];
  for (const item of items) {
    const id = String(item?.ankama_id ?? '');
    if (fuera.has(id)) continue;
    const cambio = r.cambios[id];
    if (!cambio) { salida.push(item); continue; }
    salida.push(conCambio(item, cambio));
  }

  // Los anadidos van al final y tambien pasan por sus cambios: se le puede
  // cambiar el nombre a uno propio igual que a uno descargado.
  for (const nuevo of r.nuevos) {
    const id = String(nuevo?.ankama_id ?? '');
    if (fuera.has(id)) continue;
    const cambio = r.cambios[id];
    salida.push(cambio ? conCambio(nuevo, cambio) : nuevo);
  }
  return salida;
}

function conCambio(item: any, cambio: Cambio): any {
  const nuevo = { ...item, retocado: true };
  if (cambio.name) nuevo.name = cambio.name;
  if (cambio.imagen) {
    // La imagen se pone en los cuatro tamanos: la pagina pide el que le
    // convenga y no tiene que saber que esta es una puesta a mano.
    nuevo.image_urls = { icon: cambio.imagen, sd: cambio.imagen, hq: cambio.imagen, hd: cambio.imagen };
  }
  return nuevo;
}

// --- Objetos nuevos -----------------------------------------------------

// Los ankama_id de verdad son positivos, asi que los objetos propios se
// numeran hacia abajo desde -1. Nunca pueden chocar con uno descargado, ni
// aunque manana el catalogo traiga miles mas, y de un vistazo se sabe cual es
// de quien.
export function siguienteId(r: Retoques): number {
  let menor = 0;
  for (const n of r.nuevos) {
    const id = Number(n?.ankama_id);
    if (Number.isFinite(id) && id < menor) menor = id;
  }
  return menor - 1;
}

// Un recurso puesto a mano, en el mismo formato comun que los descargados:
// aguas abajo (sorteo, rarezas, exclusiones, cajas) nada tiene que enterarse
// de que este no vino de la API.
export function nuevoRecurso(id: number, datos: { nombre: string; imagen?: string; nivel?: number; tipo?: string; descripcion?: string }): any {
  const img = String(datos.imagen ?? '').trim().slice(0, 500);
  const nivel = Math.max(0, Math.min(1000, Math.floor(Number(datos.nivel) || 0)));
  return {
    ankama_id: id,
    name: datos.nombre.trim().slice(0, 120),
    type: { name: String(datos.tipo ?? '').trim().slice(0, 60) || 'Propio' },
    level: nivel,
    image_urls: { icon: img, sd: img, hq: img, hd: img },
    description: String(datos.descripcion ?? '').trim().slice(0, 1000),
    // Para poder distinguirlos: lo propio se puede borrar del todo, lo
    // descargado vuelve solo con actualizar el catalogo.
    propio: true
  };
}
