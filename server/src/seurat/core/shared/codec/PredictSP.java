package seurat.core.shared.codec;

/** S+P prediction of H/V from true parents (open loop), D unpredicted. */
public final class PredictSP {
    private PredictSP() {}

    static int at(int[] stratum, int w, int h, int x, int y) {
        x = Math.min(Math.max(x, 0), w - 1);
        y = Math.min(Math.max(y, 0), h - 1);
        return stratum[y * w + x];
    }

    public static int hHat(int[] parents, int w, int h, int x, int y) {
        return (at(parents, w, h, x - 1, y) - at(parents, w, h, x + 1, y) + 2) >> 2;
    }

    public static int vHat(int[] parents, int w, int h, int x, int y) {
        return (at(parents, w, h, x, y - 1) - at(parents, w, h, x, y + 1) + 2) >> 2;
    }
}
