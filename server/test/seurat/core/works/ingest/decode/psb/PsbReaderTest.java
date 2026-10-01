package seurat.core.works.ingest.decode.psb;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;
import seurat.core.works.ingest.decode.MasterReader;
import seurat.core.works.ingest.decode.PackBits;
import seurat.kit.TestKit;

/**
 * Streaming Photoshop reader against the planes written: PSD and PSB, raw and RLE, RGB with an
 * extra alpha channel, gray, a partial last band; and the files it rejects.
 */
public final class PsbReaderTest {
    private static final int W = 257;
    private static final int H = 600;
    private static final int RGB = 3;
    private static final int GRAY = 1;
    private static final int CMYK = 4;
    private static final int ZIP = 2;

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("psb-reader");
        byte[][] rgba = planes(4, 5);
        byte[][] gray = planes(1, 6);
        for (boolean psb : new boolean[] {false, true}) {
            for (int c : new int[] {PsbFixture.RAW, PsbFixture.RLE}) {
                String what = (psb ? "PSB" : "PSD") + (c == PsbFixture.RLE ? " RLE" : " raw");
                same(what + " RGBA", PsbFixture.write(dir.resolve(what + "a"), psb, RGB, 8, c, W, H, rgba), rgba);
                same(what + " gray", PsbFixture.write(dir.resolve(what + "g"), psb, GRAY, 8, c, W, H, gray), gray);
            }
        }
        packBits();
        rejected("16-bit", PsbFixture.write(dir.resolve("d"), true, RGB, 16, PsbFixture.RAW, W, H, rgba));
        rejected("CMYK", PsbFixture.write(dir.resolve("m"), true, CMYK, 8, PsbFixture.RAW, W, H, rgba));
        rejected("ZIP data", PsbFixture.write(dir.resolve("z"), true, RGB, 8, ZIP, W, H, rgba));
        rejected("RGB short of channels", PsbFixture.write(dir.resolve("s"), true, RGB, 8, 0, W, H, gray));
        rejected("not Photoshop", Files.write(dir.resolve("n"), new byte[] {'8', 'B', 'P', 'S'}));
        System.out.println("PsbReaderTest OK");
    }

    /** Flat areas (repeat runs) beside noise (literals) in every row. */
    private static byte[][] planes(int channels, long seed) {
        Random rnd = new Random(seed);
        byte[][] p = new byte[channels][W * H];
        for (int c = 0; c < channels; c++) {
            for (int i = 0; i < W * H; i++) {
                int x = i % W;
                p[c][i] = (byte) ((x / 40 + c) % 2 == 0 ? 60 * c + 30 : rnd.nextInt(256));
            }
        }
        return p;
    }

    private static void same(String what, Path file, byte[][] p) throws Exception {
        int y = 0;
        try (MasterReader r = PsbReader.open(file)) {
            TestKit.check(r != null && r.width() == W && r.height() == H, what + ": streamed, " + W + "x" + H);
            for (int[][] band = r.next(); band != null; band = r.next()) {
                for (int[] row : band) {
                    for (int x = 0; x < W; x++) {
                        int i = y * W + x;
                        int want = p.length == 1 ? (p[0][i] & 0xFF) * 0x010101
                                : (p[0][i] & 0xFF) << 16 | (p[1][i] & 0xFF) << 8 | p[2][i] & 0xFF;
                        TestKit.check((row[x] & 0xFFFFFF) == want, what + ": pixel " + x + "," + y);
                    }
                    y++;
                }
            }
        }
        TestKit.check(y == H, what + ": every row");
    }

    /** Longest repeat and literal runs, the no-op header byte, and output bounded by {@code n}. */
    private static void packBits() {
        byte[] in = new byte[300];
        for (int i = 150; i < in.length; i++) in[i] = (byte) i;
        byte[] packed = PsbFixture.pack(in, 0, in.length);
        byte[] withNoop = new byte[packed.length + 1];
        withNoop[0] = (byte) -128;
        System.arraycopy(packed, 0, withNoop, 1, packed.length);
        byte[] out = new byte[in.length + 4];
        PackBits.decode(withNoop, 0, withNoop.length, out, 2, in.length);
        for (int i = 0; i < in.length; i++) TestKit.check(out[i + 2] == in[i], "PackBits byte " + i);
        TestKit.check(out[0] == 0 && out[in.length + 2] == 0, "PackBits stays inside its row");
    }

    private static void rejected(String what, Path file) throws Exception {
        TestKit.check(PsbReader.open(file) == null, what + ": rejected");
    }
}
