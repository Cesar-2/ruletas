// Los objetivos del directo: la checklist que se ve en el widget.
//
// Lo que tiene que cumplirse siempre:
//
//  - Lo que se apunta se queda en disco: al dia siguiente sigue ahi.
//  - Cada cambio avisa, para que el widget de OBS lo enseñe al momento.
//  - Un objetivo vacio no entra, y la lista no crece sin limite.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(t) {
  const c = carpeta();
  t.after(c.quitar);
  const avisados = [];
  const d = deps(c.raiz, avisados);
  return { objetivos: cargar('objetivos', d), d, avisados };
}

test('se añaden, se marcan y sobreviven a un reinicio', (t) => {
  const { objetivos, d, avisados } = montar(t);
  assert.strictEqual(objetivos.leer('u1').objetivos.length, 0);

  const a = objetivos.anadir('u1', '  Llegar a   100 seguidores ');
  assert.ok(a.ok);
  assert.strictEqual(a.lista.objetivos[0].texto, 'Llegar a 100 seguidores', 'se limpian los espacios');
  const id = a.lista.objetivos[0].id;
  objetivos.anadir('u1', 'Pasarse la mazmorra');
  assert.ok(objetivos.cambiar('u1', id, { hecho: true }).ok);
  objetivos.ponerTitulo('u1', 'Hoy');

  const otra = cargar('objetivos', d);
  const l = otra.leer('u1');
  assert.strictEqual(l.titulo, 'Hoy');
  assert.deepStrictEqual(l.objetivos.map((o) => [o.texto, o.hecho]),
    [['Llegar a 100 seguidores', true], ['Pasarse la mazmorra', false]]);
  assert.strictEqual(avisados.length, 4, 'cada cambio avisa');
  assert.deepStrictEqual(otra.leer('u2').objetivos, [], 'cada cuenta tiene la suya');
});

test('vacios fuera y como mucho el maximo', (t) => {
  const { objetivos } = montar(t);
  assert.strictEqual(objetivos.anadir('u1', '   ').ok, false);
  for (let i = 0; i < objetivos.MAXIMO; i++) assert.ok(objetivos.anadir('u1', 'o' + i).ok);
  assert.strictEqual(objetivos.anadir('u1', 'uno mas').ok, false);
  const id = objetivos.leer('u1').objetivos[0].id;
  assert.strictEqual(objetivos.cambiar('u1', id, { texto: ' ' }).ok, false, 'no se puede dejar vacio');
  assert.strictEqual(objetivos.cambiar('u1', 'no-existe', { hecho: true }).ok, false);
});

test('mover, desmarcar todos y vaciar', (t) => {
  const { objetivos } = montar(t);
  ['a', 'b', 'c'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b, c] = objetivos.leer('u1').objetivos;
  const textos = () => objetivos.leer('u1').objetivos.map((o) => o.texto).join('');

  objetivos.mover('u1', c.id, -1);
  assert.strictEqual(textos(), 'acb');
  objetivos.mover('u1', a.id, -1);
  assert.strictEqual(textos(), 'acb', 'el primero no sube mas');

  objetivos.cambiar('u1', b.id, { hecho: true });
  objetivos.cambiar('u1', c.id, { hecho: true });
  objetivos.desmarcarTodos('u1');
  assert.strictEqual(textos(), 'acb', 'desmarcar no borra nada');
  assert.ok(objetivos.leer('u1').objetivos.every((o) => !o.hecho), 'todos sin hacer otra vez');

  objetivos.quitar('u1', a.id);
  assert.strictEqual(textos(), 'cb');
  objetivos.vaciar('u1');
  assert.strictEqual(textos(), '');
});

test('los trece Dofus estan siempre, en su orden, y se marcan aparte', (t) => {
  const { objetivos, d } = montar(t);
  const nombres = (l) => l.dofus.map((x) => x.texto);
  assert.deepStrictEqual(nombres(objetivos.leer('u1')), ['Dofawa', 'Esmeralda', 'Púrpura', 'Turquesa', 'Ocre',
    'Marfil', 'Ébano', 'Domakuro', 'Dorigami', 'Moteado', 'Pesadilla', 'Pino', 'Silvestre']);
  assert.ok(objetivos.leer('u1').dofus.every((x) => !x.conseguido), 'al principio no hay ninguno');

  objetivos.anadir('u1', 'Subir a 200');
  assert.ok(objetivos.marcarDofus('u1', 'ocre', true).ok);
  assert.ok(objetivos.marcarDofus('u1', 'dofawa', true).ok);
  assert.ok(objetivos.marcarDofus('u1', 'dofawa', false).ok, 'se puede desmarcar');
  assert.strictEqual(objetivos.marcarDofus('u1', 'inventado', true).ok, false);

  const l = cargar('objetivos', d).leer('u1');
  assert.deepStrictEqual(l.dofus.filter((x) => x.conseguido).map((x) => x.id), ['ocre'], 'sobrevive a un reinicio');
  assert.strictEqual(l.objetivos.length, 1, 'y no se mezclan con los objetivos');
  objetivos.vaciar('u1');
  assert.strictEqual(objetivos.leer('u1').dofus.filter((x) => x.conseguido).length, 1, 'vaciar la lista no quita los Dofus');
});

test('los dibujos de los Dofus estan en public/assets', () => {
  const fs = require('fs');
  const path = require('path');
  const objetivos = cargar('objetivos');
  const faltan = objetivos.DOFUS.filter((x) => !fs.existsSync(path.join(__dirname, '..', 'public', x.imagen)))
    .map((x) => x.texto);
  assert.deepStrictEqual(faltan, [], 'faltan: ' + faltan.join(', '));
});

