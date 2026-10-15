// Adivina la palabra (adivina.ts).
//
// Lo que se comprueba:
//  - Que acierta quien escribe la palabra, con o sin tildes, mayusculas o algo
//    de relleno, y no quien suelta una lista de palabras.
//  - Que el primero que acierta se lleva los puntos y el premio, y que despues
//    ya no gana nadie mas.
//  - Que la palabra no sale hacia el widget hasta que se acaba.
//  - Que una pista no puede llevar la palabra dentro.
//  - Que las pistas se fijan en el chat todas juntas, y que pueden ser una
//    imagen (solo de las subidas o de internet).
//  - Que la partida sobrevive a un reinicio.

const { test } = require('node:test');
const assert = require('node:assert');
const { carpeta, cargar, deps } = require('./ayuda');

function montar(raiz) {
  const d = deps(raiz);
  const sumados = [];
  const apuntados = [];
  const fijados = [];
  d.sumarPuntos = (uid, nombre, cuantos) => { sumados.push([nombre, cuantos]); return cuantos; };
  d.apuntarGanador = (ambito, nombre, premio) => { apuntados.push([ambito, nombre, premio.kamas]); return true; };
  d.fijar = (uid, texto) => fijados.push(texto);
  const a = cargar('adivina', d);
  return { a, d, sumados, apuntados, fijados };
}

test('acierta con o sin tildes y con algo de relleno, pero no con una lista', () => {
  const c = carpeta();
  try {
    const { a } = montar(c.raiz);
    assert.ok(a.acierta('arbol', 'Árbol'));
    assert.ok(a.acierta('¡ÁRBOL!', 'arbol'));
    assert.ok(a.acierta('es arbol?', 'árbol'));
    assert.ok(a.acierta('dofus ocre', 'Dofus Ocre'));
    assert.ok(!a.acierta('arboles', 'arbol'), 'otra palabra no vale');
    assert.ok(!a.acierta('perro gato casa arbol mesa', 'arbol'), 'una lista no vale');
    assert.ok(!a.acierta('año', 'ano'), 'la ñ cuenta');
    assert.strictEqual(a.forma('Dofus Ocre'), '_ _ _ _ _   _ _ _ _');
  } finally { c.quitar(); }
});

test('el primero que acierta se lleva puntos y premio, y nadie mas', () => {
  const c = carpeta();
  try {
    const { a, sumados, apuntados, fijados } = montar(c.raiz);
    a.guardarAjustes('u1', { puntos: 15, premio: { kamas: 1000, texto: '' } });
    assert.ok(a.abrir('u1', '', { palabra: 'Jalató', ambito: 'u1/dofus/s1' }).ok);

    assert.strictEqual(a.intentar('u1', 'Ana', 'gato'), false);
    assert.strictEqual(a.intentar('u1', 'Beto', 'jalato'), true);
    assert.strictEqual(a.intentar('u1', 'Carla', 'jalato'), false, 'ya estaba acabada');

    const e = a.estado('u1');
    assert.strictEqual(e.partida.fase, 'fin');
    assert.strictEqual(e.partida.ganador, 'Beto');
    assert.strictEqual(e.partida.intentos, 2);
    assert.strictEqual(e.partida.cuantos, 2);
    assert.strictEqual(e.partida.apuntado, true);
    assert.deepStrictEqual(sumados, [['Beto', 15]]);
    assert.deepStrictEqual(apuntados, [['u1/dofus/s1', 'Beto', 1000]]);
    assert.ok(fijados[fijados.length - 1].includes('Beto') && fijados[fijados.length - 1].includes('Jalató'),
      'lo ultimo fijado es quien ha ganado');
  } finally { c.quitar(); }
});

test('la palabra no sale hacia el widget hasta que se acaba', () => {
  const c = carpeta();
  try {
    const { a } = montar(c.raiz);
    a.abrir('u1', '', { palabra: 'Secreto', pista: 'no se cuenta', letras: true });
    const durante = a.estadoPublico('u1');
    assert.strictEqual(durante.palabra, '');
    assert.ok(!JSON.stringify(durante).toLowerCase().includes('secreto'));
    assert.deepStrictEqual(durante.pistas, [{ texto: 'no se cuenta', imagen: '' }]);
    assert.strictEqual(durante.forma, '_ _ _ _ _ _ _');

    a.revelar('u1');
    const despues = a.estadoPublico('u1');
    assert.strictEqual(despues.palabra, 'Secreto');
    assert.strictEqual(despues.ganador, '');
  } finally { c.quitar(); }
});

test('una pista no puede llevar la palabra dentro', () => {
  const c = carpeta();
  try {
    const { a } = montar(c.raiz);
    a.abrir('u1', '', { palabra: 'sol' });
    assert.strictEqual(a.darPista('u1', 'Brilla el Sol').ok, false);
    assert.strictEqual(a.darPista('u1', 'lo lleva un soldado').ok, true, 'soldado no es sol');
    assert.strictEqual(a.abrir('u1', '', { palabra: '  ¿? ' }).ok, false, 'sin palabra no se empieza');
  } finally { c.quitar(); }
});

test('la partida sobrevive a un reinicio', () => {
  const c = carpeta();
  try {
    const { a } = montar(c.raiz);
    a.abrir('u1', '', { palabra: 'Kralamar', pista: 'vive en el agua' });
    a.darPista('u1', 'tiene tentáculos');

    const { a: otra } = montar(c.raiz);
    assert.strictEqual(otra.rehacer('u1'), true);
    const e = otra.estado('u1');
    assert.strictEqual(e.partida.palabra, 'Kralamar');
    assert.deepStrictEqual(e.partida.pistas.map((p) => p.texto), ['vive en el agua', 'tiene tentáculos']);
    assert.strictEqual(otra.intentar('u1', 'Ana', 'kralamar'), true);
  } finally { c.quitar(); }
});

test('las pistas se fijan en el chat todas juntas, y pueden ser una imagen', () => {
  const c = carpeta();
  try {
    const { a, fijados } = montar(c.raiz);
    a.abrir('u1', '', { palabra: 'Kralamar', pista: 'vive en el agua' });
    assert.strictEqual(fijados.length, 1, 'al empezar se fija el aviso con la primera pista');
    assert.ok(fijados[0].includes('1) vive en el agua'));

    assert.ok(a.darPista('u1', '', '/assets/adivina-abc.png').ok, 'una imagen sola vale');
    assert.ok(a.darPista('u1', 'tiene tentaculos').ok);
    const ultimo = fijados[fijados.length - 1];
    assert.ok(ultimo.includes('1) vive en el agua') && ultimo.includes('2) 🖼') && ultimo.includes('3) tiene tentaculos'),
      'el mensaje fijado lleva todas las pistas: ' + ultimo);
    assert.ok(!ultimo.toLowerCase().includes('kralamar'), 'y nunca la palabra');

    assert.strictEqual(a.darPista('u1', '', 'javascript:alert(1)').ok, false, 'una imagen que no vale no es pista');
    assert.strictEqual(a.estadoPublico('u1').pistas[1].imagen, '/assets/adivina-abc.png');

    // Con muchas pistas largas no cabe todo: se caen las viejas, no las nuevas.
    for (let i = 0; i < 12; i++) a.darPista('u1', 'pista larga numero ' + i + ' '.padEnd(40, 'x'));
    const lleno = fijados[fijados.length - 1];
    assert.ok(lleno.length <= 500);
    assert.ok(lleno.includes('numero 11'), 'la ultima pista sigue');
  } finally { c.quitar(); }
});
