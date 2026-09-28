package seurat.paint;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.Semaphore;
import java.util.zip.CRC32C;
import seurat.codec.Quant;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.observe.Metrics;
import seurat.proto.Headers;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Delivery;
import seurat.store.BrushStore;
import seurat.store.FileBrushStore;

/**
 * One PINCELADA flow: header + bands + FIN on a virtual thread. A corrupt band on
 * disk shrinks the delivery to its valid prefix (spec 8); a failed flow is cancelled.
 */
final class DeliveryWriter {
    /** What the Painter opened: the store is the one of the delivery's edition. */
    record Flow(Canvas canvas, Delivery delivery, BrushStore store, long generation) {}

    private final Metrics metrics;
    private final Semaphore globalSlots;
    private final InFlightDeliveries inFlight;
    private final Runnable slotFreed;

    DeliveryWriter(Metrics metrics, Semaphore globalSlots, InFlightDeliveries inFlight, Runnable slotFreed) {
        this.metrics = metrics;
        this.globalSlots = globalSlots;
        this.inFlight = inFlight;
        this.slotFreed = slotFreed;
    }

    void write(Flow flow) {
        Canvas canvas = flow.canvas();
        Delivery delivery = flow.delivery();
        var session = canvas.session();
        boolean onWire = false; // a store failure is not retried: the same bytes would fail again
        try {
            byte[][] bands = flow.store().servable(delivery.brush(), delivery.from(), delivery.through());
            if (bands.length == 0) {
                throw new IOException("no valid band");
            }
            delivery = prefix(canvas, delivery, bands);
            long[] crcs = new long[bands.length];
            long[] lengths = new long[bands.length];
            CRC32C crc = new CRC32C();
            for (int i = 0; i < bands.length; i++) {
                crc.reset();
                crc.update(bands[i]);
                crcs[i] = crc.getValue();
                lengths[i] = bands[i].length;
            }
            // The store's own table: works ingested before table 2 still decode right.
            int table = flow.store() instanceof FileBrushStore s ? s.quantTable : Quant.TABLE;
            int stratum = delivery.brush().stratum();
            var head = new Headers.BrushHead(canvas.handle(), delivery.number(), delivery.brush().id(),
                    delivery.from(), delivery.through(), delivery.epoch(), Quant.qy(table, stratum),
                    Quant.qc(table, stratum), delivery.edition(), crcs, lengths);
            onWire = true;
            try (OutputStream out = session.mapping().openDelivery(canvas, delivery)) {
                out.write(head.encode());
                for (byte[] band : bands) {
                    out.write(band);
                }
            }
            metrics.deliveries.increment();
            metrics.bytes.add(delivery.bytes());
            if (Log.isDebugEnabled()) {
                Log.debug("paint", canvas.subject() + " delivered brush=" + delivery.brush().id()
                        + " n=" + delivery.number());
            }
        } catch (Throwable ex) {
            Log.warn("paint", canvas.subject() + " delivery failed n=" + delivery.number() + ": " + LogUnits.cause(ex));
            synchronized (canvas) {
                canvas.book().cancel(delivery.number());
                if (onWire) {
                    canvas.plan().lost(); // spec 8: cut before its FIN, planned again with another number
                }
                PlanEvents.cancelled(canvas, Ranges.of(delivery.number())); // every number settles (spec 4.2.4c)
            }
        } finally {
            inFlight.remove(canvas, delivery);
            session.releaseSlot();
            globalSlots.release();
            synchronized (canvas) {
                PlanEvents.resolved(canvas, flow.generation());
            }
            slotFreed.run();
        }
    }

    /** The book holds what goes on the wire: a shorter prefix is annotated before the header. */
    private static Delivery prefix(Canvas canvas, Delivery d, byte[][] bands) {
        int through = d.from() + bands.length;
        if (through == d.through()) {
            return d;
        }
        int bytes = 0;
        for (byte[] b : bands) {
            bytes += b.length;
        }
        synchronized (canvas) {
            Delivery shrunk = canvas.book().shrink(d.number(), through, bytes);
            return shrunk == null ? new Delivery(d.number(), d.brush(), d.from(), through, bytes,
                    d.epoch(), d.edition()) : shrunk;
        }
    }
}
