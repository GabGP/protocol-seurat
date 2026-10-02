package seurat.adapters.in.inbox;

import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;

public final class UrlDownloadTest {
    public static void main(String[] args) throws Exception {
        byte[] scanBytes = new byte[]{1, 2, 3, 4};
        byte[] noextBytes = new byte[]{5, 6, 7, 8};
        byte[] cdBytes = new byte[]{9, 10, 11, 12};

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/scan.png", exchange -> {
            exchange.sendResponseHeaders(200, scanBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(scanBytes);
            }
        });
        server.createContext("/noext", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, noextBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(noextBytes);
            }
        });
        server.createContext("/cd", exchange -> {
            exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=cd.tif");
            exchange.sendResponseHeaders(200, cdBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(cdBytes);
            }
        });
        server.createContext("/missing", exchange -> {
            byte[] notFound = "Not Found".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(404, notFound.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(notFound);
            }
        });

        server.start();
        try {
            int port = server.getAddress().getPort();
            String base = "http://127.0.0.1:" + port;

            Path root = Files.createTempDirectory("url-download-test");
            Path inbox = root.resolve("inbox");
            Path staging = root.resolve("staging");
            Path works = root.resolve("obras");
            Files.createDirectories(inbox);
            Files.createDirectories(staging);
            Files.createDirectories(works);
            Catalog catalog = new Catalog(new DiskArchive(works));
            Staging s = new Staging(staging, inbox, catalog);
            UrlDownload download = new UrlDownload(s);

            Path scanFile = download.fetch(base + "/scan.png");
            TestKit.check(scanFile.equals(inbox.resolve("scan.png")), "scan.png in inbox");
            TestKit.check(Files.exists(scanFile), "scan.png exists");
            TestKit.check(Arrays.equals(Files.readAllBytes(scanFile), scanBytes), "scan.png bytes match");

            Path noextFile = download.fetch(base + "/noext");
            TestKit.check(noextFile.equals(inbox.resolve("noext.png")), "noext.png in inbox");
            TestKit.check(Files.exists(noextFile), "noext.png exists");
            TestKit.check(Arrays.equals(Files.readAllBytes(noextFile), noextBytes), "noext.png bytes match");

            Path cdFile = download.fetch(base + "/cd");
            TestKit.check(cdFile.equals(inbox.resolve("cd.tif")), "cd.tif in inbox");
            TestKit.check(Files.exists(cdFile), "cd.tif exists");
            TestKit.check(Arrays.equals(Files.readAllBytes(cdFile), cdBytes), "cd.tif bytes match");

            boolean threwUpstream = false;
            try {
                download.fetch(base + "/missing");
            } catch (IntakeRefused ex) {
                threwUpstream = (ex.reason == IntakeRefused.Reason.UPSTREAM);
            }
            TestKit.check(threwUpstream, "/missing 404 must throw UPSTREAM");
            try (var stream = Files.list(staging)) {
                TestKit.check(stream.findAny().isEmpty(), "staging must be empty after 404");
            }

            boolean threwUnsupported = false;
            try {
                download.fetch("ftp://x/a.png");
            } catch (IntakeRefused ex) {
                threwUnsupported = (ex.reason == IntakeRefused.Reason.UNSUPPORTED);
            }
            TestKit.check(threwUnsupported, "ftp URL must throw UNSUPPORTED");
        } finally {
            server.stop(0);
        }
        System.out.println("UrlDownloadTest OK");
    }
}
