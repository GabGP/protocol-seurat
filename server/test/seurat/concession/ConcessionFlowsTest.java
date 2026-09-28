package seurat.concession;

import java.nio.ByteBuffer;
import java.util.List;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgError;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.store.WorkMeta;

/** Concession flows: policy bands (2.3), floor until LISTA (7.3), edition swap (7.3), withdrawal (7.4). */
public final class ConcessionFlowsTest {
    public static void main(String[] args) throws Exception {
        policyLowersBandsScrapes();
        gazeKeepsFloorWhilePainting();
        editionSwapReissuesConcession();
        withdrawalWaitsForScrape();
        System.out.println("ConcessionFlowsTest OK");
    }

    private static List<Frame> frames(GrantControllerTest.Setup s) {
        var out = new java.util.ArrayList<Frame>();
        synchronized (s.mapping) {
            s.mapping.control.forEach(f -> out.add(Frame.decode(ByteBuffer.wrap(f))));
        }
        return out;
    }

    private static Frame first(GrantControllerTest.Setup s, long type) {
        return frames(s).stream().filter(f -> f.type() == type).findFirst().orElse(null);
    }

    /** Same stratum, fewer bands: CONCESION + RASPAR BANDAS (the band reduction is a revocation). */
    private static void policyLowersBandsScrapes() throws Exception {
        var s = GrantControllerTest.setup();
        s.canvas.floored = false;
        s.canvas.setConcession(new seurat.session.Concession(3, 0, 4, 1, 768, 36864, 120));
        s.work.ceilings.put("autenticado", new long[]{0, 2});
        new PolicySync(s.grants).apply(s.canvas);
        TestKit.check(s.canvas.concession().maxBands() == 2 && s.canvas.concession().epoch() == 4, "narrowed");
        Frame raspar = first(s, FrameType.RASPAR);
        TestKit.check(raspar != null, "RASPAR sent for a band reduction");
        var b = ByteBuffer.wrap(raspar.payload());
        for (int i = 0; i < 4; i++) {
            seurat.proto.VarInt.get(b);
        }
        TestKit.check(b.get() == ProtoCodes.PRED_BANDAS && b.get() == 0 && b.get() == 2, "BANDAS estrato 0, 2");
        s.work.ceilings.put("autenticado", new long[]{0, 4});
        int before = s.mapping.control.size();
        new PolicySync(s.grants).apply(s.canvas);
        TestKit.check(s.mapping.control.size() == before, "widening waits for a MIRADA (spec 2.3)");
    }

    private static MsgGaze.Gaze gaze(long seq, int flags) {
        return new MsgGaze.Gaze(1, seq, 0, 0, 512, 384, 1920, 1080, flags);
    }

    /** BOCETO / PINTANDO: a MIRADA does not lift the floor until LISTA. */
    private static void gazeKeepsFloorWhilePainting() throws Exception {
        var s = GrantControllerTest.setup(ProtoCodes.ST_PINTANDO);
        s.canvas.setConcession(new seurat.session.Concession(1, 0, 4, 0, 768, 36864, 120));
        s.grants.open(s.session, s.canvas);
        int floor = s.canvas.concession().minStratum();
        s.grants.gaze(s.session, s.canvas, gaze(1, 0));
        TestKit.check(s.canvas.concession().minStratum() == floor && s.canvas.floored, "floor kept while PINTANDO");
        var lista = GrantControllerTest.setup(ProtoCodes.ST_LISTA);
        lista.grants.open(lista.session, lista.canvas);
        lista.grants.gaze(lista.session, lista.canvas, gaze(1, 0));
        TestKit.check(lista.canvas.concession().minStratum() == 0, "LISTA: the MIRADA lifts the floor");
        lista.grants.gaze(lista.session, lista.canvas, gaze(1, 0));
        TestKit.check(lista.canvas.gaze().seq() == 1, "a stale seq is ignored (highest seq wins)");
    }

    /** LISTA: a new CONCESION (epoch + 1) and the sketch owed again in ed2 (same ids, new deliveries). */
    private static void editionSwapReissuesConcession() throws Exception {
        var s = GrantControllerTest.setup(ProtoCodes.ST_BOCETO);
        var ed1 = new WorkMeta("w", "w", 512, 384, 256, 2, ProtoCodes.ST_BOCETO, 1, 0, 2);
        s.canvas.setStore(s.work.store, ed1);
        s.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        s.grants.gaze(s.session, s.canvas, gaze(5, 0));
        long epoch = s.canvas.concession().epoch();
        s.mapping.control.clear();
        s.work.meta = new WorkMeta("w", "w", 512, 384, 256, 2, ProtoCodes.ST_LISTA, 2, 0, 2);
        s.grants.substitute(s.canvas, s.work);
        TestKit.check(s.canvas.concession().epoch() == epoch + 1, "epoch + 1");
        TestKit.check(first(s, FrameType.CONCESION) != null, "CONCESION sent even with a live gaze");
        TestKit.check(s.canvas.book().bands(new BrushId(10, 0, 0)) == 0, "ed1 seed does not count in ed2");
        var plan = MsgGaze.Plan.parse(first(s, FrameType.PLAN).payload());
        TestKit.check(plan.expectedCount() > 0, "the sketch is repainted in ed2");
    }

    /** RASPAR TODO -> RASPADO confirmed -> ERROR 4; never ERROR 4 before the confirmation. */
    private static void withdrawalWaitsForScrape() throws Exception {
        var s = GrantControllerTest.setup();
        s.grants.withdraw(s.canvas);
        TestKit.check(first(s, FrameType.ERROR) == null, "no ERROR 4 before RASPADO");
        TestKit.check(s.session.canvases().containsKey(1L), "handle alive until confirmed");
        var order = s.canvas.orders().pendingScrapes().get(0);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, order.order(), order.epoch(), order.through(),
                256, 3, Ranges.empty()));
        Frame err = first(s, FrameType.ERROR);
        TestKit.check(err != null && MsgError.ProtocolError.parse(err.payload()).code()
                == ProtoCodes.ERR_OBRA_INEXISTENTE && MsgError.ProtocolError.parse(err.payload()).fail() == 0,
                "ERROR 4, not fatal");
        TestKit.check(!s.session.canvases().containsKey(1L), "handle invalid after");
    }
}
