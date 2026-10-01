package seurat.kit;

import java.nio.file.Path;
import seurat.adapters.out.decode.Decoders;
import seurat.adapters.out.disk.DiskMasters;
import seurat.adapters.out.disk.DiskStores;
import seurat.core.works.ingest.port.IngestPorts;

/** The ingest ports the server wires, for tests that run a real pass over a works directory. */
public final class IngestKit {
    private IngestKit() {}

    public static IngestPorts ports(Path works) {
        return new IngestPorts(new Decoders(), new DiskStores(works), new DiskMasters(works));
    }
}
