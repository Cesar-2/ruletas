// Las rutas de los minijuegos: la carrera, la ruleta de nombres, el tablero de
// clavijas, la batalla, el rey de la colina y el marcador de puntos.
//
// Son 45 de las 106 rutas que tenia server.ts, que se habia puesto en 3.100
// lineas. Estaban todas seguidas, asi que salieron de un tirón.
//
// Las lineas van a columna cero, igual que estaban, y no dentro de una funcion:
// asi el traslado no le cambia la sangria a ninguna, y lo que se movio se puede
// comparar con lo de antes linea a linea. El router se arma al cargar el modulo
// y el contexto se pone despues con iniciar(), que es como funcionan ya todos
// los modulos de este proyecto.
//
// Las rutas se escriben enteras ('/api/carrera' y no '/carrera') y el router se
// monta en la raiz. Es a proposito: buscar '/api/colina' en el proyecto sigue
// encontrando su ruta, y no hay que ir a ver donde se monto esto para saber a
// que direccion responde.
//
// El orden importa. Express prueba las rutas en el orden en que se registran, y
// este modulo hay que montarlo donde estaban: despues del middleware que pide
// sesion y antes de los estaticos.

import { Router, Request, Response } from 'express';
import * as carrera from '../carrera';
import * as plinko from '../plinko';
import * as bingo from '../bingo';
import * as colina from '../colina';
import * as batalla from '../batalla';
import * as ruletachat from '../ruletachat';
import * as estadisticas from '../estadisticas';
import * as excel from '../excel';
import * as arte from '../arte';

// Lo que estas rutas necesitan de server.ts y no puede venirse con ellas.
export interface Contexto {
  // Quien ha entrado. Sale de la cookie de sesion, nunca del cliente.
  requireUid(req: Request): string;
  // El canal de Twitch de esa cuenta, o '' si no lo ha puesto.
  canalDe(uid: string): string;
  // Guarda una imagen subida en la carpeta de datos y devuelve su ruta.
  guardarImagen(dataUrl: unknown, prefijo: string): { url?: string; error?: string; code?: number };
  // Fija en el chat el aviso de una inscripcion recien abierta. No espera ni
  // falla: si Twitch no esta conectado no hace nada. Ver twitch.ts.
  fijarAviso(uid: string, canal: string, texto: string, segundos?: unknown): void;
  // El servidor del Ruleton en el que esta el streamer (uid/juego/servidor).
  // El bingo apunta ahi los premios.
  resolveServer(req: Request): string;
  // Crea o actualiza en Twitch la recompensa que vende cartones. Ver twitch.ts.
  recompensaBingo(uid: string, titulo: unknown, coste: unknown): Promise<{ ok: boolean; error?: string }>;
}

// El aviso que se fija al abrir la inscripcion de cada minijuego.
export function aviso(palabra: string, juego: string, extra = ''): string {
  return 'Escribe ' + palabra + ' para participar en ' + juego + (extra ? ' · ' + extra : '');
}

let ctx: Contexto;
export function iniciar(c: Contexto): void { ctx = c; }

export const router = Router();

// GET /api/carrera -> la carrera en curso y su resultado
router.get('/api/carrera', (req: Request, res: Response) => {
  res.json(carrera.estado(ctx.requireUid(req)));
});

// --- Ruleta de nombres: quien se apunta por el chat ---------------------

// GET /api/ruleta-chat -> quien lleva apuntado
router.get('/api/ruleta-chat', (req: Request, res: Response) => {
  res.json(ruletachat.estado(ctx.requireUid(req)));
});

// POST /api/ruleta-chat/abrir  Body: { palabra? }
router.post('/api/ruleta-chat/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    if (typeof req.body?.palabra === 'string') {
      ruletachat.guardarAjustes(uid, { palabra: req.body.palabra });
    }
    // Con «segundos», la inscripcion se cierra sola cuando se acaban.
    const abierta = ruletachat.abrir(uid, canal, undefined, req.body?.segundos);
    ctx.fijarAviso(uid, canal, aviso(ruletachat.estado(uid).palabra, 'la Ruleta de nombres'), req.body?.segundos);
    res.json(abierta);
  } catch (err) {
    console.error('Failed to open wheel signup:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open wheel signup' });
  }
});

