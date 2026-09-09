// Lectura del chat de Twitch, en modo anonimo.
//
// Twitch deja escuchar cualquier chat publico sin credenciales: basta con
// entrar como "justinfan" + un numero. Por eso esto NO necesita que el
// streamer registre ninguna app, a diferencia de los puntos de canal.
//
// Solo se lee. No se manda nada al chat.

const IRC_WS = 'wss://irc-ws.chat.twitch.tv:443';

export interface Mensaje {
  autor: string;        // como se escribe su nombre, con mayusculas
  texto: string;
}

export interface Conexion {
  canal: string;
  cerrar(): void;
  abierta(): boolean;
}

// Una linea de IRC de Twitch trae mas cosas de las que hacen falta. De aqui
// solo interesa quien escribe y que escribe.
export function interpretar(linea: string): Mensaje | null {
  // Formato: :nombre!nombre@nombre.tmi.twitch.tv PRIVMSG #canal :el texto
  const m = /^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/.exec(linea);
  if (!m) return null;
  const texto = m[2].replace(/[\r\n]+$/, '').trim();
  if (!texto) return null;
  return { autor: m[1], texto };
}

// La gente no escribe la palabra sola: le pone emotes detras, un «vamos», o
// signos. Vale con que este ahi como palabra suelta; asi no se queda fuera
// medio chat por un adorno.
export function esLaPalabra(texto: string, palabra: string): boolean {
  const buscada = String(palabra || '').trim().toLowerCase();
  if (!buscada) return false;
  return String(texto || '').toLowerCase().split(/\s+/)
    .some((t) => t.replace(/[.,;:!?¡¿'"]+$/, '') === buscada);
}

// El WebSocket de Node es global a partir de Node 22. En uno mas viejo esto
// reventaba con un error que no decia nada; asi al menos se sabe que arreglar.
function haceFalta(): typeof WebSocket {
  const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) {
    throw new Error(
      'este servidor no trae WebSocket: los minijuegos que leen el chat ' +
      'necesitan Node 22 o mas nuevo (este es ' + process.version + ')'
    );
  }
  return WS;
}

// Abre la conexion y llama a `alMensaje` con cada mensaje del chat.
export function conectar(canal: string, alMensaje: (m: Mensaje) => void): Conexion {
  const WS = haceFalta();
  const limpio = String(canal || '').trim().toLowerCase().replace(/^#/, '');
  let ws: WebSocket | null = null;
  let cerrada = false;

  const abrir = () => {
    if (cerrada || !limpio) return;
    const s = new WS(IRC_WS);
    ws = s;

    s.addEventListener('open', () => {
      // Anonimo: cualquier justinfan con un numero al azar sirve.
      s.send('NICK justinfan' + Math.floor(Math.random() * 90000 + 10000));
      s.send('JOIN #' + limpio);
    });

    s.addEventListener('message', (ev: MessageEvent) => {
      for (const linea of String(ev.data).split('\r\n')) {
        if (!linea) continue;
        // Twitch comprueba de vez en cuando que seguimos ahi.
        if (linea.startsWith('PING')) { s.send('PONG :tmi.twitch.tv'); continue; }
        const msg = interpretar(linea);
        if (msg) {
          try { alMensaje(msg); } catch (e) { console.error('chat: fallo al tratar un mensaje', e); }
        }
      }
    });

    s.addEventListener('close', () => {
      if (cerrada || ws !== s) return;
      // Twitch corta cada cierto tiempo; se vuelve a entrar.
      setTimeout(abrir, 5000);
    });

    s.addEventListener('error', () => { /* del close que viene detras se encarga */ });
  };

  abrir();

  return {
    canal: limpio,
    abierta: () => Boolean(ws && ws.readyState === 1),
    cerrar() {
      cerrada = true;
      const s = ws;
      ws = null;
      if (s) { try { s.close(); } catch (e) { /* ya estaba cerrada */ } }
    }
  };
}
