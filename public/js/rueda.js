// La ruleta girando de la ruleta de recursos: la rueda, los recursos que dan
// vueltas alrededor y dónde se para.
//
// Aparte para poder usarla en dos sitios, la página del Ruleton y el widget que
// se mete en OBS, igual que la tragaperras (js/tragaperras.js). Antes vivía
// dentro de index.html y el widget no la tenía: enseñaba siempre la
// tragaperras, aunque el dueño hubiera elegido la ruleta.
//
// Cómo gira, que es lo que la hace parecer una ruleta y no unas imágenes
// cambiando:
//
//   - La rueda y los doce recursos de alrededor giran JUNTOS, como una sola
//     pieza. Antes giraba la rueda por CSS y los recursos se quedaban quietos.
//   - Arranca rápido y frena poco a poco hasta pararse con el premio justo
//     debajo de la flecha. El giro se mueve desde aquí y no con una animación de
//     CSS precisamente para eso: hay que saber DÓNDE va a parar.
//   - La flecha da un golpecito cada vez que pasa un recurso por debajo; al
//     frenar se oyen (se ven) cada vez más espaciados.
//   - Mientras va rápido, los recursos cambian de imagen y se desenfocan. Al
//     frenar dejan de cambiar y los premios ya están en su sitio, así que se ven
//     llegar. Si hay varios premios, quedan juntos a los dos lados del primero.
//   - Al pararse, se encienden de dentro afuera, empezando por el de la flecha.
//
// La rueda se para un poco ANTES de que acabe la espera (PAUSA), para que dé
// tiempo a ver encenderse los premios antes de que la página o el widget la
// cambien por las tarjetas del resultado.
//
// Aquí no hay estado propio ni se sabe de dónde vienen los recursos: se recibe el
// sitio donde montarla, con qué rellenar y qué ha salido.