// POST /api/ruleta-chat/cerrar -> se deja de escuchar; la lista se queda
router.post('/api/ruleta-chat/cerrar', (req: Request, res: Response) => {
  res.json(ruletachat.cerrar(ctx.requireUid(req)));
});

// POST /api/ruleta-chat/vaciar -> la pagina ya se llevo los nombres
router.post('/api/ruleta-chat/vaciar', (req: Request, res: Response) => {
  res.json(ruletachat.vaciar(ctx.requireUid(req)));
});

// POST /api/ruleta-chat/girada  Body: { cuantos, ganador?, duracion? }
// A diferencia del resto, a esta ruleta la gira la pagina: la lista de nombres
// vive en su cuadro de texto, asi que el servidor no conoce a los participantes
// y no puede elegir. Aqui no se decide ni se reparte nada.
//
// Lo que se hace es apuntar la partida para la estadistica del panel de admin y
// guardar lo que la pagina dice que ha salido, para que el widget de OBS pueda
// contarlo. El ganador no se devuelve a nadie hasta que la ruleta para de girar.
// Ver ruletachat.ts.
router.post('/api/ruleta-chat/girada', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const cuantos = Number(req.body?.cuantos) || 0;
  estadisticas.apuntar('nombres', uid, cuantos);
  ruletachat.guardarSorteo(uid, req.body);
  res.json({ ok: true });
});

// POST /api/ruleta-chat/doble  Body: { quien, gana, premio }
// El que ha ganado se juega el premio. Como el sorteo, lo tira la pagina; esto
// solo lo guarda para que el widget de OBS ensene el mismo video y el mismo
// cartel. No se calla el resultado: el video ya lo dice, porque ganar.mp4 y
// perder.mp4 son dos archivos distintos.
router.post('/api/ruleta-chat/doble', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  ruletachat.guardarDoble(uid, req.body);
  res.json({ ok: true });
});

// POST /api/ruleta-chat/config  Body: { palabra }
router.post('/api/ruleta-chat/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  try {
    ruletachat.guardarAjustes(uid, req.body || {});
    res.json(ruletachat.estado(uid));
  } catch (err) {
    console.error('Failed to save wheel signup settings:', err);
    res.status(500).json({ error: 'failed to save wheel signup settings' });
  }
});

// POST /api/carrera/abrir  Body: { canal, palabra? }
router.post('/api/carrera/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  // El canal sale del perfil (Configuracion > Mi cuenta).
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    // La palabra que venga manda, y se guarda: es la que se ve en el panel.
    if (typeof req.body?.palabra === 'string' && req.body.palabra.trim()) {
      carrera.guardarAjustes(uid, { palabra: req.body.palabra });
    }
    carrera.abrir(uid, canal, undefined, req.body?.segundos);
    const e = carrera.estado(uid);
    ctx.fijarAviso(uid, canal, aviso(e.ajustes.palabra, 'la Carrera de balineras'), req.body?.segundos);
    res.json(e);
  } catch (err) {
    console.error('Failed to open race:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open race' });
  }
});

// POST /api/carrera/apuntar  Body: { nombre }  (para añadir a mano)
router.post('/api/carrera/apuntar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const ok = carrera.apuntar(uid, String(req.body?.nombre || ''));
  if (!ok) return res.status(409).json({ error: 'no se pudo apuntar: repetido, vacio o carrera cerrada' });
  res.json(carrera.estado(uid));
});

// POST /api/carrera/correr -> cierra la inscripcion, decide y reparte puntos
router.post('/api/carrera/correr', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const antes = carrera.estado(uid);
  const hecha = carrera.correr(uid);
  if (!hecha) {
    // Se dice el motivo de verdad: si no, "faltan corredores" confunde cuando
    // lo que pasa es que esa carrera ya se corrio.
    const porque = !antes.abierta && antes.resultado.length
      ? 'esa carrera ya se corrio; abre otra'
      : 'hacen falta al menos dos corredores';
    return res.status(409).json({ error: porque });
  }
  estadisticas.apuntar('carrera', uid, hecha.corredores.length);
  res.json(hecha);
});

