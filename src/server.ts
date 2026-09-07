import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
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
const ITEMS_URL = 'https://api.dofusdu.de/dofus3/v1/es/items/resources/all';
const DATA_DIR = path.join(process.cwd(), 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');   // catalogo, comun a todo
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
const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets');

// Cada usuario tiene su propio Ruleton: su aspecto, sus servidores, sus
// ganadores y su historial, y nadie mas los ve. Dentro de un usuario, los
// precios cambian de un servidor de Dofus a otro, asi que rarezas,
// exclusiones, ganadores y ranking se guardan por servidor. Lo unico comun a
// todos es el catalogo de objetos, que es una copia de la API de Dofus.
const SERVER_FILES = ['exclusions', 'tags', 'winners', 'ranking', 'stream'] as const;
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
function writeJson(file: string, data: unknown): void {
  const temporal = `${file}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporal, file);
}

function userDir(uid: string): string {
  return path.join(USERS_DIR, uid);
}

function settingsFile(uid: string): string {
  return path.join(userDir(uid), 'settings.json');
}

function serversFile(uid: string): string {
  return path.join(userDir(uid), 'servers.json');
}

function ensureUserDir(uid: string): void {
  ensureDataDir();
  const dir = userDir(uid);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Ambito de una peticion: "<usuario>/<servidor>". Se pasa entero a los lectores
// y escritores de datos, que solo lo usan para componer su ruta.
function partirAmbito(ambito: string): { uid: string; sid: string } {
  const corte = ambito.indexOf('/');
  return corte < 0
    ? { uid: ambito, sid: DEFAULT_SERVER.id }
    : { uid: ambito.slice(0, corte), sid: ambito.slice(corte + 1) };
}

function serverDir(ambito: string): string {
  const { uid, sid } = partirAmbito(ambito);
  return path.join(userDir(uid), 'servers', sid);
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
function usuarioDe(req: Request): User | null {
  const token = leerCookie(req, COOKIE_NAME);
  if (!token) return null;
  const ses = readSessions()[token];
  if (!ses || ses.expiresAt < Date.now()) return null;
  const user = readUsers().find((u) => u.id === ses.uid) || null;
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
  mover(path.join(base, 'servers.json'), serversFile(uid));
  mover(path.join(base, 'servers'), path.join(userDir(uid), 'servers'));
  fs.rmSync(path.join(DATA_DIR, 'profiles'), { recursive: true, force: true });
  fs.rmSync(path.join(DATA_DIR, 'profiles.json'), { force: true });
}

function readServers(uid: string): GameServer[] {
  ensureUserDir(uid);
  try {
    if (fs.existsSync(serversFile(uid))) {
      const parsed = JSON.parse(fs.readFileSync(serversFile(uid), 'utf8'));
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
  writeServers(uid, servers);
  migrarDatosSueltos(uid, DEFAULT_SERVER.id);
  return servers;
}

function writeServers(uid: string, servers: GameServer[]): void {
  ensureUserDir(uid);
  writeJson(serversFile(uid), { servers });
}

function migrarDatosSueltos(uid: string, sid: string): void {
  ensureServerDir(`${uid}/${sid}`);
  for (const name of SERVER_FILES) {
    const viejo = path.join(userDir(uid), `${name}.json`);
    const nuevo = serverFile(`${uid}/${sid}`, name);
    if (fs.existsSync(viejo) && !fs.existsSync(nuevo)) {
      try {
        fs.renameSync(viejo, nuevo);
        console.log(`Migrado ${name}.json -> usuario ${uid}, servidor ${sid}`);
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
  const servers = readServers(uid);
  const pedido = String((req.query?.server ?? (req.body as any)?.server ?? '')).trim();
  const encontrado = servers.find((s) => s.id === pedido);
  return `${uid}/${encontrado ? encontrado.id : servers[0].id}`;
}

async function fetchItemsCached(): Promise<any[]> {
  ensureDataDir();
  // Try to read cache
  try {
    if (fs.existsSync(ITEMS_FILE)) {
      const raw = fs.readFileSync(ITEMS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to read cached items:', err);
  }

  // Fetch from remote
  try {
    const res = await axios.get(ITEMS_URL, { timeout: 20000 });
    // API returns an object { items: [...] } so handle both cases
    const data = res.data;
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    if (!Array.isArray(items) || items.length === 0) {
      console.warn('Remote items response did not contain items; returning empty array');
      return [];
    }
    try {
      writeJson(ITEMS_FILE, items);
    } catch (err) {
      console.warn('Failed to write items cache:', err);
    }
    return items;
  } catch (err) {
    console.error('Failed to fetch items from remote API:', err);
    // If fetch fails but cache exists, return cache
    try {
      if (fs.existsSync(ITEMS_FILE)) {
        const raw = fs.readFileSync(ITEMS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error('Failed to read fallback cache:', e);
    }
    return [];
  }
}

function readExclusions(sid: string): string[] {
  ensureServerDir(sid);
  try {
    const f = serverFile(sid, 'exclusions');
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch (err) {
    console.error('Failed to read exclusions:', err);
  }
  return [];
}

function writeExclusions(sid: string, ids: string[]): void {
  ensureServerDir(sid);
  writeJson(serverFile(sid, 'exclusions'), ids);
}

type Rarity = 'rare' | 'epic' | 'mythic';
const RARITIES: Rarity[] = ['rare', 'epic', 'mythic'];

type Tags = Record<string, Rarity>;

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
  items: { id: string; name: string; value: number }[];
  date: string;
  draws?: number;   // cuantos sorteos se han acumulado en esta entrada
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
    readServers(id);   // nace con su servidor por defecto

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

// A partir de aqui, toda la API pide sesion. El catalogo tambien: es una app
// privada, no un servicio publico de consulta.
app.use('/api', (req: Request, res: Response, next: any) => {
  if (req.path === '/auth/me' || req.path === '/auth/login' ||
      req.path === '/auth/register' || req.path === '/auth/logout') return next();
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

// PATCH /api/auth/profile  Body: { name?, avatarDataUrl?, quitarAvatar? }
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

app.get('/api/items', async (_req: Request, res: Response) => {
  try {
    const items = await fetchItemsCached();
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: 'failed to get items' });
  }
});

// GET /api/servers -> { servers: GameServer[] }  (los del usuario que ha entrado)
app.get('/api/servers', (req: Request, res: Response) => {
  res.json({ servers: readServers(requireUid(req)) });
});

// POST /api/servers  Body: { name: string }  -> crea un servidor vacio
app.post('/api/servers', (req: Request, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const uid = requireUid(req);
    const servers = readServers(uid);
    if (servers.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'ya existe un servidor con ese nombre' });
    }
    let id = slugify(name);
    while (servers.some((s) => s.id === id)) id = `${id}-2`;

    const nuevo: GameServer = { id, name };
    ensureServerDir(`${uid}/${id}`);
    writeServers(uid, servers.concat(nuevo));
    res.json({ server: nuevo, servers: readServers(uid) });
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
    const servers = readServers(uid);
    const destino = servers.find((s) => s.id === req.params.id);
    if (!destino) return res.status(404).json({ error: 'server not found' });
    if (servers.some((s) => s.id !== destino.id && s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'ya existe un servidor con ese nombre' });
    }
    destino.name = name;
    writeServers(uid, servers);
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
    const servers = readServers(uid);
    if (!servers.some((s) => s.id === req.params.id)) {
      return res.status(404).json({ error: 'server not found' });
    }
    if (servers.length <= 1) {
      return res.status(409).json({ error: 'debe quedar al menos un servidor' });
    }
    const rest = servers.filter((s) => s.id !== req.params.id);
    writeServers(uid, rest);
    fs.rmSync(serverDir(`${uid}/${req.params.id}`), { recursive: true, force: true });
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
app.post('/api/winners', (req: Request, res: Response) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return res.status(400).json({ error: 'name is required' });

  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : 0;
  const items = Array.isArray(body.items)
    ? body.items.slice(0, 100).map((it: any) => ({
        id: String(it?.id ?? ''),
        name: String(it?.name ?? '').slice(0, 200),
        value: typeof it?.value === 'number' && Number.isFinite(it.value) ? it.value : 0
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

// PUT /api/settings  Body: campos parciales de Settings
app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body || {};
  const uid = requireUid(req);
  const current = readSettings(uid);
  const next: Settings = { ...current };

  // Un titulo vacio dejaria la cabecera en blanco: se ignora y se queda el actual.
  if (typeof body.pageTitle === 'string' && body.pageTitle.trim()) next.pageTitle = body.pageTitle.trim().slice(0, 80);
  // Subtitulo y logo si admiten quedarse vacios: es como se ocultan.
  if (typeof body.pageSubtitle === 'string') next.pageSubtitle = body.pageSubtitle.trim().slice(0, 140);
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
    const all = await fetchItemsCached();
    if (all.length === 0) return res.status(500).json({ error: 'no items available' });

    // Participan todos menos los excluidos. La rareza (raro/épico/mítico) es
    // solo una marca visual de "objeto caro" y no afecta al sorteo.
    const excluded = new Set(readExclusions(resolveServer(req)));
    const items = all.filter((it) => !excluded.has(getItemId(it)));
    if (items.length === 0) return res.status(409).json({ error: 'all items are excluded' });
    const shuffled = shuffle(items);
    const selected = shuffled.slice(0, Math.max(0, Math.min(n, shuffled.length)));
    res.json({ count: selected.length, items: selected });
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
    const items = await fetchItemsCached();
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

// Serve static UI
app.use('/', express.static(path.join(process.cwd(), 'public')));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
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
