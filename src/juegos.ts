// De que juego son los objetos.
//
// Ahora mismo solo hay uno, Dofus, que tira de la API de dofusdu.de: viva, en
// espanol y al dia. Hubo tambien Dofus Touch, y se quito: no existe ninguna
// fuente viva de Touch (la oficial contesta 403 y Dofapi esta muerta), y lo
// unico que quedaba era un volcado de 2019 en frances.
//
// Se deja montado como una lista de juegos, y no como una sola constante, por
// dos motivos: los datos de cada usuario ya viven separados por juego
// (juegos/<juego>/...), y volver a meter otro juego es anadirlo aqui con su
// traductor, sin tocar nada de lo que hay aguas abajo.

export const JUEGOS = ['dofus3'] as const;
export type Juego = typeof JUEGOS[number];
export const JUEGO_POR_DEFECTO: Juego = 'dofus3';

export const NOMBRES: Record<Juego, string> = {
  dofus3: 'Dofus'
};

// Lo que se le cuenta a la pagina de cada juego: un aviso, si su catalogo
// tiene alguna pega que convenga saber antes de mirarlo.
export const AVISOS: Record<Juego, string> = {
  dofus3: ''
};

// Las familias del catalogo: lo que se sortea (recursos), lo que se lleva
// puesto (equipables) y lo que solo cambia la pinta (cosmeticos).
export type Familia = 'resources' | 'equipment' | 'cosmetics';

interface Fuente {
  url: string;
  // Saca la lista de objetos de lo que haya contestado la fuente.
  lista(data: any): any[];
  // Traduce un objeto de la fuente al formato comun.
  normaliza(crudo: any): any | null;
}

// El formato comun es el de dofus3, asi que estos no tocan nada. Un juego con
// otra fuente traeria aqui su propio traductor.
const dofus3 = (familia: Familia): Fuente => ({
  url: `https://api.dofusdu.de/dofus3/v1/es/items/${familia}/all`,
  // La API responde { items: [...] }; se admite tambien un array pelado.
  lista: (data) => (Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])),
  normaliza: (crudo) => crudo
});

const FUENTES: Record<Juego, Record<Familia, Fuente>> = {
  dofus3: {
    resources: dofus3('resources'),
    equipment: dofus3('equipment'),
    cosmetics: dofus3('cosmetics')
  }
};

export function fuente(juego: Juego, familia: Familia): Fuente {
  return FUENTES[juego][familia];
}

// El archivo de cache de un catalogo. Cada juego y familia tiene el suyo: son
// listas distintas y los ankama_id se repiten entre ellas.
const NOMBRE_CACHE: Record<Familia, string> = {
  resources: 'items',
  equipment: 'equipment',
  cosmetics: 'cosmetics'
};

export function archivoCache(juego: Juego, familia: Familia): string {
  const base = NOMBRE_CACHE[familia];
  return juego === JUEGO_POR_DEFECTO ? `${base}.json` : `${base}-${juego}.json`;
}

// El juego que pide una peticion. Nunca se fia de lo que llegue: si no es uno
// de los que hay, se cae al de siempre.
export function normalizar(valor: unknown): Juego {
  const v = String(valor ?? '').trim();
  return (JUEGOS as readonly string[]).includes(v) ? (v as Juego) : JUEGO_POR_DEFECTO;
}
