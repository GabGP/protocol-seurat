package seurat.concession;

import seurat.proto.ProtoCodes;
import seurat.session.Canvas;

/**
 * PUT .../politica on open canvases (spec 3.1, 2.3): a lower ceiling (stratum or bands)
 * is a reduction with its RASPAR; a higher one waits for demand, the next MIRADA.
 */
public final class PolicySync {
    private final GrantController grants;

    public PolicySync(GrantController grants) {
        this.grants = grants;
    }

    public void apply(Canvas canvas) {
        synchronized (canvas) {
            if (canvas.retiring) {
                return;
            }
            int[] target = Concessions.target(grants.policy.ceiling(canvas), canvas.floored, canvas.meta().strata() - 1);
            grants.apply(canvas, target, ProtoCodes.MOT_POLITICA, false);
        }
    }
}
