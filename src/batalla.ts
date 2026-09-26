// Batalla de viewers: un torneo de duelos uno contra uno. Se apuntan por el
// chat, como en la carrera, se emparejan de dos en dos, y el que gana pasa a
// la siguiente ronda hasta que queda un campeon.
//
// Quien decide cada duelo es esto, no el navegador: la pagina solo lo cuenta.
// Los puntos van al mismo marcador que la carrera de balineras.

import fs from 'fs';
import path from 'path';
import * as chat from './chat';
import { Cronometro } from './cronometro';
import { Vivo, quedanSegundos } from './vivo';

export interface Luchador {
  nombre: string;
  clave: string;        // en minusculas, para no duplicar a la misma persona
  clase?: string;       // su clase de Dofus, sorteada al empezar el torneo
}

// Cada golpe del combate, para poder contarlo en la pagina uno a uno.
export interface Golpe {
  quien: string;        // el que pega
  a: string;            // el que recibe
  ataque: string;       // como pega, solo para darle gracia
  dano: number;
  critico: boolean;
  fallo?: boolean;      // el otro lo esquivo: no quita nada
  furia?: boolean;      // pegado contra las cuerdas, pega mas fuerte
  aguanta?: boolean;    // deberia haber caido y se queda con un hilo de vida
  vidaA: number;        // como quedan los dos tras el golpe
  vidaB: number;
}

export interface Duelo {
  a: string;
  b: string;            // vacio = pasa de ronda sin pelear
  ganador: string;      // vacio hasta que se resuelve
  golpes: Golpe[];      // el combate, golpe a golpe
}

export const VIDA = 100;

// Como pega, en generico. La pagina cuenta cada golpe con el hechizo de la
// clase de Dofus del que ataca; esto queda por si algo lo lee sin clase.
const ATAQUES = ['ataca a', 'golpea a', 'embiste a'];

export interface Ronda {
  numero: number;
  duelos: Duelo[];
}

export interface Batalla {
  abierta: boolean;         // si se admiten apuntados
  luchadores: Luchador[];
  rondas: Ronda[];
  campeon: string;
  puntos: number;           // lo que se lleva el campeon
}

export interface Ajustes {
  puntos: number;
  palabra: string;      // lo que se escribe en el chat para apuntarse
}

export const AJUSTES_POR_DEFECTO: Ajustes = { puntos: 25, palabra: '!pelea' };

