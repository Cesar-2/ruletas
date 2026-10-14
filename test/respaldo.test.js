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

// --- La vuelta: restaurar una copia ----------------------------------------
//
// Lo que se sube es un archivo que viene de fuera y que reemplaza la
// instalacion entera. Lo que no puede pasar nunca:
//
//  - Que lo restaurado no sea igual que lo que se copio.
//  - Que un archivo que no es una copia (o una copia sin cuentas) deje la
//    instalacion vacia. Tiene que rechazarse SIN tocar nada.
//  - Que un nombre con «..» escriba fuera de la carpeta de datos.
//  - Que lo que habia se pierda: queda apartado.

async function copiaDe(dir) {
  const respaldo = cargar('respaldo');
  const trozos = [];
  const salida = new Writable({ write(c, _e, hecho) { trozos.push(c); hecho(); } });
  await respaldo.enviar(dir, 'data', salida);
  return Buffer.concat(trozos);
}

// Un tar hecho a mano, para poder meterle lo que `enviar` no meteria nunca.
function tarAMano(entradas) {
  const partes = [];
  for (const [nombre, contenido, tipo] of entradas) {
    const cuerpo = Buffer.from(contenido || '');
    const b = Buffer.alloc(512);
    b.write(nombre, 0, 100, 'utf8');
    b.write('0000644\0', 100, 8, 'ascii');
    b.write(cuerpo.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    b.write('00000000000\0', 136, 12, 'ascii');
    b.write('        ', 148, 8, 'ascii');
    b.write(tipo || '0', 156, 1, 'ascii');
    b.write('ustar\0', 257, 6, 'ascii');
    let suma = 0;
    for (let i = 0; i < 512; i++) suma += b[i];
    b.write(suma.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    partes.push(b, cuerpo, Buffer.alloc((512 - (cuerpo.length % 512)) % 512));
  }
  partes.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(partes));
}

// Todo lo que hay en una carpeta, como { 'ruta/relativa': contenido }.
function arbol(dir, saltar = []) {
  const hay = {};
  const mirar = (real, dentro) => {
    for (const n of fs.readdirSync(real).sort()) {
      if (!dentro && saltar.includes(n)) continue;
      const ruta = path.join(real, n);
      const rel = dentro ? dentro + '/' + n : n;
      if (fs.statSync(ruta).isDirectory()) { hay[rel + '/'] = ''; mirar(ruta, rel); }
      else hay[rel] = fs.readFileSync(ruta).toString('base64');
    }
  };
  mirar(dir, '');
  return hay;
}

const CUENTA = JSON.stringify({ users: [{ id: 'admin', username: 'admin', salt: 'aa', hash: 'bb', admin: true }] });

function instalacion(raiz, marca) {
  const pon = (rel, contenido) => {
    const f = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contenido);
  };
  pon('users.json', CUENTA);
  pon('users/admin/settings.json', '{"marca":"' + marca + '"}');
  pon('users/admin/juegos/dofus/servers/principal/winners.json', '[]');
  pon('assets/fondo-1.png', Buffer.from(Array.from({ length: 3000 }, (_, k) => (k * 7) % 256)));
  pon('cañón ñandú.json', 'acentos');
  pon('x'.repeat(180) + '.json', 'largo');
  fs.mkdirSync(path.join(raiz, 'users', 'sin-nada'), { recursive: true });
}

test('restaurar deja la carpeta igual que la que se copio', async (t) => {
  const vieja = carpeta();
  const nueva = carpeta();
  t.after(vieja.quitar);
  t.after(nueva.quitar);
  instalacion(vieja.raiz, 'vieja');
  // El servidor nuevo ya tiene lo suyo: una cuenta recien creada.
  fs.writeFileSync(path.join(nueva.raiz, 'users.json'), '{"users":[{"id":"otro"}]}');
  fs.writeFileSync(path.join(nueva.raiz, 'sobra.json'), 'esto no estaba en la copia');

  const respaldo = cargar('respaldo');
  const r = respaldo.restaurar(await copiaDe(vieja.raiz), nueva.raiz);

  assert.deepStrictEqual(arbol(nueva.raiz, ['.anterior']), arbol(vieja.raiz), 'lo mismo, byte a byte');
  assert.strictEqual(r.cuentas, 1);
  assert.strictEqual(r.archivos, 6);

  // Lo que habia no se pierde: queda apartado.
  const anterior = path.join(nueva.raiz, '.anterior');
  assert.strictEqual(fs.readFileSync(path.join(anterior, 'users.json'), 'utf8'), '{"users":[{"id":"otro"}]}');
  assert.ok(fs.existsSync(path.join(anterior, 'sobra.json')));
  assert.ok(!fs.readdirSync(nueva.raiz).some((n) => n.startsWith('.restaurando-')), 'sin restos a medio montar');
});

