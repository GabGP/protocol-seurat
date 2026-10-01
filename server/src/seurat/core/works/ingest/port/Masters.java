package seurat.core.works.ingest.port;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.WorkRecord;

/** Where masters wait for their pass (spec 1.2): moved into their work, found again after a restart. */
public interface Masters {
    /** Moves an arriving master into its work, replacing an older one; one already there stays. */
    Path adopt(String id, Path incoming) throws IOException;

    /** The master a work holds, if any. */
    Optional<Path> find(String id);

    /** keepMaster=false: the ingest is over and the master goes. */
    void drop(String id);

    /** Spec 7.2: a work whose meta does not say LISTA is ingested again, from the master it kept. */
    default Map<String, Path> unfinished(Catalog catalog) {
        Map<String, Path> out = new LinkedHashMap<>();
        for (WorkRecord work : catalog.all()) {
            String id = work.meta.id();
            if (work.meta.state() != ProtoCodes.ST_LISTA) {
                find(id).ifPresent(m -> out.put(id, m));
            }
        }
        return out;
    }
}
