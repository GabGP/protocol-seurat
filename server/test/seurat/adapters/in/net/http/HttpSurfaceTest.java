package seurat.adapters.in.net.http;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
import seurat.core.works.catalog.WorkRecord;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

/** HTTP surface: static, session issue, obras routes. */
public final class HttpSurfaceTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("http-test");
        Path web = root.resolve("web");
        Files.createDirectories(web);
        Files.writeString(web.resolve("index.html"), "<html>viewer</html>");
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
        List<String> withdrawn = new ArrayList<>();
        HttpSurface http = new HttpSurface(web, sessions, catalog, config,
                intakePorts, withdrawn::add);

        var index = http.route(new HttpSurface.Request("GET", "/", Map.of(), new byte[0],
                "localhost"));
        TestKit.check(index.code() == 200
                && new String(index.body()).contains("viewer"), "GET / serves viewer");
        var withQuery = http.route(new HttpSurface.Request("GET", "/?render=fps,nocull", Map.of(),
                new byte[0], "localhost"));
        TestKit.check(withQuery.code() == 200 && withQuery.type().startsWith("text/html")
                && new String(withQuery.body()).contains("viewer"), "GET /?query serves viewer");
        var missing = http.route(new HttpSurface.Request("GET", "/nope", Map.of(),
                new byte[0], "localhost"));
        TestKit.check(missing.code() == 404, "GET 404");

        var favIco = http.route(new HttpSurface.Request("GET", "/favicon.ico", Map.of(),
                new byte[0], "localhost"));
        TestKit.check(favIco.code() == 200
                && favIco.type().equals("image/x-icon")
                && favIco.body().length > 0, "GET /favicon.ico serves fallback");

        var favSvg = http.route(new HttpSurface.Request("GET", "/favicon.svg", Map.of(),
                new byte[0], "localhost"));
        TestKit.check(favSvg.code() == 200
                && favSvg.type().equals("image/svg+xml")
                && new String(favSvg.body()).contains("<svg"), "GET /favicon.svg serves fallback");

        Files.writeString(web.resolve("favicon.svg"), "<svg>custom</svg>");
        var customSvg = http.route(new HttpSurface.Request("GET", "/favicon.svg", Map.of(),
                new byte[0], "localhost"));
        TestKit.check(customSvg.code() == 200
                && new String(customSvg.body()).contains("custom"), "GET /favicon.svg serves custom");

        Path assets = web.resolve("assets");
        Files.createDirectories(assets);
        Files.writeString(assets.resolve("synthesis.worker-12345.js"), "worker-body");
        var workerFallback = http.route(new HttpSurface.Request("GET",
                "/assets/synthesis.worker-99999.js", Map.of(), new byte[0], "localhost"));
        TestKit.check(workerFallback.code() == 200
                && new String(workerFallback.body()).contains("worker-body"), "worker fallback serves");
        TestKit.check(workerFallback.headers().get(HttpConstants.CACHE_CONTROL).equals(HttpConstants.NO_CACHE)
                && workerFallback.headers().containsKey(HttpConstants.ETAG),
                "worker fallback gets no-cache + ETag");
        var worker = http.route(new HttpSurface.Request("GET",
                "/assets/synthesis.worker-12345.js", Map.of(), new byte[0], "localhost"));
        String etag = worker.headers().get(HttpConstants.ETAG);
        TestKit.check(worker.code() == 200
                && worker.headers().get(HttpConstants.CACHE_CONTROL).equals(HttpConstants.NO_CACHE)
                && etag != null && !etag.isEmpty()
                && worker.headers().get(HttpConstants.COEP).equals("require-corp"),
                "a hashed worker asset gets no-cache + ETag + COEP");
        var matched = http.route(new HttpSurface.Request("GET",
                "/assets/synthesis.worker-12345.js", Map.of("If-None-Match", etag), new byte[0], "localhost"));
        TestKit.check(matched.code() == 304
                && matched.body().length == 0
                && matched.headers().get(HttpConstants.COEP).equals("require-corp")
                && matched.headers().get(HttpConstants.ETAG).equals(etag)
                && matched.headers().get(HttpConstants.CACHE_CONTROL).equals(HttpConstants.NO_CACHE),
                "a request with the matching If-None-Match gets 304, empty body, COEP present");
        var stale = http.route(new HttpSurface.Request("GET",
                "/assets/synthesis.worker-12345.js", Map.of("If-None-Match", "\"stale-etag\""), new byte[0], "localhost"));
        TestKit.check(stale.code() == 200
                && stale.body().length > 0
                && new String(stale.body()).contains("worker-body"),
                "a stale/different ETag gets 200 with the body");
        TestKit.check(index.headers().get(HttpConstants.CACHE_CONTROL).equals(HttpConstants.NO_CACHE)
                && index.headers().containsKey(HttpConstants.ETAG),
                "index.html carries no-cache and ETag");
        for (var page : java.util.List.of(index, worker, workerFallback, matched, stale)) {
            TestKit.check(page.headers().get(HttpConstants.COOP).equals("same-origin")
                    && page.headers().get(HttpConstants.COEP).equals("require-corp"),
                    "static answers are cross-origin isolated");
        }

        var sessionResp = http.route(new HttpSurface.Request("POST", "/seurat/v1/sesion",
                Map.of("authorization", "Bearer anything"), "{\"memMiB\":256}".getBytes(),
                "example.edu:8080"));
        String created = new String(sessionResp.body());
        TestKit.check(sessionResp.code() == 201 && created.contains("\"token\":\"")
                && created.contains("/seurat/v1/lienzo-ws"), "POST /sesion issues");
        TestKit.check(!created.contains("\"rol\"") && !created.contains("\"cuenta\"")
                && created.contains("\"local\":false"),
                "POST /sesion body contains no rol, no cuenta, and contains local");
        TestKit.check(sessionResp.headers().containsKey("Set-Cookie"),
                "without a cookie it sets the seurat_anon cookie");
        String cookieVal = sessionResp.headers().get("Set-Cookie");
        String cookieHeader = cookieVal.split(";")[0];
        String anonId = cookieHeader.substring(cookieHeader.indexOf('=') + 1);
        String token = created.split("\"token\":\"")[1].split("\"")[0];
        var issued = sessions.consumeToken(token);
        TestKit.check(issued != null && issued.principal().equals("viewer-" + anonId),
                "principal is viewer- + anonId");
        TestKit.check(sessions.consumeToken(token) == null, "token single-use");

        var reused = http.route(new HttpSurface.Request("POST", "/seurat/v1/sesion",
                Map.of("cookie", cookieHeader), new byte[0], "h"));
        TestKit.check(reused.code() == 201 && !reused.headers().containsKey("Set-Cookie"),
                "with a well-formed cookie no fresh cookie set");
        String reusedToken = new String(reused.body()).split("\"token\":\"")[1].split("\"")[0];
        var reusedIssued = sessions.consumeToken(reusedToken);
        TestKit.check(reusedIssued != null && reusedIssued.principal().equals("viewer-" + anonId),
                "with a well-formed cookie the principal is reused");

        var denied = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/x",
                Map.of(), new byte[]{1, 2, 3}, "h"));
        TestKit.check(denied.code() == 415, "PUT /seurat/v1/obras/x without extension answers 415");
        var put = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/img1.png",
                Map.of(), new byte[]{1, 2, 3}, "h"));
        TestKit.check(put.code() == 202, "PUT master without token answers 202");
        TestKit.check(Files.exists(config.inbox.resolve("img1.png")), "file exists in config.inbox");
        TestKit.check(arrived.equals(List.of(config.inbox.resolve("img1.png"))),
                "arrived consumer got it exactly once");
        var spaced = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/my%20scan.png",
                Map.of(), new byte[]{1, 2, 3}, "h"));
        TestKit.check(spaced.code() == 202 && Files.exists(config.inbox.resolve("my scan.png")),
                "PUT decodes the percent-encoded file name");
        var evilOrigin = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/img1.png",
                Map.of("origin", "http://evil.example"), new byte[]{1, 2, 3}, "h"));
        TestKit.check(evilOrigin.code() == 403, "PUT with foreign origin answers 403");
        catalog.register(new WorkRecord(new WorkMeta("img1", "img1", 512, 512, 256, 2, 3, 2, 0, 4)));
        var evilDelete = http.route(new HttpSurface.Request("DELETE", "/seurat/v1/obras/img1",
                Map.of("origin", "http://evil.example"), new byte[0], "h"));
        TestKit.check(evilDelete.code() == 403 && withdrawn.isEmpty(),
                "DELETE with foreign origin answers 403 and does not withdraw");
        var delete = http.route(new HttpSurface.Request("DELETE", "/seurat/v1/obras/img1",
                Map.of(), new byte[0], "h"));
        TestKit.check(delete.code() == 200 && withdrawn.equals(List.of("img1")),
                "DELETE with no headers succeeds and withdraw callback got id");
        var putPolitica = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/img1/politica",
                Map.of(), "{\"bandas\":[0,1]}".getBytes(), "h"));
        TestKit.check(putPolitica.code() != 200, "PUT /seurat/v1/obras/img1/politica no longer succeeds");
        TestKit.check(HttpSurface.number("{\"memMiB\":256}", "memMiB", 0) == 256,
                "json number");
        System.out.println("HttpSurfaceTest OK");
    }
}
