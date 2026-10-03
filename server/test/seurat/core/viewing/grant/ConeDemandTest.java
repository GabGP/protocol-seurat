package seurat.core.viewing.grant;

import java.util.Arrays;
import java.util.List;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.session.Allotment;
import seurat.kit.ConcessionRig;
import seurat.kit.TestKit;

/**
 * Tests that cone demand reflects the uncut cone regardless of session rung,
 * and that an empty plan or a hidden canvas clears the demand (ADR-07 rule 2).
 */
public final class ConeDemandTest {
    public static void main(String[] args) throws Exception {
        ConcessionRig rigA = ConcessionRig.create();
        rigA.session.rung = 3;
        ConcessionRig rigB = ConcessionRig.create();
        rigB.session.rung = 1;

        MsgGaze.Gaze gaze = new MsgGaze.Gaze(1, 5, 0, 0, 512, 384, 512, 384, 0);
        rigA.grants.gaze(rigA.session, rigA.canvas, gaze);
        rigB.grants.gaze(rigB.session, rigB.canvas, gaze);

        rigA.canvas.plan().demand().tick(0.25); // the regulation tick folds the new want into the rate
        rigB.canvas.plan().demand().tick(0.25);
        long[] sumA = new long[Allotment.TIERS];
        rigA.canvas.plan().demand().addTo(sumA);
        long[] sumB = new long[Allotment.TIERS];
        rigB.canvas.plan().demand().addTo(sumB);

        TestKit.check(Arrays.equals(sumA, sumB), "demand sums are equal for rung 3 and rung 1");
        TestKit.check(sumA[0] > 0, "tier 1 sum is > 0");

        synchronized (rigA.canvas) {
            rigA.grants.plans.issue(rigA.canvas, 6, List.of(), 0);
        }
        long[] sumCleared = new long[Allotment.TIERS];
        rigA.canvas.plan().demand().addTo(sumCleared);
        TestKit.check(sumCleared[0] == 0 && sumCleared[1] == 0 && sumCleared[2] == 0,
                "empty plan clears demand");

        rigB.grants.gaze(rigB.session, rigB.canvas, new MsgGaze.Gaze(1, 6, 0, 0, 512, 384, 512, 384, MsgGaze.M_OCULTA));
        long[] sumHidden = new long[Allotment.TIERS];
        rigB.canvas.plan().demand().addTo(sumHidden);
        TestKit.check(Arrays.stream(sumHidden).sum() == 0, "a hidden canvas wants nothing");

        System.out.println("ConeDemandTest OK");
    }
}
