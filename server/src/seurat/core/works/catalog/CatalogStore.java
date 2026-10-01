package seurat.core.works.catalog;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.works.store.StoreFiles;

/** meta.json on disk: one file per work under the works directory. */
final class CatalogStore {
    private final Path worksDir;

    CatalogStore(Path worksDir) throws IOException {
        this.worksDir = worksDir;
        Files.createDirectories(worksDir);
    }

    Path worksDir() {
        return worksDir;
    }

    void persist(WorkRecord work) throws IOException {
        Path dir = worksDir.resolve(work.meta.id());
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(StoreFiles.META), MetaJson.write(work));
    }
}
