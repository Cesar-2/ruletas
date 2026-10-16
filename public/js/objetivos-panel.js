// La pestaña de Objetivos: la checklist del directo. Se añaden, se marcan, se
// reordenan y se quitan; el widget de OBS enseña lo mismo al momento.
//
// Script normal, sin modulo, como los demás paneles: usa api(), showAlert() y
// showConfirm() de index.html.

    let objetivos = { titulo: '', objetivos: [] };

    async function cargarObjetivos() {
      try {
        objetivos = await api('/api/objetivos');
        pintarObjetivos();
      } catch (e) {
        document.getElementById('objetivosEstado').textContent = 'Error: ' + e.message;
      }
    }

    // Todas las rutas devuelven la lista entera: se pinta lo que quedó guardado.
    async function objetivosPedir(ruta, cuerpo) {
      try {
        objetivos = await api(ruta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo || {})
        });
        pintarObjetivos();
        return true;
      } catch (e) {
        showAlert('Objetivos', e.message);
        return false;
      }
    }

    function pintarObjetivos() {
      const lista = objetivos.objetivos || [];
      const hechos = lista.filter((o) => o.hecho).length;
      const enProceso = lista.filter((o) => o.proceso).length;
      const titulo = document.getElementById('objetivosTitulo');
      if (document.activeElement !== titulo) titulo.value = objetivos.titulo || '';
      document.getElementById('objetivosEstado').textContent = lista.length
        ? hechos + ' de ' + lista.length + ' hechos · ' + enProceso + ' en proceso'
          + (enProceso ? '' : ' (el widget no sale hasta que pongas alguno ▶ en proceso)')
        : 'Sin objetivos todavía.';
      document.getElementById('objetivosDesmarcar').disabled = !hechos && !enProceso;
      document.getElementById('objetivosVaciar').disabled = !lista.length;

      const caja = document.getElementById('objetivosLista');
      caja.innerHTML = '';
      lista.forEach((o, i) => {
        const fila = document.createElement('div');
        fila.className = 'objetivo' + (o.hecho ? ' hecho' : '') + (o.proceso ? ' proceso' : '');
        fila.innerHTML = '<input type="checkbox" class="marca" />'
          + '<input type="text" class="texto" maxlength="140" />'
          + '<button type="button" class="mini en-proceso"></button>'
          + '<button type="button" class="mini mas-sub" title="Añadir un sub-objetivo">+ Sub</button>'
          + '<button type="button" class="mini subir" title="Subir">▲</button>'
          + '<button type="button" class="mini bajar" title="Bajar">▼</button>'
          + '<button type="button" class="mini quitar" title="Quitar">✕</button>';
        const marca = fila.querySelector('.marca');
        marca.checked = o.hecho;
        marca.setAttribute('aria-label', 'Hecho: ' + o.texto);
        marca.addEventListener('change', () => objetivosPedir('/api/objetivos/cambiar', { id: o.id, hecho: marca.checked }));

        // Lo que sale en el widget: solo los que están en proceso.
        const proceso = fila.querySelector('.en-proceso');
        proceso.textContent = o.proceso ? '▶ En proceso' : '▶';
        proceso.title = o.proceso ? 'Quitar del widget' : 'Poner en proceso: sale en el widget';
        proceso.setAttribute('aria-pressed', o.proceso ? 'true' : 'false');
        proceso.addEventListener('click', () => objetivosPedir('/api/objetivos/cambiar', { id: o.id, proceso: !o.proceso }));

        const texto = fila.querySelector('.texto');
        texto.setAttribute('aria-label', 'Objetivo ' + (i + 1));
        editableEnSitio(texto, o.texto, (nuevo) => objetivosPedir('/api/objetivos/cambiar', { id: o.id, texto: nuevo }));

        fila.querySelector('.mas-sub').addEventListener('click', () => {
          subsAbiertos.add(o.id);
          pintarObjetivos();
          const campo = document.querySelector('.subs[data-id="' + o.id + '"] .sub-nuevo');
          if (campo) campo.focus();
        });

        const subir = fila.querySelector('.subir');
        const bajar = fila.querySelector('.bajar');
        subir.disabled = i === 0;
        bajar.disabled = i === lista.length - 1;
        subir.addEventListener('click', () => objetivosPedir('/api/objetivos/mover', { id: o.id, hacia: -1 }));
        bajar.addEventListener('click', () => objetivosPedir('/api/objetivos/mover', { id: o.id, hacia: 1 }));
        fila.querySelector('.quitar').addEventListener('click', () => objetivosPedir('/api/objetivos/quitar', { id: o.id }));
        caja.appendChild(fila);
        if (o.subs.length || subsAbiertos.has(o.id)) caja.appendChild(pintarSubs(o));
      });

      pintarDofus();
    }

    // Un campo de texto que se corrige ahí mismo: se guarda al salir o con
    // Enter, y Escape lo deja como estaba.
    function editableEnSitio(campo, valor, guardar) {
      campo.value = valor;
      campo.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') campo.blur();
        if (ev.key === 'Escape') { campo.value = valor; campo.blur(); }
      });
      campo.addEventListener('blur', () => {
        const nuevo = campo.value.trim();
        if (nuevo === valor) return;
        if (!nuevo) { campo.value = valor; return; }
        guardar(nuevo);
      });
    }

    // Los objetivos en los que se pulsó «+ Sub», para que el campo de añadir
    // siga abierto al repintar aunque todavía no tengan ninguno.
    const subsAbiertos = new Set();

    // Los pasos de un objetivo, debajo de su fila. Al hacer el último, el
    // servidor da el objetivo por hecho y pasa el siguiente a en proceso.
    function pintarSubs(o) {
      const caja = document.createElement('div');
      caja.className = 'subs';
      caja.dataset.id = o.id;
      o.subs.forEach((s) => {
        const fila = document.createElement('div');
        fila.className = 'sub' + (s.hecho ? ' hecho' : '');
        fila.innerHTML = '<input type="checkbox" class="marca" />'
          + '<input type="text" class="texto" maxlength="140" />'
          + '<button type="button" class="mini quitar" title="Quitar">✕</button>';
        const marca = fila.querySelector('.marca');
        marca.checked = s.hecho;
        marca.setAttribute('aria-label', 'Hecho: ' + s.texto);
        marca.addEventListener('change', () => objetivosPedir('/api/objetivos/sub/cambiar', { id: o.id, sub: s.id, hecho: marca.checked }));
        const texto = fila.querySelector('.texto');
        texto.setAttribute('aria-label', 'Sub-objetivo de ' + o.texto);
        editableEnSitio(texto, s.texto, (nuevo) => objetivosPedir('/api/objetivos/sub/cambiar', { id: o.id, sub: s.id, texto: nuevo }));
        fila.querySelector('.quitar').addEventListener('click', () => objetivosPedir('/api/objetivos/sub/quitar', { id: o.id, sub: s.id }));
        caja.appendChild(fila);
      });

      const nueva = document.createElement('div');
      nueva.className = 'sub sub-anadir';
      nueva.innerHTML = '<input type="text" class="texto sub-nuevo" maxlength="140" placeholder="Nuevo sub-objetivo (Enter para añadir)" />';
      const campo = nueva.querySelector('.sub-nuevo');
      campo.setAttribute('aria-label', 'Nuevo sub-objetivo de ' + o.texto);
      campo.addEventListener('keydown', async (ev) => {
        if (ev.key === 'Escape') { subsAbiertos.delete(o.id); pintarObjetivos(); return; }
        if (ev.key !== 'Enter') return;
        const t = campo.value.trim();
        if (!t) return;
        subsAbiertos.add(o.id);
        if (await objetivosPedir('/api/objetivos/sub', { id: o.id, texto: t })) {
          const otra = document.querySelector('.subs[data-id="' + o.id + '"] .sub-nuevo');
          if (otra) otra.focus();
        }
      });
      caja.appendChild(nueva);
      return caja;
    }

    // Los trece Dofus, siempre todos: un clic lo marca como conseguido y otro
    // lo desmarca. Es lo que enseña la tira del widget de Dofus.
    function pintarDofus() {
      const dofus = objetivos.dofus || [];
      const tiene = dofus.filter((d) => d.conseguido).length;
      document.getElementById('dofusEstado').textContent = tiene + ' de ' + dofus.length + ' conseguidos';
      const caja = document.getElementById('dofusLista');
      caja.innerHTML = '';
      dofus.forEach((d) => {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'dofus-huevo' + (d.conseguido ? ' hecho' : '');
        boton.setAttribute('aria-pressed', d.conseguido ? 'true' : 'false');
        boton.title = d.conseguido ? d.texto + ': conseguido (clic para desmarcar)' : d.texto + ': clic cuando lo consigas';
        const img = document.createElement('img');
        img.src = d.imagen;
        img.alt = '';
        img.onerror = () => { img.style.visibility = 'hidden'; };
        const nombre = document.createElement('span');
        nombre.textContent = d.texto;
        boton.append(img, nombre);
        boton.addEventListener('click', () => objetivosPedir('/api/objetivos/dofus', { id: d.id, conseguido: !d.conseguido }));
        caja.appendChild(boton);
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

    document.getElementById('objetivosDesmarcar').addEventListener('click', () => {
      objetivosPedir('/api/objetivos/desmarcar');
    });

    document.getElementById('objetivosVaciar').addEventListener('click', async () => {
      const cuantos = (objetivos.objetivos || []).length;
      const ok = await showConfirm('Vaciar los objetivos',
        `Se quitan los ${cuantos} objetivo(s) de la lista, hechos o no. No se puede deshacer.`, 'Vaciar', true);
      if (!ok) return;
      objetivosPedir('/api/objetivos/vaciar');
    });
