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

export interface Uso {
  partidas: number;
  jugadores: number;    // cuantos participaron en total, sumando partidas
  ultima: string;       // cuando se jugo la ultima
}

export interface Registro {
  desde: string;        // desde cuando se lleva la cuenta
  juegos: Record<Juego, Uso>;
  porUsuario: Record<string, Record<string, number>>;
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
  return { desde: new Date().toISOString(), juegos, porUsuario: {} };
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
    const registro: Registro = {
      desde: typeof guardado.desde === 'string' && guardado.desde ? guardado.desde : base.desde,
      juegos: base.juegos,
      porUsuario: guardado.porUsuario && typeof guardado.porUsuario === 'object' ? guardado.porUsuario : {}
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
    const uso = registro.juegos[juego];
    uso.partidas += 1;
    uso.jugadores += Math.max(0, Math.floor(jugadores) || 0);
    uso.ultima = new Date().toISOString();
    if (uid) {
      const suyo = registro.porUsuario[uid] || {};
      suyo[juego] = (Number(suyo[juego]) || 0) + 1;
      registro.porUsuario[uid] = suyo;
    }
    deps.writeJson(deps.archivo(), registro);
  } catch (err) {
    console.error('Failed to write stats:', err);
  }
}
