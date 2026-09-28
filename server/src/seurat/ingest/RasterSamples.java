package seurat.ingest;

import java.awt.color.ColorSpace;
import java.awt.image.BufferedImage;
import java.awt.image.ColorModel;
import java.awt.image.DataBuffer;
import java.awt.image.IndexColorModel;
import java.awt.image.Raster;

/**
 * Rows of a decoded ImageIO image as packed RGB, taken from the samples as stored: an embedded ICC
 * profile is ignored, as on every ingest path, so a master reads the same whichever reader streams
 * it. RGB and gray samples of 8 bits or more are read directly (wider samples keep their top 8
 * bits); a palette, samples under 8 bits, float samples and any other color space go through the
 * color model.
 */
final class RasterSamples {
    private static final int BITS = 8;
    private static final int RGB_BANDS = 3;

    private final BufferedImage img;
    private final Raster raster;
    private final boolean direct;
    private final int bands;
    private final int colors;
    private final int shift;
    private int[] samples;

    RasterSamples(BufferedImage img) {
        ColorModel cm = img.getColorModel();
        int type = cm.getColorSpace().getType();
        this.img = img;
        this.raster = img.getRaster();
        this.bands = raster.getNumBands();
        this.colors = cm.getNumColorComponents();
        this.shift = cm.getComponentSize(0) - BITS;
        int data = raster.getDataBuffer().getDataType();
        this.direct = !(cm instanceof IndexColorModel) && shift >= 0
                && data != DataBuffer.TYPE_FLOAT && data != DataBuffer.TYPE_DOUBLE
                && (type == ColorSpace.TYPE_RGB && colors == RGB_BANDS || type == ColorSpace.TYPE_GRAY && colors == 1);
    }

    /** Row {@code y} of the image into {@code out[0, width)}. */
    void row(int y, int[] out) {
        int w = img.getWidth();
        if (!direct) {
            img.getRGB(0, y, w, 1, out, 0, w);
            return;
        }
        if (samples == null) samples = new int[w * bands];
        raster.getPixels(0, y, w, 1, samples);
        int g = colors == 1 ? 0 : 1;
        int b = colors == 1 ? 0 : 2;
        for (int x = 0, i = 0; x < w; x++, i += bands) {
            out[x] = Pixels.rgb(samples[i] >> shift, samples[i + g] >> shift, samples[i + b] >> shift);
        }
    }
}
