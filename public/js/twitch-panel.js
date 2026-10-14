// Configuración › Twitch: conectar la cuenta del streamer y el aviso que se
// fija en el chat al abrir una inscripción. El servidor hace todo lo de Twitch
// (ver src/twitch.ts); esto solo lo enseña y lo manda.
//
// Es un script normal, sin módulo: comparte el ámbito global con index.html
// (api, showAlert, copyToClipboard...), y por eso va cargado después.

    let twitchEstado = null;

    async function cargarTwitch() {
      try {
        twitchEstado = await api('/api/twitch/status');
      } catch (e) {
        console.warn('No se pudo leer la conexión con Twitch:', e.message);
        return;
      }
      pintarTwitch();
    }

    function pintarTwitch() {
      const e = twitchEstado;
      if (!e) return;
      const estado = document.getElementById('twitchEstado');
      estado.className = 'twitch-estado ' + (e.conectado ? 'va' : 'no');
      estado.textContent = e.conectado
        ? '✅ Conectado como ' + (e.login || 'tu cuenta')
        : e.credenciales
          ? '⏳ Credenciales puestas. Falta pulsar «Conectar con Twitch».'
          : '⛔ Sin conectar.';

      document.getElementById('twitchRedireccion').textContent = e.redireccion || '';
      const id = document.getElementById('twitchClientId');
      if (document.activeElement !== id && !id.dataset.tocado) id.value = e.clientId || '';
      document.getElementById('twitchSecret').placeholder = e.secretoPuesto
        ? 'Puesto (déjalo vacío para no cambiarlo)'
        : 'Client Secret de tu app';

      document.getElementById('twitchConectar').disabled = !e.credenciales;
      document.getElementById('twitchConectar').textContent = e.conectado ? 'Volver a conectar' : 'Conectar con Twitch';
      document.getElementById('twitchDesconectar').hidden = !e.conectado && !e.credenciales;
      document.getElementById('twitchFijar').checked = e.fijarAviso !== false;

      // El último aviso, para saber por qué no sale si no sale.
      const ultimo = document.getElementById('twitchUltimo');
      const a = e.ultimoAviso;
      ultimo.hidden = !a;
      if (a) {
        const hora = new Date(a.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        ultimo.className = 'meta twitch-ultimo ' + (a.ok ? 'va' : 'no');
        ultimo.textContent = a.ok
          ? 'Último aviso fijado a las ' + hora + ': «' + a.texto + '»'
          : 'El último aviso (' + hora + ') no se pudo fijar: ' + a.error;
      }
    }

    document.getElementById('twitchClientId').addEventListener('input', (ev) => { ev.target.dataset.tocado = '1'; });

    document.getElementById('twitchGuardar').addEventListener('click', async () => {
      const aviso = document.getElementById('twitchGuardado');
      try {
        twitchEstado = await api('/api/twitch/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: document.getElementById('twitchClientId').value.trim(),
            clientSecret: document.getElementById('twitchSecret').value.trim()
          })
        });
        document.getElementById('twitchSecret').value = '';
        delete document.getElementById('twitchClientId').dataset.tocado;
        pintarTwitch();
        aviso.textContent = 'Guardado. Ahora pulsa «Conectar con Twitch».';
        setTimeout(() => { aviso.textContent = ''; }, 4000);
      } catch (e) {
        showAlert('No se pudieron guardar las credenciales', e.message);
      }
    });

    // Conectar es salir a Twitch y volver: el servidor manda allí y la vuelta
    // llega a /?twitch=ok (o error), que se recoge más abajo.
    document.getElementById('twitchConectar').addEventListener('click', () => {
      location.href = '/api/twitch/connect';
    });

    document.getElementById('twitchDesconectar').addEventListener('click', async () => {
      const ok = await showConfirm('Desconectar Twitch',
        'Se dejan de fijar avisos y se olvidan las credenciales de tu app. Para volver tendrás que ponerlas otra vez.',
        'Desconectar', true);
      if (!ok) return;
      try {
        twitchEstado = await api('/api/twitch/disconnect', { method: 'POST' });
        pintarTwitch();
      } catch (e) {
        showAlert('No se pudo desconectar', e.message);
      }
    });

    document.getElementById('twitchFijar').addEventListener('change', async (ev) => {
      try {
        twitchEstado = await api('/api/twitch/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fijarAviso: ev.target.checked })
        });
        pintarTwitch();
      } catch (e) {
        ev.target.checked = !ev.target.checked;
        showAlert('No se pudo guardar', e.message);
      }
    });

    document.getElementById('twitchCopiar').addEventListener('click', async () => {
      const ok = await copyToClipboard(document.getElementById('twitchRedireccion').textContent);
      const b = document.getElementById('twitchCopiar');
      b.textContent = ok ? '¡Copiada!' : 'No se pudo copiar';
      setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
    });

    // La vuelta de Twitch: se abre Configuración › Twitch y se dice cómo ha ido.
    // La marca se quita de la dirección, para que recargar no lo repita.
    (function vueltaDeTwitch() {
      const p = new URLSearchParams(location.search);
      const como = p.get('twitch');
      if (!como) return;
      history.replaceState(null, '', location.pathname + location.hash);
      document.querySelector('.tab[data-tab="config"]')?.click();
      document.querySelector('#config-panel .cfgtab[data-cfgtab="twitch"]')?.click();
      if (como === 'ok') {
        showAlert('Twitch conectado', 'Listo. Al abrir la inscripción de un minijuego se fijará el aviso en tu chat.');
      } else {
        showAlert('No se pudo conectar Twitch',
          'Twitch no aceptó la autorización. Revisa que la Redirect URL de tu app sea exactamente la que sale en Configuración › Twitch, y que el Client Secret sea el bueno.');
      }
    })();
