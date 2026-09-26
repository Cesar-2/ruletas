// El arte de Dofus de los combates: una imagen por clase y los escenarios.
//
// Estaba en server.ts, en medio de las rutas de los minijuegos, y no es una
// ruta: es leer una carpeta. Lo usan las rutas de la batalla y del rey de la
// colina, y tambien batalla.ts para saber que clases se pueden sortear, porque
// solo se sortean las que tienen imagen.

import fs from 'fs';
import path from 'path';

export interface Dependencias {
  // La carpeta de imagenes de cada instalacion, la que no se sube a GitHub.
  assetsDir(): string;
}

let deps: Dependencias;
export function iniciar(d: Dependencias): void { deps = d; }

// Prueba con el arte de Ankama. En la carpeta de imagenes de datos (que no se
// sube a GitHub) el dueño deja una imagen por clase con su nombre (yopuka.png,
// ocra.png…) y el escenario (dofus-escenario.jpg). Las clases con imagen son
// las unicas que se sortean. La version evita que el navegador se quede con
// una imagen vieja si se cambia.
const CLASE_DE_ARCHIVO: Record<string, string> = {
  yopuka: 'Yopuka', iop: 'Yopuka', ocra: 'Ocra', cra: 'Ocra', xelor: 'Xelor',
  anutrof: 'Anutrof', enutrof: 'Anutrof', anu: 'Anutrof',
  zurcarak: 'Zurcarák', ecaflip: 'Zurcarák', zurca: 'Zurcarák',
  feca: 'Feca', sram: 'Sram', sadida: 'Sadida', sadi: 'Sadida', osamodas: 'Osamodas',
  aniripsa: 'Aniripsa', eniripsa: 'Aniripsa', ani: 'Aniripsa', sacrogrito: 'Sacrógrito', sacrieur: 'Sacrógrito',
  pandawa: 'Pandawa', panda: 'Pandawa', uginak: 'Uginak', ouginak: 'Uginak',
  zobal: 'Zobal', selotrop: 'Selotrop', steamer: 'Selotrop'
};

// El arte sale de dos sitios, en este orden: el que viene con la aplicacion
// (public/assets/dofus, versionado, llega al servidor con git pull) y el que
// ponga el dueño en su carpeta de datos, que manda sobre el anterior. Las
// rutas de public/assets/dofus las sirve el estatico de public: el de datos
// no las tiene y pasa al siguiente.
const REPO_DIR = path.join(process.cwd(), 'public', 'assets', 'dofus');

export function deBatalla(): { clases: Record<string, string>; escenario: string; escenarios: string[] } {
  const arte = { clases: {} as Record<string, string>, escenario: '', escenarios: [] as string[] };
  const fuentes: [string, string][] = [[REPO_DIR, '/assets/dofus/'], [deps.assetsDir(), '/assets/']];
  for (const [dir, base] of fuentes) {
    try {
      if (!fs.existsSync(dir)) continue;
      const url = (f: string) =>
        `${base}${encodeURIComponent(f)}?v=${Math.round(fs.statSync(path.join(dir, f)).mtimeMs)}`;
      // Los escenarios se guardan por nombre: del mismo nombre gana el JPG,
      // que es el reducido. Asi 'dofus-escenario-nieve.jpg' y .png son uno.
      const escenarios = new Map<string, string>();
      for (const f of fs.readdirSync(dir)) {
        const m = /^(.+)\.(png|webp|gif)$/i.exec(f);
        const clase = m && CLASE_DE_ARCHIVO[m[1].toLowerCase()];
        if (clase) arte.clases[clase] = url(f);
        // 'dofus-escenario.jpg' y tambien 'dofus-escenario-<loquesea>.jpg':
        // se admiten varios y el combate sortea uno de ellos.
        const e = /^dofus-?escenario(?:[-_](.+))?\.(jpe?g|png|webp)$/i.exec(f);
        if (e) {
          const nombre = (e[1] || '').toLowerCase();
          const antes = escenarios.get(nombre);
          if (!antes || /\.jpe?g$/i.test(f)) escenarios.set(nombre, url(f));
        }
      }
      // Una carpeta con escenarios reemplaza a la anterior entera: si el dueno
      // pone los suyos en sus datos, manda su coleccion y no se mezcla.
      if (escenarios.size) {
        arte.escenarios = [...escenarios.entries()]
          .sort((x, y) => x[0].localeCompare(y[0]))
          .map(([, u]) => u);
        arte.escenario = arte.escenarios[0];
      }
    } catch (err) {
      console.error('Failed to read Dofus art:', err);
    }
  }
  return arte;
}