// POST /api/carrera/repetir -> otra carrera con los mismos corredores
router.post('/api/carrera/repetir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const otra = carrera.repetir(uid, ctx.canalDe(uid));
  if (!otra) return res.status(409).json({ error: 'no hay una carrera anterior con corredores' });
  res.json(carrera.estado(uid));
});

// POST /api/carrera/cancelar
router.post('/api/carrera/cancelar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  carrera.cancelar(uid);
  res.json(carrera.estado(uid));
});

// --- Tablero de clavijas ------------------------------------------------
// La bola la tira el servidor, como la carrera: aqui se simula la caida entera
// (gravedad, choques y rebotes) y la pagina solo la reproduce. La casilla no se
// elige: es donde acaba cayendo.

// GET /api/plinko -> la partida en curso, el tablero y los premios
router.get('/api/plinko', (req: Request, res: Response) => {
  res.json(plinko.estado(ctx.requireUid(req)));
});

// POST /api/plinko/abrir  Body: { palabra?, segundos? }
router.post('/api/plinko/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    if (typeof req.body?.palabra === 'string' && req.body.palabra.trim()) {
      plinko.guardarAjustes(uid, { palabra: req.body.palabra });
    }
    plinko.abrir(uid, canal, undefined, req.body?.segundos);
    const e = plinko.estado(uid);
    ctx.fijarAviso(uid, canal, aviso(e.ajustes.palabra, 'el Tablero de clavijas'), req.body?.segundos);
    res.json(e);
  } catch (err) {
    console.error('Failed to open plinko:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open plinko' });
  }
});

// POST /api/plinko/apuntar  Body: { nombre }  (para añadir a mano)
router.post('/api/plinko/apuntar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  if (!plinko.apuntar(uid, String(req.body?.nombre || ''))) {
    return res.status(409).json({ error: 'no se pudo apuntar: repetido, vacio o inscripcion cerrada' });
  }
  res.json(plinko.estado(uid));
});

// POST /api/plinko/tirar -> cierra la inscripcion, tira las bolas y reparte
router.post('/api/plinko/tirar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const antes = plinko.estado(uid);
  const hecha = plinko.tirar(uid);
  if (!hecha) {
    const porque = !antes.abierta && antes.tiradas.length
      ? 'esas bolas ya se tiraron; abre otra ronda'
      : 'no hay nadie apuntado';
    return res.status(409).json({ error: porque });
  }
  estadisticas.apuntar('plinko', uid, hecha.tiradas.length);
  res.json(plinko.estado(uid));
});

// POST /api/plinko/repetir -> otra ronda con los mismos
router.post('/api/plinko/repetir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  if (!plinko.repetir(uid, ctx.canalDe(uid))) {
    return res.status(409).json({ error: 'no hay una ronda anterior con jugadores' });
  }
  res.json(plinko.estado(uid));
});

// POST /api/plinko/cancelar
router.post('/api/plinko/cancelar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  plinko.cancelar(uid);
  res.json(plinko.estado(uid));
});

// POST /api/plinko/imagen  Body: { dataUrl }  -> guarda la imagen de un premio
// Devuelve solo la ruta: en los ajustes del tablero se guarda eso, no la
// imagen entera, que si no el archivo de ajustes acabaria pesando megas.
router.post('/api/plinko/imagen', (req: Request, res: Response) => {
  ctx.requireUid(req);
  const guardada = ctx.guardarImagen(req.body?.dataUrl, 'premio');
  if (guardada.error) return res.status(guardada.code || 400).json({ error: guardada.error });
  res.json({ url: guardada.url });
});

// POST /api/plinko/config  Body: { puntos?, palabra?, filas?, multiplicadores?, modo?, premios? }
router.post('/api/plinko/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  try {
    plinko.guardarAjustes(uid, req.body || {});
    res.json(plinko.estado(uid));
  } catch (err) {
    console.error('Failed to save plinko settings:', err);
    res.status(500).json({ error: 'failed to save plinko settings' });
  }
});

