package seurat.observe;

import seurat.kit.TestKit;

/** Sizes in binary units, durations always "Xm Ys Zms", rates in MiB/s. */
public final class LogUnitsTest {
    public static void main(String[] args) {
        TestKit.check(LogUnits.bytes(500).equals("500 B"), "bytes");
        TestKit.check(LogUnits.bytes(2048).equals("2.0 KiB"), "KiB");
        TestKit.check(LogUnits.bytes(5_000_000).equals("4.8 MiB"), "MiB");
        TestKit.check(LogUnits.bytes(5_000_000_000L).equals("4.66 GiB"), "GiB");
        TestKit.check(LogUnits.duration(0).equals("0m 0s 0ms"), "0 ms");
        TestKit.check(LogUnits.duration(999).equals("0m 0s 999ms"), "999 ms");
        TestKit.check(LogUnits.duration(65432).equals("1m 5s 432ms"), "65432 ms");
        TestKit.check(LogUnits.duration(-5).equals("0m 0s 0ms"), "negative clamps to 0");
        TestKit.check(LogUnits.rate(10L * 1024 * 1024, 2000).equals("5.0 MiB/s"), "10 MiB in 2 s");
        TestKit.check(LogUnits.rate(1024 * 1024, 0).equals("1000.0 MiB/s"), "0 ms counts as 1 ms");
        TestKit.check(LogUnits.pixelRate(30_000_000L, 2000).equals("15.0 Mpx/s"), "30 Mpx in 2 s");
        TestKit.check(LogUnits.cause(new IllegalStateException("boom")).equals("boom"), "cause: message");
        TestKit.check(LogUnits.cause(new NullPointerException()).equals("NullPointerException"), "cause: class");
        System.out.println("LogUnitsTest OK");
    }
}
