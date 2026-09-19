// Cuantas veces se juega a cada minijuego. Es solo para el panel de admin:
// no se le ensena a nadie mas, no sale en la pagina de los jugadores y no
// influye en ningun sorteo ni en ningun reparto de puntos.
//
// Se cuentan partidas de verdad, no visitas: una partida es haberla jugado
// (el sorteo hecho, la carrera corrida, el torneo empezado, las bolas
// soltadas). Abrir la inscripcion y no jugar no cuenta.
//
// Es de toda la instalacion, no de cada usuario, porque quien lo mira es el
// dueno; aun asi se guarda tambien el desglose por cuenta, que es lo que
// contesta a «quien juega a que».
//
// Hay dos capas, y conviene no confundirlas:
//
//  - Los contadores de siempre (partidas, jugadores, ultima). Son de toda la
//    vida de la instalacion y no se pierden nunca.
//  - El historial: una linea por partida, con cuando se jugo y cuanta gente
//    entro. De aqui salen las metricas que necesitan tiempo (tendencia, horas
//    punta, medias). Esta capa empieza el dia que se instala, asi que al
//    principio dira menos de lo que dicen los contadores: eso no es un fallo,
//    y el panel lo avisa.

import fs from 'fs';

export const JUEGOS = ['sorteo', 'nombres', 'carrera', 'batalla', 'plinko'] as const;
export type Juego = typeof JUEGOS[number];

export const NOMBRES: Record<Juego, string> = {
  sorteo: 'Ruleta de objetos',
  nombres: 'Ruleta de nombres',
  carrera: 'Carrera de balineras',
  batalla: 'Batalla Dofus',
  plinko: 'Tablero de clavijas'
};

// Cuantas partidas se guardan con detalle. Con 20.000 hay de sobra para anos
// de uso, y el archivo se queda en pocos megas; al pasarse se tiran las mas
// viejas, que las cifras de siempre ya estan en los contadores.
const TOPE_HISTORIAL = 20000;

export interface Uso {
  partidas: number;
  jugadores: number;    // cuantos participaron en total, sumando partidas
  ultima: string;       // cuando se jugo la ultima
}

// Una partida, con lo justo para no engordar el archivo: juego, usuario,
// cuantos jugaron y cuando.
export interface Evento {
  j: Juego;
  u: string;
  n: number;
  t: string;
}

export interface Registro {
  desde: string;        // desde cuando se lleva la cuenta
  juegos: Record<Juego, Uso>;
  porUsuario: Record<string, Record<string, number>>;
  historial: Evento[];
  // Desde cuando hay historial. En una instalacion que ya venia jugando es
  // posterior a «desde», y por eso se guarda aparte: sin esto, las medias por
  // dia saldrian repartidas sobre un periodo en el que no se apuntaba nada.
  historialDesde: string;
}

export interface Dependencias {
  archivo(): string;
  writeJson(file: string, data: unknown): void;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

function vacio(): Registro {
  const juegos = {} as Record<Juego, Uso>;
  JUEGOS.forEach((j) => { juegos[j] = { partidas: 0, jugadores: 0, ultima: '' }; });
  const ahora = new Date().toISOString();
  return { desde: ahora, juegos, porUsuario: {}, historial: [], historialDesde: ahora };
}

export function leer(): Registro {
  const base = vacio();
  try {
    const f = deps.archivo();
    if (!fs.existsSync(f)) return base;
    const guardado = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!guardado || typeof guardado !== 'object') return base;
    // Se rellena sobre el vacio: asi un archivo de una version con menos
    // juegos sigue valiendo, y uno con juegos que ya no existen no estorba.
    const historial: Evento[] = Array.isArray(guardado.historial)
      ? guardado.historial
        .filter((e: any) => e && JUEGOS.includes(e.j) && typeof e.t === 'string')
        .map((e: any) => ({ j: e.j as Juego, u: String(e.u || ''), n: Number(e.n) || 0, t: String(e.t) }))
      : [];
    const registro: Registro = {
      desde: typeof guardado.desde === 'string' && guardado.desde ? guardado.desde : base.desde,
      juegos: base.juegos,
      porUsuario: guardado.porUsuario && typeof guardado.porUsuario === 'object' ? guardado.porUsuario : {},
      historial,
      // Si el archivo es de antes del historial, este empieza ahora: las
      // partidas viejas estan en los contadores pero no se pueden fechar.
      historialDesde: typeof guardado.historialDesde === 'string' && guardado.historialDesde
        ? guardado.historialDesde
        : (historial.length ? historial[0].t : base.historialDesde)
    };
    JUEGOS.forEach((j) => {
      const u = guardado.juegos?.[j];
      if (!u) return;
      registro.juegos[j] = {
        partidas: Number(u.partidas) || 0,
        jugadores: Number(u.jugadores) || 0,
        ultima: typeof u.ultima === 'string' ? u.ultima : ''
      };
    });
    return registro;
  } catch (err) {
    console.error('Failed to read stats:', err);
    return base;
  }
}

