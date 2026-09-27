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

/** ImageIO fallback reader with raster streaming for images exceeding 2^31-1 pixels. */
final class ImageIoReader implements MasterReader {
    private final ImageReader reader;
    private final ImageInputStream input;
    private final int width;
    private final int height;
    private final boolean useRaster;
    private int row;
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
    }

    @Override
    public int width() { return width; }

    @Override
    public int height() { return height; }

    @Override
    public int[][] next() throws IOException {
        if (row >= height) return null;
        int n = Math.min(256, height - row);
        if (bandBuffer == null) bandBuffer = new int[256][width];
        int[][] band = (n == 256) ? bandBuffer : java.util.Arrays.copyOf(bandBuffer, n);
        ImageReadParam param = reader.getDefaultReadParam();
        param.setSourceRegion(new Rectangle(0, row, width, n));
        if (useRaster) {
            readRasterBand(param, band, n);
        } else {
            try {
                BufferedImage img = reader.read(0, param);
                for (int y = 0; y < n; y++) img.getRGB(0, y, width, 1, band[y], 0, width);
            } catch (javax.imageio.IIOException ex) {
                if (reader.canReadRaster()) {
                    readRasterBand(param, band, n);
                } else {
                    throw ex;
                }
            }
        }
        row += n;
        return band;
    }

    private void readRasterBand(ImageReadParam param, int[][] band, int n) throws IOException {
        Raster raster = reader.readRaster(0, param);
        int bands = raster.getNumBands();
        int lineLen = width * bands;
        if (samples == null || samples.length < lineLen) samples = new int[lineLen];
        for (int y = 0; y < n; y++) {
            raster.getPixels(0, y, width, 1, samples);
            if (bands >= 3) {
                for (int x = 0; x < width; x++) {
                    int Y = samples[x * bands];
                    int Cb = samples[x * bands + 1] - 128;
                    int Cr = samples[x * bands + 2] - 128;
                    int r = Math.max(0, Math.min(255, (int) Math.round(Y + 1.402 * Cr)));
                    int g = Math.max(0, Math.min(255, (int) Math.round(Y - 0.344136 * Cb - 0.714136 * Cr)));
                    int b = Math.max(0, Math.min(255, (int) Math.round(Y + 1.772 * Cb)));
                    band[y][x] = (r << 16) | (g << 8) | b;
                }
            } else {
                for (int x = 0; x < width; x++) {
                    int v = samples[x];
                    band[y][x] = (v << 16) | (v << 8) | v;
                }
            }
        }
    }

    @Override
    public double fraction() { return (double) row / Math.max(1, height); }

    @Override
    public void close() throws IOException {
        try {
            reader.dispose();
        } finally {
            input.close();
        }
    }
}
