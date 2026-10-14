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
// Ni los restos de restaurar una copia (ver restaurar, mas abajo): lo que se
// aparto y lo que se estaba montando no son datos de la instalacion.
function seSalta(nombre: string): boolean {
  return nombre.endsWith('.tmp') || nombre === ANTERIOR || nombre.startsWith(MONTANDO);
}

// Lo que se aparta al restaurar y lo que se esta montando.
const ANTERIOR = '.anterior';
const MONTANDO = '.restaurando-';

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

// --- La vuelta: subir una copia y dejarla puesta --------------------------
//
// Es lo contrario de `enviar`: llega el .tar.gz que salio de aqui y la carpeta
// de datos queda como estaba cuando se hizo. Sirve para estrenar un alojamiento
// sin entrar por consola, que en muchos ni se puede.
//
// Un archivo subido viene de fuera, asi que no se le cree nada:
//
//  - Solo se escribe DENTRO de la carpeta de datos. Un nombre con «..», una
//    ruta absoluta o una letra de unidad no es una copia rara: es alguien
//    intentando escribir donde no debe, y se rechaza el archivo entero.
//  - Solo archivos y carpetas. Los enlaces no se restauran: `enviar` no los
//    mete, asi que uno que venga no lo puso esto.
//  - Antes de tocar nada se comprueba que es una copia del Ruleton y que trae
//    al menos una cuenta. Subir por error otro .tar.gz no puede dejar la
//    instalacion vacia y sin nadie que pueda entrar a arreglarlo.
//  - Lo que habia no se borra: se aparta en «.anterior», dentro de la misma
//    carpeta, por si la copia subida no era la buena. Solo se guarda la ultima.

// El fallo de una copia que no vale. Se distingue de un fallo de disco porque
// a quien la sube hay que decirle que el archivo es el problema, no el servidor.
export class CopiaMala extends Error {}

export interface Restaurado {
  archivos: number;
  carpetas: number;
  bytes: number;
  cuentas: number;
}

interface Entrada {
  ruta: string[];          // los trozos del nombre, ya sin la carpeta raiz
  carpeta: boolean;
  contenido: Buffer;
}

function textoDe(b: Buffer, desde: number, largo: number): string {
  const trozo = b.subarray(desde, desde + largo);
  const fin = trozo.indexOf(0);
  return trozo.subarray(0, fin === -1 ? largo : fin).toString('utf8');
}

// Un nombre del tar, comprobado y partido. null si es de los que se saltan;
// lanza si es de los que no pueden venir en una copia de verdad.
function rutaSegura(nombre: string, raiz: string): string[] | null {
  if (nombre.includes('\0') || nombre.includes('\\') || nombre.startsWith('/') || /^[a-zA-Z]:/.test(nombre)) {
    throw new CopiaMala('la copia trae una ruta que no es suya: ' + nombre.slice(0, 80));
  }
  const trozos = nombre.split('/').filter((t) => t !== '');
  if (trozos.some((t) => t === '.' || t === '..')) {
    throw new CopiaMala('la copia trae una ruta que no es suya: ' + nombre.slice(0, 80));
  }
  if (trozos[0] !== raiz) {
    throw new CopiaMala('esto no parece una copia del Ruleton: dentro no cuelga todo de ' + raiz + '/');
  }
  const dentro = trozos.slice(1);
  if (dentro.some((t) => seSalta(t))) return null;
  return dentro;
}

// Lee el tar entero. Entiende lo que escribe `enviar` (cabeceras normales,
// nombres partidos y la extendida de los nombres raros) y ademas el nombre
// largo al estilo GNU, por si alguien rehizo la copia con su `tar`.
export function leerTar(tar: Buffer, raiz: string): Entrada[] {
  const entradas: Entrada[] = [];
  let i = 0;
  let nombreLargo = '';
  while (i + BLOQUE <= tar.length) {
    const cab = tar.subarray(i, i + BLOQUE);
    if (cab.every((b) => b === 0)) break;
    let suma = 0;
    for (let k = 0; k < BLOQUE; k++) suma += (k >= 148 && k < 156) ? 32 : cab[k];
    if (parseInt(textoDe(tar, i + 148, 8).trim(), 8) !== suma) {
      throw new CopiaMala('el archivo esta dañado o no es una copia del Ruleton');
    }
    const tamano = parseInt(textoDe(tar, i + 124, 12).trim() || '0', 8);
    if (!Number.isFinite(tamano) || tamano < 0 || i + BLOQUE + tamano > tar.length) {
      throw new CopiaMala('el archivo esta cortado: le falta el final');
    }
    const tipo = String.fromCharCode(cab[156]);
    const prefijo = textoDe(tar, i + 345, 155);
    const nombre = nombreLargo || ((prefijo ? prefijo + '/' : '') + textoDe(tar, i, 100));
    const cuerpo = tar.subarray(i + BLOQUE, i + BLOQUE + tamano);
    i += BLOQUE + Math.ceil(tamano / BLOQUE) * BLOQUE;

    if (tipo === 'x') {
      // Lineas «largo clave=valor\n»; solo interesa el nombre.
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(cuerpo.toString('utf8'));
      nombreLargo = m ? m[1] : '';
      continue;
    }
    if (tipo === 'L') {
      nombreLargo = textoDe(cuerpo, 0, cuerpo.length);
      continue;
    }
    nombreLargo = '';
    // Lo global de pax no dice nada de ningun archivo.
    if (tipo === 'g') continue;
    const esCarpeta = tipo === '5';
    const esArchivo = tipo === '0' || tipo === '\0';
    // Enlaces y demas: no se restauran.
    if (!esCarpeta && !esArchivo) continue;
    const ruta = rutaSegura(nombre, raiz);
    // La propia carpeta raiz no hay que crearla: es la de datos.
    if (!ruta || !ruta.length) continue;
    entradas.push({ ruta, carpeta: esCarpeta, contenido: esCarpeta ? Buffer.alloc(0) : Buffer.from(cuerpo) });
  }
  return entradas;
}

