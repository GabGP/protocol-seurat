package seurat.ingest;

import java.awt.Rectangle;
import java.awt.image.BufferedImage;
import java.awt.image.Raster;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import seurat.config.SeuratConstants;

/** ImageIO fallback reader with raster streaming for images exceeding 2^31-1 pixels. */
final class ImageIoReader implements MasterReader {
    private final ImageReader reader;
    private final ImageInputStream input;
    private final int width;
    private final int height;
    private final boolean useRaster;
    private final int chunkRows;
    private int row;
    private int[][] chunk;
    private int chunkOff;
    private int chunkLen;
    private int[][] bandBuffer;
    private int[] samples;

    ImageIoReader(Path source) throws IOException {
        this.input = ImageIO.createImageInputStream(source.toFile());
        if (input == null) throw new IOException("cannot open: " + source);
        Iterator<ImageReader> it = ImageIO.getImageReaders(input);
        if (!it.hasNext()) {
            input.close();
            throw new IOException("unsupported format: " + source);
        }
        this.reader = it.next();
        this.reader.setInput(input);
        this.width = reader.getWidth(0);
        this.height = reader.getHeight(0);
        this.useRaster = ((long) width * height > Integer.MAX_VALUE - 2) && reader.canReadRaster();
        int rows = SeuratConstants.INGEST_CHUNK_ROWS;
        while (rows > 256 && (long) rows * width * 4 > SeuratConstants.INGEST_CHUNK_BYTES) {
            rows -= 256;
        }
        this.chunkRows = rows;
    }

    @Override
    public int width() { return width; }

    @Override
    public int height() { return height; }

    @Override
    public int[][] next() throws IOException {
        if (chunkOff >= chunkLen) {
            if (row >= height) return null;
            fillChunk();
        }
        int n = Math.min(256, chunkLen - chunkOff);
        if (bandBuffer == null) bandBuffer = new int[256][width];
        int[][] band = (n == 256) ? bandBuffer : java.util.Arrays.copyOf(bandBuffer, n);
        for (int y = 0; y < n; y++) {
            System.arraycopy(chunk[chunkOff + y], 0, band[y], 0, width);
        }
        chunkOff += n;
        return band;
    }

    /** One tall decode; JPEG rescans MCU blocks once per chunk instead of per band. */
    private void fillChunk() throws IOException {
        int n = Math.min(chunkRows, height - row);
        if (chunk == null) chunk = new int[chunkRows][width];
        ImageReadParam param = reader.getDefaultReadParam();
        param.setSourceRegion(new Rectangle(0, row, width, n));
        if (useRaster) {
            readRasterBand(param, chunk, n);
        } else {
            try {
                BufferedImage img = reader.read(0, param);
                for (int y = 0; y < n; y++) img.getRGB(0, y, width, 1, chunk[y], 0, width);
            } catch (javax.imageio.IIOException ex) {
                if (reader.canReadRaster()) {
                    readRasterBand(param, chunk, n);
                } else {
                    throw ex;
                }
            }
        }
        row += n;
        chunkOff = 0;
        chunkLen = n;
    }

    private void readRasterBand(ImageReadParam param, int[][] band, int n) throws IOException {
        Raster raster = reader.readRaster(0, param);
        int bands = raster.getNumBands();
        int lineLen = width * bands;
        if (samples == null || samples.length < lineLen) samples = new int[lineLen];
        for (int y = 0; y < n; y++) {
            raster.getPixels(0, y, width, 1, samples);
            RasterRgb.row(samples, bands, band[y], width);
        }
    }

    @Override
    public double fraction() { return (double) (row - chunkLen + chunkOff) / Math.max(1, height); }

    @Override
    public void close() throws IOException {
        try {
            reader.dispose();
        } finally {
            input.close();
        }
    }
}
