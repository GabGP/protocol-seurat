package seurat.session;

import seurat.codec.BrushId;
import seurat.kit.TestKit;

/** Concession rights: stratum floor + band ceiling on the floor. */
public final class ConcessionTest {
    public static void main(String[] args) {
        Concession c = new Concession(2, 1, 4, 1, 768, 36864, 120);
        TestKit.check(c.allows(new BrushId(2, 0, 0), 4), "above floor");
        TestKit.check(c.allows(new BrushId(1, 0, 0), 4), "floor within bands");
        TestKit.check(!c.allows(new BrushId(1, 0, 0), 5), "floor band cap");
        TestKit.check(!c.allows(new BrushId(0, 0, 0), 2), "below floor");
        Concession sketch = new Concession(1, 7, 4, 0, 768, 36864, 120);
        TestKit.check(!sketch.allows(new BrushId(6, 0, 0), 4), "sketch only");
        TestKit.check(sketch.allows(new BrushId(9, 0, 0), 4), "sketch allowed");
        TestKit.check(seurat.concession.Concessions.sketchMin(0) == 0, "sketchMin top 0");
        TestKit.check(seurat.concession.Concessions.sketchMin(1) == 0, "sketchMin top 1");
        TestKit.check(seurat.concession.Concessions.sketchMin(4) == 3, "sketchMin top 4");
        TestKit.check(seurat.concession.Concessions.sketchMin(10) == 7, "sketchMin top 10");
        System.out.println("ConcessionTest OK");
    }
}
