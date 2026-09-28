package seurat.net.http;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConfig;
import seurat.kit.TestKit;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

/** HTTP surface: static, session issue, admin obras routes. */
public final class HttpSurfaceTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("http-test");
        Path web = root.resolve("web");
        Files.createDirectories(web);
        Files.writeString(web.resolve("index.html"), "<html>viewer</html>");
        Path conf = root.resolve("seurat.conf");
        Files.writeString(conf, "http.port=18080\nadmin.token=test-admin\n");
        SeuratConfig config = SeuratConfig.load(conf);
        Sessions sessions = new Sessions();
        Catalog catalog = new Catalog(root.resolve("obras"));
        List<String> masters = new ArrayList<>();
        List<String> policies = new ArrayList<>();
        List<String> withdrawn = new ArrayList<>();
        HttpSurface http = new HttpSurface(web, sessions, catalog, config,
                (id, file) -> masters.add(id), policies::add, withdrawn::add);

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

        var sessionResp = http.route(new HttpSurface.Request("POST", "/seurat/v1/sesion",
                Map.of("authorization", "Bearer abc"), "{\"memMiB\":256}".getBytes(),
                "example.edu:8080"));
        String created = new String(sessionResp.body());
        TestKit.check(sessionResp.code() == 201 && created.contains("\"token\":\"")
                && created.contains("/seurat/v1/lienzo-ws"), "POST /sesion issues");
        String token = created.split("\"token\":\"")[1].split("\"")[0];
        TestKit.check(sessions.consumeToken(token) != null, "token single-use valid");

        var denied = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/x",
                Map.of(), new byte[0], "h"));
        TestKit.check(denied.code() == 403, "PUT without admin denied");
        var put = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/img1",
                Map.of("x-admin-token", "test-admin"), new byte[]{1, 2, 3}, "h"));
        TestKit.check(put.code() == 202 && masters.equals(List.of("img1"))
                && Files.exists(config.inbox.resolve("img1")), "PUT master to inbox");
        catalog.register(new WorkRecord(new WorkMeta("img1", "img1", 512, 512, 256, 2, 3, 2, 0, 2)));
        var policy = http.route(new HttpSurface.Request("PUT",
                "/seurat/v1/obras/img1/politica", Map.of("x-admin-token", "test-admin"),
                "{\"autenticado\":[1,4]}".getBytes(), "h"));
        TestKit.check(policy.code() == 200 && policies.equals(List.of("img1"))
                && catalog.get("img1").ceiling("autenticado")[0] == 1, "PUT politica");
        for (String body : new String[]{"{\"privilegiado\":[2,4]}", "{\"anonimo\":[0,5]}", "{\"anonimo\":[x]}"}) {
            var bad = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/img1/politica",
                    Map.of("x-admin-token", "test-admin"), body.getBytes(), "h"));
            TestKit.check(bad.code() == 400 && policies.size() == 1, "400 for " + body);
        }
        var unknown = http.route(new HttpSurface.Request("PUT", "/seurat/v1/obras/zzz/politica",
                Map.of("x-admin-token", "test-admin"), "{\"anonimo\":[1,4]}".getBytes(), "h"));
        TestKit.check(unknown.code() == 404, "PUT politica on an unknown work");
        var delete = http.route(new HttpSurface.Request("DELETE", "/seurat/v1/obras/img1",
                Map.of("x-admin-token", "test-admin"), new byte[0], "h"));
        TestKit.check(delete.code() == 200 && withdrawn.equals(List.of("img1")), "DELETE");
        TestKit.check(HttpSurface.number("{\"memMiB\":256}", "memMiB", 0) == 256,
                "json number");
        TestKit.check(HttpSurface.pair("{\"a\":[1,4]}", "a")[1] == 4, "json pair");
        System.out.println("HttpSurfaceTest OK");
    }
}
