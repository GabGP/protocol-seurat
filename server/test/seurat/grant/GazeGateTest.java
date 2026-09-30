package seurat.grant;

import seurat.kit.ConcessionRig;
import seurat.kit.TestKit;
import seurat.proto.FatalProtocol;
import seurat.proto.ProtoCodes;
import seurat.proto.msg.MsgGaze;

/** MIRADA bucket (spec 4.1.1, 6.2): burst 40, the excess coalesced (last wins), ERROR 9 only for abuse. */
public final class GazeGateTest {
    public static void main(String[] args) throws Exception {
        coalesces();
        sustainedAbuseIsFatal();
        System.out.println("GazeGateTest OK");
    }

    private static MsgGaze.Gaze gaze(long seq) {
        return new MsgGaze.Gaze(1, seq, 0, 0, 512, 384, 1920, 1080, 0);
    }

    private static void coalesces() throws Exception {
        var s = ConcessionRig.create();
        GazeGate gate = new GazeGate(s.grants);
        for (int seq = 1; seq <= 60; seq++) {
            gate.offer(s.session, s.canvas, gaze(seq));
        }
        TestKit.check(s.canvas.gaze().seq() == 40, "burst of 40 applied, got " + s.canvas.gaze().seq());
        Thread.sleep(120);
        gate.tick();
        TestKit.check(s.canvas.gaze().seq() == 60, "the newest coalesced gaze wins, not 41");
    }

    private static void sustainedAbuseIsFatal() throws Exception {
        var s = ConcessionRig.create();
        GazeGate gate = new GazeGate(s.grants);
        long seq = 1;
        long end = System.nanoTime() + 7_000_000_000L;
        try {
            while (System.nanoTime() < end) {
                for (int i = 0; i < 30; i++) {
                    gate.offer(s.session, s.canvas, gaze(seq++));
                }
                Thread.sleep(10);
            }
            throw new AssertionError("> 200/s for 5 s must be ERROR 9");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_TASA, "ERROR 9 LIMITE_TASA");
        }
    }
}
