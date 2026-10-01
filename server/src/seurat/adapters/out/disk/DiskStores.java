package seurat.adapters.out.disk;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.codec.Quant;
import seurat.core.works.store.BrushSink;
import seurat.core.works.store.BrushStores;
import seurat.core.works.store.WorkMeta;

/** Brush stores on disk: works/ID/ holds edition 2, works/ID/ed1/ the edition 1 sketch. */
public final class DiskStores implements BrushStores {
    private final Path worksDir;

    public DiskStores(Path worksDir) {
        this.worksDir = worksDir;
    }

    @Override
    public BrushSink create(WorkMeta meta, int[] nx, int[] ny) throws IOException {
        Path dir = dir(meta.id(), meta.edition());
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(StoreFiles.QUANT), Integer.toString(Quant.TABLE)); // FileBrushStore reads it
        return new FileBrushStore(dir, meta, nx, ny);
    }

    @Override
    public boolean sketchKept(String id) throws IOException {
        return SeedFile.present(dir(id, 1));
    }

    private Path dir(String id, long edition) {
        return edition == 1 ? worksDir.resolve(id).resolve(StoreFiles.SKETCH_DIR) : worksDir.resolve(id);
    }
}
