import { createServer as createHTTPServer, IncomingMessage, ServerResponse, Server as NodeHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

type SimpleServer = NodeHTTPServer<typeof IncomingMessage, typeof ServerResponse>
type Response = ServerResponse<IncomingMessage> & { req: IncomingMessage }

class Server {
    http: SimpleServer
    https: SimpleServer
    constructor (
        httpHandler: (req: IncomingMessage, res: Response) => any,
        //wsHandler
    ) {
        this.http = createHTTPServer(httpHandler)
        this.https = createHTTPSServer({
            key: readFileSync("./localhost.key"),
            cert: readFileSync("./localhost.crt")
        }, httpHandler);
        [this.http, this.https].forEach((server) => {
            server.on("upgrade", (req, socket) => {
                socket.on("data", (d) => console.log(Array.from(d).map((c) => "0x" + (c as number).toString(16))))
		socket.on("error", (e) => console.error("Socket error: ", e))
                console.log("a client is requesting we use websockets")
                if (req.headers["upgrade"] !== "websocket" || !req.headers["sec-websocket-key"]) {
                    console.log("received a bad request")
                    return socket.end("HTTP/1.1 400 Bad Request");
                }
                console.log("calculating their response key rq...")
                const acceptKey = req.headers['sec-websocket-key'];
                const hash = createHash('sha1').update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary').digest('base64');
                console.log(`Client key: ${acceptKey}\nOur key: ${hash}`)
                console.log("response key calculated, returning headers now!")
                const responseHeaders = [
                    'HTTP/1.1 101 Switching Protocols',
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    `Sec-WebSocket-Accept: ${hash}`
                ]; 
                socket.write(responseHeaders.concat('\r\n').join('\r\n'));
            })
        })
        this.http.listen(80)
        this.https.listen(443)
    }
}

function httpHandler (req: IncomingMessage, res: Response) {
    if (req.headers["upgrade"]) console.log("the client sent an upgrade header: " + req.headers["upgrade"])
    res.writeHead(200, "OK")
    res.write(`<!doctype html>
<html>
    <head>
        <title>hi</title>
    </head>
    <body>
        <p>success</p>
        <p id="ws-success">websocket connecting...</p>
    </body>
    <script>
        let ws = new WebSocket("ws://127.0.0.1/");
        ws.addEventListener("open", () => {
            console.log("websocket opened")
            document.getElementById("ws-success").innerText = "websocket connected"
        })
        ws.addEventListener("error", (event) => {
            console.log('WebSocket error: ', event)
            document.getElementById("ws-success").innerText = "websocket error"
        })
    </script>
</html>`)
    res.end()
}

let server = new Server(httpHandler)