// --- Bingo --------------------------------------------------------------
// Las bolas las saca el servidor y los cartones los reparte el servidor. La
// pagina solo ensena lo que hay y pide la siguiente bola. Ver bingo.ts.

// GET /api/bingo -> la partida, los cartones y cuanto le falta a cada uno
router.get('/api/bingo', (req: Request, res: Response) => {
  res.json(bingo.estado(ctx.requireUid(req)));
});

// POST /api/bingo/abrir  Body: { segundos? } -> partida nueva, se piden cartones
router.post('/api/bingo/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    // Los premios van a Ganadores del servidor en el que se abre la partida.
    bingo.abrir(uid, canal, req.body?.segundos, ctx.resolveServer(req));
    const e = bingo.estado(uid);
    // La direccion de los cartones, con el dominio por el que ha entrado el
    // streamer: es el mismo por el que entraran los espectadores.
    const donde = req.protocol + '://' + req.get('host') + '/bingo?p=' + e.codigo;
    // Los cartones se compran con puntos de canal: el aviso dice que canjear.
    const comprar = e.recompensa
      ? 'Canjea «' + e.recompensa + '» con tus puntos del canal para comprar cartón del Bingo'
      : 'Se abre el Bingo';
    ctx.fijarAviso(uid, canal, comprar + ' · mira tu cartón en ' + donde, req.body?.segundos);
    res.json(e);
  } catch (err) {
    console.error('Failed to open bingo:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open bingo' });
  }
});

// POST /api/bingo/apuntar  Body: { nombre }  (para dar un carton mas a mano)
router.post('/api/bingo/apuntar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const r = bingo.darCarton(uid, String(req.body?.nombre || ''));
  if (!r.ok) return res.status(409).json({ error: 'no se pudo dar carton: ' + r.motivo });
  res.json(bingo.estado(uid));
});

// POST /api/bingo/recompensa  Body: { titulo, coste } -> crea (o actualiza) en
// Twitch la recompensa de puntos con la que se compran cartones.
router.post('/api/bingo/recompensa', async (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const r = await ctx.recompensaBingo(uid, req.body?.titulo, req.body?.coste);
  if (!r.ok) return res.status(409).json({ error: r.error });
  res.json(bingo.estado(uid));
});

// POST /api/bingo/sacar -> la siguiente bola
router.post('/api/bingo/sacar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const primera = !bingo.estado(uid).salidas.length;
  const r = bingo.sacar(uid);
  if ('error' in r) return res.status(409).json({ error: r.error });
  // La partida cuenta para la estadistica al empezar a jugarse, no al abrir:
  // abrir y cancelar sin sacar ninguna bola no es haber jugado.
  if (primera) estadisticas.apuntar('bingo', uid, bingo.estado(uid).jugadores.length);
  res.json(bingo.estado(uid));
});

// POST /api/bingo/cantar  Body: { nombre, que: 'linea' | 'bingo' }  -> cantar por
// alguien a mano. Se juzga igual que si lo hubiera escrito en el chat: si no lo
// tiene, fuera.
router.post('/api/bingo/cantar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const que = req.body?.que === 'linea' ? 'linea' : 'bingo';
  const nombre = String(req.body?.nombre || '');
  const canto = bingo.cantar(uid, nombre, que);
  if (!canto) return res.status(409).json({ error: bingo.porQueNoCanta(uid, nombre, que) });
  res.json(bingo.estado(uid));
});

// POST /api/bingo/cancelar
router.post('/api/bingo/cancelar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  bingo.cancelar(uid);
  res.json(bingo.estado(uid));
});

// POST /api/bingo/config  Body: { maxCartones?, cantar?, cantarLinea?, puntosLinea?, puntosBingo?,
//                                 premioLinea?: { kamas, texto }, premioBingo? }
router.post('/api/bingo/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  try {
    bingo.guardarAjustes(uid, req.body || {});
    res.json(bingo.estado(uid));
  } catch (err) {
    console.error('Failed to save bingo settings:', err);
    res.status(500).json({ error: 'failed to save bingo settings' });
  }
});

