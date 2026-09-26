// El dibujo del tablero de clavijas, aparte para poder usarlo en dos sitios:
// la página del Ruleton y el widget que se mete en OBS. Estaba dentro de
// index.html y se sacó al montar el widget; tenerlo duplicado habría acabado
// con dos tableros que se parecen cada vez menos.
//
// Aquí no hay estado propio ni se sabe de dónde vienen los datos: se recibe el
// estado, el lienzo y las bolas, y se pinta. Quien lo llama decide cada cuánto.

(function () {
  'use strict';

  // Quien use esto dice cómo repintar: hace falta cuando la imagen de un
  // premio termina de cargar después de haber pintado el tablero.
  let repintar = () => {};

  // Para cuando no se pasan casillas encendidas. Uno solo y siempre vacío: se
  // pinta 60 veces por segundo y crear un Map en cada fotograma es tirar.
  const VACIO = new Map();

  // Cuánto dura encendida una casilla tras recibir una bola, en milisegundos.
  const BRILLO_CASILLA = 600;

  // Un color por jugador, para poder seguir la tuya entre muchas. Vive aquí
  // porque el dibujo es quien los pinta, y así la página y el widget usan los
  // mismos sin tener dos listas que se separan.
  const COLORES = ['#fbbf24', '#38bdf8', '#f472b6', '#a3e635', '#c084fc',
    '#fb923c', '#2dd4bf', '#f87171', '#e879f9', '#facc15'];

  // Cuántas posiciones de atrás se guardan para pintar la estela.
  const ESTELA = 8;

  // Cuánto se espera entre una bola y la siguiente, en segundos, para que no
  // caigan amontonadas y se pueda seguir cada una.
  const RETRASO_BOLA = 0.28;

  // Una bola lista para pintar, con todo lo que el dibujo le va a pedir. La
  // hacen igual la página y el widget: si le falta algo (el color, la estela),
  // el tablero la pinta a medias y cuesta ver por qué.
  function nuevaBola(tirada, i) {
    // Los golpes vienen como [fotograma, clavija]; agrupados por fotograma se
    // sabe de un vistazo qué encender en cada uno.
    const golpes = new Map();
    (tirada.choques || []).forEach(([cuando, cual]) => {
      if (!golpes.has(cuando)) golpes.set(cuando, []);
      golpes.get(cuando).push(cual);
    });
    return {
      nombre: tirada.nombre,
      color: COLORES[i % COLORES.length],
      recorrido: tirada.recorrido || [],
      golpes,
      casilla: tirada.casilla,
      multiplicador: tirada.multiplicador,
      premio: tirada.premio || null,
      puntos: tirada.puntos,
      empiezaEn: i * RETRASO_BOLA,
      x: 0, y: 0, visible: false, acabada: false,
      ultimoFotograma: -1,
      estela: []
    };
  }

    // --- El dibujo ----------------------------------------------------------
    // Todo va en el lienzo (marco, clavijas, casillas y bolas) para que a
    // pantalla completa crezca junto y no haya que cuadrar dos cosas.

    // Las mismas cuentas que hace el servidor para colocar las clavijas. Están
    // repetidas a propósito: el servidor no manda dónde va cada una, solo las
    // medidas del tablero, y así la respuesta no lleva cientos de posiciones.
    // El orden es el mismo, que es lo que permite encender la que se golpea.
    function clavijasDe(t) {
      const sitios = [];
      for (let r = 0; r < t.filas; r++) {
        const cuantas = r + 3;
        for (let c = 0; c < cuantas; c++) {
          sitios.push({ x: (c - (cuantas - 1) / 2) * t.separacion, y: r * t.altoFila });
        }
      }
      return sitios;
    }

    function bordesDe(t) {
      const cuantas = (t.filas - 1) + 3;
      const bordes = [];
      for (let c = 0; c < cuantas; c++) bordes.push((c - (cuantas - 1) / 2) * t.separacion);
      return bordes;
    }

    // El color de una casilla según lo que paga: cuanto más gorda, más caliente.
    // Se devuelven dos tonos para poder darle degradado y que no sea un plano.
    // Las imágenes de los premios, ya cargadas. El lienzo no puede pintar una
    // url: necesita una Image lista. Si todavía no lo está se deja el hueco y
    // se repinta cuando cargue; una imagen rota no puede tumbar el tablero.
    const imagenesPremio = new Map();

    function imagenPremio(url) {
      if (!url) return null;
      const guardada = imagenesPremio.get(url);
      if (guardada !== undefined) return guardada;
      const img = new Image();
      imagenesPremio.set(url, null);
      img.onload = () => { imagenesPremio.set(url, img); repintar(); };
      img.onerror = () => { imagenesPremio.set(url, false); };
      img.src = url;
      return null;
    }

    // Los premios que toca pintar ahora: los de la ronda tirada si la hay, y si
    // no los que estén puestos en los ajustes.
    function premiosDelTablero(estado) {
      return estado.premios || estado?.ajustes?.premios || [];
    }

    function tableroVaPremios(estado) {
      return (estado.modo || estado?.ajustes?.modo) === 'premios';
    }

    // Un nombre largo no cabe de una tirada: se parte en dos líneas como mucho
    // y lo que sobre se corta con puntos suspensivos.
    function partirNombre(ctx, texto, ancho) {
      const palabras = String(texto || '').split(/\s+/).filter(Boolean);
      if (!palabras.length) return [];
      const lineas = [];
      let actual = '';
      for (const palabra of palabras) {
        const prueba = actual ? actual + ' ' + palabra : palabra;
        if (ctx.measureText(prueba).width <= ancho || !actual) {
          actual = prueba;
        } else {
          lineas.push(actual);
          actual = palabra;
          if (lineas.length === 2) break;
        }
      }
      if (lineas.length < 2 && actual) lineas.push(actual);
      return lineas.slice(0, 2).map((linea, i, todas) => {
        if (ctx.measureText(linea).width <= ancho) return linea;
        let corto = linea;
        while (corto.length > 1 && ctx.measureText(corto + '…').width > ancho) corto = corto.slice(0, -1);
        return corto + '…';
      });
    }

    function colorCasilla(multiplicador, mayor) {
      const cuanto = mayor > 0 ? Math.min(1, multiplicador / mayor) : 0;
      // De verde apagado (paga poco) a rojo (paga mucho), pasando por naranja.
      const tono = 145 - 145 * Math.pow(cuanto, 0.65);
      return {
        claro: `hsl(${tono} 85% ${52 + 8 * cuanto}%)`,
        oscuro: `hsl(${tono} 80% ${30 + 6 * cuanto}%)`
      };
    }

    // Cuánto dura encendida una clavija tras el golpe, en milisegundos.
    const BRILLO_CLAVIJA = 260;

    // Pinta un tablero entero en el lienzo que se le dé. No sabe de dónde sale
    // el estado ni quién lo mira: lo usan igual la página y el widget de OBS.
    //
    //  lienzo  el <canvas>
    //  estado  lo que contesta /api/plinko (tablero, multiplicadores, premios)
    //  vivas   Map de clavija -> cuándo se golpeó, para encenderlas
    //  bolas   las bolas que hay que pintar ahora mismo
    //  casillas  Map de casilla -> cuándo cayó una bola, para encenderla. Se
    //            puede no pasar: entonces no se enciende ninguna.
    function dibujar(lienzo, estado, vivas, bolas, casillas) {
      const casillasVivas = casillas || VACIO;
      const t = estado.tablero;
      if (!lienzo || !t) return;
      const ctx = lienzo.getContext('2d');

      // El lienzo se ajusta al hueco que tenga, contando la densidad de la
      // pantalla: si no, en un móvil o a pantalla completa sale borroso.
      const caja = lienzo.getBoundingClientRect();
      const densidad = Math.min(2, window.devicePixelRatio || 1);
      const ancho = Math.max(1, Math.round(caja.width * densidad));
      const alto = Math.max(1, Math.round(caja.height * densidad));
      if (lienzo.width !== ancho || lienzo.height !== alto) {
        lienzo.width = ancho;
        lienzo.height = alto;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);

      // Del mundo del tablero a píxeles: cabe entero y centrado. El margen deja
      // sitio para el marco, que va por fuera de las paredes.
      const pared = ((t.filas - 1) + 3 - 1) / 2 * t.separacion;
      const arriba = -t.alturaSalida;
      const abajo = (t.filas - 1) * t.altoFila + t.fondo;
      const margen = 0.85;
      const escala = Math.min(
        ancho / (pared * 2 + margen * 2),
        alto / ((abajo - arriba) + margen * 2)
      );
      const cx = ancho / 2;
      const cy = (alto - (abajo - arriba) * escala) / 2 - arriba * escala;
      const aX = (x) => cx + x * escala;
      const aY = (y) => cy + y * escala;
      const ahora = performance.now();

      const ultimaFilaY = (t.filas - 1) * t.altoFila;
      const bordes = bordesDe(t);
      const multis = estado.multiplicadores || [];
      const mayor = Math.max(1, ...multis);
      // Los límites de la pista. La pared se dibuja por fuera de las clavijas
      // del borde, sin llegar a tocarlas: por dentro iría montada encima de
      // ellas y se vería como si las aplastara. Lo que para la bola de verdad
      // son esas clavijas, y ahí es donde se la ve rebotar.
      const holgura = t.radioClavija + t.separacion * 0.16;
      const izq = aX(-pared - holgura);
      const der = aX(pared + holgura);
      const cima = aY(arriba) - escala * 0.3;
      const suelo = aY(abajo);
      const grosorPared = Math.max(3, escala * 0.14);

      // El fondo de la pista, para que se vea dónde empieza y dónde acaba.
      const fondo = ctx.createLinearGradient(0, cima, 0, suelo);
      fondo.addColorStop(0, 'rgba(10,32,50,0.95)');
      fondo.addColorStop(1, 'rgba(4,16,26,0.95)');
      ctx.fillStyle = fondo;
      caminoRedondo(ctx, izq, cima, der - izq, suelo - cima, escala * 0.22);
      ctx.fill();

      // La boca por la que entra la bola, arriba del todo y en el centro.
      const bocaAncho = t.separacion * 1.5 * escala;
      ctx.fillStyle = 'rgba(148,180,210,0.20)';
      caminoRedondo(ctx, cx - bocaAncho / 2, cima - escala * 0.1, bocaAncho, escala * 0.55, escala * 0.14);
      ctx.fill();

      // Las casillas de abajo: con su multiplicador, o con el premio que toque.
      const vanPremios = tableroVaPremios(estado);
      const premios = premiosDelTablero(estado);
      const arribaCasillas = aY(ultimaFilaY + t.altoFila * 0.42);
      for (let i = 0; i < bordes.length - 1; i++) {
        // Las de las puntas llegan hasta la pared: si se quedaran en la clavija
        // del borde, entre la casilla y la pared quedaría una rendija.
        const x1 = i === 0 ? izq : aX(bordes[i]);
        const x2 = i === bordes.length - 2 ? der : aX(bordes[i + 1]);
        const viva = casillasVivas.get(i);
        const vida = viva ? Math.max(0, 1 - (ahora - viva) / BRILLO_CASILLA) : 0;
        const color = colorCasilla(multis[i] ?? 0, mayor);
        const hueco = Math.max(1, escala * 0.06);
        const anchoCaja = Math.max(1, x2 - x1 - hueco * 2);
        const altoCaja = suelo - arribaCasillas - hueco;

        // La cajita, con degradado: así tiene cuerpo y no es un plano de color.
        const tinta = ctx.createLinearGradient(0, arribaCasillas, 0, suelo);
        tinta.addColorStop(0, color.claro);
        tinta.addColorStop(1, color.oscuro);
        ctx.fillStyle = tinta;
        ctx.globalAlpha = 0.9 + 0.1 * vida;
        caminoRedondo(ctx, x1 + hueco, arribaCasillas, anchoCaja, altoCaja, escala * 0.14);
        ctx.fill();
        ctx.globalAlpha = 1;

        // La que acaba de recibir una bola se enciende y se va apagando.
        if (vida > 0) {
          ctx.save();
          ctx.shadowColor = color.claro;
          ctx.shadowBlur = escala * 0.9 * vida;
          ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.55 * vida})`;
          ctx.lineWidth = Math.max(1.5, escala * 0.07);
          caminoRedondo(ctx, x1 + hueco, arribaCasillas, anchoCaja, altoCaja, escala * 0.14);
          ctx.stroke();
          ctx.restore();
        }

        const centroX = (x1 + x2) / 2;
        ctx.textAlign = 'center';

        if (vanPremios) {
          // El premio: su imagen arriba y su nombre debajo, dentro de la caja.
          const premio = premios[i] || {};
          const img = imagenPremio(premio.imagen);
          const margen = Math.max(2, escala * 0.08);
          const altoTexto = premio.nombre ? Math.min(altoCaja * 0.42, escala * 0.62) : 0;
          const altoImagen = altoCaja - altoTexto - margen;

          if (img && altoImagen > 4) {
            // Se encaja sin deformarla: manda el lado que primero se queda sin
            // sitio, que si no los objetos anchos salen aplastados.
            const cabe = Math.min(anchoCaja - margen * 2, altoImagen);
            const proporcion = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
            let ancho = cabe, alto = cabe;
            if (proporcion > 1) alto = cabe / proporcion; else ancho = cabe * proporcion;
            ctx.drawImage(img, centroX - ancho / 2, arribaCasillas + margen + (altoImagen - alto) / 2, ancho, alto);
          }

          if (premio.nombre) {
            ctx.fillStyle = 'rgba(6,20,32,0.92)';
            const cuerpo = Math.max(7, Math.min(escala * 0.2, anchoCaja * 0.22));
            ctx.font = `700 ${cuerpo}px system-ui, sans-serif`;
            ctx.textBaseline = 'bottom';
            const lineas = partirNombre(ctx, premio.nombre, anchoCaja - margen * 2);
            lineas.forEach((linea, n) => {
              const y = suelo - margen - (lineas.length - 1 - n) * cuerpo * 1.05;
              ctx.fillText(linea, centroX, y, anchoCaja - margen);
            });
          }
        } else {
          // El multiplicador. Oscuro sobre el color, que se lee mejor que blanco.
          ctx.fillStyle = 'rgba(6,20,32,0.92)';
          ctx.font = `800 ${Math.max(9, Math.min(escala * 0.36, anchoCaja * 0.42))}px system-ui, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(`x${multis[i] ?? 0}`, centroX, arribaCasillas + altoCaja / 2, anchoCaja);
        }
      }

      // Las paredes: dos barras con volumen, no dos rayas. Son el límite de
      // verdad de la pista, así que tienen que verse como tal.
      [izq, der].forEach((x, i) => {
        const barra = ctx.createLinearGradient(x - grosorPared / 2, 0, x + grosorPared / 2, 0);
        const fuera = i === 0 ? 0 : 1;
        barra.addColorStop(fuera, '#24435e');
        barra.addColorStop(1 - fuera, '#7fa8c9');
        ctx.fillStyle = barra;
        caminoRedondo(ctx, x - grosorPared / 2, cima, grosorPared, suelo - cima, grosorPared / 2);
        ctx.fill();
      });

      // El suelo, cerrando la pista por abajo.
      ctx.fillStyle = '#24435e';
      caminoRedondo(ctx, izq - grosorPared / 2, suelo, (der - izq) + grosorPared,
        grosorPared * 0.8, grosorPared / 2);
      ctx.fill();

      // Y el marco de toda la pista.
      ctx.strokeStyle = 'rgba(180,215,240,0.30)';
      ctx.lineWidth = Math.max(1, escala * 0.05);
      caminoRedondo(ctx, izq, cima, der - izq, suelo - cima, escala * 0.22);
      ctx.stroke();

      // Las clavijas. La que acaba de recibir un golpe se enciende: es lo que
      // deja ver por dónde va rebotando la bola.
      const rClavija = t.radioClavija * escala;
      clavijasDe(t).forEach((p, i) => {
        const px = aX(p.x);
        const py = aY(p.y);
        const golpeada = vivas.get(i);
        const vida = golpeada ? Math.max(0, 1 - (ahora - golpeada) / BRILLO_CLAVIJA) : 0;

        if (vida > 0) {
          // El fogonazo del golpe, que se apaga solo.
          const radio = rClavija * (2.6 + vida);
          const halo = ctx.createRadialGradient(px, py, rClavija * 0.5, px, py, radio);
          halo.addColorStop(0, `rgba(255,240,180,${0.6 * vida})`);
          halo.addColorStop(1, 'rgba(255,240,180,0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(px, py, radio, 0, Math.PI * 2);
          ctx.fill();
        }

        // Su sombra, para que no parezca pegada al fondo.
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(px, py + rClavija * 0.22, rClavija, 0, Math.PI * 2);
        ctx.fill();

        const brillo = ctx.createRadialGradient(
          px - rClavija * 0.4, py - rClavija * 0.45, rClavija * 0.1, px, py, rClavija);
        brillo.addColorStop(0, '#ffffff');
        brillo.addColorStop(0.55, vida > 0 ? mezclarHaciaBlanco('#ffd977', vida * 0.6) : '#cfe3f5');
        brillo.addColorStop(1, vida > 0 ? '#c9952c' : '#6f8aa6');
        ctx.fillStyle = brillo;
        ctx.beginPath();
        ctx.arc(px, py, rClavija * (1 + 0.14 * vida), 0, Math.PI * 2);
        ctx.fill();
      });

      // Y las bolas, con su estela y su brillo. Van las últimas: pasan por
      // delante de todo lo demás.
      const rBola = t.radioBola * escala;
      bolas.forEach((b) => {
        if (!b.visible) return;
        // La estela: por dónde acaba de pasar, apagándose hacia atrás.
        for (let i = 0; i < b.estela.length; i++) {
          const punto = b.estela[i];
          const cuanto = (i + 1) / (b.estela.length + 1);
          ctx.fillStyle = b.color;
          ctx.globalAlpha = 0.18 * cuanto;
          ctx.beginPath();
          ctx.arc(aX(punto[0]), aY(punto[1]), rBola * (0.45 + 0.5 * cuanto), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        const px = aX(b.x);
        const py = aY(b.y);
        // Sombra pegada debajo.
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(px + rBola * 0.12, py + rBola * 0.18, rBola * 0.95, 0, Math.PI * 2);
        ctx.fill();

        // La bola: clara por arriba y oscura por abajo, como una canica.
        const cuerpo = ctx.createRadialGradient(
          px - rBola * 0.35, py - rBola * 0.4, rBola * 0.08, px, py, rBola);
        cuerpo.addColorStop(0, mezclarHaciaBlanco(b.color, 0.85));
        cuerpo.addColorStop(0.45, b.color);
        cuerpo.addColorStop(1, mezclarHaciaNegro(b.color, 0.55));
        ctx.fillStyle = cuerpo;
        ctx.beginPath();
        ctx.arc(px, py, rBola, 0, Math.PI * 2);
        ctx.fill();

        // El reflejo de arriba a la izquierda: es lo que la hace redonda.
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(px - rBola * 0.33, py - rBola * 0.38, rBola * 0.26, rBola * 0.18,
          -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        // Y un filo claro abajo, el rebote de la luz del tablero.
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = Math.max(1, rBola * 0.12);
        ctx.beginPath();
        ctx.arc(px, py, rBola * 0.88, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();

        // De quién es la bola, en una etiqueta encima. Con varias cayendo a la
        // vez es la única forma de saber cuál es la tuya.
        etiquetaDeBola(ctx, b, px, py - rBola * 1.5, escala, izq, der);
      });
    }

    // El nombre del jugador, encima de su bola. Va en una etiqueta del color de
    // la bola para poder seguirla de un vistazo cuando caen varias juntas, y se
    // mantiene dentro de la pista: pegada a la pared se saldría del tablero.
    function etiquetaDeBola(ctx, b, px, py, escala, izq, der) {
      const tamano = Math.max(9, escala * 0.28);
      ctx.font = `700 ${tamano}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Un nombre largo se corta: la etiqueta no puede ser más ancha que el
      // tablero, y tampoco hace falta para reconocerlo.
      if (b.etiqueta == null || b.etiquetaTamano !== tamano) {
        let texto = b.nombre;
        const tope = (der - izq) * 0.28;
        if (ctx.measureText(texto).width > tope) {
          while (texto.length > 2 && ctx.measureText(texto + '…').width > tope) {
            texto = texto.slice(0, -1);
          }
          texto += '…';
        }
        b.etiqueta = texto;
        b.etiquetaTamano = tamano;
      }

      const anchoTexto = ctx.measureText(b.etiqueta).width;
      const alto = tamano * 1.5;
      const ancho = anchoTexto + tamano * 0.9;
      // Ni se sale por los lados ni se sube por encima del tablero.
      const x = Math.min(Math.max(px, izq + ancho / 2 + 2), der - ancho / 2 - 2);
      const y = Math.max(py, alto / 2 + 2);

      ctx.fillStyle = 'rgba(4,16,26,0.82)';
      caminoRedondo(ctx, x - ancho / 2, y - alto / 2, ancho, alto, alto / 2);
      ctx.fill();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.max(1, tamano * 0.09);
      caminoRedondo(ctx, x - ancho / 2, y - alto / 2, ancho, alto, alto / 2);
      ctx.stroke();

      ctx.fillStyle = '#eef6ff';
      ctx.fillText(b.etiqueta, x, y + tamano * 0.05);
    }

    // Un rectángulo de esquinas redondeadas. roundRect no está en todas partes
    // y aquí se usa a cada rato.
    function caminoRedondo(ctx, x, y, ancho, alto, radio) {
      const r = Math.max(0, Math.min(radio, ancho / 2, alto / 2));
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x, y, ancho, alto, r); return; }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + ancho, y, x + ancho, y + alto, r);
      ctx.arcTo(x + ancho, y + alto, x, y + alto, r);
      ctx.arcTo(x, y + alto, x, y, r);
      ctx.arcTo(x, y, x + ancho, y, r);
      ctx.closePath();
    }

    // Aclarar y oscurecer un color de los de la lista (#rrggbb).
    function mezclarHaciaBlanco(color, cuanto) {
      return mezclarColor(color, 255, cuanto);
    }
    function mezclarHaciaNegro(color, cuanto) {
      return mezclarColor(color, 0, cuanto);
    }
    function mezclarColor(color, hacia, cuanto) {
      const n = parseInt(color.slice(1), 16);
      const r = Math.round((n >> 16 & 255) + (hacia - (n >> 16 & 255)) * cuanto);
      const g = Math.round((n >> 8 & 255) + (hacia - (n >> 8 & 255)) * cuanto);
      const b = Math.round((n & 255) + (hacia - (n & 255)) * cuanto);
      return `rgb(${r},${g},${b})`;
    }

  window.PlinkoTablero = {
    dibujar,
    nuevaBola,
    COLORES,
    ESTELA,
    RETRASO_BOLA,
    clavijasDe,
    bordesDe,
    colorCasilla,
    BRILLO_CLAVIJA,
    BRILLO_CASILLA,
    // El repintado de las imágenes que llegan tarde.
    alRepintar(fn) { repintar = typeof fn === 'function' ? fn : () => {}; }
  };
})();
