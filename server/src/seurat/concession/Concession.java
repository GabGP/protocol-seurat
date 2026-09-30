package seurat.session;

import seurat.codec.BrushId;

/** Possession right for (session, canvas). A smaller concession IS revocation. */
public record Concession(long epoch, int minStratum, int maxBands, int reason,
        int maxBrushes, int maxKiB, long leaseS) {
    public boolean allows(BrushId p, int through) {
        if (p.stratum() > minStratum) {
            return true;
        }
        return p.stratum() == minStratum && through <= maxBands;
    }
}
