package seurat.adapters.in.net.wt;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import seurat.adapters.in.net.h3.H3Headers;
import seurat.adapters.in.net.h3.H3Settings;
import seurat.adapters.in.net.h3.H3Wire;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.VarInt;
import seurat.core.viewing.session.Mapping;
import seurat.kit.TestKit;
import tech.kwik.core.QuicClientConnection;
import tech.kwik.core.QuicStream;
import tech.kwik.core.log.NullLogger;

public final class WtLoopbackTest {
    record ConnectResult(QuicStream stream, String status) {}

    public static void main(String[] args) throws Exception {
        Thread watchdog = Thread.ofPlatform().daemon(true).start(() -> {
            try { Thread.sleep(60_000); } catch (InterruptedException ex) { return; }
            System.err.println("WtLoopbackTest TIMEOUT");
            Runtime.getRuntime().halt(2);
        });

        SelfSignedCert cert = SelfSignedCert.generate(Instant.now());
        BlockingQueue<Mapping> mappings = new LinkedBlockingQueue<>();
        BlockingQueue<BlockingQueue<byte[]>> controls = new LinkedBlockingQueue<>();
        WtListener listener = WtListener.open(0, cert, List.of(), (mapping, control) -> {
            mappings.add(mapping);
            controls.add(control);
        });
        int port = listener.port();
        String authority = "localhost:" + port;
        String origin = "http://localhost:" + port;

        // 1. Refusals (one client)
        BlockingQueue<QuicStream> uni1 = new LinkedBlockingQueue<>();
        QuicClientConnection c1 = client(port, uni1);
        ConnectResult r404 = status(c1, authority, "/other", origin);
        TestKit.check("404".equals(r404.status()), "refusal 404 for /other");
        ConnectResult r403 = status(c1, authority, SeuratConstants.WT_PATH, "http://evil.example");
        TestKit.check("403".equals(r403.status()), "refusal 403 for evil origin");

        // 2. Session (a second client)
        BlockingQueue<QuicStream> uni2 = new LinkedBlockingQueue<>();
        QuicClientConnection c2 = client(port, uni2);
        ConnectResult r200 = status(c2, authority, SeuratConstants.WT_PATH, origin);
        TestKit.check("200".equals(r200.status()), "session 200 for valid connect");
        long session = r200.stream().getStreamId();

        // 3. The server's HTTP/3 control stream
        BlockingQueue<byte[]> controlStreams = new LinkedBlockingQueue<>();
        BlockingQueue<byte[]> wtUniStreams = new LinkedBlockingQueue<>();
        AtomicBoolean running = new AtomicBoolean(true);

        Thread.ofVirtual().start(() -> {
            while (running.get()) {
                try {
                    QuicStream s = uni2.poll(50, TimeUnit.MILLISECONDS);
                    if (s == null) continue;
                    Thread.ofVirtual().start(() -> {
                        try {
                            InputStream in = s.getInputStream();
                            long type = H3Wire.readVarint(in);
                            if (type == H3Settings.STREAM_CONTROL) {
                                int rem = H3Settings.controlPreface().length - 1;
                                controlStreams.add(in.readNBytes(rem));
                            } else if (type == H3Settings.WT_UNI_STREAM) {
                                wtUniStreams.add(in.readAllBytes());
                            }
                        } catch (Exception ignored) {}
                    });
                } catch (InterruptedException ignored) {
                    break;
                }
            }
        });

        byte[] prefaceRest = controlStreams.poll(5, TimeUnit.SECONDS);
        TestKit.check(prefaceRest != null, "server control stream received");
        byte[] expectedPreface = Arrays.copyOfRange(H3Settings.controlPreface(), 1, H3Settings.controlPreface().length);
        TestKit.check(Arrays.equals(prefaceRest, expectedPreface), "control preface matches");

        // 4. Control, client to server
        QuicStream control = c2.createStream(true);
        byte[] a = new Frame(FrameType.LATIDO, new byte[]{1, 2, 3, 4, 5, 6}).encode();
        int half = a.length / 2;
        OutputStream outControl = control.getOutputStream();
        outControl.write(VarInt.encode(H3Settings.WT_BIDI_STREAM));
        outControl.write(VarInt.encode(session));
        outControl.write(a, 0, half);
        outControl.flush();
        Thread.sleep(100);
        outControl.write(a, half, a.length - half);
        outControl.flush();

        Mapping mapping = mappings.poll(5, TimeUnit.SECONDS);
        TestKit.check(mapping != null, "mappings.poll not null");
        BlockingQueue<byte[]> serverControl = controls.poll(5, TimeUnit.SECONDS);
        TestKit.check(serverControl != null, "controls.poll not null");
        byte[] receivedA = serverControl.poll(5, TimeUnit.SECONDS);
        TestKit.check(Arrays.equals(receivedA, a), "split frame arrived whole");

        // 5. Control, server to client
        byte[] b = new Frame(FrameType.ECO, new byte[]{7, 8, 9}).encode();
        mapping.sendControl(b);
        byte[] receivedB = control.getInputStream().readNBytes(b.length);
        TestKit.check(Arrays.equals(receivedB, b), "server to client frame matches");

        // 6. Datagrams capability
        TestKit.check(mapping.datagrams(), "mapping.datagrams() is true");

        // 7. Delivery
        byte[] rnd = new byte[5000];
        new Random(42).nextBytes(rnd);
        try (OutputStream d = mapping.openDelivery(7)) {
            d.write(rnd);
        }
        byte[] deliveryPayload = wtUniStreams.poll(5, TimeUnit.SECONDS);
        TestKit.check(deliveryPayload != null, "delivery received");
        byte[] expectedDelivery = H3Wire.concat(VarInt.encode(session), rnd);
        TestKit.check(Arrays.equals(deliveryPayload, expectedDelivery), "delivery payload matches");

        // 8. Datagram
        c2.sendDatagram(H3Wire.concat(VarInt.encode(session / 4), VarInt.encode(FrameType.MIRADA), new byte[]{9, 8, 7}));
        byte[] gazeExpected = new Frame(FrameType.MIRADA, new byte[]{9, 8, 7}).encode();
        byte[] gazeReceived = serverControl.poll(5, TimeUnit.SECONDS);
        TestKit.check(Arrays.equals(gazeReceived, gazeExpected), "mirada datagram yielded frame");

        c2.sendDatagram(H3Wire.concat(VarInt.encode(session / 4), VarInt.encode(FrameType.LATIDO), new byte[]{9, 8, 7}));
        byte[] nonMirada = serverControl.poll(300, TimeUnit.MILLISECONDS);
        TestKit.check(nonMirada == null, "non-mirada datagram dropped");

        // 9. Cancel
        OutputStream d9 = mapping.openDelivery(9);
        d9.write(new byte[100]);
        mapping.cancel(9);
        boolean threwCancel = false;
        try {
            d9.close();
        } catch (IOException expected) {
            threwCancel = true;
        }
        TestKit.check(threwCancel, "cancelled delivery close threw IOException");

        // 10. Last frame before close
        byte[] c2Frame = new Frame(FrameType.ECO, new byte[]{42, 43}).encode();
        mapping.sendControl(c2Frame);
        mapping.close();
        InputStream controlIn = control.getInputStream();
        byte[] lastReceived = controlIn.readNBytes(c2Frame.length);
        TestKit.check(Arrays.equals(lastReceived, c2Frame), "last frame received before close");

        CompletableFuture<Boolean> streamEnded = new CompletableFuture<>();
        Thread.ofVirtual().start(() -> {
            try {
                int r = controlIn.read();
                streamEnded.complete(r == -1);
            } catch (IOException ex) {
                streamEnded.complete(true);
            } catch (Throwable t) {
                streamEnded.completeExceptionally(t);
            }
        });
        TestKit.check(Boolean.TRUE.equals(streamEnded.get(5, TimeUnit.SECONDS)), "stream ended within 5s");

        // 11. Peer close (a third client)
        BlockingQueue<QuicStream> uni3 = new LinkedBlockingQueue<>();
        QuicClientConnection c3 = client(port, uni3);
        ConnectResult r3 = status(c3, authority, SeuratConstants.WT_PATH, origin);
        TestKit.check("200".equals(r3.status()), "c3 status 200");
        long session3 = r3.stream().getStreamId();

        QuicStream control3 = c3.createStream(true);
        byte[] latido3 = new Frame(FrameType.LATIDO, new byte[]{1, 2, 3}).encode();
        OutputStream out3 = control3.getOutputStream();
        out3.write(VarInt.encode(H3Settings.WT_BIDI_STREAM));
        out3.write(VarInt.encode(session3));
        out3.write(latido3);
        out3.flush();

        Mapping mapping3 = mappings.poll(5, TimeUnit.SECONDS);
        TestKit.check(mapping3 != null, "mapping3 not null");
        BlockingQueue<byte[]> serverControl3 = controls.poll(5, TimeUnit.SECONDS);
        TestKit.check(serverControl3 != null, "serverControl3 not null");
        byte[] rec3 = serverControl3.poll(5, TimeUnit.SECONDS);
        TestKit.check(Arrays.equals(rec3, latido3), "c3 frame received");

        c3.close();
        byte[] empty = serverControl3.poll(10, TimeUnit.SECONDS);
        TestKit.check(empty != null && empty.length == 0, "control queue yields empty array on peer close");

        running.set(false);
        try { c1.close(); } catch (Exception ignored) {}
        try { c2.close(); } catch (Exception ignored) {}
        try { listener.close(); } catch (Exception ignored) {}
        System.out.println("WtLoopbackTest OK");
        System.exit(0);
    }

