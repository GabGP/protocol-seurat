package seurat.core.viewing.session;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.msg.MsgRegulation;
import seurat.kit.TestKit;

/** Tests for RegulationNotice (ADR-07 rule 6). */
public final class RegulationNoticeTest {
    public static void main(String[] args) {
        testRegulationNotice();
        System.out.println("RegulationNoticeTest OK");
    }

    private static void testRegulationNotice() {
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(1, "p", 128, ProtoCodes.CAP_REGULACION, mapping, new byte[32]);

        // a) Never regulated: rung 3 and maybeSend(s, 0, 0, 1) sends nothing.
        RegulationNotice.maybeSend(s, 0, 0, 1);
        TestKit.check(regulations(mapping).isEmpty(), "case a: nothing sent");

        // b) A drop: s.rung = 1; maybeSend(s, 1000, 4000, 2) sends one frame.
        s.rung = 1;
        RegulationNotice.maybeSend(s, 1000, 4000, 2);
        List<MsgRegulation.Regulation> regs = regulations(mapping);
        TestKit.check(regs.size() == 1, "case b: one frame sent");
        MsgRegulation.Regulation last = regs.get(regs.size() - 1);
        TestKit.check(last.rung() == 1, "case b rung 1");
        TestKit.check(last.budgetKibS() == 1000, "case b budget 1000");
        TestKit.check(last.capacityKibS() == 4000, "case b capacity 4000");
        TestKit.check(last.sessions() == 2, "case b sessions 2");

        // c) A budget move under a quarter: maybeSend(s, 1200, 4000, 2) sends nothing.
        RegulationNotice.maybeSend(s, 1200, 4000, 2);
        TestKit.check(regulations(mapping).size() == 1, "case c: nothing sent");

        // d) A move of a quarter or more: maybeSend(s, 1250, 4000, 2) sends one.
        RegulationNotice.maybeSend(s, 1250, 4000, 2);
        regs = regulations(mapping);
        TestKit.check(regs.size() == 2, "case d: frame sent");
        last = regs.get(regs.size() - 1);
        TestKit.check(last.rung() == 1, "case d rung 1");
        TestKit.check(last.budgetKibS() == 1250, "case d budget 1250");
        TestKit.check(last.capacityKibS() == 4000, "case d capacity 4000");
        TestKit.check(last.sessions() == 2, "case d sessions 2");

        // e) Back to unregulated: s.rung = 3; maybeSend(s, 0, 0, 2) sends one, with budget 0.
        // Then maybeSend(s, 0, 0, 2) again sends nothing.
        s.rung = 3;
        RegulationNotice.maybeSend(s, 0, 0, 2);
        regs = regulations(mapping);
        TestKit.check(regs.size() == 3, "case e: frame sent");
        last = regs.get(regs.size() - 1);
        TestKit.check(last.rung() == 3, "case e rung 3");
        TestKit.check(last.budgetKibS() == 0, "case e budget 0");
        TestKit.check(last.capacityKibS() == 0, "case e capacity 0");
        TestKit.check(last.sessions() == 2, "case e sessions 2");

        RegulationNotice.maybeSend(s, 0, 0, 2);
        TestKit.check(regulations(mapping).size() == 3, "case e: second call sends nothing");

        // f) A session without the caps bit never receives one, even on a drop.
        RecordingMapping m2 = new RecordingMapping();
        Session s2 = new Session(2, "p", 128, 0, m2, new byte[32]);
        s2.rung = 1;
        RegulationNotice.maybeSend(s2, 1000, 4000, 2);
        TestKit.check(regulations(m2).isEmpty(), "case f: no caps never receives REGULACION");
    }

    private static List<MsgRegulation.Regulation> regulations(RecordingMapping mapping) {
        List<MsgRegulation.Regulation> out = new ArrayList<>();
        synchronized (mapping) {
            for (byte[] frame : mapping.control) {
                Frame f = Frame.decode(ByteBuffer.wrap(frame));
                if (f.type() == FrameType.REGULACION) {
                    out.add(MsgRegulation.Regulation.parse(f.payload()));
                }
            }
        }
        return out;
    }
}
