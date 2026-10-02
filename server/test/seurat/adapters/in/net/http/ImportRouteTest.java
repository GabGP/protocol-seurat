package seurat.adapters.in.net.http;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import seurat.adapters.in.inbox.PathImport;
import seurat.adapters.in.inbox.PutUpload;
import seurat.adapters.in.inbox.Staging;
import seurat.adapters.in.inbox.UrlDownload;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;

/** Verifies POST /seurat/v1/importar origin check, local path gating and format handling. */
public final class ImportRouteTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("import-route-test");
        Path web = root.resolve("web");
        Files.createDirectories(web);
        Path conf = root.resolve("seurat.conf");
        Files.writeString(conf, "http.port=18080\n");
        SeuratConfig config = SeuratConfig.load(conf);
        Sessions sessions = new Sessions();
        Catalog catalog = new Catalog(new DiskArchive(root.resolve("obras")));
        Staging staging = new Staging(config.staging, config.inbox, catalog);
        PutUpload upload = new PutUpload(staging);
        PathImport paths = new PathImport(staging, List.of(config.inbox, config.works, config.staging));
        UrlDownload links = new UrlDownload(staging);
        List<Path> arrived = new ArrayList<>();
        IntakePorts intakePorts = new IntakePorts(upload, paths, links, arrived::add);
        HttpSurface http = new HttpSurface(web, sessions, catalog, config,
                intakePorts, w -> {});

        Path outsideDir = Files.createTempDirectory("import-src");
        Path outsideFile = outsideDir.resolve("sample.png");
        Files.write(outsideFile, new byte[]{1, 2, 3, 4});
        byte[] body = outsideFile.toAbsolutePath().toString().getBytes(StandardCharsets.UTF_8);

        var nonLocal = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of(), body, "localhost", null, body.length, false));
        TestKit.check(nonLocal.code() == 403, "path with local=false answers 403");
        TestKit.check(new String(nonLocal.body()).contains("solo local"), "403 body contains solo local");

        var local = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of(), body, "localhost", null, body.length, true));
        TestKit.check(local.code() == 202, "local path answers 202");
        String respStr = new String(local.body());
        TestKit.check(respStr.contains("\"modo\":\"enlace\"") || respStr.contains("\"modo\":\"copia\""),
                "response modo is enlace or copia");
        TestKit.check(respStr.contains("\"nombre\":\"sample.png\""), "response nombre is sample.png");
        TestKit.check(Files.exists(config.inbox.resolve("sample.png")), "file exists in inbox");
        TestKit.check(arrived.contains(config.inbox.resolve("sample.png")), "arrived consumer received file");

        var empty = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of(), new byte[0], "localhost", null, 0, true));
        TestKit.check(empty.code() == 400, "empty body answers 400");

        var blank = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of(), "   ".getBytes(StandardCharsets.UTF_8), "localhost", null, 3, true));
        TestKit.check(blank.code() == 400, "blank body answers 400");

        var foreign = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of("origin", "http://evil.example"), body, "localhost", null, body.length, true));
        TestKit.check(foreign.code() == 403, "foreign origin answers 403");

        byte[] ftpBody = "ftp://example.com/test.png".getBytes(StandardCharsets.UTF_8);
        var ftp = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                Map.of(), ftpBody, "localhost", null, ftpBody.length, true));
        TestKit.check(ftp.code() == 400, "ftp:// treated as path and refused with 400");

        byte[] payload = new byte[300 * 1024];
        Arrays.fill(payload, (byte) 42);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/streamed.png", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, payload.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(payload);
            }
        });
        server.start();
        try {
            int port = server.getAddress().getPort();
            byte[] streamBody = ("http://127.0.0.1:" + port + "/streamed.png").getBytes(StandardCharsets.UTF_8);
            var streamed = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                    Map.of("accept", "application/x-ndjson"), streamBody, "localhost", null, streamBody.length, false));
            TestKit.check(streamed.code() == 200, "streamed code 200");
            TestKit.check(streamed.stream() != null, "streamed stream not null");
            ByteArrayOutputStream streamOut = new ByteArrayOutputStream();
            streamed.stream().write(streamOut);
            String outStr = streamOut.toString(StandardCharsets.UTF_8);
            String[] lines = outStr.trim().split("\n");
            TestKit.check(outStr.contains("\"fase\":\"descargando\""), "contains fase descargando");
            TestKit.check(outStr.contains("\"total\":" + payload.length), "contains total equal to size");
            String lastLine = lines[lines.length - 1].trim();
            TestKit.check(lastLine.equals("{\"nombre\":\"streamed.png\",\"modo\":\"descarga\"}"), "last line on success");
            TestKit.check(Files.exists(config.inbox.resolve("streamed.png")), "streamed.png in inbox");
            TestKit.check(arrived.contains(config.inbox.resolve("streamed.png")), "arrived received streamed.png");

            byte[] missingBody = ("http://127.0.0.1:" + port + "/missing.png").getBytes(StandardCharsets.UTF_8);
            var missing = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                    Map.of("accept", "application/x-ndjson"), missingBody, "localhost", null, missingBody.length, false));
            TestKit.check(missing.code() == 200, "missing streamed code 200");
            TestKit.check(missing.stream() != null, "missing stream not null");
            ByteArrayOutputStream missingOut = new ByteArrayOutputStream();
            missing.stream().write(missingOut);
            String missingStr = missingOut.toString(StandardCharsets.UTF_8).trim();
            String[] missingLines = missingStr.split("\n");
            String missingLast = missingLines[missingLines.length - 1].trim();
            TestKit.check(missingLast.contains("\"codigo\":502"), "missing ends with codigo 502");

            Path dropFile = outsideDir.resolve("drop.png");
            Files.write(dropFile, new byte[]{9, 8, 7});
            byte[] dropBody = dropFile.toAbsolutePath().toString().getBytes(StandardCharsets.UTF_8);
            var dropResp = http.route(new HttpSurface.Request("POST", "/seurat/v1/importar",
                    Map.of("accept", "application/x-ndjson"), dropBody, "localhost", null, dropBody.length, true));
            TestKit.check(dropResp.stream() != null, "drop stream not null");
            dropResp.stream().write(new OutputStream() {
                @Override
                public void write(int b) throws IOException {
                    throw new IOException("viewer closed dialog");
                }
            });
            TestKit.check(Files.exists(config.inbox.resolve("drop.png")), "drop.png lands in inbox despite broken stream");
        } finally {
            server.stop(0);
        }

        System.out.println("ImportRouteTest OK");
    }
}
