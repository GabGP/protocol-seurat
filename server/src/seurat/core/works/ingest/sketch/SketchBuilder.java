package seurat.core.works.ingest.sketch;

import java.nio.file.Files;
import seurat.core.shared.codec.BrushEncoder;
import seurat.core.shared.codec.Geometry;
import seurat.core.shared.codec.Quant;
import seurat.core.shared.codec.SeedCodec;
import seurat.core.shared.codec.TransformS;
import seurat.core.works.store.FileBrushStore;
import seurat.core.works.store.StoreFiles;

/**
 * ed1 sketch (spec 7.1 step 3): the master's overview -> S-pyramid -> zero-detail brushes for the
 * three strata under the seed + the seed. Servable while the full pass runs.
 */
final class SketchBuilder {
    private SketchBuilder() {}

    /** Master pixels per overview sample, per side: the overview stands for stratum top - 3. */
    static int sampling(int top) {
        return 1 << Math.max(0, top - 3);
    }

    static void build(Overview.Sampled sub, FileBrushStore store, int top) throws Exception {
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
        Files.write(store.dir().resolve(StoreFiles.SEED),
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
        int nx = Geometry.ceilDiv(w, Geometry.HALF);
        int ny = Geometry.ceilDiv(h, Geometry.HALF);
        int[][][] cero = new int[3][1][Geometry.PARENTS];
        for (int by = 0; by < ny; by++) {
            for (int bx = 0; bx < nx; bx++) {
                int[][] pw = new int[3][Geometry.PARENTS];
                for (int c = 0; c < 3; c++) {
                    for (int y = 0; y < Geometry.HALF; y++) {
                        for (int x = 0; x < Geometry.HALF; x++) {
                            int sx = Math.min(bx * Geometry.HALF + x, w - 1);
                            int sy = Math.min(by * Geometry.HALF + y, h - 1);
                            pw[c][y * Geometry.HALF + x] = padres[c][sy * w + sx];
                        }
                    }
                }
                var bb = BrushEncoder.encode(pw, cero, cero, cero, Geometry.PARENTS, Geometry.HALF,
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
