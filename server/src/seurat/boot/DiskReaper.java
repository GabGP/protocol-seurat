package seurat.boot;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.store.StoreFiles;
import seurat.core.works.store.Trees;

/**
 * Deferred deletes on disk. A withdrawn work's files go once its last canvas is closed
 * and every book that references it has expired (spec 7.4, L + delta); a superseded
 * ed1/ goes once no canvas uses edition 1 (spec 7.2).
 */
public final class DiskReaper {
    private static final long ANY = 0;
    private final Path works;
    private final Sessions sessions;
    private final Catalog catalog;
    private final Set<String> retired = ConcurrentHashMap.newKeySet();
    private final Set<String> sketches = ConcurrentHashMap.newKeySet();

    public DiskReaper(Path works, Sessions sessions, Catalog catalog) {
        this.works = works;
        this.sessions = sessions;
        this.catalog = catalog;
    }

    public void retired(String id) {
        retired.add(id);
    }

    public void swapped(String id) {
        sketches.add(id);
    }

    /** Clock tick. */
    public void sweep() {
        for (String id : List.copyOf(retired)) {
            if (catalog.get(id) != null) {
                retired.remove(id); // uploaded again under the same id: nothing to delete
            } else if (!referenced(id, ANY) && delete(works.resolve(id))) {
                retired.remove(id);
            }
        }
        for (String id : List.copyOf(sketches)) {
            if (!referenced(id, 1) && delete(works.resolve(id).resolve(StoreFiles.SKETCH_DIR))) {
                sketches.remove(id);
            }
        }
    }

    private boolean referenced(String id, long edition) {
        List<Session> all = new ArrayList<>(sessions.all());
        all.addAll(sessions.graves());
        for (Session s : all) {
            for (Canvas c : s.canvases().values()) {
                if (c.workId().equals(id) && (edition == ANY || c.meta().edition() == edition
                        || c.book().holds(edition))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean delete(Path dir) {
        if (!Files.exists(dir)) {
            return true;
        }
        try {
            Trees.deleteRecursive(dir);
            Log.info(LogTags.REAPER, "deleted path=" + dir);
            return true;
        } catch (Exception ex) {
            Log.warn(LogTags.REAPER, "delete failed path=" + dir + ": " + LogUnits.cause(ex));
            return false;
        }
    }
}
