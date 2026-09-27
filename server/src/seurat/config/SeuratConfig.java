package seurat.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
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

    private SeuratConfig(int httpPort, Path inbox, Path works, Path coverage,
            String adminToken, int sessionMax, long rate,
            String logLevel) {
        this.httpPort = httpPort;
        this.inbox = inbox;
        this.works = works;
        this.coverage = coverage;
        this.adminToken = adminToken;
        this.sessionMaxBrushes = sessionMax;
        this.rateBytesPerSec = rate;
        this.logLevel = logLevel;
    }

    public static SeuratConfig load(Path conf) throws IOException {
        Map<String, String> props = new HashMap<>();
        if (Files.exists(conf)) {
            for (String ln : Files.readAllLines(conf)) {
                String t = ln.trim();
                if (t.isEmpty() || t.startsWith("#")) {
                    continue;
                }
                int eq = t.indexOf('=');
                if (eq > 0) {
                    props.put(t.substring(0, eq).trim(), t.substring(eq + 1).trim());
                }
            }
        }
        Path base = conf.toAbsolutePath().getParent();
        if (base == null) {
            base = Path.of(".");
        }
        Path inbox = base.resolve(strOf(props, "inbox", ".seurat/runtime/inbox"));
        Path works = base.resolve(strOf(props, "works", ".seurat/runtime/obras"));
        Path coverage = base.resolve(strOf(props, "coverage", ".seurat/runtime/cobertura"));
        Files.createDirectories(inbox);
        Files.createDirectories(works);
        Files.createDirectories(coverage);
        return new SeuratConfig(
                intOf(props, "http.port", SeuratConstants.HTTP_PORT),
                inbox,
                works,
                coverage,
                strOf(props, "admin.token", "cambia-esto"),
                intOf(props, "session.max_brushes", 1024),
                Long.parseLong(strOf(props, "rate.bytes_per_s", "25000000")),
                strOf(props, "log.level", "INFO"));
    }

    private static String strOf(Map<String, String> props, String k, String dflt) {
        return props.getOrDefault(k, dflt);
    }

    private static int intOf(Map<String, String> props, String k, int dflt) {
        try {
            return Integer.parseInt(props.getOrDefault(k, String.valueOf(dflt)));
        } catch (NumberFormatException ex) {
            return dflt;
        }
    }
}
