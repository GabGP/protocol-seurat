package seurat.ingest;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import seurat.codec.YCoCgR;
import seurat.ingest.decode.RasterSamples;

/**
 * Spec 7.1 step 2 (SONDEO): the overview the master carries, if any, sampled at 1/q of the master
 * as the sketch's source. Only a reduced page of a TIFF pyramid qualifies: PNG and JPEG carry none,
 * and the master itself is never read for a sketch (the pass is its one sequential read).
 */
final class Overview {
    private Overview() {}

    /** YCoCg-R planes of {@code sw x sh} samples: sample (x, y) stands for master pixel (x q, y q). */
    record Sampled(int[][] e, int sw, int sh) {}

    /** The one format here whose pages can be a pyramid (JPEG's page count would scan the file). */
    private static final String PYRAMID_FORMAT = "tif";
    /** Page sizes may round: a page is the master reduced when both sides agree this closely. */
    private static final double ASPECT_TOLERANCE = 0.01;

    static Sampled probe(Path master, int w, int h, int q) throws IOException {
        try (ImageInputStream in = ImageIO.createImageInputStream(master.toFile())) {
            Iterator<ImageReader> it = in == null ? null : ImageIO.getImageReaders(in);
            if (it == null || !it.hasNext()) {
                return null;
            }
            ImageReader reader = it.next();
            try {
                if (!PYRAMID_FORMAT.equalsIgnoreCase(reader.getFormatName())) {
                    return null;
                }
                reader.setInput(in, false, true);
                int sw = (w + q - 1) / q;
                int sh = (h + q - 1) / q;
                int page = smallest(reader, w, h, sw, sh);
                return page < 0 ? null : sample(reader, page, w, h, q, sw, sh);
            } finally {
                reader.dispose();
            }
        }
    }

    /** The smallest reduced page still at least {@code sw x sh}, or -1. */
    private static int smallest(ImageReader reader, int w, int h, int sw, int sh) throws IOException {
        int best = -1;
        long bestPx = Long.MAX_VALUE;
        int pages = reader.getNumImages(true);
        for (int i = 1; i < pages; i++) {
            int pw = reader.getWidth(i);
            int ph = reader.getHeight(i);
            boolean reduced = pw < w && pw >= sw && ph >= sh
                    && Math.abs((double) pw / w - (double) ph / h) <= ASPECT_TOLERANCE * pw / w;
            if (reduced && (long) pw * ph < bestPx) {
                best = i;
                bestPx = (long) pw * ph;
            }
        }
        return best;
    }

    private static Sampled sample(ImageReader reader, int page, int w, int h, int q, int sw, int sh)
            throws IOException {
        int pw = reader.getWidth(page);
        int ph = reader.getHeight(page);
        ImageReadParam param = reader.getDefaultReadParam();
        int k = Math.max(1, Math.min(pw / sw, ph / sh)); // decode no finer than needed
        param.setSourceSubsampling(k, k, 0, 0);
        BufferedImage img = reader.read(page, param);
        RasterSamples samples = new RasterSamples(img);
        int[] line = new int[img.getWidth()];
        int[][] e = new int[3][sw * sh];
        for (int y = 0; y < sh; y++) {
            samples.row(Math.min(img.getHeight() - 1, (int) ((long) y * q * ph / h) / k), line);
            for (int x = 0; x < sw; x++) {
                int rgb = line[Math.min(img.getWidth() - 1, (int) ((long) x * q * pw / w) / k)];
                int[] v = YCoCgR.forward((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
                for (int c = 0; c < 3; c++) {
                    e[c][y * sw + x] = v[c];
                }
            }
        }
        return new Sampled(e, sw, sh);
    }
}
