package seurat.ingest;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.proto.ProtoCodes;

/**
 * Spec 1.2 and 7.2: the master lives at {@code obras/<id>/master/<original>}. Only IngestJob
 * opens it and nothing serves it. With keepMaster=false it is deleted when the ingest ends; a
 * withdrawn work loses it with the rest of its directory (spec 7.4).
 */
public final class MasterHome {
    private static final String DIR = "master";

    private MasterHome() {}

    /** Moves an arriving master into its work, replacing an older one; one already there stays. */
    public static Path adopt(Path works, String id, Path incoming) throws IOException {
        Path home = works.resolve(id).resolve(DIR);
        if (incoming.toAbsolutePath().normalize().startsWith(home.toAbsolutePath().normalize())) {
            return incoming;
        }
        delete(home);
        Files.createDirectories(home);
        Path target = home.resolve(incoming.getFileName());
        try {
            Files.move(incoming, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ex) {
            Files.move(incoming, target); // inbox on another file system: copy, then delete
        }
        Log.info("ingest", "work=" + id + " master moved path=" + target);
        return target;
    }

    /** The master a work holds, if any. */
    public static Optional<Path> find(Path works, String id) {
        Path home = works.resolve(id).resolve(DIR);
        if (!Files.isDirectory(home)) {
            return Optional.empty();
        }
        try (var list = Files.list(home)) {
            return list.filter(Files::isRegularFile).findFirst();
        } catch (IOException ex) {
            return Optional.empty();
        }
    }

    /** Spec 7.2 "si meta.json no dice LISTA, se repite la pasada": the masters to ingest again. */
    public static Map<String, Path> unfinished(Catalog catalog, Path works) {
        Map<String, Path> out = new LinkedHashMap<>();
        for (WorkRecord work : catalog.all()) {
            String id = work.meta.id();
            if (work.meta.state() != ProtoCodes.ST_LISTA) {
                find(works, id).ifPresent(m -> out.put(id, m));
            }
        }
        return out;
    }

    /** keepMaster=false: the ingest is over and the master goes. */
    static void drop(Path works, String id) {
        try {
            delete(works.resolve(id).resolve(DIR));
            Log.info("ingest", "work=" + id + " master deleted keepMaster=false");
        } catch (IOException ex) {
            Log.warn("ingest", "work=" + id + " master delete failed: " + LogUnits.cause(ex));
        }
    }

    private static void delete(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (var walk = Files.walk(dir)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        }
    }
}
