package seurat.core.shared.codec;

import seurat.kit.TestKit;

/** Morton interleave + BrushId parent/children/footprint + §2.1 vector. */
public final class MortonBrushTest {
    public static void main(String[] args) {
        interleave();
        brushVector();
        parentChildren();
        footprint();
        System.out.println("MortonBrushTest OK");
    }

    private static void interleave() {
        TestKit.check(Morton.encode(131, 98) == 0x680DL, "morton(131,98)");
        TestKit.check(Morton.decodeX(0x680DL) == 131, "decodeX");
        TestKit.check(Morton.decodeY(0x680DL) == 98, "decodeY");
        java.util.Random rnd = new java.util.Random(7);
        for (int i = 0; i < 1000; i++) {
            int x = rnd.nextInt(1 << 20);
            int y = rnd.nextInt(1 << 20);
            long m = Morton.encode(x, y);
            TestKit.check(Morton.decodeX(m) == x && Morton.decodeY(m) == y, "round-trip");
        }
    }

    private static void brushVector() {
        BrushId p = new BrushId(1, 131, 98);
        TestKit.check(p.id() == 0x010000000000680DL, "P(1,131,98) id");
        TestKit.check(BrushId.ofId(0x010000000000680DL).equals(p), "ofId");
    }

    private static void parentChildren() {
        BrushId p = new BrushId(1, 131, 98);
        BrushId parent = p.parent();
        TestKit.check(parent.equals(new BrushId(2, 65, 49)), "parent P(2,65,49)");
        TestKit.check(parent.id() >>> 56 == 2, "parent stratum");
        TestKit.check(p.parent().parent().equals(new BrushId(3, 32, 24)), "grandparent");
        var children = parent.children();
        TestKit.check(children.size() == 4 && children.contains(p), "children contain p");
        for (BrushId c : children) {
            TestKit.check(c.parent().equals(parent), "child parent round-trip");
        }
        TestKit.check(new BrushId(0, 0, 0).children().isEmpty(), "stratum 0 childless");
    }

    private static void footprint() {
        long[] fp = new BrushId(1, 131, 98).footprint();
        TestKit.check(fp[0] == 131L * 512 && fp[1] == 98L * 512
                && fp[2] == 132L * 512 && fp[3] == 99L * 512, "footprint");
    }
}