test('en proceso: solo uno de los dos estados, y desmarcar lo quita', (t) => {
  const { objetivos, d } = montar(t);
  objetivos.anadir('u1', 'a');
  const id = objetivos.leer('u1').objetivos[0].id;
  const uno = () => objetivos.leer('u1').objetivos[0];
  assert.strictEqual(uno().proceso, false, 'al añadirlo no esta en proceso');

  objetivos.cambiar('u1', id, { proceso: true });
  assert.strictEqual(cargar('objetivos', d).leer('u1').objetivos[0].proceso, true, 'se guarda');
  objetivos.cambiar('u1', id, { hecho: true });
  assert.deepStrictEqual([uno().hecho, uno().proceso], [true, false], 'al hacerlo se va del widget');
  objetivos.cambiar('u1', id, { proceso: true });
  assert.deepStrictEqual([uno().hecho, uno().proceso], [false, true], 'y volver a ponerlo en proceso lo desmarca');
  objetivos.desmarcarTodos('u1');
  assert.deepStrictEqual([uno().hecho, uno().proceso], [false, false]);
});

test('al completar el que esta en proceso, pasa el siguiente', (t) => {
  const { objetivos } = montar(t);
  ['a', 'b', 'c', 'd'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b, c, d] = objetivos.leer('u1').objetivos;
  const estados = () => objetivos.leer('u1').objetivos
    .map((o) => o.texto + (o.hecho ? '✓' : o.proceso ? '▶' : '')).join(' ');

  objetivos.cambiar('u1', b.id, { proceso: true });
  objetivos.cambiar('u1', b.id, { hecho: true });
  assert.strictEqual(estados(), 'a b✓ c▶ d', 'el de debajo');

  objetivos.cambiar('u1', d.id, { hecho: true });
  assert.strictEqual(estados(), 'a b✓ c▶ d✓', 'completar uno que no estaba en proceso no mueve nada');

  objetivos.cambiar('u1', c.id, { hecho: true });
  assert.strictEqual(estados(), 'a▶ b✓ c✓ d✓', 'sin nada debajo, vuelve arriba');

  objetivos.cambiar('u1', a.id, { hecho: true });
  assert.strictEqual(estados(), 'a✓ b✓ c✓ d✓', 'y si no queda ninguno, ya esta');
});

test('sub-objetivos: al hacer el ultimo se completa el objetivo y pasa el siguiente', (t) => {
  const { objetivos, d } = montar(t);
  ['a', 'b'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b] = objetivos.leer('u1').objetivos;
  objetivos.cambiar('u1', a.id, { proceso: true });
  assert.ok(objetivos.anadirSub('u1', a.id, 'paso 1').ok);
  assert.ok(objetivos.anadirSub('u1', a.id, 'paso 2').ok);
  assert.strictEqual(objetivos.anadirSub('u1', a.id, '  ').ok, false);
  const [s1, s2] = objetivos.leer('u1').objetivos[0].subs;
  const de = (id) => objetivos.leer('u1').objetivos.find((o) => o.id === id);

  objetivos.cambiarSub('u1', a.id, s1.id, { hecho: true });
  assert.deepStrictEqual([de(a.id).hecho, de(a.id).proceso], [false, true], 'con uno no basta');
  objetivos.cambiarSub('u1', a.id, s2.id, { hecho: true });
  assert.strictEqual(de(a.id).hecho, true, 'con todos, hecho');
  assert.strictEqual(de(b.id).proceso, true, 'y pasa el siguiente');

  objetivos.cambiarSub('u1', a.id, s2.id, { hecho: false });
  assert.strictEqual(de(a.id).hecho, false, 'desmarcar un paso lo deja sin hacer');
  assert.strictEqual(cargar('objetivos', d).leer('u1').objetivos[0].subs.length, 2, 'se guardan');

  objetivos.desmarcarTodos('u1');
  assert.ok(de(a.id).subs.every((s) => !s.hecho), 'desmarcar todos tambien los pasos');
  objetivos.quitarSub('u1', a.id, s1.id);
  assert.deepStrictEqual(de(a.id).subs.map((s) => s.texto), ['paso 2']);
});

test('guardar los completados dentro de un objetivo nuevo con nombre', (t) => {
  const { objetivos } = montar(t);
  ['a', 'b', 'c'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b] = objetivos.leer('u1').objetivos;
  assert.strictEqual(objetivos.agruparHechos('u1', 'Grupo').ok, false, 'sin completados no hay nada que guardar');
  objetivos.cambiar('u1', a.id, { hecho: true });
  objetivos.cambiar('u1', b.id, { hecho: true });
  assert.strictEqual(objetivos.agruparHechos('u1', '  ').ok, false, 'hace falta nombre');

  assert.ok(objetivos.agruparHechos('u1', 'Misiones Dofawa').ok);
  const l = objetivos.leer('u1').objetivos;
  assert.deepStrictEqual(l.map((o) => o.texto), ['c', 'Misiones Dofawa']);
  const grupo = l[1];
  assert.strictEqual(grupo.hecho, true);
  assert.deepStrictEqual(grupo.subs.map((s) => [s.texto, s.hecho]), [['a', true], ['b', true]]);

  objetivos.desmarcarTodos('u1');
  const otra = objetivos.leer('u1').objetivos[1];
  assert.ok(!otra.hecho && otra.subs.every((s) => !s.hecho), 'y se puede repetir');
});
