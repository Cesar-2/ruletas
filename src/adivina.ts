// Adivina la palabra: el streamer elige una palabra en secreto y va dando
// pistas; el primero que la escriba en el chat se lleva el premio.
//
// Aqui se decide quien acierta, no en la pagina: el chat lo lee el servidor
// (ver chat.ts), que es lo unico que garantiza QUIEN ha escrito. La palabra no
// sale nunca hacia el widget ni hacia nadie sin sesion hasta que la partida
// acaba: ver estadoPublico().
//
// Acertar es escribirla en un mensaje corto. Da igual las tildes, las
// mayusculas y los signos, y se le deja algo de relleno («es perro?», «perro
// Kappa»), pero no soltar una lista de palabras a ver si cae alguna: con mas de
// RELLENO palabras de sobra el mensaje no cuenta.
//
// El premio son puntos del marcador (los de la carrera), un premio que va a
// Ganadores (kamas, un objeto del catalogo, o las dos cosas), o todo a la vez.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Vivo } from './vivo';

export interface Premio {
  kamas: number;
  texto: string;        // el objeto del catalogo, por su nombre
  imagen?: string;      // y su icono
}

export interface Ajustes {
  puntos: number;       // al marcador, para quien acierta
  premio: Premio;       // a Ganadores, para quien acierta
}

const SIN_PREMIO: Premio = { kamas: 0, texto: '' };
export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 20, premio: SIN_PREMIO };

// Lo que puede sobrar en el mensaje que acierta, en palabras.
export const RELLENO = 2;
// Tope de pistas: mas no caben en pantalla, y a esas alturas ya es regalarla.
const MAX_PISTAS = 20;
// Los ultimos intentos fallidos que se ensenan, para ver por donde va el chat.
const ULTIMOS = 10;
// A partir de aqui ya no se apunta quien ha probado: solo se cuenta.
const MAX_JUGADORES = 5000;

// Una pista es un texto, una imagen que tenga que ver, o las dos cosas.
export interface Pista {
  texto: string;
  imagen?: string;      // /assets/... o una direccion de internet
  en: number;           // cuando se dio, en ms
}

export interface Intento {
  nombre: string;
  texto: string;
}

export interface Partida {
  palabra: string;      // tal como la escribio el streamer
  pistas: Pista[];
  // Si se ensena cuantas letras tiene (con huecos: «_ _ _ _ _»).
  letras: boolean;
  fase: 'jugando' | 'fin';
  ganador: string;      // '' si se revelo sin que nadie acertara
  intentos: number;     // mensajes del chat mientras se jugaba
  jugadores: string[];  // quien ha probado, en minusculas
  ultimos: Intento[];   // los ultimos fallos, el mas nuevo al final
  empezo: number;
  acabo: number;
  // Lo que se juega, fijado al empezar: cambiar los ajustes a mitad no le
  // cambia el premio a una partida que ya esta en marcha.
  puntos: number;
  premio: Premio;
  // En que servidor del Ruleton se apunta el premio: en el que se empezo.
  ambito: string;
  // Si el premio llego a Ganadores. false con premio = hay que apuntarlo a mano.
  apuntado: boolean;
}

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  alCambiar?(uid: string): void;
  // El marcador es el mismo que el de la carrera.
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
  // Apunta el premio en Ganadores del servidor «ambito». Devuelve si se pudo.
  apuntarGanador?(ambito: string, nombre: string, premio: Premio): boolean;
  // Escribe en el chat y lo fija arriba, si Twitch esta conectado. No lanza.
  // Twitch solo deja un mensaje fijado: cada uno sustituye al anterior.
  fijar?(uid: string, texto: string, segundos?: number): void;
  // Para la estadistica del panel de admin.
  alAcabar?(uid: string, jugadores: number): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

const partidas = new Map<string, Partida>();
const vivo = new Vivo<Partida>('adivina', () => deps);
const escuchas = new Map<string, chat.Conexion>();

// --- Ajustes ------------------------------------------------------------

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'adivina.json');
}

function limpiarImagen(x: unknown): string {
  const t = String(x ?? '').trim().slice(0, 500);
  return /^https?:\/\//i.test(t) || t.startsWith('/assets/') ? t : '';
}

function limpiarPremio(x: unknown, siNo: Premio = SIN_PREMIO): Premio {
  if (!x || typeof x !== 'object') return { ...siNo };
  const p = x as Record<string, unknown>;
  const limpio: Premio = {
    kamas: p.kamas === undefined ? siNo.kamas
      : Math.max(0, Math.min(1e10, Math.floor(Number(p.kamas) || 0))),
    texto: p.texto === undefined ? siNo.texto : String(p.texto ?? '').trim().slice(0, 80)
  };
  const imagen = p.imagen === undefined && p.texto === undefined ? (siNo.imagen || '') : limpiarImagen(p.imagen);
  if (imagen && limpio.texto) limpio.imagen = imagen;
  return limpio;
}

