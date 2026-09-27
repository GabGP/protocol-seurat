package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.codec.BrushEncoder;
import seurat.codec.Quant;
import seurat.codec.SeedCodec;
import seurat.codec.TransformS;
import seurat.store.FileBrushStore;

/**
 * ed1 sketch: subsampled master -> E7 -> S-pyramid -> zero-detail brushes
 * for s7..9 + seed. Servable while the full pass runs.
 */
final class SketchBuilder {
    private SketchBuilder() {}

    static void build(Path master, FileBrushStore store, int top) throws Exception {
        int q = 1 << Math.max(0, top - 3);
        PngSubsampler.Subsampled sub = PngSubsampler.subsample(master, q);
        if (sub == null) {
            sub = SketchFallback.thumbnail(master, q);
        }
        if (sub == null) {
            return;
        }
        int sw = sub.sw();
        int sh = sub.sh();
        int[][] e = sub.e();
        int stratum = Math.max(0, top - 3);
        while (stratum < top) {
            if (sw % 2 != 0) {
                e = padWidth(e, sw, sh, sw + 1);
                sw++;
            }
            if (sh % 2 != 0) {
                e = padHeight(e, sw, sh);
                sh++;
            }
            int[][] sig = means(e, sw, sh);
            if (stratum >= top - 3) {
                paintLevel(sig, sw / 2, sh / 2, stratum, store);
            }
            e = sig;
            sw /= 2;
            sh /= 2;
            stratum++;
        }
        Files.write(store.dir().resolve("semilla.bin"),
                SeedCodec.encode(e, sw, sh));
    }

    private static int[][] means(int[][] e, int w, int h) {
        int[][] out = new int[3][(w / 2) * (h / 2)];
        for (int c = 0; c < 3; c++) {
            int n = (w / 2) * (h / 2);
            TransformS.blockForward(e[c], w, h, out[c], new int[n], new int[n], new int[n]);
        }
        return out;
    }

    private static void paintLevel(int[][] padres, int w, int h, int stratum,
            FileBrushStore store) throws Exception {
        int nx = (w + 127) / 128;
        int ny = (h + 127) / 128;
        int[][][] cero = new int[3][1][16384];
        for (int by = 0; by < ny; by++) {
            for (int bx = 0; bx < nx; bx++) {
                int[][] pw = new int[3][16384];
                for (int c = 0; c < 3; c++) {
                    for (int y = 0; y < 128; y++) {
                        for (int x = 0; x < 128; x++) {
                            int sx = Math.min(bx * 128 + x, w - 1);
                            int sy = Math.min(by * 128 + y, h - 1);
                            pw[c][y * 128 + x] = padres[c][sy * w + sx];
                        }
                    }
                }
                var bb = BrushEncoder.encode(pw, cero, cero, cero, 16384, 128,
                        Quant.qy(stratum), Quant.qc(stratum));
                store.append(stratum, bx, by, bb.bands(), bb.crcs());
            }
        }
    }

    private static int[][] padWidth(int[][] e, int w, int h, int nw) {
        int[][] out = new int[3][nw * h];
        for (int c = 0; c < 3; c++) {
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < nw; x++) {
                    out[c][y * nw + x] = e[c][y * w + Math.min(x, w - 1)];
                }
            }
        }
        return out;
    }

    private static int[][] padHeight(int[][] e, int w, int h) {
        int[][] out = new int[3][w * (h + 1)];
        for (int c = 0; c < 3; c++) {
            System.arraycopy(e[c], 0, out[c], 0, w * h);
            System.arraycopy(e[c], w * (h - 1), out[c], w * h, w);
        }
        return out;
    }
}
