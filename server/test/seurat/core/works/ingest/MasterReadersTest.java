package seurat.core.works.ingest;

import java.awt.Transparency;
import java.awt.color.ColorSpace;
import java.awt.image.BufferedImage;
import java.awt.image.ComponentColorModel;
import java.awt.image.DataBuffer;
import java.awt.image.WritableRaster;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.imageio.ImageIO;
import seurat.core.works.ingest.decode.ImageIoReader;
import seurat.core.works.ingest.decode.MasterReader;
import seurat.core.works.ingest.decode.jpeg.JpegReader;
import seurat.core.works.ingest.decode.png.PngReader;
import seurat.core.works.ingest.decode.psb.PsbFixture;
import seurat.core.works.ingest.decode.psb.PsbReader;
import seurat.core.works.ingest.decode.tiff.TiffFixture;
import seurat.core.works.ingest.decode.tiff.TiffLayout;
import seurat.core.works.ingest.decode.tiff.TiffReader;
import seurat.core.works.store.MasterNames;
import seurat.kit.TestKit;

/**
 * The reader each master gets, by content and not by name (every fixture here has the wrong
 * extension), and the ImageIO fallback reading samples as stored: a 16-bit linear-RGB TIFF keeps
 * the top byte of each sample, with no color conversion. Intake names and transfer completeness.
 */
public final class MasterReadersTest {
    private static final int W = 40;
    private static final int H = 30;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("master-readers");
        BufferedImage rgb = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
        is("PNG", write(rgb, "png", dir.resolve("a.jpg")), PngReader.class);
        is("JPEG", write(rgb, "jpg", dir.resolve("b.png")), JpegReader.class);
        is("TIFF", TiffFixture.write(dir.resolve("c.psb"), false, ByteOrder.BIG_ENDIAN, W, H, 3, TiffLayout.RGB,
                8, false, false, TiffFixture.samples(W, H, 3, 1)), TiffReader.class);
        is("PSB", PsbFixture.write(dir.resolve("d.tif"), true, 3, 8, PsbFixture.RAW, W, H,
                new byte[3][W * H]), PsbReader.class);
        is("GIF", write(rgb, "gif", dir.resolve("e.tif")), ImageIoReader.class);
        linear(dir.resolve("f.tif"));
        whole(TiffFixture.write(dir.resolve("g.tif"), true, ByteOrder.LITTLE_ENDIAN, W, H, 3, TiffLayout.RGB,
                8, true, false, TiffFixture.samples(W, H, 3, 2)));
        whole(PsbFixture.write(dir.resolve("h.psb"), true, 3, 8, PsbFixture.RLE, W, H, new byte[3][W * H]));
        TestKit.check(MasterNames.isMaster("x.PSD") && !MasterNames.isMaster("x.gif"), "master names");
        TestKit.check(MasterNames.stem("a.b.TIFF").equals("a.b"), "stem drops the master extension only");
        System.out.println("MasterReadersTest OK");
    }

    private static Path write(BufferedImage img, String format, Path file) throws Exception {
        TestKit.check(ImageIO.write(img, format, file.toFile()), format + ": fixture written");
        return file;
    }

    private static void is(String what, Path file, Class<?> want) throws Exception {
        try (MasterReader r = MasterReaders.open(file)) {
            TestKit.check(want.isInstance(r), what + " opens with " + want.getSimpleName() + ", got " + r);
            TestKit.check(r.width() == W && r.height() == H, what + ": " + W + "x" + H);
        }
    }

    /** Whole as written; one byte short, the directory (TIFF) or the last row (PSB) is cut. */
    private static void whole(Path file) throws Exception {
        byte[] all = Files.readAllBytes(file);
        TestKit.check(MasterFormats.isWhole(file, all.length), file.getFileName() + " is whole");
        String name = file.getFileName().toString();
        Path cut = Files.write(file.resolveSibling("cut-" + name), Arrays.copyOf(all, all.length - 1));
        TestKit.check(!MasterFormats.isWhole(cut, all.length - 1), name + " one byte short");
    }

    private static void linear(Path file) throws Exception {
        ComponentColorModel cm = new ComponentColorModel(ColorSpace.getInstance(ColorSpace.CS_LINEAR_RGB),
                false, false, Transparency.OPAQUE, DataBuffer.TYPE_USHORT);
        WritableRaster raster = cm.createCompatibleWritableRaster(W, H);
        for (int y = 0; y < H; y++) {
            for (int x = 0; x < W; x++) {
                raster.setPixel(x, y, new int[] {x * 1600, y * 2100, 0x8080});
            }
        }
        write(new BufferedImage(cm, raster, false, null), "tiff", file);
        try (MasterReader r = MasterReaders.open(file)) {
            TestKit.check(r instanceof ImageIoReader, "16-bit TIFF is left to ImageIO, got " + r);
            int[][] band = r.next();
            for (int y = 0; y < H; y++) {
                for (int x = 0; x < W; x++) {
                    int want = (x * 1600 >> 8) << 16 | (y * 2100 >> 8) << 8 | 0x80;
                    TestKit.check((band[y][x] & 0xFFFFFF) == want, "16-bit linear sample as stored at " + x + "," + y);
                }
            }
        }
    }
}
