import { io } from "socket.io-client";

export const socket = io(window.location.origin, {
  transports: ["websocket", "polling"],
});

socket.on("connect", () => {
  console.log("Connected to server");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});
