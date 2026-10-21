// La pestaña de Objetivos: la checklist del directo. Se añaden, se marcan, se
// reordenan y se quitan; el widget de OBS enseña lo mismo al momento, salvo el
// orden, que se prepara en el navegador y sale al pulsar «Guardar orden».
//
// Va como carpetas: cada objetivo puede tener otros dentro, sin límite, que se
// pliegan y despliegan, y cualquiera se arrastra (por su asa ⠿) a otro sitio:
// soltarlo en el centro de otra fila lo mete dentro; en su borde de arriba o
// de abajo, lo deja delante o detrás.
//
// Script normal, sin modulo, como los demás paneles: usa api(), showAlert(),
// showConfirm() y showModal() de index.html.

    // Lo que dijo el servidor. Lo que se ve es esto con el borrador del orden
    // encima, si hay. Ver objetivos-local.js.
    let objetivos = { titulo: '', objetivos: [] };
    const OL = globalThis.ObjetivosLocal;

    async function cargarObjetivos() {
      orden = leerBorrador();
      // Con algo de camino, lo que contestara ahora se quedaría viejo: ya
      // pintará la fila cuando acabe.
      if (colaObjetivos.ocupada()) return;
      try {
        objetivos = await api('/api/objetivos');
        pintarObjetivos();
      } catch (e) {
        if (!e.datos) reportarFallo('objetivos cargar', e);
        document.getElementById('objetivosEstado').textContent = 'Error: ' + e.message;
      }
    }

    // Lo que va al servidor en el momento, de uno en uno. Todas las rutas
    // devuelven la lista entera, y se pinta la del último.
    let pintarAlSoltar = false;
    const colaObjetivos = OL.crearCola({
      enviar: (ruta, cuerpo) => api(ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo || {})
      }),
      alTerminar: (lista) => {
        // Los Dofus llevan su propia fila: si aún va alguno, lo de la pantalla
        // es más nuevo que esto.
        if (dofusEnCola > 0) lista = { ...lista, dofus: objetivos.dofus };
        objetivos = lista;
        // Repintar a mitad de un arrastre lo cortaría.
        if (arrastrando) pintarAlSoltar = true; else pintarObjetivos();
      },
      alFallar: (e) => {
        // Los fallos del servidor ya los apunta él; los de pintar, no.
        if (!e.datos) reportarFallo('objetivos', e);
        showAlert('Objetivos', e.message);
        cargarObjetivos();
      }
    });

    function objetivosPedir(ruta, cuerpo) {
      // Lo que se puede, se ve ya; el servidor se entera detrás y su respuesta
      // corrige lo que haga falta. Ver adelantar() en objetivos-local.js.
      const adelantada = OL.adelantar(objetivos.objetivos, ruta, cuerpo);
      if (adelantada) {
        objetivos = { ...objetivos, objetivos: adelantada };
        pintarEnSeguida();
      }
      return colaObjetivos.poner(ruta, cuerpo);
    }

    // Un momento después, no ya: al corregir un texto esto sale de su «blur»,
    // cuando el navegador todavía no ha puesto el foco en lo siguiente que se
    // pinchó. Repintar ahí se llevaba ese campo; un instante después ya tiene
    // el foco y pintarObjetivos() lo conserva. Varios seguidos, un solo pintado.
    let pintadoPendiente = false;
    function pintarEnSeguida() {
      if (pintadoPendiente) return;
      pintadoPendiente = true;
      setTimeout(() => {
        pintadoPendiente = false;
        if (arrastrando) pintarAlSoltar = true; else pintarObjetivos();
      }, 0);
    }

    // --- El borrador del orden ----------------------------------------------
    // Subir, bajar y arrastrar solo cambian esto, en el navegador. «Guardar»
    // manda dónde ha quedado cada uno, en una sola petición.

    let orden = null;

    function claveBorrador() {
      return 'ruleton-objetivos-orden:' + ((typeof usuario !== 'undefined' && usuario && usuario.id) || '');
    }
    function leerBorrador() {
      try {
        const b = JSON.parse(localStorage.getItem(claveBorrador()) || 'null');
        return Array.isArray(b) ? b : null;
      } catch (e) { return null; }
    }
    function guardarBorrador() {
      try {
        if (orden) localStorage.setItem(claveBorrador(), JSON.stringify(orden));
        else localStorage.removeItem(claveBorrador());
      } catch (e) { /* sin almacenamiento: se queda en memoria hasta recargar */ }
    }

    // Lo que se ve: lo guardado, colocado como dice el borrador.
    function vista() {
      const lista = objetivos.objetivos || [];
      return orden ? OL.aplicarOrden(lista, orden) : lista;
    }

    // Para empezar a ordenar se parte de lo que se ve.
    function ordenEditable() {
      if (!orden) orden = OL.forma(vista());
      return orden;
    }

    function despuesDeOrdenar() {
      guardarBorrador();
      pintarObjetivos();
    }

    async function guardarOrden() {
      if (!orden) return true;
      const enviado = OL.forma(vista());
      const ok = await objetivosPedir('/api/objetivos/ordenar', { arbol: enviado });
      if (ok) {
        // Si mientras iba se siguió ordenando, eso aún está por guardar.
        if (orden && OL.mismaForma(OL.forma(vista()), enviado)) orden = null;
        despuesDeOrdenar();
      }
      return ok;
    }

    function descartarOrden() {
      orden = null;
      despuesDeOrdenar();
    }

    // Las carpetas plegadas. Es solo cómo se ve esta pestaña, así que se
    // recuerda en el navegador y no en el servidor.
    const CLAVE_CERRADOS = 'ruleton-objetivos-cerrados';
    const cerrados = new Set((() => {
      try { return JSON.parse(localStorage.getItem(CLAVE_CERRADOS) || '[]'); } catch (e) { return []; }
    })());
    function guardarCerrados() {
      try { localStorage.setItem(CLAVE_CERRADOS, JSON.stringify(Array.from(cerrados))); } catch (e) { /* da igual */ }
    }

    // Los que tienen abierto el campo de «+ Sub», para que siga abierto al
    // repintar aunque todavía no tengan nada dentro.
    const abiertos = new Set();

    // Lo que se está arrastrando, y él con todo lo suyo: ahí no se puede soltar.
    let arrastrando = null;
    let prohibidos = new Set();

    function idsDe(nodo, ids = new Set()) {
      ids.add(nodo.id);
      (nodo.subs || []).forEach((s) => idsDe(s, ids));
      return ids;
    }

    function cuentaHechos(nodo) {
      return (nodo.subs || []).filter((s) => s.hecho).length + '/' + (nodo.subs || []).length;
    }

    // Las filas ya hechas, con lo que enseñan («firma»). Antes la lista se
    // rehacía entera a cada clic, cada fila con sus botones y sus eventos: con
    // cientos de objetivos eso eran decenas de miles de elementos dos veces
    // por clic (al adelantarse y al contestar el servidor), y la página se
    // quedaba congelada. Ahora solo se rehace la fila que cambia; las demás se
    // quedan, o como mucho se cambian de sitio.
    //
    //   'o:<id>'  la fila de un objetivo
    //   'a:<id>'  el campo de añadir dentro de ese
    const filas = new Map();
    // Lo pintado, por id. Los eventos no van en cada fila sino en la caja, y
    // de aquí sacan de cuál se trata.
    let pintados = new Map();

    const cajaObjetivos = document.getElementById('objetivosLista');

    function pintarObjetivos() {
      const lista = vista();
      // Un borrador que ya coincide con lo guardado no es nada por guardar.
      if (orden && OL.mismaForma(lista, objetivos.objetivos || [])) { orden = null; guardarBorrador(); }
      document.getElementById('objetivosBorrador').hidden = !orden;
      const hechos = lista.filter((o) => o.hecho).length;
      const enProceso = lista.filter((o) => o.proceso).length;
      const titulo = document.getElementById('objetivosTitulo');
      if (document.activeElement !== titulo) titulo.value = objetivos.titulo || '';
      document.getElementById('objetivosEstado').textContent = lista.length
        ? hechos + ' de ' + lista.length + ' hechos · ' + enProceso + ' en proceso'
          + (enProceso ? '' : ' (el widget no sale hasta que pongas alguno ▶ en proceso)')
        : 'Sin objetivos todavía.';
      document.getElementById('objetivosDesmarcar').disabled = !hechos && !enProceso;
      document.getElementById('objetivosAgrupar').disabled = !hechos;
      document.getElementById('objetivosVaciar').disabled = !lista.length;

      const caja = cajaObjetivos;
      // La fila del campo en el que se estaba escribiendo puede rehacerse (o
      // moverse, que también le quita el foco). Se apunta cuál era, con lo
      // escrito y el cursor, para volver a ponerlo: si no, al salir de un texto
      // (que lo guarda) y pinchar en el siguiente, la respuesta se llevaba el
      // foco y lo que se empezaba a escribir.
      const activo = document.activeElement;
      let foco = null;
      if (activo && caja.contains(activo) && activo.tagName === 'INPUT') {
        const fila = activo.closest('.objetivo, .objetivo-anadir');
        if (fila) {
          foco = {
            selector: fila.classList.contains('objetivo')
              ? '.objetivo[data-id="' + fila.dataset.id + '"] input.' + activo.classList[0]
              : '.objetivo-anadir[data-padre="' + fila.dataset.padre + '"] input',
            texto: activo.type === 'text' ? activo.value : null,
            desde: activo.type === 'text' ? activo.selectionStart : null,
            hasta: activo.type === 'text' ? activo.selectionEnd : null
          };
        }
      }

      const quedan = [];
      const usadas = new Set();
      pintados = new Map();
      pintarNivel(quedan, usadas, lista, 0);
      quedan.push(raizSoltar);
      colocarFilas(caja, quedan);
      for (const clave of filas.keys()) if (!usadas.has(clave)) filas.delete(clave);

      if (foco && document.activeElement !== activo) {
        const campo = caja.querySelector(foco.selector);
        if (campo) {
          if (foco.texto !== null) campo.value = foco.texto;
          campo.focus();
          if (foco.desde !== null) { try { campo.setSelectionRange(foco.desde, foco.hasta); } catch (e) { /* da igual */ } }
        }
      }

      pintarDofus();
    }

    // Deja en la caja esos elementos y en ese orden, tocando solo lo que no
    // está ya en su sitio.
    function colocarFilas(caja, quedan) {
      let ref = caja.firstChild;
      for (const el of quedan) {
        if (el === ref) ref = ref.nextSibling;
        else caja.insertBefore(el, ref);
      }
      while (ref) {
        const sig = ref.nextSibling;
        caja.removeChild(ref);
        ref = sig;
      }
    }

    // La fila guardada si sigue enseñando lo mismo; si no, una nueva.
    function deCache(usadas, clave, firma, hacer) {
      usadas.add(clave);
      const hay = filas.get(clave);
      if (hay && hay.firma === firma) return hay.el;
      const el = hacer();
      filas.set(clave, { el, firma });
      return el;
    }

    // Una fila por cada uno, sangrada según lo hondo que esté, y debajo lo que
    // lleve dentro si la carpeta está abierta.
    function pintarNivel(quedan, usadas, nodos, nivel) {
      nodos.forEach((o, i) => {
        pintados.set(o.id, { o, principal: nivel === 0 });
        quedan.push(filaObjetivo(usadas, o, nivel, i, nodos.length));
        const hijos = o.subs || [];
        if (hijos.length && !cerrados.has(o.id)) pintarNivel(quedan, usadas, hijos, nivel + 1);
        if (abiertos.has(o.id)) quedan.push(filaAnadir(usadas, o, nivel + 1));
      });
    }

    const moldeFila = document.createElement('template');
    moldeFila.innerHTML = '<div class="objetivo">'
      + '<span class="asa" draggable="true" title="Arrastra para moverlo: al centro de otro lo mete dentro, a su borde lo pone delante o detrás">⠿</span>'
      + '<button type="button" class="plegar"></button>'
      + '<input type="checkbox" class="marca" />'
      + '<input type="text" class="texto" maxlength="140" />'
      + '<span class="cuenta-subs"></span>'
      + '<button type="button" class="mini en-proceso"></button>'
      + '<button type="button" class="mini mas-sub" title="Añadir uno dentro">+ Sub</button>'
      + '<button type="button" class="mini subir" title="Subir">▲</button>'
      + '<button type="button" class="mini bajar" title="Bajar">▼</button>'
      + '<button type="button" class="mini quitar" title="Quitar, con todo lo que tenga dentro">✕</button>'
      + '</div>';

    function filaObjetivo(usadas, o, nivel, i, total) {
      const hijos = o.subs || [];
      const abierta = !cerrados.has(o.id);
      // El puesto no va en la firma: al subir uno, o añadir al final, se
      // rehacían todos sus hermanos. Lo que depende de él se pone abajo.
      const firma = JSON.stringify([o.texto, o.hecho, Boolean(o.proceso), nivel,
        hijos.length ? cuentaHechos(o) : '', abierta]);
      const fila = deCache(usadas, 'o:' + o.id, firma, () => hacerFila(o, nivel, hijos, abierta));
      const p = fila.partes;
      // Lo que se marcó o escribió y no llegó a guardarse (falló) vuelve a lo
      // que hay. El que se está escribiendo no se toca.
      p.marca.checked = o.hecho;
      if (document.activeElement !== p.texto && p.texto.value !== o.texto) p.texto.value = o.texto;
      p.texto.setAttribute('aria-label', (nivel === 0 ? 'Objetivo ' : 'Sub-objetivo ') + (i + 1));
      p.subir.disabled = i === 0;
      p.bajar.disabled = i === total - 1;
      return fila;
    }

    function hacerFila(o, nivel, hijos, abierta) {
      const principal = nivel === 0;
      const fila = moldeFila.content.firstElementChild.cloneNode(true);
      fila.className = 'objetivo' + (o.hecho ? ' hecho' : '') + (o.proceso ? ' proceso' : '') + (principal ? '' : ' dentro');
      fila.style.marginLeft = (nivel * 1.6) + 'rem';
      fila.dataset.id = o.id;

      // Plegar y desplegar, solo si tiene algo dentro.
      const plegar = fila.querySelector('.plegar');
      if (hijos.length) {
        plegar.textContent = abierta ? '▾' : '▸';
        plegar.title = abierta ? 'Plegar' : 'Desplegar';
        fila.querySelector('.cuenta-subs').textContent = cuentaHechos(o);
      } else {
        plegar.classList.add('vacio');
        plegar.tabIndex = -1;
      }

      const marca = fila.querySelector('.marca');
      marca.setAttribute('aria-label', 'Hecho: ' + o.texto);

      // Lo que sale en el widget: solo los de la lista principal en proceso.
      const proceso = fila.querySelector('.en-proceso');
      if (principal) {
        proceso.textContent = o.proceso ? '▶ En proceso' : '▶';
        proceso.title = o.proceso ? 'Quitar del widget' : 'Poner en proceso: sale en el widget';
        proceso.setAttribute('aria-pressed', o.proceso ? 'true' : 'false');
      } else {
        proceso.remove();
      }

      const texto = fila.querySelector('.texto');
      texto.value = o.texto;
      fila.partes = { marca, texto, subir: fila.querySelector('.subir'), bajar: fila.querySelector('.bajar') };
      return fila;
    }

    // El campo para meter uno dentro de `padre`, en su sitio del árbol.
    function filaAnadir(usadas, padre, nivel) {
      return deCache(usadas, 'a:' + padre.id, JSON.stringify([padre.texto, nivel]), () => {
        const fila = document.createElement('div');
        fila.className = 'objetivo-anadir';
        fila.dataset.padre = padre.id;
        fila.style.marginLeft = (nivel * 1.6) + 'rem';
        fila.innerHTML = '<input type="text" class="texto" maxlength="140" placeholder="Nuevo dentro de «' + escapeHtml(padre.texto) + '» (Enter para añadir, Esc para cerrar)" />';
        fila.querySelector('input').setAttribute('aria-label', 'Nuevo sub-objetivo de ' + padre.texto);
        return fila;
      });
    }

    // Donde se suelta para sacarlo a la lista principal. Solo se ve mientras
    // se arrastra algo.
    const raizSoltar = document.createElement('div');
    raizSoltar.className = 'objetivos-raiz';
    raizSoltar.textContent = 'Suelta aquí para sacarlo a la lista principal';

    // --- Lo que se hace en la lista -------------------------------------------
    // Todo en la caja y no en cada fila: así una fila nueva no lleva diez
    // eventos suyos, y la que se reutiliza no se queda con los de antes.

    // La fila (y lo pintado) de donde vino un evento.
    function filaDe(el) {
      const fila = el && el.closest && el.closest('.objetivo');
      const d = fila && pintados.get(fila.dataset.id);
      return d ? { fila, o: d.o, principal: d.principal } : null;
    }

    // Solo en el borrador: no sale nada hasta «Guardar».
    function subirBajar(id, hacia, clase) {
      if (!OL.subirBajar(ordenEditable(), id, hacia)) return;
      despuesDeOrdenar();
      // El foco sigue al que se movió, para poder seguir pulsando.
      const b = document.querySelector('.objetivo[data-id="' + id + '"] .' + clase);
      if (b && !b.disabled) b.focus();
    }

    cajaObjetivos.addEventListener('click', (ev) => {
      const boton = ev.target.closest('button');
      const d = boton && filaDe(boton);
      if (!d) return;
      const o = d.o;
      const es = (clase) => boton.classList.contains(clase);
      if (es('plegar')) {
        if (!(o.subs || []).length) return;
        if (cerrados.has(o.id)) cerrados.delete(o.id); else cerrados.add(o.id);
        guardarCerrados();
        pintarObjetivos();
      } else if (es('en-proceso')) {
        objetivosPedir('/api/objetivos/cambiar', { id: o.id, proceso: !o.proceso });
      } else if (es('mas-sub')) {
        abiertos.add(o.id);
        cerrados.delete(o.id);
        guardarCerrados();
        pintarObjetivos();
        const campo = document.querySelector('.objetivo-anadir[data-padre="' + o.id + '"] input');
        if (campo) campo.focus();
      } else if (es('subir')) {
        subirBajar(o.id, -1, 'subir');
      } else if (es('bajar')) {
        subirBajar(o.id, 1, 'bajar');
      } else if (es('quitar')) {
        objetivosPedir('/api/objetivos/quitar', { id: o.id });
      }
    });

    cajaObjetivos.addEventListener('change', (ev) => {
      if (!ev.target.classList.contains('marca')) return;
      const d = filaDe(ev.target);
      if (d) objetivosPedir('/api/objetivos/cambiar', { id: d.o.id, hecho: ev.target.checked });
    });

    // El texto se corrige ahí mismo: se guarda al salir o con Enter, y Escape
    // lo deja como estaba.
    cajaObjetivos.addEventListener('keydown', async (ev) => {
      const campo = ev.target;
      const anadir = campo.closest && campo.closest('.objetivo-anadir');
      if (anadir) {
        const padre = anadir.dataset.padre;
        if (ev.key === 'Escape') { abiertos.delete(padre); pintarObjetivos(); return; }
        if (ev.key !== 'Enter') return;
        const t = campo.value.trim();
        if (!t) return;
        if (await objetivosPedir('/api/objetivos', { texto: t, padre })) {
          const otra = document.querySelector('.objetivo-anadir[data-padre="' + padre + '"] input');
          if (otra) {
            // Listo para el siguiente, salvo que ya se esté escribiendo otro.
            if (otra.value.trim() === t) otra.value = '';
            otra.focus();
          }
        }
        return;
      }
      if (!campo.classList.contains('texto')) return;
      const d = filaDe(campo);
      if (!d) return;
      if (ev.key === 'Enter') campo.blur();
      if (ev.key === 'Escape') { campo.value = d.o.texto; campo.blur(); }
    });

    cajaObjetivos.addEventListener('focusout', (ev) => {
      const campo = ev.target;
      if (!campo.classList.contains('texto')) return;
      const d = filaDe(campo);
      if (!d) return;
      const nuevo = campo.value.trim();
      if (nuevo === d.o.texto) return;
      if (!nuevo) { campo.value = d.o.texto; return; }
      objetivosPedir('/api/objetivos/cambiar', { id: d.o.id, texto: nuevo });
    });

    // Arrastrar como en las carpetas: se coge por el asa y se suelta encima
    // de otra fila. El tercio del medio la mete dentro; los bordes, delante o
    // detrás de ella.
    cajaObjetivos.addEventListener('dragstart', (ev) => {
      if (!ev.target.classList || !ev.target.classList.contains('asa')) return;
      const d = filaDe(ev.target);
      if (!d) return;
      arrastrando = d.o.id;
      prohibidos = idsDe(d.o);
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', d.o.id); } catch (e) { /* algunos navegadores */ }
      try { ev.dataTransfer.setDragImage(d.fila, 20, 16); } catch (e) { /* sin imagen, la del asa */ }
      cajaObjetivos.classList.add('arrastrando');
      d.fila.classList.add('cogido');
    });
    cajaObjetivos.addEventListener('dragend', terminarArrastre);

    cajaObjetivos.addEventListener('dragover', (ev) => {
      if (!arrastrando) return;
      if (ev.target.closest('.objetivos-raiz')) {
        ev.preventDefault();
        raizSoltar.classList.add('encima');
        return;
      }
      const d = filaDe(ev.target);
      if (!d || prohibidos.has(d.o.id)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const zona = zonaDe(d.fila, ev);
      d.fila.classList.toggle('soltar-antes', zona === 'antes');
      d.fila.classList.toggle('soltar-dentro', zona === 'dentro');
      d.fila.classList.toggle('soltar-despues', zona === 'despues');
    });

    cajaObjetivos.addEventListener('dragleave', (ev) => {
      const el = ev.target.closest && ev.target.closest('.objetivo, .objetivos-raiz');
      if (el) el.classList.remove('soltar-antes', 'soltar-dentro', 'soltar-despues', 'encima');
    });

    cajaObjetivos.addEventListener('drop', (ev) => {
      if (!arrastrando) return;
      if (ev.target.closest('.objetivos-raiz')) {
        ev.preventDefault();
        const id = arrastrando;
        terminarArrastre();
        if (OL.llevar(ordenEditable(), id, '', 'dentro')) despuesDeOrdenar();
        return;
      }
      const d = filaDe(ev.target);
      if (!d || prohibidos.has(d.o.id)) return;
      ev.preventDefault();
      const id = arrastrando;
      const como = zonaDe(d.fila, ev);
      terminarArrastre();
      // Al meterlo dentro, la carpeta se abre para que se vea dónde quedó.
      if (como === 'dentro') { cerrados.delete(d.o.id); guardarCerrados(); }
      if (OL.llevar(ordenEditable(), id, d.o.id, como)) despuesDeOrdenar();
    });

    function zonaDe(fila, ev) {
      const caja = fila.getBoundingClientRect();
      const y = (ev.clientY - caja.top) / (caja.height || 1);
      return y < 0.3 ? 'antes' : y > 0.7 ? 'despues' : 'dentro';
    }

    function terminarArrastre() {
      arrastrando = null;
      prohibidos = new Set();
      cajaObjetivos.classList.remove('arrastrando');
      cajaObjetivos.querySelectorAll('.cogido, .soltar-antes, .soltar-dentro, .soltar-despues, .encima').forEach((el) => {
        el.classList.remove('cogido', 'soltar-antes', 'soltar-dentro', 'soltar-despues', 'encima');
      });
      // Lo que llegó del servidor mientras se arrastraba.
      if (pintarAlSoltar) { pintarAlSoltar = false; pintarObjetivos(); }
    }

    // Los trece Dofus, siempre todos: un clic lo marca como conseguido y otro
    // lo desmarca. Es lo que enseña la tira del widget de Dofus.
    //
    // Los botones se hacen una vez y luego solo se les cambia la clase: antes se
    // rehacían todos (con sus imágenes) a cada clic, y el huevo no cambiaba
    // hasta que contestaba el servidor. Ahora cambia al pulsar y el servidor
    // se entera detrás.
    const botonesDofus = new Map();

    function pintarDofus() {
      const dofus = objetivos.dofus || [];
      const tiene = dofus.filter((d) => d.conseguido).length;
      document.getElementById('dofusEstado').textContent = tiene + ' de ' + dofus.length + ' conseguidos';
      const caja = document.getElementById('dofusLista');
      if (botonesDofus.size !== dofus.length) {
        caja.innerHTML = '';
        botonesDofus.clear();
        dofus.forEach((d) => {
          const boton = document.createElement('button');
          boton.type = 'button';
          boton.className = 'dofus-huevo';
          const img = document.createElement('img');
          img.src = d.imagen;
          img.alt = '';
          img.onerror = () => { img.style.visibility = 'hidden'; };
          const nombre = document.createElement('span');
          nombre.textContent = d.texto;
          boton.append(img, nombre);
          boton.addEventListener('click', () => alternarDofus(d.id));
          botonesDofus.set(d.id, boton);
          caja.appendChild(boton);
        });
      }
      dofus.forEach((d) => {
        const boton = botonesDofus.get(d.id);
        if (!boton) return;
        boton.classList.toggle('hecho', d.conseguido);
        boton.setAttribute('aria-pressed', d.conseguido ? 'true' : 'false');
        boton.title = d.conseguido ? d.texto + ': conseguido (clic para desmarcar)' : d.texto + ': clic cuando lo consigas';
      });
    }

    // Los clics van en fila al servidor, para que lleguen en orden; y lo que
    // conteste solo se pinta cuando ya no queda ninguno por mandar: si no, la
    // respuesta del primero desharía en pantalla el segundo clic.
    let dofusEnCola = 0;
    let dofusFila = Promise.resolve();

    function alternarDofus(id) {
      const d = (objetivos.dofus || []).find((x) => x.id === id);
      if (!d) return;
      d.conseguido = !d.conseguido;
      pintarDofus();
      const cuerpo = { id, conseguido: d.conseguido };
      dofusEnCola++;
      dofusFila = dofusFila.then(async () => {
        try {
          const lista = await api('/api/objetivos/dofus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cuerpo)
          });
          if (dofusEnCola === 1) { objetivos.dofus = lista.dofus; pintarDofus(); }
        } catch (e) {
          showAlert('Dofus', e.message);
          // Lo que diga el servidor, que es lo que de verdad quedó.
          cargarObjetivos();
        } finally {
          dofusEnCola--;
        }
      });
    }

    async function objetivosAnadir() {
      const campo = document.getElementById('objetivosNuevo');
      const texto = campo.value.trim();
      if (!texto) { campo.focus(); return; }
      if (await objetivosPedir('/api/objetivos', { texto })) {
        campo.value = '';
        campo.focus();
      }
    }

    document.getElementById('objetivosAnadir').addEventListener('click', objetivosAnadir);
    document.getElementById('objetivosNuevo').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') objetivosAnadir();
    });

    document.getElementById('objetivosTitulo').addEventListener('change', (ev) => {
      objetivosPedir('/api/objetivos/titulo', { titulo: ev.target.value });
    });

    // Los completados, dentro de un objetivo nuevo con el nombre que se elija.
    document.getElementById('objetivosAgrupar').addEventListener('click', async () => {
      const hechos = (objetivos.objetivos || []).filter((o) => o.hecho);
      if (!hechos.length) return;
      const nombre = await showModal({
        title: 'Guardar completados',
        message: 'Los ' + hechos.length + ' objetivo(s) completados pasan a ser sub-objetivos de uno nuevo con este nombre. '
          + 'Quedan guardados; con «Desmarcar todos» los puedes repetir.',
        okText: 'Guardar',
        input: true,
        placeholder: 'Nombre, p. ej. Misiones Dofawa'
      });
      if (!nombre) return;
      // Agrupar los mete dentro de uno nuevo; con un borrador por guardar,
      // el borrador los volvería a sacar. Primero se guarda lo ordenado.
      if (orden && !(await guardarOrden())) return;
      objetivosPedir('/api/objetivos/agrupar', { nombre });
    });

    document.getElementById('objetivosGuardarOrden').addEventListener('click', guardarOrden);
    document.getElementById('objetivosDescartarOrden').addEventListener('click', descartarOrden);

    document.getElementById('objetivosDesmarcar').addEventListener('click', () => {
      objetivosPedir('/api/objetivos/desmarcar');
    });

    document.getElementById('objetivosVaciar').addEventListener('click', async () => {
      const cuantos = (objetivos.objetivos || []).length;
      const ok = await showConfirm('Vaciar los objetivos',
        `Se quitan los ${cuantos} objetivo(s) de la lista, hechos o no, con todo lo que llevan dentro. No se puede deshacer.`, 'Vaciar', true);
      if (!ok) return;
      objetivosPedir('/api/objetivos/vaciar');
    });
