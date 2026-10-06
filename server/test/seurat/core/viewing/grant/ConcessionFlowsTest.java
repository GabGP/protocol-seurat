package seurat.core.viewing.grant;

import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.works.store.WorkMeta;
import seurat.kit.ConcessionRig;
import seurat.kit.TestKit;

/** Concession flows: floor until LISTA (7.3), edition swap (7.3), withdrawal (7.4). */
public final class ConcessionFlowsTest {
    public static void main(String[] args) throws Exception {
        gazeKeepsFloorWhilePainting();
        editionSwapReissuesConcession();
        withdrawalWaitsForScrape();
        System.out.println("ConcessionFlowsTest OK");
    }

    private static MsgGaze.Gaze gaze(long seq, int flags) {
        return new MsgGaze.Gaze(1, seq, 0, 0, 512, 384, 1920, 1080, flags);
    }

    /** BOCETO / PINTANDO: a MIRADA does not lift the floor until LISTA. */
    private static void gazeKeepsFloorWhilePainting() throws Exception {
        var s = ConcessionRig.create(ProtoCodes.ST_PINTANDO);
        s.canvas.setConcession(new seurat.core.viewing.concession.Concession(1, 0, 0, 768, 36864, 120));
        s.grants.open(s.session, s.canvas);
        int floor = s.canvas.concession().minStratum();
        s.grants.gaze(s.session, s.canvas, gaze(1, 0));
        TestKit.check(s.canvas.concession().minStratum() == floor && s.canvas.floored, "floor kept while PINTANDO");
        var lista = ConcessionRig.create(ProtoCodes.ST_LISTA);
        lista.grants.open(lista.session, lista.canvas);
        lista.grants.gaze(lista.session, lista.canvas, gaze(1, 0));
        TestKit.check(lista.canvas.concession().minStratum() == 0, "LISTA: the MIRADA lifts the floor");
        lista.grants.gaze(lista.session, lista.canvas, gaze(1, 0));
        TestKit.check(lista.canvas.gaze().seq() == 1, "a stale seq is ignored (highest seq wins)");
    }

    /** LISTA: a new CONCESION (epoch + 1) and the sketch owed again in ed2 (same ids, new deliveries). */
    private static void editionSwapReissuesConcession() throws Exception {
        var s = ConcessionRig.create(ProtoCodes.ST_BOCETO);
        var ed1 = new WorkMeta("w", "w", 512, 384, 256, 2, ProtoCodes.ST_BOCETO, 1);
        s.canvas.setStore(s.work.store, ed1);
        s.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        s.grants.gaze(s.session, s.canvas, gaze(5, 0));
        long epoch = s.canvas.concession().epoch();
        s.mapping.control.clear();
        s.work.meta = new WorkMeta("w", "w", 512, 384, 256, 2, ProtoCodes.ST_LISTA, 2);
        s.grants.substitute(s.canvas, s.work);
        TestKit.check(s.canvas.concession().epoch() == epoch + 1, "epoch + 1");
        TestKit.check(s.first(FrameType.CONCESION) != null, "CONCESION sent even with a live gaze");
        TestKit.check(s.canvas.book().bands(new BrushId(10, 0, 0)) == 0, "ed1 seed does not count in ed2");
        var plan = MsgGaze.Plan.parse(s.first(FrameType.PLAN).payload());
        TestKit.check(plan.expectedCount() > 0, "the sketch is repainted in ed2");
    }

    /** RASPAR TODO -> RASPADO confirmed -> ERROR 4; never ERROR 4 before the confirmation. */
    private static void withdrawalWaitsForScrape() throws Exception {
        var s = ConcessionRig.create();
        s.grants.withdraw(s.canvas);
        TestKit.check(s.first(FrameType.ERROR) == null, "no ERROR 4 before RASPADO");
        TestKit.check(s.session.canvases().containsKey(1L), "handle alive until confirmed");
        var order = s.canvas.orders().pendingScrapes().get(0);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, order.order(), order.epoch(), order.through(),
                256, 3, Ranges.empty()));
        Frame err = s.first(FrameType.ERROR);
        TestKit.check(err != null && MsgError.ProtocolError.parse(err.payload()).code()
                == ProtoCodes.ERR_OBRA_INEXISTENTE && MsgError.ProtocolError.parse(err.payload()).fail() == 0,
                "ERROR 4, not fatal");
        TestKit.check(!s.session.canvases().containsKey(1L), "handle invalid after");
    }
}
