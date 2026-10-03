package seurat.core.viewing.session;

import java.util.List;
import seurat.kit.TestKit;

/** CoDel dwell signal + DCTCP AIMD response smoke. */
public final class RegulatorTest {
    public static void main(String[] args) {
        idleKeepsShare();
        congestionCutsShare();
        recoveryIsSlow();
        System.out.println("RegulatorTest OK");
    }

    static Session session() {
        return new Session(1, "p", 128, 0, null, new byte[32]);
    }

    private static void idleKeepsShare() {
        Regulator regulator = new Regulator();
        Session session = session();
        regulator.tick(List.of(session));
        TestKit.check(session.share == 1.0 && !regulator.congested(), "idle share 1");
    }

    private static void congestionCutsShare() {
        Regulator regulator = new Regulator();
        Session session = session();
        for (int i = 0; i < 40; i++) {
            regulator.onStart(session, 50_000_000L);
        }
        regulator.tick(List.of(session));
        TestKit.check(regulator.congested(), "persistent 50ms dwell congests");
        TestKit.check(session.share == 1.0, "nothing marked yet, no cut");
        for (int i = 0; i < 40; i++) {
            regulator.onStart(session, 50_000_000L);
        }
        regulator.tick(List.of(session));
        double cut = session.share;
        TestKit.check(cut < 1.0, "marked tick cuts, got " + cut);
        while (session.rung == 3) {
            for (int i = 0; i < 40; i++) {
                regulator.onStart(session, 50_000_000L);
            }
            regulator.tick(List.of(session));
        }
        TestKit.check(session.rung < 3, "a cut share lowers the rung");
        cut = session.share;
        for (int i = 0; i < 40; i++) {
            regulator.onStart(session, 50_000_000L);
        }
        regulator.tick(List.of(session));
        TestKit.check(session.share < cut, "repeated congestion cuts deeper");
    }

    private static void recoveryIsSlow() {
        Regulator regulator = new Regulator();
        Session session = session();
        session.share = 0.125;
        for (int i = 0; i < 28; i++) {
            regulator.tick(List.of(session));
        }
        TestKit.check(Math.abs(session.share - 1.0) < 1e-9, "28 additive ticks recover");
        TestKit.check(session.rung == 3, "recovered share is rung 3");
    }
}
