import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
// El limite por defecto (100kb) no admite la subida de una imagen de fondo.
app.use(express.json({ limit: '16mb' }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ITEMS_URL = 'https://api.dofusdu.de/dofus3/v1/es/items/resources/all';
const DATA_DIR = path.join(process.cwd(), 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const EXCLUSIONS_FILE = path.join(DATA_DIR, 'exclusions.json');
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const WINNERS_FILE = path.join(DATA_DIR, 'winners.json');
const RANKING_FILE = path.join(DATA_DIR, 'ranking.json');
const ASSETS_DIR = path.join(process.cwd(), 'public', 'assets');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
      fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8');
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

function readExclusions(): string[] {
  ensureDataDir();
  try {
    if (fs.existsSync(EXCLUSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(EXCLUSIONS_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch (err) {
    console.error('Failed to read exclusions:', err);
  }
  return [];
}

function writeExclusions(ids: string[]): void {
  ensureDataDir();
  fs.writeFileSync(EXCLUSIONS_FILE, JSON.stringify(ids, null, 2), 'utf8');
}

type Rarity = 'rare' | 'epic' | 'mythic';
const RARITIES: Rarity[] = ['rare', 'epic', 'mythic'];

type Tags = Record<string, Rarity>;

function readTags(): Tags {
  ensureDataDir();
  try {
    if (fs.existsSync(TAGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Tags;
    }
  } catch (err) {
    console.error('Failed to read tags:', err);
  }
  return {};
}

function writeTags(tags: Tags): void {
  ensureDataDir();
  fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2), 'utf8');
}

interface Settings {
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

function readSettings(): Settings {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
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

function writeSettings(settings: Settings): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface Winner {
  id: string;
  name: string;
  total: number;
  items: { id: string; name: string; value: number }[];
  date: string;
  draws?: number;   // cuantos sorteos se han acumulado en esta entrada
}

// Para detectar al mismo ganador aunque cambie mayusculas o tildes.
function normalizeName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function readWinners(): Winner[] {
  ensureDataDir();
  try {
    if (fs.existsSync(WINNERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(WINNERS_FILE, 'utf8'));
      // Se descartan entradas corruptas para que un archivo mal escrito a mano
      // no tumbe los endpoints que recorren la lista.
      if (Array.isArray(parsed)) return parsed.filter((w) => w && typeof w.name === 'string');
    }
  } catch (err) {
    console.error('Failed to read winners:', err);
  }
  return [];
}

function writeWinners(winners: Winner[]): void {
  ensureDataDir();
  fs.writeFileSync(WINNERS_FILE, JSON.stringify(winners, null, 2), 'utf8');
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

function readArchive(): Archive {
  ensureDataDir();
  try {
    if (fs.existsSync(RANKING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RANKING_FILE, 'utf8'));
      if (parsed?.version === 2 && parsed.entries) return parsed as Archive;

      // Formato antiguo: el total incluia a los pendientes. Se les resta para
      // que el archivo quede solo con lo entregado y no se duplique.
      const entries: Record<string, RankEntry> = { ...(parsed || {}) };
      for (const w of readWinners()) {
        const key = normalizeName(w.name);
        const actual = entries[key];
        if (!actual) continue;
        const total = Math.max(0, actual.total - (w.total ?? 0));
        const draws = Math.max(0, actual.draws - (w.draws ?? 1));
        if (total === 0 && draws === 0) delete entries[key];
        else entries[key] = { ...actual, total, draws };
      }
      const migrado: Archive = { version: 2, entries };
      writeArchive(migrado);
      console.log('Ranking migrado al formato nuevo (archivo = solo entregados)');
      return migrado;
    }
  } catch (err) {
    console.error('Failed to read ranking archive:', err);
  }
  return { version: 2, entries: {} };
}

function writeArchive(archive: Archive): void {
  ensureDataDir();
  fs.writeFileSync(RANKING_FILE, JSON.stringify(archive, null, 2), 'utf8');
}

// Entregado + pendiente. Es lo que consume GET /api/ranking.
function computeRanking(): RankEntry[] {
  const total: Record<string, RankEntry> = {};
  for (const [key, e] of Object.entries(readArchive().entries)) {
    total[key] = { ...e };
  }
  for (const w of readWinners()) {
    sumarEntrada(total, w.name, w.total ?? 0, w.draws ?? 1);
  }
  return Object.values(total).sort((a, b) => b.total - a.total || b.draws - a.draws);
}

function archivarGanador(w: Winner): void {
  const archive = readArchive();
  sumarEntrada(archive.entries, w.name, w.total ?? 0, w.draws ?? 1);
  writeArchive(archive);
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

app.get('/api/items', async (_req: Request, res: Response) => {
  try {
    const items = await fetchItemsCached();
    res.json({ count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: 'failed to get items' });
  }
});

// GET /api/exclusions -> { ids: string[] }
app.get('/api/exclusions', (_req: Request, res: Response) => {
  res.json({ ids: readExclusions() });
});

// PUT /api/exclusions  Body: { ids: string[] }
app.put('/api/exclusions', (req: Request, res: Response) => {
  const ids: string[] | null = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id: unknown) => String(id))
    : null;
  if (!ids) return res.status(400).json({ error: 'body must be { ids: string[] }' });
  try {
    const unique = Array.from(new Set(ids));
    writeExclusions(unique);
    res.json({ ids: unique });
  } catch (err) {
    console.error('Failed to write exclusions:', err);
    res.status(500).json({ error: 'failed to save exclusions' });
  }
});

// GET /api/ranking?limit=3 -> { ranking: RankEntry[] } ordenado por total
app.get('/api/ranking', (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 50);
  res.json({ ranking: computeRanking().slice(0, limit) });
});

// GET /api/winners -> { winners: Winner[] }  (mas recientes primero)
app.get('/api/winners', (_req: Request, res: Response) => {
  res.json({ winners: readWinners() });
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

  try {
    const winners = readWinners();
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

    writeWinners(winners);
    // No se toca el archivo: mientras esta pendiente ya cuenta para el ranking.
    res.json({ winner, merged: Boolean(existente), winners });
  } catch (err) {
    console.error('Failed to save winner:', err);
    res.status(500).json({ error: 'failed to save winner' });
  }
});

// DELETE /api/winners/:id  (se usa al entregar el premio)
app.delete('/api/winners/:id', (req: Request, res: Response) => {
  try {
    const winners = readWinners();
    const entregado = winners.find((w) => w.id === req.params.id);
    if (!entregado) return res.status(404).json({ error: 'winner not found' });
    const rest = winners.filter((w) => w.id !== req.params.id);
    writeWinners(rest);
    // Al salir de pendientes pasa al archivo, para no perderlo del ranking.
    archivarGanador(entregado);
    res.json({ winners: rest });
  } catch (err) {
    console.error('Failed to delete winner:', err);
    res.status(500).json({ error: 'failed to delete winner' });
  }
});

// GET /api/settings -> { settings: Settings }
app.get('/api/settings', (_req: Request, res: Response) => {
  res.json({ settings: readSettings() });
});

// PUT /api/settings  Body: campos parciales de Settings
app.put('/api/settings', (req: Request, res: Response) => {
  const body = req.body || {};
  const current = readSettings();
  const next: Settings = { ...current };

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
    writeSettings(next);
    res.json({ settings: next });
  } catch (err) {
    console.error('Failed to write settings:', err);
    res.status(500).json({ error: 'failed to save settings' });
  }
});

// POST /api/background  Body: { dataUrl: "data:image/png;base64,...", target? }
// target: 'background' (por defecto) o 'wheel'. Guarda la imagen en
// public/assets y la deja activa en el ajuste correspondiente.
app.post('/api/background', (req: Request, res: Response) => {
  const dataUrl: unknown = req.body?.dataUrl;
  const target = req.body?.target === 'wheel' ? 'wheel' : 'background';
  if (typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'body must be { dataUrl: string }' });
  }

  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(dataUrl);
  if (!match) return res.status(400).json({ error: 'unsupported image format' });

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 12 * 1024 * 1024) {
    return res.status(413).json({ error: 'image too large (max 12MB)' });
  }

  try {
    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
    const filename = `fondo-${target}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(ASSETS_DIR, filename), buffer);

    const settings = readSettings();
    if (target === 'wheel') settings.wheelUrl = `/assets/${filename}`;
    else settings.backgroundUrl = `/assets/${filename}`;
    writeSettings(settings);
    res.json({ settings });
  } catch (err) {
    console.error('Failed to save background:', err);
    res.status(500).json({ error: 'failed to save background' });
  }
});

// GET /api/tags -> { tags: { [itemId]: 'rare' | 'epic' | 'mythic' } }
app.get('/api/tags', (_req: Request, res: Response) => {
  res.json({ tags: readTags() });
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
    writeTags(clean);
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
    const excluded = new Set(readExclusions());
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
  console.log('           GET /api/settings  PUT /api/settings  POST /api/background');
  console.log('           GET /api/winners  POST /api/winners  DELETE /api/winners/:id');
  console.log('           GET /api/ranking?limit=3');
});
