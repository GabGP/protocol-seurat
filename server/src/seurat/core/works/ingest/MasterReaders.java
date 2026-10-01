package seurat.core.works.ingest;

import java.io.IOException;
import java.nio.file.Path;
import seurat.core.works.ingest.decode.ImageIoReader;
import seurat.core.works.ingest.decode.MasterReader;
import seurat.core.works.ingest.decode.jpeg.JpegReader;
import seurat.core.works.ingest.decode.png.PngReader;
import seurat.core.works.ingest.decode.psb.PsbReader;
import seurat.core.works.ingest.decode.tiff.TiffReader;

/**
 * The reader for a master, chosen by content, never by extension: the first streaming reader that
 * takes the file (PNG, baseline JPEG, TIFF/BigTIFF, PSB/PSD), else ImageIO. The streaming readers
 * decode in parallel and ignore embedded ICC profiles; docs/adr-03-ingest-decoders.md has the
 * benchmarks behind each choice.
 */
final class MasterReaders {
    private MasterReaders() {}

    static MasterReader open(Path master) throws IOException {
        MasterReader r = PngReader.open(master);
        if (r == null) r = JpegReader.open(master);
        if (r == null) r = TiffReader.open(master);
        if (r == null) r = PsbReader.open(master);
        return r != null ? r : new ImageIoReader(master);
    }
}
