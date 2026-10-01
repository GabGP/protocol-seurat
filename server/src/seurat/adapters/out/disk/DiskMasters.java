package seurat.adapters.out.disk;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Optional;
import seurat.core.works.ingest.port.Masters;

/** Masters on disk, under works/ID/master/ (MasterHome). */
public final class DiskMasters implements Masters {
    private final Path worksDir;

    public DiskMasters(Path worksDir) {
        this.worksDir = worksDir;
    }

    @Override
    public Path adopt(String id, Path incoming) throws IOException {
        return MasterHome.adopt(worksDir, id, incoming);
    }

    @Override
    public Optional<Path> find(String id) {
        return MasterHome.find(worksDir, id);
    }

    @Override
    public void drop(String id) {
        MasterHome.drop(worksDir, id);
    }
}