// Una partida jugada. Nunca debe tumbar lo que se estaba haciendo: si no se
// puede apuntar, se queda sin apuntar y el juego sigue.
export function apuntar(juego: Juego, uid: string, jugadores = 0): void {
  try {
    if (!JUEGOS.includes(juego)) return;
    const registro = leer();
    const cuantos = Math.max(0, Math.floor(jugadores) || 0);
    const cuando = new Date().toISOString();

    const uso = registro.juegos[juego];
    uso.partidas += 1;
    uso.jugadores += cuantos;
    uso.ultima = cuando;
    if (uid) {
      const suyo = registro.porUsuario[uid] || {};
      suyo[juego] = (Number(suyo[juego]) || 0) + 1;
      registro.porUsuario[uid] = suyo;
    }

    registro.historial.push({ j: juego, u: uid || '', n: cuantos, t: cuando });
    if (registro.historial.length > TOPE_HISTORIAL) {
      registro.historial = registro.historial.slice(-TOPE_HISTORIAL);
      // Si se han tirado partidas, el historial ya no empieza donde decia.
      registro.historialDesde = registro.historial[0].t;
    }

    deps.writeJson(deps.archivo(), registro);
  } catch (err) {
    console.error('Failed to write stats:', err);
  }
}

// --- Metricas -------------------------------------------------------------
// Todo lo que sigue se calcula al vuelo desde el historial. No se guarda nada
// derivado: asi no hay dos verdades que puedan discrepar.

const DIA = 24 * 60 * 60 * 1000;

// El dia local de una fecha, en aaaa-mm-dd. Local y no UTC a proposito: una
// partida de las once de la noche es de ese dia para quien la jugo, no del
// siguiente.
function diaDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export interface UsoJuego extends Uso {
  id: Juego;
  nombre: string;
  // Media de gente por partida: dice el tiron que tiene, no solo cuantas
  // veces se lanza. Sale de los contadores de siempre, asi que cuenta toda
  // la vida de la instalacion.
  mediaJugadores: number;
  // Lo de estos ultimos 30 dias y lo de los 30 anteriores, para ver si sube
  // o baja. Esto si sale del historial.
  recientes: number;
  previas: number;
}

export interface Resumen {
  desde: string;
  historialDesde: string;
  // Si el historial no cubre todo, el panel avisa de que las tendencias miran
  // menos partidas que los totales.
  historialParcial: boolean;
  totales: {
    partidas: number;
    jugadores: number;
    partidasConHistorial: number;
    recientes: number;      // ultimos 30 dias
    previas: number;        // los 30 anteriores
    diasActivos: number;
    mediaPorDiaActivo: number;
    racha: number;          // dias seguidos jugando, contando hasta hoy
  };
  juegos: UsoJuego[];
  porDia: { dia: string; partidas: number; jugadores: number }[];
  porHora: number[];        // 24 casillas
  porDiaSemana: number[];   // 7 casillas, empezando en lunes
  usuarios: {
    id: string;
    username?: string;
    juegos: Record<string, number>;
    total: number;
    ultima: string;
  }[];
}

