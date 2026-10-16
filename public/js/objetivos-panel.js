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
      const titulo = document.getElementById('objetivosTitulo');
      if (document.activeElement !== titulo) titulo.value = objetivos.titulo || '';
      document.getElementById('objetivosEstado').textContent = lista.length
        ? hechos + ' de ' + lista.length + ' hechos'
        : 'Sin objetivos todavía. Con la lista vacía el widget no sale.';
      document.getElementById('objetivosDesmarcar').disabled = !hechos;
      document.getElementById('objetivosVaciar').disabled = !lista.length;

      const caja = document.getElementById('objetivosLista');
      caja.innerHTML = '';
      lista.forEach((o, i) => {
        const fila = document.createElement('div');
        fila.className = 'objetivo' + (o.hecho ? ' hecho' : '');
        fila.innerHTML = '<input type="checkbox" class="marca" />'
          + '<input type="text" class="texto" maxlength="140" />'
          + '<button type="button" class="mini subir" title="Subir">▲</button>'
          + '<button type="button" class="mini bajar" title="Bajar">▼</button>'
          + '<button type="button" class="mini quitar" title="Quitar">✕</button>';
        const marca = fila.querySelector('.marca');
        marca.checked = o.hecho;
        marca.setAttribute('aria-label', 'Hecho: ' + o.texto);
        marca.addEventListener('change', () => objetivosPedir('/api/objetivos/cambiar', { id: o.id, hecho: marca.checked }));

        // El texto se corrige ahí mismo y se guarda al salir del campo.
        const texto = fila.querySelector('.texto');
        texto.value = o.texto;
        texto.setAttribute('aria-label', 'Objetivo ' + (i + 1));
        texto.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') texto.blur();
          if (ev.key === 'Escape') { texto.value = o.texto; texto.blur(); }
        });
        texto.addEventListener('blur', async () => {
          const nuevo = texto.value.trim();
          if (nuevo === o.texto) return;
          if (!nuevo) { texto.value = o.texto; return; }
          await objetivosPedir('/api/objetivos/cambiar', { id: o.id, texto: nuevo });
        });

        const subir = fila.querySelector('.subir');
        const bajar = fila.querySelector('.bajar');
        subir.disabled = i === 0;
        bajar.disabled = i === lista.length - 1;
        subir.addEventListener('click', () => objetivosPedir('/api/objetivos/mover', { id: o.id, hacia: -1 }));
        bajar.addEventListener('click', () => objetivosPedir('/api/objetivos/mover', { id: o.id, hacia: 1 }));
        fila.querySelector('.quitar').addEventListener('click', () => objetivosPedir('/api/objetivos/quitar', { id: o.id }));
        caja.appendChild(fila);
      });

      pintarDofus();
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
