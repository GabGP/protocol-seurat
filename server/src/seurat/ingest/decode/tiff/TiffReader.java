package seurat.ingest.decode.tiff;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import seurat.codec.Geometry;
import seurat.ingest.decode.MasterReader;

/**
 * Streaming TIFF/BigTIFF master ({@link TiffLayout} says which): each band decodes the strip or
 * tile rows it covers, every chunk of them in parallel, and keeps a chunk row that runs into the
 * next band. Memory is the chunk rows of one band; ImageIO's TIFF plugin decodes on one thread and
 * applies the embedded ICC profile, which this reader ignores like every other ingest path.
 */
public final class TiffReader implements MasterReader {

    private final TiffFile file;
    private final TiffLayout l;
    /** Decoded chunk rows by index; recycled once the band has moved past them. */
    private final Map<Integer, int[][]> held = new HashMap<>();
    private final ArrayDeque<int[][]> free = new ArrayDeque<>();
    private int row;

    private TiffReader(TiffFile file, TiffLayout l) {
        this.file = file;
        this.l = l;
    }

    /** A streaming reader, or null when the file is not a TIFF this reader handles. */
    public static TiffReader open(Path source) throws IOException {
        TiffFile f = TiffFile.open(source);
        if (f == null) return null;
        try {
            TiffLayout l = TiffLayout.of(f.firstIfd(TiffLayout.TAGS));
            if (l != null) return new TiffReader(f, l);
        } catch (IOException | RuntimeException ex) {
            // malformed directory: ImageIO decides
        }
        f.close();
        return null;
    }

    @Override
    public int width() { return l.width(); }

    @Override
    public int height() { return l.height(); }

    @Override
    public int[][] next() throws IOException {
        if (row >= l.height()) return null;
        int n = Math.min(Geometry.SIDE, l.height() - row);
        int ch = l.chunkH();
        int cy0 = row / ch;
        int cy1 = (row + n - 1) / ch;
        held.entrySet().removeIf(e -> e.getKey() < cy0 && free.add(e.getValue()));
        List<Integer> missing = new ArrayList<>();
        for (int cy = cy0; cy <= cy1; cy++) {
            if (!held.containsKey(cy)) {
                missing.add(cy);
                held.put(cy, free.isEmpty() ? new int[ch][l.width()] : free.pop());
            }
        }
        decode(missing);
        int[][] band = new int[n][];
        for (int i = 0; i < n; i++) {
            band[i] = held.get((row + i) / ch)[(row + i) % ch];
        }
        row += n;
        return band;
    }

    private void decode(List<Integer> chunkRows) throws IOException {
        int across = l.across();
        try {
            IntStream.range(0, chunkRows.size() * across).parallel().forEach(i -> {
                int cy = chunkRows.get(i / across);
                try {
                    TiffChunk.paint(file, l, cy, i % across, held.get(cy));
                } catch (IOException ex) {
                    throw new UncheckedIOException(ex);
                }
            });
        } catch (UncheckedIOException ex) {
            throw ex.getCause();
        }
    }

    @Override
    public double fraction() { return (double) row / Math.max(1, l.height()); }

    @Override
    public void close() throws IOException { file.close(); }
}
