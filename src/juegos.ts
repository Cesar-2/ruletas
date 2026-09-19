// De que juego son los objetos. Hay dos, y no se parecen en nada por dentro:
//
//  - dofus3: la API de dofusdu.de, viva, en espanol y al dia. Es la de siempre.
//  - touch:  Dofus Touch. Aqui viene el problema: NO hay ninguna API viva de
//            Touch. La oficial (dofus-touch.com) contesta 403 a todo, y Dofapi,
//            que era la de la comunidad, esta muerta: sus dominios ni resuelven.
//            Lo unico que queda es un volcado de la enciclopedia que hizo la
//            herramienta crawlit, congelado en enero de 2019. Son datos de Touch
//            de verdad, pero con dos pegas que hay que saber: estan en frances y
//            les falta todo lo que Touch haya sacado desde 2019.
//
// Como las dos fuentes tienen forma distinta, cada juego trae su traductor al
// formato comun (el de dofus3, que es el que ya entendia la pagina). Asi nada
// de lo que hay aguas abajo (sorteo, rarezas, exclusiones) tiene que enterarse
// de donde salio cada objeto.

export const JUEGOS = ['dofus3', 'touch'] as const;
export type Juego = typeof JUEGOS[number];
export const JUEGO_POR_DEFECTO: Juego = 'dofus3';

export const NOMBRES: Record<Juego, string> = {
  dofus3: 'Dofus',
  touch: 'Dofus Touch'
};

// Lo que se le cuenta a la pagina de cada juego, para que pueda avisar de que
// el catalogo de Touch no esta al dia en vez de dejar al usuario pensando que
// le faltan objetos por un fallo.
export const AVISOS: Record<Juego, string> = {
  dofus3: '',
  touch: 'Catalogo de 2019 y en frances: es el ultimo volcado publico de Touch que existe.'
};

export type Familia = 'resources' | 'equipment';

interface Fuente {
  url: string;
  // Saca la lista de objetos de lo que haya contestado la fuente.
  lista(data: any): any[];
  // Traduce un objeto de la fuente al formato comun.
  normaliza(crudo: any): any | null;
}

// El formato comun es el de dofus3, asi que estos no tocan nada.
const dofus3 = (familia: Familia): Fuente => ({
  url: `https://api.dofusdu.de/dofus3/v1/es/items/${familia}/all`,
  // La API responde { items: [...] }; se admite tambien un array pelado.
  lista: (data) => (Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])),
  normaliza: (crudo) => crudo
});

// El volcado de crawlit: un array pelado de objetos con otros nombres de campo.
//
// Las imagenes traen dos problemas encadenados. Apuntan a s.ankama.com, un CDN
// que Ankama ya apago y cuyo nombre ni siquiera resuelve; la misma ruta sigue
// viva en static.ankama.com, pero ahi CloudFront contesta 403 en cuanto la
// peticion parece de un navegador (Referer y User-Agent), asi que enlazarlas
// desde la pagina no funciona: Chrome las bloquea por ORB.
//
// Por eso no se enlaza al CDN: se apunta a /api/img/touch/<tamano>/<id>.png,
// del propio Ruleton, que las baja como lo que es (un servidor, sin cabeceras
// de navegador) y las deja cacheadas. Todas las del volcado siguen este mismo
// patron, comprobado: no hay ninguna que se escape.
const RUTA_CDN = /^https:\/\/s\.ankama\.com\/www\/static\.ankama\.com\/dofus-touch\/www\/game\/items\/(\d+)\/(\d+)\.png$/;

// El CDN de verdad, al que llama el servidor (no la pagina).
export const CDN_TOUCH = 'https://static.ankama.com/dofus-touch/www/game/items';

function imagenTouch(url: unknown): string {
  const m = RUTA_CDN.exec(String(url ?? ''));
  return m ? `/api/img/touch/${m[1]}/${m[2]}.png` : '';
}

const touch = (familia: Familia): Fuente => ({
  url: `https://raw.githubusercontent.com/dofapi/crawlit-dofus-encyclopedia-parser/master/data/dofus-touch/${familia === 'resources' ? 'resource' : 'allequipments'}.json`,
  lista: (data) => (Array.isArray(data) ? data : []),
  normaliza: (crudo) => {
    const id = Number(crudo?._id);
    const nombre = String(crudo?.name ?? '').trim();
    // Sin id o sin nombre no hay objeto que valga: un objeto sin id no se puede
    // ni excluir ni marcar, asi que es mejor que no exista.
    if (!Number.isFinite(id) || !nombre) return null;
    const img = imagenTouch(crudo?.imgUrl);
    return {
      ankama_id: id,
      name: nombre,
      // En dofus3 el tipo es un objeto { name, id }; aqui solo hay el nombre.
      type: { name: String(crudo?.type ?? '') },
      level: Number(crudo?.lvl) || 0,
      // El volcado trae una sola imagen: se pone en los cuatro tamanos para no
      // obligar a la pagina a saber de que juego viene lo que esta pintando.
      image_urls: { icon: img, sd: img, hq: img, hd: img },
      description: String(crudo?.description ?? '')
    };
  }
});

const FUENTES: Record<Juego, Record<Familia, Fuente>> = {
  dofus3: { resources: dofus3('resources'), equipment: dofus3('equipment') },
  touch: { resources: touch('resources'), equipment: touch('equipment') }
};

export function fuente(juego: Juego, familia: Familia): Fuente {
  return FUENTES[juego][familia];
}

// El archivo de cache de un catalogo. Cada juego y familia tiene el suyo: son
// listas distintas y los ankama_id se repiten entre ellas.
export function archivoCache(juego: Juego, familia: Familia): string {
  const base = familia === 'resources' ? 'items' : 'equipment';
  return juego === JUEGO_POR_DEFECTO ? `${base}.json` : `${base}-${juego}.json`;
}

// El juego que pide una peticion. Nunca se fia de lo que llegue: si no es uno
// de los que hay, se cae al de siempre.
export function normalizar(valor: unknown): Juego {
  const v = String(valor ?? '').trim();
  return (JUEGOS as readonly string[]).includes(v) ? (v as Juego) : JUEGO_POR_DEFECTO;
}
