// Leer y escribir los JSON de datos, con su cachito.
//
// Lo que aqui no puede fallar, porque de esto cuelga saber quien pregunta en
// cada peticion:
//
//  - Escribir tiene que invalidar lo guardado. Si no, se seguiria contestando
//    con lo de antes: alguien cambia su canal de Twitch y el servidor sigue
//    usando el viejo, o se bloquea una cuenta y sigue entrando.
//  - Lo que se devuelve tiene que estar congelado. El cache lo comparten todas
//    las peticiones; si una tocara lo que se le dio, se lo estaria cambiando a
//    las demas.
//  - Un archivo roto o que no existe no puede tumbar nada.

// Modo estricto, igual que el codigo de verdad: TypeScript le pone "use strict"
// a todo lo que compila. Importa para este archivo, porque tocar algo congelado
// solo LANZA en estricto; sin el, falla en silencio y el test no veria nada.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { carpeta, cargar } = require('./ayuda');

function montar(t) {
  const c = carpeta();
  t.after(c.quitar);
  const json = cargar('json');
  json.olvidarTodo();
  return { json, f: (n) => path.join(c.raiz, n || 'cosa.json') };
}

test('lo que se escribe es lo que se lee', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { a: 1, b: ['x', 'y'] });
  assert.deepStrictEqual(json.leer(f()), { a: 1, b: ['x', 'y'] });
});

test('escribir invalida lo guardado', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { canal: 'viejo' });
  assert.strictEqual(json.leer(f()).canal, 'viejo');

  // Esto es el caso de verdad: alguien cambia su canal de Twitch. Si el cache no
  // se enterara, el servidor seguiria escuchando el canal de antes.
  json.escribir(f(), { canal: 'nuevo' });
  assert.strictEqual(json.leer(f()).canal, 'nuevo');
});

test('escribir algo del mismo tamaño tambien invalida', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { v: 'aaa' });
  assert.strictEqual(json.leer(f()).v, 'aaa');
  json.escribir(f(), { v: 'bbb' });
  assert.strictEqual(json.leer(f()).v, 'bbb');
});

test('escribir invalida aunque el archivo parezca exactamente el mismo', (t) => {
  // Este es el que de verdad prueba la invalidacion. Los dos de arriba pasan
  // igual sin ella, porque el respaldo de fecha y tamaño se entera del cambio:
  // lo comprobe quitandola y no fallaba ninguno.
  //
  // Aqui se le deja el archivo al cache tal y como lo tenia guardado: mismo
  // tamaño y la MISMA fecha, devuelta a mano. Es lo que pasa de verdad cuando el
  // reloj del sistema de archivos no tiene precision para separar dos escrituras
  // seguidas. Si la invalidacion no existiera, mirar el archivo no delataria
  // nada y se seguiria contestando con lo viejo.
  // La fecha se clava a mano en los DOS lados, y no se devuelve la que tenia:
  // NTFS guarda precision por debajo del milisegundo (…992.559) y utimesSync
  // redondea, asi que devolver la fecha leida no la reproduce exacta. Clavando
  // la misma en los dos, las dos pasan por el mismo redondeo y salen iguales.
  const { json, f } = montar(t);
  const fija = new Date(1700000000000);

  json.escribir(f(), { v: 'aaa' });
  fs.utimesSync(f(), fija, fija);
  json.leer(f());                        // queda guardado con esa fecha
  const comoEstaba = fs.statSync(f());

  json.escribir(f(), { v: 'bbb' });      // mismo tamaño
  fs.utimesSync(f(), fija, fija);
  const s = fs.statSync(f());
  assert.strictEqual(s.size, comoEstaba.size, 'el archivo parece el mismo: igual tamaño');
  assert.strictEqual(s.mtimeMs, comoEstaba.mtimeMs, 'y la misma fecha');

  assert.strictEqual(json.leer(f()).v, 'bbb',
    'se contesta lo nuevo: lo guardado se tiro al escribir, sin mirar el archivo');
});