// POST /api/carrera/config  Body: { puntos?, duracion?, palabra?, animacion? }
router.post('/api/carrera/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  try {
    carrera.guardarAjustes(uid, req.body || {});
    res.json(carrera.estado(uid));
  } catch (err) {
    console.error('Failed to save race settings:', err);
    res.status(500).json({ error: 'failed to save race settings' });
  }
});

// GET /api/batalla -> como va el torneo, y el arte de prueba que haya
router.get('/api/batalla', (req: Request, res: Response) => {
  res.json({ ...batalla.estado(ctx.requireUid(req)), arte: arte.deBatalla() });
});

// POST /api/batalla/abrir -> abre la inscripcion y escucha el chat
router.post('/api/batalla/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  // El canal sale del perfil, como en la carrera.
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    if (typeof req.body?.palabra === 'string' && req.body.palabra.trim()) {
      batalla.guardarAjustes(uid, { palabra: req.body.palabra });
    }
    batalla.abrir(uid, canal, req.body?.segundos);
    const e = batalla.estado(uid);
    ctx.fijarAviso(uid, canal, aviso(e.palabra, 'la Batalla Dofus'), req.body?.segundos);
    res.json(e);
  } catch (err) {
    console.error('Failed to open battle:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open battle' });
  }
});

// POST /api/batalla/entrar  Body: { nombre }  (para apuntar a mano)
router.post('/api/batalla/entrar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const r = batalla.entrar(uid, String(req.body?.nombre || ''));
  if (!r.ok) return res.status(409).json({ error: r.error });
  res.json(batalla.estado(uid));
});

// --- Rey de la colina ---------------------------------------------------
// Una cola de retadores contra el que manda. Aqui no se reparten puntos: solo
// se pelea, y lo que se persigue es la racha de victorias.

// GET /api/colina -> la cola, el rey y el ultimo combate, con el arte
router.get('/api/colina', (req: Request, res: Response) => {
  res.json({ ...colina.estado(ctx.requireUid(req)), arte: arte.deBatalla() });
});

// POST /api/colina/abrir -> abre la cola y escucha el chat
router.post('/api/colina/abrir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const canal = ctx.canalDe(uid);
  if (!canal) {
    return res.status(409).json({ error: 'pon tu canal de Twitch en Configuracion > Mi cuenta' });
  }
  try {
    if (typeof req.body?.palabra === 'string' && req.body.palabra.trim()) {
      colina.guardarAjustes(uid, { palabra: req.body.palabra });
    }
    colina.abrir(uid, canal);
    estadisticas.apuntar('colina', uid, 0);
    ctx.fijarAviso(uid, canal, aviso(colina.estado(uid).palabra, 'el Rey de la colina'));
    res.json({ ...colina.estado(uid), arte: arte.deBatalla() });
  } catch (err) {
    console.error('Failed to open hill:', err);
    res.status(500).json({ error: (err as Error).message || 'failed to open hill' });
  }
});

// POST /api/colina/entrar  Body: { nombre }  (para meter a alguien a mano)
router.post('/api/colina/entrar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const r = colina.entrar(uid, String(req.body?.nombre || ''));
  if (!r.ok) return res.status(409).json({ error: r.error });
  res.json(colina.estado(uid));
});

// POST /api/colina/sacar  Body: { nombre }  -> lo quita de la cola
router.post('/api/colina/sacar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.sacar(uid, String(req.body?.nombre || ''));
  res.json(colina.estado(uid));
});

// POST /api/colina/siguiente -> pelea el rey contra el primero de la cola
router.post('/api/colina/siguiente', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  // Con un combate contandose no empieza otro. No es un fallo: es otra pantalla
  // (otra pestaña, un moderador) que ha llegado antes. Se dice aparte para que
  // la pagina se ponga a mirar ese combate en vez de sacar un aviso.
  if (colina.ocupada(uid)) {
    return res.status(409).json({ error: 'todavia se esta contando el combate anterior', ocupada: true });
  }
  const c = colina.siguiente(uid);
  if (!c) return res.status(409).json({ error: 'no hay con quien pelear todavia' });
  res.json(colina.estado(uid));
});

