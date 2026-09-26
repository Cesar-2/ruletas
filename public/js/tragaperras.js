// La tragaperras de la ruleta de recursos: cómo se montan los rodillos, cada
// cuánto cambian de imagen y cuándo para cada uno.
//
// Aparte para poder usarla en dos sitios, la página del Ruleton y el widget que
// se mete en OBS. Es lo mismo que se hizo con el tablero de clavijas y con el
// rodillo de nombres, y por la misma razón: el widget se había hecho su propia
// versión, con tres rodillos fijos en vez de uno por recurso, otro ritmo y sin la
// parada escalonada. No se parecían.
//
// Lo que hace que esto parezca una tragaperras y no unas imágenes cambiando:
//
//   - Un rodillo POR RECURSO sorteado, en filas de cinco como máximo.
//   - Todos cambian de imagen a la vez, cada 190 ms.
//   - Y paran de izquierda a derecha, repartidos dentro de la espera, de forma
//     que el último cae justo antes del final. Eso es lo que da la tensión; si
//     paran todos juntos, no hay nada que esperar.
//
// Aquí no hay estado propio ni se sabe de dónde vienen los recursos: se recibe el
// sitio donde montarla, con qué rellenar y qué ha salido. Quien llama decide
// cuándo empieza y cuándo se quita.

(function () {
  'use strict';

  // Cada cuánto cambia la imagen de un rodillo.
  const RITMO = 190;
  // Cuántos rodillos caben en una fila, y en total.
  const POR_FILA = 5;
  const MAX = 20;
  // Cuándo para el primero y cuánto se reparte hasta el último.
  const PRIMERA_PARADA = 1800;
  const REPARTO = 2700;
  // Con un solo rodillo no hay nada que repartir.
  const PARADA_SOLA = 3200;

  const RAREZAS = ['rare', 'epic', 'mythic'];

  // Escapar sin tocar el DOM: la misma cuenta que escapeHtml en la pagina. Sin
  // DOM porque asi esto se puede probar sin navegador, y porque crear un elemento
  // por nombre para una lista de doscientos es tirar trabajo.
  // Cuando para el rodillo «i» de «n», dentro de una espera de «espera» ms.
  //
  // Aparte y exportada para poder comprobarla sin navegador. Antes la cuenta
  // estaba metida dentro de montar() y el test la copiaba con sus propios
  // numeros: o sea que el test comprobaba su copia, y cambiar el reparto aqui no
  // lo hacia fallar. Un test que no puede fallar no vale nada.
  //
  // Las paradas se reparten DENTRO de la espera, para que quepan todas sea uno o
  // sean veinte: la ultima cae al final. Se escala con la espera de verdad, asi
  // que si el widget se entera tarde el reparto se encoge y sigue acabando a
  // tiempo.
  function cuando(n, i, espera) {
    const total = PRIMERA_PARADA + REPARTO;
    const prop = n > 1
      ? (PRIMERA_PARADA + (i * REPARTO) / (n - 1)) / total
      : PARADA_SOLA / total;
    return Math.max(200, Math.min(espera, espera * prop));
  }

  function escapa(t) {
    return String(t == null ? '' : t)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Pinta un recurso dentro de un rodillo. `cosa` es { nombre, imagen, rareza }.
  function pintar(reel, cosa) {
    const c = cosa || {};
    for (const r of RAREZAS) reel.classList.remove(r);
    if (RAREZAS.indexOf(c.rareza) >= 0) reel.classList.add(c.rareza);
    reel.innerHTML =
      '<img src="' + escapa(c.imagen || '') + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
      '<div class="slot-name">' + escapa(c.nombre || '') + '</div>';
  }

  // Monta la tragaperras y la pone a girar.
  //
  //   caja      donde se monta (se vacía)
  //   cuantos   cuántos rodillos, o sea cuántos recursos se sortean
  //   relleno   con qué dan vueltas mientras no han parado
  //   premios   qué ha salido, por posición. Puede llegar más tarde: lo que aún
  //             no ha parado se queda con lo que le toque cuando pare.
  //   espera    cuánto dura la animación en total
  //
  // Devuelve un mando: `premios(lista)` para decirle lo que ha salido si no se
  // sabía al empezar, y `quitar()` para pararla y limpiar.
  function montar(opciones) {
    const caja = opciones.caja;
    const relleno = (opciones.relleno || []).filter((c) => c && c.imagen);
    if (!caja || !relleno.length) return null;

    const cuantos = Math.min(Math.max(Number(opciones.cuantos) || 1, 1), MAX);
    const espera = Math.max(600, Number(opciones.espera) || 0);
    let premios = (opciones.premios || []).slice();

    const relojes = [];
    const alarmas = [];
    const reels = [];
    const paradas = [];

    caja.innerHTML = '';
    // Las filas se reparten parejas: 6 rodillos salen 3 y 3, no 5 y 1.
    const filas = Math.ceil(cuantos / POR_FILA);
    const porFila = Math.ceil(cuantos / filas);
    let fila = null;

    const alAzar = () => relleno[Math.floor(Math.random() * relleno.length)];

    for (let i = 0; i < cuantos; i++) {
      if (i % porFila === 0) {
        fila = document.createElement('div');
        fila.className = 'slot-row';
        caja.appendChild(fila);
      }
      const reel = document.createElement('div');
      reel.className = 'slot-reel spinning';
      pintar(reel, alAzar());
      fila.appendChild(reel);
      reels.push(reel);
      paradas.push(false);

      relojes.push(setInterval(() => pintar(reel, alAzar()), RITMO));

      alarmas.push(setTimeout(() => {
        clearInterval(relojes[i]);
        paradas[i] = true;
        reel.classList.remove('spinning');
        reel.classList.add('stopped');
        // Si ya se sabe lo que ha salido, para sobre lo suyo.
        if (premios[i]) pintar(reel, premios[i]);
      }, cuando(cuantos, i, espera)));
    }

    return {
      // Lo que ha salido, si llega después de haber empezado a girar. Lo que ya
      // paró se corrige al momento; lo que sigue girando lo cogerá al parar.
      premios(lista) {
        premios = (lista || []).slice();
        for (let i = 0; i < reels.length; i++) {
          if (paradas[i] && premios[i]) pintar(reels[i], premios[i]);
        }
      },
      quitar() {
        relojes.forEach(clearInterval);
        alarmas.forEach(clearTimeout);
        caja.innerHTML = '';
      }
    };
  }

  // globalThis y no window, por lo mismo que en ruleta-nombres.js: asi los tests
  // pueden cargar esto sin navegador.
  globalThis.Tragaperras = { montar, pintar, cuando, RITMO, POR_FILA, MAX };
})();
