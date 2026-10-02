// La copia entera de los datos, para llevarselos a otro servidor.
//
// Todo lo que hay que mover al cambiar de alojamiento esta en una carpeta: las
// cuentas, las sesiones, lo de cada usuario (ganadores, rarezas, puntos,
// ajustes), las imagenes que han subido y las claves de los widgets. Esto la
// empaqueta en un .tar.gz y la manda tal cual, sin escribir nada en disco: en
// un alojamiento puede no haber sitio ni permiso para dejar un archivo temporal
// del tamaño de todos los datos.
//
// Es un tar de los de siempre, hecho a mano porque el formato es corto y asi no
// hace falta ninguna dependencia: se abre con `tar xzf` en cualquier Linux o
// Mac y en Windows 10 en adelante. Dentro va todo colgando de una carpeta
// (data/), asi que restaurar es descomprimirlo en la raiz del Ruleton nuevo.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

const BLOQUE = 512;

export interface Resumen {
  archivos: number;
  carpetas: number;
  bytes: number;        // lo que ocupan los archivos, sin comprimir
}

// Lo que no se lleva: los temporales de una escritura a medias (ver json.ts).
// Copiarlos seria llevarse medio archivo que en el destino no es de nadie.
function seSalta(nombre: string): boolean {
  return nombre.endsWith('.tmp');
}

// Un campo numerico del tar: en octal, relleno de ceros y acabado en nulo.
function octal(n: number, ancho: number): string {
  return Math.max(0, Math.floor(n)).toString(8).padStart(ancho - 1, '0') + '\0';
}

// Parte un nombre largo en los dos campos que da el formato: 155 de carpeta y
// 100 de nombre, cortando por una barra. null si no cabe de ninguna manera.
function partir(nombre: string): { nombre: string; prefijo: string } | null {
  const total = Buffer.byteLength(nombre);
  if (total <= 100) return { nombre, prefijo: '' };
  for (let i = nombre.indexOf('/'); i !== -1; i = nombre.indexOf('/', i + 1)) {
    const prefijo = nombre.slice(0, i);
    const resto = nombre.slice(i + 1);
    if (!resto) break;
    if (Buffer.byteLength(prefijo) <= 155 && Buffer.byteLength(resto) <= 100) return { nombre: resto, prefijo };
  }
  return null;
}

