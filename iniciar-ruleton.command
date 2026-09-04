#!/bin/bash
# Arranca el Ruleton en segundo plano y abre el navegador cuando ya responde.
# En macOS basta con hacer doble clic en este archivo desde el Finder.
# La primera vez puede pedir permiso: clic derecho > Abrir.

cd "$(dirname "$0")" || exit 1

PUERTO="${PORT:-3000}"
URL="http://localhost:$PUERTO"
LOG="${TMPDIR:-/tmp}/ruleton-server.log"

aviso() {
  osascript -e "display dialog \"$1\" buttons {\"Cerrar\"} default button 1 with title \"Ruleton\" with icon caution" >/dev/null 2>&1
}

responde() {
  curl -s -o /dev/null --max-time 2 "$URL/api/settings"
}

# Si ya esta en marcha, solo se abre el navegador.
if responde; then
  open "$URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  aviso "No encuentro Node.js. Instalalo desde https://nodejs.org y vuelve a intentarlo."
  exit 1
fi

# Primera vez: instalar dependencias.
if [ ! -d node_modules ]; then
  echo "Instalando dependencias, esto tarda un par de minutos…"
  if ! npm install >"$LOG" 2>&1; then
    aviso "No se pudieron instalar las dependencias. Detalles en: $LOG"
    exit 1
  fi
fi

# nohup lo desliga de esta terminal: sigue vivo aunque se cierre la ventana.
echo "Arrancando el Ruleton…"
PORT="$PUERTO" nohup npm run dev >"$LOG" 2>&1 &

# Espera a que el puerto responda (maximo ~40 segundos).
for _ in $(seq 1 80); do
  sleep 0.5
  if responde; then
    open "$URL"
    echo "Listo: $URL"
    exit 0
  fi
done

aviso "El servidor no arranco. Revisa: $LOG"
exit 1
