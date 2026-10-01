package seurat.core.shared.codec;

import seurat.kit.TestKit;

/** Seed: DPCM + zigzag + LEB128 + deflate-raw round-trip. */
public final class SeedTest {
    public static void main(String[] args) {
        small();
        random();
        crc();
        System.out.println("SeedTest OK");
    }

    private static void check(int[][] planes, int w, int h) {
        byte[] encoded = SeedCodec.encode(planes, w, h);
        TestKit.check(encoded.length > 4, "seed has body");
        int[][] back = SeedCodec.decode(encoded, w, h);
        for (int c = 0; c < 3; c++) {
            TestKit.check(java.util.Arrays.equals(back[c], planes[c]), "seed plane " + c);
        }
    }

    private static void small() {
        check(new int[][]{{1, 2, 3, 4}, {0, 0, 0, 0}, {-5, 10, -15, 20}}, 4, 1);
    }

    private static void random() {
        java.util.Random rnd = new java.util.Random(5);
        int w = 192;
        int h = 160;
        int[][] planes = new int[3][w * h];
        for (int c = 0; c < 3; c++) {
            for (int i = 0; i < planes[c].length; i++) {
                planes[c][i] = c == 0 ? rnd.nextInt(256) : rnd.nextInt(511) - 255;
            }
        }
        check(planes, w, h);
    }

    private static void crc() {
        byte[] encoded = SeedCodec.encode(new int[][]{{7}, {0}, {0}}, 1, 1);
        encoded[encoded.length - 1]++;
        try {
            SeedCodec.decode(encoded, 1, 1);
            throw new AssertionError("expected CRC failure");
        } catch (IllegalArgumentException expected) {
            TestKit.check(true, "crc trips");
        }
    }
}