// POST /api/colina/fincombate -> la pagina ya ha acabado de contar el combate
// Hasta que avisa, los dos que peleaban no pueden volver a la cola: se les
// esta viendo pelear todavia.
router.post('/api/colina/fincombate', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.finCombate(uid);
  res.json(colina.estado(uid));
});

// POST /api/colina/destronar -> baja al rey sin pelear
router.post('/api/colina/destronar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.destronar(uid);
  res.json(colina.estado(uid));
});

// POST /api/colina/cerrar -> se acabo: deja de escuchar y se olvida la partida
router.post('/api/colina/cerrar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.cerrar(uid);
  res.json(colina.estado(uid));
});

// POST /api/colina/record/borrar -> olvida el record historico
router.post('/api/colina/record/borrar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.borrarRecord(uid);
  res.json(colina.estado(uid));
});

// POST /api/colina/config  Body: { palabra }
router.post('/api/colina/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  colina.guardarAjustes(uid, req.body || {});
  res.json(colina.estado(uid));
});

// --- Cajas misteriosas --------------------------------------------------
// Se crea una caja con objetos del catalogo dentro, se subasta sin ensenar lo
// que lleva y quien la gana decide si abrirla. El contenido NO sale de aqui
// mientras la caja siga cerrada: el panel se ve en directo y lo leeria el chat.

// POST /api/batalla/empezar -> cierra la inscripcion y monta la primera ronda
router.post('/api/batalla/empezar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const b = batalla.empezar(uid);
  if (!b) return res.status(409).json({ error: 'hacen falta al menos dos, y que no haya empezado' });
  estadisticas.apuntar('batalla', uid, b.luchadores.length);
  res.json(b);
});

// POST /api/batalla/ronda -> resuelve la ronda pendiente
router.post('/api/batalla/ronda', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const b = batalla.resolverRonda(uid);
  if (!b) return res.status(409).json({ error: 'no hay ninguna ronda pendiente' });
  res.json(b);
});

// POST /api/batalla/duelo  Body: { duelo }  -> pelea solo ese combate
// Para soltarlos de uno en uno en directo. La ronda no avanza hasta que estan
// todos peleados.
router.post('/api/batalla/duelo', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const cual = Number(req.body?.duelo);
  if (!Number.isInteger(cual) || cual < 0) {
    return res.status(400).json({ error: 'hace falta decir que combate' });
  }
  const b = batalla.resolverDuelo(uid, cual);
  if (!b) return res.status(409).json({ error: 'ese combate no se puede pelear ahora' });
  res.json(b);
});

// POST /api/batalla/repetir -> otro torneo con los mismos luchadores
router.post('/api/batalla/repetir', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const otra = batalla.repetir(uid);
  if (!otra) return res.status(409).json({ error: 'no hay un torneo anterior con luchadores' });
  res.json(otra);
});

// POST /api/batalla/cancelar
router.post('/api/batalla/cancelar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  batalla.cancelar(uid);
  res.json(batalla.estado(uid));
});

// POST /api/batalla/config  Body: { puntos }
router.post('/api/batalla/config', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  batalla.guardarAjustes(uid, req.body || {});
  res.json(batalla.estado(uid));
});

// GET /api/puntos?limite=N -> la tabla de puntos
router.get('/api/puntos', (req: Request, res: Response) => {
  const limite = Math.max(1, Math.min(1000, Number(req.query.limite) || 20));
  res.json({ puntos: carrera.tabla(ctx.requireUid(req), limite) });
});

// PUT /api/puntos  Body: { nombre, puntos } -> pone esa cantidad exacta
router.put('/api/puntos', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  if (!carrera.ponerPuntos(uid, String(req.body?.nombre || ''), req.body?.puntos)) {
    return res.status(400).json({ error: 'hace falta un nombre' });
  }
  res.json({ puntos: carrera.tabla(uid, 1000) });
});

// POST /api/puntos/sumar  Body: { nombre, cuantos } -> suma o resta
router.post('/api/puntos/sumar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'hace falta un nombre' });
  carrera.sumarPuntos(uid, nombre, Math.floor(Number(req.body?.cuantos) || 0));
  res.json({ puntos: carrera.tabla(uid, 1000) });
});