export interface Dependencias {
  userDir(uid: string): string;
  ensureUserDir(uid: string): void;
  writeJson(file: string, data: unknown): void;
  // Se llama cuando cambia algo que se ve en pantalla, para que el servidor
  // avise a quien este mirando en vez de hacerle preguntar. Ver avisos.ts.
  alCambiar?(uid: string): void;
  // El marcador es el mismo que el de la carrera.
  sumarPuntos(uid: string, nombre: string, cuantos: number): number;
  // Las clases de Dofus que tienen imagen de prueba: solo se sortean esas.
  clasesConArte?(): string[];
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// La batalla en curso vive en memoria, que es donde se toca a cada duelo; de
// ahi se saca una foto a disco para que un reinicio no se lleve el cuadro a
// medio torneo. Aqui se guarda todo, golpes incluidos: un cuadro con sus
// combates son unos pocos kilobytes, y es justo lo que la pagina va contando
// ronda a ronda. Ver vivo.ts.
const batallas = new Map<string, Batalla>();
const vivo = new Vivo<Batalla>('batalla', () => deps);
// La palabra con la que se abrio, para rehacer la escucha tal cual estaba.
const palabras = new Map<string, string>();

function archivoAjustes(uid: string): string {
  return path.join(deps.userDir(uid), 'batalla.json');
}

export function leerAjustes(uid: string): Ajustes {
  try {
    const f = archivoAjustes(uid);
    if (!fs.existsSync(f)) return { ...AJUSTES_POR_DEFECTO };
    return { ...AJUSTES_POR_DEFECTO, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch (err) {
    console.error('Failed to read battle settings:', err);
    return { ...AJUSTES_POR_DEFECTO };
  }
}

export function guardarAjustes(uid: string, ajustes: Partial<Ajustes>): Ajustes {
  const actual = leerAjustes(uid);
  if (ajustes.puntos != null) {
    actual.puntos = Math.max(0, Math.min(1000000, Math.floor(Number(ajustes.puntos) || 0)));
  }
  if (typeof ajustes.palabra === 'string') {
    actual.palabra = ajustes.palabra.trim().slice(0, 30) || AJUSTES_POR_DEFECTO.palabra;
  }
  deps.ensureUserDir(uid);
  deps.writeJson(archivoAjustes(uid), actual);
  return actual;
}

// La foto de lo que hay vivo ahora mismo.
function apuntarEnDisco(uid: string): void {
  const batalla = batallas.get(uid);
  if (!batalla) { vivo.borrar(uid); return; }
  vivo.guardar(uid, {
    estado: batalla,
    canal: escuchas.get(uid)?.canal || '',
    palabra: palabras.get(uid) || '',
    cierraEn: crono.cierraEn(uid)
  });
  deps.alCambiar?.(uid);
}

export function estado(uid: string): Batalla & {
  escuchando: string; chat: chat.Salud | null; palabra: string; cierraEn: number; ahora: number;
} {
  const b = batallas.get(uid) || {
    abierta: false, luchadores: [], rondas: [], campeon: '', puntos: leerAjustes(uid).puntos
  };
  const ajustes = leerAjustes(uid);
  // Los puntos que se enseñan son los ajustados ahora mismo, no los que
  // hubiera al abrir: se pueden cambiar en cualquier momento.
  return {
    ...b, puntos: ajustes.puntos, escuchando: escuchando(uid), chat: saludChat(uid), palabra: ajustes.palabra,
    cierraEn: crono.cierraEn(uid), ahora: Date.now()
  };
}

// La conexion al chat mientras hay inscripcion abierta.
const escuchas = new Map<string, chat.Conexion>();
// Al llegar la hora deja de escuchar el chat. El torneo no empieza solo:
// sigue esperando a que el streamer pulse «Empezar torneo».
const crono = new Cronometro((uid) => cerrarEscucha(uid));

function cerrarEscucha(uid: string): void {
  const e = escuchas.get(uid);
  if (e) { escuchas.delete(uid); e.cerrar(); }
}

// Abre la inscripcion y se pone a escuchar el chat: quien escriba la palabra
// se apunta, igual que en la carrera.
// Con segundos, la inscripcion se cierra sola cuando se acaban.
export function abrir(uid: string, canal: string, segundos?: unknown): Batalla {
  cerrarEscucha(uid);
  crono.poner(uid, segundos);
  const ajustes = leerAjustes(uid);
  const batalla: Batalla = {
    abierta: true, luchadores: [], rondas: [], campeon: '', puntos: ajustes.puntos
  };
  batallas.set(uid, batalla);
  escuchar(uid, canal, ajustes.palabra);
  apuntarEnDisco(uid);
  return batalla;
}

// Ponerse a escuchar el chat. Aparte de `abrir` porque al arrancar hay que
// rehacer la escucha de una inscripcion que se abrio antes del reinicio.
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
    const batalla = batallas.get(uid);
    if (!batalla || !batalla.abierta) return;
    if (!chat.esLaPalabra(m.texto, buscada)) return;
    entrar(uid, m.autor);
  }, () => deps.alCambiar?.(uid)));
}

