// La copia entera de los datos, la que se descarga para cambiar de servidor.
//
// Lo que tiene que cumplir siempre: lo que sale del archivo es EXACTAMENTE lo
// que había en la carpeta. Una copia a la que le falta un archivo, o que trae
// uno cortado, es peor que no tener copia, porque no se descubre hasta que ya
// se ha apagado el servidor viejo.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Writable } = require('stream');
const { carpeta, cargar } = require('./ayuda');

// Un lector de tar de andar por casa, para no depender de que la máquina de
// los tests tenga `tar`. Entiende lo mismo que escribe respaldo.ts: cabeceras
// normales, nombres partidos y la cabecera extendida de los nombres raros.
function leerTar(buf) {
  const entradas = [];
  let i = 0;
  let nombreLargo = '';
  const texto = (desde, largo) => {
    const trozo = buf.subarray(desde, desde + largo);
    const fin = trozo.indexOf(0);
    return trozo.subarray(0, fin === -1 ? largo : fin).toString('utf8');
  };
  while (i + 512 <= buf.length) {
    const cab = buf.subarray(i, i + 512);
    if (cab.every((b) => b === 0)) break;
    // La suma de la cabecera, con su propio campo contado como espacios.
    let suma = 0;
    for (let k = 0; k < 512; k++) suma += (k >= 148 && k < 156) ? 32 : cab[k];
    assert.strictEqual(parseInt(texto(i + 148, 8), 8), suma, 'la suma de la cabecera cuadra');
    assert.strictEqual(texto(i + 257, 6), 'ustar', 'es un tar de los normales');

    const tamano = parseInt(texto(i + 124, 12), 8);
    const tipo = String.fromCharCode(cab[156]);
    const prefijo = texto(i + 345, 155);
    const nombre = (prefijo ? prefijo + '/' : '') + texto(i, 100);
    const cuerpo = buf.subarray(i + 512, i + 512 + tamano);
    i += 512 + Math.ceil(tamano / 512) * 512;

    if (tipo === 'x') {
      const m = /^\d+ path=(.*)\n$/s.exec(cuerpo.toString('utf8'));
      assert.ok(m, 'la cabecera extendida trae el nombre');
      assert.strictEqual(parseInt(cuerpo.toString('utf8'), 10), cuerpo.length, 'y su longitud se cuenta a sí misma');
      nombreLargo = m[1];
      continue;
    }
    entradas.push({ nombre: nombreLargo || nombre, tipo, cuerpo: Buffer.from(cuerpo) });
    nombreLargo = '';
  }
  return entradas;
}

async function empaquetar(dir) {
  const respaldo = cargar('respaldo');
  const trozos = [];
  const salida = new Writable({ write(c, _e, hecho) { trozos.push(c); hecho(); } });
  const resumen = await respaldo.enviar(dir, 'data', salida);
  return { resumen, entradas: leerTar(zlib.gunzipSync(Buffer.concat(trozos))) };
}

