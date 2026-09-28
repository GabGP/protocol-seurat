package seurat.ingest;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.ForkJoinTask;
import java.util.stream.IntStream;
import seurat.config.SeuratConstants;

/**
 * Streaming baseline JPEG master: one pass over the entropy-coded data, a few MCU rows (8 or 16
 * image rows each) at a time, so memory is a few rows and the decode is linear. ImageIO can only
 * restart from the top for each region past 2^31 px, which made big JPEG ingests quadratic. The
 * scan decodes a group of MCU rows in order while the previous group is painted in parallel.
 */
final class JpegReader implements MasterReader {
    private static final int HEADER_BUFFER = 1 << 16;

    private final InputStream stream;
    private final JpegHeader j;
    private final JpegScan scan;
    /** Two groups: the scan fills one while the other is painted. */
    private final JpegMcuRow[][] rows = new JpegMcuRow[2][SeuratConstants.INGEST_JPEG_ROWS_IN_FLIGHT];
    private int[][] bandBuffer;
    private int row;

    private JpegReader(InputStream stream, JpegHeader j) {
        this.stream = stream;
        this.j = j;
        this.scan = new JpegScan(j, stream);
        for (JpegMcuRow[] group : rows) {
            for (int i = 0; i < group.length; i++) {
                group[i] = new JpegMcuRow(j, scan.blocksPerRow);
            }
        }
    }

    /** A streaming reader, or null when the file is not a JPEG this decoder handles. */
    static JpegReader open(Path source) throws IOException {
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
        int n = Math.min(256, j.height - row);
        if (bandBuffer == null) bandBuffer = new int[256][j.width];
        int[][] band = n == 256 ? bandBuffer : java.util.Arrays.copyOf(bandBuffer, n);
        int mcuRows = 8 * j.vMax;
        int per = rows[0].length;
        int groups = (n + per * mcuRows - 1) / (per * mcuRows);
        decode(rows[0], Math.min(per, (n + mcuRows - 1) / mcuRows));
        for (int k = 0; k < groups; k++) {
            int first = k * per * mcuRows;
            JpegMcuRow[] group = rows[k & 1];
            int g = Math.min(per, (n - first + mcuRows - 1) / mcuRows);
            ForkJoinTask<?> painting = ForkJoinPool.commonPool().submit(() -> IntStream.range(0, g).parallel()
                    .forEach(i -> group[i].paint(band, first + i * mcuRows, Math.min(mcuRows, n - first - i * mcuRows))));
            if (k + 1 < groups) {
                int next = first + per * mcuRows;
                decode(rows[(k + 1) & 1], Math.min(per, (n - next + mcuRows - 1) / mcuRows));
            }
            painting.join();
        }
        row += n;
        return band;
    }

    private void decode(JpegMcuRow[] group, int g) throws IOException {
        for (int i = 0; i < g; i++) {
            scan.decode(group[i].coef);
        }
    }

    @Override
    public double fraction() { return (double) row / Math.max(1, j.height); }

    @Override
    public void close() throws IOException { stream.close(); }
}