test('lo apartado no se cuela en la copia siguiente, y solo se guarda lo ultimo', async (t) => {
  const a = carpeta();
  const b = carpeta();
  t.after(a.quitar);
  t.after(b.quitar);
  instalacion(a.raiz, 'a');
  instalacion(b.raiz, 'b');
  const respaldo = cargar('respaldo');

  respaldo.restaurar(await copiaDe(a.raiz), b.raiz);
  const otraVez = await copiaDe(b.raiz);
  const nombres = leerTar(zlib.gunzipSync(otraVez)).map((e) => e.nombre);
  assert.ok(!nombres.some((n) => n.includes('.anterior')), 'la copia no lleva lo apartado');

  respaldo.restaurar(otraVez, b.raiz);
  const guardado = fs.readFileSync(path.join(b.raiz, '.anterior', 'users', 'admin', 'settings.json'), 'utf8');
  assert.strictEqual(guardado, '{"marca":"a"}', 'lo apartado es lo de justo antes');
  assert.ok(!fs.existsSync(path.join(b.raiz, '.anterior', '.anterior')), 'y no se anida');
});

test('lo que no es una copia se rechaza sin tocar nada', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  instalacion(c.raiz, 'intacta');
  const antes = arbol(c.raiz);
  const respaldo = cargar('respaldo');
  const rechaza = (gz, que) => {
    assert.throws(() => respaldo.restaurar(gz, c.raiz), respaldo.CopiaMala, que);
    assert.deepStrictEqual(arbol(c.raiz), antes, que + ': y no se ha tocado nada');
  };

  rechaza(Buffer.from('esto no es un gzip'), 'un archivo cualquiera');
  rechaza(zlib.gzipSync(Buffer.from('ni esto un tar'.repeat(100))), 'un gzip que no es un tar');
  rechaza(tarAMano([['otra-cosa/users.json', CUENTA]]), 'un tar que no cuelga de data/');
  rechaza(tarAMano([['data/settings.json', '{}']]), 'una copia sin cuentas');
  rechaza(tarAMano([['data/users.json', '{"users":[]}']]), 'una copia con cero cuentas');
  rechaza(tarAMano([['data/users.json', '{"users":[{"id":"a"']]), 'una copia con las cuentas rotas');
  // Cortada a la mitad: se queda sin el final.
  const entera = zlib.gunzipSync(tarAMano([['data/users.json', CUENTA], ['data/grande.bin', 'x'.repeat(5000)]]));
  rechaza(zlib.gzipSync(entera.subarray(0, 512 * 3 + 100)), 'una copia cortada');
});

test('una ruta que se sale de la carpeta de datos no se escribe', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const datos = path.join(c.raiz, 'data');
  fs.mkdirSync(datos);
  const respaldo = cargar('respaldo');
  const malas = ['data/../fuera.txt', 'data/users/../../fuera.txt', '/etc/fuera.txt', 'C:/fuera.txt', 'data\\..\\fuera.txt', '../fuera.txt'];
  for (const mala of malas) {
    assert.throws(() => respaldo.restaurar(tarAMano([['data/users.json', CUENTA], [mala, 'malo']]), datos),
      respaldo.CopiaMala, mala);
  }
  assert.deepStrictEqual(fs.readdirSync(c.raiz), ['data'], 'fuera de la carpeta de datos no hay nada nuevo');
  assert.deepStrictEqual(fs.readdirSync(datos), [], 'y dentro tampoco se llego a poner nada');
});

test('los enlaces de una copia no se restauran', (t) => {
  const c = carpeta();
  t.after(c.quitar);
  const respaldo = cargar('respaldo');
  // Tipo 2 es un enlace simbolico. `enviar` no los mete, asi que no es suyo.
  respaldo.restaurar(tarAMano([['data/users.json', CUENTA], ['data/enlace', '', '2']]), c.raiz);
  assert.ok(!fs.existsSync(path.join(c.raiz, 'enlace')));
  assert.ok(fs.existsSync(path.join(c.raiz, 'users.json')));
});

test('restaurar pide la contraseña y solo lo hace el administrador', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.ts'), 'utf8');
  const ruta = s.indexOf("app.post('/api/admin/respaldo'");
  assert.ok(ruta > s.indexOf("app.use('/api/admin'"), 'cuelga de /api/admin, detras del guardia');
  const cuerpo = s.slice(ruta, s.indexOf('\n});', ruta));
  assert.ok(cuerpo.indexOf('passwordOk(') !== -1 && cuerpo.indexOf('passwordOk(') < cuerpo.indexOf('respaldo.restaurar('),
    'y la contraseña se comprueba antes de restaurar');
});
