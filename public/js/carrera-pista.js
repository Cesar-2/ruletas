// La pista de la carrera de balineras: los bichos, sus poses y la carrera
// entera, del semaforo a la foto finish.
//
// Aparte para poder usarla en dos sitios: la pagina del Ruleton y el widget que
// se mete en OBS. Es lo mismo que ya se hizo con el tablero de clavijas, el
// rodillo de nombres, la tragaperras y el combate de Dofus, y por la misma
// razon: el widget se habia hecho su propia version, con emojis deslizandose en
// vez de los bichos del pliego con sus poses. No se parecian en nada.
//
// Lo unico que necesita de fuera es `carrera`, el estado: quien corre, las
// marcas tick a tick y el resultado. La pagina lo tiene en su variable y el
// widget lo pone en globalThis desde lo que manda el servidor.


    // Los adornos del pato y el recolocador, que venian de index.html.

    // Un pato nadando hacia la meta, con su pañuelo. La franja de agua de
    // abajo lo tapa un poco, para que se vea metido en el agua y no encima.
    // A cada pato se le viste por piezas en vez de sacarlo de una lista de
    // trajes hechos: un sombrero (siempre, que ninguno salga pelado), algo al
    // cuello (siempre), y a ratos algo en la cara y algo en el cuerpo. Salen
    // cientos de combinaciones, asi que es raro ver dos iguales.
    const SOMBREROS_PATO = [
      { nombre: 'gorro', gorro: true },
      { nombre: 'capitán', gorra: '#1e3a8a' },
      { nombre: 'chullo', chullo: '#7c3aed', franja: '#fbbf24' },
      { nombre: 'sartén', sarten: true },
      { nombre: 'calabaza', calabaza: true },
      { nombre: 'chistera', chistera: true, lazo: '#ef4444' },
      { nombre: 'corona', corona: true },
      { nombre: 'vikingo', vikingo: true },
      { nombre: 'cocinero', chef: true },
      { nombre: 'obrero', obra: true },
      { nombre: 'escafandra', escafandra: true },
      { nombre: 'diablillo', diablo: true },
      { nombre: 'flor', flor: true },
      { nombre: 'pirata', gorro: true, pirata: true, parche: true },
      { nombre: 'chullo rojo', chullo: '#dc2626', franja: '#f8fafc' },
      { nombre: 'gorra verde', gorra: '#15803d' }
    ];
    const CUELLOS_PATO = [
      { cuello: 'pañuelo' },
      { cuello: 'pajarita roja', pajarita: '#ef4444' },
      { cuello: 'pajarita azul', pajarita: '#22d3ee' },
      { cuello: 'bufanda roja', bufanda: '#dc2626' },
      { cuello: 'bufanda verde', bufanda: '#4ade80' },
      { cuello: 'collar', collar: true }
    ];
    const CARAS_PATO = [
      {}, {}, { cara: 'gafas', gafas: true }, {}, { cara: 'buzo', buzo: true }
    ];
    const CUERPOS_PATO = [
      {}, {}, { ropa: 'poncho', poncho: '#dc2626', franja: '#fbbf24' },
      { ropa: 'capa', capa: '#dc2626' }, {}, { ropa: 'flotador', flotador: '#f87171' },
      { ropa: 'capa azul', capa: '#2563eb' }
    ];
    const PLUMAS_PATO = [
      {}, {}, {}, { pluma: 'real', cabeza: '#15803d' }, {},
      { pluma: 'blanco', cuerpo: '#f8fafc', cabeza: '#f1f5f9' }, {}
    ];
    // El servidor ya ha decidido el orden; esto solo lo cuenta. Cada balinera
    // tarda según su puesto, con un pelín de variación que nunca cambia el
    // orden, para que no parezcan todas iguales.
    // Retransmite la carrera que ha simulado el servidor: en cada instante se
    // mueve cada balinera a donde iba, así que se adelantan entre ellas de
    // verdad. La página no decide nada; solo lo cuenta.
    let recolocarCarrera = null;


    // Escapar sin depender de la pagina, igual que en los otros modulos
    // compartidos: asi este archivo se puede cargar solo.
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }


    // Si hay una carrera en marcha. Vive aqui porque lo lee dibujarPista, pero la
    // pagina tambien lo pone: es la misma ligadura global, asi que asignarlo desde
    // alli funciona igual. Lo que no puede es declararlo dos veces.
    let corriendo = false;

    // --- Lo que faltaba de index.html ----------------------------------
    // Estas venian de la pagina y sin ellas la pista no se puede dibujar.

    // --- Carrera de balineras ---------------------------------------------
    // Quien corre la carrera, según lo elegido en Configuración > Minijuegos.
    const BICHOS = { caballos: '🐎', patos: '🦆', hormigas: '🐜', larvas: '🐛' };
    const COLORES_BOLA = ['#fbbf24', '#f43f5e', '#a3e635', '#e879f9', '#22d3ee',
      '#fb923c', '#4ade80', '#f472b6', '#facc15', '#38bdf8'];
    // Lo que hay alrededor de la carrera y no corre: la orilla, las nubes,
    // los nenufares. No cambia el resultado, pero es lo que hace que la
    // pantalla parezca un sitio y no una barra de progreso.
    function adornosDe(bicho) {
      // Las tres capas que se deslizan las lleva todo el mundo: cambia el
      // dibujo de cada una, no el mecanismo.
      const capas = '<span class="ola o3"></span><span class="ola o1"></span><span class="ola o2"></span>';
      if (bicho === 'patos') {
        const nenufares = [[18, 9], [46, 74], [72, 26], [88, 61], [33, 47]]
          .map(([x, y], i) => nenufar(x, y, i)).join('');
        const nubes = [[8, 6, 34], [42, 3, 46], [76, 11, 39]]
          .map(([x, y, w], i) => '<span class="nube" style="left:' + x + '%;top:' + y + 'px;width:' + w + 'px;animation-duration:' + (38 + i * 11) + 's"></span>').join('');
        return capas + nubes + nenufares + '<span class="pez"></span><span class="pez b"></span>';
      }
      if (bicho === 'caballos') {
        const nubes = [[12, 4, 40], [58, 9, 32]]
          .map(([x, y, w], i) => '<span class="nube" style="left:' + x + '%;top:' + y + 'px;width:' + w + 'px;animation-duration:' + (46 + i * 13) + 's"></span>').join('');
        return capas + nubes;
      }
      if (bicho === 'hormigas') {
        return capas + [14, 39, 63, 86]
          .map((x, i) => '<span class="gota" style="left:' + x + '%;animation-delay:' + (i * 1.7) + 's"></span>').join('');
      }
      // Larvas: pepitas de la manzana flotando en la pulpa.
      return capas + [[22, 24], [55, 68], [79, 38]]
        .map(([x, y]) => '<span class="pepita" style="left:' + x + '%;top:' + y + '%"></span>').join('');
    }


    // --- Los corredores dibujados -----------------------------------------
    // Las cuatro carreras corren con un pliego de sprites: cuatro filas (un
    // bicho cada una) por doce poses. Las medidas de aquí abajo están sacadas
    // del propio archivo, mirando dónde deja de haber dibujo, no puestas a
    // ojo: por eso los cortes no van a intervalos iguales.
    //
    // Los caballos venían pegados por las colas y no se podían separar solos.
    // Pero las cuatro filas están alineadas en columnas (18 px de diferencia
    // como mucho), así que sus cortes salen de las otras tres y se comprobó
    // que ninguno parte un caballo.
    const PLIEGO = {
      archivo: '/assets/corredores.png',
      ancho: 2072,
      alto: 759,
      // Trece bordes para doce poses: el principio, once cortes y el final.
      cortes: [0, 166, 337, 510, 685, 856, 1028, 1197, 1365, 1534, 1713, 1873, 2072],
      // La columna más ancha: fija el tamaño de la caja de todas las poses.
      anchoMaximo: 199,
      filas: {
        larvas:   [52, 195],
        caballos: [224, 412],
        patos:    [438, 574],
        hormigas: [596, 722]
      }
    };

    // Qué pose es cada columna. El pliego trae doce de las trece del guion
    // original: falta «recuperación», así que después de un tropiezo se usa
    // «esfuerzo», que es la que mejor cuenta lo de volver a arrancar.
    const POSE = {
      idle: 0, correr: [1, 2, 3, 4, 5, 6], acelera: 7, esfuerzo: 8,
      tropieza: 9, gana: 10, pierde: 11
    };

    // Si el archivo no está o no carga, se siguen usando los bichos dibujados
    // a mano de siempre: una carrera sin corredores no se puede enseñar.
    let hayPliego = false;
    (function cargarPliego() {
      const img = new Image();
      img.onload = () => {
        hayPliego = true;
        // Si la pista ya estaba pintada con los bichos de repuesto, se rehace
        // para que salgan los buenos. Nunca a mitad de carrera: eso devolvería
        // a todos a la salida.
        const pista = document.getElementById('carreraPista');
        if (pista && !pista.hidden && !corriendo && (carrera.corredores || []).length) dibujarPista();
      };
      img.onerror = () => { hayPliego = false; };
      img.src = PLIEGO.archivo;
    })();

    // Coloca la ventana del pliego sobre la pose que toque. Todo se escala
    // por el alto de la fila, que es lo que fija el tamaño del bicho en la
    // pista; el ancho sale de lo que mida esa columna.
    // --- El pulso del dibujo ----------------------------------------------
    // Cada poco se mira en qué anda cada corredor y se le pone la pose que
    // toca. Va por su cuenta y no con los ticks de la carrera a propósito: los
    // ticks son lentos y las patas tienen que ir más deprisa, o el galope se
    // ve a trompicones.
    const PASO_CORREDOR = 90;        // ms por fotograma del ciclo de correr
    const ESFUERZO_TRAS_CAIDA = 5;   // fotogramas levantándose después de caer

    let pulsoCorredores = null;
    // Cuántos fotogramas le quedan a cada uno de estar recuperándose. Va por
    // elemento, así que al repintar la pista se olvida solo.
    const levantandose = new WeakMap();

    function bichoDeLaPista(pista) {
      for (const n of Object.keys(PLIEGO.filas)) if (pista.classList.contains(n)) return n;
      return 'caballos';
    }

    function pintarCorredores() {
      const pista = document.getElementById('carreraPista');
      if (!pista || pista.hidden) return;
      const corredores = pista.querySelectorAll('.corredor');
      if (!corredores.length) return;

      const bicho = bichoDeLaPista(pista);
      // Con mucha gente las fichas se encogen, y el bicho con ellas.
      const alto = pista.classList.contains('llena') ? 26 : 46;
      const parada = pista.classList.contains('parada');
      // Parada y con un ganador marcado es que ya se corrió; parada sin
      // ganador es que todavía no ha salido.
      const acabada = parada && !!pista.querySelector('.calle.gana');
      const marca = Math.floor(Date.now() / PASO_CORREDOR);

      corredores.forEach((el) => {
        const calle = el.closest('.calle');
        const bola = el.closest('.bola');
        if (!calle || !bola) return;
        let col;

        if (acabada) {
          // Gana uno y pierden todos los demás: aquí no hay segundo puesto que
          // valga, solo se cruza la meta o no se cruza.
          col = calle.classList.contains('gana') ? POSE.gana : POSE.pierde;
          levantandose.delete(el);
        } else if (parada) {
          col = POSE.idle;
          levantandose.delete(el);
        } else if (bola.classList.contains('tropieza')) {
          col = POSE.tropieza;
          // Al levantarse se le deben unos fotogramas de esfuerzo: el pliego
          // no trae pose de recuperación y ésta es la que más se le parece.
          levantandose.set(el, ESFUERZO_TRAS_CAIDA);
        } else if ((levantandose.get(el) || 0) > 0) {
          col = POSE.esfuerzo;
          levantandose.set(el, levantandose.get(el) - 1);
        } else if (bola.classList.contains('turbo')) {
          col = POSE.acelera;
        } else {
          // El ciclo de correr. Cada calle arranca en un fotograma distinto,
          // que si no los treinta corredores mueven la pata a la vez y se ve
          // como un desfile.
          const desfase = (+calle.style.getPropertyValue('--fila') || 0);
          col = POSE.correr[(marca + desfase) % POSE.correr.length];
        }
        ponerPose(el, bicho, col, alto);
      });
    }

    function pulsarCorredores(encender) {
      if (pulsoCorredores) { clearInterval(pulsoCorredores); pulsoCorredores = null; }
      if (!encender) return;
      pintarCorredores();
      pulsoCorredores = setInterval(pintarCorredores, PASO_CORREDOR);
    }

    function ponerPose(el, bicho, columna, altoDestino) {
      const fila = PLIEGO.filas[bicho];
      if (!fila) return;
      if (!el.style.backgroundImage) el.style.backgroundImage = 'url("' + PLIEGO.archivo + '")';
      const altoFila = fila[1] - fila[0] + 1;
      const escala = altoDestino / altoFila;
      const x0 = PLIEGO.cortes[columna];
      const anchoCol = PLIEGO.cortes[columna + 1] - x0;
      // La caja mide siempre lo mismo, la de la pose más ancha, y cada pose se
      // centra dentro. Si la caja cambiara de ancho con cada fotograma, la
      // ficha entera daría un tirón a cada paso, porque el nombre y el puesto
      // van al lado y se recolocarían.
      //
      // Pero el dibujo no puede ocupar esa caja entera: casi todas las poses
      // son más estrechas que la más ancha, y el hueco que sobraba a los lados
      // enseñaba el trozo del bicho de al lado en el pliego (los caballos van
      // pegados por las colas). Asi que el elemento mide justo su columna, y
      // lo que falta hasta la caja lo ponen los margenes: se recorta el vecino
      // y la ficha sigue ocupando lo mismo en todas las poses.
      const caja = Math.round(PLIEGO.anchoMaximo * escala);
      const ancho = Math.round(anchoCol * escala);
      const centrado = Math.round((caja - ancho) / 2);
      el.style.width = ancho + 'px';
      el.style.marginLeft = centrado + 'px';
      el.style.marginRight = (caja - ancho - centrado) + 'px';
      el.style.height = Math.round(altoDestino) + 'px';
      el.style.backgroundSize =
        Math.round(PLIEGO.ancho * escala) + 'px ' + Math.round(PLIEGO.alto * escala) + 'px';
      el.style.backgroundPosition =
        '-' + Math.round(x0 * escala) + 'px -' + Math.round(fila[0] * escala) + 'px';
    }

    function dibujarPista() {
      const pista = document.getElementById('carreraPista');
      pista.hidden = false;
      pista.innerHTML = '';
      // El resultado es el mismo con todos; solo cambia quien corre. Parados
      // mientras no hay carrera, que si no patalean sin moverse.
      const bicho = BICHOS[carrera.ajustes?.animacion] ? carrera.ajustes.animacion : 'caballos';
      pista.className = 'pista ' + bicho + (corriendo ? '' : ' parada') +
        (carrera.corredores.length > 30 ? ' llena' : '');
      // Las filas se reparten el hueco de arriba abajo. La de mas abajo va
      // por delante, que es como se ve una carrera de lado: los de delante
      // tapan a los de detras.
      const cuantos = carrera.corredores.length;
      const carriles = document.createElement('div');
      carriles.className = 'carriles';
      // Las orillas van pegadas a la primera y la ultima fila, no a los
      // bordes de la pista: asi el rio mide justo lo que se nada y no queda
      // agua de sobra por arriba ni por abajo.
      carriles.innerHTML = '<span class="orilla arriba"></span><span class="orilla abajo"></span>';
      carrera.corredores.forEach((c, i) => {
        const calle = document.createElement('div');
        calle.className = 'calle';
        calle.dataset.clave = c.clave;
        calle.style.setProperty('--fila', i);
        calle.style.setProperty('--filas', cuantos);
        calle.style.zIndex = i + 1;
        const color = COLORES_BOLA[i % COLORES_BOLA.length];
        // Con el pliego cargado corre el dibujo de verdad; si no está, los
        // bichos de siempre, que se pintan solos y no dependen de ningún
        // archivo.
        const dibujo = { caballos: caballoSvg, patos: patoSvg, hormigas: hormigaSvg, larvas: larvaSvg }[bicho];
        const dentro = hayPliego
          ? '<span class="corredor"></span>'
          : dibujo(color, COLORES_BOLA[(i + 3) % COLORES_BOLA.length], i + 1, i);
        // El nombre y el puesto van dentro de la ficha: se mueven con el
        // bicho, que es lo que hace que se lea como una carrera y no como
        // cuatro barras de progreso.
        calle.innerHTML = `
          <span class="bola dibujo">${dentro}
            <span class="quien">${esc(c.nombre)}</span>
            <span class="pos"></span>
          </span>`;
        carriles.appendChild(calle);
      });
      // El escenario, en su propia capa y por debajo de todo.
      const decorado = document.createElement('div');
      decorado.className = 'decorado';
      decorado.innerHTML = adornosDe(bicho);
      pista.prepend(decorado);
      // La salida y la meta, una de cada y de lado a lado: antes cada fila
      // pintaba la suya y, al solaparse las filas, se montaban unas encima
      // de otras.
      const salida = document.createElement('div');
      salida.className = 'salida';
      salida.innerHTML = '<i></i><i></i><b></b>';
      carriles.appendChild(salida);
      const meta = document.createElement('div');
      meta.className = 'meta-global';
      carriles.appendChild(meta);
      pista.appendChild(carriles);
      // Con el pliego puesto, las poses las lleva el pulso; sin él, los bichos
      // dibujados se animan solos con CSS y aquí no hay nada que hacer.
      pulsarCorredores(hayPliego);
    }
    function animarCarrera(resultado) {
      const pista = document.getElementById('carreraPista');
      const relato = document.getElementById('carreraRelato');
      // Si la pista aún no tiene ancho (panel recién abierto), se usa un
      // mínimo: si no, las balineras se quedarían clavadas en la salida.
      // Hasta donde llega la ficha: el ancho de la calle menos lo que mide ella
      // y la meta, para que el morro toque la meta y no se salga.
      function medirAncho() {
        const calle0 = pista.querySelector('.calle');
        const ficha0 = pista.querySelector('.bola');
        return Math.max(120, (calle0?.clientWidth || pista.clientWidth) - (ficha0?.offsetWidth || 22) - 10);
      }
      let ancho = medirAncho();
      const total = (carrera.ajustes?.duracion || 8) * 1000;
      const marcas = carrera.marcas || [];
      const eventos = carrera.eventos || [];

      relato.hidden = false;
      relato.innerHTML = '';

      // Se busca la calle comparando en JavaScript y no con un selector: los
      // nombres vienen del chat y pueden traer cualquier cosa. Se buscan una
      // vez y no en cada instante, que con mucha gente se nota.
      const calles = Array.from(pista.querySelectorAll('.calle'));
      const fichas = carrera.corredores.map((c) => {
        const calle = calles.find((x) => x.dataset.clave === c.clave);
        return calle ? { calle, bola: calle.querySelector('.bola'), pos: calle.querySelector('.pos') } : null;
      });

      // La ficha avanza; el bicho de dentro patalea por su cuenta. Se guarda
      // por donde va cada uno para poder recolocarlo si la pista cambia de
      // tamaño (pantalla completa, o la ventana).
      function avanzar(donde, p, ms) {
        donde.p = p;
        donde.bola.style.transition = `transform ${ms}ms linear`;
        donde.bola.style.transform = `translateX(${(ancho * p).toFixed(1)}px)`;
      }

      // Al cambiar el ancho, cada uno salta a la parte de pista que llevaba:
      // el siguiente instante sigue desde ahí.
      function recolocar() {
        ancho = medirAncho();
        fichas.forEach((donde) => {
          if (!donde) return;
          donde.bola.style.transition = 'none';
          donde.bola.style.transform = `translateX(${(ancho * (donde.p || 0)).toFixed(1)}px)`;
        });
      }
      if (recolocarCarrera) window.removeEventListener('resize', recolocarCarrera);
      recolocarCarrera = recolocar;
      window.addEventListener('resize', recolocarCarrera);

      // Sin simulación (una carrera vieja), se va directo al final.
      if (!marcas.length) return 0;

      // Cuenta atrás antes de salir: 3, 2, 1, ¡YA! Solo es espectáculo; el
      // resultado ya lo tiene el servidor.
      const CUENTA = 2400;
      const semaforo = document.createElement('div');
      semaforo.className = 'semaforo';
      pista.appendChild(semaforo);
      // Tres luces que se encienden de una en una, como en la salida de
      // verdad, y el numero grande encima.
      const luces = '<span class="luces"><i></i><i></i><i></i></span>';
      semaforo.innerHTML = luces + '<span class="num"></span>';
      const pintarCuenta = (n, encendidas) => {
        semaforo.querySelector('.num').innerHTML = '<b>' + n + '</b>';
        semaforo.querySelectorAll('.luces i').forEach((luz, j) => {
          luz.classList.toggle('on', j < encendidas);
        });
      };
      ['3', '2', '1'].forEach((n, k) => {
        setTimeout(() => pintarCuenta(n, k + 1), k * 600);
      });
      setTimeout(() => {
        pintarCuenta('¡YA!', 3);
        semaforo.classList.add('ya');
        pista.classList.remove('parada');
        // El chapuzon de salir todos a la vez.
        pista.querySelectorAll('.calle .bola').forEach((b) => {
          const agua = document.createElement('span');
          agua.className = 'chapuzon';
          b.appendChild(agua);
          setTimeout(() => agua.remove(), 900);
        });
        setTimeout(() => semaforo.remove(), 500);
      }, 1800);

      const paso = total / marcas.length;
      marcas.forEach((posiciones, t) => {
        setTimeout(() => {
          // Lo que avanza cada uno en este instante, comparado con lo normal:
          // el que va muy por encima pega un tirón y el que se queda, tropieza.
          const antes = marcas[t - 1] || posiciones.map(() => 0);
          const deltas = posiciones.map((p, i) => p - antes[i]);
          const orden = deltas.slice().sort((a, b) => a - b);
          const normal = orden[Math.floor(orden.length / 2)] || 0;
          // El puesto de cada uno ahora mismo.
          const ranking = posiciones.map((p, i) => i).sort((a, b) => posiciones[b] - posiciones[a]);
          const puesto = [];
          ranking.forEach((i, k) => { puesto[i] = k + 1; });

          posiciones.forEach((p, i) => {
            const donde = fichas[i];
            if (!donde) return;
            avanzar(donde, p, paso);
            // El que llega a la meta queda marcado.
            if (p >= 1) donde.calle.classList.add('llega');
            const b = donde.bola;
            b.classList.toggle('lider', puesto[i] === 1);
            b.classList.toggle('turbo', normal > 0 && deltas[i] > normal * 1.8);
            b.classList.toggle('tropieza', normal > 0 && deltas[i] < normal * 0.35);
            donde.pos.textContent = `${puesto[i]}º`;
            donde.pos.className = 'pos' + (puesto[i] <= 3 ? ` p${puesto[i]}` : '');
          });

          for (const e of eventos) {
            if (e.tick !== t) continue;
            const linea = document.createElement('div');
            linea.className = /se pone primero|sale en cabeza/.test(e.texto) ? 'lidera'
              : /tirón/.test(e.texto) ? 'tiron' : 'tropiezo';
            linea.textContent = e.texto;
            relato.appendChild(linea);
            relato.scrollTop = relato.scrollHeight;
          }
        }, CUENTA + t * paso);
      });

      // Al cruzar el primero se acaba: el resto se queda donde iba.
      setTimeout(() => {
        pista.querySelectorAll('.bola').forEach((bola) => {
          bola.style.transition = 'none';
          bola.classList.remove('turbo', 'tropieza');
        });
        // Ya han llegado: se paran. Fogonazo de foto finish y la calle del
        // ganador en oro.
        pista.classList.add('parada', 'foto');
        setTimeout(() => pista.classList.remove('foto'), 600);
        const ganador = fichas[carrera.corredores.findIndex((c) => c.nombre === resultado[0].nombre)];
        if (ganador) ganador.calle.classList.add('gana');
        const linea = document.createElement('div');
        linea.className = 'gana';
        linea.textContent = `¡${resultado[0].nombre} cruza la meta!`;
        relato.appendChild(linea);
        relato.scrollTop = relato.scrollHeight;
      }, CUENTA + total);

      return CUENTA + total;
    }


    // --- Los bichos, dibujados -----------------------------------------
    // Cada uno con su pelaje, su dorsal y su forma de moverse. Estaban en
    // index.html: sin ellos la pista no tiene nada que poner en las calles.

    // Un caballo de perfil mirando a la meta, con jinete. El pelaje es
    // currentColor; encima van un brillo y una sombra que le dan volumen.
    function caballoSvg(pelaje, casaca, dorsal) {
      return `<svg class="caballo" viewBox="0 0 64 46" style="color:${pelaje}" aria-hidden="true">
        <ellipse cx="32" cy="43" rx="22" ry="2.6" fill="#000" opacity=".35"/>
        <path class="cola" d="M15 17 C8 18 5 25 6 32 C9 27 11 23 16 21 Z" fill="#1f2937"/>
        <g fill="currentColor" opacity=".6">
          <rect class="pata a" x="19" y="25" width="4" height="15" rx="2"/>
          <rect class="pata b" x="44" y="25" width="4" height="15" rx="2"/>
        </g>
        <g fill="currentColor">
          <rect class="pata b" x="16" y="25" width="4" height="15" rx="2"/>
          <rect class="pata a" x="41" y="25" width="4" height="15" rx="2"/>
        </g>
        <g fill="currentColor">
          <ellipse cx="30" cy="22" rx="16" ry="8.5"/>
          <path d="M39 19 L48 7 L54 10 L47 25 Z"/>
          <ellipse cx="55" cy="12" rx="7.5" ry="3.8" transform="rotate(32 55 12)"/>
          <path d="M49 6 L51 1 L53 7 Z"/>
        </g>
        <path d="M40 18 L48 6 L50 7 L43 20 Z" fill="#1f2937"/>
        <ellipse cx="28" cy="18" rx="12" ry="3.2" fill="#fff" opacity=".38"/>
        <ellipse cx="30" cy="27" rx="14" ry="3.2" fill="#000" opacity=".28"/>
        <ellipse cx="52" cy="9" rx="3" ry="1.3" fill="#fff" opacity=".35" transform="rotate(32 52 9)"/>
        <circle cx="54.5" cy="10" r="1" fill="#0b0b0b"/>
        <rect x="22" y="16" width="14" height="8" rx="2" fill="${casaca}"/>
        <text x="29" y="22.5" font-size="6.5" font-weight="800" text-anchor="middle" fill="#021018">${dorsal}</text>
        <path d="M26 15 L33 6 L38 8 L33 15 Z" fill="${casaca}"/>
        <path d="M35 9 L46 11" stroke="${casaca}" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M46 11 L52 11" stroke="#1f2937" stroke-width=".8"/>
        <circle cx="38.5" cy="5" r="3.2" fill="${casaca}"/>
        <path d="M35.3 5 A3.2 3.2 0 0 1 41.7 5 Z" fill="#fff" opacity=".35"/>
      </svg>`;
    }
    function patoSvg(pluma, panuelo, dorsal, skin) {
      const k = pintaDePato(skin);
      const cuerpo = k.cuerpo || pluma;
      const cabeza = k.cabeza || cuerpo;
      return `<svg class="pato" viewBox="0 -9 48 43" style="color:${cuerpo}" aria-hidden="true">
        <ellipse class="onda" cx="22" cy="28" rx="18" ry="3" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/>
        <ellipse class="onda b" cx="22" cy="28" rx="18" ry="3" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/>
        ${k.capa ? '<g class="capa"><path d="M11 13 C3 14 0 20 1.5 26 C5 24 8 24.5 12 25.5 Z" fill="' + k.capa + '"/>' +
          '<path d="M11 13 C6 14.5 3.5 17 2.6 20.5 C6 19.5 9 20 11.5 21 Z" fill="#000" opacity=".18"/></g>' : ''}
        <g fill="currentColor">
          <path d="M4 17 L0 11 L9 14 Z"/>
          <path d="M5 19 C5 12 15 11 25 14 L33 15 C35 22 31 28 21 28 C11 28 5 25 5 19 Z"/>
        </g>
        <g fill="${cabeza}">
          <path d="M29 17 C29 12 30 8 32 5 L36 7 C35 11 34 14 34 17 Z"/>
          <circle cx="35" cy="7" r="6"/>
        </g>
        ${k.bicolor ? '<path d="M26.5 14.6 C30.4 15.6 33.2 19.2 33.4 23.6 C30.2 26.6 25.4 28 21 28 C23.2 22.4 24.4 17.8 26.5 14.6 Z" fill="' + cabeza + '" opacity=".92"/>' : ''}
        ${k.collar ? '<path d="M29.5 13.5 C31.5 15 34 15.2 36 14.4 L35.6 16.6 C33.4 17.2 31 17 29.2 15.8 Z" fill="#fff" opacity=".9"/>' : ''}
        ${k.flotador ? '<g><ellipse cx="21" cy="24" rx="17" ry="6.5" fill="' + k.flotador + '"/>' +
          '<path d="M4 24 A17 6.5 0 0 1 38 24 Z" fill="#fff" opacity=".3"/>' +
          '<ellipse cx="21" cy="24" rx="9" ry="2.8" fill="#0e7490" opacity=".5"/>' +
          '<path d="M9 22 Q13 20.4 17 22" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7"/></g>' : ''}
        <path d="M40 6.5 L47 8.5 L40 10.5 Z" fill="#f59e0b"/>
        <path d="M40 8.5 L46 8.8 L40 10.5 Z" fill="#d97706"/>
        <ellipse cx="18" cy="16" rx="11" ry="2.8" fill="#fff" opacity=".38"/>
        <ellipse cx="20" cy="25" rx="13" ry="2.6" fill="#000" opacity=".22"/>
        <ellipse cx="33.5" cy="4.5" rx="3" ry="1.5" fill="#fff" opacity=".4"/>
        <g class="ala">
          <ellipse cx="19" cy="19" rx="9" ry="4.6" fill="currentColor" transform="rotate(-10 19 19)"/>
          <ellipse cx="19" cy="19" rx="9" ry="4.6" fill="#000" opacity=".18" transform="rotate(-10 19 19)"/>
        </g>
        <text x="19" y="21.3" font-size="6.5" font-weight="800" text-anchor="middle" fill="#021018">${dorsal}</text>
        ${k.pajarita || k.bufanda ? '' :
          '<path d="M30 12 L37 13 L36 15.5 L29.5 14.5 Z" fill="' + panuelo + '"/>'}
        ${k.pajarita ? '<path d="M32.6 14 L28.8 11.9 L28.8 16.1 Z" fill="' + k.pajarita + '"/>' +
          '<path d="M32.6 14 L36.4 11.9 L36.4 16.1 Z" fill="' + k.pajarita + '"/>' +
          '<circle cx="32.6" cy="14" r="1.3" fill="' + k.pajarita + '"/>' +
          '<circle cx="32.6" cy="14" r="1.3" fill="#000" opacity=".18"/>' : ''}
        ${k.bufanda ? '<path d="M28.6 12.6 Q32.6 15.8 36.8 13.6 L37.2 16.4 Q32.6 18.6 28.2 15.6 Z" fill="' + k.bufanda + '"/>' +
          '<path class="colabufanda" d="M29.4 15.4 q-4.4 1.6 -6.6 5.6 l3 1.6 q2.2 -3.8 5 -4.6 Z" fill="' + k.bufanda + '"/>' +
          '<path d="M29.4 15.4 q-4.4 1.6 -6.6 5.6 l1.2 0.6 q2.4 -3.6 5.6 -4.6 Z" fill="#000" opacity=".15"/>' : ''}
        ${k.gorro ? '<path d="M31 2.5 L36 -6 L41 2 Z" fill="' + (k.pirata ? '#111827' : panuelo) + '"/>' +
          '<circle cx="36" cy="-6.2" r="1.5" fill="#fde047"/>' : ''}
        ${k.gorra ? '<path d="M29.5 2.6 A6 6 0 0 1 41.4 2.6 Z" fill="' + k.gorra + '"/>' +
          '<path d="M40 2.6 L47.5 3.8 L47.5 1.4 Z" fill="' + k.gorra + '"/>' +
          '<path d="M33.2 -0.6 L38 -0.6 M35.6 -2.6 L35.6 1.4" stroke="#fde047" stroke-width="1.2"/>' : ''}
        ${k.gafas ? '<path d="M31.3 4.9 L41 5.7" stroke="#0b0b0b" stroke-width="1.2"/>' +
          '<ellipse cx="34" cy="5.7" rx="2.7" ry="2.1" fill="#0b0b0b"/>' +
          '<ellipse cx="39.2" cy="6.1" rx="2.3" ry="1.9" fill="#0b0b0b"/>' : ''}
        ${k.parche ? '<path d="M33.2 4.4 L40.6 5.3" stroke="#0b0b0b" stroke-width="1"/>' +
          '<ellipse cx="36.6" cy="5.5" rx="2.3" ry="2.1" fill="#0b0b0b"/>' : ''}
        ${k.gafas || k.parche ? '' :
          '<circle cx="37" cy="6" r="1.1" fill="#0b0b0b"/><circle cx="37.4" cy="5.6" r=".35" fill="#fff"/>'}
        ${k.poncho ? '<path d="M5.5 14.5 L17 16.5 L15.5 26.5 L6 24.5 Z" fill="' + k.poncho + '"/>' +
          '<path d="M5.8 18 L16.7 19.9 M5.6 21.4 L16.2 23.2" stroke="' + k.franja + '" stroke-width="1.5"/>' +
          '<path d="M6 24.8 L6 27 M9 25.4 L9 27.6 M12 25.9 L12 28.1 M15 26.4 L15 28.6" stroke="' + k.poncho + '" stroke-width="1"/>' : ''}
        ${k.sarten ? '<path d="M28.6 0.8 L28.6 -2.2 A6.4 3.6 0 0 1 41.4 -2.2 L41.4 0.8 Z" fill="#374151"/>' +
          '<ellipse cx="35" cy="0.8" rx="6.6" ry="1.7" fill="#111827"/>' +
          '<path d="M31 -2.6 A4.4 2.4 0 0 1 38 -3" stroke="#9ca3af" stroke-width="1" fill="none" opacity=".7"/>' +
          '<rect x="41" y="-1.6" width="6.6" height="2" rx="1" fill="#7c2d12"/>' : ''}
        ${k.calabaza ? '<path d="M28.4 5 A6.8 6.8 0 0 1 41.6 5 Z" fill="#f97316"/>' +
          '<path d="M31.6 4.6 A5.5 6.5 0 0 1 33.4 -0.6 M38.4 4.6 A5.5 6.5 0 0 0 36.6 -0.6" stroke="#c2410c" stroke-width="1" fill="none"/>' +
          '<path d="M35 -0.9 L35 -3.4" stroke="#15803d" stroke-width="1.8" stroke-linecap="round"/>' +
          '<path d="M35 -3 q2.2 -0.6 2.6 -2.4" stroke="#15803d" stroke-width="1.2" fill="none" stroke-linecap="round"/>' : ''}
        ${k.chullo ? '<path d="M28.5 4.8 A6.7 6.7 0 0 1 41.5 4.8 Z" fill="' + k.chullo + '"/>' +
          '<path d="M29.5 1.6 L40.6 1.6" stroke="' + k.franja + '" stroke-width="1.6"/>' +
          '<path d="M29.4 4.6 q-1.4 3.4 0.4 6.2" stroke="' + k.chullo + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
          '<path d="M40.8 4.6 q1.4 3 -0.2 5.6" stroke="' + k.chullo + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
          '<circle cx="35" cy="-2.4" r="1.9" fill="' + k.franja + '"/>' : ''}
        ${k.vikingo ? '<path d="M28.6 5 A6.7 6.7 0 0 1 41.4 5 Z" fill="#9ca3af"/>' +
          '<path d="M28.8 4.6 L41.2 4.6" stroke="#6b7280" stroke-width="1.4"/>' +
          '<path d="M35 4.6 L35 0.4" stroke="#6b7280" stroke-width="1.2"/>' +
          '<path d="M29.6 2.6 q-3.8 -2.6 -5.4 0.6 q2.8 0.8 5.2 1.4 Z" fill="#f5f5f4"/>' +
          '<path d="M40.6 2.6 q3.8 -2.6 5.4 0.6 q-2.8 0.8 -5.2 1.4 Z" fill="#f5f5f4"/>' : ''}
        ${k.chef ? '<rect x="30.2" y="-0.4" width="9.6" height="3.2" rx="0.6" fill="#f1f5f9"/>' +
          '<circle cx="31.8" cy="-2.6" r="3" fill="#f8fafc"/>' +
          '<circle cx="35.2" cy="-4" r="3.4" fill="#f8fafc"/>' +
          '<circle cx="38.4" cy="-2.6" r="3" fill="#f8fafc"/>' +
          '<path d="M30.4 0.4 L39.6 0.4" stroke="#cbd5e1" stroke-width="0.8"/>' : ''}
        ${k.chistera ? '<rect x="27.8" y="-0.6" width="14.6" height="2.2" rx="1.1" fill="#111827"/>' +
          '<rect x="31" y="-7" width="8.4" height="6.6" fill="#111827"/>' +
          '<rect x="31" y="-2.8" width="8.4" height="2" fill="' + k.lazo + '"/>' : ''}
        ${k.corona ? '<path d="M29.8 1.4 L29.8 -3.8 L32.4 -1.2 L35 -5.2 L37.6 -1.2 L40.2 -3.8 L40.2 1.4 Z" fill="#fbbf24"/>' +
          '<path d="M29.8 0.2 L40.2 0.2" stroke="#d97706" stroke-width="1"/>' +
          '<circle cx="35" cy="-5.6" r="1.1" fill="#f43f5e"/>' : ''}
        ${k.buzo ? '<path d="M30.6 4.4 q-3.4 -4.6 0.4 -7.8" stroke="#f97316" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
          '<rect x="31" y="3.2" width="9.4" height="5.2" rx="2.2" fill="#67e8f9" opacity=".8"/>' +
          '<rect x="31" y="3.2" width="9.4" height="5.2" rx="2.2" fill="none" stroke="#0e7490" stroke-width="1.1"/>' +
          '<path d="M32.4 4.4 L34.4 4.4" stroke="#fff" stroke-width="1" opacity=".8"/>' : ''}
        ${k.obra ? '<path d="M28.8 4.8 A6.6 6.6 0 0 1 41.2 4.8 Z" fill="#facc15"/>' +
          '<path d="M40.6 4.8 L46.4 5.8 L46.4 3.2 Z" fill="#facc15"/>' +
          '<path d="M35 -1.2 L35 4.4" stroke="#ca8a04" stroke-width="1.5"/>' +
          '<path d="M28.8 4.4 L41.2 4.4" stroke="#ca8a04" stroke-width="1"/>' : ''}
        ${k.escafandra ? '<circle cx="35" cy="6" r="9.4" fill="#a5f3fc" opacity=".28"/>' +
          '<circle cx="35" cy="6" r="9.4" fill="none" stroke="#67e8f9" stroke-width="1.3"/>' +
          '<path d="M29.4 -0.6 A9.4 9.4 0 0 0 27 4.6" stroke="#fff" stroke-width="1.6" fill="none" opacity=".75"/>' : ''}
        ${k.diablo ? '<path d="M30.8 1.8 q-1.6 -3.8 0.8 -5 q0.6 2.6 1.6 4.2 Z" fill="#dc2626"/>' +
          '<path d="M39.4 1.4 q1.6 -3.8 -0.8 -5 q-0.6 2.6 -1.6 4.2 Z" fill="#dc2626"/>' : ''}
        ${k.flor ? '<g fill="#f8fafc">' +
          '<ellipse cx="31.4" cy="-1.6" rx="1.5" ry="2.2"/>' +
          '<ellipse cx="31.4" cy="2.8" rx="1.5" ry="2.2"/>' +
          '<ellipse cx="29.2" cy="0.6" rx="2.2" ry="1.5"/>' +
          '<ellipse cx="33.6" cy="0.6" rx="2.2" ry="1.5"/></g>' +
          '<circle cx="31.4" cy="0.6" r="1.5" fill="#fbbf24"/>' : ''}
        <path d="M0 27 Q6 25.5 12 27 T24 27 T36 27 T48 27 V34 H0 Z" fill="#0e7490" opacity=".5"/>
      </svg>`;
    }
    // Una hormiga minera: casco de su color y linterna que alumbra el túnel.
    function hormigaSvg(cuerpo, casco, dorsal) {
      return `<svg class="hormiga" viewBox="0 0 48 30" style="color:${cuerpo}" aria-hidden="true">
        <path class="haz" d="M40 12.5 L68 3 L68 23 Z" fill="#fde68a"/>
        <ellipse cx="24" cy="28.5" rx="18" ry="1.6" fill="#000" opacity=".4"/>
        <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none">
          <g opacity=".55">
            <path class="pata b" d="M21 19 L18 27"/>
            <path class="pata a" d="M25 19 L26 28"/>
            <path class="pata b" d="M29 19 L34 26"/>
          </g>
          <path class="pata a" d="M20 19 L16 27"/>
          <path class="pata b" d="M24 19 L24 28"/>
          <path class="pata a" d="M28 19 L32 27"/>
        </g>
        <g class="antena" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round">
          <path d="M36 11 Q39 4 44 5"/>
          <path d="M34 10 Q35 3 39 2"/>
        </g>
        <g fill="currentColor">
          <ellipse cx="12" cy="17" rx="9" ry="6.5"/>
          <ellipse cx="24" cy="17" rx="5" ry="3.8"/>
          <circle cx="34" cy="15" r="5.5"/>
        </g>
        <ellipse cx="10" cy="14" rx="6" ry="2" fill="#fff" opacity=".35"/>
        <ellipse cx="12" cy="21" rx="7" ry="2" fill="#000" opacity=".25"/>
        <ellipse cx="24" cy="15.5" rx="3" ry="1.2" fill="#fff" opacity=".35"/>
        <text x="12" y="19.3" font-size="6.5" font-weight="800" text-anchor="middle" fill="#021018">${dorsal}</text>
        <path d="M28.5 14.5 A5.5 5.5 0 0 1 39.5 14.5 Z" fill="${casco}"/>
        <path d="M30 13 A4 4 0 0 1 36 11" stroke="#fff" stroke-width="1" fill="none" opacity=".4"/>
        <circle cx="39.5" cy="12.5" r="1.7" fill="#fef3c7"/>
        <circle cx="37" cy="16" r="1.1" fill="#0b0b0b"/>
      </svg>`;
    }
    // Una larva gordita arrastrandose por el tunel de la manzana: los anillos
    // le recorren el cuerpo de atras a delante, como cuando reptan de verdad.
    function larvaSvg(piel, gorro, dorsal) {
      return `<svg class="larva" viewBox="0 0 48 30" style="color:${piel}" aria-hidden="true">
        <ellipse cx="24" cy="27.5" rx="19" ry="1.8" fill="#78350f" opacity=".35"/>
        <g stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none" opacity=".8">
          <path class="pelo" d="M10 11 L9 6"/>
          <path class="pelo b" d="M18 9 L18 4"/>
          <path class="pelo c" d="M26 9 L27 4"/>
        </g>
        <g fill="currentColor">
          <ellipse class="anillo d" cx="8" cy="18" rx="6" ry="5.4"/>
          <ellipse class="anillo c" cx="15" cy="17.5" rx="6.4" ry="6"/>
          <ellipse class="anillo b" cx="22" cy="17.5" rx="6.4" ry="6"/>
          <ellipse class="anillo" cx="29" cy="17" rx="6.4" ry="6"/>
          <circle cx="37" cy="16" r="6.6"/>
        </g>
        <ellipse cx="18" cy="13" rx="12" ry="2.6" fill="#fff" opacity=".32"/>
        <ellipse cx="20" cy="22" rx="13" ry="2.6" fill="#000" opacity=".2"/>
        <ellipse cx="35" cy="12" rx="3" ry="1.4" fill="#fff" opacity=".4"/>
        <text x="19" y="20" font-size="6.5" font-weight="800" text-anchor="middle" fill="#021018">${dorsal}</text>
        <path d="M30.4 15 A6.6 6.6 0 0 1 43.6 15 Z" fill="${gorro}"/>
        <path d="M32 13.5 A5 5 0 0 1 38 11.5" stroke="#fff" stroke-width="1" fill="none" opacity=".4"/>
        <circle cx="40" cy="16.5" r="1.2" fill="#0b0b0b"/>
        <circle cx="40.4" cy="16.1" r=".35" fill="#fff"/>
        <path d="M36 20.5 Q38.5 22.5 41 20.5" stroke="#0b0b0b" stroke-width=".9" fill="none" stroke-linecap="round"/>
      </svg>`;
    }


    // Dos mas que usaban los dibujos y se quedaron en index.html.

    // La pinta del corredor numero i. Siempre la misma para el mismo numero,
    // y con pasos distintos en cada pieza para que no vayan todas a la vez.
    function pintaDePato(i) {
      const n = Math.max(0, Math.floor(i || 0));
      const de = (lista, salto) => lista[(n * salto) % lista.length];
      const sombrero = de(SOMBREROS_PATO, 1);
      const cuello = de(CUELLOS_PATO, 3);
      let cara = de(CARAS_PATO, 2);
      const cuerpo = de(CUERPOS_PATO, 5);
      const pluma = de(PLUMAS_PATO, 4);
      // Dentro de una escafandra no caben gafas, y el pirata ya lleva parche.
      if (sombrero.escafandra || sombrero.parche) cara = {};
      const k = { ...pluma, ...cuerpo, ...cara, ...cuello, ...sombrero };
      // Todos van de dos colores: el del cuerpo es el de su calle y la
      // cabeza se lleva otro de la paleta. Si al repartir tocara el mismo se
      // coge el siguiente, que un pato de un solo color no es bicolor.
      if (!k.cabeza) {
        const total = COLORES_BOLA.length;
        let otro = (n * 7 + 4) % total;
        if (otro === n % total) otro = (otro + 3) % total;
        k.cabeza = COLORES_BOLA[otro];
        k.bicolor = true;
      }
      k.nombre = [sombrero.nombre, cuello.cuello, cara.cara, cuerpo.ropa, pluma.pluma].filter(Boolean).join(' + ');
      return k;
    }
    // Un nenufar con su flor, del tamaño y el vaiven que le toque.
    function nenufar(x, y, i) {
      const tam = 16 + (i % 3) * 7;
      return '<span class="nenufar" style="left:' + x + '%;top:' + y + '%;width:' + tam + 'px;height:' +
        Math.round(tam * 0.82) + 'px;animation-delay:' + (i * 0.9) + 's">' +
        (i % 2 ? '<i></i>' : '') + '</span>';
    }
