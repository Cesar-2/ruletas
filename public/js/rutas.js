// Que cada sección tenga su dirección.
//
// Antes la página era una sola pantalla sin más: recargar te dejaba siempre en
// Minijuegos, el botón de atrás del navegador te sacaba del Ruleton entero, y no
// había forma de mandarle a nadie «mira el tablero de clavijas». Ahora:
//
//   #minijuegos/plinko     el tablero de clavijas
//   #puntos                el marcador
//   #ganadores
//   #historial
//   #estadisticas
//   #configuracion
//
// Va en el trozo de después de la almohadilla y no en la ruta de verdad
// (/puntos) a propósito: así el servidor no tiene que saber nada de esto. Con
// rutas de verdad haría falta que contestara el index.html a cualquier
// dirección que no sea la API ni un archivo, y eso es una regla nueva que se
// puede colar por delante de los widgets o de los estáticos. Esto no puede
// romper nada de eso porque el servidor ni lo ve.
//
// Los nombres de la dirección no son los de dentro (games, winners, uso...):
// son los que se leen. Estas direcciones se pegan en un mensaje, así que se
// escriben para quien las lea, y de paso cambiar un data-tab por dentro no
// rompe los enlaces que ya andan por ahí.
//
// La regla de la que cuelga todo lo demás: NO se reimplementa el cambio de
// pestaña. Se pulsa el botón. El handler que ya existe hace muchas cosas al
// cambiar de sección (pide datos, repinta, olvida la selección del catálogo,
// avisa si dejas Configuración a medias), y copiar eso aquí sería tener dos
// versiones de lo mismo que se van separando con el tiempo. Así que esto solo
// traduce entre la dirección y un clic.

