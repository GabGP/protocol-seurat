package seurat.adapters.out.disk;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import seurat.core.shared.codec.Geometry;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.MasterNames;
import seurat.core.works.catalog.WorkRecord;

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
            for (Path meta : walk.filter(p -> p.getFileName().toString().equals(StoreFiles.META)).toList()) {
                Path dir = meta.getParent();
                if (dir.getFileName().toString().equals(StoreFiles.SKETCH_DIR)) continue;
                String defaultId = worksDir.relativize(dir).toString().replace('\\', '/');
                String json = Files.readString(meta);
                var info = MetaJson.read(defaultId, json);
                if (info.state() == ProtoCodes.ST_RETIRADA) {
                    doomed.add(dir); // withdrawn: its files can go now (spec 7.4)
                    continue;
                }
                if (info.state() == ProtoCodes.ST_LISTA && Files.isDirectory(dir.resolve(StoreFiles.SKETCH_DIR))) {
                    doomed.add(dir.resolve(StoreFiles.SKETCH_DIR)); // superseded sketch nobody uses (spec 7.2)
                }
                String normId = normalize(info.id());
                if (!info.id().equals(normId) && found.containsKey(normId)) {
                    continue;
                }
                WorkRecord work = new WorkRecord(info);
                work.keepMaster = MetaJson.keepMaster(json);
                if (info.strata() > 0 && servable(info)) {
                    attachStore(dir, info, work);
                }
                found.put(normId, work);
            }
        }
        for (Path dir : doomed) {
            Trees.deleteRecursive(dir);
        }
        return found;
    }

    private static String normalize(String id) {
        return MasterNames.stem(id);
    }

    private static void attachStore(Path dir, seurat.core.works.store.WorkMeta info, WorkRecord work)
            throws IOException {
        int top = info.strata() - 1;
        int[] nx = new int[top];
        int[] ny = new int[top];
        for (int stratum = 0; stratum < top; stratum++) {
            nx[stratum] = Geometry.tiles(Geometry.padTo(info.width(), top) >> stratum);
            ny[stratum] = Geometry.tiles(Geometry.padTo(info.height(), top) >> stratum);
        }
        Path storeDir = info.edition() == 1 && Files.exists(dir.resolve(StoreFiles.SKETCH_DIR))
                ? dir.resolve(StoreFiles.SKETCH_DIR)
                : dir;
        if (SeedFile.present(storeDir)) {
            work.store = new FileBrushStore(storeDir, info, nx, ny);
        }
    }

    /** LISTA, or a pass that had a sketch to serve (spec 7.2: the edition 1 stays servable). */
    private static boolean servable(seurat.core.works.store.WorkMeta info) {
        int state = info.state();
        return state == ProtoCodes.ST_LISTA
                || ((state == ProtoCodes.ST_BOCETO || state == ProtoCodes.ST_PINTANDO) && info.edition() == 1);
    }
}