    private static QuicClientConnection client(int port, BlockingQueue<QuicStream> uniStreams) throws Exception {
        QuicClientConnection c = QuicClientConnection.newBuilder()
                .uri(URI.create("https://127.0.0.1:" + port))
                .applicationProtocol("h3")
                .noServerCertificateCheck()
                .enableDatagramExtension()
                .maxOpenPeerInitiatedUnidirectionalStreams(32)
                .maxOpenPeerInitiatedBidirectionalStreams(8)
                .logger(new NullLogger())
                .build();
        c.setPeerInitiatedStreamCallback(uniStreams::add);
        c.connect();
        return c;
    }

    private static ConnectResult status(QuicClientConnection c, String authority, String path, String origin) throws Exception {
        QuicStream request = c.createStream(true);
        request.getOutputStream().write(H3Wire.frame(H3Settings.FRAME_HEADERS, H3Headers.encode(List.of(
                Map.entry(":method", "CONNECT"), Map.entry(":protocol", "webtransport"),
                Map.entry(":scheme", "https"), Map.entry(":authority", authority),
                Map.entry(":path", path), Map.entry("origin", origin)))));
        request.getOutputStream().flush();
        InputStream in = request.getInputStream();
        TestKit.check(H3Wire.readVarint(in) == H3Settings.FRAME_HEADERS, "expected FRAME_HEADERS");
        var headers = H3Headers.decode(H3Wire.readPayload(in, 4096));
        String status = headers.stream()
                .filter(e -> ":status".equals(e.getKey()))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElseGet(() -> headers.isEmpty() ? "" : headers.get(0).getValue());
        return new ConnectResult(request, status);
    }
}