test('lo que se devuelve esta congelado, y por dentro tambien', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { uno: { dos: { tres: 3 } }, lista: [{ x: 1 }] });
  const leido = json.leer(f());

  assert.ok(Object.isFrozen(leido), 'el objeto de fuera');
  assert.ok(Object.isFrozen(leido.uno), 'y los de dentro');
  assert.ok(Object.isFrozen(leido.uno.dos));
  assert.ok(Object.isFrozen(leido.lista));
  assert.ok(Object.isFrozen(leido.lista[0]), 'y lo que hay en las listas');
  // Tocarlo salta, en vez de cambiarselo por lo bajo a las demas peticiones.
  assert.throws(() => { leido.uno.dos.tres = 99; }, TypeError);
  assert.strictEqual(leido.uno.dos.tres, 3, 'y desde luego no cambia');
  assert.throws(() => { leido.lista.push({ y: 2 }); }, TypeError);
  assert.strictEqual(leido.lista.length, 1);
});

test('dos lecturas seguidas dan el mismo objeto: no se relee el disco', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { a: 1 });
  const uno = json.leer(f());
  const dos = json.leer(f());
  assert.strictEqual(uno, dos, 'es el mismo, o sea que venia del cache');
});

test('si lo cambia algo de fuera, se nota', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { a: 1 });
  assert.strictEqual(json.leer(f()).a, 1);

  // Una edicion a mano, o el script que restaura una copia de seguridad. El
  // cache no se ha enterado por escribir, asi que tiene que verlo por la fecha
  // y el tamaño. Se cambia el tamaño para que no dependa de la precision de la
  // fecha, que es lo que puede fallar en un archivo escrito en el mismo
  // instante.
  fs.writeFileSync(f(), JSON.stringify({ a: 2, deFuera: true }));
  assert.strictEqual(json.leer(f()).a, 2);
});

test('un archivo que no existe no es un fallo, es que no hay nada', (t) => {
  const { json, f } = montar(t);
  assert.strictEqual(json.leer(f('nada.json')), null);
});

test('un archivo roto se contesta como que no hay nada', (t) => {
  const { json, f } = montar(t);
  fs.writeFileSync(f(), 'esto no es json');
  assert.strictEqual(json.leer(f()), null);
  // Y no se queda guardado como bueno: al arreglarlo se lee bien.
  json.escribir(f(), { ya: 'arreglado' });
  assert.deepStrictEqual(json.leer(f()), { ya: 'arreglado' });
});

test('olvidar solo olvida ese archivo', (t) => {
  const { json, f } = montar(t);
  json.escribir(f('uno.json'), { n: 1 });
  json.escribir(f('dos.json'), { n: 2 });
  const dosAntes = json.leer(f('dos.json'));

  json.olvidar(f('uno.json'));
  assert.strictEqual(json.leer(f('dos.json')), dosAntes, 'el otro sigue guardado');
  assert.deepStrictEqual(json.leer(f('uno.json')), { n: 1 }, 'y este se vuelve a leer');
});

test('escribir no deja el archivo a medias', (t) => {
  const { json, f } = montar(t);
  json.escribir(f(), { grande: 'x'.repeat(50000) });
  // El temporal no se queda por ahi.
  const sobras = fs.readdirSync(path.dirname(f())).filter((n) => n.endsWith('.tmp'));
  assert.deepStrictEqual(sobras, []);
  assert.strictEqual(json.leer(f()).grande.length, 50000);
});

// Dos procesos sobre los mismos datos (en un hosting, la version vieja y la
// nueva de un despliegue) no pueden pisarse el temporal. Con un nombre fijo,
// el temporal que estaba escribiendo el otro proceso se renombraba encima, o
// desaparecia antes de renombrarlo y la escritura fallaba con ENOENT.
test('el temporal de otro proceso no estorba ni se usa', (t) => {
  const { json, f } = montar(t);
  const ajeno = f() + '.tmp';
  fs.writeFileSync(ajeno, '{"de":"otro proceso"}');
  json.escribir(f(), { de: 'este' });
  assert.deepStrictEqual(json.leer(f()), { de: 'este' });
  assert.strictEqual(fs.readFileSync(ajeno, 'utf8'), '{"de":"otro proceso"}', 'el del otro no se toca');
});
