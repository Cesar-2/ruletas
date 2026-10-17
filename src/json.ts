// Leer y escribir los JSON de datos.
//
// Dos cosas que van juntas y por eso viven aqui:
//
//   escribir()  guarda sin poder dejarlo a medias: se escribe entero en un
//               archivo temporal y se renombra encima, que es atomico. Si el
//               proceso muere a mitad, el archivo bueno sigue intacto.
//   leer()      lo devuelve de SOLO MIRAR, guardandoselo para no ir al disco en
//               cada peticion.
//
// El cache existe por una razon medida. Saber quien pregunta pide leer las
// sesiones y los usuarios, y eso pasaba dos veces por peticion: una en el
// middleware y otra en requireUid. Cuatro lecturas con su JSON.parse, sincronas,
// o sea bloqueando el bucle de eventos. En una instalacion de verdad:
//
//   leer los dos archivos y parsearlos   0,779 ms
//   mirar solo su fecha y su tamaño      0,043 ms
//
// O sea 1,56 ms por peticion que pasan a 0,04.
//
// Lo que sale de leer() esta congelado. No es elegancia: el cache lo comparten
// todas las peticiones, asi que quien tocara lo que se le devuelve se lo estaria
// cambiando a las demas, y lo que se ve al mirar dependeria de lo que hizo otra
// peticion. Congelado, ese fallo salta en el momento de escribir en vez de
// aparecer semanas despues como un dato que no cuadra.
//
// Quien vaya a MODIFICAR no usa leer(): lee el archivo por su cuenta y se queda
// con algo suyo que puede tocar a gusto. Eso es lo que hacen readUsers() y
// readSessions() en server.ts, y por eso siguen yendo al disco.

import fs from 'fs';

interface Guardado {
  mtimeMs: number;
  size: number;
  dato: unknown;
}

const cache = new Map<string, Guardado>();

// Lo guardado de ese archivo deja de valer.
export function olvidar(file: string): void {
  cache.delete(file);
}

// Todo el cache. Para los tests y para cuando algo de fuera toca la carpeta.
export function olvidarTodo(): void {
  cache.clear();
}

export function congelar<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) congelar(v);
  }
  return x;
}

// Cuantas escrituras lleva este proceso, para que cada una tenga su temporal.
let escrituras = 0;

export function escribir(file: string, data: unknown): void {
  // El temporal es de esta escritura y de este proceso. Con un nombre fijo
  // (archivo.tmp), dos procesos sobre los mismos datos se lo pisaban: pasa en
  // un hosting mientras conviven la version vieja y la nueva de un despliegue,
  // las dos escuchando el mismo chat. Uno renombraba el temporal y el otro, al
  // ir a renombrarlo, ya no lo encontraba (ENOENT), o renombraba lo que habia
  // escrito el otro.
  const temporal = `${file}.${process.pid}.${++escrituras}.tmp`;
  try {
    fs.writeFileSync(temporal, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporal, file);
  } catch (err) {
    // Que no quede el temporal tirado en la carpeta de datos.
    try { fs.unlinkSync(temporal); } catch (e) { /* ya no estaba */ }
    throw err;
  }
  // Se olvida aqui, en el unico sitio por el que pasa toda escritura, y no
  // confiando en que la fecha del archivo cambie: la fecha tiene poca precision
  // y dos escrituras seguidas del mismo tamaño pueden parecer la misma.
  olvidar(file);
}

// El contenido, de solo mirar y congelado. null si no hay archivo o no se
// entiende. La fecha y el tamaño valen de respaldo por si el archivo lo cambia
// algo de fuera: una edicion a mano, o el script que restaura una copia.
export function leer<T>(file: string): T | null {
  try {
    const s = fs.statSync(file);
    const guardado = cache.get(file);
    if (guardado && guardado.mtimeMs === s.mtimeMs && guardado.size === s.size) {
      return guardado.dato as T;
    }
    const dato = congelar(JSON.parse(fs.readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: s.mtimeMs, size: s.size, dato });
    return dato as T;
  } catch (err) {
    // Que no haya archivo todavia es lo normal la primera vez, asi que no se
    // cuenta como fallo. Un archivo roto tampoco puede tumbar la peticion: se
    // contesta que no hay nada, que es lo que hacia antes cada lector.
    olvidar(file);
    return null;
  }
}