function cabecera(nombre: string, prefijo: string, tamano: number, mtime: number, tipo: string): Buffer {
  const b = Buffer.alloc(BLOQUE);
  b.write(nombre, 0, 100, 'utf8');
  b.write(tipo === '5' ? '0000755\0' : '0000644\0', 100, 8, 'ascii');
  b.write(octal(0, 8), 108, 8, 'ascii');          // uid
  b.write(octal(0, 8), 116, 8, 'ascii');          // gid
  b.write(octal(tamano, 12), 124, 12, 'ascii');
  b.write(octal(mtime, 12), 136, 12, 'ascii');
  b.write('        ', 148, 8, 'ascii');           // la suma, en blanco mientras se calcula
  b.write(tipo, 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  b.write(prefijo, 345, 155, 'utf8');
  let suma = 0;
  for (let i = 0; i < BLOQUE; i++) suma += b[i];
  b.write(suma.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return b;
}

// Lo que falta para llegar al bloque: el tar va en trozos de 512.
function relleno(tamano: number): Buffer {
  const sobra = tamano % BLOQUE;
  return sobra ? Buffer.alloc(BLOQUE - sobra) : Buffer.alloc(0);
}

// Un nombre que no cabe en la cabecera de siempre (muy largo, o con letras que
// no son ASCII, que el formato viejo no sabe decir en que codificacion van) se
// pone delante en una cabecera extendida, que si lleva UTF-8 y no tiene tope.
function* extendida(nombre: string, mtime: number): Generator<Buffer> {
  const campo = ' path=' + nombre + '\n';
  // La linea empieza por su propia longitud, contandose a si misma.
  let largo = Buffer.byteLength(campo) + 1;
  while (String(largo).length + Buffer.byteLength(campo) !== largo) {
    largo = String(largo).length + Buffer.byteLength(campo);
  }
  const cuerpo = Buffer.from(largo + campo, 'utf8');
  yield cabecera('PaxHeader', '', cuerpo.length, mtime, 'x');
  yield cuerpo;
  yield relleno(cuerpo.length);
}

function* entrada(nombre: string, tamano: number, mtime: number, tipo: string): Generator<Buffer> {
  // eslint-disable-next-line no-control-regex
  const ascii = /^[\x00-\x7f]*$/.test(nombre);
  const partes = ascii ? partir(nombre) : null;
  if (partes) {
    yield cabecera(partes.nombre, partes.prefijo, tamano, mtime, tipo);
    return;
  }
  yield* extendida(nombre, mtime);
  // Quien no entienda la cabecera extendida vera este nombre, recortado.
  const corto = Buffer.from(nombre, 'utf8').subarray(0, 99).toString('latin1').replace(/[^\x20-\x7e]/g, '_');
  yield cabecera(corto, '', tamano, mtime, tipo);
}

// El tar, bloque a bloque. Va como generador para que quien lo consume marque
// el ritmo: no se lee el archivo siguiente hasta que el anterior ha salido, asi
// que en memoria hay como mucho un archivo a la vez.
export function* bloques(dir: string, raiz: string, resumen: Resumen): Generator<Buffer> {
  function* carpeta(real: string, dentro: string): Generator<Buffer> {
    let s: fs.Stats;
    try { s = fs.statSync(real); } catch (err) { return; }
    yield* entrada(dentro + '/', 0, s.mtimeMs / 1000, '5');
    resumen.carpetas++;

    // En orden, para que dos copias de lo mismo salgan iguales.
    const nombres = fs.readdirSync(real).sort();
    for (const n of nombres) {
      if (seSalta(n)) continue;
      const ruta = path.join(real, n);
      let st: fs.Stats;
      // lstat: un enlace no se sigue. Podria apuntar fuera de la carpeta, y
      // esto se lleva los datos del Ruleton, no lo que haya alrededor.
      try { st = fs.lstatSync(ruta); } catch (err) { continue; }
      if (st.isDirectory()) {
        yield* carpeta(ruta, dentro + '/' + n);
      } else if (st.isFile()) {
        let contenido: Buffer;
        // Se lee entero antes de escribir la cabecera: el tamaño que se anuncia
        // tiene que ser el de lo que va detras, y un archivo que alguien guarda
        // mientras tanto puede haber cambiado desde que se miro.
        try { contenido = fs.readFileSync(ruta); } catch (err) { continue; }
        yield* entrada(dentro + '/' + n, contenido.length, st.mtimeMs / 1000, '0');
        yield contenido;
        yield relleno(contenido.length);
        resumen.archivos++;
        resumen.bytes += contenido.length;
      }
    }
  }

  yield* carpeta(dir, raiz);
  // El final de un tar son dos bloques vacios.
  yield Buffer.alloc(BLOQUE * 2);
}

// Empaqueta la carpeta y la manda comprimida por «salida». Dentro del archivo
// todo cuelga de «raiz». La promesa acaba cuando ha salido el ultimo byte, y
// falla si la conexion se corta a mitad.
export async function enviar(dir: string, raiz: string, salida: Writable): Promise<Resumen> {
  const resumen: Resumen = { archivos: 0, carpetas: 0, bytes: 0 };
  await pipeline(Readable.from(bloques(dir, raiz, resumen), { objectMode: false }), zlib.createGzip(), salida);
  return resumen;
}

// Como se llama la copia: con la fecha y la hora de cuando se hizo, que es lo
// primero que se quiere saber al encontrarse dos.
export function nombreDeArchivo(cuando: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return 'ruleton-datos-' + cuando.getFullYear() + '-' + dos(cuando.getMonth() + 1) + '-' + dos(cuando.getDate())
    + '-' + dos(cuando.getHours()) + dos(cuando.getMinutes()) + '.tar.gz';
}
