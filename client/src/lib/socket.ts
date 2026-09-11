import { io } from "socket.io-client";

export const socket = io(window.location.origin, {
  transports: ["websocket", "polling"],
  // Las pantallas quedan encendidas semanas: hay que reintentar siempre, con
  // backoff, para que un corte de red no las deje con contenido congelado.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 30_000,
});

if (import.meta.env.DEV) {
  socket.on("connect", () => console.log("socket conectado"));
  socket.on("disconnect", (reason) => console.log("socket desconectado:", reason));
}
