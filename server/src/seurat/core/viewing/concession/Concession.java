package seurat.core.viewing.concession;

import seurat.core.shared.codec.BrushId;

/** Possession right for (session, canvas). A smaller concession IS revocation. */
public record Concession(long epoch, int minStratum, int reason,
        int maxBrushes, int maxKiB, long leaseS) {
    public boolean allows(BrushId p) {
        return p.stratum() >= minStratum;
    }
}
