// Leer un .xlsx sin librerias. Un .xlsx es un zip con XML dentro, y Node ya
// trae lo necesario para las dos cosas: zlib para descomprimir y expresiones
// para sacar las celdas.
//
// No se pretende entender Excel entero: solo hace falta leer una tabla con su
// fila de cabecera, que es lo que exportan las herramientas. Si algun dia hace
// falta mas (formulas, fechas, varias hojas), esto se cambia por una libreria;
// mientras tanto, no se mete una dependencia para leer cien filas.

import zlib from 'zlib';

// --- El zip ---------------------------------------------------------------

function entradasZip(buf: Buffer): Record<string, Buffer> {
  const salida: Record<string, Buffer> = {};
  // El directorio central esta al final del archivo, y ahi se dice donde
  // empieza cada cosa. Se busca su marca hacia atras.
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('el archivo no es un .xlsx');

  const cuantas = buf.readUInt16LE(fin + 10);
  let pos = buf.readUInt32LE(fin + 16);
  for (let i = 0; i < cuantas; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(pos + 10);
    const comprimido = buf.readUInt32LE(pos + 20);
    const nLen = buf.readUInt16LE(pos + 28);
    const eLen = buf.readUInt16LE(pos + 30);
    const cLen = buf.readUInt16LE(pos + 32);
    const desplaz = buf.readUInt32LE(pos + 42);
    const nombre = buf.slice(pos + 46, pos + 46 + nLen).toString('utf8');

    // La cabecera local dice cuanto ocupan nombre y extras ahi, que no tienen
    // por que medir lo mismo que en el directorio central.
    const nLocal = buf.readUInt16LE(desplaz + 26);
    const eLocal = buf.readUInt16LE(desplaz + 28);
    const inicio = desplaz + 30 + nLocal + eLocal;
    const datos = buf.slice(inicio, inicio + comprimido);
    try {
      salida[nombre] = metodo === 0 ? datos : zlib.inflateRawSync(datos);
    } catch {
      // Una entrada que no se puede descomprimir no tumba el resto: puede ser
      // una imagen o un tema, y a nosotros solo nos interesa la hoja.
    }
    pos += 46 + nLen + eLen + cLen;
  }
  return salida;
}

// --- Las celdas -----------------------------------------------------------

// Excel guarda los textos repetidos en una tabla aparte, para no escribirlos
// mil veces. Si el archivo la trae, hay que resolverla.
function cadenasCompartidas(z: Record<string, Buffer>): string[] {
  const xml = z['xl/sharedStrings.xml']?.toString('utf8');
  if (!xml) return [];
  const salida: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Un texto puede venir partido en trozos con formatos distintos: se juntan.
    salida.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
  }
  return salida.map(sinEscapar);
}

function sinEscapar(t: string): string {
  return t
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// La columna de una celda: de "BC12" sale "BC".
function columnaDe(ref: string): string {
  const m = /^([A-Z]+)/.exec(ref);
  return m ? m[1] : '';
}

export interface Tabla {
  cabeceras: string[];
  filas: Record<string, string>[];
}

// Lee la primera hoja como una tabla: la primera fila son los nombres de las
// columnas y el resto, los datos.
export function leerTabla(buf: Buffer): Tabla {
  const z = entradasZip(buf);
  const compartidas = cadenasCompartidas(z);

  const cual = Object.keys(z).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!cual) throw new Error('el archivo no tiene ninguna hoja');
  const xml = z[cual].toString('utf8');

  const crudas: Record<string, string>[] = [];
  for (const fila of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: Record<string, string> = {};
    for (const c of fila[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tipo = /t="([^"]+)"/.exec(c[2])?.[1];
      // El valor esta en <v>, salvo el texto escrito a pelo, que va en <is>.
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3])?.[1];
      const enLinea = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3])?.[1];
      let valor = v ?? enLinea ?? '';
      if (tipo === 's') valor = compartidas[Number(valor)] ?? '';
      celdas[columnaDe(c[1])] = sinEscapar(valor).trim();
    }
    if (Object.keys(celdas).length) crudas.push(celdas);
  }

  if (!crudas.length) return { cabeceras: [], filas: [] };

  // La primera fila con algo escrito manda: es la cabecera.
  const cabecera = crudas[0];
  const columnas = Object.keys(cabecera);
  const cabeceras = columnas.map((col) => cabecera[col]);

  const filas = crudas.slice(1).map((f) => {
    const salida: Record<string, string> = {};
    columnas.forEach((col) => { salida[cabecera[col]] = f[col] ?? ''; });
    return salida;
  });

  return { cabeceras, filas };
}

// Busca una columna por su nombre, sin distinguir mayusculas ni acentos, y
// admitiendo varios nombres posibles. Asi el archivo puede venir en ingles o
// en espanol, y no importa en que orden esten las columnas.
export function columna(cabeceras: string[], posibles: string[]): string | null {
  const llano = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const quiero = posibles.map(llano);
  return cabeceras.find((c) => quiero.includes(llano(c))) || null;
}