export function hayPremio(p: Premio | undefined): boolean {
  return Boolean(p && (p.kamas > 0 || p.texto));
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    if (!fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO, premio: { ...SIN_PREMIO } };
    const g = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      puntos: Math.max(0, Math.floor(Number(g?.puntos ?? AJUSTES_POR_DEFECTO.puntos) || 0)),
      premio: limpiarPremio(g?.premio)
    };
  } catch (err) {
    console.error('Failed to read guess-the-word settings:', err);
    return { ...AJUSTES_POR_DEFECTO, premio: { ...SIN_PREMIO } };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes.puntos != null) {
    actual.puntos = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.puntos) || 0)));
  }
  if (ajustes.premio != null) actual.premio = limpiarPremio(ajustes.premio, actual.premio);
  deps.ensureUserDir(uid);
  deps.writeJson(archivoAjustes(uid), actual);
  deps.alCambiar?.(uid);
  return actual;
}

// --- Comparar -----------------------------------------------------------

// Sin tildes, sin mayusculas y sin signos: «¡Árbol!» y «arbol» son lo mismo.
// La ñ se queda: «ano» y «año» no son la misma palabra.
export function normalizar(texto: string): string[] {
  return String(texto || '')
    .toLowerCase()
    .replace(/ñ/g, '\u0000')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0000/g, 'ñ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Si el texto lleva la palabra entera y seguida, como palabras sueltas: «sol»
// no esta dentro de «soldado».
function contiene(dicho: string[], buscada: string[]): boolean {
  if (!buscada.length) return false;
  for (let i = 0; i + buscada.length <= dicho.length; i++) {
    if (buscada.every((p, k) => dicho[i + k] === p)) return true;
  }
  return false;
}

// Si el mensaje acierta: lleva la palabra entera, seguida, y no demasiado mas.
export function acierta(mensaje: string, palabra: string): boolean {
  const buscada = normalizar(palabra);
  const dicho = normalizar(mensaje);
  if (dicho.length > buscada.length + RELLENO) return false;
  return contiene(dicho, buscada);
}

// «_ _ _ _ _   _ _ _»: un hueco por letra, y los espacios de verdad mas anchos.
export function forma(palabra: string): string {
  return normalizar(palabra).map((p) => Array.from(p).map(() => '_').join(' ')).join('   ');
}

// --- Estado -------------------------------------------------------------

function apuntarEnDisco(uid: string): void {
  const p = partidas.get(uid);
  if (!p) { vivo.borrar(uid); deps.alCambiar?.(uid); return; }
  vivo.guardar(uid, {
    estado: p,
    canal: escuchas.get(uid)?.canal || '',
    palabra: '',
    cierraEn: 0
  });
  deps.alCambiar?.(uid);
}

// Para el streamer, con la palabra.
export function estado(uid: string) {
  const p = partidas.get(uid) || null;
  return {
    hay: Boolean(p),
    partida: p ? { ...p, jugadores: undefined, cuantos: p.jugadores.length } : null,
    escuchando: escuchas.get(uid)?.canal || '',
    chat: escuchas.get(uid)?.salud() || null,
    ajustes: leerAjustes(uid),
    ahora: Date.now()
  };
}

// Para el widget y cualquiera sin sesion: la palabra solo cuando ya se acabo.
export function estadoPublico(uid: string) {
  const p = partidas.get(uid);
  if (!p) return { hay: false };
  const fin = p.fase === 'fin';
  return {
    hay: true,
    fase: p.fase,
    pistas: p.pistas.map((x) => ({ texto: x.texto, imagen: x.imagen || '' })),
    forma: p.letras && !fin ? forma(p.palabra) : '',
    palabra: fin ? p.palabra : '',
    ganador: p.ganador,
    intentos: p.intentos,
    cuantos: p.jugadores.length,
    puntos: p.puntos,
    premio: hayPremio(p.premio) ? p.premio : null,
    acabo: p.acabo,
    ahora: Date.now()
  };
}

// --- Jugar --------------------------------------------------------------

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

function escuchar(uid: string, canal: string): void {
  cerrarEscucha(uid);
  if (!canal) return;
  const dueno = canal.trim().toLowerCase().replace(/^#/, '');
  escuchas.set(uid, chat.conectar(canal, (m) => {
    // El streamer sabe la palabra: lo que escriba el no cuenta.
    if (m.autor.toLowerCase() === dueno) return;
    intentar(uid, m.autor, m.texto);
  }, () => deps.alCambiar?.(uid)));
}

// Empieza una partida nueva. La palabra es obligatoria; la primera pista no.
export function abrir(uid: string, canal: string, opciones: {
  palabra: unknown; pista?: unknown; letras?: unknown; ambito?: string;
}): { ok: boolean; error?: string } {
  const palabra = String(opciones.palabra ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!normalizar(palabra).length) return { ok: false, error: 'escribe la palabra que hay que adivinar' };

  const ajustes = leerAjustes(uid);
  const p: Partida = {
    palabra,
    pistas: [],
    letras: Boolean(opciones.letras),
    fase: 'jugando',
    ganador: '',
    intentos: 0,
    jugadores: [],
    ultimos: [],
    empezo: Date.now(),
    acabo: 0,
    puntos: ajustes.puntos,
    premio: { ...ajustes.premio },
    ambito: String(opciones.ambito || ''),
    apuntado: false
  };
  partidas.set(uid, p);
  escuchar(uid, canal);
  // La primera pista, si la hay, va con el aviso de que se empieza.
  const primera = String(opciones.pista ?? '').trim();
  if (primera && darPista(uid, primera).ok) return { ok: true };
  fijarPistas(uid, p);
  apuntarEnDisco(uid);
  return { ok: true };
}

// Lo que se fija en el chat: que se esta jugando y TODAS las pistas dadas. Van
// todas en el mismo mensaje porque Twitch solo deja uno fijado, y si cada pista
// sustituyera a la anterior, quien llega tarde solo veria la ultima. Si no
// caben, se caen las mas viejas: las nuevas son las que mas ayudan.
const MAX_FIJADO = 500;
export function textoFijado(p: Partida): string {
  const cabeza = '🔤 Adivina la palabra: escribe en el chat lo que creas que es';
  const forma = p.letras ? ` (${normalizar(p.palabra).map((x) => x.length).join(' + ')} letras)` : '';
  const pistas = p.pistas.map((x, i) =>
    `${i + 1}) ${x.texto || ''}${x.imagen ? (x.texto ? ' ' : '') + '🖼 mira la imagen en pantalla' : ''}`);
  let cuerpo = '';
  for (let desde = 0; desde <= pistas.length; desde++) {
    const lista = pistas.slice(desde);
    cuerpo = lista.length ? ' · Pistas: ' + (desde ? '… ' : '') + lista.join(' · ') : '';
    if ((cabeza + forma + cuerpo).length <= MAX_FIJADO) break;
  }
  return (cabeza + forma + cuerpo).slice(0, MAX_FIJADO);
}

function fijarPistas(uid: string, p: Partida): void {
  deps.fijar?.(uid, textoFijado(p));
}

// Solo imagenes que se pueden pintar sin miedo: las subidas, o de internet.
function imagenValida(x: unknown): string {
  const t = String(x ?? '').trim().slice(0, 500);
  return /^https?:\/\//i.test(t) || /^\/assets\/[\w.-]+$/.test(t) ? t : '';
}

export function darPista(uid: string, texto: unknown, imagen?: unknown): { ok: boolean; error?: string } {
  const p = partidas.get(uid);
  if (!p || p.fase !== 'jugando') return { ok: false, error: 'no hay ninguna partida en juego' };
  const limpia = String(texto ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const foto = imagenValida(imagen);
  if (!limpia && !foto) return { ok: false, error: 'escribe la pista o pon una imagen' };
  if (p.pistas.length >= MAX_PISTAS) return { ok: false, error: `como mucho ${MAX_PISTAS} pistas` };
  // Que no se le escape la respuesta dentro de la pista.
  if (contiene(normalizar(limpia), normalizar(p.palabra))) {
    return { ok: false, error: 'la pista lleva la palabra dentro' };
  }
  const pista: Pista = { texto: limpia, en: Date.now() };
  if (foto) pista.imagen = foto;
  p.pistas.push(pista);
  fijarPistas(uid, p);
  apuntarEnDisco(uid);
  return { ok: true };
}

export function quitarPista(uid: string, cual: unknown): boolean {
  const p = partidas.get(uid);
  const i = Math.floor(Number(cual));
  if (!p || p.fase !== 'jugando' || !(i >= 0 && i < p.pistas.length)) return false;
  p.pistas.splice(i, 1);
  // Lo fijado tiene que dejar de decirla tambien.
  fijarPistas(uid, p);
  apuntarEnDisco(uid);
  return true;
}

// Un mensaje del chat. Exportada para poder probarla sin chat.
export function intentar(uid: string, autor: string, texto: string): boolean {
  const p = partidas.get(uid);
  const nombre = String(autor || '').trim().slice(0, 40);
  if (!p || p.fase !== 'jugando' || !nombre) return false;

  p.intentos++;
  const clave = nombre.toLowerCase();
  if (p.jugadores.length < MAX_JUGADORES && !p.jugadores.includes(clave)) p.jugadores.push(clave);

  if (acierta(texto, p.palabra)) {
    ganar(uid, p, nombre);
    return true;
  }
  p.ultimos.push({ nombre, texto: String(texto).slice(0, 80) });
  if (p.ultimos.length > ULTIMOS) p.ultimos.splice(0, p.ultimos.length - ULTIMOS);
  // No se guarda a disco cada fallo: en un chat lleno serian cientos de
  // escrituras por minuto para nada. Se avisa a la pantalla y la foto se
  // pone al dia con la siguiente pista o al acabar.
  deps.alCambiar?.(uid);
  return false;
}

// Darsela a alguien a mano, por si el chat se la comio (o lo dijo en voz).
export function darPorAcertada(uid: string, nombre: unknown): { ok: boolean; error?: string } {
  const p = partidas.get(uid);
  if (!p || p.fase !== 'jugando') return { ok: false, error: 'no hay ninguna partida en juego' };
  const limpio = String(nombre ?? '').trim().slice(0, 40);
  if (!limpio) return { ok: false, error: 'hace falta un nombre' };
  ganar(uid, p, limpio);
  return { ok: true };
}

function ganar(uid: string, p: Partida, nombre: string): void {
  p.fase = 'fin';
  p.ganador = nombre;
  p.acabo = Date.now();
  cerrarEscucha(uid);
  if (p.puntos > 0) deps.sumarPuntos(uid, nombre, p.puntos);
  if (hayPremio(p.premio)) {
    let ok = false;
    try {
      ok = Boolean(p.ambito && deps.apuntarGanador?.(p.ambito, nombre, p.premio));
    } catch (err) {
      console.error('Adivina: no se pudo apuntar el premio de', nombre, err);
    }
    p.apuntado = ok;
  }
  const premio = [
    p.puntos > 0 ? `${p.puntos} puntos` : '',
    hayPremio(p.premio) ? [p.premio.texto, p.premio.kamas > 0 ? `${p.premio.kamas.toLocaleString('es-ES')} kamas` : ''].filter(Boolean).join(' y ') : ''
  ].filter(Boolean).join(' + ');
  // Lo fijado pasa a ser quien ha ganado, un minuto: las pistas ya no sirven.
  deps.fijar?.(uid, `🎉 ¡${nombre} lo ha adivinado! Era «${p.palabra}»` + (premio ? ` · se lleva ${premio}` : ''), 60);
  deps.alAcabar?.(uid, p.jugadores.length);
  apuntarEnDisco(uid);
}

// Nadie la saca: se acaba y se ensena la palabra.
export function revelar(uid: string): boolean {
  const p = partidas.get(uid);
  if (!p || p.fase !== 'jugando') return false;
  p.fase = 'fin';
  p.acabo = Date.now();
  cerrarEscucha(uid);
  deps.fijar?.(uid, `🔤 Nadie lo ha adivinado. Era «${p.palabra}»`, 60);
  deps.alAcabar?.(uid, p.jugadores.length);
  apuntarEnDisco(uid);
  return true;
}

export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  partidas.delete(uid);
  apuntarEnDisco(uid);
}

// Recupera la partida que estaba en juego al apagarse el servidor.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const e = foto.estado as Partida;
  if (!e || typeof e.palabra !== 'string' || !normalizar(e.palabra).length) { vivo.borrar(uid); return false; }
  const p: Partida = {
    palabra: e.palabra,
    pistas: Array.isArray(e.pistas) ? e.pistas.filter((x) => x && typeof x.texto === 'string') : [],
    letras: Boolean(e.letras),
    fase: e.fase === 'fin' ? 'fin' : 'jugando',
    ganador: String(e.ganador || ''),
    intentos: Number(e.intentos) || 0,
    jugadores: Array.isArray(e.jugadores) ? e.jugadores.map(String) : [],
    ultimos: Array.isArray(e.ultimos) ? e.ultimos : [],
    empezo: Number(e.empezo) || Date.now(),
    acabo: Number(e.acabo) || 0,
    puntos: Number(e.puntos) || 0,
    premio: limpiarPremio(e.premio),
    ambito: String(e.ambito || ''),
    apuntado: Boolean(e.apuntado)
  };
  partidas.set(uid, p);
  if (p.fase === 'jugando' && foto.canal) escuchar(uid, foto.canal);
  return true;
}
