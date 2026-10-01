package seurat.core.works.ingest.decode.jpeg;

import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.stream.ImageOutputStream;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import seurat.core.works.ingest.decode.ImageIoReader;
import seurat.core.works.ingest.decode.MasterReader;
import seurat.kit.TestKit;

/**
 * Streaming JPEG decoder against the ImageIO path it replaces: identical RGB (same islow IDCT,
 * fancy upsampling and color tables) for 4:4:4 and every subsampling, restart markers honored,
 * gray equal to the stored samples, and progressive files left to ImageIO.
 */
public final class JpegReaderTest {
    private static final int W = 301;
    private static final int H = 530;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("jpeg-reader");
        BufferedImage rgb = picture(BufferedImage.TYPE_INT_RGB);
        same("4:4:4", write(dir.resolve("a.jpg"), rgb, 1, 1, 0, false));
        same("4:4:4 with restart markers", write(dir.resolve("b.jpg"), rgb, 1, 1, 7, false));
        gray(write(dir.resolve("c.jpg"), picture(BufferedImage.TYPE_BYTE_GRAY), 1, 1, 0, false));
        same("4:2:0", write(dir.resolve("d.jpg"), rgb, 2, 2, 0, false));
        same("4:2:0 with restart markers", write(dir.resolve("g.jpg"), rgb, 2, 2, 5, false));
        same("4:2:2", write(dir.resolve("h.jpg"), rgb, 2, 1, 0, false));
        same("4:4:0", write(dir.resolve("i.jpg"), rgb, 1, 2, 0, false));
        same("4:1:1", write(dir.resolve("k.jpg"), rgb, 4, 1, 0, false));
        same("luma 2x4", write(dir.resolve("l.jpg"), rgb, 2, 4, 3, false));
        TestKit.check(JpegReader.open(write(dir.resolve("e.jpg"), rgb, 2, 2, 0, true)) == null,
                "progressive JPEG is left to ImageIO");
        TestKit.check(JpegReader.open(Files.write(dir.resolve("f.jpg"), new byte[] {1, 2, 3})) == null,
                "not a JPEG");
        System.out.println("JpegReaderTest OK");
    }

    /** Smooth gradients plus noise and hard edges: every coefficient range gets exercised. */
    private static BufferedImage picture(int type) {
        BufferedImage img = new BufferedImage(W, H, type);
        Random rnd = new Random(11);
        for (int y = 0; y < H; y++) {
            for (int x = 0; x < W; x++) {
                int r = (x * 255 / W + rnd.nextInt(40)) & 255;
                int g = ((x / 17 + y / 23) % 2 == 0 ? 220 : 30) + rnd.nextInt(20);
                int b = (y * 255 / H) & 255;
                img.setRGB(x, y, r << 16 | Math.min(255, g) << 8 | b);
            }
        }
        return img;
    }

    /** Luma sampled {@code h} x {@code v}, chroma 1 x 1. */
    private static Path write(Path file, BufferedImage img, int h, int v, int restart, boolean progressive)
            throws Exception {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        if (progressive) {
            param.setProgressiveMode(ImageWriteParam.MODE_DEFAULT);
        }
        IIOMetadata meta = writer.getDefaultImageMetadata(new ImageTypeSpecifier(img), param);
        String format = "javax_imageio_jpeg_image_1.0";
        Element root = (Element) meta.getAsTree(format);
        NodeList specs = root.getElementsByTagName("componentSpec");
        for (int i = 0; i < specs.getLength(); i++) {
            ((Element) specs.item(i)).setAttribute("HsamplingFactor", Integer.toString(i == 0 ? h : 1));
            ((Element) specs.item(i)).setAttribute("VsamplingFactor", Integer.toString(i == 0 ? v : 1));
        }
        if (restart > 0) {
            Element dri = new javax.imageio.metadata.IIOMetadataNode("dri");
            dri.setAttribute("interval", Integer.toString(restart));
            Element seq = (Element) root.getElementsByTagName("markerSequence").item(0);
            seq.insertBefore(dri, seq.getFirstChild());
        }
        meta.setFromTree(format, root);
        try (ImageOutputStream out = ImageIO.createImageOutputStream(file.toFile())) {
            writer.setOutput(out);
            writer.write(null, new IIOImage(img, null, meta), param);
        }
        writer.dispose();
        return file;
    }

    /** Gray is the stored sample on every channel (getRGB on a gray image would gamma-shift it). */
    private static void gray(Path file) throws Exception {
        java.awt.image.Raster raw = ImageIO.read(file.toFile()).getRaster();
        try (MasterReader x = JpegReader.open(file)) {
            int y = 0;
            for (int[][] band = x.next(); band != null; band = x.next()) {
                for (int[] row : band) {
                    for (int i = 0; i < W; i++) {
                        int v = raw.getSample(i, y, 0);
                        TestKit.check(row[i] == (v << 16 | v << 8 | v), "gray sample at " + i + "," + y);
                    }
                    y++;
                }
            }
            TestKit.check(y == H, "gray: every row");
        }
    }

    private static void same(String what, Path file) throws Exception {
        long total = 0;
        int worst = 0;
        int rows = 0;
        try (MasterReader x = JpegReader.open(file); MasterReader y = new ImageIoReader(file)) {
            TestKit.check(x != null && x.width() == W && x.height() == H, what + ": streamed, " + W + "x" + H);
            for (int[][] p = x.next(), q = y.next(); p != null || q != null; p = x.next(), q = y.next()) {
                TestKit.check(p != null && q != null && p.length == q.length, what + ": same bands");
                for (int r = 0; r < p.length; r++, rows++) {
                    for (int i = 0; i < W; i++) {
                        for (int s = 0; s < 24; s += 8) {
                            int d = Math.abs((p[r][i] >> s & 255) - (q[r][i] >> s & 255));
                            worst = Math.max(worst, d);
                            total += d;
                        }
                    }
                }
            }
        }
        TestKit.check(rows == H, what + ": every row");
        TestKit.check(worst == 0, what + ": max diff " + worst + " (total " + total + ")");
    }
}
