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
  assert.ok(objetivos.anadir('u1', 'paso 1', a.id).ok);
  assert.ok(objetivos.anadir('u1', 'paso 2', a.id).ok);
  assert.strictEqual(objetivos.anadir('u1', '  ', a.id).ok, false);
  assert.strictEqual(objetivos.anadir('u1', 'x', 'no-existe').ok, false);
  const [s1, s2] = objetivos.leer('u1').objetivos[0].subs;
  const de = (id) => objetivos.leer('u1').objetivos.find((o) => o.id === id);

  objetivos.cambiar('u1', s1.id, { hecho: true });
  assert.deepStrictEqual([de(a.id).hecho, de(a.id).proceso], [false, true], 'con uno no basta');
  objetivos.cambiar('u1', s2.id, { hecho: true });
  assert.strictEqual(de(a.id).hecho, true, 'con todos, hecho');
  assert.strictEqual(de(b.id).proceso, true, 'y pasa el siguiente');

  objetivos.cambiar('u1', s2.id, { hecho: false });
  assert.strictEqual(de(a.id).hecho, false, 'desmarcar un paso lo deja sin hacer');
  assert.strictEqual(cargar('objetivos', d).leer('u1').objetivos[0].subs.length, 2, 'se guardan');

  objetivos.desmarcarTodos('u1');
  assert.ok(de(a.id).subs.every((s) => !s.hecho), 'desmarcar todos tambien los pasos');
  objetivos.quitar('u1', s1.id);
  assert.deepStrictEqual(de(a.id).subs.map((s) => s.texto), ['paso 2']);
});

test('carpetas sin limite: lo hecho sube nivel a nivel y marcar una carpeta marca lo de dentro', (t) => {
  const { objetivos } = montar(t);
  objetivos.anadir('u1', 'raiz');
  let padre = objetivos.leer('u1').objetivos[0].id;
  const ids = [padre];
  // Diez niveles: mas de lo que dejaba antes.
  for (let n = 1; n <= 10; n++) {
    assert.ok(objetivos.anadir('u1', 'nivel ' + n, padre).ok, 'nivel ' + n);
    let nodo = objetivos.leer('u1').objetivos[0];
    while (nodo.subs.length) nodo = nodo.subs[0];
    padre = nodo.id;
    ids.push(padre);
  }
  const hondo = () => { const r = []; let x = objetivos.leer('u1').objetivos[0]; while (x) { r.push(x.hecho); x = x.subs[0]; } return r; };

  objetivos.cambiar('u1', ids[10], { hecho: true });
  assert.ok(hondo().every(Boolean), 'el ultimo de dentro completa todas las de fuera');
  objetivos.cambiar('u1', ids[10], { hecho: false });
  assert.ok(hondo().every((h) => !h), 'y desmarcarlo las deshace');

  objetivos.cambiar('u1', ids[5], { hecho: true });
  assert.deepStrictEqual(hondo().slice(5), [true, true, true, true, true, true], 'marcar una carpeta marca lo de dentro');
  assert.ok(hondo().slice(0, 5).every(Boolean), 'y, al ser lo unico, las de fuera');
});