// Recupera el torneo que estaba en marcha al apagarse. La llama el servidor al
// arrancar, una vez por cuenta.
export function rehacer(uid: string): boolean {
  const foto = vivo.leer(uid);
  if (!foto) return false;
  const e = foto.estado;
  const batalla: Batalla = {
    abierta: Boolean(e.abierta),
    luchadores: Array.isArray(e.luchadores) ? e.luchadores : [],
    rondas: Array.isArray(e.rondas) ? e.rondas : [],
    campeon: String(e.campeon || ''),
    puntos: Number(e.puntos) || leerAjustes(uid).puntos
  };
  batallas.set(uid, batalla);

  // El cronometro sigue contando desde la hora que se guardo, no desde cero:
  // si se le paso la hora con el servidor apagado, la inscripcion ya cerro.
  const quedan = quedanSegundos(foto.cierraEn);
  if (batalla.abierta && quedan >= 0) {
    if (quedan > 0) crono.poner(uid, quedan);
    if (foto.canal) escuchar(uid, foto.canal, foto.palabra);
  } else if (quedan < 0) {
    crono.rehacerVencido(uid, foto.cierraEn);
  }
  apuntarEnDisco(uid);
  return true;
}

export function cancelar(uid: string): void {
  cerrarEscucha(uid);
  crono.quitar(uid);
  batallas.delete(uid);
  palabras.delete(uid);
  vivo.borrar(uid);
  deps.alCambiar?.(uid);
}

export function escuchando(uid: string): string {
  return escuchas.get(uid)?.canal || '';
}

// Apuntarse. Lo llama tanto el invitado con su codigo como el dueño a mano.
export function entrar(uid: string, nombre: string): { ok: boolean; error?: string } {
  const batalla = batallas.get(uid);
  if (!batalla) return { ok: false, error: 'no hay ninguna batalla abierta' };
  if (!batalla.abierta) return { ok: false, error: 'la batalla ya ha empezado' };
  // Con el cronometro vencido ya no entra nadie, ni por el chat ni a mano.
  if (crono.vencido(uid)) return { ok: false, error: 'la inscripcion ya se cerro' };

  const limpio = String(nombre || '').trim().slice(0, 40);
  if (!limpio) return { ok: false, error: 'hace falta un nombre' };
  const clave = limpio.toLowerCase();
  if (batalla.luchadores.some((l) => l.clave === clave)) return { ok: false, error: 'ya estabas apuntado' };

  batalla.luchadores.push({ nombre: limpio, clave });
  apuntarEnDisco(uid);
  return { ok: true };
}

