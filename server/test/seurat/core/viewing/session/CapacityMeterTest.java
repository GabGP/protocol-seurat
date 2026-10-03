package seurat.core.viewing.session;

import seurat.kit.TestKit;

/** Tests for {@link CapacityMeter}. */
public final class CapacityMeterTest {
    public static void main(String[] args) {
        idle();
        saturated();
        halfBusy();
        lessThanHalfBusy();
        median();
        bandMeans();
        memory();
        System.out.println("CapacityMeterTest OK");
    }

    private static void idle() {
        CapacityMeter meter = new CapacityMeter();
        TestKit.check(meter.sample(0) == CapacityMeter.UNBOUNDED, "initial sample unbounded");
        meter.backlog(false, 100_000_000L);
        meter.opened(1, 2, 1000);
        TestKit.check(meter.sample(250_000_000L) == CapacityMeter.UNBOUNDED, "idle sample unbounded");
    }

    private static void saturated() {
        CapacityMeter meter = new CapacityMeter();
        meter.sample(0);
        meter.backlog(true, 0);
        meter.opened(1, 2, 2_000_000);
        long cap = meter.sample(250_000_000L);
        TestKit.check(cap == 8_000_000L, "saturated capacity 8 MB/s, got " + cap);
    }

    private static void halfBusy() {
        CapacityMeter meter = new CapacityMeter();
        meter.sample(0);
        meter.backlog(true, 0);
        meter.backlog(false, 125_000_000L);
        meter.opened(1, 1, 1_000_000);
        long cap = meter.sample(250_000_000L);
        TestKit.check(cap == 8_000_000L, "half busy capacity 8 MB/s, got " + cap);
    }

    private static void lessThanHalfBusy() {
        CapacityMeter meter = new CapacityMeter();
        meter.sample(0);
        meter.backlog(true, 0);
        meter.backlog(false, 100_000_000L);
        meter.opened(1, 1, 1_000_000);
        long cap = meter.sample(250_000_000L);
        TestKit.check(cap == CapacityMeter.UNBOUNDED, "less than half busy unbounded, got " + cap);
    }

    private static void median() {
        CapacityMeter meter = new CapacityMeter();
        long time = 0;
        meter.sample(time);
        meter.backlog(true, time);

        meter.opened(1, 1, 250_000);
        time += 250_000_000L;
        meter.sample(time);

        meter.opened(1, 1, 500_000);
        time += 250_000_000L;
        meter.sample(time);

        meter.opened(1, 1, 25_000_000);
        time += 250_000_000L;
        meter.sample(time);

        meter.opened(1, 1, 750_000);
        time += 250_000_000L;
        meter.sample(time);

        meter.opened(1, 1, 1_000_000);
        time += 250_000_000L;
        long cap5 = meter.sample(time);
        TestKit.check(cap5 == 3_000_000L, "fifth sample median 3 MB/s, got " + cap5);

        meter.opened(1, 1, 1_250_000);
        time += 250_000_000L;
        long cap6 = meter.sample(time);
        TestKit.check(cap6 == 4_000_000L, "sixth sample median 4 MB/s, got " + cap6);
    }

    private static void bandMeans() {
        CapacityMeter meter = new CapacityMeter();
        TestKit.check(meter.bandBytes(3) == 8192.0, "initial bandBytes 8192");
        meter.opened(3, 2, 2 * 16384);
        double expected = 8192.0 + (16384.0 - 8192.0) / 8.0;
        TestKit.check(Math.abs(meter.bandBytes(3) - expected) < 1e-9, "updated bandBytes");
    }

    /** A cut that empties the queue keeps the measured capacity; 10 s without a saturated tick unbounds it. */
    private static void memory() {
        CapacityMeter meter = new CapacityMeter();
        meter.sample(0);
        meter.backlog(true, 0);
        meter.opened(1, 2, 2_000_000);
        TestKit.check(meter.sample(250_000_000L) == 8_000_000L, "saturated tick measured");
        meter.backlog(false, 250_000_000L);
        TestKit.check(meter.sample(500_000_000L) == 8_000_000L, "an idle tick keeps the capacity");
        TestKit.check(meter.sample(10_000_000_000L) == 8_000_000L, "still within 10 s");
        TestKit.check(meter.sample(10_250_000_000L) == CapacityMeter.UNBOUNDED, "10 s on, nothing saturated: unbounded");
    }
}
