// El arte de los combates de Dofus: las clases del Mundo de los Doce con su
// pinta y sus hechizos, el dibujo de cada muneco, y el relato de un combate
// golpe a golpe.
//
// Es de la batalla y del rey de la colina por igual: los dos reparten clase
// igual y los dos cuentan sus combates con contarRonda(), asi que esto no es
// de ninguno de los dos en particular.
//
// Salio de index.html, que se habia puesto en casi once mil lineas. Se movio
// tal cual, sin tocar la sangria: dentro hay plantillas de varias lineas y
// quitarles los cuatro espacios cambiaria lo que generan. Sigue siendo un
// script normal, sin modulo: comparte el ambito global con el resto, y por eso
// el orden en el que index.html lo carga importa.

    // --- Estilo Dofus ---------------------------------------------------
    // Cada espectador pelea con una clase del Mundo de los Doce, siempre la
    // misma (sale de su nombre), y lanza hechizos de esa clase. Todo esto es
    // solo como se cuenta: el daño y quién gana los decide el servidor igual.
    const CLASES_DOFUS = [
      { clase: 'Yopuka', ropa: '#1d4ed8', pelo: '#f97316', rasgo: 'pinchos', arma: '🗡️',
        hechizos: [['Presión', 'tierra'], ['Ira de Yopuka', 'tierra'], ['Espada Divina', 'aire'], ['Espada Celeste', 'aire']] },
      { clase: 'Ocra', ropa: '#15803d', pelo: '#a16207', rasgo: 'capucha', arma: '🏹',
        hechizos: [['Flecha Mágica', 'aire'], ['Flecha Explosiva', 'fuego'], ['Flecha Castigadora', 'tierra'], ['Flecha Flamígera', 'fuego']] },
      { clase: 'Xelor', ropa: '#1e3a8a', pelo: '#e5e7eb', rasgo: 'vendas', arma: '⏳',
        hechizos: [['Aguja', 'fuego'], ['Ralentización', 'neutral'], ['Golpe del Xelor', 'fuego']] },
      { clase: 'Anutrof', ropa: '#78350f', pelo: '#e5e7eb', rasgo: 'barba', arma: '⛏️',
        hechizos: [['Lanzamiento de Monedas', 'agua'], ['Pala Fantasmal', 'tierra']] },
      { clase: 'Zurcarák', ropa: '#c2410c', pelo: '#fbbf24', rasgo: 'gato', arma: '🎲',
        hechizos: [['Cara o Cruz', 'agua'], ['Garra Juguetona', 'tierra'], ['Ruleta', 'fuego']] },
      { clase: 'Feca', ropa: '#7c3aed', pelo: '#1f2937', rasgo: 'sombrero', arma: '🛡️',
        hechizos: [['Ataque Natural', 'fuego'], ['Glifo Agresivo', 'fuego'], ['Burbuja', 'agua']] },
      { clase: 'Sram', ropa: '#111827', pelo: '#e5e7eb', rasgo: 'calavera', arma: '🔪',
        hechizos: [['Veneno Paralizante', 'aire'], ['Trampa', 'fuego'], ['Ataque Mortal', 'tierra']] },
      { clase: 'Sadida', ropa: '#166534', pelo: '#65a30d', rasgo: 'hojas', arma: '🪆',
        hechizos: [['Zarza', 'tierra'], ['Terremoto', 'tierra'], ['Viento Envenenado', 'aire']] },
      { clase: 'Osamodas', ropa: '#0f766e', pelo: '#1e293b', rasgo: 'cuernos', arma: '🐉',
        hechizos: [['Látigo', 'aire'], ['Invocación de Jalató', 'aire']] },
      { clase: 'Aniripsa', ropa: '#db2777', pelo: '#fde68a', rasgo: 'alas', arma: '✨',
        hechizos: [['Palabra Hiriente', 'fuego'], ['Palabra Prohibida', 'fuego']] },
      { clase: 'Sacrógrito', ropa: '#991b1b', pelo: '#111827', rasgo: 'pinchos', arma: '🩸',
        hechizos: [['Castigo', 'neutral'], ['Asalto', 'tierra'], ['Arrebato', 'aire']] },
      { clase: 'Pandawa', ropa: '#e5e7eb', pelo: '#111827', rasgo: 'panda', arma: '🍶',
        hechizos: [['Karcham', 'tierra'], ['Puño Llameante', 'fuego'], ['Borrachera', 'agua']] },
      // Nombres provisionales: juega con la Rabia y su Presa, en los cuatro elementos.
      { clase: 'Uginak',
        hechizos: [['Mordisco', 'tierra'], ['Colmillo de la Presa', 'fuego'], ['Ladrido', 'aire'], ['Rabia de Uginak', 'agua']] },
      { clase: 'Zobal', ropa: '#7f1d1d', pelo: '#e5e7eb', rasgo: 'calavera', arma: '🎭',
        hechizos: [['Máscara del Psicópata', 'tierra'], ['Máscara del Clase', 'fuego'], ['Golpe de Máscara', 'neutral']] },
      { clase: 'Selotrop', ropa: '#0f766e', pelo: '#e5e7eb', rasgo: 'capucha', arma: '⚙️',
        hechizos: [['Chorro de Vapor', 'agua'], ['Pistón', 'tierra'], ['Lanzallamas', 'fuego']] }
    ];
    // Lo que vuela de uno a otro, según el elemento del hechizo.
    const EMOJI_ELEMENTO = { tierra: '🪨', fuego: '🔥', agua: '💧', aire: '🌪️', neutral: '✴️' };

    function hashDe(nombre) {
      let h = 0;
      for (const ch of String(nombre || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      return h;
    }
    // La clase la sortea el servidor al empezar el torneo y viene con cada
    // luchador. Si no trae (un torneo de antes), sale de su nombre.
    // Mientras haya arte puesto, solo se ve arte: una clase sin imagen (de un
    // torneo de antes, o sin sortear) se cambia por una que sí la tenga,
    // siempre la misma para cada nombre.
    function claseDe(nombre) {
      const l = (batalla.luchadores || []).find((x) => x.nombre === nombre);
      // El rey de la colina reparte clase por su cuenta y la guarda por
      // persona, asi que si el nombre es de alli manda esa.
      const deColina = (colina.clases || {})[String(nombre || '').toLowerCase()];
      const sorteada = deColina
        ? CLASES_DOFUS.find((c) => c.clase === deColina)
        : (l && CLASES_DOFUS.find((c) => c.clase === l.clase));
      const clasesArte = (batalla.arte && batalla.arte.clases) || {};
      const conArte = CLASES_DOFUS.filter((c) => clasesArte[c.clase]);
      if (conArte.length && !(sorteada && clasesArte[sorteada.clase])) {
        return conArte[hashDe(nombre) % conArte.length];
      }
      return sorteada || CLASES_DOFUS[hashDe(nombre) % CLASES_DOFUS.length];
    }
    // El hechizo de cada golpe: va rotando entre los de su clase.
    function hechizoDe(nombre, i) {
      const c = claseDe(nombre);
      const [hechizo, elemento] = c.hechizos[(hashDe(nombre) + i) % c.hechizos.length];
      return { nombre: hechizo, elemento };
    }
    // Los escenarios que haya puestos. Si hay varios, cada combate pelea en
    // uno: se reparten por su sitio en el cuadro, no al azar, para que al
    // repintar la pagina cada duelo siga en el mismo sitio donde peleaba.
    function escenarioDe(indiceRonda, indiceDuelo) {
      const arte = batalla.arte || {};
      const lista = arte.escenarios && arte.escenarios.length
        ? arte.escenarios
        : (arte.escenario ? [arte.escenario] : []);
      if (!lista.length) return '';
      // El desfase por ronda evita que el mismo duelo repita escenario al
      // avanzar el torneo: cambia de sitio como cambian los rivales. El paso
      // es de uno a proposito: cualquier otro se queda clavado en cuanto el
      // numero de escenarios lo divide (con 3 escenarios, saltar de 3 en 3 es
      // no moverse).
      return lista[(indiceRonda + indiceDuelo) % lista.length];
    }

    // La caja de cada combate: el escenario que haya puesto el dueño (si no,
    // el mapa de casillas).
    function abrirRing(indiceRonda, indiceDuelo) {
      const escenario = escenarioDe(indiceRonda || 0, indiceDuelo || 0);
      return escenario
        ? `<div class="ring dofus con-escenario" style="background-image:url('${escapeHtml(escenario)}')">`
        : '<div class="ring dofus">';
    }

    function etiquetaClase(nombre) {
      return `<span class="clase">${claseDe(nombre).clase}</span>`;
    }

    // El aspecto de cada clase, al estilo chibi de Dofus: colores y las piezas
    // que la distinguen. Cada pieza es un trozo de SVG sobre la plantilla de
    // dofusSvg (lienzo 60x80, mirando a la derecha):
    //  detras: lo que va detrás del cuerpo (cola, alas, carcaj…)
    //  detrasCabeza: lo que va detrás de la cabeza (melena, orejas de panda…)
    //  pantalon: el color de las piernas (sin poner, marrón oscuro)
    //  oreja:  la oreja de la cara ('' = ninguna; sin poner = la normal)
    //  cara, ojos, boca: sustituyen o se añaden a los de la plantilla
    //  pelo:   pelo, capucha o sombrero, encima de la cabeza
    //  arma:   detrás de la mano (espadas, arcos, bastones)
    //  armaDelante: delante de la mano (escudos, dados, muñecas)
    const ARTE_DOFUS = {
      Yopuka: {
        piel: '#f6c9a3', ropa: '#f3efe6', ropa2: '#c0392b', manga: '#e9e3d6', pantalon: '#e2dccd', botas: '#c0392b', iris: '#2563eb',
        detras: '<path d="M23 38 Q14 55 16 74 Q22 70 27 72 Q25 55 27 40 Z" fill="#b83227"/>',
        cuerpo: `<path d="M26.5 40.5 L30.5 47 L34.5 40.5 L32.5 40.5 L30.5 44 L28.5 40.5 Z" fill="#c0392b"/>
          <path d="M34 37.5 Q39.5 36 40.5 41 Q37 41.5 35 40 Z" fill="#c0392b"/>`,
        pelo: `<path d="M15 28 Q11 16 18 13 L14 4 L23 9 L24 -1 L30 8 L35 0 L37 9 L45 4 L43 13 Q49 17 47 26 Q41 17 31 17 Q21 17 15 28 Z" fill="#ff7a1a"/>
          <path d="M22 12 L24 3 L28 10 Z M33 9 L35 3 L37 10 Z" fill="#ffc07a" stroke="none"/>`,
        arma: `<path d="M45 55 L57 26 Q59 24 60 27 L48 57 Z" fill="#e4ebf3"/>
          <path d="M47 52 L57.5 27" stroke="#fff" stroke-width=".8" fill="none"/>
          <path d="M40.5 53.5 L50 59.5" stroke="#8b5a2b" stroke-width="3.2"/>`
      },
      Ocra: {
        piel: '#f7d8b8', ropa: '#5b6b2e', ropa2: '#7a4a24', manga: '#4e5c27', pantalon: '#6b4a2a', botas: '#6b3f1f', iris: '#15803d',
        cuerpo: `<path d="M35.5 37.5 L22.5 55" fill="none" stroke="#7a4a24" stroke-width="2.4"/>
          <circle cx="29" cy="46" r="1.2" fill="#e8c35a"/>`,
        detras: `<path d="M14 42 L22 40 L26 58 L18 60 Z" fill="#8b5a2b"/>
          <path d="M15 41 L12 34 M18 40 L17 32 M21 39 L22 32" stroke="#c0392b" stroke-width="1.4" fill="none"/>`,
        detrasCabeza: '<path d="M17 24 Q12 44 21 52 Q23 44 26 40 Z" fill="#e0662a"/>',
        oreja: '<path d="M20 27 L8 20 Q12 30 19.5 34 Z" fill="#f7d8b8"/>',
        pelo: `<path d="M15.5 29 Q15 13 31 13 Q45 13 47 25 Q40 18 33 19 Q30 23 24 22 Q19 23 15.5 29 Z" fill="#e0662a"/>
          <path d="M16.5 22 Q31 15 46 21" fill="none" stroke="#c0392b" stroke-width="2.2"/>`,
        arma: `<path d="M47 40 Q58 57 47 74" fill="none" stroke="#6b4423" stroke-width="2.8"/>
          <path d="M47 40 L47 74" fill="none" stroke="#e5e7eb" stroke-width=".7"/>`
      },
      Xelor: {
        piel: '#e9dfc6', ropa: '#243b6b', ropa2: '#d4af37', manga: '#1e3158', pantalon: '#1e3158', botas: '#1e293b', sinRubor: true, sinNariz: true,
        cuerpo: `<circle cx="30.5" cy="46" r="3.6" fill="#d4af37"/>
          <circle cx="30.5" cy="46" r="2.4" fill="#fff7dc"/>
          <path d="M30.5 46 L30.5 44.2 M30.5 46 L31.9 46.8" stroke-width=".7" fill="none"/>`,
        oreja: '',
        cara: '<path d="M17 23 Q31 19 45.5 23 M16.2 30 Q30 27 46 30.5 M18 37 Q30 34.5 43.5 37.5" fill="none" stroke="#b9a988" stroke-width="1"/>',
        ojos: `<ellipse cx="34" cy="28" rx="7.5" ry="3.8" fill="#fde047" opacity=".25" stroke="none"/>
          <ellipse cx="37.2" cy="28" rx="2.6" ry="2" fill="#fde047" stroke="none"/>
          <ellipse cx="30.3" cy="28.2" rx="2.1" ry="1.8" fill="#fde047" stroke="none"/>`,
        boca: '',
        pelo: `<path d="M13.5 32 Q11 9 31 8 Q50 8 48.5 28 Q44 17 31 17 Q19 17 16.5 32 Z" fill="#243b6b"/>
          <circle cx="31" cy="11.5" r="3.6" fill="#f5e6b0"/>
          <path d="M31 11.5 L31 9 M31 11.5 L33 12.5" stroke-width=".9" fill="none"/>`,
        arma: `<path d="M44 70 L47 34" stroke="#6b4423" stroke-width="2.6" fill="none"/>
          <circle cx="47.5" cy="31" r="5.5" fill="#d4af37"/>
          <circle cx="47.5" cy="31" r="3.8" fill="#fff7dc"/>
          <path d="M47.5 31 L47.5 28.3 M47.5 31 L49.6 32" stroke-width="1" fill="none"/>`
      },
      Anutrof: {
        piel: '#f2c9a0', ropa: '#8a5a2b', ropa2: '#d4a017', manga: '#7a4e24', pantalon: '#6b4423', botas: '#4a3020', sinNariz: true,
        cuerpo: `<rect x="33" y="44" width="4.5" height="4" fill="#b07a3f" stroke-dasharray="1 .8"/>
          <path d="M36 56 Q35 62 38.5 62.5 Q42 62 41 56 Z" fill="#c9a227"/>
          <circle cx="38.5" cy="59.5" r="1" fill="#fff3b0" stroke="none"/>`,
        cara: `<path d="M22 33 Q20 50 33 53 Q46 50 45 34 Q39 39 32 37.5 Q26 38 22 33 Z" fill="#f4f4f0"/>
          <path d="M27 44 Q33 47 39 44" fill="none" stroke="#cfcfc8" stroke-width=".9"/>`,
        boca: '<ellipse cx="44.5" cy="31.5" rx="3.8" ry="3.2" fill="#f2b48a"/>',
        pelo: `<path d="M15 25 Q16 11 31 11 Q45 11 47 21 L52 22.5 Q50 25.5 45.5 24.5 Q39 19 30.5 19 Q21 19.5 15 25 Z" fill="#6b4423"/>
          <path d="M34 22 Q37.5 19.5 41.5 22 M28 22.5 Q30 20.5 32.5 22.2" fill="none" stroke="#f4f4f0" stroke-width="2.2"/>`,
        arma: `<path d="M40 49 L54 74" stroke="#8b5a2b" stroke-width="2.6" fill="none"/>
          <path d="M51 71 L58 69 L60 76 Q57 80 53 77 Z" fill="#9ca3af"/>`
      },
      'Zurcarák': {
        piel: '#f3a95c', ropa: '#7a1f5c', ropa2: '#f1c40f', manga: '#6a1a50', pantalon: '#6a1a50', botas: '#3b1f2b', sinNariz: true,
        cuerpo: `<path d="M27.5 45 q1.5 -2 3 0 q1.5 -2 3 0 q0 2.5 -3 4.5 q-3 -2 -3 -4.5 z" fill="#f1c40f"/>
          <circle cx="30.5" cy="38.8" r="1.6" fill="#f1c40f"/>`,
        detras: `<path d="M20 64 Q5 62 7 49 Q8 42 13 44" fill="none" stroke="#2a1a12" stroke-width="5.4"/>
          <path d="M20 64 Q5 62 7 49 Q8 42 13 44" fill="none" stroke="#f3a95c" stroke-width="3"/>`,
        oreja: '',
        cara: `<path d="M24 16 L26 21 M29 15 L30 20 M20 20 L23 23" fill="none" stroke="#c46a1c" stroke-width="1.4"/>
          <ellipse cx="39" cy="34" rx="5.5" ry="4" fill="#fff4e6"/>`,
        ojos: `<ellipse cx="37.2" cy="27.5" rx="2.7" ry="3.4" fill="#65a30d" stroke="none"/>
          <ellipse cx="37.4" cy="27.5" rx=".9" ry="2.8" fill="#111" stroke="none"/>
          <ellipse cx="30.3" cy="27.8" rx="2.2" ry="3.1" fill="#65a30d" stroke="none"/>
          <ellipse cx="30.5" cy="27.8" rx=".8" ry="2.5" fill="#111" stroke="none"/>
          <circle cx="38.2" cy="26.2" r=".8" fill="#fff" stroke="none"/>`,
        boca: `<path d="M41.5 32 L43.5 31 L43.5 33 Z" fill="#e26a7a"/>
          <path d="M40 35 Q41.5 36.5 43 35 Q44.5 36.5 46 35" fill="none" stroke-width=".9"/>
          <path d="M45 33 L52 31.5 M45 34.5 L52 35 M34 33.5 L28 32.5" fill="none" stroke-width=".7"/>`,
        pelo: `<path d="M17 21 L15 5 L27 14 Z" fill="#f3a95c"/>
          <path d="M18.5 18 L17.5 9 L24 14 Z" fill="#f7b8c4" stroke="none"/>
          <path d="M33 13 L44 4 L44.5 19 Z" fill="#f3a95c"/>
          <path d="M36 13 L42.5 8 L42.8 16 Z" fill="#f7b8c4" stroke="none"/>`,
        armaDelante: `<g transform="rotate(-12 48 57)">
          <rect x="43" y="52" width="10" height="10" rx="2" fill="#fff"/>
          <circle cx="45.5" cy="54.5" r="1" fill="#c0392b" stroke="none"/>
          <circle cx="48" cy="57" r="1" fill="#c0392b" stroke="none"/>
          <circle cx="50.5" cy="59.5" r="1" fill="#c0392b" stroke="none"/></g>`
      },
      Feca: {
        piel: '#f7d6b5', ropa: '#6d3fb5', ropa2: '#f0c84a', manga: '#5b33a0', pantalon: '#4a2d80', botas: '#3b2a20', iris: '#7c3aed',
        cuerpo: `<path d="M26 36.6 L30.5 42.5 L34.5 36.6" fill="none" stroke="#f0c84a" stroke-width="1.6"/>
          <path d="M30.5 45 V51 M27.8 47.8 H33.2" stroke="#f0c84a" stroke-width="1.6" fill="none"/>`,
        pelo: `<path d="M16 30 Q15 19 24 17 L40 17 Q47 20 46.5 28 Q40 22 31 22.5 Q22 23 16 30 Z" fill="#3b2a20"/>
          <path d="M19 18.5 Q24 5 33 -3 Q36 8 42 18 Z" fill="#6d3fb5"/>
          <path d="M11 20.5 Q31 14 51 20.5 Q48 23.5 31 21.5 Q14 23.5 11 20.5 Z" fill="#6d3fb5"/>
          <path d="M20 16.5 Q31 13.5 41.5 16.5" fill="none" stroke="#f0c84a" stroke-width="2"/>`,
        armaDelante: `<path d="M41 47 H55 V57 Q55 65 48 69 Q41 65 41 57 Z" fill="#f0c84a"/>
          <path d="M44 50 H52 V57 Q52 62 48 65 Q44 62 44 57 Z" fill="#6d3fb5" stroke="none"/>
          <path d="M48 52 L48 62 M44.5 56 L51.5 56" stroke="#f0c84a" stroke-width="1.4" fill="none"/>`
      },
      Sram: {
        piel: '#efeade', ropa: '#2e1f40', ropa2: '#8b1e3f', manga: '#261935', pantalon: '#261935', botas: '#1a1224', sinRubor: true, sinNariz: true,
        cuerpo: `<circle cx="30.5" cy="55" r="2.4" fill="#efeade"/>
          <circle cx="29.7" cy="54.7" r=".55" fill="#1a1224" stroke="none"/>
          <circle cx="31.3" cy="54.7" r=".55" fill="#1a1224" stroke="none"/>
          <path d="M20 62 L22 65 L24 62.5 L26.5 66 L29 63 L31.5 66.5 L34 63 L36.5 66 L39 62.5 L41 64.5" fill="none" stroke-width="1"/>`,
        oreja: '',
        ojos: `<ellipse cx="37" cy="28" rx="3.3" ry="3.8" fill="#1a1224" stroke="none"/>
          <ellipse cx="30" cy="28.3" rx="2.8" ry="3.5" fill="#1a1224" stroke="none"/>
          <circle cx="37.3" cy="28.3" r="1.2" fill="#ef4444" stroke="none"/>
          <circle cx="30.3" cy="28.5" r="1" fill="#ef4444" stroke="none"/>`,
        boca: `<path d="M41.5 32 L43 34.5 L40.5 34.5 Z" fill="#1a1224" stroke="none"/>
          <path d="M33 38 H44 M35 36.5 V39.5 M38 36.5 V39.5 M41 36.5 V39.5" fill="none" stroke-width=".9"/>`,
        pelo: `<path d="M13 36 Q9 9 31 7.5 Q51 8 49.5 29 Q45 16.5 31 17 Q19.5 17.5 16.5 36 Z" fill="#3b2555"/>
          <path d="M17 16 Q31 6 46 15" fill="none" stroke="#8b1e3f" stroke-width="1.6"/>`,
        arma: `<path d="M46 55 L56 43 Q58 42 57.5 44.5 L48.5 57.5 Z" fill="#cbd5e1"/>
          <path d="M43 53.5 L48.5 58.5" stroke="#8b1e3f" stroke-width="3" fill="none"/>`
      },
      Sadida: {
        piel: '#8d5a3b', ropa: '#4d7c2a', ropa2: '#c8a24a', manga: '#43692a', pantalon: '#5c3d24', botas: '#3f2a1c', iris: '#65a30d',
        cuerpo: `<path d="M24 44 Q27 41 29 44 Q27 47 24 44 Z M33 47 Q36 44 38 47 Q36 50 33 47 Z" fill="#84cc16"/>
          <path d="M20 54.5 Q30 58 40.4 54.5" fill="none" stroke="#65a30d" stroke-width="1.4" stroke-dasharray="2 1.2"/>`,
        detrasCabeza: '<path d="M18 26 Q10 38 14 50 Q19 44 21 36 Z M22 22 Q14 30 17 42 Q22 36 24 28 Z" fill="#65a30d"/>',
        pelo: `<path d="M16 28 Q15 15 29 13 Q44 12 47 25 Q40 19 31 19.5 Q22 20 16 28 Z" fill="#4d7c0f"/>
          <path d="M20 15 Q16 4 26 6 Q26 12 20 15 Z M29 12 Q31 1 39 5 Q36 11 29 12 Z M39 14 Q45 7 49 13 Q44 16 39 14 Z" fill="#84cc16"/>`,
        armaDelante: `<circle cx="50" cy="52" r="3.6" fill="#e8c49a"/>
          <path d="M46.5 55.5 Q50 54 53.5 55.5 L54 63 Q50 65 46 63 Z" fill="#b45309"/>
          <path d="M48.6 51.3 L49.6 52.3 M50.6 51.3 L51.6 52.3" stroke-width=".7" fill="none"/>
          <path d="M47 59 H53" stroke="#fde68a" stroke-width=".8" fill="none"/>`
      },
      Osamodas: {
        piel: '#f3d2b8', ropa: '#2f6f6f', ropa2: '#e0b050', manga: '#285f5f', pantalon: '#285f5f', botas: '#2b2b3a', iris: '#0ea5e9',
        cuerpo: '<path d="M22.5 38.5 Q24 35 26 37 Q27.5 34.5 29.5 36.5 Q31 34 33 36.5 Q35 34.5 36.5 37 Q38.5 35.5 38.5 39 Q30 41.5 22.5 38.5 Z" fill="#efe6d2"/>',
        detras: `<path d="M20 63 Q8 66 6 56" fill="none" stroke="#2a1a12" stroke-width="4.4"/>
          <path d="M20 63 Q8 66 6 56" fill="none" stroke="#f3d2b8" stroke-width="2.2"/>
          <path d="M6 56 L3 51 L9 53 Z" fill="#2b2b3a"/>`,
        pelo: `<path d="M15.5 29 Q15 14 30 13 Q45 13 47 25 Q39 19 31 20 Q22 20 15.5 29 Z" fill="#2b2b3a"/>
          <path d="M21 16 Q12 12 13 3 Q17 9 24 12 Z" fill="#efe6d2"/>
          <path d="M38 13 Q44 5 52 7 Q46 9 42 16 Z" fill="#efe6d2"/>`,
        arma: '<path d="M45 57 Q55 50 53 40 Q51 32 58 28" fill="none" stroke="#6b4423" stroke-width="1.6"/>'
      },
      Aniripsa: {
        piel: '#fbe2d2', ropa: '#f2f2f2', ropa2: '#e25b9c', manga: '#e8e8e8', pantalon: '#ececec', botas: '#e25b9c', iris: '#db2777',
        cuerpo: '<path d="M27.5 45 q1.5 -2 3 0 q1.5 -2 3 0 q0 2.5 -3 4.5 q-3 -2 -3 -4.5 z" fill="#e25b9c"/>',
        detras: `<path d="M20 48 Q4 36 6 24 Q14 30 22 44 Z" fill="#dbeafe"/>
          <path d="M20 52 Q2 50 3 40 Q12 42 21 49 Z" fill="#eff6ff"/>`,
        pelo: `<circle cx="18" cy="16" r="5" fill="#f47ab0"/>
          <path d="M15.5 30 Q14 14 30 13 Q45 12.5 47 25 Q42 18 35 19 Q33 23 26 21.5 Q19 22 15.5 30 Z" fill="#f47ab0"/>`,
        armaDelante: `<path d="M46 58 L52 44" stroke="#f5f5f5" stroke-width="2" fill="none"/>
          <path d="M52 38.5 L53.6 42 L57.3 42.3 L54.5 44.7 L55.4 48.3 L52.2 46.4 L49 48.3 L49.9 44.7 L47.1 42.3 L50.8 42 Z" fill="#fde047"/>`
      },
      'Sacrógrito': {
        piel: '#d98a6a', ropa: '#5a1a1a', ropa2: '#c0392b', manga: '#d98a6a', pantalon: '#5a1a1a', botas: '#3a1010', iris: '#b91c1c',
        cara: '<path d="M22 24 L27 29 L22 34 M44 22 L41 26" fill="none" stroke="#7f1d1d" stroke-width="1.4"/>',
        cuerpo: `<path d="M27 48 L31 53 L35 48" fill="none" stroke="#e8a58a" stroke-width="1.3"/>
          <path d="M22.5 44 L26 46 M36 45 L39 43" stroke="#e8a58a" stroke-width="1" fill="none"/>`,
        pelo: `<path d="M17 24 Q19 14 31 13.5 Q43 14 45.5 22 Q39 18 31 18.5 Q23 19 17 24 Z" fill="#1c1917"/>
          <path d="M27 14 Q24 3 31 2 Q38 3 34 14 Z" fill="#1c1917"/>
          <path d="M28 7 H34" stroke="#c0392b" stroke-width="2" fill="none"/>`,
        armaDelante: '<path d="M42 55 H47.5 M42 58 H47.5" stroke="#f5f5f4" stroke-width="1.4" fill="none"/>'
      },
      Pandawa: {
        piel: '#f8f7f2', ropa: '#f1efe9', ropa2: '#b8452a', manga: '#f1efe9', pantalon: '#5c6b5a', botas: '#3a3a36', sinNariz: true,
        cuerpo: `<path d="M26 36.6 L34 47" fill="none" stroke="#b8452a" stroke-width="1.6"/>
          <path d="M38.5 55 L42 60 L39.5 60.5 Z" fill="#b8452a"/>`,
        detrasCabeza: '<circle cx="19" cy="17" r="5.5" fill="#1c1917"/><circle cx="42" cy="15.5" r="5.5" fill="#1c1917"/>',
        oreja: '',
        ojos: `<ellipse cx="37" cy="28.5" rx="4" ry="4.8" fill="#1c1917" stroke="none" transform="rotate(-15 37 28.5)"/>
          <ellipse cx="29.8" cy="28.8" rx="3.3" ry="4.4" fill="#1c1917" stroke="none" transform="rotate(12 29.8 28.8)"/>
          <circle cx="37.5" cy="28" r="1.5" fill="#fff" stroke="none"/>
          <circle cx="30.3" cy="28.2" r="1.2" fill="#fff" stroke="none"/>`,
        boca: `<ellipse cx="42.5" cy="33" rx="2" ry="1.4" fill="#1c1917"/>
          <path d="M39 36 Q41 37.5 43.5 36" fill="none" stroke-width=".9"/>`,
        armaDelante: `<path d="M47 49.5 L49 46.5" stroke="#6b4423" stroke-width="1.6" fill="none"/>
          <path d="M48 50 Q45 50 45.5 53.5 Q42 56 43.5 61 Q46 66 50.5 65.5 Q55 64.5 55.5 60 Q56 55.5 51.5 53.5 Q52 50 48 50 Z" fill="#d6a84a"/>`
      }
    };
    // Los ojos de siempre: grandes, con el iris de su color, dos brillos, el
    // párpado marcado y las cejas.
    function ojosDofus(iris) {
      return `
      <ellipse cx="37.2" cy="28" rx="2.7" ry="3.8" fill="#1f1a17" stroke="none"/>
      <ellipse cx="37.4" cy="28.7" rx="1.8" ry="2.6" fill="${iris}" stroke="none"/>
      <ellipse cx="30.3" cy="28.2" rx="2.2" ry="3.4" fill="#1f1a17" stroke="none"/>
      <ellipse cx="30.5" cy="28.9" rx="1.4" ry="2.3" fill="${iris}" stroke="none"/>
      <circle cx="38" cy="26.6" r="1.1" fill="#fff" stroke="none"/>
      <circle cx="36.7" cy="30" r=".5" fill="#fff" stroke="none"/>
      <circle cx="31" cy="26.8" r=".9" fill="#fff" stroke="none"/>
      <path d="M34.3 24.5 Q37.2 23 40.2 24.8" fill="none" stroke-width="1.5"/>
      <path d="M35 21.8 Q37.5 20.6 40 21.8 M28.5 22.3 Q30.5 21.3 32.3 22.1" fill="none" stroke-width="1"/>`;
    }

    // El Yopuka tiene dibujo propio, más trabajado que la plantilla común:
    // pelo en llama enorme con sombras en facetas, oreja de elfo, mirada seria,
    // camiseta blanca sin mangas con la cruz roja, azul en cuello, brazal y
    // cinturón, faldón, pantalón azul, botas rojas enormes con correa y el
    // brazalete de cuchillas en el brazo que pega. Mira a la derecha.
    function yopukaSvg(equipo) {
      const L = '#3a1d0c';
      const piel = '#f3b76b', pielSombra = '#d9934a';
      const blanco = '#f3efdc', blancoSombra = '#d6cfb4';
      const azul = '#2f6f9f', azulOscuro = '#234a63';
      const rojo = '#d62718', rojoOscuro = '#9e1a10';
      return `<svg viewBox="0 0 60 96" aria-hidden="true">
        <ellipse cx="31" cy="91" rx="19" ry="5" fill="${equipo}" fill-opacity=".22" stroke="${equipo}" stroke-width="1.8"/>
        <ellipse cx="32" cy="91" rx="14" ry="3" fill="#000" opacity=".3"/>
        <g stroke="${L}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">
          <path d="M25.5 32.5 Q20.5 36 21.5 45 L25.5 40 Z" fill="${rojo}"/>
          <path d="M25 55.5 L30.5 55.5 L31 76 L24 76 Z" fill="${azulOscuro}"/>
          <path d="M20.5 76 L31.5 75 L32.2 84.5 L37.5 86.5 Q40 90.5 35.5 91.3 L21 91.3 Q19.3 85 20.5 76 Z" fill="${rojoOscuro}"/>
          <path d="M20 74.2 L32 73.2 L32.6 77.4 L20.6 78.4 Z" fill="${rojo}"/>
          <path d="M20.8 83 L32 82 L32.3 84.6 L21.1 85.6 Z" fill="#8e9193"/>
          <path d="M30 55.5 L36.5 55.5 L37.5 74 L30.5 74 Z" fill="${azul}"/>
          <path d="M34.5 57 L36.8 72" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
          <path d="M27.5 75 L39 74 L39.8 82.5 L46.5 85 Q49.5 90 44 91.3 L29 91.3 Q26.5 84.5 27.5 75 Z" fill="${rojo}"/>
          <path d="M27 72.8 L39.4 71.8 L40 76.2 L27.6 77.2 Z" fill="${rojo}"/>
          <path d="M27.4 76 L39.8 75" fill="none" stroke="${rojoOscuro}" stroke-width="1"/>
          <path d="M28 81.4 L40 80.4 L40.3 83.2 L28.3 84.2 Z" fill="#8e9193"/>
          <path d="M40.5 81.6 L42.6 81.4 L42.9 84.1 L40.8 84.3 Z" fill="#b8bcbe"/>
          <path d="M41.5 86.8 L45 87.6" fill="none" stroke="#fff" stroke-width="1.1"/>
          <path d="M29 91.3 L44 91.3" fill="none" stroke="#1a0c05" stroke-width="1.4"/>
          <path d="M24 38 Q30.5 34.3 37.5 37 L39 54 L25 54.8 Z" fill="${blanco}"/>
          <path d="M24 38 Q26 36.8 28 36.2 L27.2 54.7 L25 54.8 Z" fill="${blancoSombra}" stroke="none"/>
          <path d="M34.6 38.2 L35.4 54" fill="none" stroke="${rojo}" stroke-width="2.2"/>
          <path d="M31 43.6 L35 43 L34 41.4 M35 43 L33.8 44.8" fill="none" stroke="${rojo}" stroke-width="1.3"/>
          <path d="M32 55 L38.6 55 L39.8 71 L33.5 72 Z" fill="${blanco}"/>
          <path d="M32 55 L34 55 L34.8 71.8 L33.5 72 Z" fill="${blancoSombra}" stroke="none"/>
          <path d="M36.4 55.5 L37.6 70.8" fill="none" stroke="${rojo}" stroke-width="1.8"/>
          <path d="M24.8 52.6 Q31.8 54.6 39 52.6 L39.2 56.2 Q31.8 58.2 24.6 56.2 Z" fill="${azul}"/>
          <path d="M26 54.8 Q31.8 56.4 38 54.8" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".8"/>
          <path d="M29.6 29 L33.4 29 L33.6 35.5 L29.4 35.5 Z" fill="${pielSombra}"/>
          <path d="M27.4 35 Q31.6 33.2 35.6 35 L35.1 37.6 Q31.4 36.2 27.9 37.6 Z" fill="${azul}"/>
          <path d="M28 22.5 L21.5 18 L27.4 26.8 Z" fill="${piel}"/>
          <path d="M26.6 21.5 Q26.6 13.6 33.8 13.6 Q40.2 14.4 40.2 21.6 Q40.2 27.2 37.2 30 Q34.2 32.2 31.2 31.2 Q27.8 29.4 26.6 21.5 Z" fill="${piel}"/>
          <path d="M26.6 21.5 Q27.8 29.4 31.2 31.2 Q29.2 27 30 21 Q29 17 27.5 17 Z" fill="${pielSombra}" stroke="none"/>
          <path d="M34.4 20.6 L39.2 20 L38.8 22.8 L34.9 23 Z" fill="#fff"/>
          <circle cx="37.7" cy="21.6" r=".75" fill="#1a0c05" stroke="none"/>
          <path d="M33.6 19.4 L39.8 18.2" fill="none" stroke-width="1.6"/>
          <path d="M40.2 23.4 L41 25 L40 25.4" fill="none" stroke-width=".8"/>
          <path d="M36.2 27.6 L38.4 27.3" fill="none" stroke-width=".9"/>
          <path d="M26.2 24.5 L21.6 15.5 L18.4 3 L24.8 9.6 L23.6 -1 L30.8 7.6 L34.2 0 L37 9.6 L42.6 5.2 L40.4 15.8 Q38.8 13.8 35.6 13.8 L32.8 17.2 L30.2 15 L28.2 20.4 Z" fill="#f2862a"/>
          <path d="M21.6 15.5 L18.4 3 L24.8 9.6 L27 18.4 Z M30.8 7.6 L34.2 0 L34.6 12 Z M37 9.6 L42.6 5.2 L39.4 12.6 Z" fill="#b85a1a" stroke="none"/>
          <path d="M25.6 9 L28.4 15.4 M32.2 5 L32.6 11.6" fill="none" stroke="#ffc27a" stroke-width=".9"/>
          <path d="M27.2 21 L23.6 27.6 L28.2 24.4 Z" fill="#f2862a"/>
          <g class="brazo">
            <path d="M22.6 49.6 L12.6 44.2 Q11.6 46.6 13.8 47.8 L22.4 52.4 Z" fill="#d9dcdf"/>
            <path d="M22.4 53 L11.8 50.6 Q11.4 53 13.8 53.8 L22.4 55.6 Z" fill="#d9dcdf"/>
            <path d="M14.4 46 L21.8 50.4 M14.2 51.8 L21.8 54" fill="none" stroke="#9aa0a4" stroke-width=".9"/>
            <path d="M26.4 38 Q23 43 23.6 49" fill="none" stroke="${L}" stroke-width="6.4"/>
            <path d="M26.4 38 Q23 43 23.6 49" fill="none" stroke="${piel}" stroke-width="4.4"/>
            <path d="M24.2 37.2 Q27.8 36.6 28.8 39.8 L25.6 41.4 Q24 40 23.4 38.6 Z" fill="${azul}"/>
            <path d="M21.4 48.4 L27.4 47.8 L27.8 55.6 L21.6 56.2 Z" fill="${rojo}"/>
            <path d="M21.4 48.4 L23 48.2 L23.2 56 L21.6 56.2 Z" fill="${rojoOscuro}" stroke="none"/>
            <path d="M21.8 56 Q21 60.6 24.8 61 Q28.6 61 28 56 Z" fill="${piel}"/>
            <path d="M23.2 58.4 L26.8 58.4" fill="none" stroke-width=".7"/>
          </g>
        </g>
      </svg>`;
    }

    // Un personaje chibi de Dofus mirando a la derecha: cabeza grande con
    // contorno oscuro, sombreado en el lado de atrás y lo propio de su clase.
    // Debajo, el círculo de su equipo: azul A, rojo B.
    function dofusSvg(c, lado) {
      const equipo = lado === 'a' ? '#3b82f6' : '#ef4444';
      // Prueba con el arte de Ankama: si el dueño ha puesto la imagen de esta
      // clase en su carpeta de datos, va esa en vez del dibujo. Todas miran a
      // la derecha, como los dibujos, así que el de la derecha se voltea igual.
      const arte = batalla.arte && batalla.arte.clases && batalla.arte.clases[c.clase];
      if (arte) {
        return `<svg viewBox="0 0 60 96" aria-hidden="true">
          <ellipse cx="30" cy="91" rx="19" ry="5" fill="${equipo}" fill-opacity=".22" stroke="${equipo}" stroke-width="1.8"/>
          <ellipse cx="31" cy="91" rx="13" ry="3" fill="#000" opacity=".3"/>
          <image href="${escapeHtml(arte)}" x="0" y="0" width="60" height="92" preserveAspectRatio="xMidYMax meet"/>
        </svg>`;
      }
      if (c.clase === 'Yopuka') return yopukaSvg(equipo);
      const a = ARTE_DOFUS[c.clase] || ARTE_DOFUS.Yopuka;
      const manga = a.manga || a.ropa;
      const L = '#2a1a12';   // el contorno, oscuro y cálido como en el juego
      const oreja = a.oreja === undefined
        ? `<ellipse cx="18.5" cy="30" rx="2.6" ry="3.6" fill="${a.piel}"/>
          <path d="M18.6 28 Q17.4 30 18.9 32" fill="none" stroke-width=".8"/>` : a.oreja;
      const boca = a.boca === undefined
        ? '<path d="M35.5 36 Q38 37.5 40.5 35.5" fill="none" stroke-width="1"/>' : a.boca;
      // Los brazos son un trazo grueso de contorno y otro fino de color encima.
      const brazo = (d) => `<path d="${d}" fill="none" stroke="${L}" stroke-width="6.6"/>
        <path d="${d}" fill="none" stroke="${manga}" stroke-width="4"/>`;
      const pantalon = a.pantalon || '#4b4038';
      // El puño de la manga, del color del ribete, pegado a la muñeca.
      const puno = (d) => `<path d="${d}" fill="none" stroke="${L}" stroke-width="6.4"/>
        <path d="${d}" fill="none" stroke="${a.ropa2}" stroke-width="4"/>`;
      // Proporciones de Dofus 2: unas tres cabezas y media de alto, piernas
      // largas con pantalón y botas grandes. La cabeza se dibuja en su propio
      // espacio (el de ARTE_DOFUS) y aquí se encoge y se sube encima del cuello.
      // La luz viene de arriba a la derecha: sombra a la izquierda, reflejo a
      // la derecha.
      return `<svg viewBox="0 0 60 96" aria-hidden="true">
        <ellipse cx="30" cy="91" rx="19" ry="5" fill="${equipo}" fill-opacity=".22" stroke="${equipo}" stroke-width="1.8"/>
        <ellipse cx="30" cy="91" rx="13" ry="3" fill="#000" opacity=".3"/>
        <g stroke="${L}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">
          ${a.detras || ''}
          ${brazo('M24 39 Q17 48 19 57')}
          ${puno('M18.4 53.2 L18.8 55.4')}
          <circle cx="19" cy="58" r="3.2" fill="${a.piel}"/>
          <path d="M24.5 60 L24 82 L30 82 L30.5 60 Z" fill="${pantalon}"/>
          <path d="M31.5 60 L32.5 82 L38.5 82 L37.5 60 Z" fill="${pantalon}"/>
          <path d="M24.5 62 L24.2 80 L26.8 80 L27.2 62 Z" fill="#000" opacity=".15" stroke="none"/>
          <path d="M26 71 Q27.5 72 29.5 71 M33.5 71 Q35.2 72 37.3 71" fill="none" stroke="#000" stroke-opacity=".3" stroke-width=".8"/>
          <path d="M23 79 L23 88 Q23 92 28 92 L32 92 Q33.5 89 30.5 87.5 L30.8 79 Z" fill="${a.botas}"/>
          <path d="M32 79 L32.3 88 Q32.5 92 37.5 92 L43 92 Q44 88.5 39.5 87.5 L39 79 Z" fill="${a.botas}"/>
          <path d="M22.6 78.6 H31.3 V81.8 H22.6 Z M31.6 78.6 H39.5 V81.8 H31.6 Z" fill="${a.botas}"/>
          <path d="M22.8 78.9 H31 V80.2 H22.8 Z M31.9 78.9 H39.2 V80.2 H31.9 Z" fill="#fff" opacity=".22" stroke="none"/>
          <ellipse cx="40" cy="89.3" rx="2" ry="1" fill="#fff" opacity=".3" stroke="none"/>
          <path d="M23.5 91.3 H32 M33 91.3 H43" stroke="#140d08" stroke-width="1.5"/>
          <path d="M22 38 Q30 34 38 38 L41 62 Q30 66 19 62 Z" fill="${a.ropa}"/>
          <path d="M22 38 Q24.5 36.8 27 36.4 L25.5 64.5 Q21.5 63.8 19 62 Z" fill="#000" opacity=".16" stroke="none"/>
          <path d="M37.5 39 Q39.5 48 40.4 58" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.2"/>
          <path d="M28 44 Q27 50 28.5 53 M34 43 Q35 48 34 53 M26 57.5 L25.2 62 M35 57.5 L36 62.5" fill="none" stroke="#000" stroke-opacity=".22" stroke-width=".8"/>
          <path d="M19.3 59.6 Q30 63.6 40.7 59.6 L41 62 Q30 66 19 62 Z" fill="${a.ropa2}" opacity=".85"/>
          <path d="M26 36.5 L30.5 42.5 L34.5 36.5" fill="none" stroke-width="1"/>
          <path d="M20 53 Q30 56 40.2 53 L40.6 56.5 Q30 59.5 19.6 56.5 Z" fill="${a.ropa2}"/>
          <rect x="28.3" y="53.3" width="4.4" height="3.8" rx=".8" fill="#e8c35a"/>
          ${a.cuerpo || ''}
          <path d="M28 29 L28 37 L33.5 37 L33.5 29 Z" fill="${a.piel}"/>
          <path d="M28 29 L33.5 29 L33.5 32 Q30.7 33.6 28 32 Z" fill="#000" opacity=".15" stroke="none"/>
          <g transform="translate(31 20) scale(.78) translate(-31 -28)">
            ${a.detrasCabeza || ''}
            ${oreja}
            <ellipse cx="31" cy="28" rx="15" ry="14" fill="${a.piel}"/>
            <path d="M19 20 Q16 28 19 36 Q22 41 28 42 Q20 36 21 27 Z" fill="#000" opacity=".1" stroke="none"/>
            ${a.cara || ''}
            ${a.ojos || ojosDofus(a.iris || '#6b4423')}
            ${a.sinNariz ? '' : '<path d="M43 29.5 Q44.6 31.4 42.7 32.2" fill="none" stroke-width=".9"/>'}
            ${a.sinRubor ? '' : '<ellipse cx="39.5" cy="33.5" rx="2.6" ry="1.5" fill="#f87171" opacity=".35" stroke="none"/>'}
            ${boca}
            ${a.pelo || ''}
          </g>
          <g class="brazo">
            ${a.arma || ''}
            ${brazo('M37 39 Q43 47 44 55')}
            ${puno('M43.3 51.4 L43.8 53.6')}
            <circle cx="44.5" cy="57" r="3.3" fill="${a.piel}"/>
            <path d="M42.6 56 Q44 55 45.6 56" fill="none" stroke-width=".7"/>
            ${a.armaDelante || ''}
          </g>
        </g>
      </svg>`;
    }

    // Cuenta la ronda golpe a golpe: los muñecos se pegan, las barras de vida bajan y el relato va
    // saliendo debajo. Quien ha ganado ya lo decidió el servidor; esto solo lo
    // enseña. Devuelve una promesa que acaba cuando termina el último duelo.
    // Con «cuales» se cuentan solo esos combates (los que se acaban de pelear);
    // sin ello, los de toda la ronda. Es lo que evita que al soltar uno suelto
    // se vuelvan a contar los que ya se habían visto.
    // «cuadro» dice donde se cuenta: el del torneo o el del rey de la colina,
    // que pelea con las mismas reglas y se dibuja igual.
    function contarRonda(ronda, indiceRonda, cuales, idCuadro) {
      const cuadro = document.getElementById(idCuadro || 'batallaCuadro');
      // Ya no hay relato suelto: cada duelo cuenta el suyo dentro de su propia
      // caja, pegado a la pelea que esta contando.
      const cuenta = (di) => !cuales || cuales.includes(di);

      const conPelea = ronda.duelos.filter((d, di) => cuenta(di) && d.b && d.golpes && d.golpes.length);
      if (!conPelea.length) return Promise.resolve();

      // Todos los duelos a la vez, para que no se haga eterno con mucha gente.
      const RITMO = 700;
      const masLargo = Math.max(...conPelea.map((d) => d.golpes.length));

      ronda.duelos.forEach((d, di) => {
        if (!cuenta(di) || !d.b || !d.golpes || !d.golpes.length) return;
        const caja = cuadro.querySelector(`.duelo[data-ronda="${indiceRonda}"][data-duelo="${di}"]`);
        if (!caja) return;
        caja.classList.add('peleando');
        const barras = {
          a: caja.querySelector('.vida i[data-lado="a"]'),
          b: caja.querySelector('.vida i[data-lado="b"]')
        };
        const rastros = {
          a: caja.querySelector('.vida .rastro[data-lado="a"]'),
          b: caja.querySelector('.vida .rastro[data-lado="b"]')
        };
        const texto = caja.querySelector('.golpe');
        const munecos = {
          a: caja.querySelector('.muneco.lado-a'),
          b: caja.querySelector('.muneco.lado-b')
        };
        const ring = caja.querySelector('.ring');
        const fx = caja.querySelector('.fx');
        // Un efecto suelto encima del ring (estrella, daño, letrero) que se
        // borra solo cuando acaba su animación.
        const efecto = (clase, contenido, lado, dura = 900) => {
          if (!fx) return;
          const s = document.createElement('span');
          s.className = clase;
          if (lado) s.dataset.lado = lado;
          s.textContent = contenido;
          fx.appendChild(s);
          setTimeout(() => s.remove(), dura);
        };
        efecto('letrero pelear', '¡COMBATE!', null, 700);
        // El log de este duelo, dentro de su misma caja.
        const lineas = caja.querySelector('.lineas');
        if (lineas) lineas.innerHTML = '';
        const apunta = (texto, clase) => {
          if (!lineas) return;
          const linea = document.createElement('div');
          if (clase) linea.className = clase;
          linea.textContent = texto;
          lineas.appendChild(linea);
          // Cada duelo sigue lo suyo, sin arrastrar a los demas.
          lineas.scrollTop = lineas.scrollHeight;
        };
        // Cada combate se anuncia en el suyo, con la clase de cada uno.
        apunta(`${d.a} (${claseDe(d.a).clase}) contra ${d.b} (${claseDe(d.b).clase}).`, 'lidera');
        // Reiniciar la animación pide sacar la clase, forzar el repintado y
        // volver a ponerla: si no, el segundo golpe seguido no se ve.
        const mover = (quien, como) => {
          if (!quien) return;
          quien.classList.remove('pega', 'recibe', 'esquiva');
          void quien.offsetWidth;
          quien.classList.add(como);
          setTimeout(() => quien.classList.remove(como), 320);
        };

        d.golpes.forEach((g, i) => {
          setTimeout(() => {
            const pinta = (lado, vida) => {
              const barra = barras[lado];
              barra.style.width = vida + '%';
              barra.classList.toggle('poca', vida <= 50 && vida > 20);
              barra.classList.toggle('critica', vida <= 20);
              if (rastros[lado]) rastros[lado].style.width = vida + '%';
            };
            pinta('a', g.vidaA);
            pinta('b', g.vidaB);
            const pega = g.quien === d.a ? 'a' : 'b';
            const encaja = pega === 'a' ? 'b' : 'a';
            // El hechizo que lanza en este golpe.
            const h = hechizoDe(g.quien, i);
            mover(munecos[pega], 'pega');
            mover(munecos[encaja], g.fallo ? 'esquiva' : 'recibe');
            // La barra del que encaja da un fogonazo, como en Mortal Kombat.
            if (!g.fallo && barras[encaja]) {
              const cajaVida = barras[encaja].parentElement;
              cajaVida.classList.remove('golpeada');
              void cajaVida.offsetWidth;
              cajaVida.classList.add('golpeada');
            }
            if (munecos[pega]) munecos[pega].classList.toggle('furioso', !!g.furia);

            // Lo que se ve encima del ring: la estrella y el daño en el que
            // recibe, y un letrero si el golpe tiene algo especial.
            if (g.fallo) {
              efecto('letrero fallo', '¡ESQUIVA!');
            } else {
              const fuerte = g.critico || g.furia;
              efecto('hechizo ' + (pega === 'a' ? 'ab' : 'ba'), EMOJI_ELEMENTO[h.elemento], null, 400);
              efecto('dano' + (fuerte ? ' fuerte' : '') + ' ' + h.elemento, `−${g.dano}`, encaja);
              if (g.aguanta) efecto('letrero aguanta', '¡RESISTE!', null, 1100);
              else if (g.critico) efecto('letrero critico', '¡GOLPE CRÍTICO!');
              else if (g.furia) efecto('letrero furia', '¡SE CRECE!');
              if (g.critico && ring) {
                ring.classList.remove('temblor');
                void ring.offsetWidth;
                ring.classList.add('temblor');
              }
            }
            texto.innerHTML = g.fallo
              ? `${escapeHtml(g.quien)} lanza ${escapeHtml(h.nombre)}: ¡${escapeHtml(g.a)} lo esquiva!`
              : `${escapeHtml(g.quien)} lanza ${escapeHtml(h.nombre)}` +
                ` <span class="pum">${escapeHtml(g.a)}: −${g.dano} PdV${g.critico ? ' ¡Golpe crítico!' : ''}</span>`;

            // Como el chat de combate del juego: quién lanza qué, y cuántos
            // PdV pierde el otro. Lo mismo que se guarda para Combates.
            const cae = i === d.golpes.length - 1;
            const linea = lineaDeGolpe(g, d, i, cae);
            apunta(linea.texto, linea.clase);

            if (cae) {
              caja.classList.remove('peleando');
              // El que se queda sin vida se va al suelo.
              if (munecos[encaja]) munecos[encaja].classList.add('cae');
              // ¡Victoria! en grande y el ganador lo celebra.
              if (munecos[pega]) munecos[pega].classList.remove('furioso');
              if (munecos[pega]) munecos[pega].classList.add('celebra');
              efecto('letrero victoria', '¡VICTORIA!', null, 1800);
              // Y un momento despues el recuadro se encoge: ya solo importa
              // quien pasa de ronda.
              // Al pintar el duelo todavia no habia ganador, asi que los
              // nombres no llevaban marca: se les pone ahora, que es lo unico
              // que va a quedar a la vista.
              const lados = caja.querySelectorAll('.lado');
              if (lados[0]) lados[0].className = 'lado ' + (pega === 'a' ? 'gana' : 'pierde');
              if (lados[1]) lados[1].className = 'lado ' + (pega === 'b' ? 'gana' : 'pierde');
              // Se deja ver la victoria antes de encoger el recuadro.
              setTimeout(() => caja.classList.add('resuelto'), 1700);
            }
          }, (i + 1) * RITMO);
        });
      });

      // Se espera a que la última victoria se haya visto y su recuadro encogido:
      // al acabar se repinta el cuadro, y se lo llevaría por delante.
      return new Promise((listo) => setTimeout(listo, masLargo * RITMO + 1800));
    }
