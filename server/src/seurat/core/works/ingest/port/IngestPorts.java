package seurat.core.works.ingest.port;

import seurat.core.works.store.BrushStores;

/** The outbound ports one ingest pass uses: the decoders, the brush stores and the masters home. */
public record IngestPorts(MasterSource source, BrushStores stores, Masters masters) {}
