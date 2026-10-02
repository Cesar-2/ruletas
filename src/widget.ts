// Los widgets: las paginas que se meten en OBS como Fuente de Navegador para
// que el minijuego se vea encima del directo.
//
// El problema de OBS es que no lleva tu sesion. Abre la url y ya esta: no hay
// cookie, no hay login y no puede haberlo, porque nadie va a escribir una
// contrasena dentro de una fuente de navegador. Asi que el widget se identifica
// con una CLAVE en la propia url.
//
// De ahi salen las reglas de esto:
//
//  - La clave es de solo mirar. Con ella se puede ver el estado de los
//    minijuegos de esa cuenta y nada mas: ni tocar ajustes, ni sortear, ni ver
//    el catalogo, ni saber quien eres. Lo que se filtre si se filtra la url es
//    lo que ya sale en pantalla en el directo.
//  - Se puede cambiar cuando se quiera. Al cambiarla, la de antes deja de
//    valer al momento y hay que actualizar la url en OBS.
//  - Una clave por cuenta, la misma para todos sus widgets: son todos la misma
//    pantalla y separarlas solo daria mas cosas que pegar en OBS.

import fs from 'fs';
import crypto from 'crypto';

export interface Dependencias {
  archivo(): string;
  writeJson(file: string, data: unknown): void;
  // Donde guarda cada cuenta como se ven sus widgets. Aparte de las claves, que
  // son de toda la instalacion: esto es de cada uno, como el resto de ajustes.
  archivoAjustes?(uid: string): string;
  ensureUserDir?(uid: string): void;
}

// Como se ven los widgets de una cuenta.
export interface Ajustes {
  // Cuanto tapa la caja oscura que va detras de cada widget, de 0 (no hay caja:
  // solo el texto encima del directo) a 100 (negra del todo).
  fondo: number;
  // Como de grande se ve todo, en tanto por ciento: 100 es el tamaño de
  // siempre, 50 la mitad y 200 el doble. Es de todo el widget a la vez (cajas,
  // letras, muñecos), no de la letra sola.
  tamano: number;
}

// 82 es lo que llevaban las cajas antes de poder cambiarse.
export const AJUSTES_POR_DEFECTO: Ajustes = { fondo: 82, tamano: 100 };

// Entre cuanto se deja el tamaño. Mas pequeño no se lee en un directo, y mas
// grande no cabe en la fuente de OBS.
export const TAMANO_MIN = 50;
export const TAMANO_MAX = 200;

function porcentaje(valor: unknown, siNo: number, min = 0, max = 100): number {
  const n = Number(valor);
  if (valor === null || valor === '' || !Number.isFinite(n)) return siNo;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = deps.archivoAjustes?.(uid);
    if (!f || !fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO };
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    return {
      fondo: porcentaje(crudo.fondo, AJUSTES_POR_DEFECTO.fondo),
      tamano: porcentaje(crudo.tamano, AJUSTES_POR_DEFECTO.tamano, TAMANO_MIN, TAMANO_MAX)
    };
  } catch (err) {
    console.error('Failed to read widget settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes && ajustes.fondo != null) actual.fondo = porcentaje(ajustes.fondo, actual.fondo);
  if (ajustes && ajustes.tamano != null) {
    actual.tamano = porcentaje(ajustes.tamano, actual.tamano, TAMANO_MIN, TAMANO_MAX);
  }
  const f = deps.archivoAjustes?.(uid);
  if (f) {
    deps.ensureUserDir?.(uid);
    deps.writeJson(f, actual);
  }
  return actual;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// clave -> uid. Se guarda asi y no al reves porque lo que se hace mil veces es
// resolver la clave que llega en la url.
type Mapa = Record<string, string>;

function leerMapa(): Mapa {
  try {
    const f = deps.archivo();
    if (!fs.existsSync(f)) return {};
    const crudo = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!crudo || typeof crudo !== 'object') return {};
    const mapa: Mapa = {};
    for (const [clave, uid] of Object.entries(crudo as Record<string, unknown>)) {
      if (typeof uid === 'string' && uid) mapa[String(clave)] = uid;
    }
    return mapa;
  } catch (err) {
    console.error('Failed to read widget keys:', err);
    return {};
  }
}

function nuevaClave(): string {
  // 24 caracteres hex: suficiente para que no se adivine y todavia se pueda
  // copiar a mano si hace falta.
  return crypto.randomBytes(12).toString('hex');
}

// La clave de una cuenta. Si no tiene, se le hace una: pedirla es quererla.
export function claveDe(uid: string): string {
  const mapa = leerMapa();
  for (const [clave, suyo] of Object.entries(mapa)) {
    if (suyo === uid) return clave;
  }
  const clave = nuevaClave();
  mapa[clave] = uid;
  deps.writeJson(deps.archivo(), mapa);
  return clave;
}

// Otra clave, y la de antes a la basura. Lo que este puesto en OBS deja de
// funcionar hasta que se cambie la url: es justo lo que se quiere cuando se
// rota una clave que se ha enseñado sin querer.
export function rotar(uid: string): string {
  const mapa = leerMapa();
  for (const [clave, suyo] of Object.entries(mapa)) {
    if (suyo === uid) delete mapa[clave];
  }
  const clave = nuevaClave();
  mapa[clave] = uid;
  deps.writeJson(deps.archivo(), mapa);
  return clave;
}

// De quien es una clave, o '' si no es de nadie. Nunca dice por que falla: a
// quien prueba claves no se le cuenta nada.
export function uidDe(clave: unknown): string {
  const c = String(clave ?? '').trim();
  if (!c) return '';
  return leerMapa()[c] || '';
}
