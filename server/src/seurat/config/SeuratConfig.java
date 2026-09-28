package seurat.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Loads seurat.conf (key=value). All knobs have LAN-sane defaults. */
public final class SeuratConfig {
    public final int httpPort;
    public final Path inbox;
    public final Path works;
    public final Path coverage;
    public final String adminToken;
    public final int sessionMaxBrushes;
    public final long rateBytesPerSec;
    public final String logLevel;
    /** PKCS#12 keystore for TLS (https / wss); absent = plain LAN http / ws. */
    public final Path tlsKeystore;
    public final String tlsPassword;
    /** Spec 1.2: whether obras/<id>/master/ outlives its ingest (meta.json keepMaster). */
    public final boolean keepMaster;
    /** Extra Origins accepted on the WS upgrade besides the server's own (spec 9.2, CSWSH). */
    public final List<String> origins;
    /** Viewer accounts behind a Bearer key (spec 3.1); without one, a viewer is anonymous. */
    public final ViewerAccounts accounts;

    private SeuratConfig(Map<String, String> props, Path base) throws IOException {
        httpPort = intOf(props, "http.port", SeuratConstants.HTTP_PORT);
        inbox = dir(base, props.getOrDefault("inbox", ".seurat/runtime/inbox"));
        works = dir(base, props.getOrDefault("works", ".seurat/runtime/obras"));
        coverage = dir(base, props.getOrDefault("coverage", ".seurat/runtime/cobertura"));
        adminToken = props.getOrDefault("admin.token", "cambia-esto");
        sessionMaxBrushes = intOf(props, "session.max_brushes", 1024);
        rateBytesPerSec = Long.parseLong(props.getOrDefault("rate.bytes_per_s", "25000000"));
        logLevel = props.getOrDefault("log.level", "INFO");
        String ks = props.getOrDefault("tls.keystore", "");
        tlsKeystore = ks.isBlank() ? null : base.resolve(ks);
        tlsPassword = props.getOrDefault("tls.password", "");
        keepMaster = Boolean.parseBoolean(props.getOrDefault("ingest.keep_master", "true"));
        origins = List.of(props.getOrDefault("ws.origins", "").split("\\s*,\\s*")).stream()
                .filter(o -> !o.isBlank()).toList();
        accounts = new ViewerAccounts(props.getOrDefault("auth.accounts", ""));
    }

    public boolean tls() {
        return tlsKeystore != null;
    }

    public static SeuratConfig load(Path conf) throws IOException {
        Map<String, String> props = new HashMap<>();
        if (Files.exists(conf)) {
            for (String ln : Files.readAllLines(conf)) {
                String t = ln.trim();
                int eq = t.indexOf('=');
                if (!t.isEmpty() && !t.startsWith("#") && eq > 0) {
                    props.put(t.substring(0, eq).trim(), t.substring(eq + 1).trim());
                }
            }
        }
        Path base = conf.toAbsolutePath().getParent();
        return new SeuratConfig(props, base == null ? Path.of(".") : base);
    }

    private static Path dir(Path base, String rel) throws IOException {
        Path p = base.resolve(rel);
        Files.createDirectories(p);
        return p;
    }

    private static int intOf(Map<String, String> props, String k, int dflt) {
        try {
            return Integer.parseInt(props.getOrDefault(k, String.valueOf(dflt)));
        } catch (NumberFormatException ex) {
            return dflt;
        }
    }
}
