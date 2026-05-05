import { io } from "socket.io-client";
import { apiUrl } from "./network";

export const socket = io(apiUrl, {
  autoConnect: false,
  transports: ["websocket"]
});
