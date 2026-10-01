package seurat.core.shared.codec;

import seurat.kit.TestKit;

/** YCoCg-R exact round-trip over a dense sample + spot vectors. */
public final class ColorTest {
    public static void main(String[] args) {
        spot();
        sample();
        System.out.println("ColorTest OK");
    }

    private static void spot() {
        int[] v = YCoCgR.forward(255, 0, 0);
        int[] back = YCoCgR.inverse(v[0], v[1], v[2]);
        TestKit.check(back[0] == 255 && back[1] == 0 && back[2] == 0, "red");
        int[] black = YCoCgR.forward(0, 0, 0);
        TestKit.check(black[0] == 0 && black[1] == 0 && black[2] == 0, "black");
    }

    private static void sample() {
        for (int r = 0; r < 256; r += 17) {
            for (int g = 0; g < 256; g += 17) {
                for (int b = 0; b < 256; b += 17) {
                    int[] v = YCoCgR.forward(r, g, b);
                    TestKit.check(v[0] >= 0 && v[0] <= 255, "Y range");
                    TestKit.check(v[1] >= -255 && v[1] <= 255, "Co range");
                    TestKit.check(v[2] >= -255 && v[2] <= 255, "Cg range");
                    int[] back = YCoCgR.inverse(v[0], v[1], v[2]);
                    TestKit.check(back[0] == r && back[1] == g && back[2] == b,
                            "round-trip " + r + "," + g + "," + b);
                }
            }
        }
    }
}