// Cuantas cuentas trae la copia. Lanza si no trae ninguna: restaurar eso seria
// dejar la instalacion sin nadie que pueda entrar.
function cuentasDe(entradas: Entrada[]): number {
  const users = entradas.find((e) => !e.carpeta && e.ruta.length === 1 && e.ruta[0] === 'users.json');
  if (!users) throw new CopiaMala('esto no parece una copia del Ruleton: no trae las cuentas');
  let lista: unknown;
  try {
    const leido = JSON.parse(users.contenido.toString('utf8'));
    lista = Array.isArray(leido) ? leido : leido?.users;
  } catch (err) {
    throw new CopiaMala('la copia trae las cuentas rotas');
  }
  const buenas = Array.isArray(lista)
    ? lista.filter((u: any) => u && typeof u.id === 'string' && typeof u.username === 'string' && u.hash && u.salt)
    : [];
  if (!buenas.length) throw new CopiaMala('la copia no trae ninguna cuenta: al restaurarla no podria entrar nadie');
  return buenas.length;
}

// Lo mas que se descomprime. Una instalacion de verdad son unos megas (casi
// todo, imagenes); esto es para que un archivo hecho con mala idea, que ocupa
// kilobytes y se infla a gigas, no deje al servidor sin memoria.
export const TOPE_DESCOMPRIMIDO = 512 * 1024 * 1024;

// Deja la carpeta de datos como dice la copia. Devuelve lo que ha puesto.
//
// Va por pasos para que un fallo a medias no deje la instalacion a medias:
// primero se monta todo aparte, y solo cuando esta entero se aparta lo que
// habia y se pone lo nuevo. Si el cambio falla, se devuelve lo de antes.
export function restaurar(gz: Buffer, dataDir: string, raiz = 'data'): Restaurado {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(gz, { maxOutputLength: TOPE_DESCOMPRIMIDO });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new CopiaMala(code === 'ERR_BUFFER_TOO_LARGE'
      ? 'la copia es demasiado grande'
      : 'el archivo no es un .tar.gz, o esta dañado');
  }
  const entradas = leerTar(tar, raiz);
  const cuentas = cuentasDe(entradas);

  fs.mkdirSync(dataDir, { recursive: true });
  // Restos de una restauracion que se cortara.
  for (const n of fs.readdirSync(dataDir)) {
    if (n.startsWith(MONTANDO)) fs.rmSync(path.join(dataDir, n), { recursive: true, force: true });
  }

  const montando = path.join(dataDir, MONTANDO + Date.now().toString(36));
  const hecho: Restaurado = { archivos: 0, carpetas: 0, bytes: 0, cuentas };
  try {
    fs.mkdirSync(montando);
    for (const e of entradas) {
      const destino = path.join(montando, ...e.ruta);
      // Ya se miro el nombre, pero esto es lo que de verdad se va a escribir.
      if (!destino.startsWith(montando + path.sep)) throw new CopiaMala('la copia trae una ruta que no es suya');
      if (e.carpeta) {
        fs.mkdirSync(destino, { recursive: true });
        hecho.carpetas++;
      } else {
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, e.contenido);
        hecho.archivos++;
        hecho.bytes += e.contenido.length;
      }
    }
  } catch (err) {
    fs.rmSync(montando, { recursive: true, force: true });
    throw err;
  }

  // El cambio. Lo que habia va a «.anterior»; lo montado ocupa su sitio.
  const anterior = path.join(dataDir, ANTERIOR);
  const apartados: string[] = [];
  const puestos: string[] = [];
  try {
    fs.rmSync(anterior, { recursive: true, force: true });
    fs.mkdirSync(anterior);
    for (const n of fs.readdirSync(dataDir)) {
      if (n === ANTERIOR || n.startsWith(MONTANDO)) continue;
      fs.renameSync(path.join(dataDir, n), path.join(anterior, n));
      apartados.push(n);
    }
    for (const n of fs.readdirSync(montando)) {
      fs.renameSync(path.join(montando, n), path.join(dataDir, n));
      puestos.push(n);
    }
  } catch (err) {
    // A medio cambiar: se quita lo nuevo que hubiera entrado y vuelve lo de
    // antes. Si esto tambien falla ya no hay mas que hacer aqui, pero lo de
    // antes sigue entero en «.anterior».
    try {
      for (const n of puestos) fs.rmSync(path.join(dataDir, n), { recursive: true, force: true });
      for (const n of apartados) fs.renameSync(path.join(anterior, n), path.join(dataDir, n));
    } catch (otro) {
      console.error('Failed to roll back restore:', otro);
    }
    fs.rmSync(montando, { recursive: true, force: true });
    throw err;
  }
  fs.rmSync(montando, { recursive: true, force: true });
  return hecho;
}
