package seurat.core.shared.codec;

import seurat.kit.TestKit;

/** Dead-zone quantizer + per-stratum table + S+P prediction smoke. */
public final class QuantPredictTest {
    public static void main(String[] args) {
        deadZone();
        table();
        prediction();
        System.out.println("QuantPredictTest OK");
    }

    private static void deadZone() {
        TestKit.check(Quant.quantize(0, 6) == 0, "zero stays zero");
        TestKit.check(Quant.quantize(5, 6) == 0, "dead zone");
        TestKit.check(Quant.quantize(6, 6) == 1, "boundary");
        TestKit.check(Quant.quantize(-13, 6) == -2, "negative");
        TestKit.check(Quant.dequantize(0, 6) == 0, "dequant zero");
        TestKit.check(Quant.dequantize(2, 6) == 15, "dequant 2*6+3");
        TestKit.check(Quant.quantize(99, 0) == 0, "q<=0 kills chroma");
        for (int x = -500; x <= 500; x++) {
            int q = 4;
            int i = Quant.quantize(x, q);
            int back = Quant.dequantize(i, q);
            TestKit.check(Math.abs(back - x) <= q, "error bounded by q");
        }
    }

    private static void table() {
        TestKit.check(Quant.qy(1, 0) == 6 && Quant.qc(1, 0) == 0, "table 1 s0 4:2:0");
        TestKit.check(Quant.qy(1, 1) == 4 && Quant.qc(1, 1) == 6, "table 1 s1");
        TestKit.check(Quant.qy(1, 2) == 2 && Quant.qc(1, 2) == 3, "table 1 s2");
        TestKit.check(Quant.qy(1, 5) == 1 && Quant.qc(1, 5) == 2, "table 1 s>=3");
        TestKit.check(Quant.TABLE == 2 && Quant.qy(0) == 2 && Quant.qc(0) == 2,
                "s0 near-lossless, full chroma");
        TestKit.check(Quant.qy(1) == 1 && Quant.qc(1) == 1 && Quant.qc(9) == 1, "s>=1 lossless");
    }

    private static void prediction() {
        int w = 8;
        int h = 8;
        int[] parents = new int[w * h];
        for (int i = 0; i < parents.length; i++) {
            parents[i] = (i * 37) & 0xFF;
        }
        int hh = PredictSP.hHat(parents, w, h, 3, 3);
        int vv = PredictSP.vHat(parents, w, h, 3, 3);
        int expectedH = 46; // (194-12+2)>>2
        int expectedV = 44; // (191-15+2)>>2
        TestKit.check(hh == expectedH, "hHat formula, got " + hh);
        TestKit.check(vv == expectedV, "vHat formula, got " + vv);
        TestKit.check(PredictSP.hHat(parents, w, h, 0, 0)
                == PredictSP.hHat(parents, w, h, 0, 0), "edge deterministic");
        TestKit.check(Math.abs(vv) < 256, "vHat bounded");
    }
}
