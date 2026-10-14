// La cinta de la ruleta de nombres: cómo se monta y dónde para.
//
// Aparte para poder usarla en dos sitios, la página del Ruleton y el widget que
// se mete en OBS. Es lo mismo que ya se hizo con el tablero de clavijas, y por
// la misma razón: el widget se había hecho su propia cinta, con otro alto de
// fila y otra banda, así que no se parecían. Duplicar una animación acaba en dos
// animaciones que se van separando.
//
// Aquí no hay estado ni se sabe de dónde vienen los nombres: se recibe la lista
// y los elementos, y se gira. Quien llama decide cuándo y qué hacer al acabar.

(function () {
  'use strict';

  // La curva del frenado. Arranca fuerte y se va muriendo, que es lo que hace
  // que parezca que la cinta pesa.
  const CURVA = 'cubic-bezier(.12,.72,.18,1)';

  // Lo que como mucho se espera a un vídeo del doble o nada. Es el seguro: uno
  // que se atasque no puede dejar la pantalla tapada en mitad del directo.
  const SEGURO_VIDEO = 15000;

  // Escapar sin tocar el DOM: la misma cuenta que escapeHtml en la pagina. Sin
  // DOM porque asi esto se puede probar sin navegador, y porque crear un elemento
  // por nombre para una lista de doscientos es tirar trabajo.
  function escapa(t) {
    return String(t == null ? '' : t)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Las filas, tal cual las pinta la página.
  function filas(lista) {
    return (lista || []).map((n) => '<div class="fila">' + escapa(n) + '</div>').join('');
  }

  // El alto de fila se MIDE, no se supone: lo pone el CSS con --fila y cambia en
  // pantalla completa, en móvil y cuando OBS escala la fuente. Calculándolo, la
  // cinta pararía entre dos nombres en cuanto la pantalla cambiara de tamaño.
  function alto(tira) {
    const fila = tira && tira.querySelector('.fila');
    const medido = fila ? fila.getBoundingClientRect().height : 0;
    // Un 0 no es una medida: es que no se ha podido medir, porque la fila está
    // dentro de algo con display:none. Devolverlo tal cual deja la parada en 0 y
    // la cinta no se mueve. Se cae al alto de por defecto, que es el que dice el
    // CSS en --fila.
    return medido || 46;
  }

  // Cuántas filas se ven de una vez. También se mide, por lo mismo.
  function visibles(caja, altoFila) {
    if (!caja || !altoFila) return 1;
    const h = caja.getBoundingClientRect().height;
    // Sin alto no se puede contar: pasa cuando la caja está oculta. Se supone la
    // ventana de siete que dice el CSS, en vez de decir «se ve una» y dejar la
    // parada donde no toca.
    if (!h) return 7;
    return Math.max(1, Math.round(h / altoFila));
  }

  // Cuánto hay que subir la cinta para dejar la fila «i» dentro de la banda del
  // centro.
  function parada(caja, i, altoFila) {
    return -i * altoFila + altoFila * (visibles(caja, altoFila) - 1) / 2;
  }

  // La parada, como tanto por ciento del alto de la propia cinta en vez de en
  // píxeles. Hace falta porque lo que se mide es lo que se VE, y lo que se ve
  // puede estar escalado: el tamaño de los widgets (Configuración › Widgets) es
  // un transform: scale() sobre todo el widget. Entonces una fila de 46 mide 69
  // al 150 %, pero la cinta se mueve en píxeles de antes de escalar: recorría
  // vez y media de lo debido y paraba en otro nombre, o pasado el final, en
  // blanco. El cartel de debajo decía el ganador bueno y la cinta otro.
  //
  // En tanto por ciento no hay píxeles que convertir: la parada y el alto de la
  // cinta se miden los dos igual de escalados, y al dividir el escalado se va.
  function enPorcentaje(paradaPx, altoFila, cuantasFilas) {
    const total = altoFila * cuantasFilas;
    return total ? paradaPx / total * 100 : 0;
  }

  // Cuántas veces se repite la lista. Se ajusta a su tamaño: con cuatro nombres
  // un giro de cuatro filas no se vería, y con doscientos no hacen falta miles
  // de filas. Pase lo que pase, delante de la banda desfilan todos al menos dos
  // veces antes de parar.
  function vueltas(cuantos) {
    return Math.max(3, Math.min(12, Math.ceil(80 / Math.max(1, cuantos))));
  }

  function repetir(lista, veces) {
    const salida = [];
    for (let i = 0; i < veces; i++) salida.push.apply(salida, lista);
    return salida;
  }

  // Detrás del que para va una cola: si no, cuando el elegido es el último de la
  // lista, la cinta para con media ventana vacía debajo.
  function cola(lista, cuantas) {
    const salida = [];
    for (let i = 0; i < cuantas; i++) salida.push(lista[i % lista.length]);
    return salida;
  }

  // Monta la cinta y la gira.
  //
  //   caja      el .names-reel (el que recorta)
  //   tira      el .tira de dentro (el que se mueve)
  //   lista     los nombres
  //   elegido   en qué sitio de la lista para
  //   ms        cuánto tarda en parar. OJO: quien llama debe pasar lo que QUEDA
  //             para parar, no lo que duraba el giro. Así, si se entera tarde
  //             (el aviso tarda, o el widget se abre a mitad de giro), el giro es
  //             más corto pero para en el mismo instante y en el mismo nombre.
  //
  // Devuelve el índice de la fila que queda en la banda, para poder encenderla
  // al acabar, o -1 si no había nada que girar.
  function girar(opciones) {
    const caja = opciones.caja;
    const tira = opciones.tira;
    const lista = opciones.lista || [];
    if (!caja || !tira || !lista.length) return -1;

    // Se destapa AQUI, antes de medir. Lo que hay debajo mide 0 mientras esté
    // oculto (display:none), y con 0 la parada sale 0 y la cinta no se mueve: es
    // exactamente lo que pasaba, y por eso el widget no animaba. Destapando aquí
    // el orden no se puede equivocar desde fuera.
    if (opciones.panel) opciones.panel.hidden = false;

    const n = vueltas(lista.length);
    // Primero las vueltas, para poder medir una fila de verdad; y con ella, la
    // cola: tantas filas como se ven, y una más. Antes la cola se echaba a ojo
    // suponiendo filas de 46 píxeles, y con el widget escalado no lo son: al 50 %
    // salían menos filas de las que caben y quedaba un hueco debajo del último.
    const base = repetir(lista, n);
    tira.innerHTML = filas(base);
    const altoFila = alto(tira);
    const todas = base.concat(cola(lista, visibles(caja, altoFila) + 1));
    tira.innerHTML = filas(todas);
    const cual = (n - 1) * lista.length + Math.max(0, Math.min(opciones.elegido || 0, lista.length - 1));

    // Se arranca desde arriba sin transición y se fuerza el recálculo: si no, el
    // navegador junta las dos posiciones en una sola y no se ve girar nada.
    tira.style.transition = 'none';
    tira.style.transform = 'translateY(0px)';
    void tira.offsetHeight;
    tira.style.transition = 'transform ' + Math.max(200, opciones.ms || 0) + 'ms ' + CURVA;
    tira.style.transform = 'translateY(' + enPorcentaje(parada(caja, cual, altoFila), altoFila, todas.length) + '%)';
    return cual;
  }

  // Deja la cinta quieta con la lista puesta, sin girar. Es el reposo.
  function quieta(tira, lista, textoVacio) {
    if (!tira) return;
    tira.style.transition = 'none';
    tira.style.transform = 'translateY(0px)';
    if (!lista || !lista.length) {
      tira.innerHTML = '<div class="fila vacio">' + escapa(textoVacio || '') + '</div>';
      return;
    }
    // Se repite lo justo para que no queden huecos: una lista de dos nombres
    // dejaria cinco filas vacias en una ventana de siete.
    tira.innerHTML = filas(repetir(lista, Math.max(1, Math.ceil(12 / lista.length))));
  }

  // Enciende la fila que ha quedado en la banda: verde si gana, roja y tachada
  // si se va. Es lo que hace la pagina al acabar de girar.
  function marcar(tira, cual, seVa) {
    const fila = tira && cual >= 0 ? tira.children[cual] : null;
    if (fila) fila.classList.add(seVa ? 'fuera' : 'gana');
  }

  // Enseña ganar.mp4 o perder.mp4 tapando la escena, y avisa cuando acaba.
  //
  // Si no hay archivo puesto, no se enseña nada y se sigue: el juego tiene que
  // funcionar sin las animaciones, que son de quien monta el Ruleton y puede no
  // haberlas hecho todavía.
  //
  // Está aquí y no en la página porque el widget de OBS tiene que enseñar el
  // MISMO vídeo. Y como es el mismo archivo, dura lo mismo: los dos acaban a la
  // vez sin tener que cuadrar relojes ni mandar duraciones.
  //
  //   caja   el .escena-video que tapa
  //   video  el <video> de dentro
  //   cual   'ganar' o 'perder'
  //
  // Devuelve una promesa que acaba cuando acaba el vídeo, o enseguida si no hay.
  function animacion(caja, video, cual) {
    return new Promise((resolve) => {
      if (!caja || !video) { resolve(); return; }
      let acabado = false;
      const fin = () => {
        if (acabado) return;
        acabado = true;
        clearTimeout(seguro);
        caja.hidden = true;
        try { video.pause(); } catch (e) { /* ya estaba parado */ }
        resolve();
      };
      // La caja solo se enseña cuando el vídeo arranca de verdad: si el archivo
      // no está, no se ve un recuadro negro parpadear.
      video.onplaying = () => { caja.hidden = false; };
      video.onended = fin;
      video.onerror = fin;
      // Y un seguro: una animación larga o un vídeo que se atasca no puede dejar
      // el sorteo colgado en mitad del directo.
      const seguro = setTimeout(fin, SEGURO_VIDEO);
      video.src = '/assets/' + (cual === 'perder' ? 'perder' : 'ganar') + '.mp4';
      // load() a mano, y aquí está el porqué: doblar dos veces seguidas pide el
      // MISMO archivo las dos veces (ganar.mp4 si se gana). Reasignar src con el
      // mismo valor no garantiza que el vídeo vuelva a empezar: el elemento se
      // quedó en «acabado», y según el navegador puede no recargar nada, así que
      // la segunda vez no se veía. load() lo deja a cero siempre.
      if (typeof video.load === 'function') video.load();
      const promesa = video.play();
      if (promesa && promesa.catch) promesa.catch(fin);
    });
  }

  // globalThis y no window: en el navegador son lo mismo, y asi los tests pueden
  // cargar este archivo tal cual para comprobar la cuenta. Ver rutas.js.
  globalThis.CintaNombres = {
    girar, quieta, marcar, animacion,
    filas, alto, parada, enPorcentaje, vueltas, repetir, cola, visibles,
    CURVA, SEGURO_VIDEO
  };
})();
