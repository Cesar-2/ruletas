// Un solo proceso al mando de los datos.
//
// En produccion se vieron dos procesos del Ruleton a la vez (dos lineas de
// «memoria» cada cinco minutos, una sin nadie conectado). Pasa cuando un
// despliegue arranca el nuevo sin que el viejo se haya ido. Con dos:
//
//  - cada uno abre su conexion con Twitch para los canjes, y se quitan la
//    suscripcion el uno al otro (ver quitarViejas en twitch.ts);
//  - los dos escriben en los mismos JSON, y lo que guarda uno lo pisa el otro;
//  - los avisos de uno no llegan a quien esta conectado al otro.
//
// Asi que cada proceso apunta en la carpeta de datos quien esta al mando, con
// un latido. El que arranca toma el mando. El que lo ha perdido se va, pero
// solo cuando no esta atendiendo a nadie (ni una peticion ni un canal abierto)
// durante un rato: si el hosting le sigue mandando gente, no se le corta a
// nadie. Y mientras el nuevo siga vivo, el relevado no vuelve a pedir el mando,
// asi que dos procesos no se pueden echar el uno al otro sin fin.
//
// Si el que esta al mando muere sin irse (sin latido), el siguiente que mire lo
// coge, aunque sea uno que estaba relevado.

import fs from 'fs';
import * as registro from './registro';

export interface Opciones {
  archivo: string;                 // donde se apunta quien manda
  pid?: number;                    // para los tests
  ocupado(): boolean;              // si esta atendiendo algo ahora mismo
  salir(): void;                   // como se va este proceso
  latidoMs?: number;
  caducaMs?: number;               // sin latido desde hace esto, el mando esta libre
  ociosoMs?: number;               // tanto rato sin nadie antes de irse
}

interface Mando { pid: number; desde: number; latido: number }

export interface Instancia {
  repasar(ahora?: number): void;   // lo que hace el reloj; suelto, para los tests
  manda(): boolean;
  parar(): void;
}

function leer(archivo: string): Mando | null {
  try {
    const m = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    return m && Number(m.pid) ? { pid: Number(m.pid), desde: Number(m.desde) || 0, latido: Number(m.latido) || 0 } : null;
  } catch {
    return null;
  }
}

function escribir(archivo: string, m: Mando): void {
  // Atomico, como el resto de los datos: un .tmp propio y se renombra encima.
  const tmp = `${archivo}.${m.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m), 'utf8');
  fs.renameSync(tmp, archivo);
}

export function iniciar(o: Opciones): Instancia {
  const pid = o.pid ?? process.pid;
  const latidoMs = o.latidoMs ?? 10000;
  const caducaMs = o.caducaMs ?? 45000;
  const ociosoMs = o.ociosoMs ?? 60000;
  const desde = Date.now();
  let relevado = false;
  let ociosoDesde = 0;
  let fuera = false;

  const antes = leer(o.archivo);
  if (antes && antes.pid !== pid && Date.now() - antes.latido < caducaMs) {
    registro.apuntar('aviso', 'otro-proceso', { pid, otro: antes.pid, otroDesde: new Date(antes.desde).toISOString() });
  }
  try { escribir(o.archivo, { pid, desde, latido: Date.now() }); } catch (err) {
    registro.apuntar('error', 'instancia', { pid, ...registro.comoDato(err) });
  }

  function repasar(ahora = Date.now()): void {
    if (fuera) return;
    const m = leer(o.archivo);
    if (!relevado) {
      if (!m || m.pid === pid || ahora - m.latido >= caducaMs) {
        try { escribir(o.archivo, { pid, desde, latido: ahora }); } catch { /* se reintenta en el siguiente */ }
        return;
      }
      relevado = true;
      registro.apuntar('aviso', 'relevado', { pid, nuevo: m.pid, ocupado: o.ocupado() });
    }
    // El que lo relevo ha muerto (sin latido): este vuelve al mando. No es
    // pelearse, que el otro ya no esta; y si no, se quedaba sin nadie.
    if (!m || ahora - m.latido >= caducaMs) {
      relevado = false;
      ociosoDesde = 0;
      registro.apuntar('aviso', 'recupera-mando', { pid, otro: m?.pid ?? 0 });
      try { escribir(o.archivo, { pid, desde, latido: ahora }); } catch { /* se reintenta en el siguiente */ }
      return;
    }
    // Relevado: se va en cuanto lleve un rato sin nadie.
    if (o.ocupado()) { ociosoDesde = 0; return; }
    if (!ociosoDesde) ociosoDesde = ahora;
    if (ahora - ociosoDesde < ociosoMs) return;
    fuera = true;
    registro.apuntar('aviso', 'proceso-sobrante-sale', { pid, nuevo: m?.pid ?? 0 });
    o.salir();
  }

  const reloj = setInterval(() => repasar(), latidoMs);
  reloj.unref();
  return { repasar, manda: () => !relevado, parar: () => clearInterval(reloj) };
}
