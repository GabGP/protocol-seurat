package seurat.core.shared.codec;

import seurat.kit.TestKit;

/** S transform: exact round-trip on random + extreme blocks, int16 fit. */
public final class TransformSTest {
    public static void main(String[] args) {
        extremes();
        random();
        blockRoundTrip();
        System.out.println("TransformSTest OK");
    }

    private static void checkBlock(int a, int b, int c, int d) {
        int[] fwd = TransformS.forward(a, b, c, d);
        int[] back = TransformS.inverse(fwd[0], fwd[1], fwd[2], fwd[3]);
        TestKit.check(back[0] == a && back[1] == b && back[2] == c && back[3] == d,
                "S round-trip " + a + "," + b + "," + c + "," + d);
        TestKit.check(fwd[1] >= -510 && fwd[1] <= 510, "H int16");
        TestKit.check(fwd[3] >= -1020 && fwd[3] <= 1020, "D int16");
    }

    private static void extremes() {
        checkBlock(0, 0, 0, 0);
        checkBlock(255, 255, 255, 255);
        checkBlock(0, 255, 0, 255);
        checkBlock(255, 0, 255, 0);
        checkBlock(-255, 255, -255, 255);
        checkBlock(-255, 255, 255, -255);
    }

    private static void random() {
        java.util.Random rnd = new java.util.Random(42);
        for (int i = 0; i < 5000; i++) {
            checkBlock(rnd.nextInt(511) - 255, rnd.nextInt(511) - 255,
                    rnd.nextInt(511) - 255, rnd.nextInt(511) - 255);
        }
    }

    private static void blockRoundTrip() {
        java.util.Random rnd = new java.util.Random(9);
        int w = 64;
        int h = 64;
        int[] src = new int[w * h];
        for (int i = 0; i < src.length; i++) {
            src[i] = rnd.nextInt(511) - 255;
        }
        int[] s = new int[w * h / 4];
        int[] v = new int[w * h / 4];
        int[] hh = new int[w * h / 4];
        int[] d = new int[w * h / 4];
        TransformS.blockForward(src, w, h, s, v, hh, d);
        int[] dst = new int[w * h];
        TransformS.blockInverse(s, v, hh, d, w / 2, h / 2, dst);
        TestKit.check(java.util.Arrays.equals(src, dst), "block round-trip");
    }
}
