package seurat.net;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.concession.GrantController;
import seurat.config.SeuratConfig;
import seurat.kit.TestKit;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsFraming;
import seurat.net.ws.WsHandshake;
import seurat.net.ws.WsMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.Headers;
import seurat.regulate.Regulator;
import seurat.concession.GazeGate;
import seurat.session.Easel;
import seurat.session.EaselContext;
import seurat.session.Sessions;
import static seurat.net.http.HttpConstants.CRLF;

/** Test-side WS client for the seurat.1 mapping, plus a loopback server. */
final class WsClient {
    private WsClient() {}

    /** Server on a free port over this catalog (painter, grants, WS mapping). */
    static int serve(Path root, Catalog catalog) throws Exception {
        int port = freePort();
        Path conf = root.resolve("seurat.conf");
        Files.writeString(conf, "http.port=" + port + "\nadmin.token=t\nauth.accounts=loop:loopback:autenticado\n");
        SeuratConfig config = SeuratConfig.load(conf);
        Sessions sessions = new Sessions();
        Painter painter = new Painter(new Regulator(),
                new BrushBudget(root.resolve("cov")), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);
        Thread.ofPlatform().daemon().start(painter);
        Path web = root.resolve("web");
        Files.createDirectories(web);
        Files.writeString(web.resolve("index.html"), "x");
        HttpSurface http = new HttpSurface(web, sessions, catalog, config,
                (id, file) -> {}, id -> {}, id -> {});
        var ctx = new EaselContext(sessions, catalog, grants, new GazeGate(grants), 1024, 0);
        var server = new SocketServer(config, http, (WsMapping mapping, BlockingQueue<byte[]> control) -> {
            Thread.ofVirtual().start(mapping::pump);
            Thread.ofVirtual().start(new Easel(mapping, control, ctx));
        });
        Thread.ofPlatform().daemon().start(() -> {
            try {
                server.start();
            } catch (Exception ignored) {
            }
        });
        Thread.sleep(300);

        return port;
    }

    static int freePort() throws Exception {
        try (ServerSocket probe = new ServerSocket(0)) {
            return probe.getLocalPort();
        }
    }

    static byte[] openWork(String id) {
        java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(32);
        byte[] raw = id.getBytes(StandardCharsets.UTF_8);
        b.put((byte) raw.length);
        b.put(raw);
        byte[] out = new byte[b.position()];
        b.flip();
        b.get(out);
        return out;
    }

    static byte[] hello(String tokenHex) {
        byte[] token = TestKit.unhex(tokenHex);
        java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(64);
        b.put((byte) 0x01);
        b.put((byte) 0x01);
        b.put((byte) 0x03);
        b.put((byte) 0x41);
        b.put((byte) 0x00);
        b.put((byte) 0x20);
        b.put(token);
        byte[] payload = new byte[b.position()];
        b.flip();
        b.get(payload);
        return new Frame(FrameType.SALUDO, payload).encode();
    }

