package seurat.core.viewing.session;

import seurat.kit.TestKit;

/** Tests for {@link TierDemand}. */
public final class TierDemandTest {
    public static void main(String[] args) {
        TierDemand td = new TierDemand();
        td.plan(new long[] {100, 200, 300});
        td.opened(1, 40);
        td.opened(3, 500);
        td.opened(0, 5);
        td.opened(4, 5);

        long[] sum = new long[] {1L, 1L, 1L};
        td.addTo(sum);
        TestKit.check(sum[0] == 61L, "tier 1 sum 61, got " + sum[0]);
        TestKit.check(sum[1] == 201L, "tier 2 sum 201, got " + sum[1]);
        TestKit.check(sum[2] == 1L, "tier 3 sum 1, got " + sum[2]);

        td.clear();
        long[] sumAfter = new long[] {1L, 1L, 1L};
        td.addTo(sumAfter);
        TestKit.check(sumAfter[0] == 1L
                && sumAfter[1] == 1L
                && sumAfter[2] == 1L, "clear resets demand");

        System.out.println("TierDemandTest OK");
    }
}
