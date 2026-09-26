import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import * as twitch from './twitch';
import * as carrera from './carrera';
import * as juegos from './juegos';
import * as plinko from './plinko';
import * as excel from './excel';
import * as estadisticas from './estadisticas';
import * as batalla from './batalla';
import * as colina from './colina';
import * as ruletachat from './ruletachat';
import * as catalogo from './catalogo';
import * as widget from './widget';
import * as avisos from './avisos';
import * as json from './json';
import * as arte from './arte';
import * as sorteo from './sorteo';
import * as minijuegos from './rutas/minijuegos';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
// Publicado detras de un proxy (Render, Fly, nginx...): asi req.protocol dice
// https y la cookie de sesion puede ir marcada como segura.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(cors());
// El limite por defecto (100kb) no admite la subida de una imagen de fondo.
app.use(express.json({ limit: '16mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
// Los catalogos de objetos (que juego, de donde se bajan y como se traducen al
// formato comun) viven en juegos.ts. Cada juego tiene sus catalogos: recursos
// (lo que se sortea), equipables y cosmeticos (de consulta y de regalar). Los
// ankama_id se repiten entre familias y entre juegos, asi que no se mezclan.
// Donde viven los datos. En un hosting, cada despliegue reemplaza la carpeta
// de la aplicacion, asi que si los datos estan dentro se pierden en cada
// deploy: con RULETON_DATA se apuntan a una ruta de fuera, que sobrevive.
const DATA_DIR = process.env.RULETON_DATA
  ? path.resolve(process.env.RULETON_DATA)
  : path.join(process.cwd(), 'data');
// Cada catalogo se cachea en disco por separado (ver juegos.ts).
function catalogoFile(juego: juegos.Juego, familia: juegos.Familia): string {
  return path.join(DATA_DIR, juegos.archivoCache(juego, familia));
}
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_DIR = path.join(DATA_DIR, 'users');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
// Codigo de invitacion de arranque: solo siembra data/config.json la primera
// vez. A partir de ahi manda el panel de administracion, que es donde el dueno
// lo cambia sin reiniciar el servidor.
const INVITE_INICIAL = String(process.env.RULETON_INVITE || '').trim();
const COOKIE_NAME = 'ruleton_sid';
const SESSION_DAYS = 30;
// Los fondos y avatares que se suben son datos del usuario, no del programa:
// van junto al resto para que tampoco se los lleve un despliegue.
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
// Las imagenes que vienen con el proyecto (kama.png, fondo.png) siguen en el
// repositorio; se sirven como respaldo cuando no hay una subida con ese nombre.
const ASSETS_REPO = path.join(process.cwd(), 'public', 'assets');

// Cada usuario tiene su propio Ruleton: su aspecto, sus servidores, sus
// ganadores y su historial, y nadie mas los ve. Dentro de un usuario, los
// precios cambian de un servidor de Dofus a otro, asi que rarezas, ganadores y
// ranking se guardan por servidor. Las exclusiones no: un objeto que no quieres
// sortear no lo quieres en ningun servidor, asi que hay una sola lista por
// usuario. Lo unico comun a todos es el catalogo de objetos, que es una copia
// de la API de Dofus.
const SERVER_FILES = ['tags', 'winners', 'ranking', 'stream', 'ratios'] as const;
type ServerFile = typeof SERVER_FILES[number];

interface GameServer {
  id: string;
  name: string;
}

interface User {
  id: string;
  username: string;      // en minusculas, es con lo que se entra
  name: string;          // como se escribio, para saludar
  avatarUrl?: string;    // foto de la cuenta (vacio = iniciales)
  twitchCanal?: string;  // su canal, para los minijuegos que leen el chat
  salt: string;
  hash: string;          // scrypt de la contrasena; nunca se guarda en claro
  createdAt: string;
  admin?: boolean;       // entra al panel de acceso y decide quien usa la web
  bloqueado?: boolean;   // conserva sus datos, pero no puede entrar
}

// Ajustes del sitio, comunes a todas las cuentas. Solo los toca el admin.
interface Config {
  invite: string;        // codigo para crear cuenta; vacio = registros cerrados
}

interface Session {
  uid: string;
  expiresAt: number;     // epoch en ms
}

const DEFAULT_SERVER: GameServer = { id: 'principal', name: 'Principal' };


function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Guardar un JSON sin poder dejarlo a medias: se escribe entero en un archivo
// temporal y se renombra encima, que es una operacion atomica. Si el proceso
// muere en mitad de la escritura, el archivo bueno sigue intacto.
// Toda escritura de datos pasa por aqui, tambien la de los minijuegos, que la
// reciben como dependencia. Por eso json.ts puede dar por hecho que lo que
// guarda deja de valer en cuanto alguien escribe. Ver json.ts.
function writeJson(file: string, data: unknown): void {
  json.escribir(file, data);
}


function userDir(uid: string): string {
  return path.join(USERS_DIR, uid);
}

function settingsFile(uid: string): string {
  return path.join(userDir(uid), 'settings.json');
}

function serversFile(uid: string, juego: juegos.Juego): string {
  return path.join(juegoDir(uid, juego), 'servers.json');
}

// Cada juego tiene sus cosas aparte: sus servidores, sus rarezas, sus ganadores
// y sus exclusiones. Tiene que ser asi porque los catalogos son distintos: un
// mismo ankama_id no es el mismo objeto en un juego y en otro, asi que una
// lista compartida excluiria cualquier cosa.
function juegoDir(uid: string, juego: juegos.Juego): string {
  return path.join(userDir(uid), 'juegos', juego);
}

// Las exclusiones son del juego entero, no de un servidor suyo.
function exclusionsFile(uid: string, juego: juegos.Juego): string {
  return path.join(juegoDir(uid, juego), 'exclusions.json');
}

// Los retoques del catalogo (anadidos, cambios y borrados) van al lado de las
// exclusiones y por el mismo motivo: son del juego entero, porque un mismo
// ankama_id no es el mismo objeto en un juego y en otro.
function retoquesFile(uid: string, juego: juegos.Juego): string {
  return path.join(juegoDir(uid, juego), 'catalogo.json');
}

function leerRetoques(uid: string, juego: juegos.Juego): catalogo.Retoques {
  return catalogo.leer(retoquesFile(uid, juego));
}

function guardarRetoques(uid: string, juego: juegos.Juego, r: catalogo.Retoques): void {
  const dir = juegoDir(uid, juego);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(retoquesFile(uid, juego), r);
}

// Todo lo que habia antes (servers.json, servers/, exclusions.json) era de un
// solo juego, el unico que habia: Dofus. Al separar por juego se mete tal cual
// en juegos/dofus3/, que es donde lo buscara a partir de ahora. Se mueve, no se
// copia, y solo pasa una vez: en cuanto existe la carpeta del juego no se
// vuelve a entrar.
function migrarAJuegoPorDefecto(uid: string): void {
  const destino = juegoDir(uid, juegos.JUEGO_POR_DEFECTO);
  if (fs.existsSync(destino)) return;
  const base = userDir(uid);
  const sueltos = ['servers.json', 'servers', 'exclusions.json']
    .map((n) => [path.join(base, n), path.join(destino, n)] as const)
    .filter(([viejo]) => fs.existsSync(viejo));
  if (!sueltos.length) return;
  try {
    fs.mkdirSync(destino, { recursive: true });
    for (const [viejo, nuevo] of sueltos) fs.renameSync(viejo, nuevo);
    console.log(`Migrados ${sueltos.length} dato(s) del usuario ${uid} -> juego ${juegos.JUEGO_POR_DEFECTO}`);
  } catch (err) {
    console.error('Failed to migrate user data to default game:', err);
  }
}

function ensureJuegoDir(uid: string, juego: juegos.Juego): void {
  ensureUserDir(uid);
  migrarAJuegoPorDefecto(uid);
  const dir = juegoDir(uid, juego);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureUserDir(uid: string): void {
  ensureDataDir();
  const dir = userDir(uid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Ambito de una peticion: "<usuario>/<juego>/<servidor>". Se pasa entero a los
// lectores y escritores de datos, que solo lo usan para componer su ruta.
// Se admite tambien el de antes ("<usuario>/<servidor>", sin juego): lo traen
// los canjes de Twitch guardados de antes del cambio, y se quedan en Dofus.
function partirAmbito(ambito: string): { uid: string; juego: juegos.Juego; sid: string } {
  const trozos = ambito.split('/');
  const uid = trozos[0] ?? '';
  if (trozos.length < 3) {
    return { uid, juego: juegos.JUEGO_POR_DEFECTO, sid: trozos[1] || DEFAULT_SERVER.id };
  }
  return {
    uid,
    juego: juegos.normalizar(trozos[1]),
    sid: trozos.slice(2).join('/') || DEFAULT_SERVER.id
  };
}

function serverDir(ambito: string): string {
  const { uid, juego, sid } = partirAmbito(ambito);
  return path.join(juegoDir(uid, juego), 'servers', sid);
}

function serverFile(ambito: string, name: ServerFile): string {
  return path.join(serverDir(ambito), `${name}.json`);
}

function ensureServerDir(ambito: string): void {
  ensureDataDir();
  const dir = serverDir(ambito);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Un id de carpeta seguro a partir del nombre escrito por el usuario.
function slugify(name: string): string {
  const base = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `servidor-${Date.now()}`;
}

function readUsers(): User[] {
  ensureDataDir();
  try {
    if (fs.existsSync(USERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      const list = Array.isArray(parsed?.users) ? parsed.users : parsed;
      if (Array.isArray(list)) {
        return list.filter((u: any) => u && typeof u.id === 'string' && typeof u.username === 'string');
      }
    }
  } catch (err) {
    console.error('Failed to read users:', err);
  }
  return [];
}

function writeUsers(users: User[]): void {
  ensureDataDir();
  writeJson(USERS_FILE, { users });
}

// La configuracion nace del entorno la primera vez y a partir de ahi vive en
// data/config.json, que es lo que edita el panel de acceso.
function readConfig(): Config {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return { invite: typeof parsed.invite === 'string' ? parsed.invite : '' };
      }
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return { invite: INVITE_INICIAL };
}

function writeConfig(config: Config): void {
  ensureDataDir();
  writeJson(CONFIG_FILE, config);
}

// El codigo que hay que escribir para crear cuenta. Vacio = registros cerrados.
function inviteActual(): string {
  return readConfig().invite.trim();
}

// Sin admin no hay quien abra el panel, asi que la cuenta mas antigua lo es.
// Cubre las instalaciones anteriores a esta version y el caso de que alguien
// borre la marca a mano en users.json.
function asegurarAdmin(): void {
  const users = readUsers();
  if (users.length === 0 || users.some((u) => u.admin)) return;
  const masAntiguo = users.slice().sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
  masAntiguo.admin = true;
  masAntiguo.bloqueado = false;
  writeUsers(users);
  console.log(`La cuenta "${masAntiguo.username}" pasa a ser la administradora.`);
}

// La contrasena se guarda derivada con scrypt y una sal distinta por cuenta:
// del fichero no se puede sacar la original.
function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Contrasena temporal legible: se dicta por telefono sin equivocarse y no
// lleva teclas muertas, que en teclado espanol son una fuente de errores.
function generarPassword(): string {
  const abc = '23456789BCDFGHJKMNPQRSTVWXYZ';
  const azar = crypto.randomBytes(16);
  const letras = Array.from(azar, (n) => abc[n % abc.length]);
  return `${letras.slice(0, 4).join('')}-${letras.slice(4, 8).join('')}-${letras.slice(8, 12).join('')}-${letras.slice(12, 16).join('')}`;
}

function passwordOk(user: User, password: string): boolean {
  const esperado = Buffer.from(user.hash, 'hex');
  const recibido = Buffer.from(hashPassword(password, user.salt), 'hex');
  // Comparacion en tiempo constante: no delata cuanto acerto quien lo intenta.
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

function readSessions(): Record<string, Session> {
  ensureDataDir();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to read sessions:', err);
  }
  return {};
}

function writeSessions(sessions: Record<string, Session>): void {
  ensureDataDir();
  writeJson(SESSIONS_FILE, sessions);
}

function crearSesion(uid: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = readSessions();
  const ahora = Date.now();
  // De paso se tiran las caducadas, que si no el fichero crece sin fin.
  for (const [t, ses] of Object.entries(sessions)) {
    if (!ses || ses.expiresAt < ahora) delete sessions[t];
  }
  sessions[token] = { uid, expiresAt: ahora + SESSION_DAYS * 24 * 60 * 60 * 1000 };
  writeSessions(sessions);
  return token;
}

function borrarSesion(token: string): void {
  const sessions = readSessions();
  if (sessions[token]) {
    delete sessions[token];
    writeSessions(sessions);
  }
}

function leerCookie(req: Request, nombre: string): string {
  const cabecera = String(req.headers?.cookie || '');
  for (const trozo of cabecera.split(';')) {
    const corte = trozo.indexOf('=');
    if (corte < 0) continue;
    if (trozo.slice(0, corte).trim() === nombre) {
      return decodeURIComponent(trozo.slice(corte + 1).trim());
    }
  }
  return '';
}

// Usuario de la peticion, o cadena vacia si no hay sesion valida.
// Quien pregunta. Se llama en cada peticion (el middleware) y otra vez dentro
// del handler (requireUid), asi que va por el cachito y no al disco: lo que
// devuelve es de solo mirar y esta congelado. Ver json.ts.
function usuarioDe(req: Request): User | null {
  const token = leerCookie(req, COOKIE_NAME);
  if (!token) return null;
  ensureDataDir();
  const sesiones = json.leer<Record<string, Session>>(SESSIONS_FILE);
  const ses = sesiones && !Array.isArray(sesiones) ? sesiones[token] : undefined;
  if (!ses || ses.expiresAt < Date.now()) return null;
  const guardados = json.leer<{ users?: User[] } | User[]>(USERS_FILE);
  const lista = Array.isArray(guardados) ? guardados : (guardados?.users || []);
  // La misma comprobacion que hace readUsers: una linea a medias en el archivo
  // no puede colarse como una cuenta, que de ahi salen usuarios sin nombre.
  const user = lista.find((u) =>
    u && typeof u.id === 'string' && typeof u.username === 'string' && u.id === ses.uid) || null;
  // Quitar el acceso surte efecto ya: la sesion que tuviera abierta deja de
  // valer sin esperar a que caduque la cookie.
  return user && !user.bloqueado ? user : null;
}

// Cierra todas las sesiones de una cuenta. Devuelve cuantas ha tirado.
function borrarSesionesDe(uid: string): number {
  const sessions = readSessions();
  let tiradas = 0;
  for (const [token, ses] of Object.entries(sessions)) {
    if (ses && ses.uid === uid) { delete sessions[token]; tiradas += 1; }
  }
  if (tiradas) writeSessions(sessions);
  return tiradas;
}

// Las subidas vivian en public/assets. Se llevan junto al resto de datos la
// primera vez, para no perder el fondo ni los avatares ya puestos. Solo las
// subidas: las imagenes del repositorio (fondo.png, kama.png) se quedan.
function migrarAssetsSubidos(): void {
  if (ASSETS_DIR === ASSETS_REPO || !fs.existsSync(ASSETS_REPO)) return;
  let movidas = 0;
  for (const nombre of fs.readdirSync(ASSETS_REPO)) {
    if (!/^(fondo|avatar)-/.test(nombre)) continue;
    const destino = path.join(ASSETS_DIR, nombre);
    if (fs.existsSync(destino)) continue;
    try {
      if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
      fs.renameSync(path.join(ASSETS_REPO, nombre), destino);
      movidas += 1;
    } catch (err) {
      console.error(`Failed to migrate asset ${nombre}:`, err);
    }
  }
  if (movidas) console.log(`Movidas ${movidas} imagenes subidas a ${ASSETS_DIR}`);
}

// Instalaciones anteriores al login: el Ruleton que ya existiera pasa a ser el
// de la primera cuenta que se registre, que es la del dueno del equipo.
function migrarRuletonExistente(uid: string): void {
  ensureUserDir(uid);
  const mover = (origen: string, destino: string) => {
    if (!fs.existsSync(origen) || fs.existsSync(destino)) return;
    try {
      fs.renameSync(origen, destino);
      console.log(`Migrado ${path.basename(origen)} -> data/users/${uid}/`);
    } catch (err) {
      console.error(`Failed to migrate ${origen}:`, err);
    }
  };
  // Version con perfiles (data/profiles/principal) y version anterior (data/).
  const viejoPerfil = path.join(DATA_DIR, 'profiles', 'principal');
  const base = fs.existsSync(viejoPerfil) ? viejoPerfil : DATA_DIR;
  mover(path.join(base, 'settings.json'), settingsFile(uid));
  // A la ruta de antes del reparto por juegos, a proposito: de ahi los recoge
  // migrarAJuegoPorDefecto y los deja en el juego de siempre.
  mover(path.join(base, 'servers.json'), path.join(userDir(uid), 'servers.json'));
  mover(path.join(base, 'servers'), path.join(userDir(uid), 'servers'));
  fs.rmSync(path.join(DATA_DIR, 'profiles'), { recursive: true, force: true });
  fs.rmSync(path.join(DATA_DIR, 'profiles.json'), { force: true });
}

function readServers(uid: string, juego: juegos.Juego): GameServer[] {
  ensureJuegoDir(uid, juego);
  try {
    if (fs.existsSync(serversFile(uid, juego))) {
      const parsed = JSON.parse(fs.readFileSync(serversFile(uid, juego), 'utf8'));
      const list = Array.isArray(parsed?.servers) ? parsed.servers : parsed;
      if (Array.isArray(list)) {
        const clean = list
          .filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string')
          .map((s: any) => ({ id: String(s.id), name: String(s.name) }));
        if (clean.length) return clean;
      }
    }
  } catch (err) {
    console.error('Failed to read servers:', err);
  }
  // Primera vez: se crea el servidor por defecto y se le adjudican los datos
  // que ya existieran sueltos (instalaciones anteriores).
  const servers = [DEFAULT_SERVER];
  writeServers(uid, juego, servers);
  migrarDatosSueltos(uid, juego, DEFAULT_SERVER.id);
  return servers;
}

function writeServers(uid: string, juego: juegos.Juego, servers: GameServer[]): void {
  ensureJuegoDir(uid, juego);
  writeJson(serversFile(uid, juego), { servers });
}

function migrarDatosSueltos(uid: string, juego: juegos.Juego, sid: string): void {
  const ambito = `${uid}/${juego}/${sid}`;
  ensureServerDir(ambito);
  for (const name of SERVER_FILES) {
    const viejo = path.join(juegoDir(uid, juego), `${name}.json`);
    const nuevo = serverFile(ambito, name);
    if (fs.existsSync(viejo) && !fs.existsSync(nuevo)) {
      try {
        fs.renameSync(viejo, nuevo);
        console.log(`Migrado ${name}.json -> usuario ${uid}, juego ${juego}, servidor ${sid}`);
      } catch (err) {
        console.error(`Failed to migrate ${name}.json:`, err);
      }
    }
  }
}

// Ambito de la peticion: el usuario de la sesion mas su servidor (?server=).
// El usuario NUNCA viene del cliente: sale de la cookie de sesion, asi que
// nadie puede pedir los datos de otro cambiando un parametro.
function resolveServer(req: Request): string {
  const uid = requireUid(req);
  const juego = juegoDe(req);
  const servers = readServers(uid, juego);
  const pedido = String((req.query?.server ?? (req.body as any)?.server ?? '')).trim();
  const encontrado = servers.find((s) => s.id === pedido);
  return `${uid}/${juego}/${encontrado ? encontrado.id : servers[0].id}`;
}

// El juego que pide la peticion (?juego=). Si no lo dice o dice algo raro, el
// de siempre: asi una pagina vieja en una pestana abierta sigue funcionando.
function juegoDe(req: Request): juegos.Juego {
  return juegos.normalizar(req.query?.juego ?? (req.body as any)?.juego);
}

// Un catalogo de objetos: se baja una vez y se deja en disco, que son varios
// miles y no cambian de un dia para otro. De donde se baja y como se traduce al
// formato comun lo decide juegos.ts, asi que aqui da igual de que juego sea.
async function fetchCatalogBruto(juego: juegos.Juego, familia: juegos.Familia): Promise<any[]> {
  ensureDataDir();
  const file = catalogoFile(juego, familia);
  const que = `${familia} de ${juego}`;
  const leerCache = (): any[] | null => {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.error(`Failed to read cached ${que}:`, err);
    }
    return null;
  };

  const cache = leerCache();
  if (cache) return cache;

  const fuente = juegos.fuente(juego, familia);
  // Hay familias que un juego puede no tener: eso no es un fallo, es un
  // catalogo vacio.
  if (!fuente.url) return [];
  try {
    const res = await axios.get(fuente.url, { timeout: 20000 });
    // Cada fuente sabe sacar su lista y traducir sus objetos al formato comun.
    // Los que no se pueden traducir (sin id o sin nombre) se quedan fuera: un
    // objeto sin id no se podria ni excluir ni marcar.
    const items = fuente.lista(res.data).map((x: any) => fuente.normaliza(x)).filter(Boolean);
    if (items.length === 0) {
      console.warn(`Remote ${que} response did not contain items; returning empty array`);
      return [];
    }
    try {
      writeJson(file, items);
    } catch (err) {
      console.warn(`Failed to write ${que} cache:`, err);
    }
    return items;
  } catch (err) {
    console.error(`Failed to fetch ${que} from remote API:`, err);
    // Si falla la descarga pero hay copia en disco, se devuelve esa.
    return leerCache() ?? [];
  }
}

// El catalogo de un juego tal como esta en disco, sin bajar nada. Se usa para
// traducir Touch: pedir el catalogo de Dofus de verdad obligaria a una
// descarga en una peticion que no es suya, y si no esta bajado, no se traduce
// y ya esta.
function catalogoDeDisco(juego: juegos.Juego, familia: juegos.Familia): any[] {
  try {
    const f = catalogoFile(juego, familia);
    if (!fs.existsSync(f)) return [];
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read catalog from disk:', err);
    return [];
  }
}

// Los recursos de Touch, ya traducidos, guardados en memoria. Recorrer los
// 3639 de Dofus en cada peticion seria tonto: se rehace solo si alguno de los
// dos archivos ha cambiado en disco.
let touchTraducido: { sello: string; items: any[] } | null = null;

function selloDe(juego: juegos.Juego, familia: juegos.Familia): string {
  try {
    return String(fs.statSync(catalogoFile(juego, familia)).mtimeMs);
  } catch {
    return '0';
  }
}

// Touch se sirve en espanol siempre que se pueda, emparejando por ankama_id
// con el catalogo de Dofus. Lo de fuera no se entera: le llega el mismo
// formato de siempre, con los nombres ya cambiados.
async function fetchCatalogCached(juego: juegos.Juego, familia: juegos.Familia): Promise<any[]> {
  const items = await fetchCatalogBruto(juego, familia);
  if (juego !== 'touch' || familia !== 'resources' || !items.length) return items;

  const sello = selloDe('touch', 'resources') + '|' + selloDe(juegos.JUEGO_POR_DEFECTO, 'resources');
  if (touchTraducido?.sello === sello) return touchTraducido.items;

  const deDofus = catalogoDeDisco(juegos.JUEGO_POR_DEFECTO, 'resources');
  const traducidos = juegos.traducirRecursos(items, deDofus);
  touchTraducido = { sello, items: traducidos };
  if (deDofus.length) {
    console.log(`Touch en espanol: ${juegos.cuantosTraducidos(traducidos)} de ${traducidos.length} recursos`);
  }
  return traducidos;
}

// Lo que se sortea.
async function fetchItemsCached(juego: juegos.Juego): Promise<any[]> {
  return fetchCatalogCached(juego, 'resources');
}

// Lo que se sortea, tal como lo ve UN usuario: el catalogo descargado con sus
// retoques encima. Todo lo que mire recursos pasa por aqui (la pagina, el
// sorteo y los canjes de Twitch), que si no se podria sortear un objeto que el
// usuario habia borrado.
async function itemsDe(uid: string, juego: juegos.Juego): Promise<any[]> {
  return catalogo.aplicar(await fetchItemsCached(juego), leerRetoques(uid, juego));
}

// Los equipables: catalogo aparte, que no toca al sorteo.
async function fetchEquipmentCached(juego: juegos.Juego): Promise<any[]> {
  return fetchCatalogCached(juego, 'equipment');
}

// Antes cada servidor guardaba sus exclusiones. Al pasar a una sola lista por
// usuario se juntan las que hubiera en cada servidor y los archivos viejos se
// borran, asi que esto solo hace algo la primera vez.
function migrarExclusionesDeServidores(uid: string, juego: juegos.Juego): void {
  const raiz = path.join(juegoDir(uid, juego), 'servers');
  if (fs.existsSync(exclusionsFile(uid, juego)) || !fs.existsSync(raiz)) return;
  const juntas = new Set<string>();
  const viejos: string[] = [];
  try {
    for (const sid of fs.readdirSync(raiz)) {
      const f = path.join(raiz, sid, 'exclusions.json');
      if (!fs.existsSync(f)) continue;
      viejos.push(f);
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(parsed)) parsed.forEach((id) => juntas.add(String(id)));
    }
    if (!viejos.length) return;
    writeJson(exclusionsFile(uid, juego), Array.from(juntas));
    // Los archivos viejos se quedan donde estan: ya no se leen (la migracion
    // no vuelve a entrar en cuanto existe el del usuario), pero son la unica
    // copia de una lista que puede costar horas de rehacer.
    console.log(`Migradas ${juntas.size} exclusion(es) de ${viejos.length} servidor(es) -> usuario ${uid}, juego ${juego}`);
  } catch (err) {
    console.error('Failed to migrate exclusions:', err);
  }
}

function readExclusions(ambito: string): string[] {
  const { uid, juego } = partirAmbito(ambito);
  ensureJuegoDir(uid, juego);
  migrarExclusionesDeServidores(uid, juego);
  try {
    const f = exclusionsFile(uid, juego);
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch (err) {
    console.error('Failed to read exclusions:', err);
  }
  return [];
}

function writeExclusions(ambito: string, ids: string[]): void {
  const { uid, juego } = partirAmbito(ambito);
  ensureJuegoDir(uid, juego);
  migrarExclusionesDeServidores(uid, juego);
  writeJson(exclusionsFile(uid, juego), ids);
}

// Las rarezas son colores, sin nombre: gris, azul, morado y rojo. Un objeto
// sin marcar es comun (gris), que es el color por defecto.
type Rarity = 'common' | 'rare' | 'epic' | 'mythic';
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'mythic'];

type Tags = Record<string, Rarity>;

// Cuanto sale cada color en el sorteo. No hace falta que sumen 100: cuenta lo
// que pesa cada uno frente a los demas, como en los paquetones.
type Ratios = Record<Rarity, number>;
const RATIOS_POR_DEFECTO: Ratios = { common: 70, rare: 20, epic: 8, mythic: 2 };

function readRatios(ambito: string): Ratios {
  ensureServerDir(ambito);
  try {
    const f = serverFile(ambito, 'ratios');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        const salida = { ...RATIOS_POR_DEFECTO };
        for (const r of RARITIES) {
          const n = Number(parsed[r]);
          if (Number.isFinite(n) && n >= 0) salida[r] = Math.min(100, n);
        }
        return salida;
      }
    }
  } catch (err) {
    console.error('Failed to read ratios:', err);
  }
  return { ...RATIOS_POR_DEFECTO };
}

function writeRatios(ambito: string, ratios: Ratios): void {
  ensureServerDir(ambito);
  writeJson(serverFile(ambito, 'ratios'), ratios);
}

function readTags(sid: string): Tags {
  ensureServerDir(sid);
  try {
    const f = serverFile(sid, 'tags');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Tags;
    }
  } catch (err) {
    console.error('Failed to read tags:', err);
  }
  return {};
}

function writeTags(sid: string, tags: Tags): void {
  ensureServerDir(sid);
  writeJson(serverFile(sid, 'tags'), tags);
}

interface Settings {
  pageTitle: string;        // titulo de la cabecera y de la pestana
  pageSubtitle: string;     // lema bajo el titulo (vacio = no se muestra)
  logoUrl: string;          // imagen junto al titulo (vacio = sin logo)
  backgroundUrl: string;
  wheelUrl: string;      // vacio = ruleta de colores por defecto
  showWheel: boolean;    // se mantiene por compatibilidad con datos antiguos
  animation: 'slot' | 'wheel' | 'none';
  accentColor: string;
  accentColor2: string;
  overlayOpacity: number;
  wheelScale: number;       // tamano de la ruleta (1 = normal)
  slotScale: number;        // tamano de la tragaperras (1 = normal)
  fontScale: number;        // tamano de la letra de la pagina (1 = normal)
}

const DEFAULT_SETTINGS: Settings = {
  pageTitle: 'Sorteos - Demo',
  pageSubtitle: 'Sorteos de recursos de Dofus',
  logoUrl: '',
  backgroundUrl: '/assets/fondo.png',
  wheelUrl: '',
  showWheel: true,
  animation: 'slot',
  accentColor: '#6ee7b7',
  accentColor2: '#3ee9c0',
  overlayOpacity: 0.55,
  wheelScale: 1,
  slotScale: 1,
  fontScale: 1
};

function readSettings(uid: string): Settings {
  ensureUserDir(uid);
  try {
    if (fs.existsSync(settingsFile(uid))) {
      const parsed = JSON.parse(fs.readFileSync(settingsFile(uid), 'utf8'));
      const settings: Settings = { ...DEFAULT_SETTINGS, ...parsed };
      // Ajustes guardados antes de que existiera 'animation': se deduce de los
      // campos antiguos para no cambiarle el comportamiento a quien ya lo tenia.
      // Antes habia un unico tamano para ambas animaciones.
      if (typeof parsed.animationScale === 'number' && parsed.wheelScale === undefined) {
        settings.wheelScale = parsed.animationScale;
        settings.slotScale = parsed.animationScale;
      }
      if (!parsed.animation) {
        settings.animation = parsed.showWheel === false ? 'none' : (parsed.wheelUrl ? 'wheel' : 'slot');
      }
      return settings;
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(uid: string, settings: Settings): void {
  ensureUserDir(uid);
  writeJson(settingsFile(uid), settings);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface Winner {
  id: string;
  name: string;
  total: number;      // lo que queda por entregar
  entregado?: number; // lo ya entregado a cuenta, solo informativo
  // El icono viaja con el premio: el catalogo de recursos no lo tiene todo
  // (los equipables que se regalan a mano son de otra familia) y los ankama_id
  // se repiten entre familias, asi que buscarlo por id pintaria otro dibujo.
  items: { id: string; name: string; value: number; icon?: string }[];
  date: string;
  draws?: number;   // cuantos sorteos se han acumulado en esta entrada
}

// Del icono solo se guarda la direccion, y solo si es http(s) o una ruta
// propia: asi un import de fuera no puede colar un javascript: en el src.
function iconoValido(url: unknown): string | undefined {
  const s = typeof url === 'string' ? url.trim().slice(0, 400) : '';
  if (!s) return undefined;
  if (s.startsWith('https://') || s.startsWith('http://') || s.startsWith('/')) return s;
  return undefined;
}

// Para detectar al mismo ganador aunque cambie mayusculas o tildes.
function normalizeName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function readWinners(sid: string): Winner[] {
  ensureServerDir(sid);
  try {
    const f = serverFile(sid, 'winners');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      // Se descartan entradas corruptas para que un archivo mal escrito a mano
      // no tumbe los endpoints que recorren la lista.
      if (Array.isArray(parsed)) return parsed.filter((w) => w && typeof w.name === 'string');
    }
  } catch (err) {
    console.error('Failed to read winners:', err);
  }
  return [];
}

function writeWinners(sid: string, winners: Winner[]): void {
  ensureServerDir(sid);
  writeJson(serverFile(sid, 'winners'), winners);
}

// Historico acumulado por persona. A diferencia de winners.json, no se borra
// al entregar el premio: es lo que alimenta el ranking.
interface RankEntry {
  name: string;
  total: number;
  draws: number;
}

// El archivo guarda SOLO lo ya entregado. El ranking que se sirve es este
// archivo mas los ganadores pendientes, leidos en vivo de winners.json. Asi
// cualquier ganador cuenta desde el primer momento, incluidos los que ya
// existian antes de que hubiera ranking, y nada se cuenta dos veces.
interface Archive {
  version: number;
  entries: Record<string, RankEntry>;
}

function sumarEntrada(dest: Record<string, RankEntry>, name: string, total: number, draws: number): void {
  const key = normalizeName(name);
  const actual = dest[key] ?? { name, total: 0, draws: 0 };
  dest[key] = { name, total: actual.total + total, draws: actual.draws + draws };
}

function readArchive(sid: string): Archive {
  ensureServerDir(sid);
  try {
    const f = serverFile(sid, 'ranking');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed?.version === 2 && parsed.entries) return parsed as Archive;

      // Formato antiguo: el total incluia a los pendientes. Se les resta para
      // que el archivo quede solo con lo entregado y no se duplique.
      const entries: Record<string, RankEntry> = { ...(parsed || {}) };
      for (const w of readWinners(sid)) {
        const key = normalizeName(w.name);
        const actual = entries[key];
        if (!actual) continue;
        const total = Math.max(0, actual.total - (w.total ?? 0));
        const draws = Math.max(0, actual.draws - (w.draws ?? 1));
        if (total === 0 && draws === 0) delete entries[key];
        else entries[key] = { ...actual, total, draws };
      }
      const migrado: Archive = { version: 2, entries };
      writeArchive(sid, migrado);
      console.log('Ranking migrado al formato nuevo (archivo = solo entregados)');
      return migrado;
    }
  } catch (err) {
    console.error('Failed to read ranking archive:', err);
  }
  return { version: 2, entries: {} };
}

function writeArchive(sid: string, archive: Archive): void {
  ensureServerDir(sid);
  writeJson(serverFile(sid, 'ranking'), archive);
}

// Entregado + pendiente. Es lo que consume GET /api/ranking.
function computeRanking(sid: string): RankEntry[] {
  const total: Record<string, RankEntry> = {};
  for (const [key, e] of Object.entries(readArchive(sid).entries)) {
    total[key] = { ...e };
  }
  for (const w of readWinners(sid)) {
    sumarEntrada(total, w.name, w.total ?? 0, w.draws ?? 1);
  }
  return Object.values(total).sort((a, b) => b.total - a.total || b.draws - a.draws);
}

// Top del stream en curso: se acumula aparte del historico y se pone a cero
// cuando el usuario empieza un stream nuevo. A diferencia del ranking global,
// aqui se suma en el momento de registrar al ganador, no al entregar el premio.
interface Stream {
  version: number;
  startedAt: string;
  entries: Record<string, RankEntry>;
}

function readStream(sid: string): Stream {
  ensureServerDir(sid);
  try {
    const f = serverFile(sid, 'stream');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed?.version === 1 && parsed.entries) return parsed as Stream;
    }
  } catch (err) {
    console.error('Failed to read stream ranking:', err);
  }
  return { version: 1, startedAt: new Date().toISOString(), entries: {} };
}

function writeStream(sid: string, stream: Stream): void {
  ensureServerDir(sid);
  writeJson(serverFile(sid, 'stream'), stream);
}

function sumarAlStream(sid: string, name: string, total: number, draws: number): void {
  const stream = readStream(sid);
  sumarEntrada(stream.entries, name, total, draws);
  writeStream(sid, stream);
}

function rankingEntregado(sid: string): RankEntry[] {
  return Object.values(readArchive(sid).entries)
    .sort((a, b) => b.total - a.total || b.draws - a.draws);
}

function rankingStream(sid: string): RankEntry[] {
  const stream = readStream(sid);
  return Object.values(stream.entries).sort((a, b) => b.total - a.total || b.draws - a.draws);
}

function archivarGanador(sid: string, w: Winner): void {
  const archive = readArchive(sid);
  sumarEntrada(archive.entries, w.name, w.total ?? 0, w.draws ?? 1);
  writeArchive(sid, archive);
}

function getItemId(item: any): string {
  return String(item?.ankama_id ?? item?.id ?? item?._id ?? '');
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Las respuestas de la API cambian a cada momento; sin esto el navegador
// puede servir una version antigua (por ejemplo, un ranking desactualizado).
app.use('/api', (_req: Request, res: Response, next: any) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Intentos fallidos por IP, para que no se pueda probar contrasenas a lo bruto.
const intentos = new Map<string, { fallos: number; hasta: number }>();
const MAX_FALLOS = 10;
const CASTIGO_MS = 15 * 60 * 1000;

function ipDe(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || 'desconocida');
}

function bloqueado(req: Request): boolean {
  const reg = intentos.get(ipDe(req));
  return !!reg && reg.fallos >= MAX_FALLOS && reg.hasta > Date.now();
}

function apuntarFallo(req: Request): void {
  const ip = ipDe(req);
  const reg = intentos.get(ip);
  if (reg && reg.hasta > Date.now()) reg.fallos += 1;
  else intentos.set(ip, { fallos: 1, hasta: Date.now() + CASTIGO_MS });
}

function limpiarFallos(req: Request): void {
  intentos.delete(ipDe(req));
}

function ponerCookie(req: Request, res: Response, token: string): void {
  const seguro = process.env.COOKIE_SECURE === '1' || req.protocol === 'https';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,          // el JavaScript de la pagina no puede leerla
    sameSite: 'lax',
    secure: seguro,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function datosPublicos(u: User) {
  return {
    id: u.id, username: u.username, name: u.name,
    avatarUrl: u.avatarUrl || '', createdAt: u.createdAt,
    twitchCanal: u.twitchCanal || '',
    admin: Boolean(u.admin)
  };
}

// Guarda una imagen enviada como data URL y devuelve su ruta publica.
function guardarImagen(dataUrl: unknown, prefijo: string): { url?: string; error?: string; code?: number } {
  if (typeof dataUrl !== 'string') return { error: 'body must be { dataUrl: string }', code: 400 };
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(dataUrl);
  if (!match) return { error: 'unsupported image format', code: 400 };

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 12 * 1024 * 1024) return { error: 'image too large (max 12MB)', code: 413 };

  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const filename = `${prefijo}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(ASSETS_DIR, filename), buffer);
  return { url: `/assets/${filename}` };
}

// El usuario de la peticion; las rutas protegidas ya han comprobado que existe.
function requireUid(req: Request): string {
  const u = usuarioDe(req);
  if (!u) throw new Error('no autenticado');
  return u.id;
}

// GET /api/auth/me -> quien ha entrado, y si se admiten registros
app.get('/api/auth/me', (req: Request, res: Response) => {
  const u = usuarioDe(req);
  const primeraCuenta = readUsers().length === 0;
  if (!u) {
    return res.status(401).json({
      error: 'no autenticado',
      primeraCuenta,
      registroAbierto: primeraCuenta || Boolean(inviteActual())
    });
  }
  res.json({ user: datosPublicos(u) });
});

// POST /api/auth/register  Body: { username, password, invite? }
app.post('/api/auth/register', (req: Request, res: Response) => {
  const body = req.body || {};
  const nombre = typeof body.username === 'string' ? body.username.trim().slice(0, 40) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const invite = typeof body.invite === 'string' ? body.invite.trim() : '';

  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(nombre)) {
    return res.status(400).json({ error: 'el usuario admite 3-40 letras, numeros, punto, guion o guion bajo' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'la contrasena necesita al menos 8 caracteres' });
  }

  try {
    const users = readUsers();
    // La primera cuenta es la del dueno y no pide codigo; a partir de ahi, si.
    const codigo = inviteActual();
    if (users.length > 0) {
      if (!codigo) return res.status(403).json({ error: 'los registros estan cerrados' });
      if (invite !== codigo) return res.status(403).json({ error: 'codigo de invitacion incorrecto' });
    }
    const username = nombre.toLowerCase();
    if (users.some((u) => u.username === username)) {
      return res.status(409).json({ error: 'ese usuario ya existe' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    let id = slugify(username);
    while (users.some((u) => u.id === id)) id = `${id}-2`;
    const nuevo: User = {
      id,
      username,
      name: nombre,
      salt,
      hash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
      // La primera cuenta es la del dueno: es quien administra el acceso.
      admin: users.length === 0
    };
    writeUsers(users.concat(nuevo));
    ensureUserDir(id);
    // El Ruleton que ya hubiera en el equipo se queda con la primera cuenta.
    if (users.length === 0) migrarRuletonExistente(id);
    readServers(id, juegos.JUEGO_POR_DEFECTO);   // nace con su servidor por defecto

    ponerCookie(req, res, crearSesion(id));
    res.json({ user: datosPublicos(nuevo) });
  } catch (err) {
    console.error('Failed to register:', err);
    res.status(500).json({ error: 'failed to register' });
  }
});

// POST /api/auth/login  Body: { username, password }
app.post('/api/auth/login', (req: Request, res: Response) => {
  if (bloqueado(req)) {
    return res.status(429).json({ error: 'demasiados intentos; prueba dentro de un rato' });
  }
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  try {
    const user = readUsers().find((u) => u.username === username);
    // Mismo mensaje falle el usuario o la contrasena: no se confirma quien existe.
    if (!user || !passwordOk(user, password)) {
      apuntarFallo(req);
      return res.status(401).json({ error: 'usuario o contrasena incorrectos' });
    }
    // La contrasena era buena, pero el admin le ha quitado el acceso. Se dice
    // claro: no es un fallo suyo y repetir el intento no lo va a arreglar.
    if (user.bloqueado) {
      return res.status(403).json({ error: 'esta cuenta no tiene acceso; habla con el administrador' });
    }
    limpiarFallos(req);
    ponerCookie(req, res, crearSesion(user.id));
    res.json({ user: datosPublicos(user) });
  } catch (err) {
    console.error('Failed to login:', err);
    res.status(500).json({ error: 'failed to login' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = leerCookie(req, COOKIE_NAME);
  if (token) borrarSesion(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// GET /api/twitch/callback -> la vuelta de Twitch tras autorizar
app.get('/api/twitch/callback', async (req: Request, res: Response) => {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const uid = state ? twitch.uidDelState(state) : null;
  // Sin un "state" valido no se sigue: es lo unico que ata esta vuelta a
  // quien empezo el alta.
  if (!uid || !code) return res.status(400).send('Vuelta de Twitch no valida. Vuelve a intentarlo desde Configuracion.');

  try {
    await twitch.completarAlta(uid, code);
    twitch.escuchar(uid);
    res.redirect('/?twitch=ok');
  } catch (err) {
    console.error('Failed to connect Twitch:', err);
    res.redirect('/?twitch=error');
  }
});

// A partir de aqui, toda la API pide sesion. El catalogo tambien: es una app
// privada, no un servicio publico de consulta.
app.use('/api', (req: Request, res: Response, next: any) => {
  if (req.path === '/auth/me' || req.path === '/auth/login' ||
      req.path === '/auth/register' || req.path === '/auth/logout') return next();
  // Lo que miran los widgets entra sin sesion, porque OBS no puede tenerla: se
  // identifican con su clave, que cada ruta comprueba por su cuenta. Lo de
  // /api/widget/clave NO: eso es pedir la clave, y para eso hay que ser quien
  // dice que es.
  if (req.path.startsWith('/widget/') && !req.path.startsWith('/widget/clave')) return next();
  if (!usuarioDe(req)) return res.status(401).json({ error: 'no autenticado' });
  next();
});

// --- Panel de acceso ----------------------------------------------------
// Solo el administrador. Decide el codigo de invitacion y quien puede entrar.
app.use('/api/admin', (req: Request, res: Response, next: any) => {
  const u = usuarioDe(req);
  if (!u) return res.status(401).json({ error: 'no autenticado' });
  // 404 y no 403: a quien no es admin el panel ni le consta que exista.
  if (!u.admin) return res.status(404).json({ error: 'no encontrado' });
  next();
});

// Cuantas sesiones abiertas tiene cada cuenta, para saber quien esta dentro.
function sesionesPorUsuario(): Record<string, number> {
  const cuenta: Record<string, number> = {};
  const ahora = Date.now();
  for (const ses of Object.values(readSessions())) {
    if (ses && ses.expiresAt > ahora) cuenta[ses.uid] = (cuenta[ses.uid] || 0) + 1;
  }
  return cuenta;
}

// GET /api/admin/users -> la lista de cuentas con su estado
app.get('/api/admin/users', (req: Request, res: Response) => {
  const sesiones = sesionesPorUsuario();
  const users = readUsers().map((u) => ({
    ...datosPublicos(u),
    bloqueado: Boolean(u.bloqueado),
    sesiones: sesiones[u.id] || 0,
    yo: u.id === requireUid(req)
  }));
  res.json({ users, invite: inviteActual() });
});

// GET /api/admin/estadisticas -> a que se juega, cuanto y cuando
// Solo lo ve el admin: el resto ni sabe que existe (lo corta el guardia de
// /api/admin de mas arriba). Las cuentas y las medias las hace el modulo; aqui
// solo se le presta como se llama cada cuenta, para no ensenar identificadores.
// El filtro de minijuego va en 'mini' y no en 'juego': 'juego' ya lo usa la
// pagina para decir si mira Dofus o Touch, y pisarlo aqui seria pedir problemas.
app.get('/api/admin/estadisticas', (req: Request, res: Response) => {
  const nombres = new Map(readUsers().map((u) => [u.id, u.username]));
  const mini = String(req.query?.mini ?? '') as estadisticas.Juego | '';
  res.json(estadisticas.resumen(nombres, mini));
});

// PATCH /api/admin/users/:id  Body: { bloqueado?, admin? }
app.patch('/api/admin/users/:id', (req: Request, res: Response) => {
  const yo = requireUid(req);
  const id = String(req.params.id);
  const body = req.body || {};

  try {
    const users = readUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return res.status(404).json({ error: 'esa cuenta no existe' });
    // Contra uno mismo no: es lo que evita quedarse fuera del propio panel.
    if (id === yo) return res.status(400).json({ error: 'no puedes cambiar tu propia cuenta aqui' });

    if (typeof body.admin === 'boolean') {
      // Sin al menos un admin el panel se queda sin dueno.
      if (!body.admin && users.filter((u) => u.admin).length <= 1) {
        return res.status(400).json({ error: 'tiene que quedar al menos un administrador' });
      }
      user.admin = body.admin;
      // Un administrador bloqueado no tendria como administrar nada.
      if (body.admin) user.bloqueado = false;
    }
    if (typeof body.bloqueado === 'boolean') {
      if (body.bloqueado && user.admin) {
        return res.status(400).json({ error: 'quitale primero el rol de administrador' });
      }
      user.bloqueado = body.bloqueado;
    }

    writeUsers(users);
    // Quitar el acceso echa fuera al momento a quien estuviera dentro.
    const tiradas = user.bloqueado ? borrarSesionesDe(id) : 0;
    res.json({ user: { ...datosPublicos(user), bloqueado: Boolean(user.bloqueado) }, sesionesCerradas: tiradas });
  } catch (err) {
    console.error('Failed to update user:', err);
    res.status(500).json({ error: 'failed to update user' });
  }
});

// POST /api/admin/users/:id/logout -> le cierra la sesion sin quitarle acceso
app.post('/api/admin/users/:id/logout', (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!readUsers().some((u) => u.id === id)) {
    return res.status(404).json({ error: 'esa cuenta no existe' });
  }
  res.json({ ok: true, sesionesCerradas: borrarSesionesDe(id) });
});

// POST /api/admin/users/:id/password -> le pone una contrasena temporal
// La devuelve en claro una sola vez: es la unica forma de que llegue a su
// dueno, porque en disco solo queda el hash.
app.post('/api/admin/users/:id/password', (req: Request, res: Response) => {
  const yo = requireUid(req);
  const id = String(req.params.id);
  // Para la propia cuenta esta "Mi cuenta", que pide la contrasena actual.
  if (id === yo) return res.status(400).json({ error: 'para la tuya usa Mi cuenta' });

  try {
    const users = readUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return res.status(404).json({ error: 'esa cuenta no existe' });

    const password = generarPassword();
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPassword(password, user.salt);
    writeUsers(users);
    // Cambiar la contrasena cierra sus sesiones, aqui tambien.
    const tiradas = borrarSesionesDe(id);
    res.json({ password, sesionesCerradas: tiradas });
  } catch (err) {
    console.error('Failed to reset password:', err);
    res.status(500).json({ error: 'failed to reset password' });
  }
});

// DELETE /api/admin/users/:id -> borra la cuenta y su Ruleton entero
app.delete('/api/admin/users/:id', (req: Request, res: Response) => {
  const yo = requireUid(req);
  const id = String(req.params.id);
  if (id === yo) return res.status(400).json({ error: 'no puedes borrar tu propia cuenta' });

  try {
    const users = readUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return res.status(404).json({ error: 'esa cuenta no existe' });
    if (user.admin && users.filter((u) => u.admin).length <= 1) {
      return res.status(400).json({ error: 'tiene que quedar al menos un administrador' });
    }

    writeUsers(users.filter((u) => u.id !== id));
    borrarSesionesDe(id);
    // Con la cuenta se va su Ruleton: sus servidores, ganadores e historial.
    const dir = userDir(id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete user:', err);
    res.status(500).json({ error: 'failed to delete user' });
  }
});

// PUT /api/admin/invite  Body: { invite }  ("" cierra los registros)
app.put('/api/admin/invite', (req: Request, res: Response) => {
  const body = req.body || {};
  const invite = typeof body.invite === 'string' ? body.invite.trim().slice(0, 60) : '';
  if (invite && invite.length < 6) {
    return res.status(400).json({ error: 'el codigo necesita al menos 6 caracteres' });
  }
  try {
    writeConfig({ ...readConfig(), invite });
    res.json({ invite });
  } catch (err) {
    console.error('Failed to save invite:', err);
    res.status(500).json({ error: 'failed to save invite' });
  }
});

// Del canal solo interesa el nombre, aunque peguen la direccion entera.
function limpiarCanal(valor: unknown): string {
  return String(valor || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
    .replace(/^#/, '')
    .replace(/\/.*$/, '')
    .slice(0, 30);
}

// El canal de un usuario, que es de donde leen el chat los minijuegos.
function canalDe(uid: string): string {
  return readUsers().find((u) => u.id === uid)?.twitchCanal || '';
}

// PATCH /api/auth/profile  Body: { name?, avatarDataUrl?, quitarAvatar?, twitchCanal? }
app.patch('/api/auth/profile', (req: Request, res: Response) => {
  const body = req.body || {};
  try {
    const users = readUsers();
    const yo = users.find((u) => u.id === requireUid(req));
    if (!yo) return res.status(404).json({ error: 'user not found' });

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'el nombre no puede quedar vacio' });
      yo.name = name;
    }
    if (typeof body.twitchCanal === 'string') {
      yo.twitchCanal = limpiarCanal(body.twitchCanal);
    }
    if (body.quitarAvatar === true) {
      yo.avatarUrl = '';
    } else if (body.avatarDataUrl !== undefined) {
      const guardada = guardarImagen(body.avatarDataUrl, 'avatar');
      if (guardada.error) return res.status(guardada.code || 400).json({ error: guardada.error });
      yo.avatarUrl = guardada.url;
    }

    writeUsers(users);
    res.json({ user: datosPublicos(yo) });
  } catch (err) {
    console.error('Failed to update profile:', err);
    res.status(500).json({ error: 'failed to update profile' });
  }
});

// POST /api/auth/password  Body: { actual, nueva }
app.post('/api/auth/password', (req: Request, res: Response) => {
  const body = req.body || {};
  const actual = typeof body.actual === 'string' ? body.actual : '';
  const nueva = typeof body.nueva === 'string' ? body.nueva : '';
  if (nueva.length < 8) {
    return res.status(400).json({ error: 'la contrasena nueva necesita al menos 8 caracteres' });
  }

  try {
    const users = readUsers();
    const yo = users.find((u) => u.id === requireUid(req));
    if (!yo) return res.status(404).json({ error: 'user not found' });
    if (!passwordOk(yo, actual)) {
      return res.status(403).json({ error: 'la contrasena actual no es correcta' });
    }

    yo.salt = crypto.randomBytes(16).toString('hex');
    yo.hash = hashPassword(nueva, yo.salt);
    writeUsers(users);

    // Cambiar la contrasena echa al resto de dispositivos: si alguien habia
    // entrado con la vieja, su sesion deja de valer.
    const sessions = readSessions();
    const token = leerCookie(req, COOKIE_NAME);
    for (const [t, ses] of Object.entries(sessions)) {
      if (ses.uid === yo.id && t !== token) delete sessions[t];
    }
    writeSessions(sessions);

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to change password:', err);
    res.status(500).json({ error: 'failed to change password' });
  }
});

// GET /api/img/touch/<tamano>/<id>.png -> la imagen de un objeto de Touch
//
// No se enlaza al CDN de Ankama desde la pagina porque CloudFront contesta 403
// en cuanto la peticion lleva pinta de navegador, y entonces Chrome la bloquea.
// Desde aqui si se puede: se pide como servidor, se guarda en disco y se sirve
// del propio Ruleton. La primera vez que se ve un objeto cuesta una descarga;
// a partir de ahi sale del disco.
const IMG_TOUCH_DIR = path.join(DATA_DIR, 'img-touch');

app.get('/api/img/touch/:tamano/:archivo', async (req: Request, res: Response) => {
  // Solo numeros, y nada mas: asi este endpoint no se puede usar para pedirle
  // al servidor que baje cualquier otra cosa ni para salirse de la carpeta.
  const tamano = String(req.params.tamano || '');
  const id = String(req.params.archivo || '').replace(/\.png$/, '');
  if (!/^\d+$/.test(tamano) || !/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'imagen no valida' });
  }

  const dir = path.join(IMG_TOUCH_DIR, tamano);
  const file = path.join(dir, `${id}.png`);
  // Un mes: son imagenes de un catalogo congelado en 2019, no cambian.
  res.setHeader('Cache-Control', 'public, max-age=2592000');
  res.setHeader('Content-Type', 'image/png');
  if (fs.existsSync(file)) return res.sendFile(file);

  try {
    const r = await axios.get(`${juegos.CDN_TOUCH}/${tamano}/${id}.png`, {
      responseType: 'arraybuffer',
      timeout: 20000
    });
    const datos = Buffer.from(r.data);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, datos);
    } catch (err) {
      console.warn('Failed to cache Touch image:', err);
    }
    res.end(datos);
  } catch (err) {
    // Que falte una imagen no es motivo para romper la ficha del objeto.
    res.status(404).end();
  }
});

// --- Widgets para OBS ----------------------------------------------------
// Las paginas que se meten en OBS como Fuente de Navegador. No llevan sesion
// (OBS no tiene cookies), asi que se identifican con una clave en la url que
// solo sirve para mirar. Ver widget.ts.

// --- Avisos en vivo -----------------------------------------------------
// El servidor avisa de que un minijuego cambio y el que escucha pide el estado
// como siempre. Antes cada panel preguntaba cada dos segundos; ahora solo
// pregunta cuando hay algo. Ver avisos.ts.

// Cada cuanto se manda un latido. Un canal callado lo corta cualquier proxy (y
// Cloudflare a los 100s), asi que se manda un comentario cada 25 segundos: no
// es un evento, no llega al codigo del cliente, solo mantiene la tuberia.
const LATIDO_MS = 25000;

// Cuanto se espera antes de mandar un aviso. Cuarenta personas apuntandose son
// cuarenta cambios en un segundo, y mandar cuarenta avisos solo haria que el
// cliente pidiera el estado cuarenta veces para pintar lo mismo. Se juntan.
const JUNTAR_MS = 120;

// Escribe una cosa en el canal. Devuelve false si la conexion ya no esta, que
// pasa constantemente: el navegador cierra sin avisar en cuanto cambias de
// pestaña o recargas.
//
// El formato de SSE es tonto pero quisquilloso: cada linea es "campo: valor" y
// lo que cierra el mensaje es una linea en blanco. Una linea que empieza por
// dos puntos es un comentario y no le llega al codigo del cliente, que es
// justo lo que se quiere del latido.
function escribirEnCanal(res: Response, lineas: string[]): boolean {
  try {
    res.write(lineas.concat(['', '']).join('\n'));
    return true;
  } catch (err) {
    return false;
  }
}

// Monta un canal de eventos para una cuenta. Lo comparten la pagina y los
// widgets, que solo se diferencian en como dicen de quien son.
function abrirCanal(req: Request, res: Response, uid: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Para nginx, que si no se guarda la respuesta en su buffer y no sale nada
    // hasta que se corta.
    'X-Accel-Buffering': 'no'
  });
  // Un primer aviso para que el cliente sepa que esto ya esta en pie y pueda
  // apagar su reloj de repuesto.
  escribirEnCanal(res, ['event: listo', 'data: {}']);

  // De juntar los avisos seguidos se encarga avisos.ts: aqui solo se escriben.
  const soltar = avisos.escucharJuntando(uid, JUNTAR_MS, (juegos) => {
    for (const j of juegos) {
      // Si la conexion se fue entre medias se deja de escribir; de soltar el
      // oyente se encarga el 'close' de abajo.
      if (!escribirEnCanal(res, ['event: cambio', 'data: ' + JSON.stringify({ juego: j })])) return;
    }
  });

  const latido = setInterval(() => {
    escribirEnCanal(res, [': latido']);
  }, LATIDO_MS);

  // Al cerrarse hay que soltarlo TODO: el latido y el oyente (que se lleva por
  // delante su propia espera a medias). Un oyente que se queda aqui es una
  // pestaña cerrada a la que se sigue escribiendo, y son los que se acumulan
  // hasta tirar el servidor.
  const cerrar = () => {
    clearInterval(latido);
    soltar();
  };
  req.on('close', cerrar);
  req.on('error', cerrar);
  // Y el de la respuesta, que es el que importa: escribir en una conexion que
  // el navegador ya cerro no lanza, emite 'error' aqui. Sin nadie escuchando,
  // ese error no lo recoge nadie y se lleva el proceso por delante; y pasa
  // constantemente, porque cerrar la pestaña o recargar cierra sin avisar.
  res.on('error', cerrar);
}

// GET /api/eventos -> los cambios de la cuenta de quien pregunta
app.get('/api/eventos', (req: Request, res: Response) => {
  abrirCanal(req, res, requireUid(req));
});

// GET /api/widget/eventos?clave= -> igual, pero para OBS, que no tiene sesion
app.get('/api/widget/eventos', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  // Con una clave que no vale no se abre canal: 404 y a callar, igual que en
  // las demas rutas de widget.
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  abrirCanal(req, res, uid);
});

// GET /api/widget/clave -> la clave de quien pregunta, creandola si no tiene
app.get('/api/widget/clave', (req: Request, res: Response) => {
  res.json({ clave: widget.claveDe(requireUid(req)) });
});

// POST /api/widget/clave/rotar -> otra clave; la de antes deja de valer
app.post('/api/widget/clave/rotar', (req: Request, res: Response) => {
  res.json({ clave: widget.rotar(requireUid(req)) });
});

// GET /api/widget/plinko?clave= -> el tablero de esa cuenta, sin sesion
// Devuelve lo justo para pintarlo: nada de ajustes, ni de catalogo, ni de
// quien es el dueno de la cuenta.
app.get('/api/widget/plinko', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  // Sin clave valida no se cuenta que ha fallado: ni que no existe, ni que
  // existe pero no juega. A quien prueba claves no se le da conversacion.
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    const e = plinko.estado(uid);
    res.json({
      abierta: e.abierta,
      // Lo que hay que escribir en el chat: el widget lo enseña mientras la
      // inscripcion esta abierta, que es cuando hace falta saberlo.
      palabra: e.ajustes.palabra,
      jugadores: e.jugadores.map((j) => j.nombre),
      tiradas: e.tiradas,
      tiradoEn: e.tiradoEn,
      tablero: e.tablero,
      multiplicadores: e.multiplicadores,
      modo: e.modo,
      premios: e.premios,
      fisica: e.fisica,
      cierraEn: e.cierraEn,
      ahora: e.ahora
    });
  } catch (err) {
    console.error('Failed to serve plinko widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// Los demas widgets. Todos igual: la clave dice de quien es, y se contesta lo
// justo para pintarlo. Nada de ajustes, ni de catalogo, ni de quien es el
// dueno de la cuenta.
//
// El del sorteo no esta: la ruleta de objetos no deja partida en el servidor
// (el sorteo se resuelve y se acabo), asi que no hay nada vivo que mirar. Para
// tenerlo habria que guardar el ultimo sorteo, que es otra decision.

// GET /api/widget/carrera?clave=
app.get('/api/widget/carrera', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    const e = carrera.estado(uid);
    res.json({
      abierta: e.abierta,
      palabra: e.ajustes.palabra,
      corredores: e.corredores.map((c) => c.nombre),
      resultado: e.resultado,
      corridaEn: e.corridaEn,
      marcas: e.marcas,
      eventos: e.eventos,
      // Cuanto dura la carrera: el widget reparte los ticks en ese tiempo,
      // igual que la pagina.
      duracion: e.ajustes.duracion,
      animacion: e.ajustes.animacion,
      cierraEn: e.cierraEn,
      ahora: e.ahora
    });
  } catch (err) {
    console.error('Failed to serve carrera widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// GET /api/widget/batalla?clave=
app.get('/api/widget/batalla', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    const e = batalla.estado(uid);
    res.json({
      abierta: e.abierta,
      palabra: e.palabra,
      luchadores: e.luchadores.map((l) => ({ nombre: l.nombre, clase: l.clase || '' })),
      rondas: e.rondas,
      campeon: e.campeon,
      puntos: e.puntos,
      cierraEn: e.cierraEn,
      ahora: e.ahora
    });
  } catch (err) {
    console.error('Failed to serve batalla widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// GET /api/widget/colina?clave=
app.get('/api/widget/colina', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    const e = colina.estado(uid);
    res.json({
      abierta: e.abierta,
      palabra: e.palabra,
      rey: e.rey,
      cola: e.cola.map((r) => ({ nombre: r.nombre, clase: r.clase })),
      duelo: e.duelo,
      derrotado: e.derrotado,
      mejor: e.mejor,
      record: e.record,
      peleados: e.peleados
    });
  } catch (err) {
    console.error('Failed to serve colina widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// POST /api/sorteo/olvidar -> tira el ultimo sorteo
// La pagina lo llama al descartar el resultado: si no, el widget seguiria
// ensenando un premio que ya no esta en pantalla.
app.post('/api/sorteo/olvidar', (req: Request, res: Response) => {
  sorteo.olvidar(requireUid(req));
  res.json({ ok: true });
});

// GET /api/widget/sorteo?clave= -> el ultimo sorteo de la ruleta de objetos
app.get('/api/widget/sorteo', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    // null cuando no hay ninguno: el widget no ensena nada y se queda
    // transparente, que es lo que se quiere encima del directo.
    res.json({ sorteo: sorteo.estado(uid), ahora: Date.now() });
  } catch (err) {
    console.error('Failed to serve sorteo widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// GET /api/widget/nombres?clave=
app.get('/api/widget/nombres', (req: Request, res: Response) => {
  const uid = widget.uidDe(req.query?.clave);
  if (!uid) return res.status(404).json({ error: 'no hay widget aqui' });
  try {
    const e = ruletachat.estado(uid);
    res.json({
      abierta: e.abierta,
      palabra: e.palabra,
      nombres: e.nombres,
      // El ultimo sorteo, para poder sacar el cartel del ganador. Mientras la
      // ruleta gira viene sin ganador: lo esconde ruletachat.
      sorteo: e.sorteo,
      cierraEn: e.cierraEn,
      ahora: e.ahora
    });
  } catch (err) {
    console.error('Failed to serve nombres widget:', err);
    res.status(500).json({ error: 'failed to get widget state' });
  }
});

// GET /api/items?juego=  -> el catalogo que se sortea, del juego que se pida
app.get('/api/items', async (req: Request, res: Response) => {
  try {
    const juego = juegoDe(req);
    const items = await itemsDe(requireUid(req), juego);
    res.json({ count: items.length, items, juego, aviso: juegos.AVISOS[juego] });
  } catch (err) {
    res.status(500).json({ error: 'failed to get items' });
  }
});

// --- Retocar el catalogo -------------------------------------------------
// Anadir, renombrar, cambiar la imagen y borrar recursos. Nada de esto toca el
// catalogo descargado: se guarda aparte, por usuario y juego, y se aplica
// encima al servir. Ver catalogo.ts.

// POST /api/catalogo/recurso  Body: { nombre, imagenDataUrl?, imagen?, nivel?, tipo?, descripcion? }
app.post('/api/catalogo/recurso', (req: Request, res: Response) => {
  const uid = requireUid(req);
  const juego = juegoDe(req);
  const body = req.body || {};
  const nombre = String(body.nombre ?? '').trim();
  if (!nombre) return res.status(400).json({ error: 'hace falta un nombre' });

  let imagen = String(body.imagen ?? '').trim();
  if (body.imagenDataUrl) {
    const guardada = guardarImagen(body.imagenDataUrl, 'recurso');
    if (guardada.error) return res.status(guardada.code || 400).json({ error: guardada.error });
    imagen = guardada.url || '';
  }

  try {
    const r = leerRetoques(uid, juego);
    const item = catalogo.nuevoRecurso(catalogo.siguienteId(r), {
      nombre, imagen, nivel: body.nivel, tipo: body.tipo, descripcion: body.descripcion
    });
    r.nuevos.push(item);
    guardarRetoques(uid, juego, r);
    res.json({ item });
  } catch (err) {
    console.error('Failed to add resource:', err);
    res.status(500).json({ error: 'failed to add resource' });
  }
});

// PATCH /api/catalogo/recurso/:id  Body: { nombre?, imagenDataUrl?, imagen? }
// Vale para los descargados y para los propios. En un descargado el cambio se
// guarda aparte, asi que se puede deshacer sin volver a bajar nada.
app.patch('/api/catalogo/recurso/:id', (req: Request, res: Response) => {
  const uid = requireUid(req);
  const juego = juegoDe(req);
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'falta el objeto' });
  const body = req.body || {};

  let imagen = typeof body.imagen === 'string' ? body.imagen.trim() : undefined;
  if (body.imagenDataUrl) {
    const guardada = guardarImagen(body.imagenDataUrl, 'recurso');
    if (guardada.error) return res.status(guardada.code || 400).json({ error: guardada.error });
    imagen = guardada.url || '';
  }

  try {
    const r = leerRetoques(uid, juego);
    // Un objeto propio se cambia en su sitio: no tiene original al que volver,
    // asi que guardar el cambio aparte solo seria un rodeo.
    const propio = r.nuevos.find((n: any) => String(n?.ankama_id) === id);
    if (propio) {
      if (typeof body.nombre === 'string' && body.nombre.trim()) propio.name = body.nombre.trim().slice(0, 120);
      if (imagen) propio.image_urls = { icon: imagen, sd: imagen, hq: imagen, hd: imagen };
    } else {
      const cambio = { ...(r.cambios[id] || {}) };
      if (typeof body.nombre === 'string' && body.nombre.trim()) cambio.name = body.nombre.trim().slice(0, 120);
      if (imagen) cambio.imagen = imagen.slice(0, 500);
      // Sin nada dentro no se guarda: un cambio vacio es no haber cambiado nada.
      if (Object.keys(cambio).length) r.cambios[id] = cambio;
      else delete r.cambios[id];
    }
    guardarRetoques(uid, juego, r);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to edit resource:', err);
    res.status(500).json({ error: 'failed to edit resource' });
  }
});

// DELETE /api/catalogo/recurso/:id -> fuera del catalogo entero
// No es lo mismo que excluir: excluido se sigue viendo y sale en su pestana;
// borrado desaparece. Lo propio se borra de verdad; lo descargado se apunta en
// la lista de borrados, porque el catalogo vuelve a traerlo al actualizar.
app.delete('/api/catalogo/recurso/:id', (req: Request, res: Response) => {
  const uid = requireUid(req);
  const juego = juegoDe(req);
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'falta el objeto' });

  try {
    const r = leerRetoques(uid, juego);
    const antes = r.nuevos.length;
    r.nuevos = r.nuevos.filter((n: any) => String(n?.ankama_id) !== id);
    const eraPropio = r.nuevos.length !== antes;
    if (!eraPropio && !r.borrados.includes(id)) r.borrados.push(id);
    // Un objeto que ya no esta no necesita que le guarden cambios.
    delete r.cambios[id];
    guardarRetoques(uid, juego, r);
    res.json({ ok: true, propio: eraPropio });
  } catch (err) {
    console.error('Failed to delete resource:', err);
    res.status(500).json({ error: 'failed to delete resource' });
  }
});

// POST /api/catalogo/recurso/:id/restaurar -> deshacer el borrado o los cambios
// de un objeto descargado, que vuelve a ser el que trajo la descarga.
app.post('/api/catalogo/recurso/:id/restaurar', (req: Request, res: Response) => {
  const uid = requireUid(req);
  const juego = juegoDe(req);
  const id = String(req.params.id || '').trim();
  try {
    const r = leerRetoques(uid, juego);
    r.borrados = r.borrados.filter((x) => x !== id);
    delete r.cambios[id];
    guardarRetoques(uid, juego, r);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to restore resource:', err);
    res.status(500).json({ error: 'failed to restore resource' });
  }
});

// GET /api/catalogo/retoques -> que hay retocado en este juego
app.get('/api/catalogo/retoques', (req: Request, res: Response) => {
  res.json(leerRetoques(requireUid(req), juegoDe(req)));
});

// Los cosmeticos: lo que solo cambia la pinta. Como los equipables, son de
// mirar y de regalar a mano; no entran en la ruleta.
app.get('/api/cosmeticos', async (req: Request, res: Response) => {
  try {
    const juego = juegoDe(req);
    const items = await fetchCatalogCached(juego, 'cosmetics');
    res.json({ count: items.length, items, juego, aviso: juegos.AVISOS[juego] });
  } catch (err) {
    res.status(500).json({ error: 'failed to get cosmetics' });
  }
});

// El catalogo de equipables. Solo se mira desde la pestana de objetos: no hay
// rarezas, ni exclusiones, ni sorteo, asi que aqui no hace falta el ambito,
// pero si el juego: son catalogos distintos.
app.get('/api/equipment', async (req: Request, res: Response) => {
  try {
    const juego = juegoDe(req);
    const items = await fetchEquipmentCached(juego);
    res.json({ count: items.length, items, juego, aviso: juegos.AVISOS[juego] });
  } catch (err) {
    res.status(500).json({ error: 'failed to get equipment' });
  }
});

// GET /api/servers -> { servers: GameServer[] }  (los del usuario que ha entrado)
app.get('/api/servers', (req: Request, res: Response) => {
  const juego = juegoDe(req);
  res.json({ servers: readServers(requireUid(req), juego), juego });
});

// GET /api/juegos -> los juegos que hay, para el selector de la pagina
app.get('/api/juegos', (_req: Request, res: Response) => {
  res.json({
    juegos: juegos.JUEGOS.map((j) => ({
      id: j,
      nombre: juegos.NOMBRES[j],
      aviso: juegos.AVISOS[j]
    })),
    porDefecto: juegos.JUEGO_POR_DEFECTO
  });
});

// POST /api/servers  Body: { name: string }  -> crea un servidor vacio
app.post('/api/servers', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const uid = requireUid(req);
    const juego = juegoDe(req);
    const servers = readServers(uid, juego);
    if (servers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'ya existe un servidor con ese nombre' });
    }
    let id = slugify(name);
    while (servers.some((s) => s.id === id)) id = `${id}-2`;

    const nuevo: GameServer = { id, name };
    ensureServerDir(`${uid}/${juego}/${id}`);
    writeServers(uid, juego, servers.concat(nuevo));
    res.json({ server: nuevo, servers: readServers(uid, juego) });
  } catch (err) {
    console.error('Failed to create server:', err);
    res.status(500).json({ error: 'failed to create server' });
  }
});

// PATCH /api/servers/:id  Body: { name: string }  -> renombra (el id no cambia)
app.patch('/api/servers/:id', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const uid = requireUid(req);
    const juego = juegoDe(req);
    const servers = readServers(uid, juego);
    const destino = servers.find((s) => s.id === req.params.id);
    if (!destino) return res.status(404).json({ error: 'server not found' });
    if (servers.some((s) => s.id !== destino.id && s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'ya existe un servidor con ese nombre' });
    }
    destino.name = name;
    writeServers(uid, juego, servers);
    res.json({ server: destino, servers });
  } catch (err) {
    console.error('Failed to rename server:', err);
    res.status(500).json({ error: 'failed to rename server' });
  }
});

// DELETE /api/servers/:id  -> borra el servidor y sus datos (nunca el ultimo)
app.delete('/api/servers/:id', (req: Request, res: Response) => {
  try {
    const uid = requireUid(req);
    const juego = juegoDe(req);
    const servers = readServers(uid, juego);
    if (!servers.some((s) => s.id === req.params.id)) {
      return res.status(404).json({ error: 'server not found' });
    }
    if (servers.length <= 1) {
      return res.status(409).json({ error: 'debe quedar al menos un servidor' });
    }
    const rest = servers.filter((s) => s.id !== req.params.id);
    writeServers(uid, juego, rest);
    fs.rmSync(serverDir(`${uid}/${juego}/${req.params.id}`), { recursive: true, force: true });
    res.json({ servers: rest });
  } catch (err) {
    console.error('Failed to delete server:', err);
    res.status(500).json({ error: 'failed to delete server' });
  }
});

// GET /api/exclusions -> { ids: string[] }
app.get('/api/exclusions', (req: Request, res: Response) => {
  res.json({ ids: readExclusions(resolveServer(req)) });
});

// PUT /api/exclusions  Body: { ids: string[] }
app.put('/api/exclusions', (req: Request, res: Response) => {
  const ids: string[] | null = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id: unknown) => String(id))
    : null;
  if (!ids) return res.status(400).json({ error: 'body must be { ids: string[] }' });
  try {
    const unique = Array.from(new Set(ids));
    writeExclusions(resolveServer(req), unique);
    res.json({ ids: unique });
  } catch (err) {
    console.error('Failed to write exclusions:', err);
    res.status(500).json({ error: 'failed to save exclusions' });
  }
});

// GET /api/ranking?limit=3&scope=global|stream|delivered -> { ranking: RankEntry[] }
// ordenado por total. 'global' = entregado + pendiente; 'delivered' = solo lo ya
// entregado; 'stream' = solo el stream en curso, e informa de cuando empezo.
app.get('/api/ranking', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 500);
  const sid = resolveServer(req);
  if (req.query.scope === 'stream') {
    const stream = readStream(sid);
    return res.json({ ranking: rankingStream(sid).slice(0, limit), startedAt: stream.startedAt });
  }
  if (req.query.scope === 'delivered') {
    return res.json({ ranking: rankingEntregado(sid).slice(0, limit) });
  }
  res.json({ ranking: computeRanking(sid).slice(0, limit) });
});

// POST /api/stream/reset -> empieza un stream nuevo (el global no se toca)
app.post('/api/stream/reset', (req: Request, res: Response) => {
  try {
    const stream: Stream = { version: 1, startedAt: new Date().toISOString(), entries: {} };
    writeStream(resolveServer(req), stream);
    res.json({ ranking: [], startedAt: stream.startedAt });
  } catch (err) {
    console.error('Failed to reset stream ranking:', err);
    res.status(500).json({ error: 'failed to reset stream ranking' });
  }
});

// POST /api/ranking/reset -> pone a cero el historico entregado del servidor.
// Los ganadores pendientes no se tocan: siguen contando hasta que se entreguen.
app.post('/api/ranking/reset', (req: Request, res: Response) => {
  const sid = resolveServer(req);
  try {
    writeArchive(sid, { version: 2, entries: {} });
    res.json({ ranking: computeRanking(sid).slice(0, 3), pendientes: readWinners(sid).length });
  } catch (err) {
    console.error('Failed to reset ranking:', err);
    res.status(500).json({ error: 'failed to reset ranking' });
  }
});

// GET /api/winners -> { winners: Winner[] }  (mas recientes primero)
app.get('/api/winners', (req: Request, res: Response) => {
  res.json({ winners: readWinners(resolveServer(req)) });
});

// POST /api/winners  Body: { name, total, items? }
// POST /api/winners/import  Body: { winners, modo: 'anadir' | 'reemplazar' }
// Para llevarse la lista de un equipo a otro sin rehacerla a mano.
app.post('/api/winners/import', (req: Request, res: Response) => {
  const body = req.body || {};
  const modo = body.modo === 'reemplazar' ? 'reemplazar' : 'anadir';
  if (!Array.isArray(body.winners)) {
    return res.status(400).json({ error: 'body must be { winners: [] }' });
  }

  // Se sanea igual que al crear uno a mano: un archivo editado no puede meter
  // aqui nada que no pase por el mismo filtro.
  const entrantes: Winner[] = [];
  for (const w of body.winners.slice(0, 5000)) {
    const name = typeof w?.name === 'string' ? w.name.trim().slice(0, 120) : '';
    if (!name) continue;
    entrantes.push({
      id: typeof w?.id === 'string' && w.id ? w.id : crypto.randomUUID(),
      name,
      total: typeof w?.total === 'number' && Number.isFinite(w.total) ? w.total : 0,
      entregado: typeof w?.entregado === 'number' && Number.isFinite(w.entregado) ? w.entregado : 0,
      items: Array.isArray(w?.items)
        ? w.items.slice(0, 100).map((it: any) => ({
            id: String(it?.id ?? ''),
            name: String(it?.name ?? '').slice(0, 200),
            value: typeof it?.value === 'number' && Number.isFinite(it.value) ? it.value : 0,
            icon: iconoValido(it?.icon)
          }))
        : [],
      date: typeof w?.date === 'string' && w.date ? w.date : new Date().toISOString(),
      draws: typeof w?.draws === 'number' && Number.isFinite(w.draws) ? w.draws : 1
    });
  }
  if (entrantes.length === 0) {
    return res.status(400).json({ error: 'el archivo no traia ningun ganador valido' });
  }

  const sid = resolveServer(req);
  try {
    let winners: Winner[];
    if (modo === 'reemplazar') {
      winners = entrantes;
    } else {
      // Igual que al sortear: al mismo nombre se le acumula, no se duplica.
      winners = readWinners(sid);
      for (const nuevo of entrantes) {
        const existente = winners.find((w) => normalizeName(w.name) === normalizeName(nuevo.name));
        if (existente) {
          existente.total += nuevo.total;
          existente.entregado = (existente.entregado ?? 0) + (nuevo.entregado ?? 0);
          existente.items = existente.items.concat(nuevo.items);
          existente.draws = (existente.draws ?? 1) + (nuevo.draws ?? 1);
          existente.date = nuevo.date > existente.date ? nuevo.date : existente.date;
        } else {
          // Un id repetido de otra instalacion romperia el borrado y la entrega.
          if (winners.some((w) => w.id === nuevo.id)) nuevo.id = crypto.randomUUID();
          winners.push(nuevo);
        }
      }
    }
    writeWinners(sid, winners);
    res.json({ ok: true, importados: entrantes.length, total: winners.length, modo });
  } catch (err) {
    console.error('Failed to import winners:', err);
    res.status(500).json({ error: 'failed to import winners' });
  }
});

app.post('/api/winners', (req: Request, res: Response) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return res.status(400).json({ error: 'name is required' });

  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : 0;
  const items = Array.isArray(body.items)
    ? body.items.slice(0, 100).map((it: any) => ({
        id: String(it?.id ?? ''),
        name: String(it?.name ?? '').slice(0, 200),
        value: typeof it?.value === 'number' && Number.isFinite(it.value) ? it.value : 0,
        icon: iconoValido(it?.icon)
      }))
    : [];

  const sid = resolveServer(req);
  try {
    const winners = readWinners(sid);
    const existente = winners.find((w) => normalizeName(w.name) === normalizeName(name));

    let winner: Winner;
    if (existente) {
      // Mismo ganador: se acumula el premio en su entrada en vez de duplicarla.
      existente.total += total;
      existente.items = existente.items.concat(items);
      existente.draws = (existente.draws ?? 1) + 1;
      existente.date = new Date().toISOString();
      // Vuelve arriba del todo por ser el mas reciente.
      winners.splice(winners.indexOf(existente), 1);
      winners.unshift(existente);
      winner = existente;
    } else {
      winner = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        total,
        items,
        date: new Date().toISOString(),
        draws: 1
      };
      winners.unshift(winner);
    }

    writeWinners(sid, winners);
    // Solo el premio de este sorteo, no el acumulado de la entrada.
    sumarAlStream(sid, name, total, 1);
    // No se toca el archivo: mientras esta pendiente ya cuenta para el ranking.
    res.json({ winner, merged: Boolean(existente), winners });
  } catch (err) {
    console.error('Failed to save winner:', err);
    res.status(500).json({ error: 'failed to save winner' });
  }
});

// POST /api/winners/:id/deliver  Body: { amount?: number }
// Entrega una parte del premio. Sin 'amount' (o con el total pendiente) se
// entrega entero y el ganador sale de la lista. Los sorteos solo se apuntan al
// archivo en la entrega que salda la deuda: asi el ranking (archivo +
// pendientes) suma siempre lo mismo antes y despues de cada entrega.
app.post('/api/winners/:id/deliver', (req: Request, res: Response) => {
  const sid = resolveServer(req);
  try {
    const winners = readWinners(sid);
    const winner = winners.find((w) => w.id === req.params.id);
    if (!winner) return res.status(404).json({ error: 'winner not found' });

    const pendiente = winner.total ?? 0;
    const pedido = req.body?.amount;
    const amount = typeof pedido === 'number' && Number.isFinite(pedido) ? pedido : pendiente;
    if (amount <= 0) return res.status(400).json({ error: 'amount must be greater than zero' });
    if (amount > pendiente) return res.status(400).json({ error: 'amount is larger than the pending prize' });

    const completa = amount >= pendiente;
    const archive = readArchive(sid);
    sumarEntrada(archive.entries, winner.name, amount, completa ? (winner.draws ?? 1) : 0);
    writeArchive(sid, archive);

    if (completa) {
      const rest = winners.filter((w) => w.id !== winner.id);
      writeWinners(sid, rest);
      return res.json({ winners: rest, delivered: amount, complete: true });
    }

    winner.total = pendiente - amount;
    winner.entregado = (winner.entregado ?? 0) + amount;
    writeWinners(sid, winners);
    res.json({ winners, delivered: amount, complete: false });
  } catch (err) {
    console.error('Failed to deliver prize:', err);
    res.status(500).json({ error: 'failed to deliver prize' });
  }
});

// DELETE /api/winners/:id  (entrega el premio entero; equivale a /deliver)
app.delete('/api/winners/:id', (req: Request, res: Response) => {
  const sid = resolveServer(req);
  try {
    const winners = readWinners(sid);
    const entregado = winners.find((w) => w.id === req.params.id);
    if (!entregado) return res.status(404).json({ error: 'winner not found' });
    const rest = winners.filter((w) => w.id !== req.params.id);
    writeWinners(sid, rest);
    // Al salir de pendientes pasa al archivo, para no perderlo del ranking.
    archivarGanador(sid, entregado);
    res.json({ winners: rest });
  } catch (err) {
    console.error('Failed to delete winner:', err);
    res.status(500).json({ error: 'failed to delete winner' });
  }
});

// GET /api/settings -> { settings: Settings }
app.get('/api/settings', (req: Request, res: Response) => {
  res.json({ settings: readSettings(requireUid(req)) });
});

// Corta por caracteres de verdad, no por unidades UTF-16: un emoji ocupa dos,
// y cortar por la mitad deja un simbolo roto en el titulo.
function recortar(texto: string, largo: number): string {
  return Array.from(texto).slice(0, largo).join('');
}

// PUT /api/settings  Body: campos parciales de Settings
app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body || {};
  const uid = requireUid(req);
  const current = readSettings(uid);
  const next: Settings = { ...current };

  // Un titulo vacio dejaria la cabecera en blanco: se ignora y se queda el actual.
  if (typeof body.pageTitle === 'string' && body.pageTitle.trim()) next.pageTitle = recortar(body.pageTitle.trim(), 80);
  // Subtitulo y logo si admiten quedarse vacios: es como se ocultan.
  if (typeof body.pageSubtitle === 'string') next.pageSubtitle = recortar(body.pageSubtitle.trim(), 140);
  if (typeof body.logoUrl === 'string') next.logoUrl = body.logoUrl.trim().slice(0, 2000);
  if (typeof body.backgroundUrl === 'string') next.backgroundUrl = body.backgroundUrl.slice(0, 2000);

  if (typeof body.wheelUrl === 'string') next.wheelUrl = body.wheelUrl.slice(0, 2000);
  if (typeof body.showWheel === 'boolean') next.showWheel = body.showWheel;
  if (body.animation === 'slot' || body.animation === 'wheel' || body.animation === 'none') {
    next.animation = body.animation;
  }
  if (typeof body.accentColor === 'string' && HEX_COLOR.test(body.accentColor)) next.accentColor = body.accentColor;
  if (typeof body.accentColor2 === 'string' && HEX_COLOR.test(body.accentColor2)) next.accentColor2 = body.accentColor2;
  if (typeof body.overlayOpacity === 'number' && body.overlayOpacity >= 0 && body.overlayOpacity <= 1) {
    next.overlayOpacity = body.overlayOpacity;
  }
  // Los mismos limites que los deslizadores del panel de configuracion.
  if (typeof body.wheelScale === 'number' && body.wheelScale >= 0.5 && body.wheelScale <= 2) {
    next.wheelScale = body.wheelScale;
  }
  if (typeof body.slotScale === 'number' && body.slotScale >= 0.5 && body.slotScale <= 2) {
    next.slotScale = body.slotScale;
  }
  if (typeof body.fontScale === 'number' && body.fontScale >= 0.7 && body.fontScale <= 1.6) {
    next.fontScale = body.fontScale;
  }

  try {
    writeSettings(uid, next);
    res.json({ settings: next });
  } catch (err) {
    console.error('Failed to write settings:', err);
    res.status(500).json({ error: 'failed to save settings' });
  }
});

// POST /api/background  Body: { dataUrl: "data:image/png;base64,...", target? }
// target: 'background' (por defecto), 'wheel' o 'logo'. Guarda la imagen en
// public/assets y la deja activa en el ajuste correspondiente.
app.post('/api/background', (req: Request, res: Response) => {
  const pedido = req.body?.target;
  const target: 'wheel' | 'logo' | 'background' =
    pedido === 'wheel' ? 'wheel' : pedido === 'logo' ? 'logo' : 'background';

  const guardada = guardarImagen(req.body?.dataUrl, `fondo-${target}`);
  if (guardada.error) return res.status(guardada.code || 400).json({ error: guardada.error });

  try {
    const uid = requireUid(req);
    const settings = readSettings(uid);
    if (target === 'wheel') settings.wheelUrl = guardada.url!;
    else if (target === 'logo') settings.logoUrl = guardada.url!;
    else settings.backgroundUrl = guardada.url!;
    writeSettings(uid, settings);
    res.json({ settings });
  } catch (err) {
    console.error('Failed to save background:', err);
    res.status(500).json({ error: 'failed to save background' });
  }
});

// GET /api/ratios -> cuanto sale cada color en el sorteo
app.get('/api/ratios', (req: Request, res: Response) => {
  res.json({ ratios: readRatios(resolveServer(req)) });
});

// PUT /api/ratios  Body: { ratios: { common, rare, epic, mythic } }
app.put('/api/ratios', (req: Request, res: Response) => {
  const entra = req.body?.ratios;
  if (!entra || typeof entra !== 'object') return res.status(400).json({ error: 'body must be { ratios: {} }' });
  try {
    const limpio = { ...RATIOS_POR_DEFECTO };
    for (const r of RARITIES) {
      const num = Number((entra as any)[r]);
      limpio[r] = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
    }
    writeRatios(resolveServer(req), limpio);
    res.json({ ratios: limpio });
  } catch (err) {
    console.error('Failed to write ratios:', err);
    res.status(500).json({ error: 'failed to save ratios' });
  }
});

// GET /api/tags -> { tags: { [itemId]: 'rare' | 'epic' | 'mythic' } }
app.get('/api/tags', (req: Request, res: Response) => {
  res.json({ tags: readTags(resolveServer(req)) });
});

// PUT /api/tags  Body: { tags: { [itemId]: 'rare' | 'epic' | 'mythic' } }
app.put('/api/tags', (req: Request, res: Response) => {
  const incoming = req.body?.tags;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'body must be { tags: object }' });
  }
  const clean: Tags = {};
  for (const [id, value] of Object.entries(incoming)) {
    if (RARITIES.includes(value as Rarity)) clean[String(id)] = value as Rarity;
  }
  try {
    writeTags(resolveServer(req), clean);
    res.json({ tags: clean });
  } catch (err) {
    console.error('Failed to write tags:', err);
    res.status(500).json({ error: 'failed to save tags' });
  }
});

app.get('/api/random-items', async (req: Request, res: Response) => {
  const n = Number(req.query.n) || 1;
  try {
    // El juego lo dice la peticion, y el ambito de mas abajo sale del mismo
    // juego, asi que exclusiones y rarezas son siempre las de este catalogo.
    const all = await itemsDe(requireUid(req), juegoDe(req));
    if (all.length === 0) return res.status(500).json({ error: 'no items available' });

    // Participan todos menos los excluidos.
    const ambito = resolveServer(req);
    const excluded = new Set(readExclusions(ambito));
    const items = all.filter((it) => !excluded.has(getItemId(it)));
    if (items.length === 0) return res.status(409).json({ error: 'all items are excluded' });

    const cuantos = Math.max(0, Math.min(n, items.length));
    const tags = readTags(ambito);
    const ratios = readRatios(ambito);

    // Un monton por color, ya barajado: sacar del final es sacar uno al azar.
    const montones: Record<Rarity, any[]> = { common: [], rare: [], epic: [], mythic: [] };
    for (const it of items) montones[(tags[getItemId(it)] as Rarity) || 'common'].push(it);
    for (const r of RARITIES) montones[r] = shuffle(montones[r]);

    // Lo que se hace en los dos caminos (con ratios y sin ellos): apuntar la
    // partida, quedarse con el resultado para el widget de OBS, y contestar.
    //
    // La ruleta de objetos no dejaba rastro: se sorteaba y se acababa, asi que la
    // superposicion no tenia nada que ensenar. Ahora se guarda. Con `quien` y
    // `duracion` la pagina dice a nombre de quien va y cuanto va a estar
    // girando; sin ellos se guarda igual, solo que sale al momento.
    const contestar = (selected: any[]) => {
      const uid = requireUid(req);
      estadisticas.apuntar('sorteo', uid);
      const aCosa = (it: any) => ({
        id: getItemId(it),
        nombre: it?.name?.es ?? it?.name ?? '',
        imagen: it?.image_urls?.icon || it?.image_urls?.sd || '',
        rareza: tags[getItemId(it)] || 'common'
      });
      const salen = new Set(selected.map((it) => getItemId(it)));
      sorteo.guardar(uid, {
        quien: req.query?.quien,
        duracion: req.query?.duracion,
        cosas: selected.map(aCosa),
        // El relleno de la tragaperras: otros objetos del mismo catalogo, para
        // que dando vueltas no se vean solo los premios y se adivine el
        // resultado antes de parar.
        relleno: shuffle(items.filter((it) => !salen.has(getItemId(it)))).slice(0, 24).map(aCosa)
      });
      res.json({ count: selected.length, items: selected });
    };

    // Con todos los ratios a cero no hay nada que respetar: se sortea plano,
    // como se hacia antes de que los colores contaran.
    const sumaRatios = RARITIES.reduce((s, r) => s + ratios[r], 0);
    if (sumaRatios <= 0) {
      return contestar(shuffle(items).slice(0, cuantos));
    }

    const selected: any[] = [];
    for (let k = 0; k < cuantos; k++) {
      // Solo compiten los colores que tengan ratio y que aun tengan objetos:
      // un color al que no le queden se reparte entre los demas.
      const posibles = RARITIES.filter((r) => ratios[r] > 0 && montones[r].length);
      if (posibles.length) {
        const total = posibles.reduce((s, r) => s + ratios[r], 0);
        let punto = Math.random() * total;
        let elegido = posibles[posibles.length - 1];
        for (const r of posibles) {
          punto -= ratios[r];
          if (punto <= 0) { elegido = r; break; }
        }
        selected.push(montones[elegido].pop());
      } else {
        // Ningun color con ratio tiene ya objetos: se completa con lo que quede.
        const resto = RARITIES.filter((r) => montones[r].length);
        if (!resto.length) break;
        selected.push(montones[resto[Math.floor(Math.random() * resto.length)]].pop());
      }
    }
    contestar(selected);
  } catch (err) {
    res.status(500).json({ error: 'failed to select random items' });
  }
});

// POST /api/draw
// Body: { participants?: string[], itemsCount?: number }
// If participants provided, returns assignments [{ participant, item }]. If not, returns items.
app.post('/api/draw', async (req: Request, res: Response) => {
  const body = req.body || {};
  const participants: string[] | undefined = Array.isArray(body.participants) ? body.participants : undefined;
  const itemsCount = typeof body.itemsCount === 'number' && body.itemsCount > 0 ? Math.floor(body.itemsCount) : 1;

  try {
    const items = await itemsDe(requireUid(req), juegoDe(req));
    if (items.length === 0) return res.status(500).json({ error: 'no items available for draw' });
    const selectedItems = shuffle(items).slice(0, Math.min(itemsCount, items.length));

    if (!participants || participants.length === 0) {
      return res.json({ items: selectedItems });
    }

    const winners = shuffle(participants).slice(0, Math.min(participants.length, selectedItems.length));
    const assignments = winners.map((p, idx) => ({ participant: p, item: selectedItems[idx] }));

    res.json({ assignments, itemsCount: selectedItems.length });
  } catch (err) {
    res.status(500).json({ error: 'draw failed' });
  }
});

// --- Twitch: canjes de puntos de canal ----------------------------------
// El modulo vive en twitch.ts; aqui solo se le presta lo que necesita del
// Ruleton y se publican las rutas.

// Sortea para un canje y deja al espectador como ganador, igual que si se
// hubiera sorteado a mano desde la pagina.
async function sortearParaTwitch(uid: string, sid: string, nombre: string, n: number): Promise<string[]> {
  // Los canjes se configuran por servidor, no por juego, asi que sortean del de
  // siempre. Para sortear de otro juego harian falta canjes por juego.
  const ambito = `${uid}/${juegos.JUEGO_POR_DEFECTO}/${sid}`;
  const todos = await itemsDe(uid, juegos.JUEGO_POR_DEFECTO);
  const excluidos = new Set(readExclusions(ambito));
  const disponibles = todos.filter((it) => !excluidos.has(getItemId(it)));
  if (!disponibles.length) throw new Error('no quedan objetos que sortear');

  const elegidos = shuffle(disponibles).slice(0, Math.max(1, Math.min(n, disponibles.length)));
  const items = elegidos.map((it) => ({
    id: getItemId(it),
    name: String(it?.name?.es ?? it?.name ?? '').slice(0, 200),
    value: 0
  }));

  const winners = readWinners(ambito);
  const existente = winners.find((w) => normalizeName(w.name) === normalizeName(nombre));
  if (existente) {
    existente.items = existente.items.concat(items);
    existente.draws = (existente.draws ?? 1) + 1;
    existente.date = new Date().toISOString();
    winners.splice(winners.indexOf(existente), 1);
    winners.unshift(existente);
  } else {
    winners.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: nombre.slice(0, 120),
      total: 0,
      items,
      date: new Date().toISOString(),
      draws: 1
    });
  }
  writeWinners(ambito, winners);
  return items.map((it) => it.name);
}

// GET /api/twitch/status -> si hay credenciales, si esta conectado y sus ajustes
app.get('/api/twitch/status', (req: Request, res: Response) => {
  res.json(twitch.estado(requireUid(req)));
});

// GET /api/twitch/connect -> manda al usuario a autorizar en Twitch
app.get('/api/twitch/connect', (req: Request, res: Response) => {
  const uid = requireUid(req);
  if (!twitch.hayCredenciales(uid)) {
    return res.status(409).json({ error: 'pon antes el Client ID y el Client Secret de tu app de Twitch' });
  }
  res.redirect(twitch.urlDeAutorizacion(uid));
});

// POST /api/twitch/credentials  Body: { clientId, clientSecret }
// El secreto se guarda pero no vuelve nunca: del estado solo sale si esta puesto.
app.post('/api/twitch/credentials', (req: Request, res: Response) => {
  const uid = requireUid(req);
  try {
    twitch.guardarCredenciales(uid, req.body?.clientId, req.body?.clientSecret);
    res.json(twitch.estado(uid));
  } catch (err) {
    console.error('Failed to save twitch credentials:', err);
    res.status(500).json({ error: 'failed to save credentials' });
  }
});

// POST /api/twitch/config  Body: { canal?, servidor?, recompensa?, objetos? }
// El canal se puede poner sin haber conectado nada: leer un chat publico no
// necesita credenciales.
app.post('/api/twitch/config', (req: Request, res: Response) => {
  const uid = requireUid(req);
  twitch.guardarAjustes(uid, req.body || {});
  res.json(twitch.estado(uid));
});

// POST /api/twitch/disconnect -> corta y olvida las credenciales guardadas
app.post('/api/twitch/disconnect', (req: Request, res: Response) => {
  const uid = requireUid(req);
  twitch.borrarCuenta(uid);
  res.json(twitch.estado(uid));
});

// --- Carrera de balineras y puntos --------------------------------------
// Los espectadores se apuntan por el chat (que se lee sin credenciales) y los
// primeros se llevan puntos. Quien decide el orden es el servidor.

// --- Los minijuegos -----------------------------------------------------
// Sus 45 rutas viven en src/rutas/minijuegos.ts. Se monta AQUI, donde
// estaban: despues del middleware que pide sesion y antes de los estaticos,
// que es el orden en el que Express las prueba.
app.use(minijuegos.router);

// Serve static UI
app.use('/assets', express.static(ASSETS_DIR));
app.use('/', express.static(path.join(process.cwd(), 'public')));

carrera.iniciar({ userDir, ensureUserDir, writeJson, alCambiar: (uid) => avisos.cambio(uid, 'carrera') });
ruletachat.iniciar({ userDir, ensureUserDir, writeJson, alCambiar: (uid) => avisos.cambio(uid, 'nombres') });
// El tablero de clavijas reparte en el mismo marcador que la carrera.
plinko.iniciar({
  userDir, ensureUserDir, writeJson, sumarPuntos: carrera.sumarPuntos,
  alCambiar: (uid) => avisos.cambio(uid, 'plinko')
});
// La cuenta de partidas es de toda la instalacion, asi que vive con los datos
// comunes y no en la carpeta de cada usuario.
estadisticas.iniciar({ archivo: () => path.join(DATA_DIR, 'estadisticas.json'), writeJson });
widget.iniciar({ archivo: () => path.join(DATA_DIR, 'widgets.json'), writeJson });
// El arte de Dofus sale de la carpeta de datos de cada instalacion.
arte.iniciar({ assetsDir: () => ASSETS_DIR });
// La ruleta de objetos guarda su ultimo sorteo para el widget de OBS.
sorteo.iniciar({
  userDir, ensureUserDir, writeJson,
  alCambiar: (uid) => avisos.cambio(uid, 'sorteo')
});
// Y lo que las rutas de los minijuegos necesitan de aqui y no se pudo llevar.
minijuegos.iniciar({ requireUid, canalDe, guardarImagen });
// El rey de la colina no reparte nada: solo guarda su palabra y su record.
colina.iniciar({ userDir, ensureUserDir, writeJson, alCambiar: (uid) => avisos.cambio(uid, 'colina') });
// La batalla reparte en el mismo marcador que la carrera.
batalla.iniciar({
  userDir, ensureUserDir, writeJson, sumarPuntos: carrera.sumarPuntos,
  // Solo pelean las clases de Dofus que tienen imagen de prueba.
  clasesConArte: () => Object.keys(arte.deBatalla().clases),
  alCambiar: (uid) => avisos.cambio(uid, 'batalla')
});

// Las rondas que estaban abiertas cuando el servidor se apago. Se recuperan
// aqui, despues de que todos los minijuegos tengan sus dependencias puestas y
// antes de escuchar el puerto: asi la primera peticion que llegue ya ve la
// ronda en su sitio, en vez de encontrarse la partida vacia y volver a pintar
// el panel desde cero.
//
// Se vuelve a entrar en el chat de quien estuviera escuchando, asi que un
// reinicio a mitad de inscripcion es ahora un bache de unos segundos y no una
// ronda perdida. Ver vivo.ts.
function rehacerRondasVivas(): void {
  const cuenta: Record<string, number> = {};
  const cuales: [string, (uid: string) => boolean][] = [
    ['carrera', carrera.rehacer],
    ['plinko', plinko.rehacer],
    ['batalla', batalla.rehacer],
    ['colina', colina.rehacer],
    ['nombres', ruletachat.rehacer],
    ['sorteo', sorteo.rehacer]
  ];
  for (const u of readUsers()) {
    for (const [nombre, rehacer] of cuales) {
      try {
        if (rehacer(u.id)) cuenta[nombre] = (cuenta[nombre] || 0) + 1;
      } catch (err) {
        // Una cuenta con la foto rota no puede dejar sin recuperar a las
        // demas, ni impedir que el servidor arranque.
        console.error(`Failed to restore ${nombre} for ${u.id}:`, err);
      }
    }
  }
  const resumen = Object.entries(cuenta).map(([n, c]) => `${n}: ${c}`).join(', ');
  if (resumen) console.log(`Rondas recuperadas del reinicio -> ${resumen}`);
}

twitch.iniciar(
  {
    userDir,
    ensureUserDir,
    writeJson,
    sortearPara: sortearParaTwitch,
    servidoresDe: (uid: string) => readServers(uid, juegos.JUEGO_POR_DEFECTO)
  },
  {
    redirect: process.env.TWITCH_REDIRECT || `http://localhost:${PORT}/api/twitch/callback`,
    usuarios: readUsers().map((u) => u.id)
  }
);

rehacerRondasVivas();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
  migrarAssetsSubidos();
  console.log('Endpoints: GET /api/items  GET /api/random-items?n=1  POST /api/draw');
  console.log('           GET /api/exclusions  PUT /api/exclusions');
  console.log('           GET /api/tags  PUT /api/tags');
  console.log('           POST /api/auth/register  POST /api/auth/login  POST /api/auth/logout  GET /api/auth/me');
  console.log('           PATCH /api/auth/profile  POST /api/auth/password');
  console.log('           GET /api/servers  POST /api/servers  PATCH/DELETE /api/servers/:id');
  console.log('           (cada usuario tiene su propio Ruleton; dentro, ?server=<id>)');
  console.log('           GET /api/admin/users  PATCH/DELETE /api/admin/users/:id');
  console.log('           POST /api/admin/users/:id/logout  PUT /api/admin/invite');
  if (readUsers().length === 0) {
    console.log('Todavia no hay ninguna cuenta: la primera que se registre sera la duena');
    console.log('de los datos que ya hubiera en data/, y la administradora del acceso.');
  } else {
    asegurarAdmin();
    const admins = readUsers().filter((u) => u.admin).map((u) => u.username).join(', ');
    console.log(`Administra el acceso: ${admins} (Configuracion > Acceso).`);
    if (!inviteActual()) {
      console.log('Registros cerrados. Se abren poniendo un codigo en ese mismo panel.');
    }
  }
  console.log('           GET /api/settings  PUT /api/settings  POST /api/background');
  console.log('           GET /api/winners  POST /api/winners  DELETE /api/winners/:id');
  console.log('           POST /api/winners/:id/deliver  Body: { amount }  (entrega parcial)');
  console.log('           GET /api/ranking?limit=3&scope=global|stream|delivered  POST /api/stream/reset');
  console.log('           POST /api/ranking/reset');
});
