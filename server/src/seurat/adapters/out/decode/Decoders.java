package seurat.adapters.out.decode;

import java.io.IOException;
import java.nio.file.Path;
import seurat.adapters.out.decode.imageio.ImageIoReader;
import seurat.adapters.out.decode.imageio.Overview;
import seurat.adapters.out.decode.jpeg.JpegReader;
import seurat.adapters.out.decode.png.PngReader;
import seurat.adapters.out.decode.psb.PsbReader;
import seurat.adapters.out.decode.tiff.TiffReader;
import seurat.core.works.ingest.port.MasterReader;
import seurat.core.works.ingest.port.MasterSource;

/**
 * The reader for a master, chosen by content, never by extension: the first streaming reader that
 * takes the file (PNG, baseline JPEG, TIFF/BigTIFF, PSB/PSD), else ImageIO. The streaming readers
 * decode in parallel and ignore embedded ICC profiles; docs/adr-03-ingest-decoders.md has the
 * benchmarks behind each choice.
 */
public final class Decoders implements MasterSource {
    @Override
    public MasterReader open(Path master) throws IOException {
        MasterReader r = PngReader.open(master);
        if (r == null) r = JpegReader.open(master);
        if (r == null) r = TiffReader.open(master);
        if (r == null) r = PsbReader.open(master);
        return r != null ? r : new ImageIoReader(master);
    }

    @Override
    public MasterSource.Sampled overview(Path master, int w, int h, int q) throws IOException {
        return Overview.probe(master, w, h, q);
    }

    @Override
    public boolean isWhole(Path master, long size) {
        return WholeFile.isWhole(master, size);
    }
}
