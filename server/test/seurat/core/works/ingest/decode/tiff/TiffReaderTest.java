package seurat.core.works.ingest.decode.tiff;

import java.awt.image.BufferedImage;
import java.awt.image.WritableRaster;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.plugins.tiff.BaselineTIFFTagSet;
import javax.imageio.plugins.tiff.TIFFDirectory;
import javax.imageio.plugins.tiff.TIFFField;
import javax.imageio.stream.ImageOutputStream;
import seurat.core.works.ingest.decode.MasterReader;
import seurat.kit.TestKit;

/**
 * Streaming TIFF reader against the samples written: strips and tiles (partial at the right and
 * bottom edges), every supported compression, the horizontal predictor, BigTIFF in both byte
 * orders, gray both ways round, RGBA; and the layouts it leaves to ImageIO.
 */
public final class TiffReaderTest {
    private static final int W = 301;
    private static final int H = 530;
    private static final int TILE_W = 64;
    private static final int TILE_H = 48;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("tiff-reader");
        byte[] rgb = TiffFixture.samples(W, H, 3, 1);
        for (String c : new String[] {null, "LZW", "ZLib", "Deflate", "PackBits"}) {
            same("strips " + c, imageIo(dir.resolve("s" + c + ".tif"), rgb, c, false, false), rgb, 3, 0);
            same("tiles " + c, imageIo(dir.resolve("t" + c + ".tif"), rgb, c, true, false), rgb, 3, 0);
        }
        Path pred = imageIo(dir.resolve("p.tif"), rgb, "LZW", false, true);
        try (TiffFile f = TiffFile.open(pred)) {
            TestKit.check(f.firstIfd(Set.of(317)).get(317)[0] == 2, "fixture carries the predictor");
        }
        same("LZW with predictor", pred, rgb, 3, 0);
        same("tiled LZW with predictor", imageIo(dir.resolve("q.tif"), rgb, "LZW", true, true), rgb, 3, 0);
        same("BigTIFF raw, big-endian", TiffFixture.write(dir.resolve("b1.tif"), true, ByteOrder.BIG_ENDIAN,
                W, H, 3, TiffLayout.RGB, 7, false, false, rgb), rgb, 3, 0);
        same("BigTIFF Deflate + predictor", TiffFixture.write(dir.resolve("b2.tif"), true, ByteOrder.LITTLE_ENDIAN,
                W, H, 3, TiffLayout.RGB, 16, true, true, rgb), rgb, 3, 0);
        byte[] rgba = TiffFixture.samples(W, H, 4, 2);
        same("RGBA", TiffFixture.write(dir.resolve("a.tif"), false, ByteOrder.BIG_ENDIAN,
                W, H, 4, TiffLayout.RGB, 9, true, true, rgba), rgba, 4, 0);
        byte[] gray = TiffFixture.samples(W, H, 1, 3);
        same("WhiteIsZero, one strip", TiffFixture.write(dir.resolve("w.tif"), false, ByteOrder.LITTLE_ENDIAN,
                W, H, 1, TiffLayout.WHITE_IS_ZERO, H, false, false, gray), gray, 1, 0xFF);
        same("BlackIsZero Deflate", TiffFixture.write(dir.resolve("k.tif"), false, ByteOrder.LITTLE_ENDIAN,
                W, H, 1, TiffLayout.BLACK_IS_ZERO, 5, true, false, gray), gray, 1, 0);
        rejected("16-bit gray", ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_USHORT_GRAY), "tiff",
                dir.resolve("u.tif").toFile()), dir.resolve("u.tif"));
        rejected("palette", ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_BYTE_INDEXED), "tiff",
                dir.resolve("i.tif").toFile()), dir.resolve("i.tif"));
        rejected("JPEG-compressed", true, imageIo(dir.resolve("j.tif"), rgb, "JPEG", false, false));
        rejected("not a TIFF", true, Files.write(dir.resolve("n.tif"), new byte[] {'I', 'I', 42}));
        System.out.println("TiffReaderTest OK");
    }

    private static void rejected(String what, boolean written, Path file) throws Exception {
        TestKit.check(written, what + ": fixture written");
        TestKit.check(TiffReader.open(file) == null, what + ": left to ImageIO");
    }

    /** Every row equals the written samples: first three as RGB, or one as gray (flipped for WhiteIsZero). */
    private static void same(String what, Path file, byte[] px, int spp, int flip) throws Exception {
        int y = 0;
        try (MasterReader r = TiffReader.open(file)) {
            TestKit.check(r != null && r.width() == W && r.height() == H, what + ": streamed, " + W + "x" + H);
            for (int[][] band = r.next(); band != null; band = r.next()) {
                for (int[] row : band) {
                    for (int x = 0; x < W; x++) {
                        int i = (y * W + x) * spp;
                        int want = spp == 1 ? ((px[i] & 0xFF) ^ flip) * 0x010101
                                : (px[i] & 0xFF) << 16 | (px[i + 1] & 0xFF) << 8 | px[i + 2] & 0xFF;
                        TestKit.check((row[x] & 0xFFFFFF) == want, what + ": pixel " + x + "," + y);
                    }
                    y++;
                }
            }
        }
        TestKit.check(y == H, what + ": every row");
    }

    /** ImageIO's TIFF writer: strips (its default height) or tiles, a compression type, a predictor. */
    private static Path imageIo(Path file, byte[] px, String compression, boolean tiled, boolean predictor)
            throws Exception {
        BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_3BYTE_BGR);
        WritableRaster raster = img.getRaster();
        int[] s = new int[W * 3];
        for (int y = 0; y < H; y++) {
            for (int i = 0; i < s.length; i++) s[i] = px[y * s.length + i] & 0xFF;
            raster.setPixels(0, y, W, 1, s);
        }
        ImageWriter writer = ImageIO.getImageWritersByFormatName("tiff").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        if (compression != null) {
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionType(compression);
        }
        if (tiled) {
            param.setTilingMode(ImageWriteParam.MODE_EXPLICIT);
            param.setTiling(TILE_W, TILE_H, 0, 0);
        }
        IIOMetadata meta = writer.getDefaultImageMetadata(ImageTypeSpecifier.createFromRenderedImage(img), param);
        if (predictor) {
            TIFFDirectory d = TIFFDirectory.createFromMetadata(meta);
            d.addTIFFField(new TIFFField(BaselineTIFFTagSet.getInstance().getTag(BaselineTIFFTagSet.TAG_PREDICTOR),
                    BaselineTIFFTagSet.PREDICTOR_HORIZONTAL_DIFFERENCING));
            meta = d.getAsMetadata();
        }
        Files.deleteIfExists(file);
        try (ImageOutputStream out = ImageIO.createImageOutputStream(file.toFile())) {
            writer.setOutput(out);
            writer.write(null, new IIOImage(img, null, meta), param);
        } finally {
            writer.dispose();
        }
        return file;
    }
}
