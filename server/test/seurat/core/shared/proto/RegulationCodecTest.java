package seurat.core.shared.proto;

import java.util.Arrays;
import seurat.core.shared.proto.msg.MsgRegulation;
import seurat.kit.TestKit;

/** Golden encode/parse tests for REGULACION frames (ADR-07). */
public final class RegulationCodecTest {
    public static void main(String[] args) {
        testGolden();
        System.out.println("RegulationCodecTest OK");
    }

    private static void testGolden() {
        MsgRegulation.Regulation reg = new MsgRegulation.Regulation(1, 2048, 24576, 16);
        byte[] encoded = reg.encode();
        byte[] expected = TestKit.unhex("0148008000600010");
        TestKit.check(Arrays.equals(encoded, expected), "golden encoded bytes match");

        MsgRegulation.Regulation parsed = MsgRegulation.Regulation.parse(encoded);
        TestKit.check(parsed.equals(reg), "parsed matches original");
        TestKit.check(parsed.rung() == 1, "rung == 1");
        TestKit.check(parsed.budgetKibS() == 2048, "budget == 2048");
        TestKit.check(parsed.capacityKibS() == 24576, "capacity == 24576");
        TestKit.check(parsed.sessions() == 16, "sessions == 16");
    }
}
