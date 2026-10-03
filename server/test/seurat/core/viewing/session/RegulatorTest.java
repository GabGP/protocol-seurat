package seurat.core.viewing.session;

import java.util.List;
import java.util.Map;
import seurat.kit.TestKit;

/** ADR-07 tiered sharpness filling and rung hysteresis tests. */
public final class RegulatorTest {
    public static void main(String[] args) {
        riseOnSecondTick();
        settleDropsAtOnce();
        settleClimbsToLowestGrant();
        dipResetsRise();
        unboundedKeepsRungThree();
        System.out.println("RegulatorTest OK");
    }

    static Session session() {
        return new Session(1, "p", 128, 0, null, new byte[32]);
    }

    private static void riseOnSecondTick() {
        Regulator regulator = new Regulator();
        Session s = session();
        s.rung = 1;
        List<Session> rose0 = regulator.tick(Map.of(s, new long[]{1, 1, 1}), 0L);
        TestKit.check(rose0.isEmpty(), "first tick does not rise");
        TestKit.check(s.rung == 1, "rung still 1 after first tick");
        List<Session> rose1 = regulator.tick(Map.of(s, new long[]{1, 1, 1}), 250_000_000L);
        TestKit.check(rose1.contains(s) && rose1.size() == 1, "second tick rises");
        TestKit.check(s.rung == 3, "rung climbed to 3");
    }

    private static void settleDropsAtOnce() {
        Session s = session();
        s.rung = 3;
        boolean rose = Regulator.settle(s, 1);
        TestKit.check(!rose, "drop returns false");
        TestKit.check(s.rung == 1, "dropped to rung 1 at once");
    }

    private static void settleClimbsToLowestGrant() {
        Session s = session();
        s.rung = 0;
        boolean rose1 = Regulator.settle(s, 3);
        TestKit.check(!rose1, "first tick above rung does not rise");
        boolean rose2 = Regulator.settle(s, 2);
        TestKit.check(rose2, "second tick rises");
        TestKit.check(s.rung == 2, "climbed to lowest of the two grants (2)");
    }

    private static void dipResetsRise() {
        Session s = session();
        s.rung = 1;
        Regulator.settle(s, 3);
        Regulator.settle(s, 1);
        boolean rose = Regulator.settle(s, 3);
        TestKit.check(!rose, "dip reset rise counter");
        TestKit.check(s.rung == 1, "rung stays 1");
    }

    private static void unboundedKeepsRungThree() {
        Regulator regulator = new Regulator();
        Session s = session();
        s.rung = 3;
        List<Session> rose = regulator.tick(Map.of(s, new long[]{1, 1, 1}), 0L);
        TestKit.check(rose.isEmpty(), "session already at rung 3 never appears in rose list");
        TestKit.check(s.rung == 3, "session stays at rung 3");
    }
}
