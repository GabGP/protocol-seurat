package seurat.adapters.out.disk;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import seurat.core.works.catalog.WorkArchive;
import seurat.core.works.catalog.WorkRecord;

/** Catalog persistence on disk: one meta.json per work under the works directory, read back on restart. */
public final class DiskArchive implements WorkArchive {
    private final Path worksDir;

    public DiskArchive(Path worksDir) throws IOException {
        this.worksDir = worksDir;
        Files.createDirectories(worksDir);
    }

    @Override
    public void save(WorkRecord work) throws IOException {
        Path dir = worksDir.resolve(work.meta.id());
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(StoreFiles.META), MetaJson.write(work));
    }

    @Override
    public Map<String, WorkRecord> recover() throws IOException {
        return WorkRecovery.readAll(worksDir);
    }
}
