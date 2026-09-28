package seurat.session;

import seurat.kit.TestKit;

/** Spec 8: delta = max(1 s, 2 RTT), the RTT taken from LATIDO -> ECO. */
public final class RoundTripTest {
    private static final long MS = 1_000_000L;

    public static void main(String[] args) {
        RoundTrip rt = new RoundTrip();
        TestKit.check(rt.deltaNs() == 1000 * MS, "no sample yet: delta = 1 s");
        rt.sample(0, 300 * MS);
        TestKit.check(rt.deltaNs() == 1000 * MS, "RTT 300 ms: 2 RTT < 1 s, delta = 1 s");
        rt.sample(1000 * MS, 1800 * MS);
        TestKit.check(rt.deltaNs() == 1600 * MS, "RTT 800 ms: delta = 2 RTT = 1.6 s");
        rt.sample(2000 * MS, 2100 * MS);
        TestKit.check(rt.deltaNs() == 1600 * MS, "a faster round trip later never shrinks delta");
        rt.sample(5000 * MS, 4000 * MS);
        rt.sample(0, 3_600_000 * MS);
        TestKit.check(rt.deltaNs() == 1600 * MS, "a nonce from the future or long ago is no sample");
        System.out.println("RoundTripTest OK");
    }
}
