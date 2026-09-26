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

// Como va la escucha, para poder decirlo en pantalla.
//
// Hace falta porque «estoy escuchando #canal» y «Twitch me dejo entrar en
// #canal» no son lo mismo, y antes se daba por hecho que si. El socket abre
// igual escribas bien el canal o lo escribas mal: lo que cambia es que en un
// canal que no existe Twitch NO contesta al JOIN, y se queda callado. Asi que
// sin mirar esa respuesta, un canal mal escrito se ve exactamente igual que un
// chat en el que todavia no ha escrito nadie.
export interface Salud {
  canal: string;
  // El socket esta en pie.
  abierta: boolean;
  // Twitch ha confirmado la entrada en el canal.
  dentro: boolean;
  // Cuantos mensajes se han leido desde que se abrio.
  mensajes: number;
  // Que contar en pantalla, o '' si todo va bien. Esta escrito para el dueño
  // del directo, no para un registro: es lo que se le pone delante cuando le
  // dice al chat que escriba la palabra y no pasa nada.
  problema: string;
  // Si eso es algo que hay que arreglar (el canal no existe, se cayo la
  // conexion) o solo algo que esta pasando (los dos segundos que tarda en
  // entrar al abrir). Lo decide quien sabe por que esta puesto el mensaje, no la
  // pagina mirando el texto.
  grave: boolean;
}

export interface Conexion {
  canal: string;
  cerrar(): void;
  abierta(): boolean;
  salud(): Salud;
}

// Lo que se le da a Twitch para contestar al JOIN antes de dar por hecho que no
// va a contestar. Normalmente tarda bastante menos de un segundo; con ocho hay
// sitio de sobra para una conexion lenta sin dejar al dueño mirando una pantalla
// que no dice nada.
const ESPERA_JOIN_MS = 8000;

// Lo que se espera entre reintentos. Twitch corta cada cierto tiempo y hay que
// volver a entrar, asi que el primer reintento es rapido; pero si lo que falla
// es la red o el canal, reintentar cada cinco segundos para siempre solo llena
// el registro. Se va doblando hasta el tope.
const REINTENTO_MS = 5000;
const REINTENTO_MAX_MS = 60000;

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

