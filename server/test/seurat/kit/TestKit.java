package seurat.kit;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.imageio.ImageIO;
import seurat.codec.BrushId;
import seurat.store.BrushStore;
import seurat.store.WorkMeta;

/** In-memory store, recording mapping, synthetic masters. For tests only. */
public final class TestKit {
    private TestKit() {}

    public static void check(boolean cond, String msg) {
        if (!cond) {
            throw new AssertionError(msg);
        }
    }

    public static String hex(byte[] b) {
        return HexFormat.of().formatHex(b);
    }

    public static byte[] unhex(String s) {
        return HexFormat.of().parseHex(s);
    }

    /** A deterministic gradient + grid, w x h. */
    public static BufferedImage picture(int w, int h) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int r = (x * 255 / Math.max(1, w - 1) + y) & 0xFF;
                int g = (y * 255 / Math.max(1, h - 1) + x) & 0xFF;
                int b = ((x ^ y) + (x / 16 + y / 16) * 37) & 0xFF;
                img.setRGB(x, y, (r << 16) | (g << 8) | b);
            }
        }
        return img;
    }

    /** Master PNG of {@link #picture}. */
    public static Path masterPng(Path dir, String name, int w, int h) throws IOException {
        BufferedImage img = picture(w, h);
        Path out = dir.resolve(name);
        ImageIO.write(img, "png", out.toFile());
        return out;
    }

    /** Master JPEG (forces the ImageIO chunk path: no PNG streaming). */
    public static Path masterJpg(Path dir, String name, int w, int h) throws IOException {
        BufferedImage img = picture(w, h);
        Path out = dir.resolve(name);
        ImageIO.write(img, "jpg", out.toFile());
        return out;
    }
    public static class FixedStore implements BrushStore {
        private final WorkMeta meta;
        private final Map<String, byte[][]> bands = new ConcurrentHashMap<>();

        public FixedStore(WorkMeta meta) {
            this.meta = meta;
        }

        public void put(BrushId p, byte[]... bandBytes) {
            bands.put(p.stratum() + ":" + p.bx() + ":" + p.by(), bandBytes);
        }

        private byte[][] get(BrushId p) throws IOException {
            byte[][] found = bands.get(p.stratum() + ":" + p.bx() + ":" + p.by());
            if (found == null) {
                throw new IOException("missing brush " + p);
            }
            return found;
        }

        @Override
        public byte[][] bands(BrushId p, int from, int through) {
            byte[][] all = bands.get(p.stratum() + ":" + p.bx() + ":" + p.by());
            if (all == null) {
                throw new RuntimeException("missing brush " + p);
            }
            byte[][] out = new byte[through - from][];
            System.arraycopy(all, from, out, 0, out.length);
            return out;
        }

        @Override
        public void copy(BrushId p, int from, int through, OutputStream out)
                throws IOException {
            for (byte[] band : get(p)) {
                out.write(band);
            }
        }

        @Override
        public long bytes(BrushId p, int from, int through) throws IOException {
            long n = 0;
            byte[][] all = get(p);
            for (int i = from; i < through; i++) {
                n += all[i].length;
            }
            return n;
        }

        @Override
        public WorkMeta meta() {
            return meta;
        }
    }
}