test('mover como carpetas: dentro, delante, detras y a la lista principal', (t) => {
  const { objetivos } = montar(t);
  ['a', 'b', 'c'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b, c] = objetivos.leer('u1').objetivos;
  const arbol = () => {
    const pinta = (subs) => subs.map((s) => s.texto + (s.subs.length ? '(' + pinta(s.subs) + ')' : '')).join(' ');
    return pinta(objetivos.leer('u1').objetivos);
  };

  objetivos.cambiar('u1', b.id, { proceso: true });
  assert.ok(objetivos.moverA('u1', b.id, a.id, 'dentro').ok);
  assert.strictEqual(arbol(), 'a(b) c');
  assert.strictEqual(objetivos.leer('u1').objetivos[0].subs[0].proceso, undefined, 'dentro de otro ya no esta en proceso');

  assert.ok(objetivos.moverA('u1', c.id, b.id, 'antes').ok);
  assert.strictEqual(arbol(), 'a(c b)');
  assert.ok(objetivos.moverA('u1', c.id, b.id, 'despues').ok);
  assert.strictEqual(arbol(), 'a(b c)');
  assert.ok(objetivos.moverA('u1', c.id, b.id, 'dentro').ok);
  assert.strictEqual(arbol(), 'a(b(c))');

  assert.strictEqual(objetivos.moverA('u1', a.id, c.id, 'dentro').ok, false, 'no dentro de lo suyo');
  assert.strictEqual(arbol(), 'a(b(c))', 'y no se pierde nada');

  assert.ok(objetivos.moverA('u1', b.id, '', 'dentro').ok);
  assert.strictEqual(arbol(), 'a b(c)', 'a la lista principal, con lo suyo');
  assert.strictEqual(objetivos.leer('u1').objetivos[1].proceso, false);

  // Sacar lo unico que faltaba deja la carpeta de antes hecha.
  objetivos.anadir('u1', 'x', a.id);
  objetivos.anadir('u1', 'y', a.id);
  const [x, y] = objetivos.leer('u1').objetivos[0].subs;
  objetivos.cambiar('u1', x.id, { hecho: true });
  objetivos.moverA('u1', y.id, '', 'dentro');
  assert.strictEqual(objetivos.leer('u1').objetivos[0].hecho, true);
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

test('guardar los completados se lleva lo que tengan dentro', (t) => {
  const { objetivos } = montar(t);
  objetivos.anadir('u1', 'a');
  const a = objetivos.leer('u1').objetivos[0];
  objetivos.anadir('u1', 'paso', a.id);
  objetivos.cambiar('u1', a.id, { hecho: true });
  assert.ok(objetivos.agruparHechos('u1', 'Grupo').ok);
  const grupo = objetivos.leer('u1').objetivos[0];
  assert.deepStrictEqual(grupo.subs[0].subs.map((s) => [s.texto, s.hecho]), [['paso', true]]);
});

test('ordenar: el orden entero de una vez, el del boton Guardar', (t) => {
  const { objetivos, avisados } = montar(t);
  ['a', 'b', 'c'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b, c] = objetivos.leer('u1').objetivos;
  objetivos.anadir('u1', 'x', a.id);
  const x = objetivos.leer('u1').objetivos[0].subs[0];
  objetivos.cambiar('u1', c.id, { proceso: true });
  const arbol = () => {
    const pinta = (subs) => subs.map((s) => s.texto + (s.proceso ? '▶' : '') + (s.subs.length ? '(' + pinta(s.subs) + ')' : '')).join(' ');
    return pinta(objetivos.leer('u1').objetivos);
  };
  const antes = avisados.length;

  const r = objetivos.ordenar('u1', [{ id: c.id }, { id: a.id, subs: [{ id: b.id }, { id: x.id }] }]);
  assert.ok(r.ok);
  assert.strictEqual(arbol(), 'c▶ a(b x)', 'cada uno donde se dijo, y en proceso se conserva en la principal');
  assert.strictEqual(avisados.length, antes + 1, 'una sola escritura y un solo aviso');

  objetivos.ordenar('u1', [{ id: a.id, subs: [{ id: c.id }, { id: b.id }, { id: x.id }] }]);
  assert.strictEqual(arbol(), 'a(c b x)', 'al meterlo dentro deja de estar en proceso');
});

test('ordenar: lo que cambio mientras se ordenaba no se pierde', (t) => {
  const { objetivos } = montar(t);
  ['a', 'b'].forEach((x) => objetivos.anadir('u1', x));
  const [a, b] = objetivos.leer('u1').objetivos;
  objetivos.anadir('u1', 'y', a.id);
  objetivos.anadir('u1', 'nuevo');
  const textos = () => {
    const pinta = (subs) => subs.map((s) => s.texto + (s.hecho ? '✓' : '') + (s.subs.length ? '(' + pinta(s.subs) + ')' : '')).join(' ');
    return pinta(objetivos.leer('u1').objetivos);
  };

  // El borrador no sabe de «nuevo» ni de «y», y trae uno que ya se quito.
  assert.ok(objetivos.ordenar('u1', [{ id: b.id }, { id: 'quitado' }, { id: a.id }, { id: b.id }]).ok);
  assert.strictEqual(textos(), 'b a(y) nuevo', 'los que no venian se quedan en su carpeta o al final; repetidos y quitados fuera');

  // Las carpetas se repasan: si lo de dentro esta hecho, la carpeta tambien.
  objetivos.cambiar('u1', b.id, { hecho: true });
  objetivos.ordenar('u1', [{ id: a.id, subs: [{ id: b.id }] }, { id: 'x' }]);
  assert.strictEqual(textos(), 'a(b✓ y) nuevo');

  assert.strictEqual(objetivos.ordenar('u1', 'basura').ok, false);
  assert.strictEqual(textos(), 'a(b✓ y) nuevo', 'un orden que no se entiende no toca nada');
});
