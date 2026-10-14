// El dibujo del bingo: la bola que acaba de salir, el tablero de las 75 y el
// carton. Lo usan la pagina, el widget de OBS y la pagina del carton del
// espectador; tener tres copias acabaria con tres bingos distintos.
//
// Aqui no se decide nada. Las bolas las saca el servidor y los cartones los
// reparte el servidor: esto solo los pinta. Los estilos, en css/bingo.css.

(function () {
  'use strict';

  const LETRAS = ['B', 'I', 'N', 'G', 'O'];
  const LIBRE = 0;

  function letraDe(n) {
    return LETRAS[Math.floor((n - 1) / 15)] || '';
  }

  function claseDe(n) {
    return 'bingo-' + letraDe(n).toLowerCase();
  }

  // La bola grande. Sin numero, una bola apagada que dice que aun no ha salido
  // ninguna. `nueva` la hace entrar rodando, solo cuando acaba de salir: si se
  // animara en cada repintado, daria vueltas cada vez que alguien se apunta.
  function bola(el, n, nueva) {
    if (!el) return;
    if (!n) {
      el.className = 'bingo-bola vacia';
      el.innerHTML = '<span class="numero">?</span>';
      return;
    }
    el.className = 'bingo-bola ' + claseDe(n);
    el.innerHTML = '<span class="letra">' + letraDe(n) + '</span><span class="numero">' + n + '</span>';
    if (nueva) {
      // Quitar y poner la clase no reinicia la animacion si no hay un repintado
      // por medio; leer el ancho lo fuerza.
      void el.offsetWidth;
      el.classList.add('nueva');
    }
  }

  // El tablero de las 75, con las que han salido encendidas y la ultima
  // marcada. Se monta una vez y luego solo se cambian clases.
  function tablero(el, salidas) {
    if (!el) return;
    if (!el.dataset.montado) {
      let html = '';
      LETRAS.forEach((l, c) => {
        html += '<div class="letra bingo-' + l.toLowerCase() + '">' + l + '</div>';
        for (let i = 1; i <= 15; i++) {
          const n = c * 15 + i;
          html += '<div class="num ' + claseDe(n) + '" data-n="' + n + '">' + n + '</div>';
        }
      });
      el.innerHTML = html;
      el.classList.add('bingo-tablero');
      el.dataset.montado = '1';
    }
    const fuera = new Set(salidas || []);
    const ultima = (salidas || [])[(salidas || []).length - 1];
    el.querySelectorAll('.num').forEach((d) => {
      const n = Number(d.dataset.n);
      d.classList.toggle('salio', fuera.has(n));
      d.classList.toggle('ultima', n === ultima);
    });
  }

  // Las diez lineas, como en el servidor: cinco filas y cinco columnas, en
  // casillas [columna, fila]. Las diagonales no cuentan.
  const LINEAS = (() => {
    const l = [];
    for (let f = 0; f < 5; f++) l.push([0, 1, 2, 3, 4].map((c) => [c, f]));
    for (let c = 0; c < 5; c++) l.push([0, 1, 2, 3, 4].map((f) => [c, f]));
    return l;
  })();

  // El carton, con lo que ha salido marcado y las lineas hechas resaltadas.
  //   opciones.mini       mas pequeño, para la lista del panel
  //   opciones.fuera      descalificado: se ve apagado
  function carton(el, numeros, salidas, opciones) {
    if (!el) return;
    const op = opciones || {};
    const fuera = new Set(salidas || []);
    const marcada = (c, f) => numeros[c][f] === LIBRE || fuera.has(numeros[c][f]);
    const enLinea = new Set();
    LINEAS.forEach((l) => {
      if (l.every(([c, f]) => marcada(c, f))) l.forEach(([c, f]) => enLinea.add(c + ',' + f));
    });
    let html = LETRAS.map((l) => '<div class="cab bingo-' + l.toLowerCase() + '">' + l + '</div>').join('');
    for (let f = 0; f < 5; f++) {
      for (let c = 0; c < 5; c++) {
        const n = numeros[c][f];
        const clases = ['casilla', 'bingo-' + LETRAS[c].toLowerCase()];
        if (marcada(c, f)) clases.push('marcada');
        if (n === LIBRE) clases.push('libre');
        if (enLinea.has(c + ',' + f)) clases.push('en-linea');
        // El número va en data-n para saber qué casilla se toca al marcar a mano.
        html += '<div class="' + clases.join(' ') + '" data-n="' + n + '">' + (n === LIBRE ? '★' : n) + '</div>';
      }
    }
    el.className = 'bingo-carton' + (op.mini ? ' mini' : '') + (op.fuera ? ' fuera' : '');
    el.innerHTML = html;
  }

  // Todos los cartones de una persona, uno al lado de otro: se pueden comprar
  // varios. Devuelve cuántos tienen ya lo que se pide en «que» ('linea' o
  // 'bingo'), para poder decirle que cante.
  //
  // «salidas» es lo que se da por marcado: las bolas que han salido (el panel)
  // o, si es una lista por cartón (opciones.porCarton), lo que el espectador
  // ha marcado a mano en cada uno.
  function cartones(el, lista, salidas, opciones) {
    if (!el) return 0;
    el.className = 'bingo-cartones';
    el.innerHTML = '';
    let loTienen = 0;
    (lista || []).forEach((numeros, i) => {
      const uno = document.createElement('div');
      el.appendChild(uno);
      carton(uno, numeros, (opciones || {}).porCarton ? (salidas || [])[i] : salidas, opciones);
      uno.dataset.indice = String(i);
      if ((lista || []).length > 1) uno.dataset.numero = '#' + (i + 1);
      const op = opciones || {};
      if (op.que === 'linea' && uno.querySelector('.en-linea')) loTienen++;
      if (op.que === 'bingo' && uno.querySelectorAll('.casilla.marcada').length === 25) loTienen++;
    });
    return loTienen;
  }

  // Lo que se dice de un canto, igual en todas partes.
  // Lo que se lleva, si hay premio: «5.000.000 kamas», «Dofus Ocre», o los dos.
  function textoPremio(p) {
    if (!p) return '';
    const partes = [];
    if (p.texto) partes.push(p.texto);
    if (p.kamas > 0) partes.push(Number(p.kamas).toLocaleString('es-ES') + ' kamas');
    return partes.length ? ' · se lleva ' + partes.join(' + ') : '';
  }

  function textoCanto(c) {
    if (c.que === 'linea') return '¡LÍNEA! ' + c.nombre + (c.puntos ? ' +' + c.puntos : '') + textoPremio(c.premio);
    if (c.que === 'bingo') return '¡BINGO! ' + c.nombre + (c.puntos ? ' +' + c.puntos : '') + textoPremio(c.premio);
    if (c.que === 'tarde') return c.nombre + ' cantó tarde: se le pasó';
    return c.nombre + ' cantó en falso: descalificado';
  }

  window.BingoDibujo = { LETRAS, LIBRE, letraDe, bola, tablero, carton, cartones, textoCanto };
})();