// nombres: como se llama cada cuenta, para no ensenar identificadores sueltos.
// Las cuentas que ya no existen se quedan fuera.
export function resumen(nombres: Map<string, string>): Resumen {
  const registro = leer();
  const ahora = Date.now();
  const hist = registro.historial;

  const enVentana = (desdeDias: number, hastaDias: number) =>
    hist.filter((e) => {
      const t = new Date(e.t).getTime();
      return t > ahora - desdeDias * DIA && t <= ahora - hastaDias * DIA;
    });

  const recientes = enVentana(30, 0);
  const previas = enVentana(60, 30);

  // Los ultimos 30 dias, incluidos los que no se jugo: un hueco en la grafica
  // dice tanto como un pico, y sin rellenar no se veria.
  const porDia: Resumen['porDia'] = [];
  const cuenta = new Map<string, { partidas: number; jugadores: number }>();
  for (const e of hist) {
    const d = diaDe(e.t);
    if (!d) continue;
    const c = cuenta.get(d) || { partidas: 0, jugadores: 0 };
    c.partidas += 1;
    c.jugadores += e.n;
    cuenta.set(d, c);
  }
  for (let i = 29; i >= 0; i--) {
    const dia = diaDe(new Date(ahora - i * DIA).toISOString());
    const c = cuenta.get(dia);
    porDia.push({ dia, partidas: c?.partidas || 0, jugadores: c?.jugadores || 0 });
  }

  // A que hora y que dia de la semana se juega: para saber cuando esta la
  // gente, que es lo que decide a que hora montar el directo.
  const porHora = new Array(24).fill(0);
  const porDiaSemana = new Array(7).fill(0);
  for (const e of hist) {
    const d = new Date(e.t);
    if (Number.isNaN(d.getTime())) continue;
    porHora[d.getHours()] += 1;
    // getDay() empieza en domingo; aqui se empieza en lunes, que es como se
    // lee una semana.
    porDiaSemana[(d.getDay() + 6) % 7] += 1;
  }

  // Racha: dias seguidos con alguna partida, contando hacia atras. Se admite
  // que hoy todavia no se haya jugado, que si no la racha se rompe cada
  // madrugada.
  const jugados = new Set(hist.map((e) => diaDe(e.t)));
  let racha = 0;
  const hoy = diaDe(new Date(ahora).toISOString());
  for (let i = jugados.has(hoy) ? 0 : 1; ; i++) {
    if (!jugados.has(diaDe(new Date(ahora - i * DIA).toISOString()))) break;
    racha++;
  }

  const juegos: UsoJuego[] = JUEGOS.map((j) => {
    const uso = registro.juegos[j];
    return {
      id: j,
      nombre: NOMBRES[j],
      ...uso,
      mediaJugadores: uso.partidas ? Math.round((uso.jugadores / uso.partidas) * 10) / 10 : 0,
      recientes: recientes.filter((e) => e.j === j).length,
      previas: previas.filter((e) => e.j === j).length
    };
  });

  // Cuando jugo cada cuenta por ultima vez: sale del historial, asi que de
  // quien no haya jugado desde que existe se queda vacio.
  const ultimaDe = new Map<string, string>();
  for (const e of hist) if (e.u) ultimaDe.set(e.u, e.t);

  const usuarios = Object.entries(registro.porUsuario)
    .filter(([uid]) => nombres.has(uid))
    .map(([uid, suyos]) => ({
      id: uid,
      username: nombres.get(uid),
      juegos: suyos,
      total: Object.values(suyos).reduce((a, b) => a + (Number(b) || 0), 0),
      ultima: ultimaDe.get(uid) || ''
    }))
    .sort((a, b) => b.total - a.total);

  const partidas = juegos.reduce((s, j) => s + j.partidas, 0);
  const diasActivos = jugados.size;

  return {
    desde: registro.desde,
    historialDesde: registro.historialDesde,
    historialParcial: hist.length < partidas,
    totales: {
      partidas,
      jugadores: juegos.reduce((s, j) => s + j.jugadores, 0),
      partidasConHistorial: hist.length,
      recientes: recientes.length,
      previas: previas.length,
      diasActivos,
      mediaPorDiaActivo: diasActivos ? Math.round((hist.length / diasActivos) * 10) / 10 : 0,
      racha
    },
    juegos,
    porDia,
    porHora,
    porDiaSemana,
    usuarios
  };
}