(function () {
  'use strict';

  // Cuántos recursos dan vueltas alrededor de la rueda.
  const ALREDEDOR = 12;
  // Cuántas vueltas enteras da antes de pararse. Las cinco de siempre.
  const VUELTAS = 5;
  // Lo que se queda quieta antes de que acabe la espera, para encender premios.
  const PAUSA = 900;
  // Cada cuánto cambian de imagen los recursos mientras va rápida.
  const RITMO = 120;
  // A partir de qué parte del giro dejan de cambiar: lo que queda es frenar, y
  // eso se tiene que ver con los premios ya puestos.
  const ASENTAR = 0.6;
  // Cuánto tarda en encenderse cada premio después del anterior, como mucho.
  const ENCENDER = 110;

  // Cuánto ha girado (en grados) en la parte «t» del giro, de 0 a 1, si en total
  // gira «total». Frena con una curva de cuarto grado: arranca a toda velocidad
  // y llega a cero sin golpe, que es como para una ruleta de verdad.
  function angulo(t, total) {
    const x = Math.max(0, Math.min(1, Number(t) || 0));
    return total * (1 - Math.pow(1 - x, 4));
  }

  // Cuánto tiene que girar para que el recurso «casilla» de «n» acabe debajo de
  // la flecha, que está arriba. Los recursos empiezan con el 0 arriba y giran en
  // el sentido de las agujas del reloj, así que se le restan sus grados.
  function giroTotal(casilla, n, vueltas) {
    const paso = 360 / Math.max(1, n);
    return (vueltas == null ? VUELTAS : vueltas) * 360 - casilla * paso;
  }

  // Dónde caen los premios: el primero en «casilla», que es la de la flecha, y
  // los demás pegados a los dos lados (derecha, izquierda, derecha...). Así al
  // pararse quedan todos juntos bajo la flecha y no repartidos por la rueda.
  function casillas(casilla, cuantos, n) {
    const k = Math.min(Math.max(0, cuantos), n);
    const r = [];
    for (let i = 0; r.length < k; i++) {
      const lado = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      r.push(((casilla + lado) % n + n) % n);
    }
    return r;
  }

  // Dónde va el recurso «i» de «n», con la ruleta girada «giro» grados y a
  // tamaño «escala». Las cuentas son las de siempre: un círculo de 228 px de
  // radio en una caja de 520, empezando arriba.
  function posicion(i, n, escala, giro) {
    const e = Number(escala) || 1;
    const a = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2 + ((Number(giro) || 0) * Math.PI) / 180;
    return {
      left: 260 * e + Math.cos(a) * 228 * e,
      top: 260 * e + Math.sin(a) * 228 * e
    };
  }

  function pintar(nodo, cosa) {
    const img = nodo.querySelector('img');
    if (!img || !cosa) return;
    img.style.display = '';
    img.src = cosa.imagen || '';
    img.alt = cosa.nombre || 'recurso';
  }

  const cuadro = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(() => fn(Date.now()), 16);
  const noCuadro = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

  // Monta la ruleta y la pone a girar.
  //
  //   caja      donde se monta (se vacía): ahí van la rueda y los recursos
  //   panel     si hay que destaparlo, se destapa aquí, antes de animar
  //   relleno   con qué dan vueltas: [{ nombre, imagen }]
  //   premios   qué ha salido. Puede llegar más tarde con mando.premios().
  //   espera    cuánto dura todo, contando la pausa del final
  //   escala    el tamaño (1 = normal)
  //   imagen    la imagen de la rueda que haya subido el dueño ('' = colores)
  //
  // Devuelve un mando: `premios(lista)`, `escala(n)` y `quitar()`.
  function montar(opciones) {
    const caja = opciones.caja;
    const relleno = (opciones.relleno || []).filter((c) => c && c.imagen);
    if (!caja || !relleno.length) return null;

    // Destapar antes de montar, por lo mismo que la tragaperras y la cinta: lo
    // que se mide o se anima oculto no se ve.
    if (opciones.panel) opciones.panel.hidden = false;

    const espera = Math.max(600, Number(opciones.espera) || 5000);
    // Lo que gira de verdad. Si queda poco (el widget se ha enterado tarde) se
    // come antes la pausa que el giro.
    const dura = Math.max(400, espera - Math.min(PAUSA, espera / 3));
    let escala = Number(opciones.escala) || 1;
    const alarmas = [];

    caja.innerHTML = '';
    const rueda = document.createElement('div');
    rueda.className = 'roulette-wheel girando';
    if (opciones.imagen) {
      rueda.classList.add('custom');
      rueda.style.setProperty('--wheel-image', 'url(' + JSON.stringify(String(opciones.imagen)) + ')');
    }
    caja.appendChild(rueda);

    // La flecha va FUERA de la rueda: dentro giraría con ella y no señalaría
    // nada. Apunta al recurso de arriba, que es donde se para el premio.
    const flecha = document.createElement('span');
    flecha.className = 'roulette-pin';
    caja.appendChild(flecha);

    const orbita = document.createElement('div');
    orbita.className = 'roulette-items';
    caja.appendChild(orbita);

    const alAzar = () => relleno[Math.floor(Math.random() * relleno.length)];
    const barajados = relleno.slice().sort(() => Math.random() - 0.5);
    const nodos = [];
    for (let i = 0; i < ALREDEDOR; i++) {
      const nodo = document.createElement('div');
      nodo.className = 'roulette-item';
      const img = document.createElement('img');
      img.onerror = function () { this.style.display = 'none'; };
      nodo.appendChild(img);
      pintar(nodo, barajados[i % barajados.length]);
      orbita.appendChild(nodo);
      nodos.push(nodo);
    }

    // Dónde se para: una casilla al azar, para que no caiga siempre en el mismo
    // sitio de la rueda.
    const casilla = Math.floor(Math.random() * ALREDEDOR);
    const total = giroTotal(casilla, ALREDEDOR, VUELTAS);
    const paso = 360 / ALREDEDOR;

    let premiados = [];   // [{ nodo, cosa }], en el orden en que se encienden
    let giro = 0;
    let inicio = 0;
    let marca = -1;       // qué recurso pasó el último por la flecha
    let ultimoCambio = 0;
    let parada = false;
    let id = 0;

    function colocar() {
      nodos.forEach((nodo, i) => {
        const p = posicion(i, nodos.length, escala, giro);
        nodo.style.left = p.left + 'px';
        nodo.style.top = p.top + 'px';
      });
      // La rueda gira con ellos. Al empezar crece un poco, como antes.
      const t = inicio ? Math.min(1, (Date.now() - inicio) / dura) : 0;
      const crece = t < 0.15 ? 0.92 + (t / 0.15) * 0.1 : 1.02 - Math.min(1, (t - 0.15) / 0.3) * 0.02;
      rueda.style.transform = 'rotate(' + giro + 'deg) scale(' + crece + ')';
    }

    function golpecito() {
      if (!flecha || typeof flecha.animate !== 'function') return;
      flecha.animate([
        { transform: 'translateX(-50%) rotate(0deg)' },
        { transform: 'translateX(-50%) rotate(-16deg)' },
        { transform: 'translateX(-50%) rotate(0deg)' }
      ], { duration: 140, easing: 'ease-out' });
    }

    // Los premios, en su casilla. Se ponen en cuanto se saben si ya va frenando,
    // o al llegar a ASENTAR si se saben antes.
    function asentar() {
      premiados.forEach(({ nodo, cosa }) => {
        pintar(nodo, cosa);
        nodo.dataset.winner = '1';
        nodo.querySelector('img').style.opacity = '1';
      });
    }

    // Se para: en su sitio exacto, nítida, y se encienden los premios.
    function parar() {
      if (parada) return;
      parada = true;
      noCuadro(id);
      giro = total;
      colocar();
      rueda.classList.remove('girando');
      rueda.classList.add('parada');
      orbita.style.filter = '';
      encender();
    }

    function encender() {
      asentar();
      const cada = premiados.length > 1 ? Math.min(ENCENDER, (PAUSA * 0.6) / (premiados.length - 1)) : 0;
      premiados.forEach(({ nodo }, i) => {
        alarmas.push(setTimeout(() => {
          nodo.classList.add('winner');
          if (i === 0) nodo.classList.add('elegido');
        }, i * cada));
      });
    }

    function cuadroDeGiro() {
      if (parada) return;
      if (!inicio) inicio = Date.now();
      const t = Math.min(1, (Date.now() - inicio) / dura);
      giro = angulo(t, total);
      colocar();

      // Lo que pasa por la flecha: un golpecito por recurso.
      const bajo = Math.floor((giro + paso / 2) / paso);
      if (bajo !== marca) { if (marca >= 0) golpecito(); marca = bajo; }

      // Rápida: desenfocada y cambiando de imágenes. Frenando: quieta y nítida.
      const velocidad = (4 * total * Math.pow(1 - t, 3)) / dura;   // grados por ms
      orbita.style.filter = velocidad > 0.6 ? 'blur(' + Math.min(1.6, velocidad / 1.2).toFixed(2) + 'px)' : '';
      if (t < ASENTAR && Date.now() - ultimoCambio > RITMO) {
        ultimoCambio = Date.now();
        nodos.forEach((nodo) => { if (!nodo.dataset.winner && Math.random() < 0.5) pintar(nodo, alAzar()); });
      } else if (t >= ASENTAR) {
        asentar();
      }

      if (t < 1) id = cuadro(cuadroDeGiro);
      else parar();
    }
    colocar();
    inicio = Date.now();
    id = cuadro(cuadroDeGiro);
    // Y el final no depende de los cuadros: el navegador deja de darlos con la
    // pestaña de fondo o la fuente de OBS oculta, y la ruleta se quedaría a
    // medio frenar sin encender nada. Esto la para a su hora pase lo que pase.
    alarmas.push(setTimeout(parar, dura));

    function premios(lista) {
      const cosas = (lista || []).filter(Boolean);
      premiados = casillas(casilla, cosas.length, nodos.length)
        .map((c, i) => ({ nodo: nodos[c], cosa: cosas[i] }));
      // Si ya va frenando (o se ha parado), en su sitio ya mismo.
      const t = inicio ? (Date.now() - inicio) / dura : 0;
      if (t >= ASENTAR) asentar();
      if (parada) encender();
    }
    if (opciones.premios && opciones.premios.length) premios(opciones.premios);

    return {
      premios,
      escala(n) { escala = Number(n) || 1; colocar(); },
      quitar() {
        noCuadro(id);
        alarmas.forEach(clearTimeout);
        caja.innerHTML = '';
      }
    };
  }

  // globalThis y no window, como en tragaperras.js: así los tests pueden cargar
  // esto sin navegador.
  globalThis.Rueda = { montar, angulo, giroTotal, casillas, posicion, ALREDEDOR, VUELTAS, PAUSA };
})();
