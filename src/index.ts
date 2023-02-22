#!/usr/bin/env node
import { createConnection, NetConnectOpts, Socket, createServer as createNetServer } from "node:net";
import { env } from "node:process";
const server = createNetServer()
server.on("error", (e) => console.error("Server error: ", e))
type Method = "POST" | "CONNECT" | "PATCH" | "DELETE" | "GET" | string;
let PORT: number = 8080;
const HOST = "127.0.0.1";
;(() => {
    let port = typeof env.PORT == "undefined" ? PORT : parseInt(env.PORT, 10);
    if (isNaN(port)) return;
    console.log(`Using port ${port} from env.`)
    PORT = port;
})();

const listener = server.listen(PORT, HOST)
listener.on("listening", () => {
    let address = listener.address();
    if (!address) address = "NULL";
    if (!(typeof address == "string")) address = `${address.address}:${address.port}`
    console.log(`Server listening on ${address}`);
});

async function createConnectionAsync (options: NetConnectOpts): Promise<Socket> {
    return new Promise(resolve => {
        let socket: Socket = createConnection(options, () => resolve( socket ))
        socket.on("error", (e) => console.error("Outgoing socket error: ", e))
    })
}

function parseHeaders (packet: string | Buffer): { method: Method; uri: string; version: string; headers: { [key: string]: string; }; } {
    if (typeof packet !== "string") packet = packet.toString("utf-8");
    let endIndex = packet.indexOf("\r\n\r\n")
    if (endIndex === -1) endIndex = packet.length;
    const lines = packet.toString().slice(0, 65535).slice(0, endIndex).split("\r\n");
    let headers: { [key: string]: string } = {};
    lines.slice(1).forEach(line => {
        let index = line.indexOf(": ");
        headers[line.slice(0, index).toLowerCase()] = line.slice(index + 2);
    })
    let splitLine = lines[0].split(" ")
    let method = splitLine[0]
    let uri = splitLine[1]
    let version = splitLine[2]
//    for (let name in headers) console.log(`${name}: ${headers[name]}`)
    return {
        method,
        uri,
        version,
        headers
    }
}

function parseURI (uri: string): { port: number, host: string } {
    let ci = uri.indexOf(":")
    if (ci === -1) return { port: NaN, host: uri }
    let host = uri.slice(0, ci)
    let port: number | null = parseInt(uri.slice(ci + 1), 10)
    return { host, port }
}

function proxySocket (incomingSocket: Socket, outgoingSocket: Socket) {
    incomingSocket.pipe(outgoingSocket)
    outgoingSocket.pipe(incomingSocket)
}

async function onFirstPacket (socket: Socket, packet: Buffer) {
    console.log(packet.toString() + "*".repeat(50) + "\n".repeat(5))
    let host: string, port: number, keepAlive: boolean;
    let { method, uri, headers } = parseHeaders(packet)
    // handle if it's an actual not-proxy request
    if (uri.startsWith("/")) return socket.end("HTTP/1.1 200 HELLO\r\n\r\nmlem")
    let isTLS = method === "CONNECT"
    if (isTLS) {
        let t = parseURI(uri);
        port = isNaN(t.port) ? 443 : t.port;
        host = t.host
    } else {
        if (!headers["host"]) return socket.end("HTTP/1.1 400 BAD REQUEST\r\n\r\n")
        let t = parseURI(headers["host"]);
        port = isNaN(t.port) ? 80 : t.port;
        host = t.host
    }
    // kinda help with self-requesting
    if (host === HOST && port === PORT) return (console.log("evil"), socket.end("HTTP/1.1 400 EVIL\r\n\n"))
    keepAlive = headers["proxy-connection"] === "keep-alive";
    let outgoingSocket = await createConnectionAsync({ host, port, keepAlive });
    if (isTLS) socket.write('HTTP/1.1 200 OK\r\n\r\n');
    else outgoingSocket.write(packet);
    proxySocket(socket, outgoingSocket)
}

server.on("connection", (socket) => {
    console.log("connection made with client")
    socket.once("data", (packet: Buffer) => onFirstPacket(socket, packet))
})
