package seurat.core.works.catalog;

import java.io.IOException;
import java.util.Map;

/** Catalog persistence port: each work meta survives a restart (spec 7). */
public interface WorkArchive {
    /** Writes the work meta, replacing what was stored for that work. */
    void save(WorkRecord work) throws IOException;

    /** Restart recovery: id to work, LISTA stores attached; files no book can still use are deleted. */
    Map<String, WorkRecord> recover() throws IOException;
}
