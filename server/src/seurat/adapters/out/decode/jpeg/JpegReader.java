package seurat.adapters.out.decode.jpeg;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.ForkJoinTask;
import java.util.stream.IntStream;
import seurat.core.shared.codec.Geometry;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.works.ingest.port.MasterReader;

/**
 * Streaming baseline JPEG master: one pass over the entropy-coded data, a few MCU rows (8 to 32
 * image rows each) at a time, so memory is a few rows and the decode is linear. ImageIO can only
 * restart from the top for each region past 2^31 px, which made big JPEG ingests quadratic. The
 * scan decodes the next group of MCU rows in order while the previous group goes through the IDCT
 * and is emitted in parallel. Emitting lags the IDCT by one MCU row, because the 2:1 vertical
 * chroma filter reads a row of the MCU row below.
 */
public final class JpegReader implements MasterReader {
    private static final int HEADER_BUFFER = 1 << 16;

    private final InputStream stream;
    private final JpegHeader j;
    private final JpegScan scan;
    /** MCU row m lives in {@code slots[m % slots.length]}: one group scanned while the other is painted. */
    private final JpegMcuRow[] slots;
    private final int per;
    private final int mcuHeight;
    private final int mcuRows;
    /** Consecutive bands alternate, so rows emitted ahead of a band never overwrite the one returned. */
    private int[][][] bands;
    private int scanned;
    private int idcted;
    private int emitted;
    private int row;

    private JpegReader(InputStream stream, JpegHeader j) {
        this.stream = stream;
        this.j = j;
        this.scan = new JpegScan(j, stream);
        this.mcuHeight = 8 * j.vMax;
        this.mcuRows = (j.height + mcuHeight - 1) / mcuHeight;
        this.per = Math.min(SeuratConstants.INGEST_JPEG_ROWS_IN_FLIGHT, Geometry.SIDE / mcuHeight);
        this.slots = new JpegMcuRow[2 * per];
        for (int i = 0; i < slots.length; i++) {
            slots[i] = new JpegMcuRow(j, scan.blocksPerRow);
        }
    }

    /** A streaming reader, or null when the file is not a JPEG this decoder handles. */
    public static JpegReader open(Path source) throws IOException {
        InputStream in = new BufferedInputStream(Files.newInputStream(source), HEADER_BUFFER);
        try {
            JpegHeader j = JpegHeader.read(new DataInputStream(in));
            if (j != null) {
                return new JpegReader(in, j);
            }
        } catch (IOException | RuntimeException ex) {
            // not a JPEG, or one this decoder does not stream: ImageIO decides
        }
        in.close();
        return null;
    }

    @Override
    public int width() { return j.width; }

    @Override
    public int height() { return j.height; }

    @Override
    public int[][] next() throws IOException {
        if (row >= j.height) return null;
        int n = Math.min(Geometry.SIDE, j.height - row);
        if (bands == null) bands = new int[2][Geometry.SIDE][j.width];
        int until = Math.min(mcuRows, (row + n + mcuHeight - 1) / mcuHeight);
        while (emitted < until) {
            step();
        }
        int[][] band = bands[(row / Geometry.SIDE) & 1];
        row += n;
        return n == Geometry.SIDE ? band : Arrays.copyOf(band, n);
    }

    /** IDCT and emit the scanned group while the scan decodes the next one. */
    private void step() throws IOException {
        if (scanned == idcted) scan();
        int i0 = idcted;
        int i1 = scanned;
        int e0 = emitted;
        int e1 = i1 == mcuRows ? i1 : i1 - 1;
        ForkJoinTask<?> paint = ForkJoinPool.commonPool().submit(() -> {
            IntStream.range(i0, i1).parallel().forEach(m -> slot(m).idct());
            IntStream.range(e0, e1).parallel().forEach(this::emit);
        });
        if (i1 < mcuRows) scan();
        paint.join();
        idcted = i1;
        emitted = e1;
    }

    private void scan() throws IOException {
        int g = Math.min(per, mcuRows - scanned);
        for (int i = 0; i < g; i++) {
            scan.decode(slot(scanned++).coef);
        }
    }

    private void emit(int m) {
        JpegMcuRow prev = m > 0 ? slot(m - 1) : null;
        JpegMcuRow next = m + 1 < mcuRows ? slot(m + 1) : null;
        int top = m * mcuHeight;
        for (int y = 0; y < mcuHeight && top + y < j.height; y++) {
            int at = top + y;
            slot(m).emit(m, y, bands[(at / Geometry.SIDE) & 1][at % Geometry.SIDE], prev, next);
        }
    }

    private JpegMcuRow slot(int m) { return slots[m % slots.length]; }

    @Override
    public double fraction() { return (double) row / Math.max(1, j.height); }

    @Override
    public void close() throws IOException { stream.close(); }
}
