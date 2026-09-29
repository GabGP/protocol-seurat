package seurat.net;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.ingest.IngestJob;
import seurat.kit.TestKit;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.Ranges;
import static seurat.net.http.HttpConstants.CRLF;

/** Loopback: HTTP + WS handshake + SALUDO..sketch + RECIBO, no internet. */
public final class WsLoopbackTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("loopback-test");
        Path works = root.resolve("obras");
        Catalog catalog = new Catalog(works);
        Path master = TestKit.masterPng(root, "loop.png", 2048, 1536);
        boolean[] ready = {false};
        new IngestJob("loop", "Loop", master, works, catalog, () -> ready[0] = true).run();
        TestKit.check(ready[0], "ingest ready");

        int port = WsClient.serve(root, catalog);
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(15000);
            String token = WsClient.postSession(port);
            WsClient.wsHandshake(socket, "Origin: http://x" + CRLF + "Sec-WebSocket-Protocol: seurat.1" + CRLF);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            WsClient.sendWs(out, 0, WsClient.hello(token));
            Frame welcome = WsClient.readControl(in);
            TestKit.check(welcome.type() == FrameType.BIENVENIDA, "BIENVENIDA");
            WsClient.sendWs(out, 0, new Frame(FrameType.CATALOGO, new byte[0]).encode());
            Frame work = WsClient.readControl(in);
            TestKit.check(work.type() == FrameType.OBRA, "OBRA listing, got " + work.type());
            WsClient.sendWs(out, 0, WsClient.frame(FrameType.ABRIR, WsClient.openWork("loop")));
            Frame opened = WsClient.readControl(in);
            TestKit.check(opened.type() == FrameType.ABIERTA, "ABIERTA");
            var openedMeta = MsgCatalog.WorkOpened.parse(opened.payload());
            TestKit.check(openedMeta.width() == 2048 && openedMeta.edition() == 2,
                    "ABIERTA dims/edition");
            Frame concession = WsClient.readControl(in);
            TestKit.check(concession.type() == FrameType.CONCESION, "CONCESION");
            Frame plan = WsClient.readControl(in);
            TestKit.check(plan.type() == FrameType.PLAN, "PLAN INICIO");
            var inicio = MsgGaze.Plan.parse(plan.payload());
            TestKit.check(inicio.expectedCount() > 0, "sketch planned");
            var flows = WsClient.readFlows(in, (int) inicio.expectedCount());
            TestKit.check(flows.deliveries().size() == inicio.expectedCount(),
                    "all sketch flows");
            Ranges.Builder done = new Ranges.Builder();
            for (long n : flows.deliveries()) {
                done.add(n);
            }
            var receipt = new MsgLoans.Receipt(openedMeta.handle(), done.build(), 40,
                    700, 0);
            WsClient.sendWs(out, 0, WsClient.frame(FrameType.RECIBO, receipt.encode()));
            TestKit.check(flows.fin(), "PLAN FIN interleaved");
            var gaze = new MsgGaze.Gaze(openedMeta.handle(), 1, 0, 0, 1024, 768, 1024, 768, 0);
            WsClient.sendWs(out, 2, WsClient.datagram(gaze.encode())); // channel 2 carries the datagram form
            Frame responseFrame = WsClient.readControl(in);
            if (responseFrame.type() == FrameType.CONCESION) {
                responseFrame = WsClient.readControl(in);
            }
            TestKit.check(responseFrame.type() == FrameType.PLAN, "PLAN response to channel 2 MIRADA");
            var gaze32 = new MsgGaze.Gaze(32, 2, 0, 0, 1024, 768, 1024, 768, 0);
            WsClient.sendWs(out, 2, WsClient.datagram(gaze32.encode()));
            Frame err;
            do {
                err = WsClient.readControl(in);
            } while (err.type() != FrameType.ERROR);
            var pe = seurat.proto.MsgError.ProtocolError.parse(err.payload());
            TestKit.check(pe.code() == 6 && pe.fail() == 0 && pe.refType() == FrameType.MIRADA,
                    "unknown handle: ERROR 6, ref_tipo = MIRADA");
        }
        System.out.println("WsLoopbackTest OK");
    }

}