function barajar<T>(lista: T[]): T[] {
  const a = lista.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Las clases de Dofus con las que se puede pelear. Se sortean aqui y no en la
// pagina para que todo el que mire vea la misma clase en cada luchador.
const CLASES_DOFUS = [
  'Yopuka', 'Ocra', 'Xelor', 'Anutrof', 'Zurcarák', 'Feca',
  'Sram', 'Sadida', 'Osamodas', 'Aniripsa', 'Sacrógrito', 'Pandawa', 'Uginak',
  'Zobal', 'Selotrop'
];

// Las que se sortean de verdad: las que tienen imagen puesta por el dueño en su
// carpeta de datos (yopuka.png, ocra.png…). Si no hay ninguna, todas.
function clasesEnJuego(): string[] {
  const conArte = (deps.clasesConArte ? deps.clasesConArte() : []).filter((c) => CLASES_DOFUS.includes(c));
  return conArte.length ? conArte : CLASES_DOFUS;
}

// Una clase al azar de las que estan en juego. La usa tambien el rey de la
// colina, que reparte clase igual que aqui.
export function sortearClase(): string {
  const enJuego = clasesEnJuego();
  return enJuego[Math.floor(Math.random() * enJuego.length)];
}

// A cada luchador le toca una clase al azar, para todo el torneo.
function sortearClases(luchadores: Luchador[]): Luchador[] {
  const enJuego = clasesEnJuego();
  return luchadores.map((l) => ({
    ...l,
    clase: enJuego[Math.floor(Math.random() * enJuego.length)]
  }));
}

// Empareja a los que quedan. Si son impares, uno pasa de ronda sin pelear.
function emparejar(nombres: string[], numero: number): Ronda {
  const orden = barajar(nombres);
  const duelos: Duelo[] = [];
  for (let i = 0; i < orden.length; i += 2) {
    // El ultimo, si sobra, pasa directo: su duelo ya viene resuelto.
    if (i + 1 >= orden.length) duelos.push({ a: orden[i], b: '', ganador: orden[i], golpes: [] });
    else duelos.push({ a: orden[i], b: orden[i + 1], ganador: '', golpes: [] });
  }
  return { numero, duelos };
}

// Cierra la inscripcion y monta la primera ronda.
export function empezar(uid: string): Batalla | null {
  const batalla = batallas.get(uid);
  if (!batalla || !batalla.abierta || batalla.luchadores.length < 2) return null;
  batalla.abierta = false;
  cerrarEscucha(uid);
  crono.quitar(uid);
  batalla.luchadores = sortearClases(batalla.luchadores);
  batalla.rondas = [emparejar(batalla.luchadores.map((l) => l.nombre), 1)];
  apuntarEnDisco(uid);
  return batalla;
}

// Otro torneo con los mismos luchadores. El cuadro se sortea de nuevo, asi
// que no repite los mismos duelos: va directo a la primera ronda.
export function repetir(uid: string): Batalla | null {
  const anterior = batallas.get(uid);
  if (!anterior || anterior.luchadores.length < 2) return null;
  const nueva: Batalla = {
    abierta: false,
    // Mismos luchadores, pero cada uno con otra clase al azar.
    luchadores: sortearClases(anterior.luchadores),
    rondas: [],
    campeon: '',
    puntos: leerAjustes(uid).puntos
  };
  nueva.rondas = [emparejar(nueva.luchadores.map((l) => l.nombre), 1)];
  batallas.set(uid, nueva);
  apuntarEnDisco(uid);
  return nueva;
}

// El combate: los dos empiezan con la misma vida y se turnan a golpes hasta
// que uno cae. Quien empieza se sortea, para que empezar no de ventaja: con
// las mismas reglas para los dos, cada uno gana la mitad de las veces.
// Lo que hace que una pelea no se sepa de antemano:
// - se falla, y el turno perdido lo cambia todo;
// - se repite golpe, asi que empezar no da la ventaja que daba;
// - contra las cuerdas se pega mas fuerte, que es de donde salen las remontadas.
const ESQUIVA = 0.16;
const CRITICO = 0.15;
const REPETIR = 0.2;
const CUERDAS = 30;   // vida a partir de la cual entra la furia
const AGUANTE = 0.22; // de librarse del golpe final, una vez por pelea

function pelear(duelo: Duelo): void {
  const vidas: Record<string, number> = { [duelo.a]: VIDA, [duelo.b]: VIDA };
  let turno = Math.random() < 0.5 ? duelo.a : duelo.b;
  // Cada uno se libra como mucho una vez: si no, la pelea no acabaria nunca.
  const aguante: Record<string, boolean> = { [duelo.a]: true, [duelo.b]: true };
  duelo.golpes = [];

  // Un tope por si acaso: con este dano no se llega ni de lejos, pero mas vale
  // que se corte a que se quede dando vueltas para siempre.
  for (let i = 0; i < 200; i++) {
    const otro = turno === duelo.a ? duelo.b : duelo.a;
    const fallo = Math.random() < ESQUIVA;
    const critico = !fallo && Math.random() < CRITICO;
    const furia = !fallo && vidas[turno] <= CUERDAS;
    let dano = 0;
    if (!fallo) {
      dano = Math.floor(6 + Math.random() * 17);
      if (critico) dano *= 2;
      if (furia) dano = Math.round(dano * 1.5);
    }
    vidas[otro] = Math.max(0, vidas[otro] - dano);
    // El que deberia caer a veces se queda en pie por los pelos. De aqui salen
    // las peleas que parecian sentenciadas y no lo estaban.
    const aguanta = vidas[otro] <= 0 && aguante[otro] && Math.random() < AGUANTE;
    if (aguanta) { vidas[otro] = 1; aguante[otro] = false; }

    duelo.golpes.push({
      quien: turno,
      a: otro,
      ataque: ATAQUES[Math.floor(Math.random() * ATAQUES.length)],
      dano,
      critico,
      fallo,
      furia,
      aguanta,
      vidaA: vidas[duelo.a],
      vidaB: vidas[duelo.b]
    });

    if (vidas[otro] <= 0) { duelo.ganador = turno; return; }
    // A veces no se suelta el turno: es lo que quita la ventaja de empezar.
    if (Math.random() >= REPETIR) turno = otro;
  }
  // Si por lo que sea no ha caido ninguno, gana el que mas vida tenga.
  duelo.ganador = vidas[duelo.a] >= vidas[duelo.b] ? duelo.a : duelo.b;
}

// Un combate suelto entre dos, con estas mismas reglas. Lo usa el rey de la
// colina: alli no hay cuadro ni rondas, pero la pelea es la misma, y dos
// motores de combate serian dos sitios que tocar cada vez que se cambie una.
export function pelearSueltos(a: string, b: string): Duelo {
  const duelo: Duelo = { a, b, ganador: '', golpes: [] };
  pelear(duelo);
  return duelo;
}

// La ronda que esta por pelear, si la hay.
function rondaPendiente(uid: string): { batalla: Batalla; ronda: Ronda } | null {
  const batalla = batallas.get(uid);
  if (!batalla || batalla.abierta || batalla.campeon) return null;
  const ronda = batalla.rondas[batalla.rondas.length - 1];
  if (!ronda || ronda.duelos.every((d) => d.ganador)) return null;
  return { batalla, ronda };
}

// Con la ronda entera peleada: o hay campeon, o se monta la siguiente. Se
// llama tanto al resolverla de golpe como al resolver el ultimo duelo suelto.
function cerrarRonda(uid: string, batalla: Batalla, ronda: Ronda): void {
  const siguen = ronda.duelos.map((d) => d.ganador);
  if (siguen.length === 1) {
    batalla.campeon = siguen[0];
    // Se mira el ajuste ahora, no el de cuando se abrio el torneo: asi se
    // puede cambiar el premio con la batalla ya en marcha.
    const premio = leerAjustes(uid).puntos;
    batalla.puntos = premio;
    if (premio > 0) deps.sumarPuntos(uid, batalla.campeon, premio);
  } else {
    batalla.rondas.push(emparejar(siguen, batalla.rondas.length + 1));
  }
}

// Resuelve la ronda pendiente y, si queda mas de uno, monta la siguiente.
// Devuelve null si no habia nada que resolver.
export function resolverRonda(uid: string): Batalla | null {
  const pendiente = rondaPendiente(uid);
  if (!pendiente) return null;
  const { batalla, ronda } = pendiente;

  for (const duelo of ronda.duelos) {
    // Los pases de ronda, y los que ya se hayan peleado sueltos.
    if (duelo.ganador) continue;
    pelear(duelo);
  }

  cerrarRonda(uid, batalla, ronda);
  apuntarEnDisco(uid);
  return batalla;
}

// Pelea un solo combate de la ronda, el que se diga. Sirve para ir soltandolos
// de uno en uno en directo en vez de todos a la vez; la ronda no avanza hasta
// que estan todos peleados, se hayan soltado como se hayan soltado.
export function resolverDuelo(uid: string, cual: number): Batalla | null {
  const pendiente = rondaPendiente(uid);
  if (!pendiente) return null;
  const { batalla, ronda } = pendiente;

  const duelo = ronda.duelos[cual];
  // Ni uno que no existe, ni uno ya peleado, ni un pase de ronda.
  if (!duelo || duelo.ganador || !duelo.b) return null;
  pelear(duelo);

  if (ronda.duelos.every((d) => d.ganador)) cerrarRonda(uid, batalla, ronda);
  apuntarEnDisco(uid);
  return batalla;
}
