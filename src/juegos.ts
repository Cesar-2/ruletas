// De que juego son los objetos. Hay dos, y por dentro no se parecen en nada:
//
//  - dofus3: la API de dofusdu.de, viva, en espanol y al dia. Es la de siempre.
//  - touch:  Dofus Touch. Aqui no hay ninguna fuente viva: la oficial contesta
//            403 y Dofapi esta muerta (su API ni acepta conexiones, comprobado).
//            Lo unico que queda es el volcado que hizo la herramienta crawlit,
//            congelado en enero de 2019. Son datos de Touch de verdad, pero en
//            frances y sin nada de lo que haya salido despues. Se deja puesto
//            aposta: el dia que aparezca una fuente en espanol se cambia la URL
//            y su traductor, y todo lo de abajo sigue igual.
//
// Como las dos fuentes tienen forma distinta, cada juego trae su traductor al
// formato comun (el de dofus3, que es el que ya entendia la pagina). Asi nada
// de lo que hay aguas abajo (sorteo, rarezas, exclusiones, cajas, minijuegos)
// tiene que enterarse de donde salio cada objeto. Y los datos de cada usuario
// viven separados por juego (juegos/<juego>/...), asi que los servidores, las
// rarezas y los ganadores de Touch no se mezclan con los de Dofus.

export const JUEGOS = ['dofus3', 'touch'] as const;
export type Juego = typeof JUEGOS[number];
export const JUEGO_POR_DEFECTO: Juego = 'dofus3';

export const NOMBRES: Record<Juego, string> = {
  dofus3: 'Dofus',
  touch: 'Dofus Touch'
};

// Lo que se le cuenta a la pagina de cada juego: un aviso, si su catalogo
// tiene alguna pega que convenga saber antes de mirarlo.
export const AVISOS: Record<Juego, string> = {
  dofus3: '',
  touch: 'Solo recursos. Los nombres y las descripciones se toman de Dofus cuando el objeto existe en los dos; lo que no tiene pareja se queda en frances, como vino.'
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

// Los archivos del volcado, por familia. Cosmeticos no tiene: el volcado no
// separa nada parecido, y una familia sin archivo es un catalogo vacio, no un
// fallo.
const ARCHIVO_TOUCH: Record<Familia, string> = {
  resources: 'resource',
  equipment: 'allequipments',
  cosmetics: ''
};

const touch = (familia: Familia): Fuente => ({
  url: ARCHIVO_TOUCH[familia]
    ? `https://raw.githubusercontent.com/dofapi/crawlit-dofus-encyclopedia-parser/master/data/dofus-touch/${ARCHIVO_TOUCH[familia]}.json`
    : '',
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
  dofus3: {
    resources: dofus3('resources'),
    equipment: dofus3('equipment'),
    cosmetics: dofus3('cosmetics')
  },
  touch: {
    resources: touch('resources'),
    equipment: touch('equipment'),
    cosmetics: touch('cosmetics')
  }
};

export function fuente(juego: Juego, familia: Familia): Fuente {
  return FUENTES[juego][familia];
}

// --- Touch en espanol ---------------------------------------------------
// El volcado de Touch esta en frances y no hay ninguna fuente de Touch en
// espanol: la oficial contesta 403 y Dofapi esta muerta. Pero los ankama_id
// son los mismos en los dos juegos, asi que a un recurso de Touch se le puede
// poner el nombre y la descripcion que ese mismo id tiene en Dofus.
//
// Solo el nombre y la descripcion. El nivel, el tipo y la imagen son los de
// Touch de verdad y pueden no coincidir con los de Dofus de hoy: pisarlos
// seria enseñar datos falsos con cara de ciertos.
//
// Lo que no tenga pareja se queda en frances, tal cual vino. Es mejor un
// catalogo a medio traducir que uno con nombres inventados.
export function traducirRecursos(deTouch: any[], deDofus: any[]): any[] {
  if (!Array.isArray(deTouch) || !Array.isArray(deDofus) || !deDofus.length) return deTouch;
  const porId = new Map<number, any>();
  for (const x of deDofus) {
    const id = Number(x?.ankama_id);
    if (Number.isFinite(id)) porId.set(id, x);
  }
  return deTouch.map((item) => {
    const par = porId.get(Number(item?.ankama_id));
    if (!par) return item;
    const nombre = String(par.name ?? '').trim();
    if (!nombre) return item;
    const desc = String(par.description ?? '').trim();
    return {
      ...item,
      name: nombre,
      // Una descripcion vacia en Dofus no borra la que traia Touch.
      description: desc || item.description,
      // De donde salio el nombre, por si alguna vez hay que distinguirlo.
      traducido: true
    };
  });
}

// Cuantos de una lista quedaron traducidos: para poder contarlo en el aviso
// del catalogo sin volver a recorrerlo por fuera.
export function cuantosTraducidos(items: any[]): number {
  return Array.isArray(items) ? items.filter((x) => x?.traducido).length : 0;
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