// Si una linea es Twitch confirmando que hemos entrado en el canal.
//
// Valen las dos que manda: el eco del propio JOIN y el 366, que cierra la lista
// de nombres. En un canal que no existe no llega NINGUNA de las dos: Twitch
// manda su bienvenida (001..376) y se calla. Eso es lo que distingue un canal
// mal escrito de un chat en el que aun no ha escrito nadie.
export function esEntrada(linea: string, canal: string): boolean {
  const c = String(canal || '').toLowerCase();
  if (!c) return false;
  const l = String(linea || '');
  if (/^:[^ ]+ JOIN #(.+)$/.test(l)) return l.toLowerCase().endsWith('join #' + c);
  // :tmi.twitch.tv 366 justinfanNNN #canal :End of /NAMES list
  const m = /^:[^ ]+ 366 [^ ]+ #([^ ]+)/.exec(l);
  return Boolean(m && m[1].toLowerCase() === c);
}

// Abre la conexion y llama a `alMensaje` con cada mensaje del chat.
//
//   alCambiar  opcional: se llama cuando cambia como va la escucha (entra, se
//              cae, o se da por hecho que el canal no existe). Sirve para que la
//              pantalla se entere al momento en vez de esperar a preguntar.
export function conectar(
  canal: string,
  alMensaje: (m: Mensaje) => void,
  alCambiar?: () => void
): Conexion {
  const WS = haceFalta();
  const limpio = String(canal || '').trim().toLowerCase().replace(/^#/, '');
  let ws: WebSocket | null = null;
  let cerrada = false;
  let dentro = false;
  let mensajes = 0;
  let intentos = 0;
  // Si se ha llegado a entrar alguna vez. Cambia lo que se cuenta: no haber
  // entrado NUNCA apunta al nombre del canal; haber entrado y caerse apunta a
  // la conexion.
  let entroAlgunaVez = false;
  let sinRespuesta = false;
  let relojJoin: ReturnType<typeof setTimeout> | null = null;
  let relojReintento: ReturnType<typeof setTimeout> | null = null;

  const avisar = () => {
    if (!alCambiar) return;
    try { alCambiar(); } catch (e) { console.error('chat: fallo al avisar del estado', e); }
  };

  const abrir = () => {
    if (cerrada || !limpio) return;
    intentos++;
    const s = new WS(IRC_WS);
    ws = s;

    s.addEventListener('open', () => {
      // Anonimo: cualquier justinfan con un numero al azar sirve.
      s.send('NICK justinfan' + Math.floor(Math.random() * 90000 + 10000));
      s.send('JOIN #' + limpio);
      // Si Twitch no contesta al JOIN, el canal no existe. No se corta la
      // conexion: se deja abierta y se cuenta, porque el dueño puede arreglar
      // el nombre del canal sin tocar nada mas.
      if (relojJoin) clearTimeout(relojJoin);
      relojJoin = setTimeout(() => {
        relojJoin = null;
        if (cerrada || ws !== s || dentro) return;
        sinRespuesta = true;
        avisar();
      }, ESPERA_JOIN_MS);
    });

    s.addEventListener('message', (ev: MessageEvent) => {
      for (const linea of String(ev.data).split('\r\n')) {
        if (!linea) continue;
        // Twitch comprueba de vez en cuando que seguimos ahi.
        if (linea.startsWith('PING')) { s.send('PONG :tmi.twitch.tv'); continue; }
        if (!dentro && esEntrada(linea, limpio)) {
          dentro = true;
          entroAlgunaVez = true;
          sinRespuesta = false;
          // Se ha entrado: los reintentos vuelven a contar desde cero, que lo
          // que venga despues sera un corte normal de Twitch y no un fallo.
          intentos = 0;
          if (relojJoin) { clearTimeout(relojJoin); relojJoin = null; }
          avisar();
          continue;
        }
        const msg = interpretar(linea);
        if (msg) {
          mensajes++;
          try { alMensaje(msg); } catch (e) { console.error('chat: fallo al tratar un mensaje', e); }
        }
      }
    });

    s.addEventListener('close', () => {
      if (cerrada || ws !== s) return;
      dentro = false;
      if (relojJoin) { clearTimeout(relojJoin); relojJoin = null; }
      avisar();
      // Twitch corta cada cierto tiempo; se vuelve a entrar. Se va esperando
      // mas en cada intento seguido, hasta el tope: si lo que falla es la red,
      // insistir cada cinco segundos para siempre no arregla nada.
      const espera = Math.min(REINTENTO_MAX_MS, REINTENTO_MS * Math.pow(2, Math.max(0, intentos - 1)));
      if (relojReintento) clearTimeout(relojReintento);
      relojReintento = setTimeout(abrir, espera);
    });

    s.addEventListener('error', () => { /* del close que viene detras se encarga */ });
  };

  abrir();

  const salud = (): Salud => {
    const abierta = Boolean(ws && ws.readyState === 1);
    let problema = '';
    let grave = false;
    if (!limpio) {
      problema = 'no hay ningún canal puesto';
      grave = true;
    } else if (sinRespuesta && !entroAlgunaVez) {
      // Lo mas probable con diferencia: una letra de mas o de menos.
      problema = `Twitch no deja entrar en «${limpio}»: comprueba el nombre del canal en Configuración › Mi cuenta`;
      grave = true;
    } else if (entroAlgunaVez && (!abierta || !dentro)) {
      problema = 'se ha perdido la conexión con el chat de Twitch; se está volviendo a entrar';
      grave = true;
    } else if (!dentro) {
      // Los dos segundos de entrar. No es un fallo: es lo que esta pasando.
      problema = 'conectando con el chat de Twitch…';
    }
    return { canal: limpio, abierta, dentro, mensajes, problema, grave };
  };

  return {
    canal: limpio,
    abierta: () => Boolean(ws && ws.readyState === 1),
    salud,
    cerrar() {
      cerrada = true;
      if (relojJoin) { clearTimeout(relojJoin); relojJoin = null; }
      if (relojReintento) { clearTimeout(relojReintento); relojReintento = null; }
      const s = ws;
      ws = null;
      if (s) { try { s.close(); } catch (e) { /* ya estaba cerrada */ } }
    }
  };
}
