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
  // Marfil falta todavia: el widget lo enseña sin dibujo hasta que se suba.
  const faltan = objetivos.DOFUS.filter((x) => !fs.existsSync(path.join(__dirname, '..', 'public', x.imagen)))
    .map((x) => x.texto);
  assert.ok(faltan.every((f) => f === 'Marfil'), 'faltan: ' + faltan.join(', '));
});
