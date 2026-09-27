package seurat.ingest;

import java.awt.image.BufferedImage;
import java.awt.image.Raster;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import seurat.codec.YCoCgR;

/** Thumbnail decode for the ed1 sketch. Raster-first: safe past 2^31-1 px. */
final class SketchFallback {
    private SketchFallback() {}

    static PngSubsampler.Subsampled thumbnail(Path master, int q) throws IOException {
        try (ImageInputStream in = ImageIO.createImageInputStream(master.toFile())) {
            if (in == null) return null;
            Iterator<ImageReader> it = ImageIO.getImageReaders(in);
            if (!it.hasNext()) return null;
            ImageReader reader = it.next();
            try {
                reader.setInput(in);
                var param = reader.getDefaultReadParam();
                param.setSourceSubsampling(q, q, 0, 0);
                if (reader.canReadRaster()) {
                    return fromRaster(reader.readRaster(0, param));
                }
                return fromImage(reader.read(0, param));
            } catch (javax.imageio.IIOException ex) {
                throw new IOException("sketch decode failed", ex);
            } finally {
                reader.dispose();
            }
        }
    }

    private static PngSubsampler.Subsampled fromRaster(Raster raster) {
        int sw = raster.getWidth(), sh = raster.getHeight();
        int bands = raster.getNumBands();
        int[][] e = new int[3][sw * sh];
        int[] samples = new int[sw * bands];
        int[] rgb = new int[sw];
        for (int y = 0; y < sh; y++) {
            raster.getPixels(0, y, sw, 1, samples);
            RasterRgb.row(samples, bands, rgb, sw);
            toYCoCg(rgb, e, y * sw, sw);
        }
        return new PngSubsampler.Subsampled(e, sw, sh);
    }

    private static PngSubsampler.Subsampled fromImage(BufferedImage img) {
        int sw = img.getWidth(), sh = img.getHeight();
        int[][] e = new int[3][sw * sh];
        int[] rgb = new int[sw];
        for (int y = 0; y < sh; y++) {
            img.getRGB(0, y, sw, 1, rgb, 0, sw);
            toYCoCg(rgb, e, y * sw, sw);
        }
        return new PngSubsampler.Subsampled(e, sw, sh);
    }

    private static void toYCoCg(int[] rgb, int[][] e, int off, int n) {
        for (int x = 0; x < n; x++) {
            int p = rgb[x];
            int[] v = YCoCgR.forward((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
            e[0][off + x] = v[0];
            e[1][off + x] = v[1];
            e[2][off + x] = v[2];
        }
    }
}
