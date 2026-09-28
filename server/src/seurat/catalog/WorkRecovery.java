package seurat.catalog;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import seurat.ingest.IngestJob;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;

/** Restart recovery: read meta.json per work and rebuild LISTA stores. */
final class WorkRecovery {
    private WorkRecovery() {
    }

    /** id -> work map rebuilt from disk; broken entries are skipped. */
    static Map<String, WorkRecord> readAll(Path worksDir) throws IOException {
        Map<String, WorkRecord> found = new HashMap<>();
        if (!Files.exists(worksDir)) return found;
        java.util.List<Path> doomed = new java.util.ArrayList<>(); // no book survives a restart
        try (var walk = Files.walk(worksDir)) {
            for (Path meta : walk.filter(p -> p.getFileName().toString().equals("meta.json")).toList()) {
                Path dir = meta.getParent();
                if (dir.getFileName().toString().equals("ed1")) continue;
                String defaultId = worksDir.relativize(dir).toString().replace('\\', '/');
                String json = Files.readString(meta);
                var info = MetaJson.read(defaultId, json);
                if (info.state() == ProtoCodes.ST_RETIRADA) {
                    doomed.add(dir); // withdrawn: its files can go now (spec 7.4)
                    continue;
                }
                if (info.state() == ProtoCodes.ST_LISTA && Files.isDirectory(dir.resolve("ed1"))) {
                    doomed.add(dir.resolve("ed1")); // superseded sketch nobody uses (spec 7.2)
                }
                String normId = normalize(info.id());
                if (!info.id().equals(normId) && found.containsKey(normId)) {
                    continue;
                }
                WorkRecord work = new WorkRecord(info);
                var ceilings = RolePolicy.merge(work.ceilings, MetaJson.ceilings(json));
                if (ceilings != null) {
                    work.ceilings.putAll(ceilings);
                }
                if (info.strata() > 0 && readyState(info.state())) {
                    attachStore(dir, info, work);
                }
                found.put(normId, work);
            }
        }
        for (Path dir : doomed) {
            try (var tree = Files.walk(dir)) {
                for (Path p : tree.sorted(java.util.Comparator.reverseOrder()).toList()) {
                    Files.deleteIfExists(p);
                }
            }
        }
        return found;
    }

    private static String normalize(String id) {
        return id.replaceAll("(?i)\\.(png|jpg|jpeg|tif|tiff)$", "");
    }

    private static void attachStore(Path dir, seurat.store.WorkMeta info, WorkRecord work)
            throws IOException {
        int top = info.strata() - 1;
        int[] nx = new int[top];
        int[] ny = new int[top];
        for (int stratum = 0; stratum < top; stratum++) {
            nx[stratum] = IngestJob.div256(IngestJob.padTo(info.width(), top) >> stratum);
            ny[stratum] = IngestJob.div256(IngestJob.padTo(info.height(), top) >> stratum);
        }
        Path storeDir = info.edition() == 1 && Files.exists(dir.resolve("ed1"))
                ? dir.resolve("ed1")
                : dir;
        Path seed = storeDir.resolve("semilla.bin");
        if (Files.isRegularFile(seed) && Files.size(seed) > 4) {
            work.store = new FileBrushStore(storeDir, info, nx, ny);
        }
    }

    private static boolean readyState(int state) {
        return state == ProtoCodes.ST_BOCETO || state == ProtoCodes.ST_LISTA;
    }
}
