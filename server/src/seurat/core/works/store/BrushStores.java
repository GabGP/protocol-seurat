package seurat.core.works.store;

import java.io.IOException;

/** Where ingest gets its stores: one per edition of a work (edition 1 the sketch, edition 2 the full pass). */
public interface BrushStores {
    /** A new store for meta.id() in meta.edition(), tagged with the current quant table. */
    BrushSink create(WorkMeta meta, int[] nx, int[] ny) throws IOException;

    /** True when the sketch edition of the work already holds a seed (a pass cut short keeps it, spec 7.2). */
    boolean sketchKept(String id) throws IOException;
}