// POST /api/puntos/importar  Body: { dataUrl, aplicar? }
// Mete en el marcador los puntos de una hoja de calculo (la que exporta
// Botrix, por ejemplo). Las columnas se buscan por su nombre y no por su
// posicion, asi que da igual el orden y da igual que la hoja venga en ingles.
//
// A quien no este en el marcador se le crea con esos puntos; a quien ya este,
// se le suman a los que tenga. Nunca se pisa lo que alguien llevara ganado.
//
// Sin "aplicar" no toca nada: contesta lo que haria, para poder mirarlo antes.
router.post('/api/puntos/importar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  const aplicar = req.body?.aplicar === true;

  const dataUrl = String(req.body?.dataUrl || '');
  const match = /^data:[^;]*;base64,(.+)$/.exec(dataUrl);
  if (!match) return res.status(400).json({ error: 'hace falta el archivo' });

  let tabla;
  try {
    tabla = excel.leerTabla(Buffer.from(match[1], 'base64'));
  } catch (err) {
    console.error('Failed to read spreadsheet:', err);
    return res.status(400).json({ error: 'no se pudo leer el archivo: ¿es un .xlsx?' });
  }

  const colNombre = excel.columna(tabla.cabeceras, ['username', 'usuario', 'nombre', 'user', 'name']);
  const colPuntos = excel.columna(tabla.cabeceras, ['points', 'puntos', 'point', 'punto']);
  if (!colNombre || !colPuntos) {
    return res.status(400).json({
      error: 'la hoja necesita una columna de nombre y otra de puntos.'
        + ` Tiene: ${tabla.cabeceras.join(', ') || '(ninguna)'}`
    });
  }

  // Lo que de verdad se puede usar: con nombre y con un numero por puntos.
  const ahora = carrera.leerPuntos(uid);
  const buenas: { nombre: string; puntos: number; tenia: number | null }[] = [];
  let sinNombre = 0;
  let sinNumero = 0;
  for (const fila of tabla.filas) {
    const nombre = String(fila[colNombre] || '').trim().slice(0, 40);
    if (!nombre) { sinNombre++; continue; }
    const crudo = String(fila[colPuntos] || '').replace(/[.\s]/g, '').replace(',', '.');
    const puntos = Number(crudo);
    if (!Number.isFinite(puntos)) { sinNumero++; continue; }
    const tenia = ahora[nombre.toLowerCase()]?.puntos;
    buenas.push({ nombre, puntos: Math.max(0, Math.floor(puntos)), tenia: tenia ?? null });
  }

  const resumen = {
    columnas: { nombre: colNombre, puntos: colPuntos },
    cabeceras: tabla.cabeceras,
    filas: tabla.filas.length,
    validas: buenas.length,
    sinNombre,
    sinNumero,
    yaEstaban: buenas.filter((b) => b.tenia !== null).length,
    nuevos: buenas.filter((b) => b.tenia === null).length,
    suma: buenas.reduce((t, b) => t + b.puntos, 0),
    muestra: buenas.slice(0, 8)
  };

  if (!aplicar) return res.json({ ...resumen, aplicado: false });

  // Suma siempre: a quien no estaba, sumarle sobre cero es crearlo.
  for (const b of buenas) carrera.sumarPuntos(uid, b.nombre, b.puntos);
  res.json({ ...resumen, aplicado: true, puntos: carrera.tabla(uid, 1000) });
});

// DELETE /api/puntos/:nombre -> lo quita del marcador
router.delete('/api/puntos/:nombre', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  if (!carrera.borrarPuntos(uid, String(req.params.nombre))) {
    return res.status(404).json({ error: 'no esta en el marcador' });
  }
  res.json({ puntos: carrera.tabla(uid, 1000) });
});

// POST /api/puntos/vaciar -> deja el marcador a cero
router.post('/api/puntos/vaciar', (req: Request, res: Response) => {
  const uid = ctx.requireUid(req);
  carrera.vaciarPuntos(uid);
  res.json({ puntos: carrera.tabla(uid, 1000) });
});