(function () {
  'use strict';

  // Lo que se lee <-> lo que pone en el HTML.
  const SECCIONES = {
    minijuegos: 'games',
    puntos: 'puntos',
    ganadores: 'winners',
    historial: 'history',
    estadisticas: 'uso',
    configuracion: 'config'
  };
  // Al revés, para escribir la dirección.
  const NOMBRES = {};
  for (const [fuera, dentro] of Object.entries(SECCIONES)) NOMBRES[dentro] = fuera;

  // Donde se cae sin dirección, que es lo que ya salía antes.
  const POR_DEFECTO = { seccion: 'games', juego: 'ruleta' };

  const SUBTABS = '#games-panel > .subtabs .subtab';

  let aplicando = false;
  let pendiente = false;

  function botonSeccion(dentro) {
    return document.querySelector(`.tab[data-tab="${dentro}"]`);
  }
  function botonJuego(cual) {
    return document.querySelector(`${SUBTABS}[data-game="${cual}"]`);
  }
  function activa(sel) {
    const el = document.querySelector(sel + '.active');
    return el || null;
  }

  // Lo que está puesto ahora mismo en la pantalla. Se lee del DOM y no se lleva
  // por dentro: así da igual quién haya cambiado de pestaña (un clic, el propio
  // código al apuntar un ganador, o esto), que la dirección siempre dice la
  // verdad.
  function loQueHay() {
    const tab = activa('.tab');
    const sub = activa(SUBTABS);
    return {
      seccion: tab ? tab.dataset.tab : POR_DEFECTO.seccion,
      juego: sub ? sub.dataset.game : POR_DEFECTO.juego
    };
  }

  // --- Traducir, que es la parte que no toca el DOM ----------------------
  // Aparte a propósito: aquí están los casos raros (una dirección inventada,
  // mayúsculas, un juego que no existe) y así se puede probar sin navegador.
  // Ver test/rutas.test.js.

  // El estado -> la dirección que se escribe en la barra.
  function direccionDe(estado) {
    const nombre = NOMBRES[estado && estado.seccion];
    if (!nombre) return '';
    // El juego solo sale cuando se está en Minijuegos, y el que sale por
    // defecto no se escribe: '#minijuegos' ya es ese.
    if (estado.seccion === 'games') {
      return estado.juego === POR_DEFECTO.juego ? '#minijuegos' : '#minijuegos/' + estado.juego;
    }
    return '#' + nombre;
  }

  // La dirección -> el estado, o null si esa dirección no existe.
  //
  //   hay  dice si un juego existe. Se pasa de fuera para que esto no tenga que
  //        mirar el DOM; en la página es «¿hay un botón con ese data-game?».
  function estadoDe(hash, hay) {
    const crudo = String(hash || '').replace(/^#\/?/, '').trim();
    if (!crudo) return { ...POR_DEFECTO };
    const trozos = crudo.split('/');
    const dentro = SECCIONES[String(trozos[0]).toLowerCase()];
    if (!dentro) return null;
    const estado = { seccion: dentro, juego: POR_DEFECTO.juego };
    // Un juego que no existe no es una dirección rota: es Minijuegos con el de
    // siempre. Así un enlace a un minijuego que se quite algún día sigue
    // llevando a algún sitio en vez de a un cartel de error.
    const pedido = trozos[1] ? String(trozos[1]).toLowerCase() : '';
    if (dentro === 'games' && pedido && (!hay || hay(pedido))) estado.juego = pedido;
    return estado;
  }

  const comoDireccion = direccionDe;
  const deLaDireccion = () => estadoDe(location.hash, (j) => Boolean(botonJuego(j)));

  // Pone la pantalla donde dice la dirección, pulsando los botones de siempre.
  function aplicar() {
    const quiere = deLaDireccion();
    // Una dirección inventada, o la de Estadísticas sin ser administrador (su
    // pestaña está oculta): se cae al sitio de siempre y se arregla la
    // dirección, sin dejar una entrada nueva en el historial. Que la barra de
    // direcciones diga algo que no se puede ver es peor que corregirla.
    const boton = quiere && botonSeccion(quiere.seccion);
    if (!quiere || !boton || boton.hidden) {
      aplicando = true;
      try {
        history.replaceState(null, '', location.pathname + location.search);
        const porDefecto = botonSeccion(POR_DEFECTO.seccion);
        if (porDefecto && !porDefecto.classList.contains('active')) porDefecto.click();
      } finally {
        aplicando = false;
      }
      return;
    }

    aplicando = true;
    try {
      // Solo se pulsa si hace falta: pulsar la pestaña en la que ya estás
      // volvería a pedir sus datos por nada.
      if (!boton.classList.contains('active')) boton.click();
      if (quiere.seccion === 'games') {
        const sub = botonJuego(quiere.juego);
        if (sub && !sub.classList.contains('active')) sub.click();
      }
    } finally {
      aplicando = false;
    }
  }

  // Escribe la dirección de lo que hay puesto. Se llama cuando cambian las
  // clases: nunca se adivina desde el clic, porque el handler de las pestañas es
  // asíncrono y puede echarse atrás (si dejas Configuración a medias te
  // pregunta, y si dices que no, no se cambia de pestaña). Mirando el DOM eso
  // sale gratis.
  function sincronizar() {
    pendiente = false;
    if (aplicando) return;
    const quiere = comoDireccion(loQueHay());
    if (!quiere) return;
    const ahora = location.hash || '';
    if (ahora === quiere) return;
    // Sin '#minijuegos' en la barra al arrancar: la dirección limpia ya es esa.
    if (!ahora && quiere === '#minijuegos') return;
    // Se cambia el hash, que es lo que deja entrada en el historial: así el
    // botón de atrás recorre las secciones por las que has pasado.
    location.hash = quiere;
  }

  // Los cambios de clase llegan de uno en uno, y a mitad puede no haber ninguna
  // pestaña activa. Se espera a que el navegador acabe la tanda y se mira una
  // sola vez.
  function sincronizarLuego() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(sincronizar, 0);
  }

  function iniciar() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const subs = Array.from(document.querySelectorAll(SUBTABS));
    if (!tabs.length) return;

    const vigia = new MutationObserver(sincronizarLuego);
    for (const el of tabs.concat(subs)) {
      vigia.observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    // Al cerrarse un modal se vuelve a mirar. Es por el caso de dejar
    // Configuración a medias: si el aviso se resuelve con «quedarme», no cambia
    // ninguna clase, así que el vigía no se enteraría y la dirección se habría
    // quedado apuntando a donde intentabas ir y no a donde estás.
    const aviso = document.getElementById('modalBackdrop');
    if (aviso) {
      new MutationObserver(() => { if (aviso.hidden) sincronizarLuego(); })
        .observe(aviso, { attributes: true, attributeFilter: ['hidden'] });
    }

    window.addEventListener('hashchange', aplicar);
    aplicar();
  }

  // globalThis y no window: en el navegador son lo mismo, y así los tests
  // pueden cargar este archivo tal cual para probar la traducción.
  globalThis.Rutas = { iniciar, aplicar, direccionDe, estadoDe, SECCIONES, POR_DEFECTO };
})();
