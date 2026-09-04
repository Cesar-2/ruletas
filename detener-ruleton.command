#!/bin/bash
# Detiene el Ruleton. Doble clic desde el Finder.

cd "$(dirname "$0")" || exit 1

aviso() {
  osascript -e "display dialog \"$1\" buttons {\"Cerrar\"} default button 1 with title \"Ruleton\"" >/dev/null 2>&1
}

# ts-node-dev levanta un supervisor y un proceso trabajador: si solo se mata el
# que escucha en el puerto, el supervisor lo vuelve a levantar. Por eso se
# cierra el arbol entero buscando por linea de comandos.
if pkill -f 'ts-node-dev|src/server.ts'; then
  # Un instante para que suelte el puerto antes de confirmar.
  sleep 1
  aviso "Ruleton detenido."
else
  aviso "El Ruleton no estaba en marcha."
fi

exit 0