test('la copia lleva todo lo que hay en la carpeta, tal cual', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const pon = (rel, contenido) => {
    const f = path.join(c.raiz, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contenido);
  };
  // Lo que hay de verdad en una instalación: JSON sueltos, lo de cada cuenta en
  // su carpeta y las imágenes subidas, que son binarios.
  const imagen = Buffer.from(Array.from({ length: 3000 }, (_, k) => (k * 7) % 256));
  pon('users.json', '[{"id":"admin"}]');
  pon('widgets.json', '{}');
  pon('users/admin/settings.json', '{"overlay":55}');
  pon('users/admin/juegos/dofus/servers/principal/winners.json', '[]');
  pon('assets/fondo-1.png', imagen);
  pon('vacio.json', '');
  // Justo un bloque de tar, que es donde se cuela un relleno de más o de menos.
  pon('justo.bin', Buffer.alloc(512, 7));
  fs.mkdirSync(path.join(c.raiz, 'users', 'sin-nada'));

  const { resumen, entradas } = await empaquetar(c.raiz);
  const archivos = Object.fromEntries(entradas.filter((e) => e.tipo === '0').map((e) => [e.nombre, e.cuerpo]));

  assert.deepStrictEqual(Object.keys(archivos).sort(), [
    'data/assets/fondo-1.png',
    'data/justo.bin',
    'data/users.json',
    'data/users/admin/juegos/dofus/servers/principal/winners.json',
    'data/users/admin/settings.json',
    'data/vacio.json',
    'data/widgets.json'
  ]);
  assert.ok(archivos['data/assets/fondo-1.png'].equals(imagen), 'la imagen llega byte a byte');
  assert.strictEqual(archivos['data/users/admin/settings.json'].toString(), '{"overlay":55}');
  assert.strictEqual(archivos['data/vacio.json'].length, 0);
  assert.strictEqual(archivos['data/justo.bin'].length, 512);
  assert.strictEqual(resumen.archivos, 7);

  // Las carpetas van también, vacías incluidas: al restaurar tiene que quedar
  // el mismo árbol.
  const carpetas = entradas.filter((e) => e.tipo === '5').map((e) => e.nombre);
  assert.ok(carpetas.includes('data/'), 'todo cuelga de data/');
  assert.ok(carpetas.includes('data/users/sin-nada/'), 'la carpeta vacía va');
});

test('los nombres largos o con acentos llegan enteros', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const hondo = path.join(c.raiz, 'users', 'u'.repeat(40), 'juegos', 'd'.repeat(40), 'servers', 's'.repeat(40));
  fs.mkdirSync(hondo, { recursive: true });
  fs.writeFileSync(path.join(hondo, 'winners.json'), 'hondo');
  // Sin ninguna barra donde partirlo: no cabe en la cabecera de siempre.
  const larguisimo = 'x'.repeat(180) + '.json';
  fs.writeFileSync(path.join(c.raiz, larguisimo), 'largo');
  fs.writeFileSync(path.join(c.raiz, 'cañón ñandú.json'), 'acentos');

  const { entradas } = await empaquetar(c.raiz);
  const archivos = Object.fromEntries(entradas.filter((e) => e.tipo === '0').map((e) => [e.nombre, e.cuerpo.toString()]));
  const relativo = 'data/' + path.relative(c.raiz, path.join(hondo, 'winners.json')).split(path.sep).join('/');
  assert.strictEqual(archivos[relativo], 'hondo', 'el que está muy hondo');
  assert.strictEqual(archivos['data/' + larguisimo], 'largo', 'el del nombre larguísimo');
  assert.strictEqual(archivos['data/cañón ñandú.json'], 'acentos', 'y el de los acentos');
});

test('no se lleva los temporales de una escritura a medias', async (t) => {
  const c = carpeta();
  t.after(c.quitar);
  fs.writeFileSync(path.join(c.raiz, 'users.json'), '[]');
  fs.writeFileSync(path.join(c.raiz, 'users.json.tmp'), '[{"a medias');

  const { entradas } = await empaquetar(c.raiz);
  const nombres = entradas.map((e) => e.nombre);
  assert.ok(nombres.includes('data/users.json'));
  assert.ok(!nombres.some((n) => n.endsWith('.tmp')), 'el .tmp se queda');
});

test('la copia solo la puede bajar el administrador', () => {
  // La ruta cuelga de /api/admin, que es lo que corta a quien no lo es. Si
  // alguien la mueve fuera, cualquiera con cuenta se lleva las de los demás.
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.ts'), 'utf8');
  assert.ok(s.includes("app.get('/api/admin/respaldo'"), 'cuelga de /api/admin');
  assert.ok(s.indexOf("app.use('/api/admin'") < s.indexOf("app.get('/api/admin/respaldo'"),
    'y el guardia va antes que la ruta');
});