    static String postSession(int port) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            String body = "{\"memMiB\":128}";
            String req = "POST /seurat/v1/sesion HTTP/1.1" + CRLF + "Host: x" + CRLF + "Authorization: Bearer loopback" + CRLF + "Content-Length: "
                    + body.length() + CRLF + "Connection: close" + CRLF + CRLF + body;
            socket.getOutputStream().write(req.getBytes(StandardCharsets.UTF_8));
            byte[] response = socket.getInputStream().readAllBytes();
            String text = new String(response, StandardCharsets.UTF_8);
            TestKit.check(text.contains("201"), "POST /sesion 201:\n" + text);
            return text.split("\"token\":\"")[1].split("\"")[0];
        }
    }

    static byte[] datagram(byte[] gazePayload) {
        byte[] out = new byte[gazePayload.length + 1];
        out[0] = (byte) FrameType.MIRADA;
        System.arraycopy(gazePayload, 0, out, 1, gazePayload.length);
        return out;
    }

    static String wsHandshake(Socket socket, String extra) throws Exception {
        byte[] keyBytes = new byte[16];
        new java.util.Random().nextBytes(keyBytes);
        String key = Base64.getEncoder().encodeToString(keyBytes);
        String req = "GET /seurat/v1/lienzo-ws HTTP/1.1" + CRLF + "Host: x" + CRLF + "Upgrade: websocket" + CRLF
                + "Connection: Upgrade" + CRLF + "Sec-WebSocket-Key: " + key + CRLF
                + "Sec-WebSocket-Version: 13" + CRLF + extra + CRLF;
        socket.getOutputStream().write(req.getBytes(StandardCharsets.UTF_8));
        StringBuilder head = new StringBuilder();
        int b;
        while (!(head.length() >= 4
                && head.substring(head.length() - 4).equals(CRLF + CRLF))) {
            b = socket.getInputStream().read();
            head.append((char) b);
        }
        if (!head.toString().contains("101")) {
            return head.toString();
        }
        String accept = Base64.getEncoder().encodeToString(MessageDigest
                .getInstance("SHA-1").digest(
                        (key + WsHandshake.GUID)
                                .getBytes(StandardCharsets.UTF_8)));
        TestKit.check(head.toString().contains(accept), "WS accept key");
        TestKit.check(head.toString().contains("Sec-WebSocket-Protocol: seurat.1"), "subprotocol");
        return head.toString();
    }

    static byte[] frame(long type, byte[] payload) {
        return new Frame(type, payload).encode();
    }

    static void sendWs(OutputStream out, int channel, byte[] frame) throws Exception {
        byte[] message = new byte[frame.length + 1];
        message[0] = (byte) channel;
        System.arraycopy(frame, 0, message, 1, frame.length);
        byte[] mask = {1, 2, 3, 4};
        for (int i = 0; i < message.length; i++) {
            message[i] ^= mask[i % 4];
        }
        java.io.ByteArrayOutputStream head = new java.io.ByteArrayOutputStream();
        head.write(0x82);
        if (message.length < 126) {
            head.write(0x80 | message.length);
        } else {
            head.write(0x80 | 126);
            head.write(message.length >> 8);
            head.write(message.length);
        }
        head.write(mask, 0, 4);
        synchronized (out) {
            out.write(head.toByteArray());
            out.write(message);
            out.flush();
        }
    }

    static Frame readControl(InputStream in) throws Exception {
        for (;;) {
            WsFraming.Msg message = WsFraming.read(in, Integer.MAX_VALUE);
            if (message.opcode() == 0x2 && message.data().length > 0
                    && message.data()[0] == 0) {
                byte[] frame = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, frame, 0, frame.length);
                return Frame.decode(ByteBuffer.wrap(frame));
            }
        }
    }

    record Flows(List<Long> deliveries, boolean fin) {}

    static Flows readFlows(InputStream in, int want) throws Exception {
        List<Long> numbers = new ArrayList<>();
        boolean fin = false;
        long deadline = System.currentTimeMillis() + 20000;
        while ((numbers.size() < want || !fin) && System.currentTimeMillis() < deadline) {
            WsFraming.Msg message = WsFraming.read(in, Integer.MAX_VALUE);
            if (message.opcode() != 0x2 || message.data().length == 0) {
                continue;
            }
            if (message.data()[0] == 1) {
                byte[] flow = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, flow, 0, flow.length);
                var head = Headers.BrushHead.parse(ByteBuffer.wrap(flow));
                numbers.add(head.delivery());
            } else if (message.data()[0] == 0) {
                byte[] frame = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, frame, 0, frame.length);
                if (Frame.decode(ByteBuffer.wrap(frame)).type() == FrameType.PLAN) {
                    fin = true;
                }
            }
        }
        return new Flows(numbers, fin);
    }
}
