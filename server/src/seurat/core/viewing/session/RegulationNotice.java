package seurat.core.viewing.session;

import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.msg.MsgRegulation;

/**
 * ADR-07 rule 6. REGULACION goes only to a session that offered caps REGULACION, and only when its
 * rung changed or its budget moved by a quarter or more since the last one. A session that was
 * never regulated never receives one. Regulator tick thread.
 */
final class RegulationNotice {
    /** A budget move this large is announced. */
    private static final double CHANGE = 0.25;

    private RegulationNotice() {}

    static void maybeSend(Session s, long budgetKibS, long capacityKibS, long sessions) {
        if ((s.caps() & ProtoCodes.CAP_REGULACION) == 0 || s.mapping() == null) {
            return;
        }
        boolean moved = budgetKibS == 0
                ? s.sentBudgetKibS != 0
                : s.sentBudgetKibS == 0 || Math.abs(budgetKibS - s.sentBudgetKibS) >= CHANGE * s.sentBudgetKibS;
        if (s.rung == s.sentRung && !moved) {
            return;
        }
        s.sentRung = s.rung;
        s.sentBudgetKibS = budgetKibS;
        try {
            s.mapping().send(FrameType.REGULACION,
                    new MsgRegulation.Regulation(s.rung, budgetKibS, capacityKibS, sessions).encode());
        } catch (RuntimeException ex) {
            Log.warn(LogTags.LIVENESS, "s" + s.id() + " REGULACION not sent: " + LogUnits.cause(ex));
        }
    }
}
